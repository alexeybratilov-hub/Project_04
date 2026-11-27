using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace OtBaza
{
    // =====================================================================
    //  Помощники экранов таблиц: перенос кнопок, плейсхолдер поиска,
    //  двойная буферизация сетки, пустые состояния и сообщения оболочки.
    // =====================================================================

    internal static class ViewsFx
    {
        private const int EmSetCueBanner = 0x1501;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")]
        private static extern IntPtr SendMessageText(IntPtr hWnd, int message, IntPtr wParam, string lParam);

        /// <summary>
        /// Плейсхолдер для однострочного TextBox: в .NET Framework 4.x нет
        /// свойства PlaceholderText, поэтому используется системный cue banner.
        /// </summary>
        public static void SetPlaceholder(TextBox box, string text)
        {
            if (box == null || text == null) return;
            try
            {
                if (box.IsHandleCreated)
                {
                    SendMessageText(box.Handle, EmSetCueBanner, new IntPtr(1), text);
                }
                else
                {
                    box.HandleCreated += delegate { SendMessageText(box.Handle, EmSetCueBanner, new IntPtr(1), text); };
                }
            }
            catch
            {
                // Подсказка не критична: сам поиск работает и без неё.
            }
        }

        /// <summary>Сетка перерисовывается без мерцания при выборке и сортировке.</summary>
        public static void EnableDoubleBuffering(Control control)
        {
            if (control == null) return;
            try
            {
                PropertyInfo property = control.GetType().GetProperty(
                    "DoubleBuffered", BindingFlags.Instance | BindingFlags.NonPublic);
                if (property == null)
                {
                    property = typeof(Control).GetProperty(
                        "DoubleBuffered", BindingFlags.Instance | BindingFlags.NonPublic);
                }
                if (property != null) property.SetValue(control, true, null);
            }
            catch
            {
                // Защищённое свойство недоступно — остаётся обычная отрисовка.
            }
        }

        /// <summary>
        /// Высота панели кнопок с переносом для заданной ширины. FlowLayoutPanel
        /// с AutoSize пересчитывает высоту не всегда (например, внутри таблицы),
        /// поэтому строки считаются вручную и берётся максимум с оценкой WinForms.
        /// </summary>
        public static int MeasureFlowHeight(FlowLayoutPanel flow, int width)
        {
            if (flow == null) return 46;
            if (width < 160) width = 600;
            int limit = Math.Max(120, width - flow.Padding.Horizontal);
            int used = 0;
            int rowHeight = 0;
            int total = 0;
            foreach (Control control in flow.Controls)
            {
                if (control == null || !control.Visible) continue;
                int needed = control.Width + control.Margin.Horizontal;
                int height = control.Height + control.Margin.Vertical;
                if (used > 0 && used + needed > limit)
                {
                    total += rowHeight;
                    used = 0;
                    rowHeight = 0;
                }
                used += needed;
                if (height > rowHeight) rowHeight = height;
            }
            if (rowHeight > 0) total += rowHeight;
            total += flow.Padding.Vertical;
            try
            {
                Size wanted = flow.GetPreferredSize(new Size(Math.Max(160, width), 0));
                if (wanted.Height > total) total = wanted.Height;
            }
            catch
            {
            }
            if (total < 42) total = 42;
            if (total > 200) total = 200;
            return total;
        }

        /// <summary>
        /// Пустое состояние поверх области сетки. Сетка при этом не скрывается —
        /// слой лишь поясняет, почему в ней нет строк.
        /// </summary>
        public static Label CreateEmptyState()
        {
            return new Label
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(0xFD, 0xFE, 0xFF),
                ForeColor = Ui.Muted,
                Font = Ui.Font(13f),
                TextAlign = ContentAlignment.MiddleCenter,
                Padding = new Padding(28),
                AutoSize = false,
                UseMnemonic = false,
                Visible = false
            };
        }

        public static void ShowEmpty(Label label, string text)
        {
            if (label == null) return;
            if (string.IsNullOrEmpty(text))
            {
                label.Visible = false;
                return;
            }
            label.Text = text;
            label.Visible = true;
            label.BringToFront();
        }

        /// <summary>
        /// Сообщение пользователю. В рабочем приложении оболочка всегда есть,
        /// поэтому MessageBox — только крайний случай для автономных проверок.
        /// </summary>
        /// <summary>Подсказка с полным значением для усечённых ячеек таблиц.</summary>
        public static void AttachCellToolTips(DataGridView grid)
        {
            if (grid == null) return;
            grid.ShowCellToolTips = true;
            grid.CellToolTipTextNeeded += delegate(object sender, DataGridViewCellToolTipTextNeededEventArgs e)
            {
                if (e.RowIndex < 0 || e.ColumnIndex < 0) return;
                if (e.RowIndex >= grid.Rows.Count) return;
                object value = grid.Rows[e.RowIndex].Cells[e.ColumnIndex].Value;
                string text = value == null ? string.Empty : value.ToString();
                if (text.Length > 22) e.ToolTipText = text;
            };
        }

        /// <summary>Компактная легенда статусов: цвет + текст, а не только цвет.</summary>
        public static Control LegendChip(string text, Color color)
        {
            return new Label
            {
                Text = "● " + text,
                AutoSize = true,
                ForeColor = color,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f, FontStyle.Bold),
                Margin = new Padding(12, 9, 0, 0)
            };
        }
        public static void Say(string message, NoticeKind kind)
        {
            if (string.IsNullOrEmpty(message)) return;
            if (Shell.Current != null)
            {
                Shell.Current.Notify(message, kind);
                return;
            }
            MessageBox.Show(
                message,
                "ОТ-База",
                MessageBoxButtons.OK,
                kind == NoticeKind.Danger || kind == NoticeKind.Warning
                    ? MessageBoxIcon.Warning
                    : MessageBoxIcon.Information);
        }

        /// <summary>Справка оболочки; без оболочки (тесты) — краткий текст по импорту.</summary>
        public static void ShowHelp(string topic)
        {
            if (Shell.Current != null)
            {
                Shell.Current.ShowHelp(topic);
                return;
            }
            Say(
                "Импорт Excel: 1-я строка — заголовки колонок, сопоставление по названию колонки, " +
                "незнакомые заголовки добавляются новыми колонками, даты — в формате ДД.ММ.ГГГГ, " +
                "импорт работников создаёт требования по приёму.",
                NoticeKind.Info);
        }
    }

    internal sealed class TableView : UserControl
    {
        private readonly Store _store;
        private readonly Dictionary<string, object> _tab;
        private readonly Action _onChanged;
        private readonly DataGridView _grid;
        private readonly TextBox _search;
        private readonly Label _counter;
        private readonly Label _empty;
        private readonly HintBar _hint;
        private readonly TransparentFlow _toolbar;
        private readonly GlassPanel _surface;
        private readonly bool _isEmployees;
        private List<Dictionary<string, object>> _rows = new List<Dictionary<string, object>>();
        private bool _adjustingChrome;

        public TableView(Store store, Dictionary<string, object> tab, Action onChanged)
        {
            _store = store;
            _tab = tab;
            _onChanged = onChanged;
            _isEmployees = J.Str(J.Get(_tab, "moduleId")) == "employees";
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            _surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(_surface);

            // Порядок добавления важен: WinForms раскладывает Dock-контролы от
            // конца коллекции к началу. Первым обрабатывается тулбар (он сверху),
            // затем подсказка, последним — сетка-заполнитель (Fill), которая
            // забирает оставшееся место и рисуется поверх.
            _hint = new HintBar { Dock = DockStyle.Top, Margin = new Padding(0) };
            _hint.SetData("Импорт из Excel", BuildImportHint(), Ui.Blue);
            _hint.Appear();
            _surface.Controls.Add(_hint);

            _toolbar = new TransparentFlow
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                WrapContents = true,
                AutoScroll = false,
                FlowDirection = FlowDirection.LeftToRight,
                Padding = new Padding(2, 4, 2, 6),
                Margin = new Padding(0)
            };
            _surface.Controls.Add(_toolbar);

            _toolbar.Controls.Add(ToolButton("Добавить запись", delegate { AddRow(); }, true));
            if (_isEmployees)
            {
                _toolbar.Controls.Add(ToolButton("Карточка", delegate { OpenEmployeeCard(); }, false));
            }
            _toolbar.Controls.Add(ToolButton("Импорт Excel", delegate { ImportExcel(); }, false));
            _toolbar.Controls.Add(ToolButton("Изменить", delegate { EditRow(); }, false));
            _toolbar.Controls.Add(ToolButton("Удалить", delegate { DeleteRows(); }, false));
            _toolbar.Controls.Add(ToolButton("Экспорт Excel", delegate { ExportXlsx(); }, false));
            _toolbar.Controls.Add(ToolButton("Экспорт CSV", delegate { ExportCsv(); }, false));
            _toolbar.Controls.Add(ToolButton("Как импортировать?", delegate { ViewsFx.ShowHelp("import"); }, false));

            _search = new TextBox
            {
                Width = 240,
                Margin = new Padding(16, 7, 6, 0),
                Font = Ui.Font(12f)
            };
            _search.TextChanged += delegate { FillGrid(); };
            ViewsFx.SetPlaceholder(_search, "Поиск по таблице…");
            _toolbar.Controls.Add(_search);

            var clearSearch = new PillButton
            {
                Text = "✕",
                Width = 34,
                Height = 34,
                Hint = "Очистить поиск",
                Margin = new Padding(0, 1, 6, 0)
            };
            clearSearch.Click += delegate { ClearSearch(); };
            _toolbar.Controls.Add(clearSearch);

            _counter = new Label
            {
                AutoSize = true,
                ForeColor = Ui.Muted,
                Font = Ui.Font(10.5f),
                Margin = new Padding(8, 10, 0, 0)
            };
            _toolbar.Controls.Add(_counter);

            _grid = new DataGridView
            {
                Dock = DockStyle.Fill,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                ReadOnly = true,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = true,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
                ColumnHeadersHeight = 38,
                ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing,
                RowTemplate = { Height = 32 },
                GridColor = Color.FromArgb(0xE8, 0xEE, 0xF7),
                Font = Ui.Font(12f)
            };
            _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(0xF6, 0xF9, 0xFD);
            _grid.ColumnHeadersDefaultCellStyle.ForeColor = Ui.Ink;
            _grid.ColumnHeadersDefaultCellStyle.Font = Ui.Font(11.5f, FontStyle.Bold);
            _grid.ColumnHeadersDefaultCellStyle.Padding = new Padding(6, 0, 6, 0);
            _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(0xE0, 0xEA, 0xFF);
            _grid.DefaultCellStyle.SelectionForeColor = Ui.Ink;
            _grid.DefaultCellStyle.Padding = new Padding(6, 0, 6, 0);
            _grid.EnableHeadersVisualStyles = false;
                        ViewsFx.AttachCellToolTips(_grid);
            _grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex < 0) return;
                if (_isEmployees)
                {
                    OpenEmployeeCard();
                    return;
                }
                EditRow();
            };
            _grid.Resize += delegate { UpdateGridSizing(); };
            // Двойная буферизация: у DataGridView свойство защищено, поэтому рефлексия.
            ViewsFx.EnableDoubleBuffering(_grid);

            var gridHost = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Margin = new Padding(0) };
            gridHost.Controls.Add(_grid);
            _empty = ViewsFx.CreateEmptyState();
            gridHost.Controls.Add(_empty);
            _empty.BringToFront();
            _surface.Controls.Add(gridHost);
            gridHost.BringToFront();

            BuildColumns();
            Reload();

            UpdateChromeHeights();
            _surface.Resize += delegate { UpdateChromeHeights(); };
            // Первый реальный расклад случается уже после создания окна: там
            // известны настоящие ширины подписей, поэтому высоту перепроверяем.
            HandleCreated += delegate
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate { UpdateChromeHeights(); });
                }
                catch
                {
                    // Контрол уже закрывается — пересчёт не нужен.
                }
            };
        }

        // -----------------------------------------------------------------
        //  Тулбар и подсказка
        // -----------------------------------------------------------------

        private Control ToolButton(string text, EventHandler onClick, bool primary)
        {
            int width = primary ? 156 : 112;
            // Ширина по тексту: подписи не обрезаются, даже если фраза длинная.
            int measured = TextRenderer.MeasureText(
                text, Ui.Font(12.5f, primary ? FontStyle.Bold : FontStyle.Regular)).Width + 30;
            if (measured > width) width = measured;
            var button = new PillButton
            {
                Text = text,
                Primary = primary,
                Width = width,
                Height = 34,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.Click += onClick;
            return button;
        }

        /// <summary>
        /// Постоянная подсказка по импорту: собирается из реальных колонок
        /// текущей таблицы, поэтому список ожидаемых заголовков всегда актуален.
        /// </summary>
        private string BuildImportHint()
        {
            var names = Columns.Select(c => "«" + J.Str(J.Get(c, "name")) + "»").ToList();
            string expected = names.Count > 0 ? string.Join(", ", names.ToArray()) : "пока не заданы";
            string text =
                "Файл .xlsx: 1-я строка — заголовки колонок, со 2-й — записи. " +
                "Сопоставление по названию колонки (регистр и пробелы не важны). " +
                "Ожидаемые колонки: " + expected + ". " +
                "Незнакомые заголовки добавляются новыми колонками. Даты — в формате ДД.ММ.ГГГГ.";
            if (_isEmployees)
            {
                text += " Импорт работников создаёт требования по приёму.";
            }
            return text;
        }

        private void RefreshHint()
        {
            if (_hint == null) return;
            _hint.SetData("Импорт из Excel", BuildImportHint(), Ui.Blue);
            UpdateChromeHeights();
        }

        /// <summary>
        /// Пересчёт высоты тулбара при изменении ширины: кнопки переносятся на
        /// следующую строку, поэтому AutoSize дополняется явной страховкой
        /// (MinimumSize), иначе в узком окне последняя строка кнопок обрезалась.
        /// </summary>
        private void UpdateChromeHeights()
        {
            if (_adjustingChrome) return;
            if (IsDisposed || _surface == null || _surface.IsDisposed || _toolbar == null || _toolbar.IsDisposed) return;
            _adjustingChrome = true;
            try
            {
                int width = _surface != null ? _surface.ClientSize.Width : Width;
                // Пока поверхность не разложена, ширина неизвестна: не завышаем
                // высоту «на всякий случай», иначе тулбар получит пустую полосу.
                if (width < 240) return;
                int available = Math.Max(160, width - 24);

                int wanted = ViewsFx.MeasureFlowHeight(_toolbar, available);
                if (wanted > _toolbar.Height + 2)
                {
                    if (_toolbar.MinimumSize.Height != wanted) _toolbar.MinimumSize = new Size(0, wanted);
                }
                else if (_toolbar.MinimumSize.Height != 0)
                {
                    // AutoSize сам уменьшит панель, как только снимется минимум.
                    _toolbar.MinimumSize = Size.Empty;
                }

                if (_hint == null) return;
                int hintHeight = _hint.MeasureHeight(available);
                if (hintHeight < 44) hintHeight = 44;
                if (_hint.Height != hintHeight) _hint.Height = hintHeight;
            }
            finally
            {
                _adjustingChrome = false;
            }
        }

        // -----------------------------------------------------------------
        //  Колонки, загрузка и фильтрация
        // -----------------------------------------------------------------

        private List<Dictionary<string, object>> Columns
        {
            get
            {
                return J.Arr(J.Get(_tab, "columns"))
                    .Select(J.Obj)
                    .Where(c => c != null)
                    .ToList();
            }
        }

        private void BuildColumns()
        {
            _grid.Columns.Clear();
            foreach (var column in Columns)
            {
                var gridColumn = new DataGridViewTextBoxColumn
                {
                    Name = J.Str(J.Get(column, "id")),
                    HeaderText = J.Str(J.Get(column, "name")),
                    Width = Math.Max(90, J.Int(J.Get(column, "width"), 160)),
                    SortMode = DataGridViewColumnSortMode.Automatic
                };
                _grid.Columns.Add(gridColumn);
            }
            UpdateGridSizing();
            // Список ожидаемых колонок в подсказке зависит от структуры таблицы,
            // поэтому обновляется вместе с колонками (в том числе после импорта).
            RefreshHint();
        }

        /// <summary>
        /// Если сумма желаемых ширин меньше доступной области — колонки
        /// растягиваются (Fill), иначе включается обычная ширина и остаётся
        /// горизонтальная прокрутка только внутри самой таблицы.
        /// </summary>
        private void UpdateGridSizing()
        {
            if (_grid == null || _grid.Columns.Count == 0) return;
            int available = _grid.ClientSize.Width - 24;
            if (available < 120) return;

            var widths = new List<int>();
            int total = 0;
            foreach (var column in Columns)
            {
                int width = Math.Max(90, J.Int(J.Get(column, "width"), 160));
                widths.Add(width);
                total += width;
            }
            if (widths.Count != _grid.Columns.Count) return;

            bool fill = total <= available;
            var mode = fill
                ? DataGridViewAutoSizeColumnsMode.Fill
                : DataGridViewAutoSizeColumnsMode.None;
            if (_grid.AutoSizeColumnsMode != mode) _grid.AutoSizeColumnsMode = mode;
            if (fill) return;
            for (int i = 0; i < widths.Count; i++)
            {
                if (_grid.Columns[i].Width != widths[i]) _grid.Columns[i].Width = widths[i];
            }
        }

        private void Reload()
        {
            _rows = J.Arr(J.Get(_tab, "rows"))
                .Select(J.Obj)
                .Where(r => r != null)
                .ToList();
            FillGrid();
        }

        private void FillGrid()
        {
            string query = _search.Text.Trim().ToLowerInvariant();
            _grid.Rows.Clear();
            int shown = 0;
            foreach (var row in _rows)
            {
                if (query.Length > 0)
                {
                    bool match = Columns.Any(c => J.Str(J.Get(row, J.Str(J.Get(c, "id")))).ToLowerInvariant().Contains(query));
                    if (!match) continue;
                }
                var cells = Columns.Select(c => (object)J.Str(J.Get(row, J.Str(J.Get(c, "id"))))).ToArray();
                int index = _grid.Rows.Add(cells);
                _grid.Rows[index].Tag = row;
                shown++;
            }
            _counter.Text = string.Format("показано {0} из {1}", shown, _rows.Count);
            UpdateEmptyState(shown);
        }

        /// <summary>Пояснение вместо пустого белого поля: разные тексты для пустой базы и для поиска.</summary>
        private void UpdateEmptyState(int shown)
        {
            string text = null;
            if (shown == 0)
            {
                if (_rows.Count == 0)
                {
                    text = "Пока нет записей. Нажмите «Добавить запись» или импортируйте Excel.";
                    if (_isEmployees)
                    {
                        text += "\n\nПосле добавления работника появятся требования по приёму.";
                    }
                }
                else
                {
                    text = "Ничего не найдено. Измените поисковый запрос или нажмите «✕», чтобы очистить поиск.";
                }
            }
            ViewsFx.ShowEmpty(_empty, text);
        }

        private void ClearSearch()
        {
            if (_search.Text.Length > 0)
            {
                _search.Clear();
                _search.Focus();
                return;
            }
            _search.Focus();
        }

        private Dictionary<string, object> SelectedRow()
        {
            if (_grid.CurrentRow == null) return null;
            return _grid.CurrentRow.Tag as Dictionary<string, object>;
        }

        // -----------------------------------------------------------------
        //  Импорт Excel (сопоставление по названиям колонок)
        // -----------------------------------------------------------------

        private static string NormalizeHeader(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            string lower = value.Trim().ToLowerInvariant().Replace('ё', 'е');
            var builder = new StringBuilder();
            foreach (char c in lower)
            {
                if (char.IsLetterOrDigit(c)) builder.Append(c);
            }
            return builder.ToString();
        }

        private void ImportExcel()
        {
            string fileName;
            using (var dialog = new OpenFileDialog
            {
                Title = "Импорт из Excel",
                Filter = "Excel (*.xlsx)|*.xlsx"
            })
            {
                if (dialog.ShowDialog(FindForm()) != DialogResult.OK) return;
                fileName = dialog.FileName;
            }

            List<string[]> sheetRows;
            try
            {
                sheetRows = XlsxReader.Read(fileName);
            }
            catch (Exception ex)
            {
                ViewsFx.Say("Не удалось прочитать Excel: " + ex.Message, NoticeKind.Danger);
                return;
            }
            if (sheetRows.Count < 2)
            {
                ViewsFx.Say(
                    "В файле нет строк с данными: нужна первая строка с заголовками и хотя бы одна строка записей.",
                    NoticeKind.Warning);
                return;
            }

            string[] headers = sheetRows[0];
            object[] previousColumns = J.Arr(J.Get(_tab, "columns")).ToArray();
            // Новые колонки складываются в локальный список и попадают в базу
            // только после подтверждения — отмена не оставляет «пустых» колонок.
            var columns = new List<Dictionary<string, object>>(Columns);
            var mapping = new Dictionary<int, string>();
            var addedColumns = new List<string>();
            string suffix = DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture);

            for (int i = 0; i < headers.Length; i++)
            {
                string header = (headers[i] ?? string.Empty).Trim();
                if (header.Length == 0) continue;

                var match = columns.FirstOrDefault(c => NormalizeHeader(J.Str(J.Get(c, "name"))) == NormalizeHeader(header));
                if (match != null)
                {
                    mapping[i] = J.Str(J.Get(match, "id"));
                    continue;
                }

                string id = "imp_" + suffix + "_" + i;
                columns.Add(new Dictionary<string, object>
                {
                    { "id", id },
                    { "name", header },
                    { "type", "text" },
                    { "width", 170 }
                });
                mapping[i] = id;
                addedColumns.Add(header);
            }

            string question = string.Format(
                "Строк с данными: {0}\nКолонок в файле: {1}\nНовых колонок: {2}\n\nИмпортировать в «{3}»?",
                sheetRows.Count - 1, headers.Length, addedColumns.Count, J.Str(J.Get(_tab, "name")));

            // Shell.Confirm асинхронный: весь импорт (и уведомление) выполняется
            // внутри callback, продолжения после вызова нет.
            Shell.Confirm("Импорт из Excel", question, "Импортировать", delegate
            {
                int imported = 0;
                try
                {
                    J.Put(_tab, "columns", columns.Cast<object>().ToArray());

                    var columnMeta = columns
                        .GroupBy(c => J.Str(J.Get(c, "id")))
                        .ToDictionary(g => g.Key, g => g.First());
                    string stamp = DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
                    for (int r = 1; r < sheetRows.Count; r++)
                    {
                        string[] cells = sheetRows[r];
                        if (!cells.Any(value => !string.IsNullOrWhiteSpace(value))) continue;

                        imported++;
                        var row = new Dictionary<string, object>
                        {
                            { "id", "row_imp_" + stamp + "_" + r }
                        };
                        foreach (var pair in mapping)
                        {
                            if (pair.Key >= cells.Length) continue;
                            string raw = (cells[pair.Key] ?? string.Empty).Trim();
                            Dictionary<string, object> meta;
                            if (columnMeta.TryGetValue(pair.Value, out meta) &&
                                DateText.IsDateColumn(pair.Value, J.Str(J.Get(meta, "name")), J.Str(J.Get(meta, "type"))))
                            {
                                // Excel отдаёт даты как «27.11.2026» — в базе хранится ISO,
                                // иначе сроки по импортированным строкам не считаются.
                                raw = DateText.Normalize(raw);
                            }
                            row[pair.Value] = raw;
                        }
                        _rows.Add(row);

                        if (_isEmployees)
                        {
                            var info = Employees.Read(_store, row);
                            if (info.Fio.Length > 0)
                            {
                                string hireDate = info.HireDate.Length > 0 ? info.HireDate : ObligationsEngine.TodayIso();
                                ObligationsEngine.RegisterEvent(_store, row, "hire", hireDate);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    // Возвращаем прежнюю структуру колонок и перечитываем строки:
                    // частично применённый импорт не должен попасть в базу.
                    J.Put(_tab, "columns", previousColumns);
                    BuildColumns();
                    Reload();
                    ViewsFx.Say("Импорт прерван: " + ex.Message + ". Изменения не сохранены.", NoticeKind.Danger);
                    return;
                }

                PersistRows();
                BuildColumns();
                Reload();
                _onChanged();
                ViewsFx.Say(
                    "Импортировано строк: " + imported + "." +
                    (_isEmployees ? " Для работников созданы требования по приёму." : string.Empty),
                    NoticeKind.Success);
            });
        }

        // -----------------------------------------------------------------
        //  Карточка работника и редактор строки (листы внутри окна)
        // -----------------------------------------------------------------

        private void OpenEmployeeCard()
        {
            var row = SelectedRow();
            if (row == null)
            {
                ViewsFx.Say("Выберите работника: щёлкните по строке в таблице.", NoticeKind.Info);
                return;
            }
            var card = new EmployeeCardForm(_store, row, _onChanged);
            if (Shell.Current == null)
            {
                using (card) card.ShowDialog(FindForm());
                Reload();
                _onChanged();
                return;
            }
            Shell.Sheet(card, delegate
            {
                Reload();
                _onChanged();
            });
        }

        /// <summary>
        /// Открывает RowEditorForm листом внутри окна. Результат редактора
        /// забирается в callback — код после Shell.Sheet не выполняется.
        /// </summary>
        private void OpenRowEditor(Dictionary<string, object> existing, string title, Action<Dictionary<string, object>> onSaved)
        {
            var dialog = new RowEditorForm(Columns, existing, title);
            if (Shell.Current == null)
            {
                using (dialog)
                {
                    if (dialog.ShowDialog(FindForm()) == DialogResult.OK && onSaved != null) onSaved(dialog.Result);
                }
                return;
            }

            DialogResult result = DialogResult.Cancel;
            dialog.FormClosed += delegate { result = dialog.DialogResult; };
            Shell.Sheet(dialog, delegate
            {
                if (result == DialogResult.OK && onSaved != null) onSaved(dialog.Result);
            });
        }

        private void AddRow()
        {
            OpenRowEditor(null, "Новая запись", delegate(Dictionary<string, object> values)
            {
                var row = values;
                row["id"] = "row_" + DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
                _rows.Add(row);
                PersistRows();

                if (_isEmployees)
                {
                    string hireDate = Employees.Read(_store, row).HireDate;
                    if (hireDate.Length == 0) hireDate = ObligationsEngine.TodayIso();
                    ObligationsEngine.RegisterEvent(_store, row, "hire", hireDate);
                }
                // Перечитываем выборку: новая запись должна сразу появиться в сетке.
                Reload();
                _onChanged();
                ViewsFx.Say("Запись добавлена.", NoticeKind.Success);
            });
        }

        private void EditRow()
        {
            var row = SelectedRow();
            if (row == null)
            {
                ViewsFx.Say("Выберите строку для изменения: щёлкните по ней в таблице.", NoticeKind.Info);
                return;
            }
            OpenRowEditor(row, "Изменение записи", delegate(Dictionary<string, object> values)
            {
                foreach (var pair in values)
                {
                    row[pair.Key] = pair.Value;
                }
                PersistRows();
                Reload();
                _onChanged();
                ViewsFx.Say("Изменения сохранены.", NoticeKind.Success);
            });
        }

        private void DeleteRows()
        {
            if (_grid.SelectedRows.Count == 0)
            {
                ViewsFx.Say("Выберите строки для удаления: щёлкните по ним в таблице.", NoticeKind.Info);
                return;
            }

            var ids = new HashSet<string>();
            int count = 0;
            foreach (DataGridViewRow gridRow in _grid.SelectedRows)
            {
                var row = gridRow.Tag as Dictionary<string, object>;
                if (row == null) continue;
                ids.Add(J.Str(J.Get(row, "id")));
                count++;
            }
            if (count == 0) return;

            // Идентификаторы собраны до подтверждения: лист блокирует таблицу,
            // но выборка к моменту callback читается уже после закрытия листа.
            Shell.Confirm(
                "Удаление записей",
                "Удалить выбранные записи (" + count + ")? Действие необратимо.",
                "Удалить",
                delegate
                {
                    _rows.RemoveAll(r => ids.Contains(J.Str(J.Get(r, "id"))));
                    PersistRows();
                    Reload();
                    _onChanged();
                    ViewsFx.Say("Удалено записей: " + count + ".", NoticeKind.Success);
                });
        }

        private void PersistRows()
        {
            J.Put(_tab, "rows", _rows.Cast<object>().ToArray());
            _store.Save();
        }

        // -----------------------------------------------------------------
        //  Экспорт
        // -----------------------------------------------------------------

        private void ExportCsv()
        {
            using (var dialog = new SaveFileDialog
            {
                Filter = "CSV (*.csv)|*.csv",
                FileName = J.Str(J.Get(_tab, "name")) + "_" + DateTime.Today.ToString("yyyy-MM-dd") + ".csv"
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var builder = new StringBuilder();
                    builder.AppendLine(string.Join(";", Columns.Select(c => CsvExport.Escape(J.Str(J.Get(c, "name"))))));
                    foreach (var row in _rows)
                    {
                        builder.AppendLine(string.Join(";", Columns.Select(c => CsvExport.Escape(J.Str(J.Get(row, J.Str(J.Get(c, "id"))))))));
                    }
                    File.WriteAllText(dialog.FileName, builder.ToString(), new UTF8Encoding(true));
                    ViewsFx.Say(
                        "Экспорт CSV: записей " + _rows.Count + ". Файл: " + Path.GetFileName(dialog.FileName),
                        NoticeKind.Success);
                }
                catch (Exception ex)
                {
                    ViewsFx.Say("Не удалось сохранить CSV: " + ex.Message, NoticeKind.Danger);
                }
            }
        }

        /// <summary>
        /// Выгрузка в Excel: шапка + текущая выборка (если включён поиск, уходит
        /// ровно то, что видно на экране). Файл читается обратно «Импортом Excel»
        /// на другом ПК — формат совместим с собственным XlsxReader.
        /// </summary>
        private void ExportXlsx()
        {
            using (var dialog = new SaveFileDialog
            {
                Filter = "Excel (*.xlsx)|*.xlsx",
                FileName = J.Str(J.Get(_tab, "name")) + "_" + DateTime.Today.ToString("yyyy-MM-dd") + ".xlsx"
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    List<Dictionary<string, object>> rows = VisibleRows();
                    var matrix = new List<string[]>();
                    matrix.Add(Columns.Select(c => J.Str(J.Get(c, "name"))).ToArray());
                    foreach (var row in rows)
                    {
                        matrix.Add(Columns
                            .Select(c => J.Str(J.Get(row, J.Str(J.Get(c, "id")))))
                            .ToArray());
                    }
                    var widths = Columns
                        .Select(c => Math.Max(90, J.Int(J.Get(c, "width"), 160)))
                        .ToList();
                    var dateFlags = Columns
                        .Select(c => DateText.IsDateColumn(
                            J.Str(J.Get(c, "id")),
                            J.Str(J.Get(c, "name")),
                            J.Str(J.Get(c, "type"))))
                        .ToList();
                    XlsxWriter.Write(dialog.FileName, J.Str(J.Get(_tab, "name")), matrix, widths, dateFlags);
                    ViewsFx.Say(
                        "Экспорт Excel: записей " + rows.Count + ". Файл: " + Path.GetFileName(dialog.FileName),
                        NoticeKind.Success);
                }
                catch (Exception ex)
                {
                    ViewsFx.Say("Не удалось выгрузить Excel: " + ex.Message, NoticeKind.Danger);
                }
            }
        }

        /// <summary>Строки, которые сейчас видит пользователь (поиск учитывается).</summary>
        private List<Dictionary<string, object>> VisibleRows()
        {
            string query = _search.Text.Trim().ToLowerInvariant();
            if (query.Length == 0) return _rows;
            return _rows.Where(row =>
                Columns.Any(c => J.Str(J.Get(row, J.Str(J.Get(c, "id")))).ToLowerInvariant().Contains(query)))
                .ToList();
        }
    }

    internal sealed class DeadlineView : UserControl
    {
        private readonly Store _store;
        private readonly Action _onChanged;
        private readonly DataGridView _grid;
        private readonly ComboBox _filter;
        private readonly Label _summary;
        private readonly Label _empty;
        private readonly TransparentFlow _toolbar;
        private readonly GlassPanel _surface;
        private bool _adjustingChrome;

        public DeadlineView(Store store, Action onChanged)
        {
            _store = store;
            _onChanged = onChanged;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            _surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(_surface);

            _toolbar = new TransparentFlow
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                WrapContents = true,
                AutoScroll = false,
                FlowDirection = FlowDirection.LeftToRight,
                Padding = new Padding(2, 4, 2, 6),
                Margin = new Padding(0)
            };
            _surface.Controls.Add(_toolbar);

            _toolbar.Controls.Add(new Label
            {
                Text = "Фильтр:",
                AutoSize = true,
                ForeColor = Ui.Muted,
                Font = Ui.Font(11.5f),
                Margin = new Padding(0, 9, 6, 0)
            });

            _filter = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Width = 200,
                Font = Ui.Font(12f),
                Margin = new Padding(0, 5, 12, 0)
            };
            _filter.Items.AddRange(new object[] { "Все активные", "Просроченные", "Скоро (7 дней)", "Выполненные" });
            _filter.SelectedIndex = 0;
            _filter.SelectedIndexChanged += delegate { Fill(); };
            _toolbar.Controls.Add(_filter);

            _toolbar.Controls.Add(DeadlineButton("Выполнено", delegate { CompleteSelected(); }, true));
            _toolbar.Controls.Add(DeadlineButton("Обновить", delegate { Fill(); }, false));

            _summary = new Label
            {
                AutoSize = true,
                ForeColor = Ui.Muted,
                Font = Ui.Font(10.5f),
                Margin = new Padding(12, 10, 0, 0)
            };
            _toolbar.Controls.Add(_summary);
            _toolbar.Controls.Add(ViewsFx.LegendChip("Просрочено", Ui.Rose));
            _toolbar.Controls.Add(ViewsFx.LegendChip("Скоро", Ui.Amber));
            _toolbar.Controls.Add(ViewsFx.LegendChip("Выполнено", Ui.Emerald));

            _grid = new DataGridView
            {
                Dock = DockStyle.Fill,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                ReadOnly = true,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                ColumnHeadersHeight = 38,
                RowTemplate = { Height = 32 },
                GridColor = Color.FromArgb(0xE8, 0xEE, 0xF7),
                Font = Ui.Font(12f)
            };
            _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(0xF6, 0xF9, 0xFD);
            _grid.ColumnHeadersDefaultCellStyle.Font = Ui.Font(11.5f, FontStyle.Bold);
            _grid.ColumnHeadersDefaultCellStyle.ForeColor = Ui.Ink;
            _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(0xE0, 0xEA, 0xFF);
            _grid.DefaultCellStyle.SelectionForeColor = Ui.Ink;
            _grid.EnableHeadersVisualStyles = false;
                        ViewsFx.AttachCellToolTips(_grid);
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Работник", FillWeight = 22, SortMode = DataGridViewColumnSortMode.Automatic });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Требование", FillWeight = 34, SortMode = DataGridViewColumnSortMode.Automatic });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Срок", FillWeight = 12, SortMode = DataGridViewColumnSortMode.Automatic });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Статус", FillWeight = 18, SortMode = DataGridViewColumnSortMode.Automatic });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Основание", FillWeight = 24, SortMode = DataGridViewColumnSortMode.Automatic });
            ViewsFx.EnableDoubleBuffering(_grid);

            var gridHost = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Margin = new Padding(0) };
            gridHost.Controls.Add(_grid);
            _empty = ViewsFx.CreateEmptyState();
            gridHost.Controls.Add(_empty);
            _empty.BringToFront();
            _surface.Controls.Add(gridHost);
            gridHost.BringToFront();

            Fill();

            UpdateChromeHeights();
            _surface.Resize += delegate { UpdateChromeHeights(); };
            HandleCreated += delegate
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate { UpdateChromeHeights(); });
                }
                catch
                {
                    // Контрол уже закрывается — пересчёт не нужен.
                }
            };
        }

        private Control DeadlineButton(string text, EventHandler onClick, bool primary)
        {
            int width = primary ? 130 : 110;
            int measured = TextRenderer.MeasureText(
                text, Ui.Font(12.5f, primary ? FontStyle.Bold : FontStyle.Regular)).Width + 30;
            if (measured > width) width = measured;
            var button = new PillButton
            {
                Text = text,
                Primary = primary,
                Width = width,
                Height = 34,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.Click += onClick;
            return button;
        }

        /// <summary>Та же страховка, что и в TableView: при сужении окна кнопки переносятся.</summary>
        private void UpdateChromeHeights()
        {
            if (_adjustingChrome) return;
            if (IsDisposed || _surface == null || _surface.IsDisposed || _toolbar == null || _toolbar.IsDisposed) return;
            _adjustingChrome = true;
            try
            {
                int width = _surface != null ? _surface.ClientSize.Width : Width;
                if (width < 240) return;
                int available = Math.Max(160, width - 24);
                int wanted = ViewsFx.MeasureFlowHeight(_toolbar, available);
                if (wanted > _toolbar.Height + 2)
                {
                    if (_toolbar.MinimumSize.Height != wanted) _toolbar.MinimumSize = new Size(0, wanted);
                }
                else if (_toolbar.MinimumSize.Height != 0)
                {
                    _toolbar.MinimumSize = Size.Empty;
                }
            }
            finally
            {
                _adjustingChrome = false;
            }
        }

        private int FilterMode()
        {
            return _filter.SelectedIndex;
        }

        private void Fill()
        {
            _grid.Rows.Clear();
            var all = _store.Obligations.Select(J.Obj).Where(o => o != null).ToList();
            int mode = FilterMode();
            IEnumerable<Dictionary<string, object>> selected;
            if (mode == 3)
            {
                selected = all.Where(ObligationsEngine.IsDone);
            }
            else
            {
                selected = all.Where(o => !ObligationsEngine.IsDone(o));
                if (mode == 1) selected = selected.Where(o => ObligationsEngine.DaysLeft(o) < 0);
                if (mode == 2)
                {
                    selected = selected.Where(o =>
                    {
                        int days = ObligationsEngine.DaysLeft(o);
                        return days >= 0 && days <= 7;
                    });
                }
            }

            var ordered = mode == 3
                ? selected.OrderByDescending(o => J.Str(J.Get(o, "completedAt")))
                : selected.OrderBy(ObligationsEngine.DaysLeft);

            int overdue = 0;
            foreach (var obligation in ordered)
            {
                int index = _grid.Rows.Add(
                    ObligationsEngine.EmployeeName(_store, J.Str(J.Get(obligation, "employeeRowId"))),
                    J.Str(J.Get(obligation, "title")),
                    ObligationsEngine.DueLabel(obligation),
                    ObligationsEngine.StatusLabel(obligation),
                    J.Str(J.Get(obligation, "legalBasis")));
                _grid.Rows[index].Tag = obligation;
                if (!ObligationsEngine.IsDone(obligation) && ObligationsEngine.DaysLeft(obligation) < 0)
                {
                    _grid.Rows[index].DefaultCellStyle.ForeColor = Theme.Danger;
                    overdue++;
                }
            }
            _summary.Text = string.Format("записей: {0}  ·  просрочено: {1}", _grid.Rows.Count, overdue);
            ViewsFx.ShowEmpty(_empty, EmptyText(mode));
        }

        /// <summary>Пояснение для пустой выборки: текст зависит от выбранного фильтра.</summary>
        private string EmptyText(int mode)
        {
            if (_grid.Rows.Count > 0) return null;
            if (mode == 3) return "Выполненных требований пока нет.";
            if (mode == 1) return "Просроченных требований нет — все сроки соблюдены.";
            if (mode == 2) return "В ближайшие 7 дней сроков нет.";
            return "Активных требований нет. Добавьте работника в «Список работников» — " +
                   "программа сама создаст требования по приёму.";
        }

        private void CompleteSelected()
        {
            if (_grid.CurrentRow == null)
            {
                ViewsFx.Say("Выберите требование: щёлкните по строке в таблице.", NoticeKind.Info);
                return;
            }
            var obligation = _grid.CurrentRow.Tag as Dictionary<string, object>;
            if (obligation == null) return;
            if (ObligationsEngine.IsDone(obligation))
            {
                ViewsFx.Say("Требование уже выполнено.", NoticeKind.Info);
                return;
            }
            string title = J.Str(J.Get(obligation, "title"));
            ObligationsEngine.Complete(_store, obligation);
            Fill();
            _onChanged();
            ViewsFx.Say("Требование «" + title + "» отмечено выполненным.", NoticeKind.Success);
        }
    }
}
