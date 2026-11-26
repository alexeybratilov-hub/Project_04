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
            BackColor = Theme.Canvas;

            var toolbar = new FlowLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 46,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(0, 6, 0, 6)
            };
            Controls.Add(toolbar);

            toolbar.Controls.Add(ToolButton("Добавить запись", delegate { AddRow(); }, true));
            toolbar.Controls.Add(ToolButton("Изменить", delegate { EditRow(); }, false));
            toolbar.Controls.Add(ToolButton("Удалить", delegate { DeleteRows(); }, false));
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
                BackgroundColor = Theme.Surface,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                ReadOnly = true,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = true,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
                ColumnHeadersHeight = 36,
                ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing,
                RowTemplate = { Height = 30 },
                GridColor = Theme.Line,
                Font = Theme.Font(9.25f)
            };
            _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(0xF1, 0xF5, 0xF9);
            _grid.ColumnHeadersDefaultCellStyle.ForeColor = Theme.Ink;
            _grid.ColumnHeadersDefaultCellStyle.Font = Theme.Font(8.75f, FontStyle.Bold);
            _grid.ColumnHeadersDefaultCellStyle.Padding = new Padding(6, 0, 6, 0);
            _grid.DefaultCellStyle.SelectionBackColor = Theme.SoftAccent;
            _grid.DefaultCellStyle.SelectionForeColor = Theme.Ink;
            _grid.DefaultCellStyle.Padding = new Padding(6, 0, 6, 0);
            _grid.EnableHeadersVisualStyles = false;
            _grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex >= 0) EditRow();
            };
            Controls.Add(_grid);
            _grid.BringToFront();

            BuildColumns();
            Reload();
        }

        private Button ToolButton(string text, EventHandler onClick, bool primary)
        {
            var button = new Button
            {
                Text = text,
                Height = 32,
                AutoSize = true,
                Padding = new Padding(12, 0, 12, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = primary ? Theme.Accent : Theme.Surface,
                ForeColor = primary ? Theme.AccentInk : Theme.Ink,
                Font = Theme.Font(9f, primary ? FontStyle.Bold : FontStyle.Regular),
                Cursor = Cursors.Hand,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.FlatAppearance.BorderSize = primary ? 0 : 1;
            button.FlatAppearance.BorderColor = Theme.Line;
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
                    string hireDate = J.Str(J.Get(row, "emp_hire_date"));
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
            }
            using (var dialog = new RowEditorForm(Columns, row, "Изменение записи"))
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
                builder.AppendLine(string.Join(";", Columns.Select(c => EscapeCsv(J.Str(J.Get(c, "name"))))));
                foreach (var row in _rows)
                {
                    builder.AppendLine(string.Join(";", Columns.Select(c => EscapeCsv(J.Str(J.Get(row, J.Str(J.Get(c, "id"))))))));
                }
                File.WriteAllText(dialog.FileName, builder.ToString(), new UTF8Encoding(true));
                MessageBox.Show("Экспортировано записей: " + _rows.Count, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static string EscapeCsv(string value)
        {
            if (value.IndexOfAny(new[] { ';', '"', '\n' }) < 0) return value;
            return "\"" + value.Replace("\"", "\"\"") + "\"";
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
            BackColor = Theme.Canvas;

            var toolbar = new FlowLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 46,
                Padding = new Padding(0, 6, 0, 6),
                WrapContents = false
            };
            Controls.Add(toolbar);

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
                BackgroundColor = Theme.Surface,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                ReadOnly = true,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                ColumnHeadersHeight = 36,
                RowTemplate = { Height = 30 },
                GridColor = Theme.Line,
                Font = Theme.Font(9.25f)
            };
            _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(0xF1, 0xF5, 0xF9);
            _grid.ColumnHeadersDefaultCellStyle.Font = Theme.Font(8.75f, FontStyle.Bold);
            _grid.DefaultCellStyle.SelectionBackColor = Theme.SoftAccent;
            _grid.DefaultCellStyle.SelectionForeColor = Theme.Ink;
            _grid.EnableHeadersVisualStyles = false;
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Работник", FillWeight = 22 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Требование", FillWeight = 34 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Срок", FillWeight = 12 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Статус", FillWeight = 18 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Основание", FillWeight = 24 });
            Controls.Add(_grid);
            _grid.BringToFront();

            Fill();
        }

        private Button DeadlineButton(string text, EventHandler onClick, bool primary)
        {
            var button = new Button
            {
                Text = text,
                Height = 32,
                AutoSize = true,
                Padding = new Padding(12, 0, 12, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = primary ? Theme.Accent : Theme.Surface,
                ForeColor = primary ? Theme.AccentInk : Theme.Ink,
                Font = Theme.Font(9f, primary ? FontStyle.Bold : FontStyle.Regular),
                Cursor = Cursors.Hand,
                Margin = new Padding(0, 1, 6, 0)
            };
            button.FlatAppearance.BorderSize = primary ? 0 : 1;
            button.FlatAppearance.BorderColor = Theme.Line;
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
