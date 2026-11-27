using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>
    /// Шаблоны документов: встроенные (каталог) и свои (текст с тегами).
    /// Свои шаблоны хранятся в организации, поэтому переносятся вместе с базой
    /// и не теряются при обновлении программы.
    /// </summary>
    internal sealed class TemplatesForm : GlassForm
    {
        private readonly Store _store;
        private readonly ListBox _list;
        private readonly TextBox _name;
        private readonly TextBox _category;
        private readonly ComboBox _tab;
        private readonly TextBox _content;
        private readonly ComboBox _employee;
        private readonly Label _status;

        private readonly List<TemplateItem> _items = new List<TemplateItem>();
        private TemplateItem _current;

        public bool Changed;

        private static readonly string[] Tags =
        {
            "{ФИО}", "{Должность}", "{Подразделение}", "{Табельный}", "{СНИЛС}",
            "{Организация}", "{Краткое}", "{ИНН}", "{КПП}", "{ОГРН}", "{Адрес}",
            "{Директор}", "{Телефон}", "{Email}",
            "{Дата_приёма}", "{Дата_события}", "{Сегодня}", "{Номер}"
        };

        public TemplatesForm(Store store)
            : base("Шаблоны документов", new Size(1080, 720))
        {
            _store = store;

            var layout = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 330));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Body.Controls.Add(layout);

            // ---------- список шаблонов
            var left = new TransparentPanel { Dock = DockStyle.Fill, Padding = new Padding(0, 0, 12, 0) };
            layout.Controls.Add(left, 0, 0);

            var listButtons = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 116,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(0, 6, 0, 0)
            };
            left.Controls.Add(listButtons);

            var newButton = new PillButton { Text = "Новый шаблон", Width = 190, Height = 34, Margin = new Padding(0, 0, 0, 6) };
            newButton.Click += delegate { StartNew(); };
            listButtons.Controls.Add(newButton);

            var deleteButton = new PillButton { Text = "Удалить свой", Width = 170, Height = 34 };
            deleteButton.Click += delegate { DeleteCurrent(); };
            listButtons.Controls.Add(deleteButton);

            _list = new ListBox
            {
                Dock = DockStyle.Fill,
                Font = Ui.Font(12f),
                BorderStyle = BorderStyle.FixedSingle,
                IntegralHeight = false
            };
            _list.SelectedIndexChanged += delegate { LoadCurrent(); };
            left.Controls.Add(_list);
            _list.BringToFront();

            left.Controls.Add(new Label
            {
                Text = "Шаблоны организации и встроенные",
                Dock = DockStyle.Top,
                Height = 26,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f)
            });

            // ---------- редактор
            var right = new TransparentPanel { Dock = DockStyle.Fill };
            layout.Controls.Add(right, 1, 0);

            // Строгие строки вместо Dock-порядка: у WinForms «последний добавленный
            // стыкуется первым», из-за чего поля уезжали под список.
            var rows = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 5
            };
            rows.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            rows.RowStyles.Add(new RowStyle(SizeType.Absolute, 96));
            rows.RowStyles.Add(new RowStyle(SizeType.Absolute, 84));
            rows.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            rows.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
            right.Controls.Add(rows);

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = true,
                Padding = new Padding(0, 6, 0, 0)
            };
            rows.Controls.Add(footer, 0, 4);

            var close = new PillButton { Text = "Закрыть", Width = 110, Height = 36 };
            close.Click += delegate { Close(); };
            footer.Controls.Add(close);

            var generate = new PillButton { Text = "Сформировать DOCX", Primary = true, Width = 210, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            generate.Click += delegate { Generate(); };
            footer.Controls.Add(generate);

            _employee = new ComboBox
            {
                Width = 300,
                Height = 34,
                DropDownStyle = ComboBoxStyle.DropDownList,
                Font = Ui.Font(11.5f),
                Margin = new Padding(0, 2, 8, 0)
            };
            footer.Controls.Add(_employee);

            var save = new PillButton { Text = "Сохранить как свой", Width = 200, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            save.Click += delegate { SaveTemplate(); };
            footer.Controls.Add(save);

            var meta = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 2
            };
            meta.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
            meta.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            rows.Controls.Add(meta, 0, 1);

            meta.Controls.Add(FieldLabel("Название"), 0, 0);
            _name = new TextBox { Dock = DockStyle.Fill, Font = Ui.Font(12f), Margin = new Padding(0, 4, 0, 4) };
            meta.Controls.Add(_name, 1, 0);

            meta.Controls.Add(FieldLabel("Категория / вкладка"), 0, 1);
            var secondRow = new TransparentFlow { Dock = DockStyle.Fill, WrapContents = false, Padding = new Padding(0, 2, 0, 0) };
            meta.Controls.Add(secondRow, 1, 1);
            _category = new TextBox { Width = 260, Font = Ui.Font(12f), Margin = new Padding(0, 2, 8, 0) };
            secondRow.Controls.Add(_category);
            _tab = new ComboBox { Width = 320, DropDownStyle = ComboBoxStyle.DropDownList, Font = Ui.Font(11.5f), Margin = new Padding(0, 2, 0, 0) };
            secondRow.Controls.Add(_tab);

            var tagFlow = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                WrapContents = true,
                Padding = new Padding(0, 2, 0, 2)
            };
            rows.Controls.Add(tagFlow, 0, 2);
            tagFlow.Controls.Add(new Label
            {
                Text = "Теги:",
                AutoSize = true,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f),
                Margin = new Padding(0, 8, 6, 0)
            });
            foreach (string tag in Tags)
            {
                string captured = tag;
                var chip = new PillButton { Text = captured, Width = 92, Height = 26, Radius = 8, Margin = new Padding(0, 3, 4, 3) };
                chip.Click += delegate { InsertTag(captured); };
                tagFlow.Controls.Add(chip);
            }

            _status = new Label
            {
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f),
                TextAlign = ContentAlignment.MiddleLeft
            };
            rows.Controls.Add(_status, 0, 0);

            _content = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ScrollBars = ScrollBars.Both,
                WordWrap = true,
                AcceptsReturn = true,
                Font = new Font("Consolas", 11f),
                BorderStyle = BorderStyle.FixedSingle,
                Margin = new Padding(0)
            };
            rows.Controls.Add(_content, 0, 3);
            _content.BringToFront();

            RefreshAll();
        }

        private static Label FieldLabel(string text)
        {
            return new Label
            {
                Text = text,
                AutoSize = true,
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Font = Ui.Font(12f),
                Margin = new Padding(0, 8, 8, 4)
            };
        }

        private void RefreshAll()
        {
            _items.Clear();
            foreach (var template in _store.Catalog.Templates)
            {
                _items.Add(new TemplateItem
                {
                    CatalogId = template.Id,
                    Name = template.Name,
                    Category = template.Category,
                    TabId = string.Empty,
                    Content = template.Content
                });
            }
            foreach (object item in J.Arr(J.Get(_store.Entity, "templates")))
            {
                var raw = J.Obj(item);
                if (raw == null) continue;
                string id = J.Str(J.Get(raw, "id"));
                if (id.Length == 0) continue;
                _items.Add(new TemplateItem
                {
                    EntityId = id,
                    Name = J.Str(J.Get(raw, "name")),
                    Category = J.Str(J.Get(raw, "category")),
                    TabId = J.Str(J.Get(raw, "tabId")),
                    Content = J.Str(J.Get(raw, "contentTemplate"))
                });
            }

            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (var item in _items)
            {
                _list.Items.Add(item);
            }
            _list.EndUpdate();

            _tab.Items.Clear();
            _tab.Items.Add(new TabItem(string.Empty, "(любая вкладка)"));
            foreach (object item in _store.Tabs)
            {
                var tab = J.Obj(item);
                if (tab == null) continue;
                _tab.Items.Add(new TabItem(J.Str(J.Get(tab, "id")), J.Str(J.Get(tab, "name"))));
            }

            _employee.Items.Clear();
            var employees = _store.FindTabByModule("employees");
            if (employees != null)
            {
                foreach (object item in J.Arr(J.Get(employees, "rows")))
                {
                    var row = J.Obj(item);
                    if (row == null) continue;
                    var info = Employees.Read(_store, row);
                    string label = info.Fio.Length == 0 ? "(без ФИО)" : info.Fio;
                    if (info.Position.Length > 0) label = label + " — " + info.Position;
                    _employee.Items.Add(new EmployeeItem(J.Str(J.Get(row, "id")), label));
                }
            }
            if (_employee.Items.Count > 0) _employee.SelectedIndex = 0;

            if (_list.Items.Count > 0) _list.SelectedIndex = 0;
        }

        private void LoadCurrent()
        {
            _current = _list.SelectedItem as TemplateItem;
            if (_current == null) return;

            _name.Text = _current.Name;
            _category.Text = _current.Category;
            _content.Text = _current.Content;

            int index = 0;
            for (int i = 0; i < _tab.Items.Count; i++)
            {
                var item = _tab.Items[i] as TabItem;
                if (item != null && item.Id == (_current.TabId ?? string.Empty)) { index = i; break; }
            }
            _tab.SelectedIndex = index;

            _status.Text = _current.EntityId == null
                ? "Встроенный шаблон: можно править и сохранить как свой (изменения встроенного не затрагиваются)."
                : "Свой шаблон организации: изменения сохраняются в базу.";
        }

        private void InsertTag(string tag)
        {
            int caret = _content.SelectionStart;
            _content.Text = _content.Text.Insert(caret, tag);
            _content.SelectionStart = caret + tag.Length;
            _content.Focus();
        }

        private void StartNew()
        {
            _list.ClearSelected();
            _current = null;
            _name.Text = "Новый шаблон";
            _category.Text = "Документы";
            _content.Text = "{Организация}\n\nДОКУМЕНТ\n\nРаботник: {ФИО}, должность: {Должность}\n\nДата: {Дата_события}\n\nРуководитель ________________ / {Директор} /";
            if (_tab.Items.Count > 0) _tab.SelectedIndex = 0;
            _status.Text = "Новый шаблон ещё не сохранён — нажмите «Сохранить как свой».";
            _name.Focus();
        }

        private void SaveTemplate()
        {
            string name = _name.Text.Trim();
            if (name.Length == 0)
            {
                MessageBox.Show("Укажите название шаблона.", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (_content.Text.Trim().Length == 0)
            {
                MessageBox.Show("Текст шаблона пуст.", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string tabId = _tab.SelectedItem is TabItem ? ((TabItem)_tab.SelectedItem).Id : string.Empty;
            var templates = J.Arr(J.Get(_store.Entity, "templates"));

            if (_current != null && _current.EntityId != null)
            {
                foreach (object item in templates)
                {
                    var raw = J.Obj(item);
                    if (raw == null || J.Str(J.Get(raw, "id")) != _current.EntityId) continue;
                    raw["name"] = name;
                    raw["category"] = _category.Text.Trim();
                    raw["tabId"] = tabId;
                    raw["contentTemplate"] = _content.Text;
                    break;
                }
            }
            else
            {
                var created = new Dictionary<string, object>
                {
                    { "id", "tpl_user_" + DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture) },
                    { "name", name },
                    { "category", _category.Text.Trim().Length == 0 ? "Документы" : _category.Text.Trim() },
                    { "tabId", tabId },
                    { "contentTemplate", _content.Text },
                    { "isBuiltIn", false },
                    { "sourceTemplateId", _current == null ? string.Empty : (_current.CatalogId ?? string.Empty) }
                };
                templates.Add(created);
            }

            J.Put(_store.Entity, "templates", templates.Cast<object>().ToArray());
            try
            {
                _store.Save();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось сохранить шаблон: " + ex.Message, "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            Changed = true;
            string keepName = name;
            RefreshAll();
            for (int i = 0; i < _list.Items.Count; i++)
            {
                var item = _list.Items[i] as TemplateItem;
                if (item != null && item.Name == keepName && item.EntityId != null) { _list.SelectedIndex = i; break; }
            }
            _status.Text = "Шаблон сохранён в организации.";
        }

        private void DeleteCurrent()
        {
            if (_current == null || _current.EntityId == null)
            {
                MessageBox.Show("Встроенный шаблон удалить нельзя — его можно только переопределить своим.", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string question = "Удалить шаблон «" + _current.Name + "»?\n\n" +
                              "Уже сформированные документы останутся в папке documents.";
            if (MessageBox.Show(question, "Шаблоны", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

            var templates = J.Arr(J.Get(_store.Entity, "templates"));
            var keep = templates.Where(item =>
            {
                var raw = J.Obj(item);
                return raw != null && J.Str(J.Get(raw, "id")) != _current.EntityId;
            }).ToList();
            J.Put(_store.Entity, "templates", keep.Cast<object>().ToArray());

            try
            {
                _store.Save();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось удалить: " + ex.Message, "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Changed = true;
            RefreshAll();
        }

        private void Generate()
        {
            var employee = _employee.SelectedItem as EmployeeItem;
            if (employee == null)
            {
                MessageBox.Show("В «Сотрудниках» пока нет работников — документ формировать не для кого.", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (_current == null)
            {
                MessageBox.Show("Сначала сохраните шаблон (кнопка «Сохранить как свой»).", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string templateId = _current.EntityId ?? _current.CatalogId;
            string path;
            try
            {
                path = DocxService.Generate(_store, employee.Id, templateId, ObligationsEngine.TodayIso());
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось сформировать документ: " + ex.Message, "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (path == null)
            {
                MessageBox.Show("Шаблон не найден. Сохраните его как свой и повторите.", "Шаблоны", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Changed = true;
            using (var preview = new DocxPreviewForm(path))
            {
                preview.ShowDialog(this);
            }
        }

        private sealed class TemplateItem
        {
            public string CatalogId;
            public string EntityId;
            public string Name;
            public string Category;
            public string TabId;
            public string Content;

            public override string ToString()
            {
                return (EntityId == null ? "встроенный · " : "свой · ") + (Name ?? "(без названия)");
            }
        }

        private sealed class TabItem
        {
            public readonly string Id;
            private readonly string _label;

            public TabItem(string id, string label)
            {
                Id = id;
                _label = label;
            }

            public override string ToString()
            {
                return _label;
            }
        }

        private sealed class EmployeeItem
        {
            public readonly string Id;
            private readonly string _label;

            public EmployeeItem(string id, string label)
            {
                Id = id;
                _label = label;
            }

            public override string ToString()
            {
                return _label;
            }
        }
    }
}
