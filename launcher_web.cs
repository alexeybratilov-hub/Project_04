// ОТ-База — одиночный веб-лаунчер для Windows.
//
// Назначение: один файл .exe, внутри которого лежит собранное приложение (app.html).
// Лаунчер поднимает минимальный HTTP-сервер строго на 127.0.0.1 со случайным портом
// (без прав администратора, без http.sys/URL ACL) и открывает приложение в браузере.
// Работа через http://127.0.0.1 даёт secure context, поэтому доступна «Рабочая папка»
// (File System Access API) и localStorage приложения.
//
// Сборка (без MinGW, только .NET Framework):
//   csc /nologo /target:winexe /out:OT-Baza.exe /resource:app.html,app.html launcher_web.cs
//       /r:System.Windows.Forms.dll /r:System.Drawing.dll

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace OtBaza
{
    internal static class Program
    {
        private const string MutexName = "Local\\OT-Baza-SingleInstance";
        private const string LogFileName = "OT-Baza.log";

        private static Mutex _mutex;
        private static byte[] _html;
        private static TcpListener _listener;

        internal static string Url = "";

        [STAThread]
        private static void Main(string[] args)
        {
            bool quiet = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "--no-browser", StringComparison.OrdinalIgnoreCase))
                {
                    quiet = true;
                }
            }

            bool createdNew;
            _mutex = new Mutex(true, MutexName, out createdNew);
            if (!createdNew)
            {
                MessageBox.Show(
                    "ОТ-База уже запущена. Откройте её окно в браузере.",
                    "ОТ-База",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                _html = LoadEmbeddedApp();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Не удалось прочитать встроенное приложение: " + ex.Message,
                    "ОТ-База",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            int port = StartServer();
            if (port > 0)
            {
                Url = string.Format("http://127.0.0.1:{0}/", port);
                Log("started " + Url);
                if (!quiet)
                {
                    OpenBrowser(Url);
                }
            }
            else
            {
                // Резервный путь: локальный файл (доступ к папкам браузер в этом режиме не даст).
                string path = ExtractToTemp();
                Url = new Uri(path).AbsoluteUri;
                Log("fallback " + Url);
                if (!quiet)
                {
                    OpenBrowser(Url);
                }
            }

            Application.Run(new TrayContext());
        }

        internal static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Не удалось открыть браузер: " + ex.Message + Environment.NewLine +
                    "Откройте вручную: " + url,
                    "ОТ-База",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private static byte[] LoadEmbeddedApp()
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream("app.html"))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("ресурс app.html не найден в сборке");
                }
                using (var buffer = new MemoryStream())
                {
                    stream.CopyTo(buffer);
                    return buffer.ToArray();
                }
            }
        }

        private static string ExtractToTemp()
        {
            string dir = Path.Combine(Path.GetTempPath(), "OT-Baza");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "app.html");
            File.WriteAllBytes(path, _html);
            return path;
        }

        private static int StartServer()
        {
            // Стабильный порт важен: origin (127.0.0.1:порт) определяет localStorage.
            // При смене порта браузер считал бы данные другим источником.
            int[] preferred = new int[] { 47821, 47822, 47823, 47824, 47825, 47826 };
            for (int i = 0; i < preferred.Length; i++)
            {
                if (TryStart(preferred[i]))
                {
                    if (i > 0)
                    {
                        Log("warning: preferred port 47821 busy, using " + preferred[i]);
                    }
                    return preferred[i];
                }
            }

            for (int attempt = 0; attempt < 40; attempt++)
            {
                int port = RandomPort();
                if (TryStart(port))
                {
                    Log("warning: fixed ports busy, random port " + port);
                    return port;
                }
            }
            return 0;
        }

        private static bool TryStart(int port)
        {
            try
            {
                var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                _listener = listener;
                var thread = new Thread(AcceptLoop) { IsBackground = true };
                thread.Start();
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static int RandomPort()
        {
            var random = new Random(Guid.NewGuid().GetHashCode());
            return random.Next(49152, 65000);
        }

        private static void AcceptLoop()
        {
            TcpListener listener = _listener;
            while (true)
            {
                try
                {
                    using (TcpClient client = listener.AcceptTcpClient())
                    {
                        client.ReceiveTimeout = 5000;
                        client.SendTimeout = 15000;
                        using (NetworkStream stream = client.GetStream())
                        {
                            string requestLine = ReadLine(stream);
                            if (string.IsNullOrEmpty(requestLine))
                            {
                                continue;
                            }

                            string path = "/";
                            string[] parts = requestLine.Split(' ');
                            if (parts.Length >= 2)
                            {
                                path = parts[1];
                            }
                            int queryIndex = path.IndexOf('?');
                            if (queryIndex >= 0)
                            {
                                path = path.Substring(0, queryIndex);
                            }

                            // Дочитываем заголовки, чтобы клиент не получил RST.
                            for (int i = 0; i < 100; i++)
                            {
                                string header = ReadLine(stream);
                                if (string.IsNullOrEmpty(header))
                                {
                                    break;
                                }
                            }

                            if (path == "/" || path == "/index.html" || path == "/app.html")
                            {
                                WriteResponse(stream, "200 OK", "text/html; charset=utf-8", _html);
                            }
                            else if (path == "/manifest.webmanifest")
                            {
                                byte[] manifest = Encoding.UTF8.GetBytes(
                                    "{\"name\":\"ОТ-База\",\"short_name\":\"ОТ-База\"," +
                                    "\"start_url\":\"/\",\"display\":\"standalone\"," +
                                    "\"background_color\":\"#eef2f8\",\"theme_color\":\"#1e293b\"}");
                                WriteResponse(stream, "200 OK", "application/manifest+json; charset=utf-8", manifest);
                            }
                            else if (path == "/favicon.ico" || path == "/sw.js")
                            {
                                WriteResponse(stream, "204 No Content", "text/plain", new byte[0]);
                            }
                            else
                            {
                                // Прочие запросы браузера (иконки, служебные файлы) не должны
                                // засорять консоль ошибками 404.
                                WriteResponse(stream, "204 No Content", "text/plain", new byte[0]);
                            }
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(20);
                }
            }
        }

        private static string ReadLine(Stream stream)
        {
            var bytes = new System.Collections.Generic.List<byte>(128);
            int read;
            while ((read = stream.ReadByte()) >= 0)
            {
                if (read == '\n')
                {
                    break;
                }
                if (read == '\r')
                {
                    continue;
                }
                if (bytes.Count > 8192)
                {
                    break;
                }
                bytes.Add((byte)read);
            }
            if (bytes.Count == 0 && read < 0)
            {
                return null;
            }
            return Encoding.ASCII.GetString(bytes.ToArray());
        }

        private static void WriteResponse(Stream stream, string status, string contentType, byte[] body)
        {
            string header =
                "HTTP/1.1 " + status + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Cache-Control: no-store\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (body.Length > 0)
            {
                stream.Write(body, 0, body.Length);
            }
            stream.Flush();
        }

        internal static void Log(string message)
        {
            try
            {
                string path = Path.Combine(Path.GetTempPath(), LogFileName);
                string line = DateTime.Now.ToString("s") + " " + message + Environment.NewLine;
                File.AppendAllText(path, line, Encoding.UTF8);
            }
            catch
            {
                // Логирование не должно мешать запуску.
            }
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon _icon;

        public TrayContext()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Открыть в браузере", null, delegate { Program.OpenBrowser(Program.Url); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Выход", null, delegate { ExitThread(); });

            _icon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Visible = true,
                Text = "ОТ-База — запущена",
                ContextMenuStrip = menu
            };
            _icon.DoubleClick += delegate { Program.OpenBrowser(Program.Url); };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _icon.Visible = false;
                _icon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
