using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>Редактор строки: controls строятся по описанию колонок модуля.</summary>
    internal sealed class RowEditorForm : GlassForm
    {
        public Dictionary<string, object> Result = new Dictionary<string, object>();

        private readonly List<Dictionary<string, object>> _columns;
        private readonly Dictionary<string, object> _existing;
        private readonly Dictionary<string, Func<object>> _getters = new Dictionary<string, Func<object>>();
        private readonly Dictionary<string, string> _types = new Dictionary<string, string>();

        public RowEditorForm(List<Dictionary<string, object>> columns, Dictionary<string, object> existing, string title)
            : base(title, new Size(660, 600))
        {
            _columns = columns;
            _existing = existing != null ? new Dictionary<string, object>(existing) : new Dictionary<string, object>();

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 54,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 10, 0, 0)
            };
            Body.Controls.Add(footer);

            var save = new PillButton { Text = "Сохранить", Primary = true, Width = 138, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            save.Click += delegate { SaveAndClose(); };
            footer.Controls.Add(save);

            var cancel = new PillButton { Text = "Отмена", Width = 118, Height = 36 };
            cancel.Click += delegate { Close(); };
            footer.Controls.Add(cancel);

            var scroll = new TransparentPanel { Dock = DockStyle.Fill, AutoScroll = true };
            Body.Controls.Add(scroll);
            scroll.BringToFront();

            var table = new TransparentTable
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 2,
                Padding = new Padding(0, 0, 6, 0)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            scroll.Controls.Add(table);

            foreach (var column in columns)
            {
                string id = J.Str(J.Get(column, "id"));
                string name = J.Str(J.Get(column, "name"));
                string type = J.Str(J.Get(column, "type"));
                bool required = J.Str(J.Get(column, "required")) == "True";
                _types[id] = type;

                table.Controls.Add(new Label
                {
                    Text = name + (required ? " *" : string.Empty),
                    AutoSize = true,
                    ForeColor = Ui.Ink,
                    BackColor = Color.Transparent,
                    Margin = new Padding(0, 10, 8, 6),
                    Font = Ui.Font(12f, required ? FontStyle.Bold : FontStyle.Regular)
                });

                object value = J.Get(_existing, id);
                table.Controls.Add(BuildControl(column, id, type, value));
            }

            KeyPreview = true;
        }

        private Control BuildControl(Dictionary<string, object> column, string id, string type, object value)
        {
            string text = J.Str(value);
            Control control;

            if (type == "date")
            {
                var picker = new DateTimePicker
                {
                    Format = DateTimePickerFormat.Custom,
                    CustomFormat = "dd.MM.yyyy",
                    ShowCheckBox = true,
                    Checked = text.Length > 0,
                    Value = ObligationsEngine.ParseIso(text),
                    Width = 190,
                    Font = Ui.Font(12f),
                    Margin = new Padding(0, 7, 0, 4)
                };
                _getters[id] = delegate
                {
                    return picker.Checked ? picker.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : string.Empty;
                };
                control = picker;
            }
            else if (type == "select")
            {
                var combo = new ComboBox
                {
                    DropDownStyle = ComboBoxStyle.DropDownList,
                    Width = 300,
                    Font = Ui.Font(12f),
                    Margin = new Padding(0, 7, 0, 4)
                };
                combo.Items.Add(string.Empty);
                foreach (object option in J.Arr(J.Get(column, "options")))
                {
                    combo.Items.Add(J.Str(option));
                }
                combo.SelectedItem = text.Length > 0 && combo.Items.Contains(text) ? text : string.Empty;
                _getters[id] = delegate { return J.Str(combo.SelectedItem); };
                control = combo;
            }
            else if (type == "bool")
            {
                var check = new CheckBox
                {
                    Text = "да",
                    Checked = text == "True" || text == "true" || text == "1",
                    AutoSize = true,
                    Font = Ui.Font(12f),
                    BackColor = Color.Transparent,
                    Margin = new Padding(0, 9, 0, 4)
                };
                _getters[id] = delegate { return check.Checked ? "true" : "false"; };
                control = check;
            }
            else
            {
                var box = new TextBox
                {
                    Text = text,
                    Width = 380,
                    Font = Ui.Font(12f),
                    BorderStyle = BorderStyle.FixedSingle,
                    Margin = new Padding(0, 7, 0, 4)
                };
                _getters[id] = delegate { return box.Text.Trim(); };
                control = box;
            }

            var host = new TransparentPanel { AutoSize = true, Dock = DockStyle.Fill };
            host.Controls.Add(control);
            return host;
        }

        private void SaveAndClose()
        {
            var result = new Dictionary<string, object>();
            foreach (var column in _columns)
            {
                string id = J.Str(J.Get(column, "id"));
                string name = J.Str(J.Get(column, "name"));
                bool required = J.Str(J.Get(column, "required")) == "True";
                object value = _getters.ContainsKey(id) ? _getters[id]() : string.Empty;
                string text = J.Str(value);

                if (required && text.Length == 0)
                {
                    MessageBox.Show("Заполните поле «" + name + "».", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                if (_types[id] == "number" && text.Length > 0)
                {
                    decimal number;
                    if (!decimal.TryParse(text.Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out number))
                    {
                        MessageBox.Show("Поле «" + name + "» должно быть числом.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return;
                    }
                    text = number.ToString(CultureInfo.InvariantCulture);
                }

                result[id] = text;
            }

            Result = result;
            DialogResult = DialogResult.OK;
            Close();
        }
    }

    /// <summary>Каталог модулей: включение/выключение и создание своего этапа.</summary>
    internal sealed class ModulesForm : GlassForm
    {
        private readonly Store _store;
        private readonly CheckedListBox _list;
        private readonly TextBox _name;
        private readonly TextBox _columns;

        public ModulesForm(Store store)
            : base("Модули этапов", new Size(820, 680))
        {
            _store = store;

            var bottom = new TransparentPanel { Dock = DockStyle.Bottom, Height = 152 };
            Body.Controls.Add(bottom);

            var apply = new PillButton { Text = "Применить", Primary = true, Width = 150, Height = 38, Location = new Point(0, 8) };
            apply.Click += delegate { Apply(); };
            bottom.Controls.Add(apply);

            var close = new PillButton { Text = "Закрыть", Width = 120, Height = 38, Location = new Point(162, 10) };
            close.Click += delegate { Close(); };
            bottom.Controls.Add(close);

            var create = new PillButton { Text = "Создать модуль", Width = 156, Height = 34, Location = new Point(0, 64) };
            create.Click += delegate { CreateModule(); };
            bottom.Controls.Add(create);

            _name = new TextBox { Width = 240, Location = new Point(168, 64), Font = Ui.Font(12f) };
            bottom.Controls.Add(_name);

            _columns = new TextBox { Width = 330, Location = new Point(416, 64), Font = Ui.Font(12f) };
            bottom.Controls.Add(_columns);

            bottom.Controls.Add(new Label
            {
                Text = "Название этапа",
                Location = new Point(168, 98),
                AutoSize = true,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f)
            });
            bottom.Controls.Add(new Label
            {
                Text = "Колонки через запятую (необязательно)",
                Location = new Point(416, 98),
                AutoSize = true,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f)
            });

            var intro = new Label
            {
                Dock = DockStyle.Top,
                Height = 58,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f),
                Text = "Модуль — это этап работы: вкладка со своими колонками и правилами. Отключение скрывает этап, но не удаляет данные. Новый модуль создаётся копированием структуры и наполняется своим содержимым."
            };
            Body.Controls.Add(intro);

            _list = new CheckedListBox
            {
                Dock = DockStyle.Fill,
                CheckOnClick = true,
                Font = Ui.Font(12f),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.White,
                IntegralHeight = false
            };
            _list.ItemCheck += OnItemCheck;
            Body.Controls.Add(_list);
            _list.BringToFront();

            FillList();
        }

        private void FillList()
        {
            _list.Items.Clear();
            var installed = _store.InstalledModules;
            foreach (ModuleDef module in _store.Catalog.Modules)
            {
                string suffix = module.Base ? "  (базовый)" : module.Custom ? "  (свой)" : string.Empty;
                int index = _list.Items.Add(new ModuleItem(module, module.Title + suffix));
                _list.SetItemChecked(index, installed.Contains(module.Id));
            }
        }

        private void OnItemCheck(object sender, ItemCheckEventArgs e)
        {
            var item = _list.Items[e.Index] as ModuleItem;
            if (item == null) return;
            if (item.Module.Base && e.NewValue == CheckState.Unchecked)
            {
                e.NewValue = CheckState.Checked;
            }
        }

        private void Apply()
        {
            for (int i = 0; i < _list.Items.Count; i++)
            {
                var item = _list.Items[i] as ModuleItem;
                if (item == null) continue;
                bool wanted = _list.GetItemChecked(i);
                bool installed = _store.InstalledModules.Contains(item.Module.Id);
                if (wanted && !installed) _store.InstallModule(item.Module);
                if (!wanted && installed && !item.Module.Base) _store.DisableModule(item.Module.Id);
            }
            _store.Save();
            FillList();
            MessageBox.Show("Список этапов обновлён.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void CreateModule()
        {
            string title = _name.Text.Trim();
            if (title.Length == 0)
            {
                MessageBox.Show("Введите название этапа.", "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _store.CreateCustomModule(title, _columns.Text);
            _store.Save();
            _name.Clear();
            _columns.Clear();
            FillList();
            MessageBox.Show(
                "Модуль «" + title + "» создан: структура скопирована, содержимое наполняется в таблице.",
                "ОТ-База",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private sealed class ModuleItem
        {
            public readonly ModuleDef Module;
            private readonly string _caption;

            public ModuleItem(ModuleDef module, string caption)
            {
                Module = module;
                _caption = caption;
            }

            public override string ToString()
            {
                return _caption;
            }
        }
    }
}
