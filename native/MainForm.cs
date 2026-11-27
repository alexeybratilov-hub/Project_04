using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace OtBaza
{
    internal static class Theme
    {
        public static readonly Color Canvas = Color.FromArgb(0xEE, 0xF2, 0xF8);
        public static readonly Color Surface = Color.White;
        public static readonly Color Sidebar = Color.FromArgb(0xF8, 0xFA, 0xFC);
        public static readonly Color Line = Color.FromArgb(0xE2, 0xE8, 0xF0);
        public static readonly Color Ink = Color.FromArgb(0x1E, 0x29, 0x3B);
        public static readonly Color Muted = Color.FromArgb(0x64, 0x74, 0x8B);
        public static readonly Color Accent = Color.FromArgb(0x1E, 0x29, 0x3B);
        public static readonly Color AccentInk = Color.White;
        public static readonly Color SoftAccent = Color.FromArgb(0xE0, 0xEA, 0xFF);
        public static readonly Color Danger = Color.FromArgb(0xB9, 0x1C, 0x1C);
        public static readonly Color Warning = Color.FromArgb(0xB4, 0x53, 0x09);
        public static readonly Color Success = Color.FromArgb(0x04, 0x78, 0x57);

        public static Font Font(float size)
        {
            return Font(size, FontStyle.Regular);
        }

        public static Font Font(float size, FontStyle style)
        {
            return new Font("Segoe UI", size, style, GraphicsUnit.Point);
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly Store _store;
        private FlowLayoutPanel _sidebar;
        private FlowLayoutPanel _sidebarBottom;
        private FlowLayoutPanel _tabs;
        private Panel _content;
        private Label _status;
        private Label _entityLabel;
        private string _currentView = "home";
        private string _currentTabId = string.Empty;

        private readonly string _startModuleId;
        private readonly string _demo;
        private System.Windows.Forms.Timer _previewTimer;
        private TabPreviewForm _preview;

        public MainForm(Store store, string startModuleId, string demo)
        {
            _startModuleId = startModuleId;
            _demo = demo;
            _store = store;
            Ui.Reduced = J.Str(J.Get(_store.Settings, "visualEffects")) == "reduced";

            Text = "ОТ-База — база данных по охране труда";
            WindowState = FormWindowState.Normal;
            // Размер подгоняется под рабочий стол: при масштабе 125/150 % виртуальный
            // рабочий стол меньше, и окно 1340×800 иначе уезжает за край экрана.
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            int windowWidth = Math.Min(1340, Math.Max(900, workArea.Width - 20));
            int windowHeight = Math.Min(800, Math.Max(600, workArea.Height - 40));
            Size = new Size(windowWidth, windowHeight);
            MinimumSize = new Size(Math.Min(900, windowWidth), Math.Min(600, windowHeight));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xF3, 0xF7, 0xFD);
            Font = Ui.Font(13f);
            AutoScaleMode = AutoScaleMode.None;
            DoubleBuffered = true;

            var canvas = new CanvasPanel { Dock = DockStyle.Fill };
            Controls.Add(canvas);

            var root = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                BackColor = Color.Transparent,
                Padding = new Padding(10, 10, 12, 10)
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 244));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            canvas.Controls.Add(root);

            var sidebarHost = new GlassPanel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 10, 0) };
            root.Controls.Add(sidebarHost, 0, 0);

            _sidebar = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Color.Transparent,
                Padding = new Padding(10, 14, 10, 12)
            };
            sidebarHost.Controls.Add(_sidebar);

            _sidebarBottom = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 104,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                BackColor = Color.Transparent,
                Padding = new Padding(10, 4, 10, 8)
            };
            sidebarHost.Controls.Add(_sidebarBottom);
            _sidebarBottom.BringToFront();

            var main = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 4,
                BackColor = Color.Transparent
            };
            main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
            main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            root.Controls.Add(main, 1, 0);

            _entityLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Font = Ui.Font(18f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                Padding = new Padding(8, 0, 0, 0),
                BackColor = Color.Transparent
            };
            main.Controls.Add(_entityLabel, 0, 0);

            _tabs = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoScroll = true,
                Padding = new Padding(6, 4, 6, 6),
                BackColor = Color.Transparent
            };
            main.Controls.Add(_tabs, 0, 1);

            _content = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                Padding = new Padding(6, 2, 2, 4)
            };
            main.Controls.Add(_content, 0, 2);

            _status = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Ui.Muted,
                Font = Ui.Font(10.5f),
                Padding = new Padding(8, 0, 0, 0),
                BackColor = Color.Transparent
            };
            main.Controls.Add(_status, 0, 3);

            Load += delegate
            {
                RebuildAll();
                ModuleDef startModule = string.IsNullOrEmpty(_startModuleId) ? null : _store.Catalog.Module(_startModuleId);
                if (startModule != null) ShowModuleTab(startModule);
                else ShowHome();

                if (_demo == "modules") ShowModulesDialog();
                else if (_demo == "row") OpenDemoRowDialog();
                else if (_demo == "card") OpenDemoCard();
                else if (_demo == "docx") OpenDemoDocx();
                else if (_demo == "orgs") ShowOrganizations();
                else if (_demo == "templates") ShowTemplates();
                else if (_demo == "norms") ShowNorms();
                else if (_demo == "readiness") ShowReadiness();
                else if (_demo == "preview")
                {
                    var employees = _store.FindTabByModule("employees");
                    if (employees != null)
                    {
                        ShowTab(employees);
                        BeginInvoke((MethodInvoker)delegate { ShowPreview(employees); });
                    }
                }
            };
        }

        private void RebuildAll()
        {
            _entityLabel.Text = J.Str(J.Get(_store.Profile, "shortName"));
            if (_entityLabel.Text.Length == 0) _entityLabel.Text = J.Str(J.Get(_store.Profile, "fullName"));
            RebuildSidebar();
            RebuildTabs();
            UpdateStatus();
        }

        private void RebuildSidebar()
        {
            _sidebar.SuspendLayout();
            _sidebar.Controls.Clear();

            _sidebar.Controls.Add(new Label
            {
                Text = "ОТ-БАЗА",
                Font = Ui.Font(22f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(4, 2, 0, 0)
            });
            _sidebar.Controls.Add(new Label
            {
                Text = "рабочее пространство",
                Font = Ui.Font(11.5f),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(5, 0, 0, 16)
            });

            _sidebar.Controls.Add(SectionLabel("ОБЗОР"));
            _sidebar.Controls.Add(NavButton("Главная", _currentView == "home", delegate { ShowHome(); }));
            _sidebar.Controls.Add(NavButton("Контроль сроков", _currentView == "deadlines", delegate { ShowDeadlines(); }));
            _sidebar.Controls.Add(NavButton("Организации", false, delegate { ShowOrganizations(); }));

            _sidebar.Controls.Add(SectionLabel("ЭТАПЫ"));
            foreach (ModuleDef module in _store.VisibleModules())
            {
                ModuleDef captured = module;
                bool active = _currentView == "tab:" + module.TabId;
                _sidebar.Controls.Add(NavButton(module.Title, active, delegate { ShowModuleTab(captured); }));
            }

            _sidebar.Controls.Add(SectionLabel("СПРАВОЧНИКИ"));
            _sidebar.Controls.Add(NavButton("Нормативная база", _currentView == "norms", delegate { ShowNorms(); }));
            _sidebar.Controls.Add(NavButton("Шаблоны документов", false, delegate { ShowTemplates(); }));
            _sidebar.Controls.Add(NavButton("Готовность к ГИТ", _currentView == "readiness", delegate { ShowReadiness(); }));

            _sidebar.ResumeLayout();

            // Служебные действия — в закреплённой нижней панели: они не уезжают
            // за пределы экрана, когда модулей становится много.
            _sidebarBottom.SuspendLayout();
            _sidebarBottom.Controls.Clear();
            _sidebarBottom.Controls.Add(UtilButton("Модули этапов", delegate { ShowModulesDialog(); }));
            _sidebarBottom.Controls.Add(UtilButton("Папка с данными", delegate
            {
                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + _store.DataRoot + "\""); }
                catch (Exception ex) { MessageBox.Show(ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            }));
            _sidebarBottom.Controls.Add(UtilButton(Ui.Reduced ? "Облегчённый режим" : "Стекло включено", delegate { ToggleEffects(); }));
            _sidebarBottom.ResumeLayout();
        }

        private Control UtilButton(string text, EventHandler onClick)
        {
            var button = new PillButton
            {
                Text = text,
                AlignLeft = true,
                Width = 204,
                Height = 30,
                Margin = new Padding(0, 1, 0, 1)
            };
            button.Click += onClick;
            return button;
        }

        private Label SectionLabel(string text)
        {
            return new Label
            {
                Text = text,
                Font = Ui.Font(10f, FontStyle.Bold),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(8, 10, 0, 4)
            };
        }

        private Control NavButton(string text, bool active, EventHandler onClick)
        {
            var button = new PillButton
            {
                Text = text,
                Primary = active,
                AlignLeft = true,
                Width = 204,
                Height = 34,
                Margin = new Padding(0, 1, 0, 1)
            };
            button.Click += onClick;
            return button;
        }

        private void RebuildTabs()
        {
            _tabs.SuspendLayout();
            _tabs.Controls.Clear();
            _tabs.Controls.Add(TabButton("Главная", _currentView == "home", delegate { ShowHome(); }));
            _tabs.Controls.Add(TabButton("Контроль сроков", _currentView == "deadlines", delegate { ShowDeadlines(); }));

            foreach (object item in _store.Tabs)
            {
                var tab = J.Obj(item);
                if (tab == null) continue;
                string moduleId = J.Str(J.Get(tab, "moduleId"));
                if (moduleId.Length == 0 || !_store.InstalledModules.Contains(moduleId)) continue;
                string tabId = J.Str(J.Get(tab, "id"));
                string name = J.Str(J.Get(tab, "name"));
                string caption = name + "  (" + J.Arr(J.Get(tab, "rows")).Count + ")";
                _tabs.Controls.Add(TabButton(caption, _currentView == "tab:" + tabId, delegate { ShowTabById(tabId); }, tab));
            }
            _tabs.ResumeLayout();
        }

        private Control TabButton(string text, bool active, EventHandler onClick, Dictionary<string, object> tab = null)
        {
            int width = TextRenderer.MeasureText(text, Ui.Font(12.5f, FontStyle.Bold)).Width + 30;
            var button = new PillButton
            {
                Text = text,
                Primary = active,
                Width = Math.Max(90, width),
                Height = 34,
                Radius = 10,
                Margin = new Padding(0, 0, 6, 0)
            };
            button.Click += onClick;
            if (tab != null)
            {
                button.MouseEnter += delegate { ShowPreviewDelayed(tab); };
                button.MouseLeave += delegate { HidePreview(); };
                button.Click += delegate { HidePreview(); };
            }
            return button;
        }

        private void ShowPreviewDelayed(Dictionary<string, object> tab)
        {
            HidePreview();
            if (_previewTimer == null)
            {
                _previewTimer = new System.Windows.Forms.Timer { Interval = 280 };
            }
            _previewTimer.Stop();
            _previewTimer.Tick -= OnPreviewTick;
            _previewTimer.Tag = tab;
            _previewTimer.Tick += OnPreviewTick;
            _previewTimer.Start();
        }

        private void OnPreviewTick(object sender, EventArgs e)
        {
            _previewTimer.Stop();
            var tab = _previewTimer.Tag as Dictionary<string, object>;
            if (tab != null) ShowPreview(tab);
        }

        private void ShowPreview(Dictionary<string, object> tab)
        {
            try
            {
                HidePreview();
                var rows = J.Arr(J.Get(tab, "rows"));
                var columns = J.Arr(J.Get(tab, "columns"));
                string moduleId = J.Str(J.Get(tab, "moduleId"));
                ModuleDef module = _store.Catalog.Module(moduleId);
                string subtitle = module != null ? module.Title : "Этап";

                var lines = new List<string>();
                foreach (object rowObject in rows.Take(3))
                {
                    var row = J.Obj(rowObject);
                    var parts = new List<string>();
                    foreach (object columnObject in columns.Take(2))
                    {
                        var column = J.Obj(columnObject);
                        string value = J.Str(J.Get(row, J.Str(J.Get(column, "id"))));
                        if (value.Length > 0) parts.Add(value);
                    }
                    if (parts.Count > 0) lines.Add("· " + string.Join(" · ", parts.ToArray()));
                }
                if (lines.Count == 0) lines.Add("Пока нет записей");

                string meta = string.Format("{0} записей · {1} столбцов", rows.Count, columns.Count);
                _preview = new TabPreviewForm(J.Str(J.Get(tab, "name")), subtitle, meta, lines);
                _preview.ShowNear(Cursor.Position);
            }
            catch
            {
                // Превью не должно мешать работе.
            }
        }

        private void HidePreview()
        {
            if (_previewTimer != null) _previewTimer.Stop();
            if (_preview != null)
            {
                try { _preview.Close(); } catch { }
                _preview = null;
            }
        }

        private void ToggleEffects()
        {
            Ui.Reduced = !Ui.Reduced;
            _store.Settings["visualEffects"] = Ui.Reduced ? "reduced" : "glass";
            _store.Save();
            RebuildAll();
            if (_currentView == "home") ShowHome();
            else if (_currentView == "deadlines") ShowDeadlines();
            else if (_currentView.StartsWith("tab:"))
            {
                var tab = _store.FindTab(_currentView.Substring(4));
                if (tab != null) ShowTab(tab); else ShowHome();
            }
        }

        private void OpenDemoRowDialog()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees);
            var columns = J.Arr(J.Get(employees, "columns")).Select(J.Obj).Where(c => c != null).ToList();
            using (var dialog = new RowEditorForm(columns, null, "Новая запись"))
            {
                dialog.ShowDialog(this);
            }
        }

        private void OpenDemoCard()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees);
            var rows = J.Arr(J.Get(employees, "rows"));
            if (rows.Count == 0) return;
            var row = J.Obj(rows[0]);
            if (row == null) return;
            string rowId = J.Str(J.Get(row, "id"));
            bool hasObligations = _store.Obligations.Select(J.Obj).Any(o => o != null && J.Str(J.Get(o, "employeeRowId")) == rowId);
            if (!hasObligations) ObligationsEngine.RegisterEvent(_store, row, "hire", ObligationsEngine.TodayIso());
            using (var card = new EmployeeCardForm(_store, row, RebuildAll))
            {
                card.ShowDialog(this);
            }
        }

        private void OpenDemoDocx()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees);
            var rows = J.Arr(J.Get(employees, "rows"));
            if (rows.Count == 0) return;
            var row = J.Obj(rows[0]);
            if (row == null) return;

            string rowId = J.Str(J.Get(row, "id"));
            bool hasObligations = _store.Obligations.Select(J.Obj).Any(o => o != null && J.Str(J.Get(o, "employeeRowId")) == rowId);
            if (!hasObligations) ObligationsEngine.RegisterEvent(_store, row, "hire", ObligationsEngine.TodayIso());

            string path = null;
            foreach (var obligation in _store.Obligations.Select(J.Obj)
                .Where(o => o != null && J.Str(J.Get(o, "employeeRowId")) == rowId && !ObligationsEngine.IsDone(o)))
            {
                if (J.Str(J.Get(obligation, "templateId")).Length == 0) continue;
                path = DocxService.GenerateForObligation(_store, obligation);
                if (path != null) break;
            }
            if (path == null)
            {
                MessageBox.Show("Не удалось сформировать документ по шаблону.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            using (var preview = new DocxPreviewForm(path))
            {
                preview.ShowDialog(this);
            }
        }

        private void SetView(string view)
        {
            _currentView = view;
            RebuildSidebar();
            RebuildTabs();
            UpdateStatus();
        }

        public void ShowHome()
        {
            SetView("home");
            _content.Controls.Clear();
            var view = new HomeView(_store, ShowDeadlines, ShowEmployees);
            view.Dock = DockStyle.Fill;
            _content.Controls.Add(view);
        }

        private void ShowDeadlines()
        {
            SetView("deadlines");
            _content.Controls.Clear();
            var view = new DeadlineView(_store, RebuildAll);
            view.Dock = DockStyle.Fill;
            _content.Controls.Add(view);
        }

        private void ShowEmployees()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees);
        }

        private void ShowTabById(string tabId)
        {
            var tab = _store.FindTab(tabId);
            if (tab != null) ShowTab(tab);
        }

        private void ShowModuleTab(ModuleDef module)
        {
            var tab = _store.FindTabByModule(module.Id);
            if (tab == null) tab = _store.FindTab(module.TabId);
            if (tab != null) ShowTab(tab);
        }

        private void ShowTab(Dictionary<string, object> tab)
        {
            string tabId = J.Str(J.Get(tab, "id"));
            SetView("tab:" + tabId);
            _content.Controls.Clear();
            var view = new TableView(_store, tab, delegate { RebuildAll(); });
            view.Dock = DockStyle.Fill;
            _content.Controls.Add(view);
        }

        private void ShowModulesDialog()
        {
            using (var dialog = new ModulesForm(_store))
            {
                dialog.ShowDialog(this);
            }
            RebuildAll();
            if (_currentView.StartsWith("tab:"))
            {
                var tab = _store.FindTab(_currentView.Substring(4));
                if (tab == null) ShowHome();
                else ShowTab(tab);
            }
        }

        private void ShowNorms()
        {
            SetView("norms");
            _content.Controls.Clear();
            var view = new NormsView(_store);
            view.Dock = DockStyle.Fill;
            _content.Controls.Add(view);
        }

        private void ShowReadiness()
        {
            SetView("readiness");
            _content.Controls.Clear();
            var view = new ReadinessView(_store);
            view.Dock = DockStyle.Fill;
            _content.Controls.Add(view);
        }

        private void ShowTemplates()
        {
            bool changed;
            using (var dialog = new TemplatesForm(_store))
            {
                dialog.ShowDialog(this);
                changed = dialog.Changed;
            }
            if (changed) RebuildAll();
        }

        private void ShowOrganizations()
        {
            bool changed;
            using (var dialog = new OrganizationsForm(_store))
            {
                dialog.ShowDialog(this);
                changed = dialog.Changed;
            }
            if (changed)
            {
                // Организация могла смениться — возвращаемся на «Главную»,
                // чтобы экран не показывал данные прежнего юрлица.
                ShowHome();
            }
        }

        private void UpdateStatus()
        {
            var pending = _store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o))
                .ToList();
            int overdue = pending.Count(o => ObligationsEngine.DaysLeft(o) < 0);
            int totalRows = _store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
            string location;
            if (_store.Portable == null || _store.Portable.IsPortable)
            {
                location = "Портативно: " + _store.DataRoot;
            }
            else
            {
                location = "ВНИМАНИЕ: рядом с программой писать нельзя, данные в " + _store.DataRoot;
            }
            _status.Text = string.Format(
                "Записей: {0}   ·   Активных требований: {1}   ·   Просрочено: {2}   ·   {3}",
                totalRows, pending.Count, overdue, location);
        }
    }

    internal sealed class HomeView : UserControl
    {
        private readonly Store _store;

        public HomeView(Store store, Action openDeadlines, Action openEmployees)
        {
            _store = store;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            var pending = store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o))
                .ToList();
            int totalRows = store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
            int organizations = J.Arr(J.Get(store.Db, "entities")).Count;
            int templates = J.Arr(J.Get(store.Entity, "templates")).Count;

            var grid = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 4,
                RowCount = 3,
                BackColor = Color.Transparent,
                Padding = new Padding(2)
            };
            for (int i = 0; i < 4; i++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
            grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 152));
            grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 152));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(grid);

            var hero = BuildHero(pending, totalRows, organizations, templates, openDeadlines, openEmployees);
            grid.Controls.Add(hero, 0, 0);
            grid.SetColumnSpan(hero, 2);
            grid.SetRowSpan(hero, 2);

            grid.Controls.Add(Card("ПРОСРОЧЕНО", pending.Count(o => ObligationsEngine.DaysLeft(o) < 0).ToString(), "требует внимания", Ui.Rose), 2, 0);
            grid.Controls.Add(Card("СКОРО", pending.Count(o => { int d = ObligationsEngine.DaysLeft(o); return d >= 0 && d <= 7; }).ToString(), "в ближайшие 7 дней", Ui.Amber), 3, 0);
            grid.Controls.Add(Card("ЗАПИСЕЙ В БАЗЕ", totalRows.ToString(), "по всем вкладкам", Ui.Ink), 2, 1);
            grid.Controls.Add(Card("ТРЕБОВАНИЙ", pending.Count.ToString(), "активных сейчас", Ui.Emerald), 3, 1);

            var deadlines = BuildDeadlines(pending);
            grid.Controls.Add(deadlines, 0, 2);
            grid.SetColumnSpan(deadlines, 3);

            grid.Controls.Add(BuildOrganization(totalRows), 3, 2);
        }

        private GlassPanel BuildHero(List<Dictionary<string, object>> pending, int totalRows, int organizations, int templates, Action openDeadlines, Action openEmployees)
        {
            var hero = new GlassPanel
            {
                Dock = DockStyle.Fill,
                Radius = 20,
                FillAlpha = 185,
                Margin = new Padding(0, 0, 12, 12),
                Padding = new Padding(20, 16, 20, 14)
            };

            var body = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                BackColor = Color.Transparent,
                Padding = new Padding(0)
            };
            body.Controls.Add(new Label
            {
                Text = "РАБОЧЕЕ ПРОСТРАНСТВО",
                Font = Ui.Font(10.5f, FontStyle.Bold),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 0, 0, 6)
            });
            body.Controls.Add(new Label
            {
                Text = totalRows.ToString(),
                Font = Ui.Font(54f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 0, 0, 0)
            });
            body.Controls.Add(new Label
            {
                Text = "записей в базе",
                Font = Ui.Font(12.5f),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(1, 0, 0, 10)
            });
            body.Controls.Add(new Label
            {
                Text = string.Format("{0}  ·  {1}  ·  {2}  ·  {3}",
                    Ui.Plural(_store.Tabs.Count, "таблица", "таблицы", "таблиц"),
                    Ui.Plural(organizations, "организация", "организации", "организаций"),
                    Ui.Plural(templates, "шаблон", "шаблона", "шаблонов"),
                    Ui.Plural(pending.Count, "активное требование", "активных требования", "активных требований")),
                Font = Ui.Font(11.5f),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(1, 0, 0, 0)
            });
            hero.Controls.Add(body);

            var actions = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 44,
                FlowDirection = FlowDirection.LeftToRight,
                BackColor = Color.Transparent,
                Padding = new Padding(0, 4, 0, 0)
            };
            var deadlinesButton = new PillButton
            {
                Text = "Контроль сроков",
                Primary = true,
                Width = 172,
                Height = 36,
                Margin = new Padding(0, 0, 8, 0)
            };
            deadlinesButton.Click += delegate { openDeadlines(); };
            actions.Controls.Add(deadlinesButton);

            var employeesButton = new PillButton
            {
                Text = "Сотрудники",
                Width = 132,
                Height = 36
            };
            employeesButton.Click += delegate { openEmployees(); };
            actions.Controls.Add(employeesButton);
            hero.Controls.Add(actions);

            return hero;
        }

        private GlassCard Card(string caption, string value, string hint, Color accent)
        {
            var card = new GlassCard { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 12, 12) };
            card.SetData(caption, value, hint, accent);
            return card;
        }

        private GlassPanel BuildDeadlines(List<Dictionary<string, object>> pending)
        {
            var panel = new GlassPanel
            {
                Dock = DockStyle.Fill,
                Radius = 18,
                FillAlpha = 175,
                Margin = new Padding(0, 0, 12, 0),
                Padding = new Padding(16, 12, 16, 12)
            };

            if (pending.Count == 0)
            {
                panel.Controls.Add(new Label
                {
                    Text = "Активных требований нет. Добавьте работника — требования появятся автоматически.",
                    Dock = DockStyle.Fill,
                    Font = Ui.Font(12f),
                    ForeColor = Ui.Muted,
                    BackColor = Color.Transparent,
                    TextAlign = ContentAlignment.TopLeft,
                    Padding = new Padding(2, 26, 2, 2)
                });
            }
            else
            {
                var list = new ListView
                {
                    Dock = DockStyle.Fill,
                    View = View.Details,
                    FullRowSelect = true,
                    GridLines = false,
                    BorderStyle = BorderStyle.None,
                    BackColor = Color.FromArgb(0xFB, 0xFD, 0xFF),
                    Font = Ui.Font(12f)
                };
                list.Columns.Add("Работник", 220);
                list.Columns.Add("Требование", 330);
                list.Columns.Add("Срок", 100);
                list.Columns.Add("Статус", 170);
                list.Columns.Add("Основание", 200);

                foreach (var obligation in pending.OrderBy(ObligationsEngine.DaysLeft).Take(200))
                {
                    var item = new ListViewItem(ObligationsEngine.EmployeeName(_store, J.Str(J.Get(obligation, "employeeRowId"))));
                    item.SubItems.Add(J.Str(J.Get(obligation, "title")));
                    item.SubItems.Add(ObligationsEngine.DueLabel(obligation));
                    item.SubItems.Add(ObligationsEngine.StatusLabel(obligation));
                    item.SubItems.Add(J.Str(J.Get(obligation, "legalBasis")));
                    if (ObligationsEngine.DaysLeft(obligation) < 0) item.ForeColor = Ui.Rose;
                    list.Items.Add(item);
                }
                panel.Controls.Add(list);
            }

            panel.Controls.Add(new Label
            {
                Text = "Ближайшие и просроченные требования",
                Dock = DockStyle.Top,
                Height = 30,
                Font = Ui.Font(15f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent
            });

            return panel;
        }

        private GlassPanel BuildOrganization(int totalRows)
        {
            var panel = new GlassPanel
            {
                Dock = DockStyle.Fill,
                Radius = 18,
                FillAlpha = 175,
                Padding = new Padding(16, 12, 16, 12)
            };

            var body = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                BackColor = Color.Transparent
            };
            body.Controls.Add(new Label
            {
                Text = "ОРГАНИЗАЦИЯ",
                Font = Ui.Font(10.5f, FontStyle.Bold),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 0, 0, 10)
            });
            body.Controls.Add(new Label
            {
                Text = J.Str(J.Get(_store.Profile, "shortName")),
                Font = Ui.Font(15f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 0, 0, 6)
            });
            body.Controls.Add(new Label
            {
                Text = "ИНН " + J.Str(J.Get(_store.Profile, "inn")) + "  ·  " + totalRows + " записей",
                Font = Ui.Font(11.5f),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 0, 0, 10)
            });
            body.Controls.Add(new Label
            {
                Text = "АКТИВНА",
                Font = Ui.Font(10.5f, FontStyle.Bold),
                ForeColor = Ui.Emerald,
                AutoSize = true,
                BackColor = Color.Transparent
            });
            panel.Controls.Add(body);
            return panel;
        }
    }
}
