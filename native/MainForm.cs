using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>Цвета и шрифты для табличных контролов (совместимость со старыми экранами).</summary>
    internal static class Theme
    {
        public static readonly Color Canvas = Ui.CanvasBottom;
        public static readonly Color Surface = Color.White;
        public static readonly Color Sidebar = Color.FromArgb(0xF8, 0xFA, 0xFC);
        public static readonly Color Line = Ui.Line;
        public static readonly Color Ink = Ui.Ink;
        public static readonly Color Muted = Ui.Muted;
        public static readonly Color Accent = Ui.Accent;
        public static readonly Color AccentInk = Color.White;
        public static readonly Color SoftAccent = Color.FromArgb(0xE0, 0xEA, 0xFF);
        public static readonly Color Danger = Ui.Rose;
        public static readonly Color Warning = Ui.Amber;
        public static readonly Color Success = Ui.Emerald;

        public static Font Font(float size)
        {
            return Font(size, FontStyle.Regular);
        }

        public static Font Font(float size, FontStyle style)
        {
            return new Font("Segoe UI", size, style, GraphicsUnit.Point);
        }
    }

    /// <summary>Что дашборды могут попросить у оболочки.</summary>
    internal interface IDashboardHost
    {
        Store Store { get; }
        void OpenPortfolio();
        void OpenDashboard();
        void OpenDeadlines();
        void OpenTabById(string tabId);
        void OpenOrganizations();
        void OpenSections();
        void OpenTemplates();
        void OpenReadiness();
        void OpenHelp(string topic);
        void OpenEntity(string entityId);
    }

    internal sealed class MainForm : Form, IShell, IDashboardHost
    {
        private readonly Store _store;
        private readonly string _startModuleId;
        private readonly string _demo;

        private TransparentFlow _sidebar;
        private TransparentFlow _sidebarBottom;
        private Panel _content;
        private Control _canvas;
        private Label _status;
        private SheetHost _sheets;
        private ToastHost _toasts;
        private PreviewPopup _preview;
        private Timer _previewTimer;

        private string _currentView = "home";
        private string _currentTabId = string.Empty;
        private readonly List<PillButton> _navButtons = new List<PillButton>();
        private Label _entityNameLabel;
        private Label _entityLinkLabel;
        private readonly ToolTip _tips = new ToolTip { AutoPopDelay = 9000, InitialDelay = 500, ReshowDelay = 200 };

        public Store Store
        {
            get { return _store; }
        }

        public MainForm(Store store, string startModuleId, string demo)
        {
            _store = store;
            _startModuleId = startModuleId;
            _demo = demo;
            Ui.Reduced = J.Str(J.Get(_store.Settings, "visualEffects")) == "reduced";
            Shell.Current = this;

            Text = "ОТ-База — база данных по охране труда";
            WindowState = FormWindowState.Normal;
            // Окно подгоняется под рабочий стол. Раньше здесь был жёсткий минимум
            // высоты 600 px: при масштабе Windows 150 % (логический экран ~485 px)
            // окно уезжало за нижний край. Теперь минимум — 420 px, а раскладка
            // ниже адаптируется и прокручивается вертикально.
            Rectangle work = Screen.PrimaryScreen.WorkingArea;
            int windowWidth = Math.Max(840, Math.Min(1440, work.Width - 24));
            int windowHeight = Math.Max(420, Math.Min(900, work.Height - 48));
            Size = new Size(windowWidth, windowHeight);
            MinimumSize = new Size(Math.Min(860, windowWidth), Math.Min(440, windowHeight));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0xF3, 0xF7, 0xFD);
            Font = Ui.Font(12f);
            AutoScaleMode = AutoScaleMode.None;
            DoubleBuffered = true;
            KeyPreview = true;

            var canvas = new CanvasPanel { Dock = DockStyle.Fill };
            Controls.Add(canvas);
            _canvas = canvas;

            var root = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                BackColor = Color.Transparent,
                Padding = new Padding(10, 10, 20, 10)
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 248));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            canvas.Controls.Add(root);

            var sidebarHost = new GlassPanel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 12, 0) };
            root.Controls.Add(sidebarHost, 0, 0);

            _sidebar = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Color.Transparent,
                Padding = new Padding(9, 12, 9, 10)
            };
            sidebarHost.Controls.Add(_sidebar);

            _sidebarBottom = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 168,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                BackColor = Color.Transparent,
                Padding = new Padding(9, 2, 9, 8)
            };
            sidebarHost.Controls.Add(_sidebarBottom);

            var main = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 2,
                BackColor = Color.Transparent
            };
            main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            main.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            root.Controls.Add(main, 1, 0);

            _content = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                Padding = new Padding(2, 2, 0, 4)
            };
            main.Controls.Add(_content, 0, 0);

            _status = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Ui.Muted,
                Font = Ui.Font(10.5f),
                Padding = new Padding(4, 0, 0, 0),
                BackColor = Color.Transparent,
                AutoEllipsis = true
            };
            main.Controls.Add(_status, 0, 1);

            _preview = new PreviewPopup();
            canvas.Controls.Add(_preview);
            _preview.BringToFront();

            _sheets = new SheetHost();
            canvas.Controls.Add(_sheets);
            _sheets.BringToFront();

            _toasts = new ToastHost { Dock = DockStyle.None, BackColor = Color.Transparent };
            canvas.Controls.Add(_toasts);
            _toasts.BringToFront();

            _sidebar.ClientSizeChanged += delegate { UpdateSidebarWidths(); };
            _sidebar.Layout += delegate
            {
                _sidebar.HorizontalScroll.Maximum = 0;
                _sidebar.HorizontalScroll.Visible = false;
            };
            Resize += delegate { LayoutOverlays(); };
            if (_content != null) _content.Resize += delegate { LayoutOverlays(); };
            KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.F1)
                {
                    e.Handled = true;
                    ShowHelp("start");
                }
                else if (e.KeyCode == Keys.Escape && _sheets.HasSheets)
                {
                    e.Handled = true;
                    _sheets.PopTop();
                }
            };

            Shown += delegate
            {
                // Кнопки — не текстовые поля; при старте не оставляем на них кольцо фокуса.
                try { ActiveControl = null; } catch { }
            };

            Load += delegate
            {
                RebuildChrome();
                ModuleDef startModule = string.IsNullOrEmpty(_startModuleId) ? null : _store.Catalog.Module(_startModuleId);
                if (startModule != null) ShowModuleTab(startModule);
                else ShowDashboard(false);

                LayoutOverlays();
                RunDemo();
            };
        }

        private void LayoutOverlays()
        {
            if (_toasts == null) return;
            int width = Math.Min(470, Math.Max(280, Width / 3));
            _toasts.SetBounds(Math.Max(0, Width - width - 18), Math.Max(40, Height - 240), width, 224);
            if (_sheets == null || _canvas == null || _content == null) return;
            try
            {
                // Листы центрируются по рабочей области, а не по всему окну:
                // иначе на 1366/1000 px карточка накрывает навигацию.
                Rectangle contentScreen = _content.RectangleToScreen(_content.ClientRectangle);
                Rectangle canvasScreen = _canvas.RectangleToScreen(_canvas.ClientRectangle);
                _sheets.CardArea = new Rectangle(
                    Math.Max(0, contentScreen.X - canvasScreen.X),
                    Math.Max(0, contentScreen.Y - canvasScreen.Y),
                    Math.Max(200, contentScreen.Width),
                    Math.Max(200, contentScreen.Height));
            }
            catch
            {
                _sheets.CardArea = Rectangle.Empty;
            }
        }

        private void RunDemo()
        {
            if (string.IsNullOrEmpty(_demo)) return;
            switch (_demo)
            {
                case "modules":
                case "sections":
                    OpenSections();
                    break;
                case "orgs":
                case "organizations":
                    OpenOrganizations();
                    break;
                case "templates":
                    OpenTemplates();
                    break;
                case "norms":
                    ShowNorms();
                    break;
                case "readiness":
                    ShowReadiness();
                    break;
                case "help":
                    ShowHelp("start");
                    break;
                case "portfolio":
                    OpenPortfolio();
                    break;
                case "deadlines":
                    OpenDeadlines();
                    break;
                case "row":
                    OpenDemoRowDialog();
                    break;
                case "card":
                    OpenDemoCard();
                    break;
                case "docx":
                    OpenDemoDocx();
                    break;
                case "reduced":
                    if (!Ui.Reduced) ToggleEffects();
                    break;
                case "anim":
                    {
                        // Замедленный переход — для фиксации кадров анимации.
                        Anim.Normal = 900;
                        Anim.Fast = 420;
                        var timer = new Timer { Interval = 700 };
                        timer.Tick += delegate { timer.Stop(); timer.Dispose(); OpenPortfolio(); };
                        timer.Start();
                    }
                    break;
                case "twoactive":
                    {
                        if (_store.Entities.Count < 2)
                        {
                            _store.CreateOrganization("ООО «Вторая площадка»", "Общество с ограниченной ответственностью «Вторая площадка»");
                        }
                        var second = _store.Entities.FirstOrDefault(e => J.Str(J.Get(J.Obj(J.Get(e, "profile")), "shortName")) == "ООО «Вторая площадка»");
                        if (second != null)
                        {
                            _store.SetActiveEntity(J.Str(J.Get(second, "id")));
                            _store.Save();
                        }
                        RebuildChrome();
                        ShowDashboard(false);
                    }
                    break;
                case "two":
                    {
                        if (_store.Entities.Count < 2)
                        {
                            var created = _store.CreateOrganization("ООО «Вторая площадка»", "Общество с ограниченной ответственностью «Вторая площадка»");
                            string previous = _store.ActiveEntityId;
                            string createdId = J.Str(J.Get(created, "id"));
                            _store.SetActiveEntity(createdId);
                            _store.EnsureModuleTabs(_store.Entity);
                            var employeesTab = _store.FindTabByModule("employees");
                            if (employeesTab != null)
                            {
                                var rows = J.Arr(J.Get(employeesTab, "rows"));
                                var row = new Dictionary<string, object>();
                                row["id"] = "row_demo_two_1";
                                row["emp_fio"] = "Петров Пётр Петрович";
                                row["emp_position"] = "Слесарь-ремонтник";
                                row["emp_hire_date"] = ObligationsEngine.TodayIso();
                                rows.Add(row);
                                J.Put(employeesTab, "rows", rows.ToArray());
                                ObligationsEngine.RegisterEvent(_store, row, "hire", ObligationsEngine.TodayIso());
                            }
                            _store.Save();
                            _store.SetActiveEntity(previous);
                            RebuildChrome();
                        }
                        ShowPortfolio(false);
                    }
                    break;
                case "toast":
                    Notify("Пример уведомления: изменения сохранены.", NoticeKind.Success);
                    BeginInvoke((MethodInvoker)delegate
                    {
                        var timer = new Timer { Interval = 500 };
                        timer.Tick += delegate
                        {
                            timer.Stop();
                            timer.Dispose();
                            Confirm("Удалить запись?", "Пример подтверждения внутри окна: действие необратимо, данные будут удалены.", "Удалить", delegate { Notify("Удалено (демонстрация).", NoticeKind.Info); });
                        };
                        timer.Start();
                    });
                    break;
                case "empty":
                    {
                        string id = _store.CreateCustomModule("Демо-раздел", "Инструктаж, Дата, Ответственный");
                        _store.Save();
                        RebuildChrome();
                        var emptyTab = _store.FindTabByModule(id);
                        if (emptyTab != null) ShowTab(emptyTab, true);
                    }
                    break;
                case "table":
                    {
                        var employeesTab = _store.FindTabByModule("employees");
                        if (employeesTab != null) ShowTab(employeesTab, true);
                    }
                    break;
                case "preview":
                    {
                        var employees = _store.FindTabByModule("employees");
                        if (employees != null)
                        {
                            PillButton anchor = _navButtons.FirstOrDefault(b => b.Tag is Dictionary<string, object> && ((Dictionary<string, object>)b.Tag) == employees);
                            if (anchor != null) BeginInvoke((MethodInvoker)delegate { ShowPreview(employees, anchor); });
                        }
                    }
                    break;
            }
        }

        // -----------------------------------------------------------------
        //  Оболочка: сайдбар, статус, обновление
        // -----------------------------------------------------------------

        private void RebuildChrome()
        {
            RebuildSidebar();
            RebuildStatus();
            WireTooltips();
        }

        private void WireTooltips()
        {
            foreach (PillButton button in _navButtons)
            {
                if (button.IsDisposed) continue;
                if (!string.IsNullOrEmpty(button.Hint)) _tips.SetToolTip(button, button.Hint);
            }
            if (_entityLinkLabel != null && !_entityLinkLabel.IsDisposed)
            {
                _tips.SetToolTip(_entityLinkLabel, "Все юрлица базы: витрина и переключение");
            }
        }

        private int SidebarInnerWidth
        {
            get
            {
                int width = _sidebar.ClientSize.Width - _sidebar.Padding.Horizontal - 6;
                return Math.Max(120, width);
            }
        }

        private void UpdateSidebarWidths()
        {
            int width = SidebarInnerWidth;
            foreach (PillButton button in _navButtons)
            {
                if (!button.IsDisposed) button.Width = width;
            }
            if (_entityLinkLabel != null && !_entityLinkLabel.IsDisposed)
            {
                int inner = Math.Max(60, width - 8);
                _entityLinkLabel.Width = inner;
                if (_entityNameLabel != null && !_entityNameLabel.IsDisposed) _entityNameLabel.Width = inner;
            }
        }

        private void RebuildSidebar()
        {
            _sidebar.SuspendLayout();
            _sidebar.Controls.Clear();
            _navButtons.Clear();

            _sidebar.Controls.Add(new Label
            {
                Text = "ОТ-БАЗА",
                Font = Ui.Font(21f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(5, 0, 0, 0)
            });
            _sidebar.Controls.Add(new Label
            {
                Text = "рабочее пространство",
                Font = Ui.Font(11f),
                ForeColor = Ui.Muted,
                AutoSize = true,
                BackColor = Color.Transparent,
                Margin = new Padding(6, 0, 0, 10)
            });

            _sidebar.Controls.Add(SectionLabel("ТЕКУЩЕЕ ЮРЛИЦО"));
            string shortName = J.Str(J.Get(_store.Profile, "shortName"));
            if (shortName.Length == 0) shortName = J.Str(J.Get(_store.Profile, "fullName"));
            if (shortName.Length == 0) shortName = "Организация";
            var entityBlock = new TransparentFlow
            {
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Width = SidebarInnerWidth,
                Height = 46,
                Margin = new Padding(0, 0, 0, 2),
                BackColor = Color.Transparent
            };
            _entityNameLabel = new Label
            {
                Text = shortName,
                Font = Ui.Font(13f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                AutoSize = false,
                Width = Math.Max(60, SidebarInnerWidth - 8),
                Height = 22,
                Margin = new Padding(4, 0, 0, 0),
                AutoEllipsis = true
            };
            _entityLinkLabel = new Label
            {
                Text = "Переключить юрлицо →",
                Font = Ui.Font(10.5f),
                ForeColor = Ui.Blue,
                BackColor = Color.Transparent,
                AutoSize = false,
                Width = Math.Max(60, SidebarInnerWidth - 8),
                Height = 17,
                Margin = new Padding(5, 0, 0, 0),
                Cursor = Cursors.Hand
            };
            _entityLinkLabel.Click += delegate { OpenPortfolio(); };
            entityBlock.Controls.Add(_entityNameLabel);
            entityBlock.Controls.Add(_entityLinkLabel);
            _sidebar.Controls.Add(entityBlock);

            _sidebar.Controls.Add(SectionLabel("ОБЗОР"));
            _sidebar.Controls.Add(NavButton("Главная (юрлицо)", _currentView == "home", delegate { ShowDashboard(true); },
                "Виджеты текущего юрлица: сроки, сотрудники, разделы"));
            _sidebar.Controls.Add(NavButton("Все организации", _currentView == "portfolio", delegate { OpenPortfolio(); },
                "Витрина всех юрлиц с показателями"));
            _sidebar.Controls.Add(NavButton("Контроль сроков", _currentView == "deadlines", delegate { OpenDeadlines(); },
                "Все требования и сроки текущего юрлица"));

            _sidebar.Controls.Add(SectionLabel("РАЗДЕЛЫ И ЭТАПЫ"));
            foreach (ModuleDef module in _store.VisibleModules())
            {
                ModuleDef captured = module;
                var tab = _store.FindTabByModule(module.Id) ?? _store.FindTab(module.TabId);
                string caption = module.Title;
                PillButton button = NavButton(caption, _currentView == "tab:" + (tab != null ? J.Str(J.Get(tab, "id")) : module.TabId),
                    delegate { ShowModuleTab(captured); },
                    "Этап: таблица «" + module.TabName + "»");
                if (tab != null) AttachPreview(button, tab);
                _sidebar.Controls.Add(button);
            }
            var add = new PillButton
            {
                Text = "＋  Новый раздел",
                AlignLeft = true,
                Width = SidebarInnerWidth,
                Height = 32,
                Margin = new Padding(0, 4, 0, 2),
                AccentColor = Ui.Blue,
                Hint = "Создать свой раздел с колонками (этап)"
            };
            add.Click += delegate { OpenSections(); };
            _sidebar.Controls.Add(add);
            _navButtons.Add(add);

            _sidebar.Controls.Add(SectionLabel("СПРАВОЧНИКИ"));
            _sidebar.Controls.Add(NavButton("Нормативная база", _currentView == "norms", delegate { ShowNorms(); },
                "18 требований охраны труда с основаниями"));
            _sidebar.Controls.Add(NavButton("Шаблоны документов", false, delegate { OpenTemplates(); },
                "Встроенные и свои шаблоны, редактор тегов"));
            _sidebar.Controls.Add(NavButton("Готовность к ГИТ", _currentView == "readiness", delegate { ShowReadiness(); },
                "Проверка базы по 9 направлениям"));

            _sidebar.ResumeLayout();
            RebuildSidebarBottom();
            UpdateSidebarWidths();
        }

        private void RebuildSidebarBottom()
        {
            _sidebarBottom.SuspendLayout();
            _sidebarBottom.Controls.Clear();
            _sidebarBottom.Controls.Add(UtilButton("Организации", delegate { OpenOrganizations(); },
                "Реквизиты, создание и переключение юрлиц"));
            _sidebarBottom.Controls.Add(UtilButton("Разделы и этапы", delegate { OpenSections(); },
                "Включение этапов и создание своих разделов"));
            _sidebarBottom.Controls.Add(UtilButton("Справка (F1)", delegate { ShowHelp("start"); },
                "Как работать: импорт, шаблоны, сроки, данные"));
            _sidebarBottom.Controls.Add(UtilButton("Папка с данными", delegate
            {
                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + _store.DataRoot + "\""); }
                catch (Exception ex) { Notify("Не удалось открыть папку: " + ex.Message, NoticeKind.Danger); }
            }, "Открыть папку, где лежат база, документы и резервные копии"));
            _sidebarBottom.Controls.Add(UtilButton(
                Ui.Reduced ? "Эффекты: облегчённые" : "Эффекты: стекло",
                delegate { ToggleEffects(); },
                "Переключить прозрачность и плавность"));
            _sidebarBottom.ResumeLayout();
        }

        private PillButton UtilButton(string text, EventHandler onClick, string hint)
        {
            var button = new PillButton
            {
                Text = text,
                AlignLeft = true,
                Width = SidebarInnerWidth,
                Height = 27,
                Margin = new Padding(0, 1, 0, 1),
                Hint = hint
            };
            button.Click += onClick;
            _navButtons.Add(button);
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
                Margin = new Padding(7, 12, 0, 4)
            };
        }

        private PillButton NavButton(string text, bool active, EventHandler onClick, string hint)
        {
            var button = new PillButton
            {
                Text = text,
                Primary = active,
                AlignLeft = true,
                Width = SidebarInnerWidth,
                Height = 33,
                Margin = new Padding(0, 1, 0, 1),
                Hint = hint
            };
            button.Click += onClick;
            _navButtons.Add(button);
            return button;
        }

        private void AttachPreview(PillButton button, Dictionary<string, object> tab)
        {
            button.Tag = tab;
            button.MouseEnter += delegate { ShowPreviewDelayed(tab, button); };
            button.MouseLeave += delegate { HidePreview(); };
        }

        private void ShowPreviewDelayed(Dictionary<string, object> tab, PillButton anchor)
        {
            HidePreview();
            if (_previewTimer == null) _previewTimer = new Timer { Interval = 300 };
            _previewTimer.Stop();
            _previewTimer.Tick -= OnPreviewTick;
            _previewTimer.Tag = new object[] { tab, anchor };
            _previewTimer.Tick += OnPreviewTick;
            _previewTimer.Start();
        }

        private void OnPreviewTick(object sender, EventArgs e)
        {
            _previewTimer.Stop();
            var payload = _previewTimer.Tag as object[];
            if (payload == null) return;
            ShowPreview(payload[0] as Dictionary<string, object>, payload[1] as PillButton);
        }

        private void ShowPreview(Dictionary<string, object> tab, PillButton anchor)
        {
            if (tab == null || anchor == null || anchor.IsDisposed) return;
            try
            {
                var rows = J.Arr(J.Get(tab, "rows"));
                var columns = J.Arr(J.Get(tab, "columns"));
                string moduleId = J.Str(J.Get(tab, "moduleId"));
                ModuleDef module = _store.Catalog.Module(moduleId);
                string subtitle = module != null ? module.Title : "Раздел";
                var lines = new List<string>();
                foreach (object rowObject in rows.Take(3))
                {
                    var row = J.Obj(rowObject);
                    if (row == null) continue;
                    var parts = new List<string>();
                    foreach (object columnObject in columns.Take(2))
                    {
                        var column = J.Obj(columnObject);
                        if (column == null) continue;
                        string value = J.Str(J.Get(row, J.Str(J.Get(column, "id"))));
                        if (value.Length > 0) parts.Add(value);
                    }
                    if (parts.Count > 0) lines.Add("· " + string.Join(" · ", parts.ToArray()));
                }
                if (lines.Count == 0) lines.Add("Пока нет записей — добавьте или импортируйте");
                string meta = string.Format("{0} записей · {1} столбцов",
                    Ui.Plural(rows.Count, "запись", "записи", "записей"), columns.Count);
                _preview.SetData(J.Str(J.Get(tab, "name")), subtitle, meta, lines);
                _preview.ShowNear(anchor, _preview.Parent != null ? _preview.Parent.Width : Width,
                    _preview.Parent != null ? _preview.Parent.Height : Height);
            }
            catch
            {
                // Превью не должно мешать работе.
            }
        }

        private void HidePreview()
        {
            if (_previewTimer != null) _previewTimer.Stop();
            if (_preview != null) _preview.Visible = false;
        }

        private void RebuildStatus()
        {
            var pending = _store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o))
                .ToList();
            int overdue = pending.Count(o => ObligationsEngine.DaysLeft(o) < 0);
            int totalRows = _store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
            string location = (_store.Portable == null || _store.Portable.IsPortable)
                ? "данные рядом с программой"
                : "ВНИМАНИЕ: запись рядом с программой запрещена — данные в " + _store.DataRoot;
            _status.Text = string.Format(
                "Записей: {0}   ·   Активных требований: {1}   ·   Просрочено: {2}   ·   {3}",
                totalRows, pending.Count, overdue, location);
            var tip = new ToolTip();
            tip.SetToolTip(_status, _store.DataRoot);
        }

        private void ToggleEffects()
        {
            Ui.Reduced = !Ui.Reduced;
            _store.Settings["visualEffects"] = Ui.Reduced ? "reduced" : "glass";
            _store.Save();
            RebuildChrome();
            ReloadCurrentPage();
        }

        private void ReloadCurrentPage()
        {
            if (_currentView == "home") ShowDashboard(false);
            else if (_currentView == "portfolio") ShowPortfolio(false);
            else if (_currentView == "deadlines") ShowDeadlines(false);
            else if (_currentView == "norms") ShowNorms(false);
            else if (_currentView == "readiness") ShowReadiness(false);
            else if (_currentView.StartsWith("tab:"))
            {
                var tab = _store.FindTab(_currentView.Substring(4));
                if (tab != null) ShowTab(tab, false);
                else ShowDashboard(false);
            }
        }

        // -----------------------------------------------------------------
        //  Навигация (всё внутри одного окна)
        // -----------------------------------------------------------------

        private void SetContent(Control page, bool animate)
        {
            if (animate) Anim.Swap(_content, page);
            else
            {
                _content.SuspendLayout();
                _content.Controls.Clear();
                _content.Controls.Add(page);
                _content.ResumeLayout();
            }
        }

        private void MarkView(string view)
        {
            _currentView = view;
            RebuildSidebar();
            RebuildStatus();
        }

        private void ShowDashboard(bool animate)
        {
            HidePreview();
            MarkView("home");
            var view = new EntityDashboardView(this) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        private void ShowPortfolio(bool animate)
        {
            HidePreview();
            MarkView("portfolio");
            var view = new PortfolioView(this) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        public void OpenDashboard()
        {
            ShowDashboard(true);
        }

        public void OpenPortfolio()
        {
            ShowPortfolio(true);
        }

        private void ShowDeadlines()
        {
            ShowDeadlines(true);
        }

        private void ShowDeadlines(bool animate)
        {
            HidePreview();
            MarkView("deadlines");
            var view = new DeadlineView(_store, delegate { RebuildStatus(); }) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        public void OpenDeadlines()
        {
            ShowDeadlines(true);
        }

        public void OpenOrganizations()
        {
            HidePreview();
            string before = _store.ActiveEntityId;
            var form = new OrganizationsForm(_store);
            ShowSheet(form, delegate
            {
                bool changed = form.Changed;
                string after = _store.ActiveEntityId;
                if (after != before || changed)
                {
                    RebuildChrome();
                    if (after != before)
                    {
                        ShowDashboard(true);
                        Notify("Открыто юрлицо: " + EntityName(after), NoticeKind.Success);
                    }
                    else if (_currentView == "home") ShowDashboard(false);
                }
            });
        }

        public void OpenSections()
        {
            HidePreview();
            var form = new ModulesForm(_store);
            ShowSheet(form, delegate
            {
                RebuildChrome();
                bool currentStillVisible = true;
                if (_currentView.StartsWith("tab:"))
                {
                    var tab = _store.FindTab(_currentView.Substring(4));
                    currentStillVisible = tab != null && _store.Tabs.Any(t => J.Str(J.Get(J.Obj(t), "id")) == J.Str(J.Get(tab, "id")));
                }
                if (!currentStillVisible) ShowDashboard(false);
                else ReloadCurrentPage();
            });
        }

        public void OpenTemplates()
        {
            HidePreview();
            var form = new TemplatesForm(_store);
            ShowSheet(form, delegate
            {
                if (form.Changed)
                {
                    RebuildChrome();
                    ReloadCurrentPage();
                }
            });
        }

        public void OpenReadiness()
        {
            ShowReadiness(true);
        }

        private void ShowReadiness()
        {
            ShowReadiness(true);
        }

        private void ShowReadiness(bool animate)
        {
            HidePreview();
            MarkView("readiness");
            var view = new ReadinessView(_store) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        private void ShowNorms()
        {
            ShowNorms(true);
        }

        private void ShowNorms(bool animate)
        {
            HidePreview();
            MarkView("norms");
            var view = new NormsView(_store) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        public void OpenTabById(string tabId)
        {
            var tab = _store.FindTab(tabId);
            if (tab != null) ShowTab(tab, true);
        }

        public void OpenTab(string tabId)
        {
            OpenTabById(tabId);
        }

        public void OpenHelp(string topic)
        {
            ShowHelp(topic);
        }

        private void ShowModuleTab(ModuleDef module)
        {
            var tab = _store.FindTabByModule(module.Id) ?? _store.FindTab(module.TabId);
            if (tab != null) ShowTab(tab, true);
        }

        private void ShowTab(Dictionary<string, object> tab, bool animate)
        {
            HidePreview();
            string tabId = J.Str(J.Get(tab, "id"));
            _currentTabId = tabId;
            MarkView("tab:" + tabId);
            var view = new TableView(_store, tab, delegate { RefreshData(); }) { Dock = DockStyle.Fill };
            SetContent(view, animate);
        }

        public void OpenEntity(string entityId)
        {
            try
            {
                _store.SetActiveEntity(entityId);
                RebuildChrome();
                ShowDashboard(true);
                Notify("Открыто юрлицо: " + EntityName(entityId), NoticeKind.Success);
            }
            catch (Exception ex)
            {
                Notify("Не удалось открыть юрлицо: " + ex.Message, NoticeKind.Danger);
            }
        }

        private string EntityName(string entityId)
        {
            var entity = _store.FindEntity(entityId);
            if (entity == null) return entityId;
            var profile = J.Obj(J.Get(entity, "profile"));
            string name = J.Str(J.Get(profile, "shortName"));
            if (name.Length == 0) name = J.Str(J.Get(profile, "fullName"));
            return name.Length > 0 ? name : entityId;
        }

        // -----------------------------------------------------------------
        //  IShell: листы, уведомления, подтверждения, справка
        // -----------------------------------------------------------------

        public void ShowSheet(GlassForm form, Action onClosed)
        {
            HidePreview();
            _sheets.Push(form, onClosed);
            LayoutOverlays();
        }

        public void CloseTopSheet()
        {
            _sheets.PopTop();
        }

        public bool HasSheet
        {
            get { return _sheets.HasSheets; }
        }

        public void Notify(string message, NoticeKind kind)
        {
            _toasts.Show(message, kind);
            _toasts.BringToFront();
        }

        public void Confirm(string title, string message, string confirmText, Action onYes)
        {
            var form = new ConfirmForm(title, message, confirmText, true);
            ShowSheet(form, delegate
            {
                if (form.Confirmed && onYes != null) onYes();
            });
        }

        public void RefreshData()
        {
            RebuildChrome();
            if (_currentView == "home") ShowDashboard(false);
            else if (_currentView == "portfolio") ShowPortfolio(false);
        }

        public void ShowHelp(string topic)
        {
            ShowSheet(new HelpForm(topic), null);
        }

        // -----------------------------------------------------------------
        //  Демо-режимы (для снимков экрана и проверок)
        // -----------------------------------------------------------------

        private void OpenDemoRowDialog()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees, true);
            var columns = J.Arr(J.Get(employees, "columns")).Select(J.Obj).Where(c => c != null).ToList();
            ShowSheet(new RowEditorForm(columns, null, "Новая запись"), null);
        }

        private void OpenDemoCard()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees, true);
            var rows = J.Arr(J.Get(employees, "rows"));
            if (rows.Count == 0) return;
            var row = J.Obj(rows[0]);
            if (row == null) return;
            string rowId = J.Str(J.Get(row, "id"));
            bool hasObligations = _store.Obligations.Select(J.Obj).Any(o => o != null && J.Str(J.Get(o, "employeeRowId")) == rowId);
            if (!hasObligations) ObligationsEngine.RegisterEvent(_store, row, "hire", ObligationsEngine.TodayIso());
            ShowSheet(new EmployeeCardForm(_store, row, delegate { RefreshData(); }), null);
        }

        private void OpenDemoDocx()
        {
            var employees = _store.FindTabByModule("employees");
            if (employees == null) return;
            ShowTab(employees, true);
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
                Notify("Не удалось сформировать документ по шаблону.", NoticeKind.Warning);
                return;
            }
            ShowSheet(new DocxPreviewForm(path), null);
        }
    }

    // =====================================================================
    //  Статистика по организациям — без переключения активного юрлица.
    // =====================================================================

    internal sealed class EntityStats
    {
        public string Id = string.Empty;
        public string ShortName = string.Empty;
        public string FullName = string.Empty;
        public string Inn = string.Empty;
        public int Records;
        public int Employees;
        public int Overdue;
        public int Soon;
        public int Documents;
        public int Templates;
        public bool Active;

        public static List<EntityStats> Collect(Store store)
        {
            var result = new List<EntityStats>();
            string activeId = store.ActiveEntityId;
            foreach (var entity in store.Entities)
            {
                var profile = J.Obj(J.Get(entity, "profile")) ?? new Dictionary<string, object>();
                var stats = new EntityStats
                {
                    Id = J.Str(J.Get(entity, "id")),
                    ShortName = J.Str(J.Get(profile, "shortName")),
                    FullName = J.Str(J.Get(profile, "fullName")),
                    Inn = J.Str(J.Get(profile, "inn")),
                    Active = J.Str(J.Get(entity, "id")) == activeId
                };
                if (stats.ShortName.Length == 0) stats.ShortName = stats.FullName;
                if (stats.ShortName.Length == 0) stats.ShortName = "Без названия";
                stats.Templates = J.Arr(J.Get(entity, "templates")).Count;
                stats.Documents = J.Arr(J.Get(entity, "generatedDocs")).Count;
                foreach (object tabObject in J.Arr(J.Get(entity, "tabs")))
                {
                    var tab = J.Obj(tabObject);
                    if (tab == null) continue;
                    int rows = J.Arr(J.Get(tab, "rows")).Count;
                    stats.Records += rows;
                    if (J.Str(J.Get(tab, "moduleId")) == "employees") stats.Employees += rows;
                }
                foreach (object obligationObject in J.Arr(J.Get(entity, "employeeObligations")))
                {
                    var obligation = J.Obj(obligationObject);
                    if (obligation == null || ObligationsEngine.IsDone(obligation)) continue;
                    int days = ObligationsEngine.DaysLeft(obligation);
                    if (days < 0) stats.Overdue++;
                    else if (days <= 7) stats.Soon++;
                }
                result.Add(stats);
            }
            return result;
        }
    }

    // =====================================================================
    //  Экран 1 — дашборд текущего юрлица.
    // =====================================================================

    internal sealed class EntityDashboardView : UserControl
    {
        private readonly IDashboardHost _host;

        public EntityDashboardView(IDashboardHost host)
        {
            _host = host;
            BackColor = Color.Transparent;
            DoubleBuffered = true;
            Store store = host.Store;

            var scroll = new VerticalScroll { Dock = DockStyle.Fill };
            Controls.Add(scroll);
            var grid = new BentoGrid
            {
                Dock = DockStyle.Top,
                AutoHeight = true,
                MinTileWidth = 236,
                RowHeight = 128,
                MaxColumns = 4,
                BackColor = Color.Transparent
            };
            scroll.Controls.Add(grid);

            var pending = store.Obligations.Select(J.Obj)
                .Where(o => o != null && !ObligationsEngine.IsDone(o)).ToList();
            int overdue = pending.Count(o => ObligationsEngine.DaysLeft(o) < 0);
            int soon = pending.Count(o => { int days = ObligationsEngine.DaysLeft(o); return days >= 0 && days <= 7; });
            int totalRows = store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
            var employeesTab = store.FindTabByModule("employees");
            int employees = employeesTab != null ? J.Arr(J.Get(employeesTab, "rows")).Count : 0;
            int documents = J.Arr(J.Get(store.Entity, "generatedDocs")).Count;
            int templates = J.Arr(J.Get(store.Entity, "templates")).Count;

            var header = new PageHeader();
            header.SetData(
                J.Str(J.Get(store.Profile, "shortName")).Length > 0
                    ? J.Str(J.Get(store.Profile, "shortName"))
                    : J.Str(J.Get(store.Profile, "fullName")),
                BuildSubtitle(store));
            var portfolioButton = new PillButton { Text = "Все организации", Width = 148, Height = 34, Hint = "Витрина всех юрлиц" };
            portfolioButton.Click += delegate { _host.OpenPortfolio(); };
            header.AddAction(portfolioButton);
            var helpButton = new PillButton { Text = "?", Width = 38, Height = 34, Hint = "Справка по программе (F1)" };
            helpButton.Click += delegate { _host.OpenHelp("start"); };
            header.AddAction(helpButton);
            grid.AddFullRow(header, 64);

            if (totalRows == 0)
            {
                var start = new HintBar();
                start.SetData("С чего начать",
                    "1) Проверьте реквизиты в «Организациях».  2) Добавьте работников во вкладке «Список работников» (или импортируйте Excel).  " +
                    "3) Программа сама создаст требования по приёму — они появятся в «Контроле сроков».  4) Документы формируются по шаблонам.",
                    Ui.Blue);
                start.Appear();
                grid.AddFullRow(start, start.MeasureHeight(640));
            }

            var overdueTile = new KpiTile();
            overdueTile.SetData("ПРОСРОЧЕНО", overdue.ToString(),
                overdue > 0 ? "требует внимания сейчас" : "всё в порядке", overdue > 0 ? Ui.Rose : Ui.Emerald);
            overdueTile.SetClickable();
            overdueTile.Click += delegate { _host.OpenDeadlines(); };
            grid.AddTile(overdueTile, 1, 128);

            var soonTile = new KpiTile();
            soonTile.SetData("СРОКИ СКОРО", soon.ToString(), "в ближайшие 7 дней", soon > 0 ? Ui.Amber : Ui.Emerald);
            soonTile.SetClickable();
            soonTile.Click += delegate { _host.OpenDeadlines(); };
            grid.AddTile(soonTile, 1, 128);

            var employeesTile = new KpiTile();
            employeesTile.SetData("РАБОТНИКОВ", employees.ToString(), "в списке работников", Ui.Blue);
            employeesTile.SetClickable();
            employeesTile.Click += delegate
            {
                var tab = _host.Store.FindTabByModule("employees");
                if (tab != null) _host.OpenTabById(J.Str(J.Get(tab, "id")));
            };
            grid.AddTile(employeesTile, 1, 128);

            var recordsTile = new KpiTile();
            recordsTile.SetData("ЗАПИСЕЙ В БАЗЕ", totalRows.ToString(),
                Ui.Plural(store.Tabs.Count, "раздел", "раздела", "разделов") + " · " +
                Ui.Plural(templates, "шаблон", "шаблона", "шаблонов"), Ui.Ink);
            recordsTile.SetClickable();
            recordsTile.Click += delegate { _host.OpenSections(); };
            grid.AddTile(recordsTile, 1, 128);

            var deadlinesWidget = new DeadlineListWidget();
            deadlinesWidget.SetData(store, pending, "Активных требований нет. Добавьте работника — требования появятся автоматически.");
            deadlinesWidget.Open += delegate { _host.OpenDeadlines(); };
            grid.AddTile(deadlinesWidget, 2, 238);

            var gauge = new GaugeTile();
            try
            {
                ReadinessReport report = GitReadiness.Evaluate(store);
                Color accent = report.Percent >= 75 ? Ui.Emerald : report.Percent >= 50 ? Ui.Amber : Ui.Rose;
                string level = char.ToUpperInvariant(report.LevelLabel[0]) + report.LevelLabel.Substring(1);
                gauge.SetData(report.Percent, level,
                    "Самопроверка по " + Ui.Plural(report.Items.Count, "направлению", "направлениям", "направлениям") +
                    " ГИТ. Баллы показывают, каких документов не хватает.", accent);
            }
            catch
            {
                gauge.SetData(0, "Оценка недоступна", "Откройте раздел «Готовность к ГИТ».", Ui.Muted);
            }
            gauge.Open += delegate { _host.OpenReadiness(); };
            grid.AddTile(gauge, 1, 238);

            var orgTile = new EntityTile();
            var own = EntityStats.Collect(store).FirstOrDefault(s => s.Active)
                ?? new EntityStats { ShortName = "Организация", Inn = string.Empty, Records = totalRows, Employees = employees, Overdue = overdue, Soon = soon, Documents = documents };
            orgTile.SetData(own.Id, own.ShortName, own.Inn, totalRows, employees, overdue, soon, documents, true);
            orgTile.Open += delegate { _host.OpenOrganizations(); };
            grid.AddTile(orgTile, 1, 238);


            int colorIndex = 0;
            Color[] palette = { Ui.Blue, Ui.Emerald, Ui.Amber, Ui.Rose };
            foreach (ModuleDef module in store.VisibleModules())
            {
                var tab = store.FindTabByModule(module.Id) ?? store.FindTab(module.TabId);
                if (tab == null) continue;
                int count = J.Arr(J.Get(tab, "rows")).Count;
                var tile = new SectionTile();
                ModuleDef captured = module;
                string caption = J.Str(J.Get(tab, "name"));
                tile.SetData(caption.Length > 0 ? caption : module.Title,
                    Ui.Plural(count, "запись", "записи", "записей"), GlyphOf(module), palette[colorIndex % palette.Length]);
                tile.Open += delegate { _host.OpenTabById(J.Str(J.Get(tab, "id"))); };
                grid.AddTile(tile, 1, 86);
                colorIndex++;
            }
            var templatesTile = new SectionTile();
            templatesTile.SetData("Шаблоны документов", Ui.Plural(templates, "шаблон", "шаблона", "шаблонов"), "Д", Ui.Blue);
            templatesTile.Open += delegate { _host.OpenTemplates(); };
            grid.AddTile(templatesTile, 1, 86);

            var addTile = new PlusTile();
            addTile.SetData("Новый раздел", "создать свой этап и колонки", Ui.Emerald);
            addTile.Open += delegate { _host.OpenSections(); };
            grid.AddTile(addTile, 1, 96);

            var hint = new HintBar();
            hint.SetData("Подсказка",
                "Сроки считаются автоматически по датам событий и периодичности; цвет статуса всегда сопровождается текстом. " +
                "Все действия выполняются в этом окне: таблицы, шаблоны, организации и справка открываются поверх рабочей области.",
                Ui.Blue);
            hint.Appear();
            grid.AddFullRow(hint, hint.MeasureHeight(640));
        }

        private static string BuildSubtitle(Store store)
        {
            var parts = new List<string>();
            string inn = J.Str(J.Get(store.Profile, "inn"));
            if (inn.Length > 0) parts.Add("ИНН " + inn);
            string full = J.Str(J.Get(store.Profile, "fullName"));
            if (full.Length > 0 && full != J.Str(J.Get(store.Profile, "shortName"))) parts.Add(full);
            parts.Add(Ui.Plural(EntityStats.Collect(store).Count, "юрлицо", "юрлица", "юрлиц"));
            return string.Join("  ·  ", parts.ToArray());
        }

        internal static string GlyphOf(ModuleDef module)
        {
            string title = module.Title ?? string.Empty;
            if (title.Length == 0) return "•";
            return title.Substring(0, 1).ToUpperInvariant();
        }
    }

    // =====================================================================
    //  Экран 2 — витрина всех юрлиц.
    // =====================================================================

    internal sealed class PortfolioView : UserControl
    {
        private readonly IDashboardHost _host;

        public PortfolioView(IDashboardHost host)
        {
            _host = host;
            BackColor = Color.Transparent;
            DoubleBuffered = true;
            Store store = host.Store;
            List<EntityStats> stats = EntityStats.Collect(store);

            var scroll = new VerticalScroll { Dock = DockStyle.Fill };
            Controls.Add(scroll);
            var grid = new BentoGrid
            {
                Dock = DockStyle.Top,
                AutoHeight = true,
                MinTileWidth = 240,
                RowHeight = 124,
                MaxColumns = 4,
                BackColor = Color.Transparent
            };
            scroll.Controls.Add(grid);

            var header = new PageHeader();
            int totalRecords = stats.Sum(s => s.Records);
            int totalEmployees = stats.Sum(s => s.Employees);
            int totalOverdue = stats.Sum(s => s.Overdue);
            header.SetData("Все организации",
                Ui.Plural(stats.Count, "юрлицо", "юрлица", "юрлиц") + "  ·  " +
                Ui.Plural(totalRecords, "запись", "записи", "записей") + "  ·  " +
                Ui.Plural(totalEmployees, "работник", "работника", "работников"));
            var create = new PillButton { Text = "＋ Новая организация", Width = 186, Height = 34, Primary = true, Hint = "Создать и заполнить реквизиты" };
            create.Click += delegate { _host.OpenOrganizations(); };
            header.AddAction(create);
            var dashboard = new PillButton { Text = "Главная", Width = 104, Height = 34, Hint = "Вернуться к текущему юрлицу" };
            dashboard.Click += delegate { _host.OpenDashboard(); };
            header.AddAction(dashboard);
            grid.AddFullRow(header, 64);

            var overdueTile = new KpiTile();
            overdueTile.SetData("ПРОСРОЧЕНО ВСЕГО", totalOverdue.ToString(),
                totalOverdue > 0 ? "по всем юрлицам" : "всё в порядке", totalOverdue > 0 ? Ui.Rose : Ui.Emerald);
            grid.AddTile(overdueTile, 1, 112);

            var recordsTile = new KpiTile();
            recordsTile.SetData("ЗАПИСЕЙ", totalRecords.ToString(), "во всех юрлицах", Ui.Ink);
            grid.AddTile(recordsTile, 1, 112);

            var employeesTile = new KpiTile();
            employeesTile.SetData("РАБОТНИКОВ", totalEmployees.ToString(), "в списках юрлиц", Ui.Blue);
            grid.AddTile(employeesTile, 1, 112);

            var soonTile = new KpiTile();
            soonTile.SetData("СРОКИ СКОРО", stats.Sum(s => s.Soon).ToString(), "в ближайшие 7 дней", Ui.Amber);
            grid.AddTile(soonTile, 1, 112);

            var hint = new HintBar();
            hint.SetData("Как устроены юрлица",
                "У каждого юрлица свои списки, шаблоны и документы — данные не смешиваются. Программа открывается на последнем юрлице, " +
                "с которым вы работали. Нажмите на плитку, чтобы открыть его дашборд; новое юрлицо добавляется в «Организациях».",
                Ui.Blue);
            hint.Appear();
            grid.AddFullRow(hint, hint.MeasureHeight(640));

            foreach (EntityStats item in stats)
            {
                EntityStats captured = item;
                var tile = new EntityTile();
                tile.SetData(captured.Id, captured.ShortName, captured.Inn, captured.Records, captured.Employees,
                    captured.Overdue, captured.Soon, captured.Documents, captured.Active);
                tile.Open += delegate { _host.OpenEntity(captured.Id); };
                grid.AddTile(tile, 1, 206);
            }
            var addTile = new PlusTile();
            addTile.SetData("Новое юрлицо", "создать организацию и заполнить реквизиты", Ui.Blue);
            addTile.Open += delegate { _host.OpenOrganizations(); };
            grid.AddTile(addTile, 1, 206);

            if (stats.Count < 2)
            {
                var single = new HintBar();
                single.SetData("Пока одно юрлицо",
                    "Добавьте второе юрлицо в «Организациях» — его списки и документы будут вестись отдельно. Данные текущего юрлица не копируются.",
                    Ui.Emerald);
                single.Appear();
                grid.AddFullRow(single, single.MeasureHeight(640));
            }
        }
    }

    // =====================================================================
    //  Виджет списка сроков (без горизонтальной прокрутки).
    // =====================================================================

    internal sealed class DeadlineListWidget : TileBase
    {
        private readonly List<Dictionary<string, object>> _items = new List<Dictionary<string, object>>();
        private string _empty = string.Empty;
        public event EventHandler Open;
        private Store _store;

        public DeadlineListWidget()
        {
            SetAccent(Ui.Rose, Color.Transparent);
            SetClickable();
        }

        public void SetData(Store store, List<Dictionary<string, object>> items, string empty)
        {
            _store = store;
            _items.Clear();
            if (items != null) _items.AddRange(items.OrderBy(ObligationsEngine.DaysLeft).Take(6));
            _empty = empty ?? string.Empty;
            Invalidate();
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            if (Open != null) Open(this, EventArgs.Empty);
        }

        protected override void PaintContent(Graphics g)
        {
            int pad = 16;
            PaintCaption(g, "БЛИЖАЙШИЕ И ПРОСРОЧЕННЫЕ ТРЕБОВАНИЯ", new Rectangle(pad, pad - 4, Width - pad * 2 - 120, 18));
            TextRenderer.DrawText(g, "все сроки →", Ui.Font(10.5f, FontStyle.Bold),
                new Rectangle(Width - pad - 110, pad - 4, 110, 18), Ui.Blue,
                TextFormatFlags.Right | TextFormatFlags.Top | TextFormatFlags.NoPrefix);

            if (_items.Count == 0)
            {
                TextRenderer.DrawText(g, _empty, Ui.Font(11.5f),
                    new Rectangle(pad, pad + 26, Width - pad * 2, Height - pad - 34), Ui.Muted,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
                return;
            }

            int y = pad + 24;
            int rowHeight = Math.Max(26, (Height - y - 10) / Math.Max(1, _items.Count));
            foreach (var obligation in _items)
            {
                if (y + rowHeight > Height - 4) break;
                bool isOverdue = ObligationsEngine.DaysLeft(obligation) < 0;
                Color accent = isOverdue ? Ui.Rose : Ui.Amber;
                using (var dot = new SolidBrush(accent))
                {
                    g.FillEllipse(dot, pad, y + 7, 7, 7);
                }
                string name = ObligationsEngine.EmployeeName(_store, J.Str(J.Get(obligation, "employeeRowId")));
                if (name.Length == 0) name = "Работник";
                int statusWidth = 128;
                int dueWidth = 96;
                int titleWidth = Math.Max(80, Width - pad * 2 - 17 - dueWidth - statusWidth);
                TextRenderer.DrawText(g, name, Ui.Font(11.5f, FontStyle.Bold),
                    new Rectangle(pad + 15, y + 1, Math.Min(170, titleWidth / 2), rowHeight - 2), Ui.Ink,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                string title = J.Str(J.Get(obligation, "title"));
                TextRenderer.DrawText(g, title, Ui.Font(11f),
                    new Rectangle(pad + 15 + Math.Min(170, titleWidth / 2) + 8, y + 1, titleWidth - Math.Min(170, titleWidth / 2) - 8, rowHeight - 2), Ui.Ink,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                TextRenderer.DrawText(g, ObligationsEngine.DueLabel(obligation), Ui.Font(10.5f, FontStyle.Bold),
                    new Rectangle(Width - pad - statusWidth - dueWidth, y + 1, dueWidth, rowHeight - 2), accent,
                    TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                TextRenderer.DrawText(g, ObligationsEngine.StatusLabel(obligation), Ui.Font(10.5f),
                    new Rectangle(Width - pad - statusWidth, y + 1, statusWidth, rowHeight - 2), isOverdue ? Ui.Rose : Ui.Amber,
                    TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                y += rowHeight;
                if (y < Height - 8)
                {
                    using (var pen = new Pen(Color.FromArgb(90, Ui.Line)))
                    {
                        g.DrawLine(pen, pad, y - 2, Width - pad, y - 2);
                    }
                }
            }
        }
    }

    // =====================================================================
    //  Справка внутри окна.
    // =====================================================================

    internal sealed class HelpForm : GlassForm
    {
        public HelpForm(string topic)
            : base("Справка — как работать в «ОТ-Базе»", new Size(900, 680))
        {
            var text = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BorderStyle = BorderStyle.None,
                BackColor = Color.FromArgb(0xFA, 0xFC, 0xFF),
                ForeColor = Ui.Ink,
                Font = Ui.Font(11.5f),
                DetectUrls = false,
                ScrollBars = RichTextBoxScrollBars.Vertical
            };
            Body.Controls.Add(text);

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 52,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 10, 0, 0)
            };
            Body.Controls.Add(footer);
            var close = new PillButton { Text = "Понятно", Primary = true, Width = 128, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            close.Click += delegate { Close(); };
            footer.Controls.Add(close);

            text.Text = HelpText(topic);
            text.Select(0, 0);
        }

        public static string HelpText(string topic)
        {
            var builder = new System.Text.StringBuilder();
            builder.AppendLine("СПРАВКА ПО ПРОГРАММЕ «ОТ-БАЗА»");
            builder.AppendLine();
            builder.AppendLine("1. С ЧЕГО НАЧАТЬ");
            builder.AppendLine("   • Проверьте реквизиты в «Организациях» — они подставляются в документы.");
            builder.AppendLine("   • Добавьте работников в разделе «Список работников» (или импортируйте Excel).");
            builder.AppendLine("   • При приёме, переводе, увольнении и несчастном случае программа создаёт требования");
            builder.AppendLine("     по срокам документов и мероприятий — они видны в «Контроле сроков» и на главной.");
            builder.AppendLine("   • Документы формируются по шаблонам: «Шаблоны документов».");
            builder.AppendLine();
            builder.AppendLine("2. ОДНО ОКНО");
            builder.AppendLine("   Все экраны открываются внутри рабочего окна (листом поверх содержимого).");
            builder.AppendLine("   Закрыть лист: крестик, Esc или кнопка «Отмена». Справка всегда по F1.");
            builder.AppendLine();
            builder.AppendLine("3. ЮРЛИЦА");
            builder.AppendLine("   «Все организации» — витрина юрлиц с показателями. Открыть юрлицо — нажать плитку.");
            builder.AppendLine("   Новое юрлицо: «Организации» → «Добавить», заполнить реквизиты и сохранить.");
            builder.AppendLine("   У каждого юрлица свои списки, шаблоны и документы. Данные не смешиваются.");
            builder.AppendLine("   Программа открывается на последнем юрлице, с которым вы работали.");
            builder.AppendLine();
            builder.AppendLine("4. РАЗДЕЛЫ И ЭТАПЫ (МОДУЛИ)");
            builder.AppendLine("   Раздел — это таблица со своими колонками плюс правила сроков и шаблоны этапа.");
            builder.AppendLine("   «Разделы и этапы» → отметить нужные этапы → «Применить». Отключение не удаляет данные.");
            builder.AppendLine("   Свой раздел: «＋ Новый раздел» → название → колонки через запятую (необязательно) →");
            builder.AppendLine("   «Создать». Структура копируется, наполняется как обычная таблица.");
            builder.AppendLine();
            builder.AppendLine("5. ИМПОРТ EXCEL");
            builder.AppendLine("   • Файл .xlsx. Первая строка — заголовки колонок, вторая и далее — записи.");
            builder.AppendLine("   • Заголовки сопоставляются с названиями колонок раздела (регистр и пробелы не важны).");
            builder.AppendLine("   • Незнакомые заголовки добавляются новыми колонками — их можно отредактировать.");
            builder.AppendLine("   • Даты — в формате ДД.ММ.ГГГГ; они приводятся к внутреннему формату автоматически.");
            builder.AppendLine("   • Импорт работников создаёт требования по приёму на основании даты приёма.");
            builder.AppendLine("   • Сначала показывается сводка (строк / колонок / новых колонок), затем импорт.");
            builder.AppendLine("   • Ошибки чтения показываются понятным текстом, база при этом не меняется.");
            builder.AppendLine();
            builder.AppendLine("6. ЭКСПОРТ");
            builder.AppendLine("   «Экспорт Excel» — выгружает видимые строки (учитывает поиск); файл читается обратно импортом.");
            builder.AppendLine("   «Экспорт CSV» — для обмена, разделитель «;», кодировка UTF-8.");
            builder.AppendLine();
            builder.AppendLine("7. СРОКИ И СТАТУСЫ");
            builder.AppendLine("   Просрочено — красный цвет и текст «Просрочено на N дн.»; скоро — янтарный; выполнено — зелёный.");
            builder.AppendLine("   Цвет никогда не единственный признак: статус всегда подписан текстом.");
            builder.AppendLine();
            builder.AppendLine("8. ДАННЫЕ И ПОРТАТИВНОСТЬ");
            builder.AppendLine("   База, документы и резервные копии лежат рядом с программой (папка data).");
            builder.AppendLine("   Можно носить на флешке: скопируйте всю папку и запускайте на другом ПК с Windows.");
            builder.AppendLine("   Резервные копии создаются автоматически при сохранении (data/backups).");
            builder.AppendLine("   «Папка с данными» — открыть её в проводнике.");
            builder.AppendLine();
            builder.AppendLine("9. ГОРЯЧИЕ КЛАВИШИ");
            builder.AppendLine("   F1 — эта справка.  Esc — закрыть открытый лист.  Tab / Space — работа с кнопками.");
            builder.AppendLine();
            builder.AppendLine("10. ЕСЛИ ЧТО-ТО НЕ ТАК");
            builder.AppendLine("   Сообщения показываются внутри окна и не прерывают работу. Если файл базы повреждён,");
            builder.AppendLine("   программа сообщит путь и не будет молча затирать данные.");
            return builder.ToString();
        }
    }
}
