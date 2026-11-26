using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

namespace OtBaza
{
    /// <summary>Утилиты для работы с JSON-деревом (Dictionary/object[]), которое отдаёт JavaScriptSerializer.</summary>
    internal static class J
    {
        public static Dictionary<string, object> Obj(object value)
        {
            return value as Dictionary<string, object>;
        }

        public static List<object> Arr(object value)
        {
            var array = value as object[];
            return array == null ? new List<object>() : new List<object>(array);
        }

        public static string Str(object value)
        {
            if (value == null) return string.Empty;
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }

        public static int Int(object value, int fallback)
        {
            if (value == null) return fallback;
            int result;
            if (int.TryParse(Str(value), NumberStyles.Integer, CultureInfo.InvariantCulture, out result)) return result;
            return fallback;
        }

        public static void Put(Dictionary<string, object> target, string key, object value)
        {
            if (target == null) return;
            target[key] = value;
        }

        public static object Get(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            return source.TryGetValue(key, out value) ? value : null;
        }
    }

    internal sealed class ModuleDef
    {
        public string Id;
        public string Title;
        public string TabId;
        public string TabName;
        public bool Base;
        public bool Custom;
        public List<Dictionary<string, object>> Columns = new List<Dictionary<string, object>>();
    }

    internal sealed class ObligationRule
    {
        public string Id;
        public string ModuleId;
        public string Event;
        public string Title;
        public string Kind;
        public int OffsetDays;
        public int? PeriodicityMonths;
        public Dictionary<string, int> PeriodicityBySoutClass = new Dictionary<string, int>();
        public List<string> PositionMatches = new List<string>();
        public string LegalBasis;
        public string TemplateId;
    }

    internal sealed class TemplateDef
    {
        public string Id;
        public string Name;
        public string Category;
        public string Content;
    }

    internal sealed class Catalog
    {
        public List<ModuleDef> Modules = new List<ModuleDef>();
        public List<ObligationRule> Rules = new List<ObligationRule>();
        public List<TemplateDef> Templates = new List<TemplateDef>();
        public List<Dictionary<string, object>> DefaultColumns = new List<Dictionary<string, object>>();

        public ModuleDef Module(string id)
        {
            return Modules.FirstOrDefault(m => m.Id == id);
        }

        public TemplateDef Template(string id)
        {
            return Templates.FirstOrDefault(t => t.Id == id);
        }

        public static Catalog Load()
        {
            string json = ReadResource("modules.json");
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var root = serializer.DeserializeObject(json) as Dictionary<string, object>;
            var catalog = new Catalog();

            foreach (object item in J.Arr(J.Get(root, "defaultColumns")))
            {
                var column = J.Obj(item);
                if (column != null) catalog.DefaultColumns.Add(column);
            }

            foreach (object item in J.Arr(J.Get(root, "modules")))
            {
                var raw = J.Obj(item);
                if (raw == null) continue;
                var module = new ModuleDef
                {
                    Id = J.Str(J.Get(raw, "id")),
                    Title = J.Str(J.Get(raw, "title")),
                    TabId = J.Str(J.Get(raw, "tabId")),
                    TabName = J.Str(J.Get(raw, "tabName")),
                    Base = J.Str(J.Get(raw, "base")) == "true" || J.Get(raw, "base") is bool && (bool)J.Get(raw, "base")
                };
                foreach (object column in J.Arr(J.Get(raw, "columns")))
                {
                    var columnDict = J.Obj(column);
                    if (columnDict != null) module.Columns.Add(columnDict);
                }
                catalog.Modules.Add(module);
            }

            foreach (object item in J.Arr(J.Get(root, "templates")))
            {
                var rawTemplate = J.Obj(item);
                if (rawTemplate == null) continue;
                catalog.Templates.Add(new TemplateDef
                {
                    Id = J.Str(J.Get(rawTemplate, "id")),
                    Name = J.Str(J.Get(rawTemplate, "name")),
                    Category = J.Str(J.Get(rawTemplate, "category")),
                    Content = J.Str(J.Get(rawTemplate, "content"))
                });
            }

            foreach (object item in J.Arr(J.Get(root, "rules")))
            {
                var raw = J.Obj(item);
                if (raw == null) continue;
                var rule = new ObligationRule
                {
                    Id = J.Str(J.Get(raw, "id")),
                    ModuleId = J.Str(J.Get(raw, "moduleId")),
                    Event = J.Str(J.Get(raw, "event")),
                    Title = J.Str(J.Get(raw, "title")),
                    Kind = J.Str(J.Get(raw, "kind")),
                    OffsetDays = J.Int(J.Get(raw, "offsetDays"), 0),
                    LegalBasis = J.Str(J.Get(raw, "legalBasis")),
                    TemplateId = J.Str(J.Get(raw, "templateId"))
                };
                object periodicity = J.Get(raw, "periodicityMonths");
                if (periodicity != null) rule.PeriodicityMonths = J.Int(periodicity, 0);
                foreach (object position in J.Arr(J.Get(raw, "positionMatches")))
                {
                    rule.PositionMatches.Add(J.Str(position));
                }
                var byClass = J.Obj(J.Get(raw, "periodicityBySoutClass"));
                if (byClass != null)
                {
                    foreach (var pair in byClass)
                    {
                        rule.PeriodicityBySoutClass[pair.Key] = J.Int(pair.Value, 0);
                    }
                }
                catalog.Rules.Add(rule);
            }

            return catalog;
        }

        internal static string ReadResource(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(name))
            {
                if (stream == null) throw new InvalidOperationException("Ресурс " + name + " не найден в сборке.");
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
        }
    }

    /// <summary>
    /// Хранилище данных: тот же ./data/ot_database.json, что у веб-версии.
    /// Неизвестные поля сохраняются как есть, поэтому файл остаётся совместимым.
    /// </summary>
    internal sealed class Store
    {
        public Catalog Catalog;
        public string DataRoot = string.Empty;
        public string DbPath = string.Empty;
        public Dictionary<string, object> Db;
        public List<ModuleDef> CustomModules = new List<ModuleDef>();

        private readonly JavaScriptSerializer _serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private string _customModulesPath = string.Empty;

        public static Store Open(Catalog catalog)
        {
            return OpenAt(catalog, ResolveDataRoot());
        }

        public static Store OpenAt(Catalog catalog, string dataRoot)
        {
            var store = new Store { Catalog = catalog };
            store.DataRoot = dataRoot;
            Directory.CreateDirectory(Path.Combine(store.DataRoot, "data"));
            Directory.CreateDirectory(Path.Combine(store.DataRoot, "data", "backups"));
            store.DbPath = Path.Combine(store.DataRoot, "data", "ot_database.json");
            store._customModulesPath = Path.Combine(store.DataRoot, "data", "native_modules.json");

            if (!File.Exists(store.DbPath))
            {
                File.WriteAllText(store.DbPath, Catalog.ReadResource("initial_db.json"), Encoding.UTF8);
            }

            store.Db = store._serializer.DeserializeObject(File.ReadAllText(store.DbPath, Encoding.UTF8)) as Dictionary<string, object>;
            if (store.Db == null) throw new InvalidOperationException("Файл базы повреждён: " + store.DbPath);

            store.LoadCustomModules();
            store.MergeCustomModules();
            return store;
        }

        private static string ResolveDataRoot()
        {
            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? Directory.GetCurrentDirectory();
            try
            {
                string probe = Path.Combine(exeDir, "data", ".write-test");
                Directory.CreateDirectory(Path.Combine(exeDir, "data"));
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                return exeDir;
            }
            catch
            {
                string fallback = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "OT-Baza");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        public Dictionary<string, object> Entity
        {
            get
            {
                string activeId = J.Str(J.Get(Db, "activeEntityId"));
                var entities = J.Arr(J.Get(Db, "entities"));
                foreach (object item in entities)
                {
                    var entity = J.Obj(item);
                    if (entity != null && J.Str(J.Get(entity, "id")) == activeId) return entity;
                }
                var first = entities.Count > 0 ? J.Obj(entities[0]) : null;
                if (first != null) return first;
                throw new InvalidOperationException("В базе нет ни одной организации.");
            }
        }

        public Dictionary<string, object> Profile
        {
            get { return J.Obj(J.Get(Entity, "profile")) ?? new Dictionary<string, object>(); }
        }

        public List<object> Tabs
        {
            get
            {
                var tabs = J.Arr(J.Get(Entity, "tabs"));
                if (tabs.Count == 0) tabs = J.Arr(J.Get(Db, "tabs"));
                return tabs;
            }
        }

        public Dictionary<string, object> Settings
        {
            get
            {
                var settings = J.Obj(J.Get(Db, "settings"));
                if (settings == null)
                {
                    settings = new Dictionary<string, object>();
                    Db["settings"] = settings;
                }
                return settings;
            }
        }

        public List<string> InstalledModules
        {
            get
            {
                return J.Arr(J.Get(Settings, "installedModules")).Select(J.Str).Where(s => s.Length > 0).ToList();
            }
        }

        public void SetInstalledModules(IEnumerable<string> ids)
        {
            Settings["installedModules"] = ids.Distinct().ToArray();
        }

        public Dictionary<string, object> FindTab(string tabId)
        {
            foreach (object item in Tabs)
            {
                var tab = J.Obj(item);
                if (tab != null && J.Str(J.Get(tab, "id")) == tabId) return tab;
            }
            return null;
        }

        public Dictionary<string, object> FindTabByModule(string moduleId)
        {
            foreach (object item in Tabs)
            {
                var tab = J.Obj(item);
                if (tab != null && J.Str(J.Get(tab, "moduleId")) == moduleId) return tab;
            }
            return null;
        }

        public List<object> Obligations
        {
            get { return J.Arr(J.Get(Entity, "employeeObligations")); }
        }

        public List<object> Events
        {
            get { return J.Arr(J.Get(Entity, "employeeEvents")); }
        }

        public List<ModuleDef> VisibleModules()
        {
            var installed = InstalledModules;
            return Catalog.Modules.Where(m => installed.Contains(m.Id)).ToList();
        }

        public void Save()
        {
            var entity = Entity;
            J.Put(Db, "lastSaved", DateTime.UtcNow.ToString("o"));
            J.Put(entity, "updatedAt", DateTime.UtcNow.ToString("o"));

            // Зеркала активной организации: их читает и веб-версия.
            J.Put(Db, "tabs", J.Get(entity, "tabs"));
            J.Put(Db, "tags", J.Get(entity, "tags"));
            J.Put(Db, "templates", J.Get(entity, "templates"));
            J.Put(Db, "generatedDocs", J.Get(entity, "generatedDocs"));
            J.Put(Db, "employeeObligations", J.Get(entity, "employeeObligations"));
            J.Put(Db, "employeeEvents", J.Get(entity, "employeeEvents"));
            J.Put(Db, "auditLog", J.Get(entity, "auditLog"));

            string json = _serializer.Serialize(Db);
            string tmp = DbPath + ".tmp";
            File.WriteAllText(tmp, json, Encoding.UTF8);

            if (File.Exists(DbPath))
            {
                try
                {
                    string previous = File.ReadAllText(DbPath, Encoding.UTF8);
                    if (!string.IsNullOrWhiteSpace(previous))
                    {
                        File.WriteAllText(
                            Path.Combine(DataRoot, "data", "backups", "ot_database_prev.json"),
                            previous,
                            Encoding.UTF8);
                    }
                }
                catch
                {
                    // Бэкап не должен блокировать сохранение.
                }
                File.Replace(tmp, DbPath, null);
            }
            else
            {
                File.Move(tmp, DbPath);
            }
        }

        public void Reload()
        {
            Db = _serializer.DeserializeObject(File.ReadAllText(DbPath, Encoding.UTF8)) as Dictionary<string, object>;
            LoadCustomModules();
            MergeCustomModules();
        }

        public void InstallModule(ModuleDef module)
        {
            if (FindTab(module.TabId) == null)
            {
                var tab = new Dictionary<string, object>
                {
                    { "id", module.TabId },
                    { "name", module.TabName },
                    { "moduleId", module.Id },
                    { "columns", module.Columns.Select(c => new Dictionary<string, object>(c)).ToArray() },
                    { "rows", new object[0] },
                    { "attachedDocs", new object[0] }
                };
                var tabs = Tabs;
                tabs.Add(tab);
                J.Put(Entity, "tabs", tabs.ToArray());
            }
            var installed = InstalledModules;
            if (!installed.Contains(module.Id)) installed.Add(module.Id);
            SetInstalledModules(installed);
        }

        public void DisableModule(string moduleId)
        {
            var installed = InstalledModules;
            installed.Remove(moduleId);
            SetInstalledModules(installed);
            // Вкладка и данные остаются — как в веб-версии.
        }

        public string CreateCustomModule(string title, string columnsSpec)
        {
            string safeTitle = string.IsNullOrWhiteSpace(title) ? "Новый этап" : title.Trim();
            int index = CustomModules.Count + 1;
            string id = "custom_" + DateTime.Now.ToString("yyMMddHHmmss") + "_" + index;
            var module = new ModuleDef
            {
                Id = id,
                Title = safeTitle,
                TabId = "tab_" + id,
                TabName = safeTitle,
                Custom = true
            };
            if (!string.IsNullOrWhiteSpace(columnsSpec))
            {
                foreach (string rawName in columnsSpec.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string name = rawName.Trim();
                    if (name.Length == 0) continue;
                    module.Columns.Add(new Dictionary<string, object>
                    {
                        { "id", "col_" + (module.Columns.Count + 1) },
                        { "name", name },
                        { "type", "text" },
                        { "width", 180 }
                    });
                }
            }
            if (module.Columns.Count == 0)
            {
                foreach (var column in Catalog.DefaultColumns)
                {
                    module.Columns.Add(new Dictionary<string, object>(column));
                }
            }
            CustomModules.Add(module);
            MergeCustomModules();
            SaveCustomModules();
            InstallModule(module);
            return module.Id;
        }

        private void MergeCustomModules()
        {
            foreach (ModuleDef module in CustomModules)
            {
                if (Catalog.Module(module.Id) == null) Catalog.Modules.Add(module);
            }
        }

        private void LoadCustomModules()
        {
            CustomModules = new List<ModuleDef>();
            if (!File.Exists(_customModulesPath)) return;
            try
            {
                var root = _serializer.DeserializeObject(File.ReadAllText(_customModulesPath, Encoding.UTF8)) as Dictionary<string, object>;
                foreach (object item in J.Arr(J.Get(root, "modules")))
                {
                    var raw = J.Obj(item);
                    if (raw == null) continue;
                    var module = new ModuleDef
                    {
                        Id = J.Str(J.Get(raw, "id")),
                        Title = J.Str(J.Get(raw, "title")),
                        TabId = J.Str(J.Get(raw, "tabId")),
                        TabName = J.Str(J.Get(raw, "tabName")),
                        Custom = true
                    };
                    foreach (object column in J.Arr(J.Get(raw, "columns")))
                    {
                        var columnDict = J.Obj(column);
                        if (columnDict != null) module.Columns.Add(columnDict);
                    }
                    CustomModules.Add(module);
                }
            }
            catch
            {
                CustomModules = new List<ModuleDef>();
            }
        }

        private void SaveCustomModules()
        {
            var root = new Dictionary<string, object>
            {
                {
                    "modules",
                    CustomModules.Select(m => new Dictionary<string, object>
                    {
                        { "id", m.Id },
                        { "title", m.Title },
                        { "tabId", m.TabId },
                        { "tabName", m.TabName },
                        { "columns", m.Columns.ToArray() }
                    }).ToArray()
                }
            };
            File.WriteAllText(_customModulesPath, _serializer.Serialize(root), Encoding.UTF8);
        }
    }
}
