using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>
    /// Нормативная база: что именно требуется по каждому событию, с какой
    /// периодичностью и на каком основании. Работает офлайн — правила лежат в
    /// каталоге модулей, а не загружаются из интернета.
    /// </summary>
    internal sealed class NormsView : UserControl
    {
        private readonly Store _store;
        private readonly DataGridView _grid;
        private readonly TextBox _search;
        private readonly Label _summary;

        public NormsView(Store store)
        {
            _store = store;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            var surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(surface);

            // Раскладка строками, а не Dock-порядком: иначе шапка и панель поиска
            // выстраиваются задом наперёд (WinForms стыкует последний добавленный первым).
            var layout = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 4
            };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            surface.Controls.Add(layout);

            var header = new Label
            {
                Dock = DockStyle.Fill,
                Text = "Нормативная база",
                Font = Ui.Font(20f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Padding = new Padding(6, 4, 0, 0)
            };
            layout.Controls.Add(header, 0, 0);

            var hint = new Label
            {
                Dock = DockStyle.Fill,
                Text = "Требования формируются автоматически по событиям (приём, перевод, увольнение, несчастный случай). " +
                       "Периодичность: медосмотр — приказ Минздрава № 29н, СИЗ — приказ Минтруда № 766н, инструктажи — постановление № 2464. " +
                       "Это справочник, а не замена нормативных актов.",
                Font = Ui.Font(11.5f),
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Padding = new Padding(6, 0, 6, 0)
            };
            layout.Controls.Add(hint, 0, 1);

            var toolbar = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(4, 8, 0, 6)
            };
            layout.Controls.Add(toolbar, 0, 2);

            toolbar.Controls.Add(new Label
            {
                Text = "Поиск по требованиям:",
                AutoSize = true,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f),
                Margin = new Padding(0, 6, 6, 0)
            });

            _search = new TextBox
            {
                Width = 340,
                Font = Ui.Font(11.5f),
                Margin = new Padding(0, 2, 4, 0)
            };
            ViewsFx.SetPlaceholder(_search, "Например: медосмотр, СИЗ, 29н");
            _search.TextChanged += delegate { Fill(); };
            toolbar.Controls.Add(_search);

            var clear = new PillButton { Text = "✕", Width = 34, Height = 27, Radius = 8, Hint = "Очистить поиск" };
            clear.Margin = new Padding(0, 3, 10, 0);
            clear.Click += delegate { _search.Clear(); _search.Focus(); };
            toolbar.Controls.Add(clear);

            _summary = new Label
            {
                AutoSize = true,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f),
                Margin = new Padding(6, 6, 0, 0)
            };
            toolbar.Controls.Add(_summary);

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
                MultiSelect = false,
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
            _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(0xE0, 0xEA, 0xFF);
            _grid.DefaultCellStyle.SelectionForeColor = Ui.Ink;
            _grid.EnableHeadersVisualStyles = false;
            ViewsFx.AttachCellToolTips(_grid);
            _grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex < 0) return;
                Shell.Notify(CellText(e.RowIndex, 4), NoticeKind.Info);
            };
            layout.Controls.Add(_grid, 0, 3);

            _grid.Columns.Add(MakeColumn("requirement", "Требование", 360));
            _grid.Columns.Add(MakeColumn("event", "Событие", 130));
            _grid.Columns.Add(MakeColumn("module", "Модуль", 170));
            _grid.Columns.Add(MakeColumn("term", "Срок / периодичность", 230));
            _grid.Columns.Add(MakeColumn("basis", "Нормативное основание", 300));
            _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;

            Fill();
        }

        private static DataGridViewTextBoxColumn MakeColumn(string name, string header, int width)
        {
            return new DataGridViewTextBoxColumn
            {
                Name = name,
                HeaderText = header,
                Width = width,
                SortMode = DataGridViewColumnSortMode.NotSortable
            };
        }

        private string CellText(int rowIndex, int columnIndex)
        {
            object value = _grid.Rows[rowIndex].Cells[columnIndex].Value;
            return value == null ? string.Empty : value.ToString();
        }

        private void Fill()
        {
            string query = _search.Text.Trim().ToLowerInvariant();
            _grid.Rows.Clear();
            int shown = 0;
            foreach (ObligationRule rule in _store.Catalog.Rules)
            {
                string module = _store.Catalog.Module(rule.ModuleId) != null
                    ? _store.Catalog.Module(rule.ModuleId).Title
                    : rule.ModuleId;
                string row = string.Join(" ", new[]
                {
                    rule.Title, EventLabel(rule.Event), module, TermLabel(rule), rule.LegalBasis
                }).ToLowerInvariant();
                if (query.Length > 0 && !row.Contains(query)) continue;

                _grid.Rows.Add(rule.Title, EventLabel(rule.Event), module, TermLabel(rule), rule.LegalBasis);
                shown++;
            }
            _summary.Text = string.Format("показано {0} из {1} требований", shown, _store.Catalog.Rules.Count);
        }

        private static string EventLabel(string eventId)
        {
            switch (eventId)
            {
                case "hire": return "Приём";
                case "transfer": return "Перевод";
                case "dismissal": return "Увольнение";
                case "accident": return "Несчастный случай";
                default: return string.IsNullOrEmpty(eventId) ? "—" : eventId;
            }
        }

        private static string TermLabel(ObligationRule rule)
        {
            var parts = new List<string>();
            if (rule.OffsetDays != 0)
            {
                parts.Add(rule.OffsetDays > 0
                    ? "через " + rule.OffsetDays + " дн."
                    : "за " + Math.Abs(rule.OffsetDays) + " дн.");
            }
            else
            {
                parts.Add("в день события");
            }
            if (rule.PeriodicityMonths.HasValue && rule.PeriodicityMonths.Value > 0)
            {
                parts.Add("повтор каждые " + rule.PeriodicityMonths.Value + " мес.");
            }
            if (rule.PeriodicityBySoutClass.Count > 0)
            {
                var classes = rule.PeriodicityBySoutClass
                    .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(pair => pair.Key + " → " + pair.Value + " мес.");
                parts.Add("по классу СОУТ: " + string.Join(", ", classes));
            }
            return string.Join("; ", parts);
        }
    }
}
