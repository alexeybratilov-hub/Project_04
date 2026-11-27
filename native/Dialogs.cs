using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>
    /// Редактор строки: поля строятся по описанию колонок модуля.
    /// Валидация инлайн: ошибка появляется под своим полем, лист не закрывается,
    /// пока данные не исправлены. Системные окна сообщений не используются.
    /// </summary>
    internal sealed class RowEditorForm : GlassForm
    {
        public Dictionary<string, object> Result = new Dictionary<string, object>();

        private readonly List<Dictionary<string, object>> _columns;
        private readonly Dictionary<string, object> _existing;
        private readonly Dictionary<string, Func<object>> _getters = new Dictionary<string, Func<object>>();
        private readonly Dictionary<string, string> _types = new Dictionary<string, string>();
        private readonly Dictionary<string, string> _names = new Dictionary<string, string>();
        private readonly Dictionary<string, bool> _required = new Dictionary<string, bool>();
        private readonly Dictionary<string, Label> _errors = new Dictionary<string, Label>();
        private readonly Dictionary<string, Control> _controls = new Dictionary<string, Control>();

        private readonly TransparentPanel _scroll;
        private readonly Label _summary;

        private bool _hasDate;
        private bool _hasNumber;
        private bool _hasSelect;
        private bool _dirty;
        private bool _allowClose;
        private bool _saved;

        public RowEditorForm(List<Dictionary<string, object>> columns, Dictionary<string, object> existing, string title)
            : base(title, new Size(660, 620))
        {
            _columns = columns != null ? columns : new List<Dictionary<string, object>>();
            _existing = existing != null ? new Dictionary<string, object>(existing) : new Dictionary<string, object>();

            IndexColumns();

            // ---------- нижняя полоса действий: сохранить / отмена
            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 54,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = true,
                Padding = new Padding(0, 10, 0, 0)
            };
            Body.Controls.Add(footer);

            var save = new PillButton { Text = "Сохранить", Primary = true, Width = 138, Height = 36, Margin = new Padding(8, 0, 0, 0) };
            save.Click += delegate { SaveAndClose(); };
            footer.Controls.Add(save);

            var cancel = new PillButton { Text = "Отмена", Width = 118, Height = 36 };
            cancel.Click += delegate { Close(); };
            footer.Controls.Add(cancel);

            // ---------- прокручиваемая область полей
            _scroll = new TransparentPanel { Dock = DockStyle.Fill, AutoScroll = true };
            Body.Controls.Add(_scroll);
            _scroll.BringToFront();

            var table = new TransparentTable
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 2,
                Padding = new Padding(0, 0, 6, 0)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            _scroll.Controls.Add(table);

            AddWideRow(table, new Label
            {
                Text = "* — обязательное поле. Остальные поля можно оставить пустыми.",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true
            }, 22);

            AddWideRow(table, new Label
            {
                Text = BuildHintsText(),
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f),
                TextAlign = ContentAlignment.TopLeft
            }, 40);

            _summary = new Label
            {
                Text = string.Empty,
                Dock = DockStyle.Fill,
                ForeColor = Ui.Rose,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true
            };
            AddWideRow(table, _summary, 22);

            // ---------- поля и инлайн-ошибки под ними
            foreach (var column in _columns)
            {
                string id = J.Str(J.Get(column, "id"));
                if (id.Length == 0) continue;

                string type = _types.ContainsKey(id) ? _types[id] : string.Empty;
                string name = _names.ContainsKey(id) ? _names[id] : string.Empty;
                bool required = _required.ContainsKey(id) && _required[id];

                int row = table.RowCount;
                table.RowCount = row + 1;
                table.RowStyles.Add(new RowStyle(SizeType.AutoSize));

                table.Controls.Add(new Label
                {
                    Text = name + (required ? " *" : string.Empty),
                    AutoSize = true,
                    ForeColor = Ui.Ink,
                    BackColor = Color.Transparent,
                    Font = Ui.Font(12f, required ? FontStyle.Bold : FontStyle.Regular),
                    Margin = new Padding(0, 10, 12, 6),
                    MaximumSize = new Size(150, 0)
                }, 0, row);

                object value = J.Get(_existing, id);
                Control control = BuildControl(column, id, type, value);
                _controls[id] = control;
                table.Controls.Add(control, 1, row);
                TrackChanges(control, id);

                int errorRow = table.RowCount;
                table.RowCount = errorRow + 1;
                table.RowStyles.Add(new RowStyle(SizeType.AutoSize));

                var error = new Label
                {
                    Text = string.Empty,
                    AutoSize = true,
                    Visible = false,
                    ForeColor = Ui.Rose,
                    BackColor = Color.Transparent,
                    Font = Ui.Font(10f),
                    Margin = new Padding(2, 0, 0, 4)
                };
                table.Controls.Add(error, 1, errorRow);
                _errors[id] = error;
            }

            KeyPreview = true;
        }

        /// <summary>Первый проход: тип, название и обязательность каждого поля.</summary>
        private void IndexColumns()
        {
            _hasDate = false;
            _hasNumber = false;
            _hasSelect = false;

            foreach (var column in _columns)
            {
                string id = J.Str(J.Get(column, "id"));
                if (id.Length == 0) continue;

                string type = J.Str(J.Get(column, "type"));
                _types[id] = type;
                _names[id] = J.Str(J.Get(column, "name"));
                _required[id] = J.Str(J.Get(column, "required")) == "True";

                if (type == "date") _hasDate = true;
                else if (type == "number") _hasNumber = true;
                else if (type == "select") _hasSelect = true;
            }
        }

        /// <summary>Короткая легенда по типам, которые реально есть в таблице.</summary>
        private string BuildHintsText()
        {
            var parts = new List<string>();
            if (_hasDate) parts.Add("дата — ДД.ММ.ГГГГ");
            if (_hasNumber) parts.Add("число — без пробелов, например 12.5");
            if (_hasSelect) parts.Add("список — выбор из вариантов");
            if (parts.Count == 0) return "Все поля — свободный текст.";
            return "Подсказки по типам: " + string.Join("; ", parts.ToArray()) + ".";
        }

        /// <summary>Добавляет строку на всю ширину таблицы (легенда, подсказка, сводка).</summary>
        private static void AddWideRow(TransparentTable table, Control control, int height)
        {
            int row = table.RowCount;
            table.RowCount = row + 1;
            table.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            table.Controls.Add(control, 0, row);
            table.SetColumnSpan(control, 2);
        }

        private Control BuildControl(Dictionary<string, object> column, string id, string type, object value)
        {
            string text = J.Str(value);

            if (type == "date")
            {
                var picker = new DateTimePicker
                {
                    Format = DateTimePickerFormat.Custom,
                    CustomFormat = "dd.MM.yyyy",
                    ShowCheckBox = true,
                    Checked = text.Length > 0,
                    Value = ObligationsEngine.ParseIso(text),
                    Font = Ui.Font(12f),
                    Dock = DockStyle.Fill,
                    Margin = new Padding(0, 6, 0, 0)
                };
                _getters[id] = delegate
                {
                    return picker.Checked ? picker.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : string.Empty;
                };
                return picker;
            }

            if (type == "select")
            {
                var combo = new ComboBox
                {
                    DropDownStyle = ComboBoxStyle.DropDownList,
                    Font = Ui.Font(12f),
                    Dock = DockStyle.Fill,
                    Margin = new Padding(0, 6, 0, 0)
                };
                combo.Items.Add(string.Empty);
                foreach (object option in J.Arr(J.Get(column, "options")))
                {
                    combo.Items.Add(J.Str(option));
                }
                combo.SelectedItem = text.Length > 0 && combo.Items.Contains(text) ? text : string.Empty;
                _getters[id] = delegate { return J.Str(combo.SelectedItem); };
                return combo;
            }

            if (type == "bool")
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
                return check;
            }

            var box = new TextBox { Text = text };
            _getters[id] = delegate { return box.Text.Trim(); };
            var field = new InputField(box) { Dock = DockStyle.Fill, Margin = new Padding(0, 4, 0, 1) };
            return field;
        }

        /// <summary>
        /// Отслеживает правки, чтобы (1) понимать, есть ли несохранённые изменения,
        /// и (2) убирать ошибку поля, как только пользователь начал его исправлять.
        /// </summary>
        private void TrackChanges(Control control, string id)
        {
            var field = control as InputField;
            if (field != null)
            {
                field.Box.TextChanged += delegate { Touch(id); };
                return;
            }

            var textBox = control as TextBox;
            if (textBox != null)
            {
                textBox.TextChanged += delegate { Touch(id); };
                return;
            }

            var combo = control as ComboBox;
            if (combo != null)
            {
                combo.SelectedIndexChanged += delegate { Touch(id); };
                return;
            }

            var check = control as CheckBox;
            if (check != null)
            {
                check.CheckedChanged += delegate { Touch(id); };
                return;
            }

            var picker = control as DateTimePicker;
            if (picker != null)
            {
                picker.ValueChanged += delegate { Touch(id); };
            }
        }

        private void Touch(string id)
        {
            _dirty = true;
            ClearError(id);
            if (!HasErrors()) _summary.Text = string.Empty;
        }

        private bool HasErrors()
        {
            foreach (var pair in _errors)
            {
                if (pair.Value.Visible) return true;
            }
            return false;
        }

        private void SetError(string id, string message)
        {
            Label label;
            if (!_errors.TryGetValue(id, out label)) return;
            label.Text = message;
            label.Visible = true;
        }

        private void ClearError(string id)
        {
            Label label;
            if (!_errors.TryGetValue(id, out label)) return;
            if (!label.Visible && label.Text.Length == 0) return;
            label.Text = string.Empty;
            label.Visible = false;
        }

        /// <summary>
        /// Проверяет все поля. При ошибках лист остаётся открытым: показывает
        /// сообщения под полями и ставит фокус в первое невалидное поле.
        /// </summary>
        private void SaveAndClose()
        {
            if (_saved) return;

            var result = new Dictionary<string, object>();
            Control firstInvalid = null;
            int invalidCount = 0;

            foreach (var column in _columns)
            {
                string id = J.Str(J.Get(column, "id"));
                if (id.Length == 0) continue;

                string type = _types.ContainsKey(id) ? _types[id] : string.Empty;
                string name = _names.ContainsKey(id) ? _names[id] : string.Empty;
                bool required = _required.ContainsKey(id) && _required[id];

                object value = _getters.ContainsKey(id) ? _getters[id]() : string.Empty;
                string text = J.Str(value);
                string error = null;

                if (required && text.Length == 0)
                {
                    if (type == "date") error = "Укажите дату в формате ДД.ММ.ГГГГ — поле обязательное.";
                    else if (type == "select") error = "Выберите значение из списка — поле обязательное.";
                    else if (type == "number") error = "Введите число без пробелов, например 12.5 — поле обязательное.";
                    else error = "Заполните поле «" + name + "» — оно обязательное.";
                }
                else if (type == "number" && text.Length > 0)
                {
                    decimal number;
                    if (!decimal.TryParse(text.Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out number))
                    {
                        error = "Это не число: введите цифры без пробелов, например 12.5.";
                    }
                    else
                    {
                        text = number.ToString(CultureInfo.InvariantCulture);
                    }
                }

                if (error != null)
                {
                    SetError(id, error);
                    invalidCount++;
                    if (firstInvalid == null && _controls.ContainsKey(id)) firstInvalid = _controls[id];
                }
                else
                {
                    ClearError(id);
                }

                result[id] = text;
            }

            if (invalidCount > 0)
            {
                _summary.Text = "Данные не сохранены: проверьте "
                    + Ui.Plural(invalidCount, "поле", "поля", "полей")
                    + " ниже.";
                if (firstInvalid != null)
                {
                    try { _scroll.ScrollControlIntoView(firstInvalid); }
                    catch { }
                    var invalidField = firstInvalid as InputField;
            if (invalidField != null) invalidField.Box.Focus();
            else firstInvalid.Focus();
                }
                return;
            }

            Result = result;
            _saved = true;
            _allowClose = true;
            DialogResult = DialogResult.OK;
            Close();
        }

        /// <summary>
        /// Закрытие с несохранёнными правками просит подтверждение через Shell.Confirm.
        /// Только для встроенного листа: в режиме отдельного модального окна
        /// подтверждение-лист открылось бы за диалогом и заблокировало бы работу.
        /// </summary>
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            if (e.Cancel || _saved || _allowClose || !_dirty || !Embedded) return;
            if (Shell.Current == null) return;

            e.Cancel = true;
            Shell.Confirm(
                "Несохранённые изменения",
                "В форме есть несохранённые изменения. Закрыть лист без сохранения? Введённые значения будут потеряны.",
                "Закрыть без сохранения",
                delegate
                {
                    if (IsDisposed) return;
                    _allowClose = true;
                    Close();
                });
        }
    }

    /// <summary>
    /// Экран «Разделы и этапы»: списком показывает все разделы базы (базовые и свои),
    /// число записей в каждом, позволяет включать/скрывать этапы и создавать свой раздел.
    /// Отключение раздела скрывает вкладку, но никогда не удаляет данные.
    /// </summary>
    internal sealed class ModulesForm : GlassForm
    {
        private const int RowHeight = 42;

        private readonly Store _store;
        private readonly TransparentTable _listTable;
        private readonly Label _listCaption;
        private readonly TextBox _nameBox;
        private readonly TextBox _columnsBox;
        private readonly Label _nameError;
        private readonly List<ModuleRow> _rows = new List<ModuleRow>();

        public ModulesForm(Store store)
            : base("Разделы и этапы", new Size(820, 720))
        {
            _store = store;

            // Вся раскладка — табличная, без абсолютных координат: при сужении
            // листа до ~660-700 px ничего не обрезается и не наезжает друг на друга.
            // Минимальная высота содержимого защищает от наложения строк на низком
            // окне: если места мало, прокручивается весь лист, а не отдельная строка.
            var page = new TransparentPanel { Dock = DockStyle.Fill, AutoScroll = true };
            Body.Controls.Add(page);

            var root = new TransparentTable
            {
                Dock = DockStyle.Top,
                Height = 480,
                ColumnCount = 1,
                RowCount = 5,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));  // пояснение
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));  // подпись списка
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));  // список (прокрутка)
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 186)); // создание раздела
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));  // кнопки
            page.Controls.Add(root);
            page.Resize += delegate
            {
                int wanted = Math.Max(480, page.ClientSize.Height);
                if (root.Height != wanted) root.Height = wanted;
            };

            // ---------- пояснение: что такое раздел-этап и что делает выключение
            var intro = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 2,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            intro.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            intro.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
            intro.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.Controls.Add(intro, 0, 0);

            intro.Controls.Add(new Label
            {
                Text = "Раздел — это этап работы: своя таблица, колонки и записи",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Font = Ui.Font(12f, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true
            }, 0, 0);

            intro.Controls.Add(new Label
            {
                Text = "Отключение скрывает вкладку раздела, но не удаляет данные: записи остаются в базе и вернутся, если раздел включить снова. Базовые разделы отключить нельзя — на них держатся расчёт сроков и обязательства.",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10.5f),
                TextAlign = ContentAlignment.TopLeft
            }, 0, 1);

            // ---------- подпись списка
            _listCaption = new Label
            {
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true,
                Margin = new Padding(0, 4, 0, 4)
            };
            root.Controls.Add(_listCaption, 0, 1);

            // ---------- список разделов: чекбокс, название, число записей и пометка
            var listCard = new GlassPanel
            {
                Dock = DockStyle.Fill,
                Radius = 12,
                FillAlpha = 200,
                Shadow = false,
                Padding = new Padding(10, 8, 10, 8),
                Margin = new Padding(0, 0, 0, 6)
            };
            root.Controls.Add(listCard, 0, 2);

            var listScroll = new TransparentPanel { Dock = DockStyle.Fill, AutoScroll = true };
            listCard.Controls.Add(listScroll);

            _listTable = new TransparentTable
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 1,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            _listTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            listScroll.Controls.Add(_listTable);

            // ---------- создание своего раздела
            var createCard = new GlassPanel
            {
                Dock = DockStyle.Fill,
                Radius = 12,
                FillAlpha = 200,
                Shadow = false,
                Padding = new Padding(14, 8, 14, 8),
                Margin = new Padding(0, 2, 0, 4)
            };
            root.Controls.Add(createCard, 0, 3);

            var createTable = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 5,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            createTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
            createTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            createTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            createTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
            createTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            createTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            createTable.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            createCard.Controls.Add(createTable);

            createTable.Controls.Add(new Label
            {
                Text = "Название раздела *",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true
            }, 0, 0);

            _nameError = new Label
            {
                Text = string.Empty,
                Dock = DockStyle.Fill,
                ForeColor = Ui.Rose,
                BackColor = Color.Transparent,
                Font = Ui.Font(10f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true,
                Margin = new Padding(2, 0, 0, 0)
            };
            createTable.Controls.Add(_nameError, 1, 1);

            _nameBox = new TextBox
            {
                Dock = DockStyle.Fill,
                Font = Ui.Font(12f),
                Margin = new Padding(0, 4, 0, 4)
            };
            _nameBox.TextChanged += delegate { _nameError.Text = string.Empty; };
            createTable.Controls.Add(_nameBox, 1, 0);

            createTable.Controls.Add(new Label
            {
                Text = "Колонки",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true
            }, 0, 2);

            _columnsBox = new TextBox
            {
                Dock = DockStyle.Fill,
                Font = Ui.Font(12f),
                Margin = new Padding(0, 4, 0, 4)
            };
            createTable.Controls.Add(_columnsBox, 1, 2);

            createTable.Controls.Add(new Label
            {
                Text = "Через запятую: «Инструктаж, Дата, Ответственный». Колонки создаются текстовыми, даты — ДД.ММ.ГГГГ. Пусто — стандартный набор колонок.",
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10f),
                TextAlign = ContentAlignment.TopLeft
            }, 1, 3);

            var createButtons = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Padding = new Padding(0, 4, 0, 0)
            };
            createTable.Controls.Add(createButtons, 1, 4);

            var create = new PillButton { Text = "Создать раздел", Primary = true, Width = 190, Height = 36 };
            create.Click += delegate { CreateModule(); };
            createButtons.Controls.Add(create);

            // ---------- кнопки применения и закрытия
            var footer = new TransparentFlow
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = true,
                Padding = new Padding(0, 10, 0, 0)
            };
            root.Controls.Add(footer, 0, 4);

            var apply = new PillButton { Text = "Применить", Primary = true, Width = 170, Height = 38, Margin = new Padding(8, 0, 0, 0) };
            apply.Click += delegate { Apply(); };
            footer.Controls.Add(apply);

            var close = new PillButton { Text = "Закрыть", Width = 120, Height = 38 };
            close.Click += delegate { Close(); };
            footer.Controls.Add(close);

            FillList();
        }

        /// <summary>Перестраивает список: отметки, число записей, пометки «базовый»/«свой».</summary>
        private void FillList()
        {
            _listTable.SuspendLayout();
            while (_listTable.Controls.Count > 0) _listTable.Controls[0].Dispose();
            _listTable.RowStyles.Clear();
            _listTable.RowCount = 0;
            _rows.Clear();

            List<string> installed = _store.InstalledModules;
            int index = 0;
            int baseCount = 0;
            int installedCount = 0;

            foreach (ModuleDef module in _store.Catalog.Modules)
            {
                bool isInstalled = installed.Contains(module.Id) || module.Base;

                _listTable.RowCount = index + 1;
                _listTable.RowStyles.Add(new RowStyle(SizeType.Absolute, RowHeight));

                ModuleRow row = BuildRow(module, isInstalled);
                _listTable.Controls.Add(row.Host, 0, index);
                _rows.Add(row);

                if (module.Base) baseCount++;
                if (isInstalled) installedCount++;
                index++;
            }

            _listTable.ResumeLayout();

            _listCaption.Text = Ui.Plural(index, "раздел", "раздела", "разделов")
                + ": включено " + installedCount
                + ", базовых " + baseCount
                + " — базовые отключить нельзя";
        }

        private ModuleRow BuildRow(ModuleDef module, bool installed)
        {
            var host = new TransparentTable
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 2,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            host.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            host.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
            host.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            var check = new CheckBox
            {
                Text = module.Title,
                Dock = DockStyle.Fill,
                Font = Ui.Font(12f),
                BackColor = Color.Transparent,
                ForeColor = Ui.Ink,
                Margin = new Padding(2, 1, 0, 0),
                Checked = module.Base || installed,
                // Замок базового раздела: щелчок не снимает отметку, но текст
                // остаётся читаемым (в отличие от Enabled = false).
                AutoCheck = !module.Base,
                Cursor = module.Base ? Cursors.Default : Cursors.Hand
            };
            host.Controls.Add(check, 0, 0);

            host.Controls.Add(new Label
            {
                Dock = DockStyle.Fill,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(10f),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true,
                Text = MetaText(module, installed),
                Margin = new Padding(2, 0, 0, 0)
            }, 0, 1);

            var row = new ModuleRow();
            row.Module = module;
            row.Check = check;
            row.Host = host;
            return row;
        }

        /// <summary>Вторая строка раздела: сколько записей и можно ли его отключить.</summary>
        private string MetaText(ModuleDef module, bool installed)
        {
            string text = CountText(module);
            if (module.Base)
            {
                text += " · базовый раздел: отключить нельзя — на нём держатся сроки и обязательства";
            }
            else if (module.Custom)
            {
                text += installed ? " · свой раздел · включён" : " · свой раздел · скрыт, данные сохранены";
            }
            else
            {
                text += " · встроенный раздел";
                text += installed ? " · включён" : " · скрыт";
            }
            return text;
        }

        /// <summary>Число записей берём из вкладки раздела (если вкладка уже создана).</summary>
        private string CountText(ModuleDef module)
        {
            Dictionary<string, object> tab = _store.FindTabByModule(module.Id);
            if (tab == null) tab = _store.FindTab(module.TabId);
            if (tab == null) return "таблица ещё не создана";
            int count = J.Arr(J.Get(tab, "rows")).Count;
            return Ui.Plural(count, "запись", "записи", "записей");
        }

        /// <summary>Сохраняет выбранные разделы: включение/скрытие. Данные не удаляются.</summary>
        private void Apply()
        {
            int enabled = 0;
            int disabled = 0;

            foreach (ModuleRow row in _rows)
            {
                ModuleDef module = row.Module;
                bool wanted = row.Check.Checked || module.Base;
                bool installed = _store.InstalledModules.Contains(module.Id);

                if (wanted && !installed)
                {
                    _store.InstallModule(module);
                    enabled++;
                }
                else if (!wanted && installed && !module.Base)
                {
                    _store.DisableModule(module.Id);
                    disabled++;
                }
            }

            _store.Save();
            FillList();

            if (enabled == 0 && disabled == 0)
            {
                SendNotice("Список разделов не изменился: отмеченные разделы уже включены.", NoticeKind.Info);
            }
            else if (enabled > 0 && disabled > 0)
            {
                SendNotice("Разделы обновлены: включено " + enabled + ", скрыто " + disabled + ". Данные скрытых разделов сохранены.", NoticeKind.Success);
            }
            else if (enabled > 0)
            {
                SendNotice("Включено разделов: " + enabled + " — они появились в боковой панели.", NoticeKind.Success);
            }
            else
            {
                SendNotice("Скрыто разделов: " + disabled + " — данные остались в базе, раздел можно включить снова.", NoticeKind.Success);
            }
        }

        /// <summary>Создаёт свой раздел: проверка названия инлайн, затем уведомление и закрытие листа.</summary>
        private void CreateModule()
        {
            _nameError.Text = string.Empty;
            string title = _nameBox.Text.Trim();
            string error = null;

            if (title.Length == 0)
            {
                error = "Введите название раздела — без него раздел не найти в списке.";
            }
            else
            {
                foreach (ModuleDef module in _store.Catalog.Modules)
                {
                    if (string.Equals(module.Title.Trim(), title, StringComparison.OrdinalIgnoreCase))
                    {
                        error = "Раздел «" + title + "» уже есть — выберите другое название.";
                        break;
                    }
                }
            }

            if (error != null)
            {
                _nameError.Text = error;
                _nameBox.Focus();
                return;
            }

            string id = _store.CreateCustomModule(title, _columnsBox.Text.Trim());
            _store.Save();

            ModuleDef created = _store.Catalog.Module(id);
            string tabId = created != null ? created.TabId : string.Empty;
            IShell shell = Shell.Current;

            // В режиме листа сообщаем об успехе и сразу открываем созданный раздел
            // в рабочей области; при обычном модальном окне достаточно закрыться.
            if (shell != null && Embedded)
            {
                shell.Notify("Раздел «" + title + "» создан — он открыт в рабочей области.", NoticeKind.Success);
                Close();
                if (tabId.Length > 0) shell.OpenTab(tabId);
                return;
            }

            Close();
        }

        private void SendNotice(string message, NoticeKind kind)
        {
            IShell shell = Shell.Current;
            if (shell != null) shell.Notify(message, kind);
        }

        private sealed class ModuleRow
        {
            public ModuleDef Module;
            public CheckBox Check;
            public Control Host;
        }
    }
}
