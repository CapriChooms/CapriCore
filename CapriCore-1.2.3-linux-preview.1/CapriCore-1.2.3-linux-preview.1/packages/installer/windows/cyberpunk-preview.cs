// SPDX-License-Identifier: GPL-3.0-only
// Compatibility surface for separately staged design previews. Production uses
// the same shared controls without the preview badge.
using System.Windows.Forms;
namespace Capri.Setup.Preview {
    public class Button : Cyberpunk.Button { }
    public class CheckBox : Cyberpunk.CheckBox { }
    public class RadioButton : Cyberpunk.RadioButton { }
    public class ComboBox : Cyberpunk.ComboBox { }
    public class ProgressBar : Cyberpunk.ProgressBar { }
    public class Panel : Cyberpunk.Panel { }
    public class Label : Cyberpunk.Label { }
    public class TextBox : Cyberpunk.TextBox { }
    public static class Theme {
        public static void Attach(Form form, Control sidebar, Control body, Control footer, System.Windows.Forms.Label brand, System.Windows.Forms.Label releaseLabel, System.Windows.Forms.Label[] steps, System.Windows.Forms.Button back, System.Windows.Forms.Button next, System.Windows.Forms.Button cancel, System.Windows.Forms.Button pause) {
            Cyberpunk.Theme.Attach(form, sidebar, body, footer, brand, releaseLabel, steps, back, next, cancel, pause, true);
        }
        public static void Refresh(Form form) { Cyberpunk.Theme.Refresh(form); }
    }
}
