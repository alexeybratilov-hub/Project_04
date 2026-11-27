using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>
    /// Экран «Готовность к проверке ГИТ»: индекс по 9 направлениям и список того,
    /// что стоит добрать. Данные берутся из базы, экспорт — в PDF и CSV.
    /// </summary>
    internal sealed class ReadinessView : UserControl
    {
        private readonly Store _store;
        private readonly Label _score;
        private readonly Label _verdict;
        private readonly DataGridView _grid;
        private ReadinessReport _report;

        public ReadinessView(Store store)
        {
            _store = store;
            BackColor = Color.Transparent;
            DoubleBuffered = true;

            var surface = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(12), Margin = new Padding(0) };
            Controls.Add(surface);

            var layout = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 5
            };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            surface.Controls.Add(layout);

            var header = new Label
            {
                Dock = DockStyle.Fill,
                Text = "Готовность к проверке ГИТ",
                Font = Ui.Font(20f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Padding = new Padding(6, 6, 0, 0)
            };
            layout.Controls.Add(header, 0, 0);

            var scoreRow = new TransparentFlow { Dock = DockStyle.Fill, WrapContents = false, Padding = new Padding(6, 2, 0, 0) };
            layout.Controls.Add(scoreRow, 0, 1);
            _score = new Label
            {
                AutoSize = true,
                Text = "—",
                Font = Ui.Font(17f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 2, 14, 0)
            };
            scoreRow.Controls.Add(_score);
            _verdict = new Label
            {
                AutoSize = true,
                Text = string.Empty,
                Font = Ui.Font(11.5f),
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 8, 0, 0)
            };
            scoreRow.Controls.Add(_verdict);

            var toolbar = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(4, 8, 0, 6)
            };
            layout.Controls.Add(toolbar, 0, 2);

            var refresh = new PillButton { Text = "Обновить", Width = 120, Height = 32, Margin = new Padding(0, 0, 8, 0) };
            refresh.Click += delegate { RefreshReport(); };
            toolbar.Controls.Add(refresh);

            var pdf = new PillButton { Text = "Экспорт PDF", Primary = true, Width = 150, Height = 32, Margin = new Padding(0, 0, 8, 0) };
            pdf.Click += delegate { ExportPdf(); };
            toolbar.Controls.Add(pdf);

            var csv = new PillButton { Text = "Экспорт CSV", Width = 150, Height = 32 };
            csv.Click += delegate { ExportCsv(); };
            toolbar.Controls.Add(csv);

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
                ColumnHeadersHeight = 36,
                ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing,
                RowTemplate = { Height = 46 },
                GridColor = Color.FromArgb(0xE8, 0xEE, 0xF7),
                Font = Ui.Font(11.5f),
                ShowCellToolTips = true
            };
            _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(0xF6, 0xF9, 0xFD);
            _grid.ColumnHeadersDefaultCellStyle.ForeColor = Ui.Ink;
            _grid.ColumnHeadersDefaultCellStyle.Font = Ui.Font(11f, FontStyle.Bold);
            _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(0xE0, 0xEA, 0xFF);
            _grid.DefaultCellStyle.SelectionForeColor = Ui.Ink;
            _grid.DefaultCellStyle.WrapMode = DataGridViewTriState.False;
            _grid.EnableHeadersVisualStyles = false;
            layout.Controls.Add(_grid, 0, 3);

            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Направление", Width = 330 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Балл", Width = 80 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Статус", Width = 110 });
            _grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Что улучшить", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });

            var footer = new Label
            {
                Dock = DockStyle.Fill,
                Text = GitReadiness.Disclaimer,
                Font = Ui.Font(10f),
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Padding = new Padding(6, 8, 6, 0)
            };
            layout.Controls.Add(footer, 0, 4);

            RefreshReport();
        }

        private void RefreshReport()
        {
            _report = GitReadiness.Evaluate(_store);
            _score.Text = _report.Percent + "%";
            _score.ForeColor = _report.Level == "high" ? Ui.Emerald : _report.Level == "medium" ? Ui.Amber : Ui.Rose;
            _verdict.Text = _report.Verdict + "   ·   без замечаний: " + _report.PassedCount +
                            "   ·   предупреждений: " + _report.WarningCount +
                            "   ·   критично: " + _report.CriticalCount;

            _grid.Rows.Clear();
            foreach (var item in _report.Items)
            {
                int index = _grid.Rows.Add(
                    item.Title,
                    item.Score + " из " + item.MaxScore,
                    GitReadiness.StatusLabel(item.Status),
                    item.Advice == "—" ? item.Summary : item.Advice);
                _grid.Rows[index].Cells[2].Style.ForeColor =
                    item.Status == "ok" ? Ui.Emerald : item.Status == "warn" ? Ui.Amber : Ui.Rose;
                _grid.Rows[index].Cells[3].ToolTipText = item.Summary;
            }
        }

        private void ExportPdf()
        {
            try
            {
                string directory = Path.Combine(_store.DataRoot, "documents", "Отчёты");
                Directory.CreateDirectory(directory);
                string name = "Готовность к ГИТ " + DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".pdf";
                string path = Path.Combine(directory, name);
                PdfService.Save(path, "Готовность к проверке ГИТ", GitReadiness.ToText(_report));
                Shell.Notify("Отчёт сохранён:\n" + path, NoticeKind.Info);
            }
            catch (Exception ex)
            {
                Shell.Notify("Не удалось сохранить PDF: " + ex.Message, NoticeKind.Warning);
            }
        }

        private void ExportCsv()
        {
            using (var dialog = new SaveFileDialog
            {
                Filter = "CSV (*.csv)|*.csv",
                FileName = "Готовность к ГИТ " + DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".csv"
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    File.WriteAllText(dialog.FileName, GitReadiness.ToCsv(_report), new System.Text.UTF8Encoding(true));
                    Shell.Notify("Отчёт сохранён:\n" + dialog.FileName, NoticeKind.Info);
                }
                catch (Exception ex)
                {
                    Shell.Notify("Не удалось сохранить CSV: " + ex.Message, NoticeKind.Warning);
                }
            }
        }
    }
}
