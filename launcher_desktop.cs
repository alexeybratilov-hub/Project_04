// ОТ-База — десктопное приложение на WebView2 (без браузера и без локального сервера).
//
// Приложение (app.html) встроено в EXE и отдаётся окну через перехват запросов
// к виртуальному адресу https://ot-baza.local/ — это даёт стабильный origin,
// поэтому localStorage сохраняется между запусками.
//
// Сборка (Windows + .NET Framework 4.x + WebView2 SDK, без MinGW):
//   powershell -ExecutionPolicy Bypass -File .\build_desktop_exe.ps1

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OtBaza
{
    /// <summary>
    /// Нативный доступ к файлам для десктопной версии: база и документы лежат рядом
    /// с программой (портативно), без диалогов браузера и без локального сервера.
    /// </summary>
    [ComVisible(true)]
    public class DesktopBridge
    {
        private readonly string _root;

        public DesktopBridge(string root)
        {
            _root = root;
            Directory.CreateDirectory(Path.Combine(_root, "data"));
            Directory.CreateDirectory(Path.Combine(_root, "data", "backups"));
        }

        public string GetRoot()
        {
            return _root;
        }

        public void OpenRoot()
        {
            try
            {
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + _root + "\"") { UseShellExecute = true });
            }
            catch
            {
                // Открытие проводника не должно ломать приложение.
            }
        }

        public string ReadDatabase()
        {
            string path = Path.Combine(_root, "data", "ot_database.json");
            if (!File.Exists(path))
            {
                return null;
            }
            return File.ReadAllText(path, Encoding.UTF8);
        }

        public void WriteDatabase(string json)
        {
            string dataDir = Path.Combine(_root, "data");
            Directory.CreateDirectory(dataDir);
            string target = Path.Combine(dataDir, "ot_database.json");
            string backupDir = Path.Combine(dataDir, "backups");
            Directory.CreateDirectory(backupDir);

            if (File.Exists(target))
            {
                string previous = File.ReadAllText(target, Encoding.UTF8);
                if (!string.IsNullOrWhiteSpace(previous))
                {
                    File.WriteAllText(
                        Path.Combine(backupDir, "ot_database_prev.json"),
                        previous,
                        Encoding.UTF8);
                }
            }

            string tmp = target + ".tmp";
            File.WriteAllText(tmp, json, Encoding.UTF8);
            if (File.Exists(target))
            {
                File.Replace(tmp, target, null);
            }
            else
            {
                File.Move(tmp, target);
            }
        }

        public void WriteBinary(string relativePath, string base64)
        {
            string path = Resolve(relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, Convert.FromBase64String(base64));
        }

        public string ReadBinary(string relativePath)
        {
            string path = Resolve(relativePath);
            if (!File.Exists(path))
            {
                return null;
            }
            return Convert.ToBase64String(File.ReadAllBytes(path));
        }

        public bool Delete(string relativePath)
        {
            try
            {
                string path = Resolve(relativePath);
                if (File.Exists(path))
                {
                    File.Delete(path);
                    return true;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        public string List(string relativePath)
        {
            try
            {
                string path = Resolve(relativePath);
                if (!Directory.Exists(path))
                {
                    return "[]";
                }
                var names = new System.Collections.Generic.List<string>();
                foreach (string file in Directory.GetFiles(path))
                {
                    names.Add(Path.GetFileName(file));
                }
                var builder = new StringBuilder("[");
                for (int i = 0; i < names.Count; i++)
                {
                    if (i > 0)
                    {
                        builder.Append(',');
                    }
                    builder.Append('"').Append(names[i].Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
                }
                builder.Append(']');
                return builder.ToString();
            }
            catch
            {
                return "[]";
            }
        }

        private string Resolve(string relativePath)
        {
            if (string.IsNullOrWhiteSpace(relativePath))
            {
                throw new ArgumentException("пустой путь");
            }
            string normalized = relativePath.Replace('/', Path.DirectorySeparatorChar)
                                            .Replace('\\', Path.DirectorySeparatorChar)
                                            .TrimStart(Path.DirectorySeparatorChar);
            if (normalized.Contains(".."))
            {
                throw new ArgumentException("недопустимый путь");
            }
            string full = Path.GetFullPath(Path.Combine(_root, normalized));
            string rootFull = Path.GetFullPath(_root).TrimEnd(Path.DirectorySeparatorChar)
                              + Path.DirectorySeparatorChar;
            if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("путь вне рабочей папки");
            }
            return full;
        }
    }

    internal static class Program
    {
        internal const string VirtualHost = "https://ot-baza.local/";
        internal static string RuntimeDir = "";
        internal static string ProfileDir = "";
        internal static string DataRoot = "";
        internal static byte[] AppHtml;

        [STAThread]
        private static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Log("FATAL " + e.ExceptionObject);
            };
            Log("start args=" + string.Join(" ", args));
            bool quiet = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], "--selftest", StringComparison.OrdinalIgnoreCase)) quiet = true;
            }

            DataRoot = ResolveDataRoot();
            RuntimeDir = EnsureDir(
                Path.Combine(DataRoot, ".runtime"),
                Path.Combine(Path.GetTempPath(), "OT-Baza-runtime"));
            ProfileDir = EnsureDir(
                Path.Combine(DataRoot, ".webview2"),
                Path.Combine(Path.GetTempPath(), "OT-Baza-profile"));
            Log("dataroot=" + DataRoot);

            ExtractResource("Microsoft.Web.WebView2.Core.dll", RuntimeDir);
            ExtractResource("Microsoft.Web.WebView2.WinForms.dll", RuntimeDir);
            ExtractResource("WebView2Loader.dll", RuntimeDir);
            AppHtml = ReadResource("app.html");

            SetDllDirectory(RuntimeDir);
            AppDomain.CurrentDomain.AssemblyResolve += ResolveFromRuntime;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(quiet));
        }

        private static Assembly ResolveFromRuntime(object sender, ResolveEventArgs args)
        {
            string simpleName = new AssemblyName(args.Name).Name + ".dll";
            string path = Path.Combine(RuntimeDir, simpleName);
            if (File.Exists(path))
            {
                // Загружаем из байтов: LoadFrom может отказать, если у файла есть
                // метка «из интернета» или папка считается недоверенной.
                return Assembly.Load(File.ReadAllBytes(path));
            }
            return null;
        }

        internal static void Log(string message)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? Path.GetTempPath(), "ot-startup.log"),
                    DateTime.Now.ToString("s") + " " + message + Environment.NewLine,
                    Encoding.UTF8);
            }
            catch
            {
            }
        }

        private static string EnsureDir(string preferred, string fallback)
        {
            try
            {
                Directory.CreateDirectory(preferred);
                return preferred;
            }
            catch
            {
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        private static string ResolveDataRoot()
        {
            try
            {
                string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string dataDir = Path.Combine(exeDir, "data");
                Directory.CreateDirectory(dataDir);
                string probe = Path.Combine(dataDir, ".write-test");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                return exeDir;
            }
            catch
            {
                string fallback = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "OT-Baza",
                    "data-root");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        private static void ExtractResource(string name, string directory)
        {
            string target = Path.Combine(directory, name);
            byte[] data = ReadResource(name);
            bool needsWrite = true;
            if (File.Exists(target))
            {
                try
                {
                    needsWrite = new FileInfo(target).Length != data.Length;
                }
                catch
                {
                    needsWrite = true;
                }
            }
            if (needsWrite)
            {
                File.WriteAllBytes(target, data);
            }
        }

        private static byte[] ReadResource(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(name))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("ресурс " + name + " не найден в сборке");
                }
                using (var buffer = new MemoryStream())
                {
                    stream.CopyTo(buffer);
                    return buffer.ToArray();
                }
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string path);
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 _webView;
        private readonly bool _quiet;

        public MainForm(bool quiet)
        {
            _quiet = quiet;
            Text = "ОТ-База — база данных по охране труда";
            Width = 1440;
            Height = 900;
            MinimumSize = new Size(1024, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xEE, 0xF2, 0xF8);

            _webView = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_webView);

            Load += OnLoaded;
        }

        private async void OnLoaded(object sender, EventArgs e)
        {
            try
            {
                Program.Log("webview init profile=" + Program.ProfileDir);
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, Program.ProfileDir);
                await _webView.EnsureCoreWebView2Async(environment);

                CoreWebView2 core = _webView.CoreWebView2;
                core.Settings.AreDevToolsEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = true;

                core.AddHostObjectToScript("otDesktop", new DesktopBridge(Program.DataRoot));
                core.AddWebResourceRequestedFilter(Program.VirtualHost + "*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;

                core.Navigate(Program.VirtualHost);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Не удалось запустить окно приложения.\n\n" + ex.Message +
                    "\n\nПроверьте, что установлен Microsoft Edge WebView2 Runtime.",
                    "ОТ-База",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Close();
            }
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            string uri = e.Request.Uri ?? "";
            string path = uri;
            int query = path.IndexOf('?');
            if (query >= 0)
            {
                path = path.Substring(0, query);
            }

            CoreWebView2Environment environment = _webView.CoreWebView2.Environment;
            bool isRoot = path == Program.VirtualHost || path == Program.VirtualHost + "index.html"
                          || path == Program.VirtualHost + "app.html";
            if (isRoot)
            {
                e.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(Program.AppHtml),
                    200,
                    "OK",
                    "Content-Type: text/html; charset=utf-8\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "X-Content-Type-Options: nosniff");
            }
            else
            {
                e.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(new byte[0]),
                    204,
                    "No Content",
                    "Content-Type: text/plain");
            }
        }
    }
}
