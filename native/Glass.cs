using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace OtBaza
{
    /// <summary>Отрисовка Liquid Glass + Bento для нативного клиента.</summary>
    internal static class Ui
    {
        public static readonly Color Ink = Color.FromArgb(0x1E, 0x29, 0x3B);
        public static readonly Color Muted = Color.FromArgb(0x64, 0x74, 0x8B);
        public static readonly Color Line = Color.FromArgb(0xE2, 0xE8, 0xF0);
        public static readonly Color CanvasTop = Color.FromArgb(0xF7, 0xFA, 0xFF);
        public static readonly Color CanvasBottom = Color.FromArgb(0xE7, 0xEE, 0xFA);
        public static readonly Color Accent = Color.FromArgb(0x1E, 0x29, 0x3B);
        public static readonly Color AccentHover = Color.FromArgb(0x0F, 0x17, 0x2A);
        public static readonly Color Rose = Color.FromArgb(0xD9, 0x1D, 0x48);
        public static readonly Color Amber = Color.FromArgb(0xB4, 0x53, 0x09);
        public static readonly Color Emerald = Color.FromArgb(0x04, 0x78, 0x57);
        public static readonly Color Blue = Color.FromArgb(0x1D, 0x4E, 0xD8);

        /// <summary>Облегчённый режим: без размытия/прозрачности и теней.</summary>
        public static bool Reduced;

        public static Font Font(float pixels, FontStyle style)
        {
            return new Font("Segoe UI", pixels, style, GraphicsUnit.Pixel);
        }

        public static Font Font(float pixels)
        {
            return Font(pixels, FontStyle.Regular);
        }

        /// <summary>Русское склонение: «1 запись», «2 записи», «5 записей».</summary>
        public static string Plural(int count, string one, string few, string many)
        {
            int mod100 = Math.Abs(count) % 100;
            int mod10 = mod100 % 10;
            string word;
            if (mod100 >= 11 && mod100 <= 14) word = many;
            else if (mod10 == 1) word = one;
            else if (mod10 >= 2 && mod10 <= 4) word = few;
            else word = many;
            return count + " " + word;
        }

        public static GraphicsPath Round(Rectangle rect, int radius)
        {
            int d = Math.Max(2, radius * 2);
            var path = new GraphicsPath();
            if (rect.Width <= 0 || rect.Height <= 0) return path;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        /// <summary>Мягкий градиентный canvas с двумя цветовыми пятнами.</summary>
        public static void PaintCanvas(Graphics g, Rectangle area)
        {
            if (area.Width <= 0 || area.Height <= 0) return;
            if (Reduced)
            {
                using (var solid = new SolidBrush(Color.FromArgb(0xF3, 0xF7, 0xFD)))
                {
                    g.FillRectangle(solid, area);
                }
                return;
            }
            using (var brush = new LinearGradientBrush(area, CanvasTop, CanvasBottom, 90f))
            {
                g.FillRectangle(brush, area);
            }
            Blob(g, new Rectangle(area.Right - 420, -140, 640, 640), Color.FromArgb(0xC7, 0xD2, 0xFE), 70);
            Blob(g, new Rectangle(-220, area.Bottom - 360, 560, 560), Color.FromArgb(0xFD, 0xE6, 0x8A), 40);
        }

        private static void Blob(Graphics g, Rectangle bounds, Color color, int alpha)
        {
            if (bounds.Width <= 0 || bounds.Height <= 0) return;
            using (var path = new GraphicsPath())
            {
                path.AddEllipse(bounds);
                using (var brush = new PathGradientBrush(path))
                {
                    brush.CenterColor = Color.FromArgb(alpha, color);
                    brush.SurroundColors = new[] { Color.FromArgb(0, color) };
                    g.FillPath(brush, path);
                }
            }
        }

        /// <summary>Стеклянная панель: тень, полупрозрачная заливка, светлая кромка.</summary>
        public static void PaintGlass(Graphics g, Rectangle bounds, int radius, int fillAlpha, bool shadow)
        {
            if (bounds.Width <= 4 || bounds.Height <= 4) return;
            var body = new Rectangle(bounds.X + 1, bounds.Y + 1, bounds.Width - 3, bounds.Height - 3);

            if (Reduced)
            {
                using (var path = Round(body, radius))
                {
                    using (var solid = new SolidBrush(Color.White))
                    {
                        g.FillPath(solid, path);
                    }
                    using (var border = new Pen(Line, 1f))
                    {
                        g.DrawPath(border, path);
                    }
                }
                return;
            }

            if (shadow)
            {
                var shadowRect = new Rectangle(body.X, body.Y + 3, body.Width, body.Height);
                using (var path = Round(shadowRect, radius))
                using (var brush = new SolidBrush(Color.FromArgb(16, 30, 50, 80)))
                {
                    g.FillPath(brush, path);
                }
            }

            using (var path = Round(body, radius))
            {
                using (var fill = new SolidBrush(Color.FromArgb(fillAlpha, 255, 255, 255)))
                {
                    g.FillPath(fill, path);
                }
                using (var border = new Pen(Color.FromArgb(210, 255, 255, 255), 1f))
                {
                    g.DrawPath(border, path);
                }
            }

            // Световой блик сверху — тонкая линия.
            var highlight = new Rectangle(body.X + radius, body.Y + 1, Math.Max(0, body.Width - radius * 2), 1);
            using (var pen = new Pen(Color.FromArgb(120, 255, 255, 255)))
            {
                g.DrawLine(pen, highlight.Left, highlight.Top, highlight.Right, highlight.Top);
            }
        }

        public static void PaintText(Graphics g, string text, Font font, Color color, Rectangle bounds, TextFormatFlags flags)
        {
            TextRenderer.DrawText(g, text, font, bounds, color, flags);
        }
    }

    /// <summary>Панель, которая сама рисует стеклянный фон (дети с Transparent видят его).</summary>
    internal class GlassPanel : Panel
    {
        public int Radius = 18;
        public int FillAlpha = 170;
        public bool Shadow = true;

        public GlassPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Ui.PaintCanvas(e.Graphics, ClientRectangle);
            Ui.PaintGlass(e.Graphics, ClientRectangle, Radius, FillAlpha, Shadow);
        }
    }

    /// <summary>Bento-карточка: заголовок, крупное значение, подпись, акцентная полоска.</summary>
    internal class GlassCard : Control
    {
        private string _caption = string.Empty;
        private string _value = string.Empty;
        private string _hint = string.Empty;
        private Color _accent = Ui.Ink;
        private bool _hover;

        public GlassCard()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Default;
        }

        public void SetData(string caption, string value, string hint, Color accent)
        {
            _caption = caption;
            _value = value;
            _hint = hint;
            _accent = accent;
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Ui.PaintCanvas(g, ClientRectangle);
            Ui.PaintGlass(g, ClientRectangle, 16, _hover ? 200 : 178, true);

            int pad = 16;
            var accent = new Rectangle(pad, pad + 2, 4, 14);
            using (var brush = new SolidBrush(_accent))
            using (var path = Ui.Round(accent, 2))
            {
                g.FillPath(brush, path);
            }
            Ui.PaintText(g, _caption, Ui.Font(10.5f, FontStyle.Bold), Ui.Muted,
                new Rectangle(pad + 12, pad, Width - pad * 2 - 12, 18),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);

            Ui.PaintText(g, _value, Ui.Font(30f, FontStyle.Bold), _accent,
                new Rectangle(pad - 2, pad + 22, Width - pad * 2, 40),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter);

            Ui.PaintText(g, _hint, Ui.Font(10.5f), Ui.Muted,
                new Rectangle(pad, Height - 28, Width - pad * 2, 18),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>Пилюля-кнопка: primary (тёмная) или secondary (стеклянная).</summary>
    internal class PillButton : Control
    {
        private bool _hover;
        private bool _pressed;

        public bool Primary;
        public bool AlignLeft;
        public int Radius = 10;

        public PillButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            _pressed = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            _pressed = true;
            Invalidate();
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            _pressed = false;
            Invalidate();
            base.OnMouseUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var body = new Rectangle(0, 0, Width - 1, Height - 1);

            Color fill;
            Color text;
            Color border;
            if (Primary)
            {
                fill = _pressed ? Ui.AccentHover : _hover ? Ui.AccentHover : Ui.Accent;
                text = Color.White;
                border = fill;
            }
            else
            {
                fill = _hover ? Color.FromArgb(235, 255, 255, 255) : Color.FromArgb(190, 255, 255, 255);
                text = Ui.Ink;
                border = Color.FromArgb(215, 255, 255, 255);
            }

            using (var path = Ui.Round(body, Radius))
            using (var brush = new SolidBrush(fill))
            {
                g.FillPath(brush, path);
                using (var pen = new Pen(border, 1f))
                {
                    g.DrawPath(pen, path);
                }
            }

            var flags = (AlignLeft ? TextFormatFlags.Left : TextFormatFlags.HorizontalCenter)
                        | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis;
            var textRect = new Rectangle(AlignLeft ? 14 : 6, 0, AlignLeft ? Width - 20 : Width - 12, Height);
            Ui.PaintText(g, Text, Ui.Font(12.5f, Primary ? FontStyle.Bold : FontStyle.Regular), text, textRect, flags);
        }
    }


    /// <summary>Контейнер с поддержкой прозрачного фона (виден canvas и стекло).</summary>
    internal class TransparentFlow : FlowLayoutPanel
    {
        public TransparentFlow()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
        }
    }

    internal class TransparentTable : TableLayoutPanel
    {
        public TransparentTable()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
        }
    }

    internal class TransparentPanel : Panel
    {
        public TransparentPanel()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
        }
    }
    /// <summary>Canvas на весь экран: градиент и мягкие пятна.</summary>
    internal class CanvasPanel : Panel
    {
        public CanvasPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Ui.PaintCanvas(e.Graphics, ClientRectangle);
        }
    }

    /// <summary>Стеклянная модалка: без системной рамки, с заголовком и перетаскиванием.</summary>
    internal class GlassForm : Form
    {
        protected readonly TransparentPanel Body;
        private readonly string _caption;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

        public GlassForm(string caption, Size size)
        {
            _caption = caption;
            Text = caption;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            Size = size;
            MinimumSize = new Size(460, 340);
            BackColor = Color.FromArgb(0xF3, 0xF7, 0xFD);
            DoubleBuffered = true;
            KeyPreview = true;
            // Без этого WinForms масштабирует дочерние контролы по соотношению шрифтов
            // (шрифты задаются в пикселях) — и раскладка диалога «разъезжается».
            AutoScaleMode = AutoScaleMode.None;

            Body = new TransparentPanel { Dock = DockStyle.Fill, Padding = new Padding(24, 58, 24, 18) };
            Controls.Add(Body);

            var close = new PillButton { Text = "✕", Width = 36, Height = 30, Radius = 8 };
            close.Click += delegate { Close(); };
            Controls.Add(close);
            close.BringToFront();
            close.Location = new Point(Width - 50, 14);
            close.Anchor = AnchorStyles.Top | AnchorStyles.Right;

            KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Escape) Close();
            };

            MouseDown += DragWindow;
            Body.MouseDown += DragWindow;
            Resize += delegate { ApplyRegion(); };
            ApplyRegion();
        }

        private void DragWindow(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, 0xA1, 0x2, 0);
        }

        /// <summary>
        /// Окно не должно вылезать за рабочий стол: при масштабе Windows 125/150 %
        /// и на маленьких экранах диалог, отцентрованный по большому главному окну,
        /// оказывался за границей экрана. Уменьшаем и ставим по центру.
        /// </summary>
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Rectangle area = Screen.FromControl(this).WorkingArea;
            int width = Math.Min(Width, area.Width - 20);
            int height = Math.Min(Height, area.Height - 20);
            if (width != Width || height != Height)
            {
                Size = new Size(Math.Max(400, width), Math.Max(300, height));
            }
            Location = new Point(
                area.Left + Math.Max(0, (area.Width - Width) / 2),
                area.Top + Math.Max(0, (area.Height - Height) / 2));
        }

        private void ApplyRegion()
        {
            using (var path = Ui.Round(new Rectangle(0, 0, Width, Height), 18))
            {
                Region = new Region(path);
            }
            Invalidate();
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Ui.PaintCanvas(e.Graphics, ClientRectangle);
            Ui.PaintGlass(e.Graphics, ClientRectangle, 18, 208, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            TextRenderer.DrawText(
                e.Graphics,
                _caption,
                Ui.Font(17f, FontStyle.Bold),
                new Rectangle(26, 18, Width - 90, 26),
                Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>Превью вкладки при наведении: реальные данные, без интерактива.</summary>
    internal sealed class TabPreviewForm : Form
    {
        private readonly string _title;
        private readonly string _subtitle;
        private readonly string _meta;
        private readonly System.Collections.Generic.List<string> _lines;

        public TabPreviewForm(string title, string subtitle, string meta, System.Collections.Generic.List<string> lines)
        {
            _title = title;
            _subtitle = subtitle;
            _meta = meta;
            _lines = lines;

            Text = "Предпросмотр";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = Color.FromArgb(0xF3, 0xF7, 0xFD);
            DoubleBuffered = true;
            Size = new Size(330, 148);
        }

        public void ShowNear(Point screenPoint)
        {
            Rectangle area = Screen.FromPoint(screenPoint).WorkingArea;
            int x = screenPoint.X + 16;
            int y = screenPoint.Y + 18;
            if (x + Width > area.Right) x = area.Right - Width - 8;
            if (y + Height > area.Bottom) y = area.Bottom - Height - 8;
            Location = new Point(Math.Max(area.Left + 8, x), Math.Max(area.Top + 8, y));
            Show();
        }
        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Ui.PaintCanvas(e.Graphics, ClientRectangle);
            Ui.PaintGlass(e.Graphics, ClientRectangle, 14, 245, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            int y = 12;
            TextRenderer.DrawText(e.Graphics, _title, Ui.Font(14f, FontStyle.Bold),
                new Rectangle(16, y, Width - 32, 20), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += 22;
            TextRenderer.DrawText(e.Graphics, _subtitle, Ui.Font(10.5f),
                new Rectangle(16, y, Width - 32, 16), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += 20;
            TextRenderer.DrawText(e.Graphics, _meta, Ui.Font(10.5f, FontStyle.Bold),
                new Rectangle(16, y, Width - 32, 16), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += 22;
            foreach (string line in _lines)
            {
                TextRenderer.DrawText(e.Graphics, line, Ui.Font(10.5f),
                    new Rectangle(16, y, Width - 32, 16), Ui.Muted,
                    TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
                y += 18;
            }
        }
    }
}
