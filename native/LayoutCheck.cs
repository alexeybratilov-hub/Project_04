using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>
    /// Режим --layout-check &lt;каталог-отчёта&gt; [ШxВ]: открывает главное окно
    /// в заданном размере, ждёт, пока отработают раскладка и анимации, проверяет
    /// дерево контролов и пишет машинно-читаемый отчёт layout-check.log.
    ///
    /// Проверки:
    ///   hscroll — у ScrollableControl с AutoScroll=true не должно быть
    ///             горизонтальной полосы прокрутки (HorizontalScroll);
    ///   UI_CLIP — дочерний контрол не должен выходить за клиентскую область
    ///             родителя (кроме прокручиваемых и оверлейных контейнеров).
    ///
    /// Коды возврата: 0 — нарушений нет, 1 — нарушения есть, 3 — окно не открылось.
    /// </summary>
    internal static class LayoutCheck
    {
        private const int DefaultWidth = 1366;
        private const int DefaultHeight = 768;
        private const int WaitMs = 1200;

        private static string _reportPath = string.Empty;
        private static int _width = DefaultWidth;
        private static int _height = DefaultHeight;
        private static MainForm _form;
        private static Timer _timer;
        private static bool _done;
        private static bool _written;
        private static string _problem = string.Empty;
        private static int _code = 3;

        public static int Run(string[] args)
        {
            string reportDirectory = args.Length > 1 ? args[1] : null;
            if (string.IsNullOrEmpty(reportDirectory))
            {
                reportDirectory = Path.Combine(Path.GetTempPath(), "ot-baza-layout-check");
            }
            if (args.Length > 2) ParseSize(args[2]);

            try
            {
                reportDirectory = Path.GetFullPath(reportDirectory);
                Directory.CreateDirectory(reportDirectory);
            }
            catch (Exception ex)
            {
                // Каталог недоступен — отчёт всё равно должен появиться, кладём во TEMP.
                _problem = "каталог отчёта недоступен (" + ex.Message + ")";
                reportDirectory = Path.Combine(Path.GetTempPath(), "ot-baza-layout-check");
                try { Directory.CreateDirectory(reportDirectory); }
                catch { /* ниже попытка записи всё равно покажет ошибку */ }
            }
            _reportPath = Path.Combine(reportDirectory, "layout-check.log");

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e)
                {
                    Fail(e.Exception);
                };

                Catalog catalog = Catalog.Load();
                // Временная база внутри каталога отчёта: реальные данные не трогаем.
                // Архив initial_db.json создаётся Store.OpenAt сам.
                Store store = Store.OpenAt(catalog, Path.Combine(reportDirectory, "data"));
                _form = new MainForm(store, null, null);
                _form.Size = new Size(_width, _height);
                _form.Shown += delegate
                {
                    _timer = new Timer { Interval = WaitMs };
                    _timer.Tick += OnTick;
                    _timer.Start();
                };
                _form.Show();
                Application.Run(_form);
            }
            catch (Exception ex)
            {
                Fail(ex);
            }

            if (!_written)
            {
                // Форма закрылась, так и не отдав отчёт, — считаем, что она не открылась.
                _code = 3;
                WriteReportText(BuildFailureReport("окно не открылось"));
                CloseAndExit();
            }
            return _code;
        }

        // -----------------------------------------------------------------
        //  Сбор отчёта
        // -----------------------------------------------------------------

        private static void OnTick(object sender, EventArgs e)
        {
            if (_done) return;
            if (_timer != null)
            {
                _timer.Stop();
                _timer.Dispose();
                _timer = null;
            }

            string text;
            try
            {
                text = BuildReport();
            }
            catch (Exception ex)
            {
                _code = 3;
                WriteReportText(BuildFailureReport("ошибка сбора отчёта: " + ex.Message));
                CloseAndExit();
                return;
            }

            _done = true;
            WriteReportText(text);
            CloseAndExit();
        }

        private static string BuildReport()
        {
            var violations = new List<string>();
            int hscrollOk = 0;
            if (_form != null) Walk(_form, violations, ref hscrollOk);

            int width = _width;
            int height = _height;
            if (_form != null && !_form.IsDisposed)
            {
                // Фактический размер окна: если экран меньше запрошенного, ОС его уменьшит.
                width = _form.Width;
                height = _form.Height;
            }

            var text = new StringBuilder();
            text.AppendLine("SIZE " + width + "x" + height);
            text.AppendLine("OPEN_FORMS=" + Application.OpenForms.Count);
            text.AppendLine("HSCROLL_OK=" + hscrollOk);
            text.AppendLine("VIOLATIONS=" + violations.Count);
            foreach (string violation in violations) text.AppendLine(violation);
            _code = violations.Count == 0 ? 0 : 1;
            return text.ToString();
        }

        private static string BuildFailureReport(string reason)
        {
            var text = new StringBuilder();
            text.AppendLine("SIZE " + _width + "x" + _height);
            int openForms = 0;
            try { openForms = Application.OpenForms.Count; }
            catch { openForms = 0; }
            text.AppendLine("OPEN_FORMS=" + openForms);
            text.AppendLine("HSCROLL_OK=0");
            text.AppendLine("VIOLATIONS=0");
            string message = _problem.Length > 0 ? _problem + "; " + reason : reason;
            text.AppendLine("ERROR " + OneLine(message));
            return text.ToString();
        }

        /// <summary>Обход дерева контролов от формы вглубь.</summary>
        private static void Walk(Control parent, List<string> violations, ref int hscrollOk)
        {
            if (parent == null) return;
            foreach (Control child in parent.Controls)
            {
                if (child == null || child.IsDisposed) continue;
                if (IsExcludedSubtree(child)) continue;

                var scroll = child as ScrollableControl;
                if (scroll != null && scroll.AutoScroll)
                {
                    if (HasHorizontalScroll(scroll)) violations.Add(FormatViolation("hscroll", child));
                    else hscrollOk++;
                }

                if (IsClipViolation(child)) violations.Add(FormatViolation("UI_CLIP", child));

                Walk(child, violations, ref hscrollOk);
            }
        }

        /// <summary>
        /// Эти контролы и всё внутри них не проверяем: у таблиц/списков прокрутка
        /// разрешена, а SheetHost/ToastHost/PreviewPopup — оверлеи поверх окна.
        /// Листы (GlassForm) на старте не открыты, но проверку это не сломает.
        /// </summary>
        private static bool IsExcludedSubtree(Control control)
        {
            if (control is DataGridView) return true;
            if (control is ListView) return true;
            if (control is TreeView) return true;
            if (control is RichTextBox) return true;
            if (control is GlassForm) return true;
            if (control is SheetHost) return true;
            if (control is ToastHost) return true;
            if (control is PreviewPopup) return true;
            return false;
        }

        /// <summary>
        /// Есть ли горизонтальная прокрутка (видимая полоса или содержимое шире
        /// клиентской области — например, полосу принудительно скрыли).
        /// Важно: HorizontalScroll.Maximum по умолчанию равен 100 и у контейнера,
        /// которому прокрутка не нужна, поэтому сравнивать нужно не с нулём,
        /// а с фактической шириной клиентской области.
        /// </summary>
        private static bool HasHorizontalScroll(ScrollableControl scroll)
        {
            try
            {
                if (scroll.HorizontalScroll.Visible) return true;
                return scroll.DisplayRectangle.Width > scroll.ClientSize.Width + 1;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsClipViolation(Control child)
        {
            Control parent = child.Parent;
            if (parent == null) return false;
            if (!child.Visible || child.Width <= 0 || child.Height <= 0) return false;

            // В прокручиваемом контейнере выход за границы — это и есть прокрутка.
            var scroll = parent as ScrollableControl;
            if (scroll != null && scroll.AutoScroll) return false;

            Rectangle bounds = child.Bounds;
            Size client = parent.ClientSize;
            return bounds.Right > client.Width + 1 || bounds.Bottom > client.Height + 1;
        }

        private static string FormatViolation(string kind, Control control)
        {
            string type = control.GetType().Name;
            string name = string.IsNullOrEmpty(control.Name) ? "-" : control.Name;
            Rectangle bounds = control.Bounds;
            Control parent = control.Parent;
            string parentType = parent == null ? "-" : parent.GetType().Name;
            string parentName = parent == null || string.IsNullOrEmpty(parent.Name) ? "-" : parent.Name;
            Size parentClient = parent == null ? Size.Empty : parent.ClientSize;
            string details = kind == "hscroll" ? FormatHScroll(control as ScrollableControl) : string.Empty;
            return string.Format(
                CultureInfo.InvariantCulture,
                "VIOLATION {0} {1} {2} bounds=({3},{4},{5},{6}) parent=(({7}) {8} {9}x{10}){11}",
                kind, type, name,
                bounds.X, bounds.Y, bounds.Width, bounds.Height,
                parentType, parentName, parentClient.Width, parentClient.Height,
                details);
        }

        private static string FormatHScroll(ScrollableControl control)
        {
            if (control == null) return string.Empty;
            try
            {
                return " hscroll=(maximum=" + control.HorizontalScroll.Maximum +
                       ",visible=" + (control.HorizontalScroll.Visible ? "true" : "false") +
                       ",client=" + control.ClientSize.Width + "x" + control.ClientSize.Height +
                       ",content=" + control.DisplayRectangle.Width + "x" + control.DisplayRectangle.Height + ")";
            }
            catch
            {
                return string.Empty;
            }
        }

        // -----------------------------------------------------------------
        //  Запись и завершение
        // -----------------------------------------------------------------

        private static void WriteReportText(string text)
        {
            try
            {
                // UTF-8 с BOM: файл читается в PowerShell без указания кодировки.
                File.WriteAllText(_reportPath, text, new UTF8Encoding(true));
                _written = true;
            }
            catch (Exception ex)
            {
                _written = false;
                _problem = "не удалось записать отчёт " + _reportPath + ": " + ex.Message;
                _code = 3;
            }
        }

        private static void Fail(Exception ex)
        {
            if (_done) return;
            _done = true;
            string message = ex == null ? "неизвестная ошибка" : ex.GetType().Name + ": " + ex.Message;
            _code = 3;
            WriteReportText(BuildFailureReport(message));
            CloseAndExit();
        }

        private static void CloseAndExit()
        {
            if (_timer != null)
            {
                try { _timer.Stop(); _timer.Dispose(); } catch { }
                _timer = null;
            }
            try
            {
                if (_form != null && !_form.IsDisposed) _form.Close();
            }
            catch { }
            try { Application.ExitThread(); }
            catch { }
        }

        private static void ParseSize(string value)
        {
            if (string.IsNullOrEmpty(value)) return;
            string[] parts = value.ToLowerInvariant().Split('x');
            if (parts.Length != 2)
            {
                parts = value.ToLowerInvariant().Split('х'); // кириллическая «х» из задания
            }
            if (parts.Length != 2) return;
            int width;
            int height;
            if (!int.TryParse(parts[0].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out width)) return;
            if (!int.TryParse(parts[1].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out height)) return;
            if (width < 320 || height < 240 || width > 10000 || height > 10000) return;
            _width = width;
            _height = height;
        }

        private static string OneLine(string text)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            return text.Replace("\r", " ").Replace("\n", " ");
        }
    }
}
