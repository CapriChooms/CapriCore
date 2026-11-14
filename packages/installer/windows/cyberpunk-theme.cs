// SPDX-License-Identifier: GPL-3.0-only
// Shared native presentation only. No installer decisions, persistence or input synthesis.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Capri.Setup.Cyberpunk {
    internal static class Ink {
        internal static readonly Color Canvas = Color.FromArgb(7, 19, 28);
        internal static readonly Color Surface = Color.FromArgb(11, 29, 41);
        internal static readonly Color Raised = Color.FromArgb(15, 38, 51);
        internal static readonly Color Line = Color.FromArgb(37, 75, 88);
        internal static readonly Color Text = Color.FromArgb(223, 239, 241);
        internal static readonly Color Muted = Color.FromArgb(142, 172, 186);
        internal static readonly Color Cyan = Color.FromArgb(109, 247, 242);
        internal static readonly Color Red = Color.FromArgb(255, 69, 108);
        internal static readonly Color Yellow = Color.FromArgb(255, 196, 94);
        internal static readonly Color Disabled = Color.FromArgb(87, 115, 130);
        // The existing wizard explicitly scales pixel fonts and control bounds.
        // Graphics.DpiX can remain 96 in its synthetic-DPI verification mode.
        internal static float LayoutScale = 1f;
        internal static float Scale(Graphics g) { return LayoutScale; }
        internal static GraphicsPath Cut(RectangleF r, float cut) {
            GraphicsPath path = new GraphicsPath();
            cut = Math.Min(cut, Math.Min(r.Width, r.Height) / 3f);
            path.AddPolygon(new PointF[] {
                new PointF(r.Left + cut, r.Top), new PointF(r.Right, r.Top),
                new PointF(r.Right, r.Bottom - cut), new PointF(r.Right - cut, r.Bottom),
                new PointF(r.Left, r.Bottom), new PointF(r.Left, r.Top + cut)
            });
            path.CloseFigure(); return path;
        }
        internal static TextFormatFlags Flags(Control c, bool wrap) {
            TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter;
            flags |= wrap ? TextFormatFlags.WordBreak : TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            if (c.RightToLeft == RightToLeft.Yes) flags |= TextFormatFlags.RightToLeft | TextFormatFlags.Right;
            if (!c.ShowFocusCuesForPreview()) flags |= TextFormatFlags.HidePrefix;
            return flags;
        }
        // Keyboard cues are retained through native focus/UI-state handling.
        internal static bool ShowFocusCuesForPreview(this Control c) { return (Control.ModifierKeys & Keys.Alt) != 0 || c.Focused; }
    }

    public class Button : System.Windows.Forms.Button {
        public string PreviewRole { get; set; }
        private bool hover, pressed;
        public Button() {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0;
            BackColor = Ink.Surface; ForeColor = Ink.Text;
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) pressed = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space) { pressed = true; Invalidate(); } base.OnKeyDown(e); }
        protected override void OnKeyUp(KeyEventArgs e) { pressed = false; Invalidate(); base.OnKeyUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { pressed = false; Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { pressed = false; Invalidate(); base.OnLostFocus(e); }
        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            g.Clear(Parent == null ? Ink.Canvas : Parent.BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            bool info = Name != null && Name.StartsWith("info-", StringComparison.Ordinal);
            Color accent = PreviewRole == "danger" ? Ink.Red : Ink.Cyan;
            if (info) {
                float size = Math.Max(2, Math.Min(Width, Height) - 8 * s);
                RectangleF ring = new RectangleF((Width - size) / 2f, (Height - size) / 2f, size, size);
                using (Brush brush = new SolidBrush(hover || Focused ? Ink.Raised : BackColor)) g.FillEllipse(brush, ring);
                using (Pen pen = new Pen(Enabled ? (hover || Focused ? Ink.Cyan : Ink.Muted) : Ink.Disabled, s)) g.DrawEllipse(pen, ring);
                TextRenderer.DrawText(g, "i", Font, Rectangle.Round(ring), Enabled ? Ink.Muted : Ink.Disabled,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
                return;
            }
            bool primary = PreviewRole == "primary";
            Color fill = primary ? (Enabled ? (pressed ? Color.FromArgb(75, 199, 198) : Ink.Cyan) : Ink.Raised) : (hover && Enabled ? Ink.Raised : Ink.Surface);
            RectangleF bounds = new RectangleF(s / 2f, s / 2f, Math.Max(1, Width - s), Math.Max(1, Height - s));
            using (GraphicsPath path = Ink.Cut(bounds, 7 * s))
            using (Brush brush = new SolidBrush(fill))
            using (Pen pen = new Pen(Enabled ? (hover || Focused || primary ? accent : Ink.Line) : Ink.Line, s)) {
                g.FillPath(brush, path); g.DrawPath(pen, path);
            }
            if (Focused && Enabled) {
                RectangleF focus = bounds; focus.Inflate(-3 * s, -3 * s);
                using (GraphicsPath path = Ink.Cut(focus, 5 * s))
                using (Pen pen = new Pen(primary ? Ink.Canvas : Ink.Cyan, s)) { pen.DashStyle = DashStyle.Dot; g.DrawPath(pen, path); }
            }
            Rectangle text = ClientRectangle; text.Inflate(-(int)(9 * s), -(int)(2 * s));
            TextFormatFlags flags = Ink.Flags(this, false) | TextFormatFlags.HorizontalCenter;
            Color textColor = Enabled ? (primary ? Ink.Canvas : Ink.Text) : Ink.Disabled;
            if (primary) {
                using (Font emphasis = new Font("Segoe UI Semibold", Font.Size, Font.Style, Font.Unit)) {
                    Font selected = TextRenderer.MeasureText(g, Text, emphasis, text.Size, flags).Width <= text.Width ? emphasis : Font;
                    TextRenderer.DrawText(g, Text, selected, text, textColor, flags);
                }
            } else TextRenderer.DrawText(g, Text, Font, text, textColor, flags);
        }
    }

    internal static class ChoicePaint {
        internal static void Draw(Control control, PaintEventArgs e, bool check, CheckState state, bool hover) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            g.Clear(control.Parent == null ? Ink.Canvas : control.Parent.BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float size = Math.Max(13 * s, Math.Min(17 * s, control.Font.Height));
            bool rtl = control.RightToLeft == RightToLeft.Yes;
            RectangleF box = new RectangleF(rtl ? control.Width - size - 2 * s : 2 * s, (control.Height - size) / 2f, size, size);
            bool selected = state != CheckState.Unchecked;
            Color edge = control.Enabled ? (selected || hover || control.Focused ? Ink.Cyan : Ink.Muted) : Ink.Disabled;
            using (Brush brush = new SolidBrush(selected && control.Enabled ? Ink.Cyan : Ink.Surface))
            using (Pen pen = new Pen(edge, s)) {
                if (check) { g.FillRectangle(brush, box); g.DrawRectangle(pen, box.X, box.Y, box.Width, box.Height); }
                else { g.FillEllipse(brush, box); g.DrawEllipse(pen, box); }
            }
            if (selected) {
                Color mark = control.Enabled ? Ink.Canvas : Ink.Disabled;
                if (!check) {
                    RectangleF dot = box; dot.Inflate(-5 * s, -5 * s);
                    using (Brush brush = new SolidBrush(mark)) g.FillEllipse(brush, dot);
                } else using (Pen pen = new Pen(mark, 1.8f * s)) {
                    if (state == CheckState.Indeterminate) g.DrawLine(pen, box.X + 4 * s, box.Y + box.Height / 2, box.Right - 4 * s, box.Y + box.Height / 2);
                    else g.DrawLines(pen, new PointF[] { new PointF(box.X + 3 * s, box.Y + size * .5f), new PointF(box.X + size * .43f, box.Bottom - 3 * s), new PointF(box.Right - 3 * s, box.Y + 3 * s) });
                }
            }
            int inset = (int)Math.Ceiling(size + 12 * s);
            Rectangle text = new Rectangle(rtl ? 0 : inset, 0, Math.Max(0, control.Width - inset), control.Height);
            TextRenderer.DrawText(g, control.Text, control.Font, text, control.Enabled ? Ink.Text : Ink.Disabled, Ink.Flags(control, true));
            if (control.Focused) ControlPaint.DrawFocusRectangle(g, text, Ink.Cyan, control.BackColor);
        }
    }
    public class CheckBox : System.Windows.Forms.CheckBox {
        private bool hover;
        public CheckBox() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); BackColor = Ink.Canvas; ForeColor = Ink.Text; }
        protected override void OnPaint(PaintEventArgs e) { ChoicePaint.Draw(this, e, true, CheckState, hover); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnCheckStateChanged(EventArgs e) { Invalidate(); base.OnCheckStateChanged(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    }
    public class RadioButton : System.Windows.Forms.RadioButton {
        private bool hover;
        public RadioButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); BackColor = Ink.Canvas; ForeColor = Ink.Text; }
        protected override void OnPaint(PaintEventArgs e) { ChoicePaint.Draw(this, e, false, Checked ? CheckState.Checked : CheckState.Unchecked, hover); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    }

    public class ComboBox : System.Windows.Forms.ComboBox {
        private const int MouseWheelMessage = 0x020A;
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        public ComboBox() {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.UserPaint, DropDownStyle == ComboBoxStyle.DropDownList);
            DrawMode = DrawMode.OwnerDrawFixed; FlatStyle = FlatStyle.Flat;
            BackColor = Ink.Surface; ForeColor = Ink.Text;
            FontChanged += delegate { UpdateItemHeight(); };
        }
        private void UpdateItemHeight() { ItemHeight = Math.Max(18, Font.Height + 5); }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); UpdateItemHeight(); }
        protected override void OnDropDownStyleChanged(EventArgs e) { SetStyle(ControlStyles.UserPaint, DropDownStyle == ComboBoxStyle.DropDownList); Invalidate(); base.OnDropDownStyleChanged(e); }
        protected override void OnSelectedIndexChanged(EventArgs e) { Invalidate(); base.OnSelectedIndexChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnPaint(PaintEventArgs e) { if (DropDownStyle == ComboBoxStyle.DropDownList) PaintSelection(e.Graphics); base.OnPaint(e); }
        protected override void WndProc(ref Message message) {
            if (message.Msg == MouseWheelMessage && DropDownStyle == ComboBoxStyle.DropDownList) {
                // Native WinForms combos change selection on a wheel message even
                // while closed. Scroll the page if the message reaches the picker.
                for (Control ancestor = Parent; ancestor != null; ancestor = ancestor.Parent) {
                    Panel panel = ancestor as Panel;
                    if (panel == null || !panel.AutoScroll || !panel.IsHandleCreated) continue;
                    SendMessage(panel.Handle, message.Msg, message.WParam, message.LParam);
                    break;
                }
                message.Result = IntPtr.Zero;
                return;
            }
            // Render the same live selection for native accessibility/print
            // captures. Native dropdown and keyboard messages remain untouched.
            if (message.Msg == 0x0318 && message.WParam != IntPtr.Zero && DropDownStyle == ComboBoxStyle.DropDownList) {
                using (Graphics graphics = Graphics.FromHdc(message.WParam)) PaintSelection(graphics);
                return;
            }
            base.WndProc(ref message);
        }
        private void PaintSelection(Graphics g) {
            float s = Ink.Scale(g);
            g.Clear(Ink.Surface);
            bool rtl = RightToLeft == RightToLeft.Yes;
            float width = Math.Max(24 * s, Height);
            RectangleF arrow = new RectangleF(rtl ? 0 : Width - width, 0, width, Height);
            using (Brush fill = new SolidBrush(Enabled && (Focused || DroppedDown) ? Ink.Raised : Ink.Surface)) g.FillRectangle(fill, arrow);
            using (Pen border = new Pen(Enabled && Focused ? Ink.Cyan : Ink.Line, s)) g.DrawRectangle(border, s / 2, s / 2, Math.Max(1, Width - s), Math.Max(1, Height - s));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float x = arrow.X + arrow.Width / 2, y = Height / 2f;
            using (Pen pen = new Pen(Enabled ? Ink.Cyan : Ink.Disabled, 1.5f * s)) g.DrawLines(pen, new PointF[] { new PointF(x - 4 * s, y - 2 * s), new PointF(x, y + 2 * s), new PointF(x + 4 * s, y - 2 * s) });
            Rectangle text = new Rectangle((int)(rtl ? width + 8 * s : 8 * s), 0, Math.Max(0, Width - (int)(width + 16 * s)), Height);
            string selected = SelectedIndex >= 0 && SelectedIndex < Items.Count ? GetItemText(SelectedItem) : Text;
            TextRenderer.DrawText(g, selected, Font, text, Enabled ? Ink.Text : Ink.Disabled, Ink.Flags(this, false));
        }
        protected override void OnDrawItem(DrawItemEventArgs e) {
            bool selected = (e.State & DrawItemState.Selected) != 0;
            Color fill = selected ? Ink.Raised : Ink.Surface;
            using (Brush brush = new SolidBrush(fill)) e.Graphics.FillRectangle(brush, e.Bounds);
            string text = e.Index >= 0 && e.Index < Items.Count ? GetItemText(Items[e.Index]) : Text;
            Rectangle bounds = e.Bounds; int inset = Math.Max(4, (int)(6 * Ink.Scale(e.Graphics)));
            bounds.Inflate(-inset, 0);
            TextRenderer.DrawText(e.Graphics, text, Font, bounds, Enabled ? (selected ? Ink.Cyan : Ink.Text) : Ink.Disabled, Ink.Flags(this, false));
            if ((e.State & DrawItemState.Focus) != 0) ControlPaint.DrawFocusRectangle(e.Graphics, bounds, Ink.Cyan, fill);
            base.OnDrawItem(e);
        }
    }

    public class ProgressBar : System.Windows.Forms.ProgressBar {
        private Bitmap marker;

        public ProgressBar() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); BackColor = Ink.Surface; ForeColor = Ink.Cyan; }
        public void SetMarker(string file, Rectangle source) {
            using (Bitmap image = new Bitmap(file)) {
                Bitmap cropped = image.Clone(source, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                if (marker != null) marker.Dispose();
                marker = cropped;
            }
            Invalidate();
        }
        protected override void Dispose(bool disposing) {
            if (disposing && marker != null) {
                marker.Dispose();
                marker = null;
            }
            base.Dispose(disposing);
        }
        protected override void WndProc(ref Message message) {
            int id = message.Msg;
            base.WndProc(ref message);
            if (id == 0x0402 || id == 0x0406 || id == 0x040A || id == 0x0401 || (id == 0x0113 && Style == ProgressBarStyle.Marquee)) Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            g.Clear(Parent == null ? Ink.Canvas : Parent.BackColor);
            Rectangle trackBounds = ClientRectangle;
            if (marker != null) {
                int inset = Math.Max(0, Height - (int)Math.Round(18 * s));
                trackBounds.Y += inset;
                trackBounds.Height -= inset;
            }
            RectangleF bounds = new RectangleF(s / 2, trackBounds.Top + s / 2, Math.Max(1, Width - s), Math.Max(1, trackBounds.Height - s));
            using (GraphicsPath outline = Ink.Cut(bounds, 5 * s))
            using (Brush track = new SolidBrush(Ink.Surface))
            using (Pen border = new Pen(Ink.Line, s)) {
                g.FillPath(track, outline); g.DrawPath(border, outline);
            }
            Rectangle inner = trackBounds; inner.Inflate(-(int)(3 * s), -(int)(3 * s));
            if (inner.Width <= 0 || inner.Height <= 0) return;
            if (Style == ProgressBarStyle.Marquee) {
                // Repaint from the original native marquee's WM_TIMER. No added
                // animation timer or changes to its running/stopped state.
                using (HatchBrush activity = new HatchBrush(HatchStyle.ForwardDiagonal, Color.FromArgb(35, Ink.Cyan), Ink.Raised)) g.FillRectangle(activity, inner);
                if (MarqueeAnimationSpeed > 0) {
                    float phase = ((uint)Environment.TickCount % 1600) / 1600f;
                    float band = Math.Max(24 * s, inner.Width * .25f);
                    float position = phase * (inner.Width + band) - band;
                    if (RightToLeft == RightToLeft.Yes) position = inner.Width - position - band;
                    GraphicsState saved = g.Save(); g.SetClip(inner);
                    RectangleF moving = new RectangleF(inner.Left + position, inner.Top, band, inner.Height);
                    using (LinearGradientBrush glow = new LinearGradientBrush(moving, Color.FromArgb(40, Ink.Cyan), Ink.Cyan, LinearGradientMode.Horizontal)) g.FillRectangle(glow, moving);
                    g.Restore(saved);
                }
            } else {
                double fraction = Maximum > Minimum ? (Value - Minimum) / (double)(Maximum - Minimum) : 0;
                int width = (int)Math.Round(inner.Width * Math.Max(0, Math.Min(1, fraction)));
                if (width > 0) {
                    Rectangle fill = new Rectangle(RightToLeft == RightToLeft.Yes ? inner.Right - width : inner.Left, inner.Top, width, inner.Height);
                    using (LinearGradientBrush brush = new LinearGradientBrush(inner, Color.FromArgb(35, 128, 145), Ink.Cyan, LinearGradientMode.Horizontal)) g.FillRectangle(brush, fill);
                }
                if (marker != null && trackBounds.Top > 0) {
                    float markerWidth = Math.Min(224 * s, Math.Min(inner.Width,
                        (trackBounds.Top + 2 * s) * marker.Width / marker.Height));
                    float markerHeight = markerWidth * marker.Height / marker.Width;
                    float edge = RightToLeft == RightToLeft.Yes ? inner.Right - width : inner.Left + width;
                    float left = Math.Max(inner.Left, Math.Min(inner.Right - markerWidth, edge - markerWidth / 2));
                    RectangleF position = new RectangleF(left, trackBounds.Top - markerHeight + 2 * s, markerWidth, markerHeight);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(marker, position, new RectangleF(0, 0, marker.Width, marker.Height), GraphicsUnit.Pixel);
                }
            }
        }
    }

    public class Panel : System.Windows.Forms.Panel {
        public string PreviewRole { get; set; }
        public bool PreviewWelcome { get; set; }
        public Panel() { DoubleBuffered = true; SetStyle(ControlStyles.ResizeRedraw, true); BackColor = Ink.Canvas; }
        public void CloseDropDowns() {
            foreach (Control child in Controls) {
                ComboBox combo = child as ComboBox;
                if (combo != null && combo.DroppedDown) combo.DroppedDown = false;
            }
        }
        protected override void WndProc(ref Message message) {
            // The dropdown has its own native window. Close it before moving
            // the scrolling page so it cannot be left at the old coordinates.
            if (AutoScroll && (message.Msg == 0x020A || message.Msg == 0x0115 || message.Msg == 0x0114))
                CloseDropDowns();
            base.WndProc(ref message);
        }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            if (PreviewRole == "sidebar") {
                using (Pen line = new Pen(Ink.Line, s)) {
                    g.DrawLine(line, Width - s, 0, Width - s, Height);
                    g.DrawLine(line, 24 * s, 111 * s, Width - 24 * s, 111 * s);
                }
                using (Brush accent = new SolidBrush(Ink.Cyan)) g.FillRectangle(accent, 24 * s, 110 * s, 30 * s, 2 * s);
                using (Pen red = new Pen(Ink.Red, 2 * s)) g.DrawLines(red, new PointF[] { new PointF(Width - 29 * s, 13 * s), new PointF(Width - 13 * s, 13 * s), new PointF(Width - 13 * s, 29 * s) });
                int lastStepBottom = 0;
                foreach (Control child in Controls) {
                    Label step = child as Label;
                    if (step != null && step.PreviewStep) lastStepBottom = Math.Max(lastStepBottom, step.Bottom);
                }
                if (Height - 61 * s > lastStepBottom + 12 * s) {
                    using (Pen line = new Pen(Ink.Line, s)) g.DrawLine(line, 24 * s, Height - 61 * s, Width - 24 * s, Height - 61 * s);
                    if (Theme.DesignPreview) {
                        using (Font font = new Font("Segoe UI", 10f * s, FontStyle.Bold, GraphicsUnit.Pixel))
                            TextRenderer.DrawText(g, "DESIGN PREVIEW", font, new Rectangle((int)(24 * s), Height - (int)(49 * s), Width - (int)(48 * s), (int)(26 * s)), Ink.Muted, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
                    }
                }
            } else if (PreviewRole == "footer" || PreviewRole == "budget") {
                using (Pen line = new Pen(Ink.Line, s)) g.DrawLine(line, 0, 0, Width, 0);
                using (Pen accent = new Pen(PreviewRole == "footer" ? Ink.Red : Ink.Cyan, s)) g.DrawLine(accent, 28 * s, 0, 75 * s, 0);
            } else if (PreviewRole == "body" && PreviewWelcome && Height > 400 * s) {
                float x = Math.Max(28 * s, Width - 318 * s), y = Math.Max(260 * s, Height - 188 * s);
                RectangleF frame = new RectangleF(x, y, 270 * s, 126 * s);
                using (Pen grid = new Pen(Color.FromArgb(23, Ink.Cyan), s)) {
                    for (int i = 1; i < 9; i++) g.DrawLine(grid, x + i * 30 * s, y, x + i * 30 * s, frame.Bottom);
                    for (int i = 1; i < 5; i++) g.DrawLine(grid, x, y + i * 25 * s, frame.Right, y + i * 25 * s);
                }
                using (GraphicsPath path = Ink.Cut(frame, 22 * s))
                using (Pen outline = new Pen(Color.FromArgb(80, Ink.Cyan), s)) g.DrawPath(outline, path);
                using (Pen red = new Pen(Ink.Red, 3 * s)) g.DrawLines(red, new PointF[] {
                    new PointF(x + 113 * s, y + 31 * s), new PointF(x + 84 * s, y + 31 * s),
                    new PointF(x + 61 * s, y + 54 * s), new PointF(x + 61 * s, y + 85 * s),
                    new PointF(x + 113 * s, y + 85 * s)
                });
                using (Pen cyan = new Pen(Color.FromArgb(150, Ink.Cyan), s)) {
                    g.DrawLines(cyan, new PointF[] { new PointF(x + 123 * s, y + 58 * s), new PointF(x + 159 * s, y + 58 * s), new PointF(x + 175 * s, y + 42 * s), new PointF(frame.Right - 17 * s, y + 42 * s) });
                    g.DrawLines(cyan, new PointF[] { new PointF(x + 136 * s, y + 81 * s), new PointF(x + 186 * s, y + 81 * s), new PointF(x + 197 * s, y + 92 * s), new PointF(frame.Right - 17 * s, y + 92 * s) });
                }
                using (Brush red = new SolidBrush(Ink.Red)) g.FillRectangle(red, frame.Right - 33 * s, frame.Top - s, 18 * s, 2 * s);
            }
        }
    }
    public class Label : System.Windows.Forms.Label {
        public bool PreviewStep { get; set; }
        public Label() { DoubleBuffered = true; ForeColor = Ink.Text; BackColor = Color.Transparent; }
        protected override void OnPaint(PaintEventArgs e) {
            if (PreviewStep) {
                float s = Ink.Scale(e.Graphics);
                if (ForeColor.ToArgb() == Ink.Cyan.ToArgb()) {
                    using (Brush brush = new SolidBrush(Ink.Raised)) e.Graphics.FillRectangle(brush, ClientRectangle);
                    using (Pen pen = new Pen(Ink.Cyan, 2 * s)) e.Graphics.DrawLine(pen, s, 4 * s, s, Height - 4 * s);
                }
                Rectangle text = new Rectangle(Padding.Left, Padding.Top, Math.Max(0, Width - Padding.Horizontal), Math.Max(0, Height - Padding.Vertical));
                TextRenderer.DrawText(e.Graphics, Text, Font, text, ForeColor, Ink.Flags(this, true));
                return;
            }
            base.OnPaint(e);
        }
    }
    public sealed class BlockingWarning : Label {
        public BlockingWarning() {
            AccessibleRole = AccessibleRole.Alert;
            UseMnemonic = false;
        }
        protected override void OnPaintBackground(PaintEventArgs e) {
            base.OnPaintBackground(e);
            float s = Ink.Scale(e.Graphics);
            var bounds = new RectangleF(s, s, Width - 2 * s, Height - 2 * s);
            if (bounds.Width <= 0 || bounds.Height <= 0) return;
            using (GraphicsPath frame = Ink.Cut(bounds, 8 * s))
            using (Brush fill = new SolidBrush(Color.FromArgb(58, 23, 36)))
            using (Pen border = new Pen(Ink.Red, s)) {
                e.Graphics.FillPath(fill, frame);
                e.Graphics.DrawPath(border, frame);
            }
            float x = RightToLeft == RightToLeft.Yes ? Width - 4 * s : s;
            using (Brush accent = new SolidBrush(Ink.Red))
                e.Graphics.FillRectangle(accent, x, 9 * s, 3 * s, Math.Max(0, Height - 18 * s));
        }
    }
    public class TextBox : System.Windows.Forms.TextBox {
        public TextBox() { BackColor = Ink.Surface; ForeColor = Ink.Text; BorderStyle = BorderStyle.FixedSingle; }
    }

    public static class Theme {
        internal static bool DesignPreview { get; private set; }
        private static readonly ConditionalWeakTable<Control, Tracking> States = new ConditionalWeakTable<Control, Tracking>();
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int length);
        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] private static extern int SetWindowTheme(IntPtr window, string subAppName, string subIdList);
        private sealed class Tracking : IDisposable {
            internal Control Control;
            internal bool Updating;
            internal Tracking(Control control) {
                Control = control;
                control.ControlAdded += Added;
                control.HandleCreated += Created;
                control.ForeColorChanged += Changed;
                control.BackColorChanged += Changed;
                control.Disposed += Disposed;
            }
            private void Added(object sender, ControlEventArgs e) { Track(e.Control); }
            private void Created(object sender, EventArgs e) { DarkNativeControl(Control); }
            private void Changed(object sender, EventArgs e) { Apply(Control); }
            private void Disposed(object sender, EventArgs e) { Dispose(); }
            public void Dispose() {
                Control control = Control; if (control == null) return;
                control.ControlAdded -= Added; control.HandleCreated -= Created; control.ForeColorChanged -= Changed;
                control.BackColorChanged -= Changed; control.Disposed -= Disposed;
                States.Remove(control); Control = null;
            }
        }
        private static bool Same(Color a, int r, int g, int b) { return a.R == r && a.G == g && a.B == b; }
        private static Color Foreground(Color color) {
            if (color.ToArgb() == Ink.Cyan.ToArgb() || color.ToArgb() == Ink.Red.ToArgb() || color.ToArgb() == Ink.Yellow.ToArgb() || color.ToArgb() == Ink.Text.ToArgb() || color.ToArgb() == Ink.Muted.ToArgb() || color.ToArgb() == Ink.Disabled.ToArgb()) return color;
            if (Same(color, 67, 225, 225) || Same(color, 0, 89, 103) || Same(color, 0, 108, 119)) return Ink.Cyan;
            if (Same(color, 155, 57, 20) || Same(color, 188, 80, 38)) return Ink.Yellow;
            if (Same(color, 155, 171, 190) || Same(color, 154, 173, 190) || Same(color, 45, 69, 77)) return Ink.Muted;
            if (color.R > 150 && color.R > color.G * 1.6 && color.R > color.B * 1.2) return Ink.Red;
            return Ink.Text;
        }
        private static void Track(Control control) {
            if (control == null || control.IsDisposed) return;
            Tracking state;
            if (!States.TryGetValue(control, out state)) {
                States.Add(control, new Tracking(control));
                DarkNativeControl(control);
            }
            Apply(control);
            foreach (Control child in control.Controls) Track(child);
        }
        private static void Apply(Control control) {
            Tracking state;
            if (control == null || control.IsDisposed || !States.TryGetValue(control, out state) || state.Updating) return;
            state.Updating = true;
            try {
                Panel panel = control as Panel;
                if (control is System.Windows.Forms.Form) control.BackColor = Ink.Canvas;
                else if (panel != null) {
                    if (panel.PreviewRole == "sidebar" || panel.PreviewRole == "budget" || Same(panel.BackColor, 231, 241, 243)) panel.BackColor = Ink.Surface;
                    else panel.BackColor = Ink.Canvas;
                } else if (control is System.Windows.Forms.TextBox || control is System.Windows.Forms.ComboBox || control is System.Windows.Forms.Button || control is System.Windows.Forms.ProgressBar) control.BackColor = Ink.Surface;
                else if (!(control is System.Windows.Forms.Label)) control.BackColor = control.Parent == null ? Ink.Canvas : control.Parent.BackColor;
                control.ForeColor = Foreground(control.ForeColor);
                control.Invalidate();
            } finally { state.Updating = false; }
        }
        private static void DarkNativeControl(Control control) {
            if (control == null || !control.IsHandleCreated || control.IsDisposed) return;
            if (!(control is System.Windows.Forms.Panel) && !(control is System.Windows.Forms.TextBox) && !(control is System.Windows.Forms.ComboBox)) return;
            // Per-window theme request only. The class is OS-dependent; failure
            // leaves ordinary native scrolling/input intact. No global ordinals.
            try { SetWindowTheme(control.Handle, "DarkMode_Explorer", null); }
            catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
        }
        public static void Attach(Form form, Control sidebar, Control body, Control footer, System.Windows.Forms.Label brand, System.Windows.Forms.Label releaseLabel, System.Windows.Forms.Label[] steps, System.Windows.Forms.Button back, System.Windows.Forms.Button next, System.Windows.Forms.Button cancel, System.Windows.Forms.Button pause, bool designPreview) {
            DesignPreview = designPreview;
            UpdateScale(form, EventArgs.Empty);
            Panel side = sidebar as Panel; if (side != null) side.PreviewRole = "sidebar";
            Panel page = body as Panel; if (page != null) page.PreviewRole = "body";
            Panel foot = footer as Panel; if (foot != null) foot.PreviewRole = "footer";
            Button primary = next as Button; if (primary != null) primary.PreviewRole = "primary";
            Button danger = cancel as Button; if (danger != null) danger.PreviewRole = "danger";
            foreach (System.Windows.Forms.Label step in steps) { Label label = step as Label; if (label != null) { label.PreviewStep = true; label.Padding = new Padding((int)Math.Round(8 * step.Font.SizeInPoints / 9f), 0, 0, 0); } }
            Track(form); brand.ForeColor = Ink.Cyan; releaseLabel.ForeColor = Ink.Muted;
            foreach (Control item in form.Controls) { Panel budget = item as Panel; if (budget != null && item != sidebar && item != body && item != footer) { budget.PreviewRole = "budget"; Apply(budget); } }
            form.HandleCreated += DarkCaption;
            form.FontChanged += UpdateScale;
            form.Disposed += UnhookCaption;
            if (form.IsHandleCreated) DarkCaption(form, EventArgs.Empty);
        }
        private static void UnhookCaption(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null) return;
            form.HandleCreated -= DarkCaption; form.FontChanged -= UpdateScale; form.Disposed -= UnhookCaption;
        }
        private static void UpdateScale(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null) return;
            // Wizard fonts already contain the explicit DPI scale in pixels.
            // SizeInPoints would convert them again using the monitor's DPI.
            float scale = form.Font.Unit == GraphicsUnit.Pixel ? form.Font.Size / (10f * 96f / 72f) : form.Font.SizeInPoints / 10f;
            Ink.LayoutScale = Math.Max(.75f, Math.Min(4f, scale));
            form.Invalidate(true);
        }
        private static void DarkCaption(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null || !form.IsHandleCreated) return;
            try {
                int enabled = 1; if (DwmSetWindowAttribute(form.Handle, 20, ref enabled, 4) != 0) DwmSetWindowAttribute(form.Handle, 19, ref enabled, 4);
                int caption = ColorTranslator.ToWin32(Ink.Canvas), text = ColorTranslator.ToWin32(Ink.Text), border = ColorTranslator.ToWin32(Ink.Line);
                DwmSetWindowAttribute(form.Handle, 35, ref caption, 4);
                DwmSetWindowAttribute(form.Handle, 36, ref text, 4);
                DwmSetWindowAttribute(form.Handle, 34, ref border, 4);
            } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
        }
        public static void Refresh(Control form) {
            Track(form);
            foreach (Control child in form.Controls) {
                Panel page = child as Panel; if (page == null || page.PreviewRole != "body") continue;
                int choices = 0; bool welcome = true;
                foreach (Control item in page.Controls) {
                    if (item is System.Windows.Forms.ComboBox) choices++;
                    if (item is System.Windows.Forms.TextBox || item is System.Windows.Forms.CheckBox || item is System.Windows.Forms.RadioButton || item is System.Windows.Forms.ProgressBar) welcome = false;
                }
                page.PreviewWelcome = welcome && choices == 1; page.Invalidate();
            }
        }
    }
}
