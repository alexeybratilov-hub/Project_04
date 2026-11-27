using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace OtBaza
{
    // =====================================================================
    //  Shell — единый доступ к оболочке главного окна для всех экранов.
    //  Позволяет открывать листы внутри окна, показывать тосты и
    //  подтверждения без отдельных системных окон.
    // =====================================================================

    internal enum NoticeKind
    {
        Info,
        Success,
        Warning,
        Danger
    }

    internal interface IShell
    {
        void ShowSheet(GlassForm form, Action onClosed);
        void CloseTopSheet();
        bool HasSheet { get; }
        void Notify(string message, NoticeKind kind);
        void Confirm(string title, string message, string confirmText, Action onYes);
        void ShowHelp(string topic);
        void RefreshData();
        void OpenTab(string tabId);
        void OpenSections();
        void OpenPortfolio();
        void OpenEntity(string entityId);
    }

    internal static class Shell
    {
        public static IShell Current;

        public static void Sheet(GlassForm form, Action onClosed)
        {
            if (Current != null)
            {
                Current.ShowSheet(form, onClosed);
                return;
            }
            using (form) form.ShowDialog();
            if (onClosed != null) onClosed();
        }

        public static void Notify(string message)
        {
            Notify(message, NoticeKind.Info);
        }

        public static void Notify(string message, NoticeKind kind)
        {
            if (Current != null) Current.Notify(message, kind);
        }

        public static void Confirm(string title, string message, string confirmText, Action onYes)
        {
            if (Current != null)
            {
                Current.Confirm(title, message, confirmText, onYes);
                return;
            }
            if (MessageBox.Show(message, title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes && onYes != null)
            {
                onYes();
            }
        }
    }

    // =====================================================================
    //  Anim — маленький движок анимаций: плавные переходы и появление.
    //  В облегчённом режиме (Ui.Reduced) всё срабатывает мгновенно.
    // =====================================================================

    internal static class Anim
    {
        private static readonly List<Timer> Alive = new List<Timer>();

        public static readonly int Fast = 140;
        public static readonly int Normal = 190;

        public static double Ease(double t)
        {
            double inverse = 1.0 - t;
            return 1.0 - inverse * inverse * inverse;
        }

        /// <summary>Плавно ведёт t от 0 к 1 за durationMs и вызывает done в конце.</summary>
        public static void Run(int durationMs, Action<double> tick, Action done)
        {
            if (tick == null) return;
            if (Ui.Reduced || durationMs <= 0)
            {
                tick(1.0);
                if (done != null) done();
                return;
            }
            var timer = new Timer { Interval = 15 };
            var watch = Stopwatch.StartNew();
            Alive.Add(timer);
            timer.Tick += delegate
            {
                double progress = Math.Min(1.0, watch.ElapsedMilliseconds / (double)durationMs);
                tick(Ease(progress));
                if (progress >= 1.0)
                {
                    timer.Stop();
                    Alive.Remove(timer);
                    timer.Dispose();
                    if (done != null) done();
                }
            };
            timer.Start();
        }

        /// <summary>Кроссфейд содержимого: старый кадр плавно уступает новому экрану.</summary>
        public static void Swap(Panel host, Control newContent)
        {
            if (host == null || newContent == null) return;
            if (Ui.Reduced || host.Width < 8 || host.Height < 8)
            {
                host.SuspendLayout();
                host.Controls.Clear();
                host.Controls.Add(newContent);
                host.ResumeLayout();
                return;
            }

            Bitmap snapshot = null;
            try
            {
                snapshot = new Bitmap(host.Width, host.Height);
                host.DrawToBitmap(snapshot, new Rectangle(0, 0, host.Width, host.Height));
            }
            catch
            {
                snapshot = null;
            }

            host.SuspendLayout();
            host.Controls.Clear();
            host.Controls.Add(newContent);
            host.ResumeLayout();

            if (snapshot == null) return;

            var veil = new FadeVeil(snapshot);
            host.Controls.Add(veil);
            veil.BringToFront();
            Anim.Run(Normal, delegate(double t)
            {
                if (veil.IsDisposed) return;
                veil.Alpha = (int)(235 * (1.0 - t));
                veil.Invalidate();
            }, delegate
            {
                if (!veil.IsDisposed)
                {
                    host.Controls.Remove(veil);
                    veil.Dispose();
                }
            });
        }

        private sealed class FadeVeil : Control
        {
            private readonly Bitmap _snapshot;
            public int Alpha = 235;

            public FadeVeil(Bitmap snapshot)
            {
                _snapshot = snapshot;
                SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
                Dock = DockStyle.Fill;
                BackColor = Color.Transparent;
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                if (_snapshot == null) return;
                var attributes = new System.Drawing.Imaging.ImageAttributes();
                try
                {
                    var matrix = new System.Drawing.Imaging.ColorMatrix();
                    matrix.Matrix33 = Math.Max(0f, Math.Min(1f, Alpha / 255f));
                    attributes.SetColorMatrix(matrix, System.Drawing.Imaging.ColorMatrixFlag.Default, System.Drawing.Imaging.ColorAdjustType.Bitmap);
                    e.Graphics.DrawImage(
                        _snapshot,
                        new Rectangle(0, 0, Width, Height),
                        0, 0, _snapshot.Width, _snapshot.Height,
                        GraphicsUnit.Pixel, attributes);
                }
                finally
                {
                    attributes.Dispose();
                }
            }

            protected override void Dispose(bool disposing)
            {
                if (disposing && _snapshot != null) _snapshot.Dispose();
                base.Dispose(disposing);
            }
        }
    }

    // =====================================================================
    //  SheetHost — «окна» внутри главного окна.
    //  Тот же экземпляр GlassForm просто хостится как дочерний контрол:
    //  логика форм не переписывается, а пользователь остаётся в одном окне.
    // =====================================================================

    internal sealed class SheetHost : Panel
    {
        public int MaxSheetWidth = 1040;
        public int MaxSheetHeight = 820;

        private readonly List<Layer> _layers = new List<Layer>();

        public bool HasSheets
        {
            get { return _layers.Count > 0; }
        }

        private Bitmap _backdrop;

        public SheetHost()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint, true);
            BackColor = Color.Transparent;
            Dock = DockStyle.Fill;
            // Пустой оверлей не должен перекрывать рабочую область: он показывается
            // только когда открыт хотя бы один лист.
            Visible = false;
        }

        public void Push(GlassForm form, Action onClosed)
        {
            if (form == null) return;
            if (_layers.Count == 0) CaptureBackdrop();
            var layer = new Layer(this, form, onClosed, _layers.Count);
            _layers.Add(layer);
            Controls.Add(layer.Root);
            layer.Root.BringToFront();
            Visible = true;
            if (Parent != null) Bounds = Parent.ClientRectangle;
            layer.Show();
        }

        /// <summary>
        /// Под листом рисуется снимок рабочей области: полупрозрачные панели WinForms
        /// не умеют честно перекрывать соседей, поэтому фон фиксируется один раз при открытии.
        /// </summary>
        private void CaptureBackdrop()
        {
            try
            {
                Control source = Parent;
                if (source == null || source.Width <= 0 || source.Height <= 0) return;
                var bitmap = new Bitmap(source.Width, source.Height);
                source.DrawToBitmap(bitmap, new Rectangle(0, 0, source.Width, source.Height));
                _backdrop = bitmap;
            }
            catch
            {
                _backdrop = null;
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            if (_backdrop != null)
            {
                e.Graphics.DrawImage(_backdrop, new Rectangle(0, 0, Width, Height));
                return;
            }
            base.OnPaintBackground(e);
        }

        public void PopTop()
        {
            if (_layers.Count == 0) return;
            Layer top = _layers[_layers.Count - 1];
            if (top.Form != null && !top.Form.IsDisposed) top.Form.Close();
        }

        internal void OnClosed(Layer layer)
        {
            if (!_layers.Contains(layer)) return;
            _layers.Remove(layer);
            if (layer.Root != null && !layer.Root.IsDisposed)
            {
                Controls.Remove(layer.Root);
                layer.Root.Dispose();
            }
            if (_layers.Count == 0)
            {
                Visible = false;
                if (_backdrop != null)
                {
                    _backdrop.Dispose();
                    _backdrop = null;
                }
            }
            if (layer.OnClosed != null) layer.OnClosed();
        }

        internal sealed class Layer
        {
            private readonly SheetHost _host;
            public readonly GlassForm Form;
            public readonly Action OnClosed;
            public readonly SheetLayerPanel Root;
            private readonly GlassPanel _card;
            private readonly int _index;
            private bool _closing;

            public Layer(SheetHost host, GlassForm form, Action onClosed, int index)
            {
                _host = host;
                Form = form;
                OnClosed = onClosed;
                _index = index;

                Root = new SheetLayerPanel { Dock = DockStyle.Fill };

                _card = new GlassPanel
                {
                    Radius = 20,
                    FillAlpha = 190,
                    Padding = new Padding(0),
                    BackColor = Color.Transparent
                };
                Root.Controls.Add(_card);

                form.Embedded = true;
                form.TopLevel = false;
                form.FormBorderStyle = FormBorderStyle.None;
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(0, 0);
                form.Dock = DockStyle.None;
                _preferred = form.Size;
                _card.Controls.Add(form);
                form.FormClosed += delegate
                {
                    if (_closing) return;
                    _closing = true;
                    _host.OnClosed(this);
                };

                Root.Resize += delegate { LayoutCard(); };
                // Показываем форму уже в роли дочернего контрола: иначе WinForms
                // не раскладывает её содержимое и лист выглядит пустым.
                form.Show();
                form.Bounds = new Rectangle(0, 0, _card.ClientSize.Width, _card.ClientSize.Height);
            }

            private void PaintDim(object sender, PaintEventArgs e)
            {
                int alpha = 64 + Math.Min(40, _index * 26);
                using (var brush = new SolidBrush(Color.FromArgb(alpha, 15, 23, 42)))
                {
                    e.Graphics.FillRectangle(brush, Root.ClientRectangle);
                }
            }

            private Size _preferred;

            private void LayoutCard()
            {
                if (Root.IsDisposed) return;
                int width = Math.Min(_host.MaxSheetWidth, Math.Max(420, _preferred.Width));
                int height = Math.Min(_host.MaxSheetHeight, Math.Max(320, _preferred.Height));
                width = Math.Min(width, Math.Max(400, Root.Width - 48));
                height = Math.Min(height, Math.Max(300, Root.Height - 40));
                int x = Math.Max(12, (Root.Width - width) / 2);
                int y = Math.Max(10, (Root.Height - height) / 2);
                int offset = (int)(18 * (1.0 - _progress));
                _card.Bounds = new Rectangle(x, y + offset, width, height);
                if (Form != null && !Form.IsDisposed)
                {
                    // 6 px стеклянной каймы вокруг листа: видно, что это панель поверх
                    // рабочей области, а не отдельное белое окно.
                    Form.Bounds = new Rectangle(6, 6, Math.Max(200, width - 12), Math.Max(160, height - 12));
                }
            }

            private double _progress;
            public int TargetDim = 80;

            public void Show()
            {
                LayoutCard();
                Root.DimAlpha = 0;
                Root.Invalidate();
                Anim.Run(Anim.Normal, delegate(double t)
                {
                    _progress = t;
                    Root.DimAlpha = (int)(TargetDim * t);
                    LayoutCard();
                    Root.Invalidate();
                }, null);
            }
        }
    }

    /// <summary>Слой затемнения под листом: тёмная полупрозрачная подложка.</summary>
    internal sealed class SheetLayerPanel : Panel
    {
        public int DimAlpha;

        public SheetLayerPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Dock = DockStyle.Fill;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (DimAlpha <= 0) return;
            using (var brush = new SolidBrush(Color.FromArgb(Math.Min(140, DimAlpha), 15, 23, 42)))
            {
                e.Graphics.FillRectangle(brush, ClientRectangle);
            }
        }
    }

    // =====================================================================
    //  ToastHost — всплывающие уведомления внутри окна (вместо MessageBox).
    // =====================================================================

    internal sealed class ToastHost : Control
    {
        private readonly List<Toast> _toasts = new List<Toast>();

        public ToastHost()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
            Visible = false;
        }

        public void Show(string message, NoticeKind kind)
        {
            if (message == null) message = string.Empty;
            if (message.Length > 260) message = message.Substring(0, 257) + "…";
            var toast = new Toast(this, message, kind);
            toast.Width = Math.Min(430, Math.Max(240, Width - 40));
            toast.Height = Math.Max(48, toast.MeasureHeight());
            _toasts.Add(toast);
            Controls.Add(toast);
            Reflow();
            toast.PlayIn();
            var timer = new Timer { Interval = 4200 };
            timer.Tick += delegate
            {
                timer.Stop();
                timer.Dispose();
                toast.PlayOut();
            };
            timer.Start();
        }

        internal void Remove(Toast toast)
        {
            _toasts.Remove(toast);
            if (!toast.IsDisposed)
            {
                Controls.Remove(toast);
                toast.Dispose();
            }
            Reflow();
        }

        private void Reflow()
        {
            int y = Height - 18;
            for (int i = _toasts.Count - 1; i >= 0; i--)
            {
                Toast toast = _toasts[i];
                if (toast.IsDisposed) continue;
                y -= toast.Height;
                toast.TargetTop = y;
                toast.TargetLeft = Math.Max(12, Width - toast.Width - 22);
                if (!toast.Animating)
                {
                    toast.Left = toast.TargetLeft;
                    toast.Top = toast.TargetTop;
                }
                y -= 10;
            }
            UpdateRegion();
        }

        private void UpdateRegion()
        {
            if (_toasts.Count == 0)
            {
                Visible = false;
                return;
            }
            Visible = true;
            var union = new Region();
            union.MakeEmpty();
            foreach (Toast toast in _toasts)
            {
                if (toast.IsDisposed) continue;
                var rect = new Rectangle(toast.TargetLeft, toast.TargetTop, toast.Width, toast.Height);
                union.Union(rect);
            }
            if (Region != null) Region.Dispose();
            Region = union;
            Invalidate();
        }

        internal void ReflowPublic()
        {
            Reflow();
        }

        internal sealed class Toast : Control
        {
            private readonly ToastHost _host;
            private readonly string _message;
            private readonly NoticeKind _kind;
            private readonly int _lines;
            public int TargetTop;
            public int TargetLeft;
            public bool Animating;

            public Toast(ToastHost host, string message, NoticeKind kind)
            {
                _host = host;
                _message = message;
                _kind = kind;
                SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
                BackColor = Color.Transparent;
                int perLine = Math.Max(18, (Width - 66) / 7);
                _lines = Math.Max(1, Math.Min(4, (int)Math.Ceiling(message.Length / (double)perLine)));
            }

            public int MeasureHeight()
            {
                return 26 + _lines * 19;
            }

            public void PlayIn()
            {
                Animating = true;
                int startTop = TargetTop + 16;
                Left = TargetLeft;
                Top = startTop;
                double from = startTop;
                Anim.Run(Anim.Fast, delegate(double t)
                {
                    if (IsDisposed) return;
                    Top = (int)(from + (TargetTop - from) * t);
                }, delegate
                {
                    Animating = false;
                    Top = TargetTop;
                });
            }

            public void PlayOut()
            {
                Animating = true;
                double from = Top;
                Anim.Run(Anim.Fast, delegate(double t)
                {
                    if (IsDisposed) return;
                    Top = (int)(from + 14 * t);
                }, delegate
                {
                    if (!IsDisposed) _host.Remove(this);
                });
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                var body = new Rectangle(0, 0, Width - 1, Height - 1);
                using (var path = Ui.Round(body, 12))
                using (var brush = new SolidBrush(Color.FromArgb(248, 255, 255, 255)))
                {
                    g.FillPath(brush, path);
                    using (var pen = new Pen(Ui.Line, 1f)) g.DrawPath(pen, path);
                }
                Color accent = _kind == NoticeKind.Danger ? Ui.Rose
                    : _kind == NoticeKind.Warning ? Ui.Amber
                    : _kind == NoticeKind.Success ? Ui.Emerald
                    : Ui.Blue;
                using (var dot = new SolidBrush(accent))
                {
                    g.FillEllipse(dot, 16, 15, 10, 10);
                }
                TextRenderer.DrawText(g, _message, Ui.Font(11.5f),
                    new Rectangle(38, 10, Width - 52, Height - 14),
                    Ui.Ink, TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            }
        }
    }

    // =====================================================================
    //  ConfirmForm — подтверждение внутри окна (вместо MessageBox.YesNo).
    // =====================================================================

    internal sealed class ConfirmForm : GlassForm
    {
        public bool Confirmed;

        public ConfirmForm(string title, string message, string confirmText, bool destructive)
            : base(title, new Size(600, 300))
        {
            var text = new Label
            {
                Text = message,
                Dock = DockStyle.Top,
                Height = 118,
                Font = Ui.Font(12.5f),
                ForeColor = Ui.Ink,
                BackColor = Color.Transparent
            };
            Body.Controls.Add(text);

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 52,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 8, 0, 0)
            };
            Body.Controls.Add(footer);

            var ok = new PillButton
            {
                Text = confirmText,
                Primary = true,
                Width = Math.Max(150, TextRenderer.MeasureText(confirmText, Ui.Font(12.5f, FontStyle.Bold)).Width + 34),
                Height = 38,
                Margin = new Padding(8, 0, 0, 0)
            };
            ok.AccentColor = destructive ? Ui.Rose : Ui.Accent;
            ok.Click += delegate
            {
                Confirmed = true;
                DialogResult = DialogResult.OK;
                Close();
            };
            footer.Controls.Add(ok);

            var cancel = new PillButton { Text = "Отмена", Width = 120, Height = 38 };
            cancel.Click += delegate { Close(); };
            footer.Controls.Add(cancel);
        }
    }

    // =====================================================================
    //  BentoGrid — адаптивная сетка карточек: при сужении окна колонки
    //  уменьшаются, а элементы переезжают ниже. Горизонтальной прокрутки нет.
    // =====================================================================

    internal sealed class BentoGrid : Panel
    {
        public int MinTileWidth = 250;
        public int Gap = 12;
        public int MaxColumns = 4;
        public int RowHeight = 148;
        public bool AutoHeight = true;

        private readonly List<Tile> _tiles = new List<Tile>();
        private bool _laying;

        public BentoGrid()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
            Padding = new Padding(0);
        }

        private sealed class Tile
        {
            public Control Control;
            public int Span = 1;
            public bool FullRow;
            public int Height;
        }

        public void ClearTiles()
        {
            SuspendLayout();
            Controls.Clear();
            _tiles.Clear();
            ResumeLayout();
        }

        public void AddTile(Control control, int span)
        {
            AddTile(control, span, 0);
        }

        public void AddTile(Control control, int span, int height)
        {
            if (control == null) return;
            control.Margin = new Padding(0);
            var tile = new Tile { Control = control, Span = Math.Max(1, span), Height = height };
            _tiles.Add(tile);
            Controls.Add(control);
        }

        public void AddFullRow(Control control, int height)
        {
            if (control == null) return;
            control.Margin = new Padding(0);
            var tile = new Tile { Control = control, Span = 4, FullRow = true, Height = height };
            _tiles.Add(tile);
            Controls.Add(control);
        }

        public int ColumnsForWidth(int width)
        {
            if (width < 60) return 1;
            int columns = (width + Gap) / (MinTileWidth + Gap);
            return Math.Max(1, Math.Min(MaxColumns, columns));
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            LayoutTiles();
        }

        protected override void OnLayout(LayoutEventArgs levent)
        {
            base.OnLayout(levent);
            if (!_laying) LayoutTiles();
        }

        public void LayoutTiles()
        {
            if (_laying || _tiles.Count == 0) return;
            _laying = true;
            try
            {
                int width = ClientSize.Width;
                if (width < 40) return;
                int columns = ColumnsForWidth(width);
                int y = 0;
                int index = 0;
                while (index < _tiles.Count)
                {
                    var row = new List<Tile>();
                    int used = 0;
                    while (index < _tiles.Count)
                    {
                        Tile tile = _tiles[index];
                        int span = tile.FullRow ? columns : Math.Min(tile.Span, columns);
                        if (used > 0 && used + span > columns) break;
                        row.Add(tile);
                        used += span;
                        index++;
                        if (used >= columns) break;
                    }
                    int rowHeight = 0;
                    foreach (Tile tile in row)
                    {
                        int wanted = tile.Height > 0 ? tile.Height : RowHeight;
                        rowHeight = Math.Max(rowHeight, wanted);
                    }
                    if (rowHeight <= 0) rowHeight = RowHeight;
                    int columnWidth = (width - Gap * (columns - 1)) / columns;
                    int x = 0;
                    foreach (Tile tile in row)
                    {
                        int span = tile.FullRow ? columns : Math.Min(tile.Span, columns);
                        int tileWidth = columnWidth * span + Gap * (span - 1);
                        if (tile.Control.Bounds.X != x || tile.Control.Bounds.Y != y ||
                            tile.Control.Width != tileWidth || tile.Control.Height != rowHeight)
                        {
                            tile.Control.Bounds = new Rectangle(x, y, tileWidth, rowHeight);
                        }
                        x += tileWidth + Gap;
                    }
                    y += rowHeight + Gap;
                }
                int desiredHeight = Math.Max(0, y - Gap);
                if (AutoHeight && Height != desiredHeight)
                {
                    Height = desiredHeight;
                }
            }
            finally
            {
                _laying = false;
            }
        }


    }

    // =====================================================================
    //  Виджеты дашбордов.
    // =====================================================================

    /// <summary>Базовый виджет: стеклянная подложка, мягкий цветной оттенок и hover.</summary>
    internal abstract class TileBase : Control
    {
        protected Color Accent = Ui.Blue;
        protected Color Tint = Color.Transparent;
        protected bool Clickable;
        private bool _hover;
        private double _lift;

        protected TileBase()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Default;
        }

        public void SetAccent(Color accent, Color tint)
        {
            Accent = accent;
            Tint = tint;
            Invalidate();
        }

        public void SetClickable()
        {
            Clickable = true;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            if (Clickable) AnimateHover(1.0);
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            if (Clickable) AnimateHover(0.0);
            base.OnMouseLeave(e);
        }

        private void AnimateHover(double target)
        {
            if (Ui.Reduced)
            {
                _hover = target > 0.5;
                _lift = target;
                Invalidate();
                return;
            }
            _hover = target > 0.5;
            double from = _lift;
            Anim.Run(Anim.Fast, delegate(double t)
            {
                if (IsDisposed) return;
                _lift = from + (target - from) * t;
                Invalidate();
            }, null);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Ui.PaintCanvas(g, ClientRectangle);
            var body = new Rectangle(0, 0, Width - 1, Height - 1);
            int alpha = 182 + (int)(_lift * 26);
            PaintTileGlass(g, body, alpha);
            if (Tint != Color.Transparent)
            {
                using (var path = Ui.Round(body, 15))
                using (var brush = new SolidBrush(Color.FromArgb(28, Tint)))
                {
                    g.FillPath(brush, path);
                }
            }
            PaintContent(g);
        }

        protected virtual void PaintTileGlass(Graphics g, Rectangle body, int alpha)
        {
            Ui.PaintGlass(g, body, 15, alpha, true);
        }

        protected abstract void PaintContent(Graphics g);

        protected void PaintCaption(Graphics g, string text, Rectangle bounds)
        {
            TextRenderer.DrawText(g, text, Ui.Font(10.5f, FontStyle.Bold), bounds, Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }

        protected void PaintValue(Graphics g, string text, Color color, Rectangle bounds)
        {
            TextRenderer.DrawText(g, text, Ui.Font(30f, FontStyle.Bold), bounds, color,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPrefix);
        }
    }

    /// <summary>KPI-плитка: подпись, крупное число, пояснение, цветной маркер.</summary>
    internal sealed class KpiTile : TileBase
    {
        private string _caption = string.Empty;
        private string _value = string.Empty;
        private string _hint = string.Empty;

        public KpiTile()
        {
            SetAccent(Ui.Blue, Color.Transparent);
        }

        public void SetData(string caption, string value, string hint, Color accent)
        {
            _caption = caption ?? string.Empty;
            _value = value ?? string.Empty;
            _hint = hint ?? string.Empty;
            SetAccent(accent, accent);
            Invalidate();
        }

        protected override void PaintContent(Graphics g)
        {
            int pad = 16;
            using (var brush = new SolidBrush(Accent))
            {
                g.FillEllipse(brush, pad, pad + 1, 9, 9);
            }
            PaintCaption(g, _caption, new Rectangle(pad + 16, pad - 6, Width - pad * 2 - 16, 20));
            PaintValue(g, _value, Accent, new Rectangle(pad - 1, pad + 24, Width - pad * 2, 42));
            TextRenderer.DrawText(g, _hint, Ui.Font(10.5f),
                new Rectangle(pad, Height - 30, Width - pad * 2, 18), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }

    /// <summary>Виджет юридического лица для витрины «Все организации».</summary>
    internal sealed class EntityTile : TileBase
    {
        private string _title = string.Empty;
        private string _inn = string.Empty;
        private int _records;
        private int _employees;
        private int _overdue;
        private int _soon;
        private int _documents;
        private bool _active;

        public string EntityId;
        public event EventHandler Open;

        public EntityTile()
        {
            SetAccent(Ui.Blue, Color.Transparent);
            SetClickable();
        }

        public void SetData(string entityId, string title, string inn, int records, int employees,
            int overdue, int soon, int documents, bool active)
        {
            EntityId = entityId;
            _title = title ?? string.Empty;
            _inn = inn ?? string.Empty;
            _records = records;
            _employees = employees;
            _overdue = overdue;
            _soon = soon;
            _documents = documents;
            _active = active;
            Color accent = overdue > 0 ? Ui.Rose : soon > 0 ? Ui.Amber : Ui.Emerald;
            SetAccent(accent, accent);
            Invalidate();
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            if (Open != null) Open(this, EventArgs.Empty);
        }

        protected override void PaintContent(Graphics g)
        {
            int pad = 16;
            PaintCaption(g, _active ? "ТЕКУЩЕЕ ЮРЛИЦО" : "ЮРЛИЦО",
                new Rectangle(pad, pad - 4, Width - pad * 2 - 90, 18));

            TextRenderer.DrawText(g, _title, Ui.Font(15.5f, FontStyle.Bold),
                new Rectangle(pad, pad + 16, Width - pad * 2, 24), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

            string meta = _inn.Length > 0 ? "ИНН " + _inn : "реквизиты не заполнены";
            TextRenderer.DrawText(g, meta, Ui.Font(10.5f),
                new Rectangle(pad, pad + 42, Width - pad * 2, 16), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

            int rowY = pad + 68;
            int columnWidth = Math.Max(58, (Width - pad * 2) / 3);
            DrawMetric(g, pad, rowY, "Записей", _records.ToString(), Ui.Ink, columnWidth);
            DrawMetric(g, pad + columnWidth, rowY, "Работников", _employees.ToString(), Ui.Ink, columnWidth);
            DrawMetric(g, pad + columnWidth * 2, rowY, "Документов", _documents.ToString(), Ui.Ink, columnWidth);

            int statusY = Height - 44;
            string status;
            Color statusColor;
            Color statusTint;
            if (_overdue > 0)
            {
                status = "Просрочено: " + _overdue;
                statusColor = Ui.Rose;
                statusTint = Color.FromArgb(26, Ui.Rose);
            }
            else if (_soon > 0)
            {
                status = "Сроки скоро: " + _soon;
                statusColor = Ui.Amber;
                statusTint = Color.FromArgb(26, Ui.Amber);
            }
            else
            {
                status = "Сроки в порядке";
                statusColor = Ui.Emerald;
                statusTint = Color.FromArgb(22, Ui.Emerald);
            }
            var badge = new Rectangle(pad, statusY, Math.Min(Width - pad * 2, 210), 24);
            using (var path = Ui.Round(badge, 7))
            using (var brush = new SolidBrush(statusTint))
            using (var pen = new Pen(Color.FromArgb(70, statusColor), 1f))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            TextRenderer.DrawText(g, status, Ui.Font(10.5f, FontStyle.Bold), badge, statusColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPrefix);

            TextRenderer.DrawText(g, "открыть →", Ui.Font(10.5f), new Rectangle(pad, statusY + 2, Width - pad * 2, 20), Ui.Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        }

        private void DrawMetric(Graphics g, int x, int y, string caption, string value, Color color, int columnWidth)
        {
            TextRenderer.DrawText(g, value, Ui.Font(14f, FontStyle.Bold), new Rectangle(x, y, columnWidth - 4, 20), color,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, caption, Ui.Font(9.5f), new Rectangle(x, y + 20, columnWidth - 4, 16), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }

    /// <summary>Короткий переход в раздел: иконка-буква, название, количество записей.</summary>
    internal sealed class SectionTile : TileBase
    {
        private string _title = string.Empty;
        private string _meta = string.Empty;
        private string _glyph = "•";
        public event EventHandler Open;

        public SectionTile()
        {
            SetAccent(Ui.Blue, Color.Transparent);
            SetClickable();
        }

        public void SetData(string title, string meta, string glyph, Color accent)
        {
            _title = title ?? string.Empty;
            _meta = meta ?? string.Empty;
            _glyph = string.IsNullOrEmpty(glyph) ? "•" : glyph;
            SetAccent(accent, accent);
            Invalidate();
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            if (Open != null) Open(this, EventArgs.Empty);
        }

        protected override void PaintContent(Graphics g)
        {
            int pad = 14;
            var icon = new Rectangle(pad, (Height - 36) / 2, 36, 36);
            using (var path = Ui.Round(icon, 10))
            using (var brush = new SolidBrush(Color.FromArgb(30, Accent)))
            {
                g.FillPath(brush, path);
            }
            TextRenderer.DrawText(g, _glyph, Ui.Font(15f, FontStyle.Bold), icon, Accent,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            int textX = pad + 46;
            TextRenderer.DrawText(g, _title, Ui.Font(12.5f, FontStyle.Bold),
                new Rectangle(textX, pad + 6, Width - textX - pad, 22), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, _meta, Ui.Font(10f),
                new Rectangle(textX, pad + 28, Width - textX - pad, 18), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }


    /// <summary>Плитка-действие с крупным «+»: создать юрлицо, создать раздел.</summary>
    internal sealed class PlusTile : TileBase
    {
        private string _title = string.Empty;
        private string _subtitle = string.Empty;
        public event EventHandler Open;

        public PlusTile()
        {
            SetAccent(Ui.Blue, Ui.Blue);
            SetClickable();
        }

        public void SetData(string title, string subtitle, Color accent)
        {
            _title = title ?? string.Empty;
            _subtitle = subtitle ?? string.Empty;
            SetAccent(accent, accent);
            Invalidate();
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            if (Open != null) Open(this, EventArgs.Empty);
        }

        protected override void PaintContent(Graphics g)
        {
            int diameter = Math.Min(58, Math.Max(34, Height - 92));
            int centerX = Width / 2;
            int top = Math.Max(18, Height / 2 - diameter / 2 - 10);
            var circle = new Rectangle(centerX - diameter / 2, top, diameter, diameter);
            using (var path = Ui.Round(circle, diameter / 2))
            using (var brush = new SolidBrush(Color.FromArgb(34, Accent)))
            using (var pen = new Pen(Color.FromArgb(120, Accent), 1.4f))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            TextRenderer.DrawText(g, "＋", Ui.Font(diameter / 2f + 3f, FontStyle.Bold), circle, Accent,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            int titleY = circle.Bottom + 10;
            TextRenderer.DrawText(g, _title, Ui.Font(12.5f, FontStyle.Bold),
                new Rectangle(10, titleY, Width - 20, 22), Ui.Ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            if (Height > titleY + 40)
            {
                TextRenderer.DrawText(g, _subtitle, Ui.Font(10f),
                    new Rectangle(14, titleY + 21, Width - 28, 32), Ui.Muted,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            }
        }
    }
    /// <summary>Полоса с пояснением: что это, зачем и как сделать.</summary>
    internal sealed class HintBar : Control
    {
        private string _title = string.Empty;
        private string _text = string.Empty;
        private Color _accent = Ui.Blue;
        private double _appear;

        public HintBar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Height = 58;
        }

        public void SetData(string title, string text, Color accent)
        {
            _title = title ?? string.Empty;
            _text = text ?? string.Empty;
            _accent = accent;
            Height = MeasureHeight(Width);
            Invalidate();
        }

        public int MeasureHeight(int width)
        {
            if (width < 120) width = 620;
            int textWidth = Math.Max(80, width - 70);
            Size size = TextRenderer.MeasureText(_text, Ui.Font(10.5f), new Size(textWidth, 0), TextFormatFlags.WordBreak);
            return 24 + Math.Max(18, size.Height) + 12;
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            int wanted = MeasureHeight(Width);
            if (Height != wanted && Width > 60) Height = wanted;
            Invalidate();
        }

        public void Appear()
        {
            if (Ui.Reduced)
            {
                _appear = 1;
                Invalidate();
                return;
            }
            _appear = 0;
            Anim.Run(Anim.Normal + 60, delegate(double t)
            {
                if (IsDisposed) return;
                _appear = t;
                Invalidate();
            }, null);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var body = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Ui.Round(body, 12))
            using (var brush = new SolidBrush(Color.FromArgb((int)(20 * _appear), _accent)))
            {
                g.FillPath(brush, path);
            }
            using (var pen = new Pen(Color.FromArgb((int)(60 * _appear), _accent), 1f))
            using (var path = Ui.Round(body, 12))
            {
                g.DrawPath(pen, path);
            }
            using (var dot = new SolidBrush(Color.FromArgb((int)(255 * _appear), _accent)))
            {
                g.FillEllipse(dot, 14, 15, 9, 9);
            }
            TextRenderer.DrawText(g, _title, Ui.Font(11f, FontStyle.Bold),
                new Rectangle(32, 10, Width - 46, 18), Color.FromArgb((int)(255 * _appear), Ui.Ink),
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, _text, Ui.Font(10.5f),
                new Rectangle(32, 29, Width - 46, Math.Max(16, Height - 36)), Color.FromArgb((int)(255 * _appear), Ui.Muted),
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        }
    }

    /// <summary>Кольцевой индикатор «Готовность к проверке» с пояснением.</summary>
    internal sealed class GaugeTile : TileBase
    {
        private int _percent;
        private string _level = string.Empty;
        private string _hint = string.Empty;
        private string _caption = "ГОТОВНОСТЬ К ПРОВЕРКЕ";
        public event EventHandler Open;

        public GaugeTile()
        {
            SetAccent(Ui.Blue, Color.Transparent);
            SetClickable();
        }

        public void SetData(int percent, string level, string hint, Color accent)
        {
            _percent = Math.Max(0, Math.Min(100, percent));
            _level = level ?? string.Empty;
            _hint = hint ?? string.Empty;
            SetAccent(accent, accent);
            Invalidate();
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            if (Open != null) Open(this, EventArgs.Empty);
        }

        protected override void PaintContent(Graphics g)
        {
            int pad = 16;
            PaintCaption(g, _caption, new Rectangle(pad, pad - 4, Width - pad * 2 - 8, 18));
            int size = Math.Max(64, Math.Min(90, Math.Min(Width - pad * 2 - 130, Height - 108)));
            var ring = new Rectangle(pad, pad + 22, size, size);
            using (var pen = new Pen(Color.FromArgb(40, Accent), 8f))
            {
                g.DrawEllipse(pen, ring);
            }
            if (_percent > 0)
            {
                using (var pen = new Pen(Accent, 8f))
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawArc(pen, ring, -90f, 360f * _percent / 100f);
                }
            }
            TextRenderer.DrawText(g, _percent + "%", Ui.Font(16f, FontStyle.Bold), ring, Accent,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);

            int textX = ring.Right + 14;
            int textWidth = Math.Max(60, Width - textX - pad);
            TextRenderer.DrawText(g, _level, Ui.Font(13f, FontStyle.Bold),
                new Rectangle(textX, ring.Top + 8, textWidth, 22), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, _percent + " из 100 баллов", Ui.Font(10.5f),
                new Rectangle(textX, ring.Top + 32, textWidth, 18), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, "открыть отчёт →", Ui.Font(10.5f, FontStyle.Bold),
                new Rectangle(textX, ring.Top + 54, textWidth, 18), Accent,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

            int hintTop = ring.Bottom + 10;
            if (hintTop < Height - 24)
            {
                TextRenderer.DrawText(g, _hint, Ui.Font(10.5f),
                    new Rectangle(pad, hintTop, Width - pad * 2, Height - hintTop - 8), Ui.Muted,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            }
        }
    }

    /// <summary>Плавающее превью раздела внутри окна (вместо отдельного topmost-окна).</summary>
    internal sealed class PreviewPopup : GlassPanel
    {
        private string _title = string.Empty;
        private string _subtitle = string.Empty;
        private string _meta = string.Empty;
        private readonly List<string> _lines = new List<string>();

        public PreviewPopup()
        {
            Radius = 14;
            FillAlpha = 250;
            Size = new Size(330, 150);
            Visible = false;
        }

        public void SetData(string title, string subtitle, string meta, List<string> lines)
        {
            _title = title ?? string.Empty;
            _subtitle = subtitle ?? string.Empty;
            _meta = meta ?? string.Empty;
            _lines.Clear();
            if (lines != null) _lines.AddRange(lines.Take(4));
            Height = 64 + Math.Max(1, _lines.Count) * 18;
            Invalidate();
        }

        public void ShowNear(Control anchor, int hostWidth, int hostHeight)
        {
            if (anchor == null) return;
            Point origin = new Point(0, 0);
            Control walk = anchor;
            while (walk != null && walk != Parent)
            {
                origin.Offset(walk.Left, walk.Top);
                walk = walk.Parent;
            }
            int x = origin.X;
            int y = origin.Y + anchor.Height + 6;
            if (x + Width > hostWidth - 8) x = hostWidth - Width - 8;
            if (y + Height > hostHeight - 8) y = Math.Max(8, origin.Y - Height - 6);
            Location = new Point(Math.Max(8, x), Math.Max(8, y));
            Visible = true;
            BringToFront();
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            int pad = 14;
            TextRenderer.DrawText(g, _title, Ui.Font(13.5f, FontStyle.Bold),
                new Rectangle(pad, 12, Width - pad * 2, 20), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, _subtitle, Ui.Font(10.5f),
                new Rectangle(pad, 33, Width - pad * 2, 16), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, _meta, Ui.Font(10.5f, FontStyle.Bold),
                new Rectangle(pad, 51, Width - pad * 2, 16), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            int y = 72;
            foreach (string line in _lines)
            {
                TextRenderer.DrawText(g, line, Ui.Font(10.5f),
                    new Rectangle(pad, y, Width - pad * 2, 16), Ui.Muted,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                y += 18;
            }
        }
    }

    /// <summary>Контейнер с вертикальной прокруткой и без горизонтальной.</summary>
    internal sealed class VerticalScroll : Panel
    {
        public VerticalScroll()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
            AutoScroll = true;
            HorizontalScroll.Maximum = 0;
            HorizontalScroll.Visible = false;
        }

        protected override void OnLayout(LayoutEventArgs levent)
        {
            base.OnLayout(levent);
            HorizontalScroll.Maximum = 0;
            HorizontalScroll.Visible = false;
            HorizontalScroll.Enabled = false;
        }
    }

    /// <summary>Заголовок экрана: крупный заголовок, подпись и строка действий.</summary>
    internal sealed class PageHeader : Control
    {
        public string Title = string.Empty;
        public string Subtitle = string.Empty;
        private readonly List<Control> _actions = new List<Control>();

        public PageHeader()
        {
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.Transparent;
            Height = 62;
        }

        public void SetData(string title, string subtitle)
        {
            Title = title ?? string.Empty;
            Subtitle = subtitle ?? string.Empty;
            Invalidate();
        }

        public void AddAction(Control control)
        {
            if (control == null) return;
            control.Margin = new Padding(6, 0, 0, 0);
            _actions.Add(control);
            Controls.Add(control);
            control.BringToFront();
            LayoutActions();
        }

        public void ClearActions()
        {
            foreach (Control control in _actions)
            {
                Controls.Remove(control);
                control.Dispose();
            }
            _actions.Clear();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutActions();
        }

        private void LayoutActions()
        {
            int x = Width;
            for (int i = _actions.Count - 1; i >= 0; i--)
            {
                Control control = _actions[i];
                if (control.IsDisposed) continue;
                x -= control.Width + 6;
                control.Location = new Point(Math.Max(0, x), Math.Max(8, (Height - control.Height) / 2));
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            int right = Width;
            foreach (Control control in _actions)
            {
                if (!control.IsDisposed) right = Math.Min(right, control.Left - 10);
            }
            TextRenderer.DrawText(e.Graphics, Title, Ui.Font(19f, FontStyle.Bold),
                new Rectangle(2, 8, Math.Max(60, right - 2), 28), Ui.Ink,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(e.Graphics, Subtitle, Ui.Font(11f),
                new Rectangle(3, 36, Math.Max(60, right - 3), 18), Ui.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }
}
