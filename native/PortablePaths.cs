using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;

namespace OtBaza
{
    /// <summary>
    /// Портативность: где лежат данные, можно ли писать рядом с EXE и как не
    /// потерять базу при двойном запуске.
    ///
    /// Правило: всё (data/, documents/, data/backups/) хранится в той же папке,
    /// что и ОТ-База.exe. Если носитель защищён от записи (CD, корпоративный
    /// запрет, один EXE в Program Files), приложение не падает, а уходит в
    /// резервную папку пользователя и честно сообщает об этом в статусной строке.
    /// </summary>
    internal sealed class PortableInfo
    {
        public string ExeDirectory = string.Empty;
        public string DataRoot = string.Empty;
        public bool IsPortable = true;
        public string FallbackReason;
    }

    internal static class PortablePaths
    {
        /// <summary>Кандидат портативного расположения без проверки записи.</summary>
        public static string ExeDirectory()
        {
            try
            {
                string location = Assembly.GetExecutingAssembly().Location;
                if (!string.IsNullOrEmpty(location))
                {
                    string dir = Path.GetDirectoryName(location);
                    if (!string.IsNullOrEmpty(dir)) return dir;
                }
            }
            catch
            {
                // В редких средах Location может быть недоступен.
            }
            return Directory.GetCurrentDirectory();
        }

        /// <summary>Резервная папка, если рядом с EXE писать нельзя.</summary>
        public static string FallbackRoot()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(local)) local = Path.GetTempPath();
            return Path.Combine(local, "OT-Baza");
        }

        /// <summary>
        /// Проверяет запись рядом с EXE. Проверка настоящая: создаётся и удаляется
        /// пробный файл в data/, потому что «папка существует» не значит «папка
        /// доступна на запись».
        /// </summary>
        public static PortableInfo Resolve()
        {
            var info = new PortableInfo();
            info.ExeDirectory = ExeDirectory();

            string probeDirectory = Path.Combine(info.ExeDirectory, "data");
            try
            {
                Directory.CreateDirectory(probeDirectory);
                string probe = Path.Combine(probeDirectory, ".write-test");
                using (var stream = new FileStream(probe, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    stream.WriteByte(0x31);
                }
                File.Delete(probe);
                info.DataRoot = info.ExeDirectory;
                info.IsPortable = true;
                info.FallbackReason = null;
                return info;
            }
            catch (Exception ex)
            {
                info.DataRoot = FallbackRoot();
                info.IsPortable = false;
                info.FallbackReason = ex.Message;
                try { Directory.CreateDirectory(info.DataRoot); }
                catch { }
                return info;
            }
        }

        /// <summary>
        /// Имя мьютекса уникально для папки с данными: две флешки на одном ПК
        /// работают независимо, а два окна из одной папки — нет.
        /// </summary>
        public static string InstanceMutexName(string dataRoot)
        {
            string normalized = (dataRoot ?? string.Empty)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .ToLowerInvariant();
            return @"Local\OtBaza_" + StableHash(normalized);
        }

        /// <summary>FNV-1a 64 бита: стабильно между запусками и машинами.</summary>
        private static string StableHash(string value)
        {
            const ulong offset = 14695981039346656037UL;
            const ulong prime = 1099511628211UL;
            ulong hash = offset;
            foreach (char c in value)
            {
                hash ^= (byte)(c & 0xFF);
                hash *= prime;
                hash ^= (byte)((c >> 8) & 0xFF);
                hash *= prime;
            }
            return hash.ToString("x16", CultureInfo.InvariantCulture);
        }

        /// <summary>Текст для консоли/отчёта: --portable-check.</summary>
        public static string Describe(PortableInfo info)
        {
            var text = new StringBuilder();
            text.AppendLine("ОТ-База — проверка портативности");
            text.AppendLine("exe        : " + info.ExeDirectory);
            text.AppendLine("dataRoot   : " + info.DataRoot);
            text.AppendLine("portable   : " + (info.IsPortable ? "yes (данные рядом с EXE)" : "no (резервная папка)"));
            if (!info.IsPortable && !string.IsNullOrEmpty(info.FallbackReason))
            {
                text.AppendLine("reason     : " + info.FallbackReason);
            }
            text.AppendLine("db         : " + Path.Combine(info.DataRoot, "data", "ot_database.json"));
            text.AppendLine("documents  : " + Path.Combine(info.DataRoot, "documents"));
            text.AppendLine("backups    : " + Path.Combine(info.DataRoot, "data", "backups"));
            text.AppendLine("итог       : " + (info.IsPortable
                ? "перенос на другой ПК = скопировать папку целиком"
                : "скопируйте папку данных вручную: " + info.DataRoot));
            return text.ToString();
        }
    }

    /// <summary>
    /// Диагностика без графического интерфейса: `ОТ-База.exe --portable-check`.
    /// Коды возврата: 0 — портативно, 3 — данные в резервной папке.
    /// </summary>
    internal static class PortableCheck
    {
        public static int Run()
        {
            PortableInfo info = PortablePaths.Resolve();
            string report = PortablePaths.Describe(info);

            var details = new StringBuilder();
            details.AppendLine(report);
            string dbPath = Path.Combine(info.DataRoot, "data", "ot_database.json");
            if (File.Exists(dbPath))
            {
                try
                {
                    var info2 = new FileInfo(dbPath);
                    details.AppendLine("dbFile     : " + (info2.Length / 1024) + " КБ, изменён " + info2.LastWriteTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture));
                    var store = Store.OpenAt(Catalog.Load(), info.DataRoot);
                    int rows = store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
                    details.AppendLine("dbStatus   : открыта, таблиц=" + store.Tabs.Count + ", записей=" + rows);
                }
                catch (Exception ex)
                {
                    details.AppendLine("dbStatus   : ОШИБКА " + ex.Message);
                }
            }
            else
            {
                details.AppendLine("dbFile     : нет — будет создана при первом запуске из встроенной пустой базы");
            }

            try
            {
                Console.Out.Write(details.ToString());
                Console.Out.Flush();
            }
            catch
            {
                // У winexe может не быть консоли — отчёт всё равно есть в файле.
            }
            try
            {
                string reportDirectory = Path.Combine(info.DataRoot, "data");
                Directory.CreateDirectory(reportDirectory);
                File.WriteAllText(Path.Combine(reportDirectory, "portable-check.txt"), details.ToString(), Encoding.UTF8);
            }
            catch
            {
            }
            return info.IsPortable ? 0 : 3;
        }
    }
}
