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
        private FlowLayoutPanel _tabs;
        private Panel _content;
        private Label _status;
        private Label _entityLabel;
        private string _currentView = "home";
        private string _currentTabId = string.Empty;

        private readonly string _startModuleId;

        public MainForm(Store store, string startModuleId)
        {
            _startModuleId = startModuleId;
            _store = store;

            Text = "ОТ-База — база данных по охране труда";
            WindowState = FormWindowState.Normal;
            Size = new Size(1340, 800);
            MinimumSize = new Size(900, 600);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Canvas;
            Font = Theme.Font(9.75f);
            AutoScaleMode = AutoScaleMode.None;

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                BackColor = Theme.Canvas
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 236));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(root);

            _sidebar = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Theme.Sidebar,
                Padding = new Padding(10, 12, 10, 12)
            };
            root.Controls.Add(_sidebar, 0, 0);

            var main = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 4,
                BackColor = Theme.Canvas
            };
            main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            root.Controls.Add(main, 1, 0);

            var header = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Canvas };
            main.Controls.Add(header, 0, 0);

            _entityLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Font = Theme.Font(13f, FontStyle.Bold),
                ForeColor = Theme.Ink,
                Padding = new Padding(16, 0, 0, 0)
            };
            header.Controls.Add(_entityLabel);

            var tabsPanel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Canvas };
            main.Controls.Add(tabsPanel, 0, 1);

            _tabs = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoScroll = true,
                Padding = new Padding(12, 6, 12, 6)
            };
            tabsPanel.Controls.Add(_tabs);

            _content = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Canvas, Padding = new Padding(12, 4, 12, 8) };
            main.Controls.Add(_content, 0, 2);

            var statusPanel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Sidebar };
            main.Controls.Add(statusPanel, 0, 3);

            _status = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Theme.Muted,
                Font = Theme.Font(8.75f),
                Padding = new Padding(16, 0, 0, 0)
            };
            statusPanel.Controls.Add(_status);

            Load += delegate
            {
                RebuildAll();
                ModuleDef startModule = string.IsNullOrEmpty(_startModuleId) ? null : _store.Catalog.Module(_startModuleId);
                if (startModule != null) ShowModuleTab(startModule);
                else ShowHome();
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
                Font = Theme.Font(13f, FontStyle.Bold),
                ForeColor = Theme.Ink,
                AutoSize = true,
                Margin = new Padding(4, 2, 0, 0)
            });
            _sidebar.Controls.Add(new Label
            {
                Text = "рабочее пространство",
                Font = Theme.Font(8.25f),
                ForeColor = Theme.Muted,
                AutoSize = true,
                Margin = new Padding(4, 0, 0, 12)
            });

            _sidebar.Controls.Add(SectionLabel("ОБЗОР"));
            _sidebar.Controls.Add(NavButton("Главная", _currentView == "home", delegate { ShowHome(); }));
            _sidebar.Controls.Add(NavButton("Контроль сроков", _currentView == "deadlines", delegate { ShowDeadlines(); }));

            _sidebar.Controls.Add(SectionLabel("ЭТАПЫ"));
            foreach (ModuleDef module in _store.VisibleModules())
            {
                ModuleDef captured = module;
                bool active = _currentView == "tab:" + module.TabId;
                _sidebar.Controls.Add(NavButton(module.Title, active, delegate { ShowModuleTab(captured); }));
            }

            _sidebar.Controls.Add(new Panel { Height = 16, Width = 200 });

            _sidebar.Controls.Add(NavButton("Модули этапов", false, delegate { ShowModulesDialog(); }));
            _sidebar.Controls.Add(NavButton("Папка с данными", false, delegate
            {
                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + _store.DataRoot + "\""); }
                catch (Exception ex) { MessageBox.Show(ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            }));

            _sidebar.ResumeLayout();
        }

        private Label SectionLabel(string text)
        {
            return new Label
            {
                Text = text,
                Font = Theme.Font(8f, FontStyle.Bold),
                ForeColor = Theme.Muted,
                AutoSize = true,
                Margin = new Padding(6, 10, 0, 4)
            };
        }

        private Button NavButton(string text, bool active, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                Width = 208,
                Height = 36,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(10, 0, 0, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = active ? Theme.Accent : Theme.Sidebar,
                ForeColor = active ? Theme.AccentInk : Theme.Ink,
                Font = Theme.Font(9.5f, active ? FontStyle.Bold : FontStyle.Regular),
                Cursor = Cursors.Hand,
                Margin = new Padding(0, 1, 0, 1)
            };
            button.FlatAppearance.BorderSize = 0;
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
                _tabs.Controls.Add(TabButton(caption, _currentView == "tab:" + tabId, delegate { ShowTabById(tabId); }));
            }
            _tabs.ResumeLayout();
        }

        private Button TabButton(string text, bool active, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                AutoSize = true,
                Height = 34,
                Padding = new Padding(14, 0, 14, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = active ? Theme.Accent : Theme.Surface,
                ForeColor = active ? Theme.AccentInk : Theme.Ink,
                Font = Theme.Font(9f, active ? FontStyle.Bold : FontStyle.Regular),
                Cursor = Cursors.Hand,
                Margin = new Padding(0, 0, 6, 0)
            };
            button.FlatAppearance.BorderColor = Theme.Line;
            button.FlatAppearance.BorderSize = 1;
            button.Click += onClick;
            return button;
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

        private void UpdateStatus()
        {
            var pending = _store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o))
                .ToList();
            int overdue = pending.Count(o => ObligationsEngine.DaysLeft(o) < 0);
            int totalRows = _store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
            _status.Text = string.Format(
                "Записей: {0}   ·   Активных требований: {1}   ·   Просрочено: {2}   ·   {3}",
                totalRows, pending.Count, overdue, _store.DbPath);
        }
    }

    internal sealed class HomeView : UserControl
    {
        private readonly Store _store;

        public HomeView(Store store, Action openDeadlines, Action openEmployees)
        {
            _store = store;
            BackColor = Theme.Canvas;

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 6,
                BackColor = Theme.Canvas,
                Padding = new Padding(4, 4, 4, 4)
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 112));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(root);

            var title = new Label
            {
                Text = J.Str(J.Get(store.Profile, "shortName")),
                Font = Theme.Font(19f, FontStyle.Bold),
                ForeColor = Theme.Ink,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft
            };
            root.Controls.Add(title, 0, 0);

            var subtitle = new Label
            {
                Text = J.Str(J.Get(store.Profile, "fullName")) + "  ·  ИНН " + J.Str(J.Get(store.Profile, "inn")),
                Font = Theme.Font(9.25f),
                ForeColor = Theme.Muted,
                Dock = DockStyle.Fill,
                AutoEllipsis = true,
                TextAlign = ContentAlignment.MiddleLeft
            };
            root.Controls.Add(subtitle, 0, 1);

            var pending = store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o))
                .ToList();
            int totalRows = store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);

            var cards = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 4,
                RowCount = 1,
                Margin = new Padding(0, 4, 0, 8)
            };
            for (int i = 0; i < 4; i++) cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
            cards.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.Controls.Add(cards, 0, 2);
            cards.Controls.Add(Card("ЗАПИСЕЙ В БАЗЕ", totalRows.ToString(), Theme.Ink, "по всем вкладкам"), 0, 0);
            cards.Controls.Add(Card("ПРОСРОЧЕНО", pending.Count(o => ObligationsEngine.DaysLeft(o) < 0).ToString(), Theme.Danger, "требует внимания"), 1, 0);
            cards.Controls.Add(Card("СКОРО", pending.Count(o => { int d = ObligationsEngine.DaysLeft(o); return d >= 0 && d <= 7; }).ToString(), Theme.Warning, "в ближайшие 7 дней"), 2, 0);
            cards.Controls.Add(Card("АКТИВНЫХ ТРЕБОВАНИЙ", pending.Count.ToString(), Theme.Success, "в работе"), 3, 0);

            var actions = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                Padding = new Padding(0, 6, 0, 6)
            };
            root.Controls.Add(actions, 0, 3);
            actions.Controls.Add(PrimaryButton("Контроль сроков", delegate { openDeadlines(); }));
            actions.Controls.Add(SecondaryButton("Сотрудники", delegate { openEmployees(); }));

            var listTitle = new Label
            {
                Text = "Ближайшие и просроченные требования",
                Font = Theme.Font(11.5f, FontStyle.Bold),
                ForeColor = Theme.Ink,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft
            };
            root.Controls.Add(listTitle, 0, 4);

            if (pending.Count == 0)
            {
                root.Controls.Add(new Label
                {
                    Text = "Активных требований нет. Добавьте работника — требования появятся автоматически.",
                    Font = Theme.Font(9.25f),
                    ForeColor = Theme.Muted,
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.TopLeft
                }, 0, 5);
            }
            else
            {
                var list = new ListView
                {
                    Dock = DockStyle.Fill,
                    View = View.Details,
                    FullRowSelect = true,
                    GridLines = false,
                    BorderStyle = BorderStyle.FixedSingle,
                    BackColor = Theme.Surface,
                    Font = Theme.Font(9.25f)
                };
                list.Columns.Add("Работник", 220);
                list.Columns.Add("Требование", 340);
                list.Columns.Add("Срок", 100);
                list.Columns.Add("Статус", 180);
                list.Columns.Add("Основание", 220);
                foreach (var obligation in pending.OrderBy(ObligationsEngine.DaysLeft).Take(300))
                {
                    var item = new ListViewItem(ObligationsEngine.EmployeeName(_store, J.Str(J.Get(obligation, "employeeRowId"))));
                    item.SubItems.Add(J.Str(J.Get(obligation, "title")));
                    item.SubItems.Add(ObligationsEngine.DueLabel(obligation));
                    item.SubItems.Add(ObligationsEngine.StatusLabel(obligation));
                    item.SubItems.Add(J.Str(J.Get(obligation, "legalBasis")));
                    if (ObligationsEngine.DaysLeft(obligation) < 0) item.ForeColor = Theme.Danger;
                    list.Items.Add(item);
                }
                root.Controls.Add(list, 0, 5);
            }
        }

        private Panel Card(string caption, string value, Color tone, string hint)
        {
            var panel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Theme.Surface,
                Margin = new Padding(0, 0, 10, 0),
                Padding = new Padding(14, 10, 14, 10)
            };
            panel.Paint += delegate(object sender, PaintEventArgs e)
            {
                using (var pen = new Pen(Theme.Line))
                {
                    e.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
                }
            };
            panel.Controls.Add(new Label
            {
                Text = caption,
                Font = Theme.Font(7.75f, FontStyle.Bold),
                ForeColor = Theme.Muted,
                AutoSize = true,
                Location = new Point(16, 12)
            });
            panel.Controls.Add(new Label
            {
                Text = value,
                Font = Theme.Font(24f, FontStyle.Bold),
                ForeColor = tone,
                AutoSize = true,
                Location = new Point(14, 32)
            });
            panel.Controls.Add(new Label
            {
                Text = hint,
                Font = Theme.Font(8.25f),
                ForeColor = Theme.Muted,
                AutoSize = true,
                Location = new Point(16, 80)
            });
            return panel;
        }

        private Button PrimaryButton(string text, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                Height = 34,
                AutoSize = true,
                Padding = new Padding(14, 0, 14, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.Accent,
                ForeColor = Theme.AccentInk,
                Font = Theme.Font(9.25f, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Margin = new Padding(0, 0, 8, 0)
            };
            button.FlatAppearance.BorderSize = 0;
            button.Click += onClick;
            return button;
        }

        private Button SecondaryButton(string text, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                Height = 34,
                AutoSize = true,
                Padding = new Padding(14, 0, 14, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.Surface,
                ForeColor = Theme.Ink,
                Font = Theme.Font(9.25f),
                Cursor = Cursors.Hand
            };
            button.FlatAppearance.BorderColor = Theme.Line;
            button.Click += onClick;
            return button;
        }
    }
}
