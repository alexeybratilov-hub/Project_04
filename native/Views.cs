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
    internal sealed class TableView : UserControl
    {
        private readonly Store _store;
        private readonly Dictionary<string, object> _tab;
        private readonly Action _onChanged;
        private readonly DataGridView _grid;
        private readonly TextBox _search;
        private readonly Label _counter;
        private List<Dictionary<string, object>> _rows = new List<Dictionary<string, object>>();

        public TableView(Store store, Dictionary<string, object> tab, Action onChanged)
        {
            _store = store;
            _tab = tab;
            _onChanged = onChanged;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            var surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(surface);

            var toolbar = new TransparentFlow
            {
                Dock = DockStyle.Top,
                Height = 46,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(2, 4, 2, 6)
            };
            surface.Controls.Add(toolbar);

            toolbar.Controls.Add(ToolButton("Добавить запись", delegate { AddRow(); }, true));
            if (J.Str(J.Get(_tab, "moduleId")) == "employees")
            {
                toolbar.Controls.Add(ToolButton("Карточка", delegate { OpenEmployeeCard(); }, false));
            }
            toolbar.Controls.Add(ToolButton("Импорт Excel", delegate { ImportExcel(); }, false));
            toolbar.Controls.Add(ToolButton("Изменить", delegate { EditRow(); }, false));
            toolbar.Controls.Add(ToolButton("Удалить", delegate { DeleteRows(); }, false));
            toolbar.Controls.Add(ToolButton("Экспорт Excel", delegate { ExportXlsx(); }, false));
            toolbar.Controls.Add(ToolButton("Экспорт CSV", delegate { ExportCsv(); }, false));

            _search = new TextBox
            {
                Width = 260,
                Margin = new Padding(16, 3, 8, 0),
                Font = Theme.Font(9.25f)
            };
            _search.TextChanged += delegate { FillGrid(); };
            toolbar.Controls.Add(_search);

            _counter = new Label
            {
                AutoSize = true,
                ForeColor = Theme.Muted,
                Font = Theme.Font(8.75f),
                Margin = new Padding(8, 9, 0, 0)
            };
            toolbar.Controls.Add(_counter);

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
            _grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex < 0) return;
                if (J.Str(J.Get(_tab, "moduleId")) == "employees")
                {
                    OpenEmployeeCard();
                    return;
                }
                EditRow();
            };
            surface.Controls.Add(_grid);
            _grid.BringToFront();

            BuildColumns();
            Reload();
        }

        private Control ToolButton(string text, EventHandler onClick, bool primary)
        {
            var button = new PillButton
            {
                Text = text,
                Primary = primary,
                Width = primary ? 156 : 112,
                Height = 34,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.Click += onClick;
            return button;
        }

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
                    SortMode = DataGridViewColumnSortMode.NotSortable
                };
                _grid.Columns.Add(gridColumn);
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
        }

        private Dictionary<string, object> SelectedRow()
        {
            if (_grid.CurrentRow == null) return null;
            return _grid.CurrentRow.Tag as Dictionary<string, object>;
        }

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
            using (var dialog = new OpenFileDialog
            {
                Title = "Импорт из Excel",
                Filter = "Excel (*.xlsx)|*.xlsx"
            })
            {
                if (dialog.ShowDialog(FindForm()) != DialogResult.OK) return;

                try
                {
                    var sheetRows = XlsxReader.Read(dialog.FileName);
                    if (sheetRows.Count < 2)
                    {
                        MessageBox.Show("В файле нет строк с данными.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }

                    string[] headers = sheetRows[0];
                    var columns = Columns;
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

                    J.Put(_tab, "columns", columns.Cast<object>().ToArray());

                    string question = string.Format(
                        "Строк с данными: {0}\nКолонок в файле: {1}\nНовых колонок: {2}\n\nИмпортировать в «{3}»?",
                        sheetRows.Count - 1, headers.Length, addedColumns.Count, J.Str(J.Get(_tab, "name")));
                    if (MessageBox.Show(question, "Импорт из Excel", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

                    bool isEmployees = J.Str(J.Get(_tab, "moduleId")) == "employees";
                    var columnMeta = columns
                        .GroupBy(c => J.Str(J.Get(c, "id")))
                        .ToDictionary(g => g.Key, g => g.First());
                    string stamp = DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
                    int imported = 0;
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

                        if (isEmployees)
                        {
                            var info = Employees.Read(_store, row);
                            if (info.Fio.Length > 0)
                            {
                                string hireDate = info.HireDate.Length > 0 ? info.HireDate : ObligationsEngine.TodayIso();
                                ObligationsEngine.RegisterEvent(_store, row, "hire", hireDate);
                            }
                        }
                    }

                    PersistRows();
                    BuildColumns();
                    Reload();
                    _onChanged();
                    MessageBox.Show(
                        "Импортировано строк: " + imported + "." +
                        (isEmployees ? "\nДля работников созданы требования по приёму." : string.Empty),
                        "Импорт из Excel",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Не удалось прочитать Excel: " + ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        private void OpenEmployeeCard()        {
            var row = SelectedRow();
            if (row == null)
            {
                MessageBox.Show("Выберите работника.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            using (var card = new EmployeeCardForm(_store, row, _onChanged))
            {
                card.ShowDialog(FindForm());
            }
            Reload();
            _onChanged();
        }

        private void AddRow()
        {
            using (var dialog = new RowEditorForm(Columns, null, "Новая запись"))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                var row = dialog.Result;
                row["id"] = "row_" + DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
                _rows.Add(row);
                PersistRows();

                if (J.Str(J.Get(_tab, "moduleId")) == "employees")
                {
                    string hireDate = Employees.Read(_store, row).HireDate;
                    if (hireDate.Length == 0) hireDate = ObligationsEngine.TodayIso();
                    ObligationsEngine.RegisterEvent(_store, row, "hire", hireDate);
                }
                _onChanged();
            }
        }

        private void EditRow()
        {
            var row = SelectedRow();
            if (row == null)
            {
                MessageBox.Show("Выберите строку.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }            using (var dialog = new RowEditorForm(Columns, row, "Изменение записи"))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                foreach (var pair in dialog.Result)
                {
                    row[pair.Key] = pair.Value;
                }
                PersistRows();
                Reload();
                _onChanged();
            }
        }

        private void DeleteRows()
        {
            if (_grid.SelectedRows.Count == 0)
            {
                MessageBox.Show("Выберите строки для удаления.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (MessageBox.Show(
                "Удалить выбранные записи (" + _grid.SelectedRows.Count + ")? Действие необратимо.",
                "ОТ-База",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning) != DialogResult.Yes) return;

            var ids = new HashSet<string>();
            foreach (DataGridViewRow gridRow in _grid.SelectedRows)
            {
                var row = gridRow.Tag as Dictionary<string, object>;
                if (row != null) ids.Add(J.Str(J.Get(row, "id")));
            }
            _rows.RemoveAll(r => ids.Contains(J.Str(J.Get(r, "id"))));
            PersistRows();
            Reload();
            _onChanged();
        }

        private void PersistRows()
        {
            J.Put(_tab, "rows", _rows.Cast<object>().ToArray());
            _store.Save();
        }

        private void ExportCsv()
        {
            using (var dialog = new SaveFileDialog
            {
                Filter = "CSV (*.csv)|*.csv",
                FileName = J.Str(J.Get(_tab, "name")) + "_" + DateTime.Today.ToString("yyyy-MM-dd") + ".csv"
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                var builder = new StringBuilder();
                builder.AppendLine(string.Join(";", Columns.Select(c => CsvExport.Escape(J.Str(J.Get(c, "name"))))));
                foreach (var row in _rows)
                {
                    builder.AppendLine(string.Join(";", Columns.Select(c => CsvExport.Escape(J.Str(J.Get(row, J.Str(J.Get(c, "id"))))))));
                }
                File.WriteAllText(dialog.FileName, builder.ToString(), new UTF8Encoding(true));
                MessageBox.Show("Экспортировано записей: " + _rows.Count, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                    MessageBox.Show(
                        "Экспортировано записей: " + rows.Count + ".\nФайл: " + dialog.FileName,
                        "Экспорт Excel",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Не удалось выгрузить Excel: " + ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

        public DeadlineView(Store store, Action onChanged)
        {
            _store = store;
            _onChanged = onChanged;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            var surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(surface);

            var toolbar = new TransparentFlow
            {
                Dock = DockStyle.Top,
                Height = 46,
                Padding = new Padding(2, 4, 2, 6),
                WrapContents = false
            };
            surface.Controls.Add(toolbar);

            toolbar.Controls.Add(new Label
            {
                Text = "Фильтр:",
                AutoSize = true,
                ForeColor = Theme.Muted,
                Margin = new Padding(0, 9, 6, 0)
            });

            _filter = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Width = 220,
                Font = Theme.Font(9.25f),
                Margin = new Padding(0, 3, 12, 0)
            };
            _filter.Items.AddRange(new object[] { "Все активные", "Просроченные", "Скоро (7 дней)", "Выполненные" });
            _filter.SelectedIndex = 0;
            _filter.SelectedIndexChanged += delegate { Fill(); };
            toolbar.Controls.Add(_filter);

            toolbar.Controls.Add(DeadlineButton("Выполнено", delegate { CompleteSelected(); }, true));
            toolbar.Controls.Add(DeadlineButton("Обновить", delegate { Fill(); }, false));

            _summary = new Label
            {
                AutoSize = true,
                ForeColor = Theme.Muted,
                Font = Theme.Font(8.75f),
                Margin = new Padding(16, 9, 0, 0)
            };
            toolbar.Controls.Add(_summary);

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
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Работник", FillWeight = 22 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Требование", FillWeight = 34 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Срок", FillWeight = 12 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Статус", FillWeight = 18 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Основание", FillWeight = 24 });
            surface.Controls.Add(_grid);
            _grid.BringToFront();

            Fill();
        }

        private Control DeadlineButton(string text, EventHandler onClick, bool primary)
        {
            var button = new PillButton
            {
                Text = text,
                Primary = primary,
                Width = primary ? 130 : 110,
                Height = 34,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.Click += onClick;
            return button;
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
        }

        private void CompleteSelected()
        {
            if (_grid.CurrentRow == null) return;
            var obligation = _grid.CurrentRow.Tag as Dictionary<string, object>;
            if (obligation == null) return;
            if (ObligationsEngine.IsDone(obligation))
            {
                MessageBox.Show("Требование уже выполнено.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            ObligationsEngine.Complete(_store, obligation);
            Fill();
            _onChanged();
        }
    }
}
