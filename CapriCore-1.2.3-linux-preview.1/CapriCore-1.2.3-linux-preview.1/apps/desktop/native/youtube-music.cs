// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web;
using System.Web.Script.Serialization;
using System.Windows.Automation;

static class YouTubeMusic
{
    delegate bool WindowCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder value, int capacity);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, KeyInput[] input, int size);

    // The helper is compiled for x64, where the INPUT union begins at byte 8.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    struct KeyInput
    {
        [FieldOffset(0)] public uint Type;
        [FieldOffset(8)] public ushort Key;
        [FieldOffset(12)] public uint Flags;
    }

    static readonly int[] ModifierKeys = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
    const int RestoreWindow = 9;
    const int MinimizeWithoutActivation = 7;

    static readonly TreeWalker Walker = TreeWalker.ControlViewWalker;
    static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;
    static readonly Regex VideoId = new Regex(@"^[a-zA-Z0-9_-]{11}$");
    static readonly HashSet<string> PauseNames = new HashSet<string>(new[] {
        "Pause", "Pause playback", "Пауза", "Приостановить", "Pausar", "Pausa", "Mettre en pause",
        "Pauzeren", "Wstrzymaj", "Duraklat", "I-pause", "Jeda", "一時停止", "일시중지", "일시 중지", "暂停", "暫停",
        "إيقاف مؤقت", "השהיה", "Tạm dừng", "หยุดชั่วคราว", "Призупинити", "Pausa uppspelning",
    }, IgnoreCase);
    static readonly HashSet<string> PlayNames = new HashSet<string>(new[] {
        "Play", "Resume", "Воспроизвести", "Продолжить", "Reproducir", "Reproduzir", "Riproduci",
        "Lire", "Lecture", "Wiedergabe", "Afspelen", "Odtwórz", "Oynat", "I-play", "Putar", "再生", "재생",
        "播放", "تشغيل", "הפעלה", "Phát", "เล่น", "Відтворити", "Spela upp",
    }, IgnoreCase);
    static readonly Condition InactivityDialog = NamedControls(new[] {
        "Video paused. Continue watching?",
        "Воспроизведение приостановлено. Продолжить?",
        "Видео приостановлено. Продолжить просмотр?",
    });
    static readonly Condition InactivityToast = NamedControls(new[] {
        "Still watching? Video will pause soon",
        "Вы ещё смотрите? Видео скоро будет приостановлено",
        "Вы еще смотрите? Видео скоро будет приостановлено",
    });

    static Condition NamedControls(IEnumerable<string> names)
    {
        return new OrCondition(names.Select(name => (Condition)new PropertyCondition(
            AutomationElement.NameProperty, name, PropertyConditionFlags.IgnoreCase)).ToArray());
    }

    static readonly Condition ContinueButton = new AndCondition(
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
        NamedControls(new[] { "Yes", "Да" }));
    static readonly Condition ResultPlayButton = new AndCondition(
        new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink)),
        new OrCondition(NamedControls(PlayNames),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "play-button"),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "button")));

    sealed class Tab
    {
        public IntPtr Window;
        public AutomationElement Root;
        public AutomationElement Document;
        public Uri Url;
        public string Binding;
        public SelectionItemPattern Selection;
        public List<AutomationElement> AddressFields;
    }

    sealed class BackgroundTab
    {
        public IntPtr Window;
        public string WindowKey;
        public SelectionItemPattern Selection;
        public SelectionItemPattern Previous;
    }

    sealed class Player
    {
        public AutomationElement Toggle;
        public AutomationElement Next;
        public AutomationElement Previous;
        public AutomationElement Volume;
        public string Track;
        public string Position;
        public bool? Playing;
        public double? VolumePercent;
    }

    static Uri MusicUrl(string value)
    {
        Uri url;
        return !String.IsNullOrEmpty(value) && value.Length <= 2048 &&
            Uri.TryCreate(value, UriKind.Absolute, out url) && url.Scheme == "https" &&
            url.IdnHost == "music.youtube.com" && url.IsDefaultPort && String.IsNullOrEmpty(url.UserInfo)
            ? url : null;
    }

    static Uri ReadOnlyUrl(AutomationElement element)
    {
        object pattern;
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return null;
        var value = ((ValuePattern)pattern).Current;
        return value.IsReadOnly ? MusicUrl(value.Value) : null;
    }

    static string Parameter(Uri url, string name)
    {
        return HttpUtility.ParseQueryString(url.Query)[name];
    }

    static string TrackId(Uri url)
    {
        if (url == null || url.AbsolutePath != "/watch") return null;
        var id = Parameter(url, "v");
        return id != null && VideoId.IsMatch(id) ? id : null;
    }

    static bool SearchUrl(Uri url, string query)
    {
        return url != null && url.AbsolutePath == "/search" && String.Equals(query, Parameter(url, "q"), StringComparison.Ordinal);
    }

    static bool Browser(IntPtr window)
    {
        uint id;
        if (GetWindowThreadProcessId(window, out id) == 0) return false;
        try {
            using (var process = Process.GetProcessById((int)id)) {
                var version = process.MainModule.FileVersionInfo;
                var company = version.CompanyName ?? "";
                switch (process.ProcessName.ToLowerInvariant()) {
                    case "chrome": return company.IndexOf("Google", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "msedge": return company.IndexOf("Microsoft", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "firefox": return company.IndexOf("Mozilla", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "brave": return company.IndexOf("Brave", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "opera": return company.IndexOf("Opera", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "vivaldi": return company.IndexOf("Vivaldi", StringComparison.OrdinalIgnoreCase) >= 0;
                    case "browser":
                        return company.IndexOf("Yandex", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            company.IndexOf("Яндекс", StringComparison.OrdinalIgnoreCase) >= 0;
                    default: return false;
                }
            }
        } catch (System.ComponentModel.Win32Exception) { return false; }
          catch (InvalidOperationException) { return false; }
          catch (ArgumentException) { return false; }
    }

    // Walk only a bounded part of the accessibility tree. Page frames are never
    // visited, so an embedded player cannot be mistaken for the browser tab.
    static IEnumerable<AutomationElement> Walk(AutomationElement root, int limit, int milliseconds,
        Action onLimit = null)
    {
        var timer = Stopwatch.StartNew();
        var stack = new Stack<AutomationElement>();
        var current = Walker.GetFirstChild(root);
        while (limit-- > 0 && timer.ElapsedMilliseconds < milliseconds) {
            if (current == null) {
                if (stack.Count == 0) yield break;
                current = stack.Pop();
                continue;
            }
            yield return current;
            var sibling = Walker.GetNextSibling(current);
            var type = current.Current.ControlType;
            var child = type == ControlType.Document || type == ControlType.TabItem ? null : Walker.GetFirstChild(current);
            if (child != null && sibling != null) stack.Push(sibling);
            current = child ?? sibling;
        }
        if (current != null || stack.Count > 0) {
            if (onLimit != null) onLimit();
        }
    }

    static string BrowserWindowKey(IntPtr window)
    {
        uint id;
        if (GetWindowThreadProcessId(window, out id) == 0) return null;
        using (var process = Process.GetProcessById((int)id))
            return window.ToInt64() + ":" + id + ":" + process.StartTime.ToUniversalTime().Ticks + ":";
    }

    static List<IntPtr> BrowserWindows(string binding, bool includeMinimized, out bool incomplete)
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, ignored) => {
            if (IsWindowVisible(window) && (includeMinimized || !IsIconic(window)) &&
                (binding == null || binding.StartsWith(window.ToInt64() + ":", StringComparison.Ordinal)))
                windows.Add(window);
            return windows.Count < 128;
        }, IntPtr.Zero);
        incomplete = windows.Count == 128;
        return windows.Where(Browser).ToList();
    }

    static List<Tab> VisibleTabs(IntPtr window, string search, Action onLimit = null)
    {
        var tabs = new List<Tab>();
        if (!IsWindowVisible(window) || IsIconic(window)) return tabs;
        var windowKey = BrowserWindowKey(window);
        if (windowKey == null) return tabs;
        var root = AutomationElement.FromHandle(window);
        foreach (var document in Walk(root, 480, 460, onLimit)) {
            var current = document.Current;
            if (current.ControlType != ControlType.Document || current.IsOffscreen || current.BoundingRectangle.IsEmpty) continue;
            var url = ReadOnlyUrl(document);
            if (url == null) continue;
            var tabKey = windowKey + String.Join(",", document.GetRuntimeId());
            var tab = new Tab { Window = window, Root = root, Document = document, Binding = tabKey };
            tab.Url = CommittedUrl(tab, url);
            if (tab.Url == null || search != null && !SearchUrl(tab.Url, search)) continue;
            tabs.Add(tab);
            if (tabs.Count > 1) break;
        }
        return tabs;
    }

    static bool AutomationFailure(Exception error)
    {
        return error is ElementNotAvailableException || error is ElementNotEnabledException ||
            error is System.ComponentModel.Win32Exception || error is ExternalException ||
            error is ArgumentException || error is InvalidOperationException;
    }

    static List<Tab> Tabs(string search, string binding, out bool incomplete)
    {
        var tabs = new List<Tab>();
        bool limited;
        foreach (var window in BrowserWindows(binding, false, out limited)) {
            try {
                tabs.AddRange(VisibleTabs(window, search, () => limited = true));
            } catch (Exception error) {
                if (!AutomationFailure(error)) throw;
                limited = true;
            }
        }
        incomplete = limited;
        return tabs;
    }

    static bool MusicTitle(string title)
    {
        // Browser tab text is only a discovery hint, since a page can choose its title.
        return title != null && title.IndexOf("YouTube Music", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static List<BackgroundTab> BackgroundTabs(string binding, out bool incomplete)
    {
        var candidates = new List<BackgroundTab>();
        bool limited;
        foreach (var window in BrowserWindows(binding, true, out limited)) {
            int before = candidates.Count;
            string key = null;
            try {
                key = BrowserWindowKey(window);
                if (key == null || binding != null && !binding.StartsWith(key, StringComparison.Ordinal)) continue;
                uint pid;
                if (GetWindowThreadProcessId(window, out pid) == 0) continue;
                var root = AutomationElement.FromHandle(window);
                var selected = new List<SelectionItemPattern>();
                var matches = new List<SelectionItemPattern>();
                foreach (var element in Walk(root, 540, 460, () => limited = true)) {
                    var info = element.Current;
                    if (info.ControlType != ControlType.TabItem || info.ProcessId != (int)pid) continue;
                    object raw;
                    if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out raw)) {
                        if (MusicTitle(info.Name)) limited = true;
                        continue;
                    }
                    var pattern = (SelectionItemPattern)raw;
                    if (pattern.Current.IsSelected) selected.Add(pattern);
                    if (MusicTitle(info.Name)) matches.Add(pattern);
                }
                foreach (var match in matches)
                    candidates.Add(new BackgroundTab {
                        Window = window, WindowKey = key, Selection = match,
                        Previous = selected.Count == 1 ? selected[0] : null
                    });
            } catch (Exception error) {
                if (!AutomationFailure(error)) throw;
                limited = true;
            }
            if (key != null && before == candidates.Count && IsIconic(window)) {
                var title = new StringBuilder(1024);
                GetWindowText(window, title, title.Capacity);
                if (MusicTitle(title.ToString())) candidates.Add(new BackgroundTab { Window = window, WindowKey = key });
            }
        }
        incomplete = limited;
        return candidates;
    }

    static Tab PreferVisible(List<Tab> candidates)
    {
        if (candidates.Count == 0) return null;
        var foreground = GetForegroundWindow();
        var window = candidates.Any(candidate => candidate.Window == foreground) ? foreground : candidates[0].Window;
        var matches = candidates.Where(candidate => candidate.Window == window).Take(2).ToArray();
        return matches.Length == 1 ? matches[0] : null;
    }

    static Tab FindExisting(string binding, bool allowSelection, out string status)
    {
        bool visibleIncomplete;
        var visible = Tabs(null, binding, out visibleIncomplete);
        if (binding != null) visible.RemoveAll(tab => tab.Binding != binding);
        var verified = PreferVisible(visible);
        status = "tab_not_found";
        if (verified != null) return verified;
        if (visible.Count > 0) { status = "ambiguous_tab"; return null; }
        if (!allowSelection) return null;

        bool incomplete;
        var background = BackgroundTabs(binding, out incomplete);
        if (background.Count == 0) {
            if (incomplete || visibleIncomplete) status = "control_unavailable";
            return null;
        }

        // A title can be spoofed. Probe the foreground browser first and then use
        // window and tab-strip order, verifying the actual page before any action.
        const int attemptLimit = 6;
        var foreground = GetForegroundWindow();
        var timer = Stopwatch.StartNew();
        bool stale = binding != null && !incomplete && !visibleIncomplete && background.Count <= attemptLimit;
        status = "control_unavailable";
        foreach (var candidate in background.OrderBy(tab => tab.Window != foreground).Take(attemptLimit)) {
            int remaining = 3600 - (int)timer.ElapsedMilliseconds;
            if (remaining <= 0) { stale = false; break; }
            string probe;
            verified = ActivateTab(candidate, binding, Math.Min(900, remaining), out probe);
            if (verified != null) return verified;
            if (probe != "tab_not_found") stale = false;
            if (probe == "ambiguous_tab") status = probe;
        }
        if (stale) status = "tab_not_found";
        return null;
    }

    static Tab ActivateTab(BackgroundTab candidate, string binding, int milliseconds, out string status)
    {
        bool minimized = IsIconic(candidate.Window);
        bool selected = false;
        bool restored = false;
        bool confirmed = false;
        status = "control_unavailable";
        try {
            if (candidate.WindowKey != BrowserWindowKey(candidate.Window)) return null;
            if (minimized) {
                ShowWindow(candidate.Window, RestoreWindow);
                restored = true;
            }
            if (candidate.Selection != null && !candidate.Selection.Current.IsSelected) {
                if (candidate.Previous == null || !candidate.Previous.Current.IsSelected) return null;
                candidate.Selection.Select();
                selected = true;
            }
            var timer = Stopwatch.StartNew();
            do {
                if (candidate.Selection == null || candidate.Selection.Current.IsSelected) {
                    var current = VisibleTabs(candidate.Window, null);
                    if (current.Count == 1) {
                        var verified = current[0];
                        verified.Selection = candidate.Selection;
                        var url = CurrentUrl(verified);
                        if (url != null) {
                            if (binding != null && verified.Binding != binding) {
                                status = "tab_not_found";
                            } else {
                                verified.Url = url;
                                confirmed = true;
                                return verified;
                            }
                        }
                    } else if (current.Count > 1) {
                        status = "ambiguous_tab";
                        return null;
                    }
                }
                Thread.Sleep(45);
            } while (timer.ElapsedMilliseconds < milliseconds);
        } catch (Exception error) {
            if (!AutomationFailure(error)) throw;
            status = "control_unavailable";
        }
        finally {
            if (!confirmed) {
                try {
                    if (selected && candidate.Selection.Current.IsSelected) candidate.Previous.Select();
                } catch (Exception error) {
                    if (!AutomationFailure(error)) throw;
                }
                if (restored && IsWindowVisible(candidate.Window) && !IsIconic(candidate.Window))
                    ShowWindow(candidate.Window, MinimizeWithoutActivation);
            }
        }
        return null;
    }

    static Uri CurrentUrl(Tab tab)
    {
        if (!IsWindowVisible(tab.Window) || IsIconic(tab.Window) || tab.Document.Current.IsOffscreen ||
            (tab.Selection != null && !tab.Selection.Current.IsSelected) ||
            !tab.Binding.StartsWith(BrowserWindowKey(tab.Window) ?? "invalid:", StringComparison.Ordinal)) return null;
        var url = ReadOnlyUrl(tab.Document);
        if (url == null) return null;
        for (var node = Walker.GetParent(tab.Document); node != null; node = Walker.GetParent(node)) {
            if (Automation.Compare(node, tab.Root)) return CommittedUrl(tab, url);
            if (node.Current.ControlType == ControlType.Document) break;
        }
        return null;
    }

    static Uri CommittedUrl(Tab tab, Uri documentUrl)
    {
        // Chromium browsers can retain stale document URLs after navigation or
        // tab changes. The browser's own address field can corroborate the current
        // route after the document has independently proved its HTTPS origin.
        try {
            if (tab.AddressFields == null) tab.AddressFields = FindAddressFields(tab);
            Uri address = null;
            foreach (var field in tab.AddressFields) {
                var current = field.Current;
                if (current.HasKeyboardFocus) return documentUrl;
                object raw;
                if (!field.TryGetCurrentPattern(ValuePattern.Pattern, out raw)) return documentUrl;
                var value = ((ValuePattern)raw).Current.Value;
                var committed = AddressUrl(value, current.ClassName == "OmniboxViewViews");
                if (committed == null) return documentUrl;
                var url = MusicUrl(committed.AbsoluteUri);
                if (url == null) return null;
                if (address != null && !Equals(address, url)) return documentUrl;
                address = url;
            }
            return address ?? documentUrl;
        } catch (Exception error) {
            if (!AutomationFailure(error)) throw;
            return documentUrl;
        }
    }

    static Uri AddressUrl(string value, bool schemeElided)
    {
        Uri address;
        if (Uri.TryCreate(value, UriKind.Absolute, out address) &&
            (address.Scheme == "https" || address.Scheme == "http")) return address;
        if (!schemeElided || String.IsNullOrWhiteSpace(value) || value.Contains("://") ||
            !Uri.TryCreate("https://" + value, UriKind.Absolute, out address)) return null;
        // Chrome omits the scheme from steady-state text. Require a hostname so
        // incomplete text or a search suggestion does not override the document.
        return address.IdnHost.Contains(".") || address.IsLoopback || address.HostNameType == UriHostNameType.IPv6
            ? address : null;
    }

    static List<AutomationElement> FindAddressFields(Tab tab)
    {
        var fields = new List<AutomationElement>();
        uint pid;
        if (GetWindowThreadProcessId(tab.Window, out pid) == 0) return fields;
        bool chrome;
        using (var process = Process.GetProcessById((int)pid)) {
            string name = process.ProcessName;
            chrome = IgnoreCase.Equals(name, "chrome");
            if (!chrome && !IgnoreCase.Equals(name, "browser")) return fields;
        }
        var editId = chrome ? "view_1012" : "view_1018";
        var editClass = chrome ? "OmniboxViewViews" : "SmartboxEditField";
        var ownerClass = chrome ? "LocationBarView" : "SmartboxButtonView";
        foreach (var element in Walk(tab.Root, 320, 350)) {
            var current = element.Current;
            if (current.ProcessId != (int)pid || current.ControlType != ControlType.Edit ||
                current.AutomationId != editId || current.ClassName != editClass) continue;
            var parent = Walker.GetParent(element);
            if (parent == null) continue;
            var owner = parent.Current;
            if (owner.ProcessId == (int)pid && owner.ClassName == ownerClass && (chrome || owner.AutomationId == "view_1120"))
                fields.Add(element);
        }
        return fields;
    }

    static bool Classes(AutomationElement element, string token)
    {
        return (" " + element.Current.ClassName + " ").Contains(" " + token + " ");
    }

    static bool Inside(AutomationElement item, AutomationElement document)
    {
        for (var node = item; node != null; node = Walker.GetParent(node)) {
            if (node.Current.ControlType == ControlType.Document) return Automation.Compare(node, document);
        }
        return false;
    }

    static bool InTrackResult(AutomationElement link, AutomationElement document, bool home, bool requirePlayMarker = false)
    {
        bool result = false, playMarker = false;
        for (var node = link; node != null; node = TreeWalker.RawViewWalker.GetParent(node)) {
            var info = node.Current;
            if (info.ControlType == ControlType.Document)
                return result && (!requirePlayMarker || playMarker) && Automation.Compare(node, document);
            if (requirePlayMarker && !playMarker)
                playMarker = info.AutomationId == "play-button" || Classes(node, "play-button") ||
                    Classes(node, "ytmusic-play-button-renderer");
            result = result || Classes(node, "ytmusic-responsive-list-item-renderer") ||
                Classes(node, "ytmusic-card-shelf-renderer") ||
                (home && (Classes(node, "ytmusic-two-row-item-renderer") || Classes(node, "ytmusic-carousel")));
        }
        return false;
    }

    static bool PlayerButton(AutomationElement element, string role)
    {
        var parent = Walker.GetParent(element);
        return parent != null && (parent.Current.AutomationId == role || Classes(parent, role)) && Classes(parent, "ytmusic-player-bar");
    }

    static Player InspectPlayer(Tab tab)
    {
        var state = new Player();
        var stopwatch = Stopwatch.StartNew();
        var remaining = 220;
        // Narrow the remote query to known player nodes and controls. The
        // player bar is often rendered after a very large playlist or queue.
        var condition = new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Slider),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "button"),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "title"),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "player-bar"),
            new PropertyCondition(AutomationElement.ClassNameProperty, "title style-scope ytmusic-player-bar"));
        var elements = tab.Document.FindAll(TreeScope.Descendants, condition);
        foreach (AutomationElement element in elements) {
            if (--remaining < 0 || stopwatch.ElapsedMilliseconds > 1100) break;
            try {
                var current = element.Current;
                if (current.IsOffscreen || !Inside(element, tab.Document)) continue;
                if (current.ControlType == ControlType.Button) {
                    if (PlayerButton(element, "play-pause-button")) {
                        state.Toggle = element;
                        string label = (current.Name ?? "").Trim();
                        if (PauseNames.Contains(label)) state.Playing = true;
                        else if (PlayNames.Contains(label)) state.Playing = false;
                    }
                    else if (PlayerButton(element, "next-button")) state.Next = element;
                    else if (PlayerButton(element, "previous-button")) state.Previous = element;
                } else if (current.ControlType == ControlType.Slider) {
                    object pattern;
                    if (!element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) continue;
                    var range = ((RangeValuePattern)pattern).Current;
                    if ((current.AutomationId == "volume-slider" || current.AutomationId == "expand-volume-slider") &&
                        Classes(element, "ytmusic-player-bar")) {
                        if (range.Maximum <= range.Minimum) continue;
                        state.Volume = element;
                        state.VolumePercent = 100.0 * (range.Value - range.Minimum) / (range.Maximum - range.Minimum);
                    } else if (current.AutomationId == "progress-bar" &&
                        (Classes(element, "ytmusic-player-bar") || Classes(element, "ytmusic-app")))
                        state.Position = range.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
                } else if (Classes(element, "title") && Classes(element, "ytmusic-player-bar")) {
                    var title = current.Name;
                    if (String.IsNullOrWhiteSpace(title)) {
                        var text = element.FindFirst(TreeScope.Descendants,
                            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text));
                        if (text != null && !text.Current.IsOffscreen) title = text.Current.Name;
                    }
                    if (!String.IsNullOrWhiteSpace(title)) state.Track = title;
                }
            } catch (ElementNotAvailableException) { }
        }
        return state;
    }

    static bool Invoke(Tab tab, AutomationElement element, Uri expected)
    {
        object pattern;
        try {
            if (element == null || element.Current.IsOffscreen || !element.Current.IsEnabled ||
                !Inside(element, tab.Document) || !element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern) ||
                !Equals(CurrentUrl(tab), expected)) return false;
        } catch (ElementNotAvailableException) { return false; }
        ((InvokePattern)pattern).Invoke();
        return true;
    }

    // Only acknowledge the named inactivity prompt inside the already verified music tab.
    // Search-only and read-only requests leave the player as it is.
    static bool ContinueWatching(Tab tab, bool includeWarning = true)
    {
        var expected = CurrentUrl(tab);
        // The early warning can still be visible behind the blocking dialog.
        return expected != null && (AcknowledgeInactivity(tab, expected, InactivityDialog) ||
            includeWarning && AcknowledgeInactivity(tab, expected, InactivityToast));
    }

    static bool AcknowledgeInactivity(Tab tab, Uri expected, Condition promptNames)
    {
        var raw = TreeWalker.RawViewWalker;
        foreach (AutomationElement prompt in tab.Document.FindAll(TreeScope.Descendants, promptNames)) {
            try {
                if (prompt.Current.IsOffscreen || !Inside(prompt, tab.Document)) continue;
                var container = prompt;
                for (int depth = 0; depth < 7 && container != null; depth++, container = raw.GetParent(container)) {
                    var info = container.Current;
                    if (info.ControlType == ControlType.Document) break;
                    bool surface = Classes(container, "ytmusic-you-there-renderer") ||
                        Classes(container, "yt-confirm-dialog-renderer") ||
                        Classes(container, "ytmusic-notification-action-renderer") ||
                        Classes(container, "tp-yt-paper-dialog") || Classes(container, "tp-yt-paper-toast") ||
                        (info.Name == prompt.Current.Name && (info.ControlType == ControlType.Window ||
                            info.ControlType == ControlType.Pane || info.ControlType == ControlType.Group));
                    if (!surface) continue;
                    var buttons = container.FindAll(TreeScope.Descendants, ContinueButton)
                        .Cast<AutomationElement>().Where(button => !button.Current.IsOffscreen &&
                            button.Current.IsEnabled).Take(2).ToList();
                    if (buttons.Count != 1 || !Invoke(tab, buttons[0], expected)) continue;
                    var wait = Stopwatch.StartNew();
                    while (wait.ElapsedMilliseconds < 800) {
                        try { if (prompt.Current.IsOffscreen) break; }
                        catch (ElementNotAvailableException) { break; }
                        Thread.Sleep(40);
                    }
                    var updated = CurrentUrl(tab);
                    if (updated != null) tab.Url = updated;
                    return true;
                }
            } catch (ElementNotAvailableException) { }
        }
        return false;
    }

    static AutomationElement FindResultPlayButton(Tab tab, bool home)
    {
        int remaining = 100;
        foreach (AutomationElement button in tab.Document.FindAll(TreeScope.Descendants, ResultPlayButton)) {
            if (remaining-- == 0) break;
            try {
                var info = button.Current;
                if (info.IsOffscreen || !info.IsEnabled) continue;
                var label = (info.Name ?? "").Trim();
                bool plainPlay = PlayNames.Contains(label);
                if (!plainPlay && !PlayNames.Any(verb => label.StartsWith(verb + " ", StringComparison.OrdinalIgnoreCase)))
                    continue;
                if (InTrackResult(button, tab.Document, home, !plainPlay) &&
                    button.GetCurrentPropertyValue(AutomationElement.IsInvokePatternAvailableProperty).Equals(true))
                    return button;
            } catch (ElementNotAvailableException) { }
        }
        return null;
    }

    static bool NewResultIsPlaying(Uri url, Uri from, Player previous, Player current)
    {
        return current.Playing == true && (TrackId(url) != null && TrackId(url) != TrackId(from) ||
            Equals(url, from) && !String.IsNullOrWhiteSpace(current.Track) &&
            !String.Equals((previous.Track ?? "").Trim(), current.Track.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    static AutomationElement FindTrack(Tab tab, bool home, out string trackId, out string name)
    {
        trackId = null;
        name = null;
        try {
            var links = tab.Document.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink));
            foreach (AutomationElement link in links) {
                var info = link.Current;
                var title = info.Name;
                if (info.IsOffscreen || !info.IsEnabled || String.IsNullOrWhiteSpace(title) ||
                    !Classes(link, "yt-simple-endpoint") || !InTrackResult(link, tab.Document, home)) continue;
                var id = TrackId(ReadOnlyUrl(link));
                if (id == null || !link.GetCurrentPropertyValue(AutomationElement.IsInvokePatternAvailableProperty).Equals(true)) continue;
                trackId = id;
                name = title;
                return link;
            }
        } catch (ElementNotAvailableException) {
            // YouTube Music can replace the result list after the search URL commits.
            // Discard the outdated list so the next poll can start from the top again.
        }
        return null;
    }

    static Dictionary<string, object> Reply(bool ok, string status, Player player = null, string track = null, Tab tab = null)
    {
        var result = new Dictionary<string, object> { { "ok", ok }, { "status", status } };
        track = String.IsNullOrWhiteSpace(player == null ? null : player.Track) ? track : player.Track;
        if (!String.IsNullOrWhiteSpace(track)) result["track"] = track.Length > 180 ? track.Substring(0, 180) : track;
        if (player != null && player.Playing.HasValue) result["playing"] = player.Playing.Value;
        if (player != null && player.VolumePercent.HasValue) result["volume"] = Math.Round(player.VolumePercent.Value);
        if (ok && tab != null) result["binding"] = tab.Binding;
        return result;
    }

    static AutomationElement SearchField(Tab tab)
    {
        var field = tab.Document.FindFirst(TreeScope.Descendants, new AndCondition(
            new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox)),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "input"),
            new PropertyCondition(AutomationElement.ClassNameProperty, "style-scope ytmusic-search-box")));
        return field != null && !field.Current.IsOffscreen && !field.Current.IsPassword &&
            field.Current.IsEnabled && Inside(field, tab.Document) ? field : null;
    }

    static string SubmitSearch(Tab tab, string query)
    {
        if (SearchUrl(CurrentUrl(tab), query)) return null;
        var field = SearchField(tab);
        if (field == null) {
            var buttons = tab.Document.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, "button"));
            foreach (AutomationElement button in buttons) {
                var parent = Walker.GetParent(button);
                if (button.Current.ControlType != ControlType.Button || parent == null ||
                    !Classes(parent, "search-button") || !Classes(parent, "ytmusic-search-box")) continue;
                if (!Invoke(tab, button, tab.Url)) return "control_unavailable";
                var wait = Stopwatch.StartNew();
                do {
                    Thread.Sleep(40);
                    field = SearchField(tab);
                } while (field == null && wait.ElapsedMilliseconds < 600);
                break;
            }
        }
        object pattern;
        if (field == null || !field.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return "control_unavailable";
        var previousWindow = GetForegroundWindow();
        bool keysSent = false, submitted = false;
        try {
            if (previousWindow != tab.Window) SetForegroundWindow(tab.Window);
            if (!FocusControl(tab, field)) return "control_unavailable";
            var value = (ValuePattern)pattern;
            if (value.Current.IsReadOnly) return "control_unavailable";
            value.SetValue(query);
            var timer = Stopwatch.StartNew();
            while (value.Current.Value != query && timer.ElapsedMilliseconds < 600) Thread.Sleep(35);
            if (!String.Equals(query, value.Current.Value, StringComparison.Ordinal) ||
                !CanSendKeys(tab, field, 0x0D)) return "control_unverified";
            keysSent = true;
            if (!SendKeyPresses(0x0D, 1, 0)) return "control_unverified";
            timer.Restart();
            do {
                Thread.Sleep(40);
                submitted = SearchUrl(CurrentUrl(tab), query);
                if (submitted) return null;
            } while (timer.ElapsedMilliseconds < 1800);
            return "control_unverified";
        } finally {
            if ((!keysSent || submitted) && previousWindow != tab.Window &&
                IsWindowVisible(previousWindow) && GetForegroundWindow() == tab.Window)
                SetForegroundWindow(previousWindow);
        }
    }

    static object Search(string search, string binding, bool play, bool waitForSearch)
    {
        Tab tab = null;
        bool handledPrompt = false, checkedSearchPrompt = false;
        if (!waitForSearch) {
            string status;
            tab = FindExisting(binding, true, out status);
            if (tab == null) return Reply(false, status);
            // A toast does not block the search. Leave the search field focused
            // until the query is submitted, then acknowledge any early warning.
            if (play) handledPrompt = ContinueWatching(tab, false);
            var error = SubmitSearch(tab, search);
            if (error != null) return Reply(false, error);
        }
        var timer = Stopwatch.StartNew();
        do {
            if (tab == null) {
                bool incomplete;
                var tabs = Tabs(search, binding, out incomplete);
                if (binding != null) tabs.RemoveAll(candidate => candidate.Binding != binding);
                tab = PreferVisible(tabs);
                if (tab == null && tabs.Count > 0) return Reply(false, "ambiguous_tab");
            }
            if (tab != null) {
                var searchUrl = CurrentUrl(tab);
                if (!SearchUrl(searchUrl, search)) return Reply(false, play ? "playback_unverified" : "control_unverified");
                tab.Url = searchUrl;
                if (!play) return Reply(true, "search_opened", null, null, tab);
                if (!handledPrompt && !checkedSearchPrompt) {
                    ContinueWatching(tab);
                    checkedSearchPrompt = true;
                }
                var playButton = FindResultPlayButton(tab, false);
                if (playButton != null) {
                    var previous = InspectPlayer(tab);
                    if (Invoke(tab, playButton, searchUrl))
                        return Verify(tab, "playing", 8500, (url, current) =>
                            NewResultIsPlaying(url, searchUrl, previous, current));
                }
                string wanted, title;
                var link = FindTrack(tab, false, out wanted, out title);
                if (link != null) {
                    var previous = InspectPlayer(tab);
                    bool titleCanConfirm = previous.Playing == false ||
                        !String.Equals((previous.Track ?? "").Trim(), title.Trim(), StringComparison.OrdinalIgnoreCase);
                    // The player can start in its lower bar without leaving
                    // the search page. Confirm either the exact watch URL or
                    // the selected result title in that same search document.
                    if (Invoke(tab, link, tab.Url))
                        return Verify(tab, "playing", 8500, (url, player) => player.Playing == true &&
                            (TrackId(url) == wanted || titleCanConfirm && SearchUrl(url, search) &&
                             String.Equals((player.Track ?? "").Trim(), title.Trim(), StringComparison.OrdinalIgnoreCase)), title);
                }
            }
            Thread.Sleep(350);
        } while (timer.ElapsedMilliseconds < 9500);
        return Reply(false, tab == null ? "playback_unverified" : "no_results");
    }

    static object Start(Tab tab, Player player)
    {
        if (!Equals(CurrentUrl(tab), tab.Url)) return Reply(false, "control_unavailable");
        if (player.Playing == true) return Reply(true, "playing", player, null, tab);
        if (TrackId(tab.Url) != null || !String.IsNullOrWhiteSpace(player.Track)) {
            if (player.Playing != false || !Invoke(tab, player.Toggle, tab.Url))
                return Reply(false, "control_unavailable");
            return Verify(tab, "playing", 2400, (url, current) => Equals(url, tab.Url) && current.Playing == true);
        }
        if (tab.Url.AbsolutePath != "/") return Reply(false, "no_results");

        var playButton = FindResultPlayButton(tab, true);
        if (playButton != null && Invoke(tab, playButton, tab.Url))
            return Verify(tab, "playing", 8500, (url, current) =>
                NewResultIsPlaying(url, tab.Url, player, current));
        string wanted, title;
        var link = FindTrack(tab, true, out wanted, out title);
        if (link == null) return Reply(false, "no_results");
        if (!Invoke(tab, link, tab.Url)) return Reply(false, "control_unavailable");
        return Verify(tab, "playing", 8500, (url, current) => current.Playing == true &&
            (TrackId(url) == wanted || Equals(url, tab.Url) &&
             String.Equals((current.Track ?? "").Trim(), title.Trim(), StringComparison.OrdinalIgnoreCase)), title);
    }

    static object Verify(Tab tab, string success, int milliseconds, Func<Uri, Player, bool> check, string name = null)
    {
        var timer = Stopwatch.StartNew();
        do {
            Thread.Sleep(225);
            var url = CurrentUrl(tab);
            if (url == null) break;
            var player = InspectPlayer(tab);
            if (check(url, player)) return Reply(true, success, player, name, tab);
        } while (timer.ElapsedMilliseconds < milliseconds);
        return Reply(false, success == "playing" ? "playback_unverified" : "control_unverified");
    }

    static object Volume(Tab tab, Player player, Dictionary<string, object> command)
    {
        object pattern;
        if (player.Volume == null || !player.VolumePercent.HasValue || !player.Volume.Current.IsKeyboardFocusable ||
            !player.Volume.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern) ||
            !Inside(player.Volume, tab.Document) || !Equals(CurrentUrl(tab), tab.Url))
            return Reply(false, "control_unavailable");
        object amount;
        double goal = command.TryGetValue("value", out amount)
            ? Convert.ToDouble(amount) : player.VolumePercent.Value + Convert.ToDouble(command["delta"]);
        goal = Math.Round(Math.Max(0, Math.Min(100, goal)));
        var range = (RangeValuePattern)pattern;
        var state = range.Current;
        if (state.Minimum != 0 || state.Maximum != 100) return Reply(false, "control_unavailable");
        if (Math.Abs(player.VolumePercent.Value - goal) < 0.5) return Reply(true, "volume_set", player, null, tab);

        var previousWindow = GetForegroundWindow();
        AutomationElement previousFocus = null;
        try {
            if (previousWindow != tab.Window) SetForegroundWindow(tab.Window);
            previousFocus = AutomationElement.FocusedElement;
            if (!FocusControl(tab, player.Volume)) return Reply(false, "control_unavailable");
            // The custom slider exposes its value via UIA, but Up/Down are
            // needed to change it in one-percent increments.
            int steps = (int)Math.Round(goal - range.Current.Value);
            ushort key = steps > 0 ? (ushort)0x26 : (ushort)0x28;
            if (Math.Abs(steps) > 100 || !CanSendKeys(tab, player.Volume, key)) return Reply(false, "control_unavailable");
            if (steps != 0 && !SendKeyPresses(key, Math.Abs(steps), 1)) return Reply(false, "control_unverified");
            return Verify(tab, "volume_set", 2100, (url, current) => Equals(url, tab.Url) &&
                current.VolumePercent.HasValue && Math.Abs(current.VolumePercent.Value - goal) < 0.5);
        }
        finally {
            try {
                if (GetForegroundWindow() == tab.Window && previousFocus != null &&
                    Equals(CurrentUrl(tab), tab.Url) && Automation.Compare(player.Volume, AutomationElement.FocusedElement)) {
                    if (previousFocus.Current.IsKeyboardFocusable && Inside(previousFocus, tab.Document)) previousFocus.SetFocus();
                    if (previousWindow != tab.Window && IsWindowVisible(previousWindow) && GetForegroundWindow() == tab.Window)
                        SetForegroundWindow(previousWindow);
                }
            } catch (ElementNotAvailableException) { }
              catch (InvalidOperationException) { }
        }
    }

    static bool Pressed(int key)
    {
        return (GetAsyncKeyState(key) & 0x8000) != 0;
    }

    static bool FocusControl(Tab tab, AutomationElement control)
    {
        if (GetForegroundWindow() != tab.Window || !Equals(CurrentUrl(tab), tab.Url) ||
            !control.Current.IsKeyboardFocusable || !Inside(control, tab.Document)) return false;
        control.SetFocus();
        var timer = Stopwatch.StartNew();
        do {
            if (GetForegroundWindow() != tab.Window) return false;
            if (Automation.Compare(control, AutomationElement.FocusedElement)) return true;
            Thread.Sleep(25);
        } while (timer.ElapsedMilliseconds < 500);
        return false;
    }

    static bool CanSendKeys(Tab tab, AutomationElement control, ushort key)
    {
        return Equals(CurrentUrl(tab), tab.Url) && Inside(control, tab.Document) &&
            Automation.Compare(control, AutomationElement.FocusedElement) &&
            !ModifierKeys.Any(Pressed) && !Pressed(key) && GetForegroundWindow() == tab.Window;
    }

    static bool SendKeyPresses(ushort key, int count, uint flags)
    {
        var keys = new KeyInput[count * 2];
        for (int i = 0; i < keys.Length; i++)
            keys[i] = new KeyInput { Type = 1, Key = key, Flags = i % 2 == 0 ? flags : flags | 2u };
        var sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(KeyInput)));
        if (sent % 2 != 0)
            SendInput(1, new[] { new KeyInput { Type = 1, Key = key, Flags = flags | 2u } }, Marshal.SizeOf(typeof(KeyInput)));
        return sent == keys.Length;
    }

    static object Execute(Dictionary<string, object> command)
    {
        var action = Convert.ToString(command["action"]);
        object binding, waitForSearch;
        command.TryGetValue("binding", out binding);
        command.TryGetValue("waitForSearch", out waitForSearch);
        if (action == "play" || action == "search")
            return Search(Convert.ToString(command["query"]), binding as string, action == "play", Equals(waitForSearch, true));
        string status;
        var tab = FindExisting(binding as string, action != "status", out status);
        if (tab == null) return Reply(false, status);
        if (action == "open") {
            if (CurrentUrl(tab) == null) return Reply(false, "control_unavailable");
            if (GetForegroundWindow() != tab.Window) SetForegroundWindow(tab.Window);
            return Reply(true, "opened", null, null, tab);
        }
        if (action == "start" || action == "resume") ContinueWatching(tab);
        var player = InspectPlayer(tab);
        if (action == "status") return Reply(true, "ready", player, null, tab);
        if (action == "start") return Start(tab, player);
        if (player.Toggle == null) return Reply(false, "player_unavailable");
        if (action == "volume") return Volume(tab, player, command);
        if (action == "pause" || action == "resume") {
            bool playing = action == "resume";
            string outcome = playing ? "resumed" : "paused";
            if (!player.Playing.HasValue) return Reply(false, "control_unavailable");
            if (player.Playing.Value == playing) return Reply(true, outcome, player, null, tab);
            if (!Invoke(tab, player.Toggle, tab.Url)) return Reply(false, "control_unavailable");
            return Verify(tab, outcome, 2400, (url, current) => Equals(url, tab.Url) && current.Playing == playing);
        }
        if (action == "next" || action == "previous") {
            bool next = action == "next";
            if (!Invoke(tab, next ? player.Next : player.Previous, tab.Url)) return Reply(false, "control_unavailable");
            return Verify(tab, next ? "skipped" : "previous", 2800, (url, current) =>
                TrackId(url) != null && TrackId(tab.Url) != TrackId(url) ||
                !String.IsNullOrWhiteSpace(current.Track) && !String.Equals(player.Track, current.Track) ||
                !next && player.Position != null && player.Position != "0" && current.Position == "0");
        }
        return Reply(false, "control_unavailable");
    }

    [MTAThread]
    static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer { MaxJsonLength = 8192, RecursionLimit = 12 };
        object reply;
        try { reply = Execute(json.Deserialize<Dictionary<string, object>>(Console.ReadLine())); }
        catch (Exception) { reply = Reply(false, "control_unverified"); }
        Console.WriteLine(json.Serialize(reply));
    }
}
