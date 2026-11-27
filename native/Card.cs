using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>Карточка работника: требования, события и пакет документов.</summary>
    internal sealed class EmployeeCardForm : GlassForm
    {
        private readonly Store _store;
        private readonly Dictionary<string, object> _employee;
        private readonly Action _onChanged;
        private readonly ListView _list;
        private readonly Label _summary;
        private readonly ComboBox _eventType;
        private readonly DateTimePicker _eventDate;

        public EmployeeCardForm(Store store, Dictionary<string, object> employee, Action onChanged)
            : base("Карточка работника", new Size(880, 720))
        {
            _store = store;
            _employee = employee;
            _onChanged = onChanged;

            var empInfo = Employees.Read(store, employee);
            string fio = empInfo.Fio;
            string position = empInfo.Position;
            string department = empInfo.Department;
            string hireDate = empInfo.HireDate;

            var headerPanel = new TransparentPanel { Dock = DockStyle.Top, Height = 76 };
            Body.Controls.Add(headerPanel);
            headerPanel.Controls.Add(new Label
            {
                Text = fio,
                Font = Ui.Font(20f, FontStyle.Bold),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                AutoSize = true,
                Location = new Point(0, 0)
            });
            headerPanel.Controls.Add(new Label
            {
                Text = string.Format("{0}  ·  {1}  ·  приём {2}",
                    position.Length > 0 ? position : "должность не указана",
                    department.Length > 0 ? department : "подразделение не указано",
                    ObligationsEngine.ParseIso(hireDate).ToString("dd.MM.yyyy", CultureInfo.InvariantCulture)),
                Font = Ui.Font(12f),
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                AutoSize = true,
                Location = new Point(1, 34)
            });

            var actions = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 96,
                FlowDirection = FlowDirection.LeftToRight,
                Padding = new Padding(0, 6, 0, 0)
            };
            Body.Controls.Add(actions);

            var complete = new PillButton { Text = "Выполнено", Primary = true, Width = 140, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            complete.Click += delegate { CompleteSelected(); };
            actions.Controls.Add(complete);

            var package = new PillButton { Text = "Сформировать пакет", Width = 190, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            package.Click += delegate { GeneratePackage(); };
            actions.Controls.Add(package);

            var openFolder = new PillButton { Text = "Открыть документы", Width = 176, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            openFolder.Click += delegate { OpenDocumentsFolder(); };
            actions.Controls.Add(openFolder);

            var preview = new PillButton { Text = "Просмотр документа", Width = 190, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            preview.Click += delegate { PreviewLatestDocument(); };
            actions.Controls.Add(preview);

            _eventType = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Width = 180,
                Font = Ui.Font(12f),
                Margin = new Padding(0, 4, 8, 0)
            };
            _eventType.Items.AddRange(new object[] { "Приём", "Перевод", "Увольнение", "Несчастный случай" });
            _eventType.SelectedIndex = 0;
            actions.Controls.Add(_eventType);

            _eventDate = new DateTimePicker
            {
                Width = 130,
                Format = DateTimePickerFormat.Custom,
                CustomFormat = "dd.MM.yyyy",
                Font = Ui.Font(12f),
                Value = DateTime.Today,
                Margin = new Padding(0, 6, 8, 0)
            };
            actions.Controls.Add(_eventDate);

            var register = new PillButton { Text = "Зарегистрировать событие", Width = 218, Height = 36 };
            register.Click += delegate { RegisterEvent(); };
            actions.Controls.Add(register);

            _summary = new Label
            {
                Dock = DockStyle.Top,
                Height = 26,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f)
            };
            Body.Controls.Add(_summary);

            _list = new ListView
            {
                Dock = DockStyle.Fill,
                View = View.Details,
                FullRowSelect = true,
                GridLines = false,
                BorderStyle = BorderStyle.None,
                BackColor = Color.FromArgb(0xFB, 0xFD, 0xFF),
                Font = Ui.Font(12f)
            };
            _list.Columns.Add("Требование", 300);
            _list.Columns.Add("Срок", 100);
            _list.Columns.Add("Статус", 170);
            _list.Columns.Add("Документ", 120);
            _list.Columns.Add("Основание", 190);
            _list.DoubleClick += delegate { CompleteSelected(); };
            Body.Controls.Add(_list);
            _list.BringToFront();

            ReloadObligations();
        }

        private string EmployeeId
        {
            get { return J.Str(J.Get(_employee, "id")); }
        }

        private List<Dictionary<string, object>> EmployeeObligations()
        {
            return _store.Obligations
                .Select(J.Obj)
                .Where(o => o != null && J.Str(J.Get(o, "employeeRowId")) == EmployeeId)
                .OrderBy(o => ObligationsEngine.DaysLeft(o))
                .ToList();
        }

        private void ReloadObligations()
        {
            var obligations = EmployeeObligations();
            _list.Items.Clear();
            foreach (var obligation in obligations)
            {
                var item = new ListViewItem(J.Str(J.Get(obligation, "title")));
                item.SubItems.Add(ObligationsEngine.DueLabel(obligation));
                item.SubItems.Add(ObligationsEngine.StatusLabel(obligation));
                item.SubItems.Add(J.Str(J.Get(obligation, "templateId")).Length > 0 ? "DOCX" : "—");
                item.SubItems.Add(J.Str(J.Get(obligation, "legalBasis")));
                item.Tag = obligation;
                if (ObligationsEngine.IsDone(obligation)) item.ForeColor = Ui.Muted;
                else if (ObligationsEngine.DaysLeft(obligation) < 0) item.ForeColor = Ui.Rose;
                _list.Items.Add(item);
            }

            int pending = obligations.Count(o => !ObligationsEngine.IsDone(o));
            int overdue = obligations.Count(o => !ObligationsEngine.IsDone(o) && ObligationsEngine.DaysLeft(o) < 0);
            _summary.Text = string.Format("Требований: {0}  ·  активных: {1}  ·  просрочено: {2}",
                obligations.Count, pending, overdue);
        }

        private void CompleteSelected()
        {
            if (_list.SelectedItems.Count == 0) return;
            var obligation = _list.SelectedItems[0].Tag as Dictionary<string, object>;
            if (obligation == null) return;
            if (ObligationsEngine.IsDone(obligation))
            {
                Shell.Notify("Требование уже выполнено.", NoticeKind.Info);
                return;
            }
            ObligationsEngine.Complete(_store, obligation);
            ReloadObligations();
            _onChanged();
        }

        private void GeneratePackage()
        {
            var obligations = EmployeeObligations().Where(o => !ObligationsEngine.IsDone(o)).ToList();
            int generated = 0;
            var errors = new List<string>();
            string lastFolder = null;

            foreach (var obligation in obligations)
            {
                string templateId = J.Str(J.Get(obligation, "templateId"));
                if (templateId.Length == 0) continue;
                try
                {
                    string path = DocxService.GenerateForObligation(_store, obligation);
                    if (path != null)
                    {
                        generated++;
                        lastFolder = Path.GetDirectoryName(path);
                    }
                }
                catch (Exception ex)
                {
                    errors.Add(J.Str(J.Get(obligation, "title")) + ": " + ex.Message);
                }
            }

            ReloadObligations();
            _onChanged();

            if (generated == 0)
            {
                Shell.Notify(errors.Count > 0
                        ? "Не удалось сформировать документы:\n" + string.Join("\n", errors.ToArray())
                        : "Нет активных требований с шаблоном документа.", NoticeKind.Info);
                return;
            }

            string message = "Сформировано документов: " + generated + ".\nПапка: " + (lastFolder ?? Path.Combine(_store.DataRoot, "documents"));
            if (errors.Count > 0) message += "\n\nОшибки:\n" + string.Join("\n", errors.ToArray());
            Shell.Notify(message, NoticeKind.Info);
        }

        private void RegisterEvent()
        {
            string[] types = { "hire", "transfer", "dismissal", "incident" };
            string type = types[Math.Max(0, _eventType.SelectedIndex)];
            string date = _eventDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            if (type == "dismissal")
            {
                _employee["emp_status"] = "Уволен";
            }

            ObligationsEngine.RegisterEvent(_store, _employee, type, date);
            ReloadObligations();
            _onChanged();
            Shell.Notify("Событие зарегистрировано: " + _eventType.SelectedItem + " от " + _eventDate.Value.ToString("dd.MM.yyyy") + ".", NoticeKind.Info);
        }

        private void OpenDocumentsFolder()
        {
            try
            {
                string folder = Path.Combine(_store.DataRoot, "documents");
                Directory.CreateDirectory(folder);
                System.Diagnostics.Process.Start("explorer.exe", "\"" + folder + "\"");
            }
            catch (Exception ex)
            {
                Shell.Notify(ex.Message, NoticeKind.Warning);
            }
        }

        private void PreviewLatestDocument()
        {
            string folder = Path.Combine(_store.DataRoot, "documents");
            if (!Directory.Exists(folder))
            {
                Shell.Notify("Документы ещё не формировались.", NoticeKind.Info);
                return;
            }
            var latest = Directory.GetFiles(folder, "*.docx", SearchOption.AllDirectories)
                .Select(path => new FileInfo(path))
                .OrderByDescending(info => info.LastWriteTimeUtc)
                .FirstOrDefault();
            if (latest == null)
            {
                Shell.Notify("Документы ещё не формировались.", NoticeKind.Info);
                return;
            }
            Shell.Sheet(new DocxPreviewForm(latest.FullName), null);
        }
    }
}
