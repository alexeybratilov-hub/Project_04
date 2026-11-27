using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>Небольшой ввод одной строки (название организации, шаблона и т. п.).</summary>
    internal sealed class TextPromptForm : GlassForm
    {
        private readonly TextBox _input;

        public string Value
        {
            get { return _input.Text.Trim(); }
        }

        public TextPromptForm(string caption, string label, string initialValue)
            : base(caption, new Size(560, 250))
        {
            Body.Controls.Add(new Label
            {
                Text = label,
                Dock = DockStyle.Top,
                Height = 28,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f)
            });

            _input = new TextBox
            {
                Dock = DockStyle.Top,
                Text = initialValue ?? string.Empty,
                Font = Ui.Font(13f),
                Margin = new Padding(0, 4, 0, 0)
            };
            Body.Controls.Add(_input);
            _input.BringToFront();

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 50,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 10, 0, 0)
            };
            Body.Controls.Add(footer);

            var ok = new PillButton { Text = "Готово", Primary = true, Width = 120, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            ok.Click += delegate { DialogResult = DialogResult.OK; Close(); };
            footer.Controls.Add(ok);

            var cancel = new PillButton { Text = "Отмена", Width = 110, Height = 36 };
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            footer.Controls.Add(cancel);

            Shown += delegate { _input.Focus(); };
            AcceptButton = null;
            KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter)
                {
                    DialogResult = DialogResult.OK;
                    Close();
                }
            };
        }
    }

    /// <summary>
    /// Организации: специалист по охране труда обычно ведёт несколько юрлиц.
    /// Каждая организация — отдельные списки, шаблоны, документы и обязательства;
    /// общими остаются каталог модулей и настройки.
    /// </summary>
    internal sealed class OrganizationsForm : GlassForm
    {
        private readonly Store _store;
        private readonly ListBox _list;
        private readonly Dictionary<string, TextBox> _fields = new Dictionary<string, TextBox>();
        private readonly Label _hint;
        private Dictionary<string, object> _selected;

        public bool Changed;

        private static readonly string[,] FieldMap = new string[,]
        {
            { "shortName", "Краткое название" },
            { "fullName", "Полное наименование" },
            { "inn", "ИНН" },
            { "kpp", "КПП" },
            { "ogrn", "ОГРН" },
            { "okpo", "ОКПО" },
            { "okved", "ОКВЭД" },
            { "legalAddress", "Юридический адрес" },
            { "directorFio", "Руководитель (ФИО)" },
            { "phone", "Телефон" },
            { "email", "E-mail" },
            { "bankDetails", "Банковские реквизиты" },
            { "bankIn", "Банк" }
        };

        public OrganizationsForm(Store store)
            : base("Организации", new Size(980, 660))
        {
            _store = store;

            var layout = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(0)
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Body.Controls.Add(layout);

            // ---- список организаций
            var left = new TransparentPanel { Dock = DockStyle.Fill, Padding = new Padding(0, 0, 12, 0) };

            var buttons = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 96,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(0, 6, 0, 0)
            };

            var add = new PillButton { Text = "Добавить", Width = 150, Height = 34, Margin = new Padding(0, 0, 0, 6) };
            add.Click += delegate { AddOrganization(); };
            buttons.Controls.Add(add);

            var activate = new PillButton { Text = "Сделать активной", Primary = true, Width = 190, Height = 34 };
            activate.Click += delegate { ActivateSelected(); };
            buttons.Controls.Add(activate);

            left.Controls.Add(buttons);

            _list = new ListBox
            {
                Dock = DockStyle.Fill,
                Font = Ui.Font(12.5f),
                BorderStyle = BorderStyle.FixedSingle,
                IntegralHeight = false
            };
            _list.SelectedIndexChanged += delegate { LoadSelected(); };
            left.Controls.Add(_list);
            _list.BringToFront();

            left.Controls.Add(new Label
            {
                Text = "Юридические лица",
                Dock = DockStyle.Top,
                Height = 26,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f)
            });

            layout.Controls.Add(left, 0, 0);

            // ---- реквизиты выбранной организации
            var right = new TransparentPanel { Dock = DockStyle.Fill };
            layout.Controls.Add(right, 1, 0);

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 52,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 10, 0, 0)
            };
            right.Controls.Add(footer);

            var save = new PillButton { Text = "Сохранить реквизиты", Primary = true, Width = 200, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            save.Click += delegate { SaveProfile(); };
            footer.Controls.Add(save);

            var close = new PillButton { Text = "Закрыть", Width = 110, Height = 36 };
            close.Click += delegate { Close(); };
            footer.Controls.Add(close);

            _hint = new Label
            {
                Dock = DockStyle.Bottom,
                Height = 44,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f),
                Text = "Реквизиты подставляются в документы: {Организация}, {Организация_полное}, {ИНН}, {КПП}, {ОГРН}, {Юридический_адрес}, {Генеральный_директор}."
            };
            right.Controls.Add(_hint);

            var scroll = new TransparentPanel { Dock = DockStyle.Fill, AutoScroll = true };
            right.Controls.Add(scroll);
            scroll.BringToFront();

            var table = new TransparentTable
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 2,
                Padding = new Padding(0, 0, 8, 0)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            scroll.Controls.Add(table);

            for (int i = 0; i < FieldMap.GetLength(0); i++)
            {
                string key = FieldMap[i, 0];
                table.Controls.Add(new Label
                {
                    Text = FieldMap[i, 1],
                    AutoSize = true,
                    ForeColor = Ui.Ink,
                    BackColor = Color.Transparent,
                    Font = Ui.Font(12f),
                    Margin = new Padding(0, 9, 8, 6)
                });

                var field = new InputField
                {
                    Dock = DockStyle.Fill,
                    Margin = new Padding(0, 4, 0, 2)
                };
                _fields[key] = field.Box;
                table.Controls.Add(field);
            }

            RefreshList();
        }

        private void RefreshList()
        {
            string activeId = _store.ActiveEntityId;
            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (var entity in _store.Entities)
            {
                string id = J.Str(J.Get(entity, "id"));
                var profile = J.Obj(J.Get(entity, "profile")) ?? new Dictionary<string, object>();
                string name = J.Str(J.Get(profile, "shortName"));
                if (name.Length == 0) name = J.Str(J.Get(profile, "fullName"));
                if (name.Length == 0) name = "(без названия)";
                string inn = J.Str(J.Get(profile, "inn"));
                string mark = id == activeId ? "  • активна" : string.Empty;
                _list.Items.Add(new EntityListItem(id, name + (inn.Length > 0 ? "  ИНН " + inn : string.Empty) + mark));
            }
            _list.EndUpdate();

            for (int i = 0; i < _list.Items.Count; i++)
            {
                var item = _list.Items[i] as EntityListItem;
                if (item != null && item.Id == activeId)
                {
                    _list.SelectedIndex = i;
                    break;
                }
            }
            if (_list.SelectedIndex < 0 && _list.Items.Count > 0) _list.SelectedIndex = 0;
        }

        private void LoadSelected()
        {
            var item = _list.SelectedItem as EntityListItem;
            _selected = item == null ? null : _store.FindEntity(item.Id);
            var profile = _selected == null ? null : J.Obj(J.Get(_selected, "profile"));
            foreach (var pair in _fields)
            {
                pair.Value.Text = profile == null ? string.Empty : J.Str(J.Get(profile, pair.Key));
            }
        }

        private void SaveProfile()
        {
            if (_selected == null)
            {
                Shell.Notify("Выберите организацию.", NoticeKind.Info);
                return;
            }

            var profile = J.Obj(J.Get(_selected, "profile"));
            if (profile == null)
            {
                profile = new Dictionary<string, object>();
                J.Put(_selected, "profile", profile);
            }
            foreach (var pair in _fields)
            {
                profile[pair.Key] = pair.Value.Text.Trim();
            }
            if (J.Str(J.Get(profile, "shortName")).Length == 0)
            {
                profile["shortName"] = J.Str(J.Get(profile, "fullName"));
            }
            if (J.Str(J.Get(profile, "fullName")).Length == 0)
            {
                Shell.Notify("Заполните хотя бы краткое или полное название.", NoticeKind.Info);
                return;
            }

            try
            {
                _store.Save();
            }
            catch (Exception ex)
            {
                Shell.Notify("Не удалось сохранить: " + ex.Message, NoticeKind.Warning);
                return;
            }

            Changed = true;
            string id = J.Str(J.Get(_selected, "id"));
            RefreshList();
            for (int i = 0; i < _list.Items.Count; i++)
            {
                var item = _list.Items[i] as EntityListItem;
                if (item != null && item.Id == id) { _list.SelectedIndex = i; break; }
            }
        }

        private void AddOrganization()
        {
            var prompt = new TextPromptForm("Новая организация", "Краткое название (например, ООО «Ромашка»)", "Новая организация");
            Shell.Sheet(prompt, delegate
            {
                if (prompt.DialogResult != DialogResult.OK) return;
                if (prompt.Value.Length == 0)
                {
                    Shell.Notify("Название не может быть пустым.", NoticeKind.Info);
                    return;
                }
                try
                {
                    _store.CreateOrganization(prompt.Value, prompt.Value);
                    _store.Save();
                }
                catch (Exception ex)
                {
                    Shell.Notify("Не удалось создать организацию: " + ex.Message, NoticeKind.Danger);
                    return;
                }
                Changed = true;
                RefreshList();
                if (_list.Items.Count > 0) _list.SelectedIndex = _list.Items.Count - 1;
            });
        }

        private void ActivateSelected()
        {
            var item = _list.SelectedItem as EntityListItem;
            if (item == null) return;
            if (item.Id == _store.ActiveEntityId)
            {
                Shell.Notify("Эта организация уже активна.", NoticeKind.Info);
                return;
            }
            try
            {
                _store.SetActiveEntity(item.Id);
            }
            catch (Exception ex)
            {
                Shell.Notify("Не удалось переключить организацию: " + ex.Message, NoticeKind.Warning);
                return;
            }
            Changed = true;
            RefreshList();
        }

        private sealed class EntityListItem
        {
            public readonly string Id;
            private readonly string _text;

            public EntityListItem(string id, string text)
            {
                Id = id;
                _text = text;
            }

            public override string ToString()
            {
                return _text;
            }
        }
    }
}
