// SPDX-License-Identifier: GPL-3.0-only
// Shared native presentation only. No installer decisions, persistence or input synthesis.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Capri.Setup.Cyberpunk {
    internal static class Ink {
        private const int ChangeUiStateMessage = 0x0127;
        private const int HideFocusCue = (1 << 16) | 1; // UISF_HIDEFOCUS | UIS_SET
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

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
        internal static TextFormatFlags Flags(Control c, bool wrap, bool keyboardCues = false) {
            TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter;
            flags |= wrap ? TextFormatFlags.WordBreak : TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            if (c.RightToLeft == RightToLeft.Yes) flags |= TextFormatFlags.RightToLeft | TextFormatFlags.Right;
            if (!keyboardCues) flags |= TextFormatFlags.HidePrefix;
            return flags;
        }
        internal static void HidePointerFocus(Control control) {
            // WinForms reveals focus on Tab but can keep that cue through a later mouse click.
            // Leave the Windows always-show-keyboard-cues setting in charge when enabled.
            if (SystemInformation.MenuAccessKeysUnderlined) return;
            Form form = control.FindForm();
            if (form != null && form.IsHandleCreated)
                SendMessage(form.Handle, ChangeUiStateMessage, new IntPtr(HideFocusCue), IntPtr.Zero);
        }
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
        protected override void OnMouseDown(MouseEventArgs e) {
            if (e.Button == MouseButtons.Left) {
                pressed = true;
                if (ShowFocusCues) Ink.HidePointerFocus(this);
            }
            Invalidate(); base.OnMouseDown(e);
        }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space) { pressed = true; Invalidate(); } base.OnKeyDown(e); }
        protected override void OnKeyUp(KeyEventArgs e) { pressed = false; Invalidate(); base.OnKeyUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { pressed = false; Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { pressed = false; Invalidate(); base.OnLostFocus(e); }
        protected override void OnChangeUICues(UICuesEventArgs e) { Invalidate(); base.OnChangeUICues(e); }
        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            g.Clear(Parent == null ? Ink.Canvas : Parent.BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            bool info = Name != null && Name.StartsWith("info-", StringComparison.Ordinal);
            bool keyboardFocus = Enabled && Focused && ShowFocusCues;
            Color accent = PreviewRole == "danger" ? Ink.Red : Ink.Cyan;
            if (info) {
                float size = Math.Max(2, Math.Min(Width, Height) - 8 * s);
                RectangleF ring = new RectangleF((Width - size) / 2f, (Height - size) / 2f, size, size);
                using (Brush brush = new SolidBrush(hover || keyboardFocus ? Ink.Raised : BackColor)) g.FillEllipse(brush, ring);
                using (Pen pen = new Pen(Enabled ? (hover || keyboardFocus ? Ink.Cyan : Ink.Muted) : Ink.Disabled, keyboardFocus ? 2 * s : s)) g.DrawEllipse(pen, ring);
                TextRenderer.DrawText(g, "i", Font, Rectangle.Round(ring), Enabled ? (keyboardFocus ? Ink.Cyan : Ink.Muted) : Ink.Disabled,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
                return;
            }
            bool primary = PreviewRole == "primary";
            Color fill = primary ? (Enabled ? (pressed ? Color.FromArgb(75, 199, 198) : Ink.Cyan) : Ink.Raised) : (hover && Enabled ? Ink.Raised : Ink.Surface);
            RectangleF bounds = new RectangleF(s / 2f, s / 2f, Math.Max(1, Width - s), Math.Max(1, Height - s));
            using (GraphicsPath path = Ink.Cut(bounds, 7 * s))
            using (Brush brush = new SolidBrush(fill))
            using (Pen pen = new Pen(Enabled ? (hover || keyboardFocus || primary ? accent : Ink.Line) : Ink.Line, s)) {
                g.FillPath(brush, path); g.DrawPath(pen, path);
            }
            if (keyboardFocus) {
                RectangleF focus = bounds; focus.Inflate(-3 * s, -3 * s);
                using (GraphicsPath path = Ink.Cut(focus, 5 * s))
                using (Pen pen = new Pen(primary ? Ink.Canvas : accent, 1.5f * s)) g.DrawPath(pen, path);
            }
            Rectangle text = ClientRectangle; text.Inflate(-(int)(9 * s), -(int)(2 * s));
            TextFormatFlags flags = Ink.Flags(this, false, ShowKeyboardCues) | TextFormatFlags.HorizontalCenter;
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
        internal static void Draw(Control control, PaintEventArgs e, bool check, CheckState state, bool hover, bool keyboardFocus, bool keyboardCues) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            g.Clear(control.Parent == null ? Ink.Canvas : control.Parent.BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float size = Math.Max(13 * s, Math.Min(17 * s, control.Font.Height));
            bool rtl = control.RightToLeft == RightToLeft.Yes;
            bool selected = state != CheckState.Unchecked;
            RadioButton answer = control as RadioButton;
            bool card = answer != null && answer.SurveyAnswer;
            float edgeInset = (card ? 11 : 2) * s;
            RectangleF box = new RectangleF(rtl ? control.Width - size - edgeInset : edgeInset, (control.Height - size) / 2f, size, size);
            if (card) {
                RectangleF bounds = new RectangleF(s / 2f, s / 2f, Math.Max(1, control.Width - s), Math.Max(1, control.Height - s));
                Color border = control.Enabled && (selected || hover || keyboardFocus) ? Ink.Cyan : Ink.Line;
                using (GraphicsPath outline = Ink.Cut(bounds, 7 * s))
                using (Brush fill = new SolidBrush(control.Enabled && (selected || hover) ? Ink.Raised : Ink.Surface))
                using (Pen stroke = new Pen(border, keyboardFocus ? 2 * s : s) { Alignment = PenAlignment.Inset }) {
                    g.FillPath(fill, outline);
                    g.DrawPath(stroke, outline);
                }
            }
            Color edge = control.Enabled ? (selected || hover || keyboardFocus ? Ink.Cyan : Ink.Muted) : Ink.Disabled;
            using (Brush brush = new SolidBrush(selected && control.Enabled ? Ink.Cyan : Ink.Surface))
            using (Pen pen = new Pen(edge, keyboardFocus && !card ? 2 * s : s)) {
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
            int inset = (int)Math.Ceiling(size + edgeInset + 10 * s);
            int opposite = card ? (int)Math.Ceiling(9 * s) : 0;
            Rectangle text = new Rectangle(rtl ? opposite : inset, 0, Math.Max(0, control.Width - inset - opposite), control.Height);
            Color textColor = control.Enabled ? (keyboardFocus ? Ink.Cyan : Ink.Text) : Ink.Disabled;
            TextRenderer.DrawText(g, control.Text, control.Font, text, textColor, Ink.Flags(control, true, keyboardCues));
        }
    }
    public class CheckBox : System.Windows.Forms.CheckBox {
        private bool hover;
        public CheckBox() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); BackColor = Ink.Canvas; ForeColor = Ink.Text; }
        protected override void OnPaint(PaintEventArgs e) { ChoicePaint.Draw(this, e, true, CheckState, hover, Enabled && Focused && ShowFocusCues, ShowKeyboardCues); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) {
            if (e.Button == MouseButtons.Left && ShowFocusCues) Ink.HidePointerFocus(this);
            base.OnMouseDown(e);
        }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnChangeUICues(UICuesEventArgs e) { Invalidate(); base.OnChangeUICues(e); }
        protected override void OnCheckStateChanged(EventArgs e) { Invalidate(); base.OnCheckStateChanged(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    }
    public class RadioButton : System.Windows.Forms.RadioButton {
        public bool SurveyAnswer { get; set; }
        private bool hover;
        public RadioButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true); BackColor = Ink.Canvas; ForeColor = Ink.Text; }
        protected override void OnPaint(PaintEventArgs e) { ChoicePaint.Draw(this, e, false, Checked ? CheckState.Checked : CheckState.Unchecked, hover, Enabled && Focused && ShowFocusCues, ShowKeyboardCues); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) {
            if (e.Button == MouseButtons.Left && ShowFocusCues) Ink.HidePointerFocus(this);
            base.OnMouseDown(e);
        }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnChangeUICues(UICuesEventArgs e) { Invalidate(); base.OnChangeUICues(e); }
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
        protected override void OnMouseDown(MouseEventArgs e) {
            if (e.Button == MouseButtons.Left && ShowFocusCues) Ink.HidePointerFocus(this);
            base.OnMouseDown(e);
        }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnChangeUICues(UICuesEventArgs e) { Invalidate(); base.OnChangeUICues(e); }
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
        internal void PaintSelection(Graphics g) {
            float s = Ink.Scale(g);
            g.Clear(Ink.Surface);
            bool rtl = RightToLeft == RightToLeft.Yes;
            float width = Math.Max(24 * s, Height);
            RectangleF arrow = new RectangleF(rtl ? 0 : Width - width, 0, width, Height);
            bool keyboardFocus = Enabled && Focused && ShowFocusCues;
            using (Brush fill = new SolidBrush(Enabled && (keyboardFocus || DroppedDown) ? Ink.Raised : Ink.Surface)) g.FillRectangle(fill, arrow);
            float stroke = keyboardFocus ? 2 * s : s;
            using (Pen border = new Pen(Enabled && (keyboardFocus || DroppedDown) ? Ink.Cyan : Ink.Line, stroke)) g.DrawRectangle(border, stroke / 2, stroke / 2, Math.Max(1, Width - stroke), Math.Max(1, Height - stroke));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float x = arrow.X + arrow.Width / 2, y = Height / 2f;
            using (Pen pen = new Pen(Enabled ? Ink.Cyan : Ink.Disabled, 1.5f * s)) g.DrawLines(pen, new PointF[] { new PointF(x - 4 * s, y - 2 * s), new PointF(x, y + 2 * s), new PointF(x + 4 * s, y - 2 * s) });
            Rectangle text = new Rectangle((int)(rtl ? width + 8 * s : 8 * s), 0, Math.Max(0, Width - (int)(width + 16 * s)), Height);
            string selected = SelectedIndex >= 0 && SelectedIndex < Items.Count ? GetItemText(SelectedItem) : Text;
            TextRenderer.DrawText(g, selected, Font, text, Enabled ? Ink.Text : Ink.Disabled, Ink.Flags(this, false, ShowKeyboardCues));
        }
        protected override void OnDrawItem(DrawItemEventArgs e) {
            bool selected = (e.State & DrawItemState.Selected) != 0;
            Color fill = selected ? Ink.Raised : Ink.Surface;
            using (Brush brush = new SolidBrush(fill)) e.Graphics.FillRectangle(brush, e.Bounds);
            string text = e.Index >= 0 && e.Index < Items.Count ? GetItemText(Items[e.Index]) : Text;
            Rectangle bounds = e.Bounds; int inset = Math.Max(4, (int)(6 * Ink.Scale(e.Graphics)));
            bounds.Inflate(-inset, 0);
            TextRenderer.DrawText(e.Graphics, text, Font, bounds, Enabled ? (selected ? Ink.Cyan : Ink.Text) : Ink.Disabled, Ink.Flags(this, false, ShowKeyboardCues));
            if (Enabled && ShowFocusCues && (e.State & (DrawItemState.Focus | DrawItemState.ComboBoxEdit)) == DrawItemState.Focus) {
                int edge = Math.Max(2, (int)(2 * Ink.Scale(e.Graphics)));
                int x = RightToLeft == RightToLeft.Yes ? e.Bounds.Right - edge : e.Bounds.Left;
                using (Brush brush = new SolidBrush(Ink.Cyan)) e.Graphics.FillRectangle(brush, x, e.Bounds.Top, edge, e.Bounds.Height);
            }
            base.OnDrawItem(e);
        }
    }

    public class ProgressBar : System.Windows.Forms.ProgressBar {
        private const int SweepDuration = 1700;
        private const uint SpiGetClientAreaAnimation = 0x1042;
        private static readonly Color FillStart = Color.FromArgb(38, 143, 159);
        private static readonly Color FillEnd = Color.FromArgb(88, 222, 222);
        private readonly Stopwatch sweepClock = new Stopwatch();
        private Bitmap marker;
        private Timer sweepTimer;
        private Form ownerForm;
        private bool animateProgress;
        private bool motionAllowed;
        private long checkMotionAfter;

        [DllImport("user32.dll")]
        private static extern bool SystemParametersInfo(uint action, uint parameter, out int value, uint flags);

        private static bool MotionAllowed() {
            int animations;
            return !SystemInformation.HighContrast &&
                SystemParametersInfo(SpiGetClientAreaAnimation, 0, out animations, 0) && animations != 0;
        }

        public bool AnimateProgress {
            get { return animateProgress; }
            set {
                animateProgress = value;
                UpdateSweep();
            }
        }

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
            if (disposing) {
                animateProgress = false;
                sweepClock.Reset();
                if (ownerForm != null) ownerForm.Resize -= OwnerResized;
                ownerForm = null;
                if (sweepTimer != null) {
                    sweepTimer.Dispose();
                    sweepTimer = null;
                }
                if (marker != null) {
                    marker.Dispose();
                    marker = null;
                }
            }
            base.Dispose(disposing);
        }
        protected override void OnParentChanged(EventArgs e) {
            base.OnParentChanged(e);
            Form form = FindForm();
            if (ownerForm == form) return;
            if (ownerForm != null) ownerForm.Resize -= OwnerResized;
            ownerForm = form;
            if (ownerForm != null) ownerForm.Resize += OwnerResized;
            UpdateSweep();
        }
        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); UpdateSweep(); }
        protected override void OnHandleDestroyed(EventArgs e) { StopSweep(); base.OnHandleDestroyed(e); }
        protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); UpdateSweep(); }
        private void OwnerResized(object sender, EventArgs e) { UpdateSweep(); }
        private Rectangle SweepBounds() {
            return Style == ProgressBarStyle.Marquee ? ClientRectangle : FillBounds(Ink.LayoutScale);
        }
        private void StopSweep() {
            if (!sweepClock.IsRunning) return;
            sweepClock.Reset();
            sweepTimer.Stop();
            Invalidate(SweepBounds());
        }
        private void UpdateSweep() {
            if (!animateProgress || !IsHandleCreated || !Visible || ownerForm == null ||
                ownerForm.WindowState == FormWindowState.Minimized ||
                (Style != ProgressBarStyle.Marquee && (Value <= Minimum || Value >= Maximum))) {
                StopSweep();
                return;
            }
            long now = Stopwatch.GetTimestamp();
            if (now >= checkMotionAfter) {
                motionAllowed = MotionAllowed();
                checkMotionAfter = now + Stopwatch.Frequency;
            }
            if (!motionAllowed) { StopSweep(); return; }
            if (sweepClock.IsRunning) return;
            if (sweepTimer == null) {
                sweepTimer = new Timer { Interval = 33 };
                sweepTimer.Tick += delegate { Invalidate(SweepBounds()); };
            }
            sweepClock.Restart();
            sweepTimer.Start();
        }
        protected override void WndProc(ref Message message) {
            int id = message.Msg;
            base.WndProc(ref message);
            if (id == 0x0402 || id == 0x0406 || id == 0x040A || id == 0x0401) {
                UpdateSweep();
                Invalidate();
            }
        }
        private Rectangle TrackBounds(float s) {
            Rectangle trackBounds = ClientRectangle;
            if (marker != null) {
                int inset = Math.Max(0, Height - (int)Math.Round(18 * s));
                trackBounds.Y += inset;
                trackBounds.Height -= inset;
            }
            return trackBounds;
        }
        private static Rectangle InnerBounds(Rectangle trackBounds, float s) {
            trackBounds.Inflate(-(int)(3 * s), -(int)(3 * s));
            return trackBounds;
        }
        private Rectangle FillBounds(float s) { return FillBounds(InnerBounds(TrackBounds(s), s)); }
        private Rectangle FillBounds(Rectangle inner) {
            if (inner.Width <= 0 || inner.Height <= 0 || Maximum <= Minimum) return Rectangle.Empty;
            double fraction = (Value - Minimum) / (double)(Maximum - Minimum);
            int width = (int)Math.Round(inner.Width * Math.Max(0, Math.Min(1, fraction)));
            return new Rectangle(RightToLeft == RightToLeft.Yes ? inner.Right - width : inner.Left, inner.Top, width, inner.Height);
        }
        private void PaintProgressFill(Graphics graphics, Rectangle fill, float scale) {
            bool rtl = RightToLeft == RightToLeft.Yes;
            if (SystemInformation.HighContrast) {
                graphics.FillRectangle(SystemBrushes.Highlight, fill);
                return;
            }
            using (LinearGradientBrush brush = new LinearGradientBrush(fill, rtl ? FillEnd : FillStart, rtl ? FillStart : FillEnd, LinearGradientMode.Horizontal))
                graphics.FillRectangle(brush, fill);
            if (!sweepClock.IsRunning) return;
            float band = Math.Min(fill.Width, Math.Max(20 * scale, fill.Width * .38f));
            float phase = (sweepClock.ElapsedMilliseconds % SweepDuration) / (float)SweepDuration;
            float offset = phase * (fill.Width + band) - band;
            if (rtl) offset = fill.Width - offset - band;
            RectangleF moving = new RectangleF(fill.Left + offset, fill.Top, band, fill.Height);
            RectangleF lit = RectangleF.Intersect(fill, moving);
            if (lit.Width <= 0) return;
            Color light = Color.FromArgb(210, 207, 255, 252);
            using (LinearGradientBrush glow = new LinearGradientBrush(moving, Color.FromArgb(0, light), light, LinearGradientMode.Horizontal)) {
                glow.SetSigmaBellShape(.5f);
                graphics.FillRectangle(glow, lit);
            }
        }
        private void PaintMarker(Graphics graphics, Rectangle track, Rectangle inner, float edge, float lift, float scale) {
            float width = Math.Min(224 * scale, Math.Min(inner.Width, (track.Top + 2 * scale) * marker.Width / marker.Height));
            float height = width * marker.Height / marker.Width;
            float left = Math.Max(inner.Left, Math.Min(inner.Right - width, edge - width / 2));
            RectangleF position = new RectangleF(left, track.Top - height + 2 * scale - lift, width, height);
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(marker, position, new RectangleF(0, 0, marker.Width, marker.Height), GraphicsUnit.Pixel);
        }
        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            using (Brush background = new SolidBrush(Parent == null ? Ink.Canvas : Parent.BackColor)) g.FillRectangle(background, e.ClipRectangle);
            Rectangle trackBounds = TrackBounds(s);
            RectangleF bounds = new RectangleF(s / 2, trackBounds.Top + s / 2, Math.Max(1, Width - s), Math.Max(1, trackBounds.Height - s));
            using (GraphicsPath outline = Ink.Cut(bounds, 5 * s))
            using (Brush track = new SolidBrush(Ink.Surface))
            using (Pen border = new Pen(Ink.Line, s)) {
                g.FillPath(track, outline); g.DrawPath(border, outline);
            }
            Rectangle inner = InnerBounds(trackBounds, s);
            if (inner.Width <= 0 || inner.Height <= 0) return;
            bool marquee = Style == ProgressBarStyle.Marquee;
            Rectangle fill = marquee ? Rectangle.Empty : FillBounds(inner);
            if (marquee) {
                using (HatchBrush activity = new HatchBrush(HatchStyle.ForwardDiagonal, Color.FromArgb(35, Ink.Cyan), Ink.Raised)) g.FillRectangle(activity, inner);
                if (sweepClock.IsRunning) {
                    float phase = (sweepClock.ElapsedMilliseconds % SweepDuration) / (float)SweepDuration;
                    float band = Math.Max(24 * s, inner.Width * .25f);
                    float position = phase * (inner.Width + band) - band;
                    if (RightToLeft == RightToLeft.Yes) position = inner.Width - position - band;
                    GraphicsState saved = g.Save(); g.SetClip(inner);
                    RectangleF moving = new RectangleF(inner.Left + position, inner.Top, band, inner.Height);
                    using (LinearGradientBrush glow = new LinearGradientBrush(moving, Color.FromArgb(32, FillEnd), Ink.Cyan, LinearGradientMode.Horizontal)) {
                        glow.SetSigmaBellShape(.54f);
                        g.FillRectangle(glow, moving);
                    }
                    g.Restore(saved);
                }
            } else {
                if (fill.Width > 0 && fill.IntersectsWith(e.ClipRectangle)) PaintProgressFill(g, fill, s);
            }
            if (marker != null && trackBounds.Top > 0 && e.ClipRectangle.Top < trackBounds.Top + 2 * s) {
                float edge = marquee ? inner.Left + inner.Width / 2f
                    : (RightToLeft == RightToLeft.Yes ? inner.Right - fill.Width : inner.Left + fill.Width);
                float lift = marquee && sweepClock.IsRunning
                    ? (float)((1 - Math.Cos((sweepClock.ElapsedMilliseconds % 3200) * (2 * Math.PI / 3200))) * 1.5 * s)
                    : 0;
                PaintMarker(g, trackBounds, inner, edge, lift, s);
            }
        }
    }

    public class Panel : System.Windows.Forms.Panel {
        public string PreviewRole { get; set; }
        public int SidebarDividerY { get; set; }
        public bool PreviewWelcome { get; set; }
        private Bitmap welcomeArt;
        private Label question;
        private Timer revealTimer;
        private readonly Stopwatch revealClock = new Stopwatch();
        private readonly List<Control> revealAnswers = new List<Control>();
        private Bitmap answerFrame;
        private bool capturingAnswerFrame;
        private int pageUpdateDepth;
        private IntPtr pageRedrawHandle;
        private Point questionHome;
        private Point questionCenter;
        private SizeF questionHaloSize;
        private float questionReveal = 1f;
        private const int TextFadeDuration = 235;
        private const int ReadingPauseDuration = 1000;
        private const int RiseStart = TextFadeDuration + ReadingPauseDuration;
        private const int RiseDuration = 270;
        private const int AnswersStart = RiseStart + RiseDuration - 40;
        private const int AnswersDuration = 255;
        public bool QuestionRevealActive { get { return revealClock.IsRunning; } }
        public float QuestionTextOpacity { get; private set; }
        public float QuestionBloom { get; private set; }
        public float AnswerRevealOpacity { get; private set; }
        public int AnswerRevealOffset { get; private set; }
        [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out int value, uint flags);
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);
        private const int SetRedrawMessage = 0x000B;
        private const uint RedrawPage = 0x0001 | 0x0004 | 0x0080 | 0x0400;
        public Panel() {
            DoubleBuffered = true;
            SetStyle(ControlStyles.ResizeRedraw, true);
            BackColor = Ink.Canvas;
            QuestionTextOpacity = AnswerRevealOpacity = 1f;
        }
        public void LoadWelcomeArt(string path) {
            if (welcomeArt != null || !System.IO.File.Exists(path)) return;
            try { using (Image source = Image.FromFile(path)) welcomeArt = new Bitmap(source); }
            catch (ArgumentException) { } catch (System.IO.IOException) { }
        }
        public void BeginPageUpdate() {
            if (pageUpdateDepth++ == 0 && IsHandleCreated && Visible) {
                // Native edit controls can repaint immediately while WinForms
                // removes the old page and lays out its replacement.
                pageRedrawHandle = Handle;
                SendMessage(pageRedrawHandle, SetRedrawMessage, IntPtr.Zero, IntPtr.Zero);
            }
        }
        public void EndPageUpdate() {
            if (--pageUpdateDepth != 0) return;
            if (pageRedrawHandle != IntPtr.Zero && IsHandleCreated && Handle == pageRedrawHandle) {
                SendMessage(Handle, SetRedrawMessage, new IntPtr(1), IntPtr.Zero);
                RedrawWindow(Handle, IntPtr.Zero, IntPtr.Zero, RedrawPage);
            }
            pageRedrawHandle = IntPtr.Zero;
        }
        public void SetQuestion(Label heading) {
            StopQuestionReveal(heading != null);
            if (question != null && !question.IsDisposed) question.QuestionTitle = false;
            question = heading;
            if (question != null) question.QuestionTitle = true;
            Invalidate();
        }
        public void RevealQuestion() {
            FinishQuestionReveal();
            int animations;
            if (question == null || !Visible || SystemInformation.HighContrast ||
                ClientSize.Width <= 0 || ClientSize.Height <= 0 ||
                !SystemParametersInfo(0x1042, 0, out animations, 0) || animations == 0) return;
            CloseDropDowns();
            try { answerFrame = CaptureAnswers(); }
            catch (ArgumentException) { revealAnswers.Clear(); return; }
            catch (ExternalException) { revealAnswers.Clear(); return; }
            questionHome = question.Location;
            questionCenter = new Point(Math.Max(0, (ClientSize.Width - question.Width) / 2),
                Math.Max(0, (ClientSize.Height - question.Height) / 2));
            float scale = Ink.LayoutScale;
            Size title = TextRenderer.MeasureText(question.Text, question.Font,
                new Size(question.Width, Int32.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            questionHaloSize = new SizeF(Math.Min(ClientSize.Width, title.Width + 100 * scale), title.Height + 80 * scale);
            if (revealTimer == null) {
                revealTimer = new Timer { Interval = 16 };
                revealTimer.Tick += RevealQuestionFrame;
            }
            // WinForms child windows paint opaquely. Fade a snapshot while the
            // real controls wait at their final positions with their state intact.
            SuspendLayout();
            foreach (Control child in revealAnswers) child.Hide();
            ResumeLayout(false);
            revealClock.Restart();
            RevealQuestionFrame(this, EventArgs.Empty);
            revealTimer.Start();
        }
        private Bitmap CaptureAnswers() {
            Rectangle viewport = ClientRectangle;
            Bitmap frame = new Bitmap(viewport.Width, viewport.Height, PixelFormat.Format32bppPArgb);
            capturingAnswerFrame = true;
            try {
                using (Graphics graphics = Graphics.FromImage(frame)) {
                    for (int i = Controls.Count - 1; i >= 0; i--) {
                        Control child = Controls[i];
                        if (child == question || !child.Visible) continue;
                        revealAnswers.Add(child);
                        if (child.Width <= 0 || child.Height <= 0 || !viewport.IntersectsWith(child.Bounds)) continue;
                        using (Bitmap answer = new Bitmap(child.Width, child.Height, PixelFormat.Format24bppRgb)) {
                            ComboBox combo = child as ComboBox;
                            if (combo != null && combo.DropDownStyle == ComboBoxStyle.DropDownList) {
                                using (Graphics selection = Graphics.FromImage(answer)) combo.PaintSelection(selection);
                            } else child.DrawToBitmap(answer, new Rectangle(Point.Empty, child.Size));
                            graphics.DrawImageUnscaled(answer, child.Left, child.Top);
                        }
                    }
                }
                return frame;
            } catch {
                frame.Dispose();
                throw;
            } finally { capturingAnswerFrame = false; }
        }
        private static float EaseReveal(double time) {
            float progress = (float)Math.Max(0, Math.Min(1, time));
            return progress * progress * (3 - 2 * progress);
        }
        private void RevealQuestionFrame(object sender, EventArgs e) {
            double elapsed = revealClock.Elapsed.TotalMilliseconds;
            if (!Visible || elapsed >= AnswersStart + AnswersDuration) { FinishQuestionReveal(); return; }
            if (elapsed < RiseStart && QuestionTextOpacity == 1f && QuestionBloom == 1f) return;
            float rise = EaseReveal((elapsed - RiseStart) / RiseDuration);
            question.Location = new Point(questionCenter.X + (int)Math.Round((questionHome.X - questionCenter.X) * rise),
                questionCenter.Y + (int)Math.Round((questionHome.Y - questionCenter.Y) * rise));
            QuestionTextOpacity = EaseReveal(elapsed / TextFadeDuration);
            QuestionBloom = EaseReveal(elapsed / 150) * (1 - rise);
            AnswerRevealOpacity = EaseReveal((elapsed - AnswersStart) / AnswersDuration);
            AnswerRevealOffset = (int)Math.Round((1 - AnswerRevealOpacity) * 52 * Ink.LayoutScale);
            questionReveal = rise;
            question.RevealText = QuestionTextOpacity;
            Invalidate();
        }
        public void FinishQuestionReveal() { StopQuestionReveal(true); }
        private void StopQuestionReveal(bool restoreAnswers) {
            if (!revealClock.IsRunning) return;
            revealTimer.Stop();
            revealClock.Reset();
            questionReveal = 1f;
            QuestionTextOpacity = AnswerRevealOpacity = 1f;
            QuestionBloom = 0f;
            AnswerRevealOffset = 0;
            if (answerFrame != null) { answerFrame.Dispose(); answerFrame = null; }
            SuspendLayout();
            if (question != null && !question.IsDisposed) {
                question.Location = questionHome;
                question.RevealText = 1f;
            }
            if (restoreAnswers) {
                foreach (Control child in revealAnswers) {
                    if (!child.IsDisposed && child.Parent == this) child.Show();
                }
            }
            revealAnswers.Clear();
            ResumeLayout(false);
            Invalidate();
        }
        protected override void Dispose(bool disposing) {
            if (disposing) {
                if (wheelTimer != null) { wheelTimer.Dispose(); wheelTimer = null; }
                if (revealTimer != null) { revealTimer.Dispose(); revealTimer = null; }
                if (answerFrame != null) { answerFrame.Dispose(); answerFrame = null; }
                if (welcomeArt != null) { welcomeArt.Dispose(); welcomeArt = null; }
            }
            base.Dispose(disposing);
        }
        private void PaintWelcomeArt(Graphics graphics, float scale, float opacity) {
            float top = 180 * scale;
            foreach (Control child in Controls)
                if (child is ComboBox) top = Math.Max(top, child.Bottom + 16 * scale);
            float size = Math.Min(342 * scale, Math.Min(Width - 56 * scale, Height - top - 20 * scale));
            if (size < 100 * scale) return;
            float x = (Width - size) / 2f, y = top + (Height - top - size) * .38f;
            RectangleF art = new RectangleF(x, y, size, size);
            using (GraphicsPath halo = new GraphicsPath()) {
                halo.AddEllipse(art);
                using (PathGradientBrush glow = new PathGradientBrush(halo)) {
                    glow.CenterColor = Color.FromArgb((int)(58 * opacity), Ink.Cyan);
                    glow.SurroundColors = new Color[] { Color.Transparent };
                    graphics.FillPath(glow, halo);
                }
            }
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            using (ImageAttributes fade = new ImageAttributes()) {
                fade.SetColorMatrix(new ColorMatrix { Matrix33 = opacity });
                graphics.DrawImage(welcomeArt, Rectangle.Round(art), 0, 0, welcomeArt.Width, welcomeArt.Height, GraphicsUnit.Pixel, fade);
            }
        }
        private void PaintQuestionHalo(Graphics graphics) {
            float strength = QuestionBloom * QuestionTextOpacity;
            if (strength <= 0f) return;
            float x = question.Left + (question.Width - questionHaloSize.Width) / 2f;
            float y = question.Top + (question.Height - questionHaloSize.Height) / 2f;
            using (GraphicsPath shape = new GraphicsPath()) {
                shape.AddEllipse(x, y, questionHaloSize.Width, questionHaloSize.Height);
                using (PathGradientBrush halo = new PathGradientBrush(shape)) {
                    halo.InterpolationColors = new ColorBlend {
                        Colors = new Color[] { Color.FromArgb(0, Ink.Cyan), Color.FromArgb((int)(7 * strength), Ink.Cyan),
                            Color.FromArgb((int)(29 * strength), Ink.Cyan), Color.FromArgb((int)(67 * strength), Ink.Cyan) },
                        Positions = new float[] { 0f, .28f, .64f, 1f }
                    };
                    graphics.FillPath(halo, shape);
                }
            }
        }
        public void CloseDropDowns() {
            foreach (Control child in Controls) {
                ComboBox combo = child as ComboBox;
                if (combo != null && combo.DroppedDown) combo.DroppedDown = false;
            }
        }
        private readonly Stopwatch wheelClock = new Stopwatch();
        private Timer wheelTimer;
        private double wheelTarget;
        private int wheelOrigin, wheelPosition, wheelDirection;

        public void CancelSmoothScroll() {
            if (wheelTimer != null) wheelTimer.Stop();
            wheelClock.Reset();
            wheelPosition = -AutoScrollPosition.Y;
            wheelTarget = wheelPosition;
            wheelDirection = 0;
        }
        private int MaximumWheelPosition() {
            return Math.Max(0, DisplayRectangle.Height - ClientSize.Height);
        }
        private void ApplyWheelPosition(double position) {
            Point current = AutoScrollPosition;
            AutoScrollPosition = new Point(-current.X, (int)Math.Round(position));
            wheelPosition = -AutoScrollPosition.Y;
        }
        private void SmoothWheel(int delta) {
            int lines = SystemInformation.MouseWheelScrollLines;
            if (delta == 0 || lines == 0 || !VerticalScroll.Visible) return;
            int current = -AutoScrollPosition.Y;
            int direction = Math.Sign(delta);
            // A reversal drops unused momentum. Small wheel deltas still accumulate
            // across frames, even when an individual delta is less than one pixel.
            if (current != wheelPosition || direction != wheelDirection) wheelTarget = current;
            wheelDirection = direction;
            wheelOrigin = wheelPosition = current;
            double distance = lines < 0 ? ClientSize.Height : lines * 24 * Ink.LayoutScale;
            wheelTarget = Math.Max(0, Math.Min(MaximumWheelPosition(), wheelTarget - delta * distance / 120));
            int animations;
            if (SystemInformation.HighContrast || !SystemParametersInfo(0x1042, 0, out animations, 0) || animations == 0 || Math.Round(wheelTarget) == current) {
                if (wheelTimer != null) wheelTimer.Stop();
                ApplyWheelPosition(wheelTarget);
                return;
            }
            if (wheelTimer == null) {
                wheelTimer = new Timer { Interval = 15 };
                wheelTimer.Tick += SmoothWheelFrame;
            }
            wheelClock.Restart();
            wheelTimer.Start();
        }
        private void SmoothWheelFrame(object sender, EventArgs e) {
            if (!IsHandleCreated || !AutoScroll || !Visible || !VerticalScroll.Visible || -AutoScrollPosition.Y != wheelPosition) {
                CancelSmoothScroll();
                return;
            }
            wheelTarget = Math.Min(wheelTarget, MaximumWheelPosition());
            double progress = Math.Min(1, wheelClock.Elapsed.TotalMilliseconds / 180);
            double remaining = 1 - progress;
            ApplyWheelPosition(wheelTarget + (wheelOrigin - wheelTarget) * remaining * remaining * remaining);
            if (progress == 1) {
                wheelTimer.Stop();
                wheelClock.Reset();
            }
        }
        protected override void WndProc(ref Message message) {
            // The dropdown has its own native window. Close it before moving
            // the scrolling page so it cannot be left at the old coordinates.
            if (AutoScroll && (message.Msg == 0x020A || message.Msg == 0x0115 || message.Msg == 0x0114)) {
                FinishQuestionReveal();
                CloseDropDowns();
                if (message.Msg == 0x020A && VerticalScroll.Visible) {
                    SmoothWheel(unchecked((short)(message.WParam.ToInt64() >> 16)));
                    message.Result = IntPtr.Zero;
                    return;
                }
                CancelSmoothScroll();
            }
            base.WndProc(ref message);
        }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            if (capturingAnswerFrame) return;
            Graphics g = e.Graphics; float s = Ink.Scale(g);
            if (question != null && !question.IsDisposed) {
                PaintQuestionHalo(g);
                float left = 28 * s, right = Math.Max(left, Width - 28 * s);
                float y = question.Bottom + 4 * s;
                bool rtl = RightToLeft == RightToLeft.Yes;
                float edge = rtl ? right : left, direction = rtl ? -1 : 1;
                float line = (right - left) * questionReveal;
                using (Pen subtle = new Pen(Ink.Line, s)) g.DrawLine(subtle, edge, y, edge + direction * line, y);
                using (Pen accent = new Pen(Ink.Cyan, 2 * s))
                    g.DrawLine(accent, edge, y, edge + direction * Math.Min(line, 58 * s), y);
            }
            if (PreviewRole == "sidebar") {
                float dividerY = SidebarDividerY > 0 ? SidebarDividerY : 111 * s;
                using (Pen line = new Pen(Ink.Line, s)) {
                    g.DrawLine(line, Width - s, 0, Width - s, Height);
                    g.DrawLine(line, 24 * s, dividerY, Width - 24 * s, dividerY);
                }
                using (Brush accent = new SolidBrush(Ink.Cyan)) g.FillRectangle(accent, 24 * s, dividerY - s, 30 * s, 2 * s);
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
            } else if (PreviewRole == "body" && PreviewWelcome && AnswerRevealOpacity > 0f && welcomeArt != null) {
                PaintWelcomeArt(g, s, AnswerRevealOpacity);
            } else if (PreviewRole == "body" && PreviewWelcome && questionReveal >= .75f && Height > 400 * s) {
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
            if (answerFrame != null && AnswerRevealOpacity > 0f) {
                using (ImageAttributes opacity = new ImageAttributes()) {
                    opacity.SetColorMatrix(new ColorMatrix { Matrix33 = AnswerRevealOpacity });
                    var destination = new Rectangle(AnswerRevealOffset, 0, answerFrame.Width, answerFrame.Height);
                    g.DrawImage(answerFrame, destination, 0, 0, answerFrame.Width, answerFrame.Height,
                        GraphicsUnit.Pixel, opacity);
                }
            }
        }
    }
    public class Label : System.Windows.Forms.Label {
        public bool PreviewStep { get; set; }
        internal bool QuestionTitle { get; set; }
        private float revealText = 1f;
        internal float RevealText { set { if (revealText != value) { revealText = value; Invalidate(); } } }
        public Label() { DoubleBuffered = true; ForeColor = Ink.Text; BackColor = Color.Transparent; }
        private void PaintQuestion(Graphics graphics) {
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center }) {
                if (RightToLeft == RightToLeft.Yes) format.FormatFlags |= StringFormatFlags.DirectionRightToLeft;
                RectangleF bounds = ClientRectangle;
                using (Brush text = new SolidBrush(Color.FromArgb((int)(255 * revealText), ForeColor)))
                    graphics.DrawString(Text, Font, text, bounds, format);
            }
        }
        protected override void OnPaint(PaintEventArgs e) {
            if (QuestionTitle && !SystemInformation.HighContrast) { PaintQuestion(e.Graphics); return; }
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

    public sealed class LogTextBox : TextBox {
        private const int SetRedraw = 0x000B;
        private const int LineScroll = 0x00B6;
        private const int GetFirstVisibleLine = 0x00CE;
        private const int VerticalScrollBar = 1;
        private const uint RangePageAndPosition = 0x0007;
        private const uint RedrawClientAndFrame = 0x0001 | 0x0004 | 0x0400;

        [StructLayout(LayoutKind.Sequential)]
        private struct ScrollInfo {
            internal uint Size, Mask;
            internal int Min, Max;
            internal uint Page;
            internal int Position, TrackPosition;
        }

        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool GetScrollInfo(IntPtr window, int bar, ref ScrollInfo info);
        [DllImport("user32.dll")] private static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);

        private int FirstVisibleLine() {
            return SendMessage(Handle, GetFirstVisibleLine, IntPtr.Zero, IntPtr.Zero).ToInt32();
        }

        public void AppendLog(string text) {
            if (String.IsNullOrEmpty(text)) return;
            int selectionStart = SelectionStart;
            int selectionEnd = selectionStart + SelectionLength;
            int firstCharacter = Math.Max(0, GetFirstCharIndexFromLine(FirstVisibleLine()));
            var scroll = new ScrollInfo { Size = (uint)Marshal.SizeOf(typeof(ScrollInfo)), Mask = RangePageAndPosition };
            bool scrollable = GetScrollInfo(Handle, VerticalScrollBar, ref scroll);
            bool follow = selectionStart == selectionEnd &&
                (!scrollable || scroll.Position + Math.Max(1, (int)scroll.Page) - 1 >= scroll.Max);

            bool redraw = Visible;
            if (redraw) SendMessage(Handle, SetRedraw, IntPtr.Zero, IntPtr.Zero);
            try {
                int removed = 0;
                if (TextLength + text.Length > 20000) {
                    string combined = Text + text;
                    removed = combined.Length - 16000;
                    if (Char.IsLowSurrogate(combined[removed])) removed++;
                    Text = combined.Substring(removed);
                } else {
                    AppendText(text);
                }
                if (follow) {
                    Select(TextLength, 0);
                } else {
                    int start = Math.Max(0, selectionStart - removed);
                    int end = Math.Max(0, selectionEnd - removed);
                    Select(start, end - start);
                }
                // Character offsets keep the same visible text even when old lines are trimmed.
                int line = GetLineFromCharIndex(follow ? TextLength : Math.Max(0, firstCharacter - removed));
                SendMessage(Handle, LineScroll, IntPtr.Zero, new IntPtr(line - FirstVisibleLine()));
            } finally {
                if (redraw) {
                    SendMessage(Handle, SetRedraw, new IntPtr(1), IntPtr.Zero);
                    RedrawWindow(Handle, IntPtr.Zero, IntPtr.Zero, RedrawClientAndFrame);
                }
            }
        }
    }

    public static class Theme {
        internal static bool DesignPreview { get; private set; }
        private static readonly ConditionalWeakTable<Control, Tracking> States = new ConditionalWeakTable<Control, Tracking>();
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int length);
        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] private static extern int SetWindowTheme(IntPtr window, string subAppName, string subIdList);
        [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        public static void EnableWindowDpi() {
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
            catch (EntryPointNotFoundException) { }
        }
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
            Panel side = sidebar as Panel; if (side != null) side.PreviewRole = "sidebar";
            Panel page = body as Panel; if (page != null) page.PreviewRole = "body";
            Panel foot = footer as Panel; if (foot != null) foot.PreviewRole = "footer";
            Button primary = next as Button; if (primary != null) primary.PreviewRole = "primary";
            Button danger = cancel as Button; if (danger != null) danger.PreviewRole = "danger";
            foreach (System.Windows.Forms.Label step in steps) { Label label = step as Label; if (label != null) { label.PreviewStep = true; label.Padding = new Padding((int)Math.Round(8 * step.Font.SizeInPoints / 9f), 0, 0, 0); } }
            AttachWindow(form); brand.ForeColor = Ink.Cyan; releaseLabel.ForeColor = brand.ForeColor;
            foreach (Control item in form.Controls) { Panel budget = item as Panel; if (budget != null && item != sidebar && item != body && item != footer) { budget.PreviewRole = "budget"; Apply(budget); } }
        }
        public static void AttachWindow(Form form) {
            UpdateScale(form, EventArgs.Empty);
            Track(form);
            form.HandleCreated += DarkCaption;
            form.Shown += DarkCaption;
            form.FontChanged += UpdateScale;
            form.DpiChanged += WindowDpiChanged;
            form.Disposed += UnhookCaption;
            if (form.IsHandleCreated) DarkCaption(form, EventArgs.Empty);
        }
        private static void WindowDpiChanged(object sender, DpiChangedEventArgs e) { UpdateScale(sender, e); }
        private static void UnhookCaption(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null) return;
            form.HandleCreated -= DarkCaption; form.Shown -= DarkCaption; form.FontChanged -= UpdateScale;
            form.DpiChanged -= WindowDpiChanged; form.Disposed -= UnhookCaption;
        }
        private static void UpdateScale(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null) return;
            // Wizard fonts already contain the explicit DPI scale in pixels.
            // SizeInPoints would convert them again using the monitor's DPI.
            float scale = form.AutoScaleMode == AutoScaleMode.Dpi ? form.DeviceDpi / 96f
                : (form.Font.Unit == GraphicsUnit.Pixel ? form.Font.Size / (10f * 96f / 72f) : form.Font.SizeInPoints / 10f);
            Ink.LayoutScale = Math.Max(.75f, Math.Min(4f, scale));
            form.Invalidate(true);
        }
        private static void DarkCaption(object sender, EventArgs e) {
            Form form = sender as Form; if (form == null || !form.IsHandleCreated) return;
            UpdateScale(sender, e);
            if (SystemInformation.HighContrast) return;
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
                page.Invalidate();
            }
        }
    }
}
