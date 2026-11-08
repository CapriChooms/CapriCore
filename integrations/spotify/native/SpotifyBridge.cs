// Local, Spotify-scoped Windows bridge. No browser cookies, tokens or global keys.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using Windows.Media;
using Windows.Media.Control;

namespace Capri.Spotify {
sealed class SpotifyException : Exception {
    public string Code;
    public SpotifyException(string code, string message) : base(message) { Code = code; }
}
static class Program {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    static GlobalSystemMediaTransportControlsSessionManager Manager;
    static async Task<T> Wait<T>(Windows.Foundation.IAsyncOperation<T> operation) {
        var deadline=DateTime.UtcNow.AddSeconds(12);
        while (operation.Status==Windows.Foundation.AsyncStatus.Started && DateTime.UtcNow<deadline) await Task.Delay(15);
        if (operation.Status==Windows.Foundation.AsyncStatus.Completed) return operation.GetResults();
        operation.Cancel(); throw new SpotifyException("media_timeout","Windows media controls did not respond.");
    }
    static readonly Dictionary<string, SearchItem> Results = new Dictionary<string, SearchItem>();
    sealed class SearchItem { public string Query, Kind, Label, Uri, Detail; public int[] RuntimeId; public DateTime Created; }
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);

    static Dictionary<string, object> D(params object[] pairs) {
        var value = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) value[(string)pairs[i]] = pairs[i+1];
        return value;
    }
    static string Text(Dictionary<string, object> value, string key, string fallback = "") {
        object item; return value.TryGetValue(key, out item) && item is string ? (string)item : fallback;
    }
    static double Number(Dictionary<string, object> value, string key, double min, double max) {
        object item;
        if (!value.TryGetValue(key, out item) || !(item is int || item is long || item is double || item is decimal))
            throw new SpotifyException("invalid_request", "A numeric " + key + " is required.");
        double result = Convert.ToDouble(item, CultureInfo.InvariantCulture);
        if (Double.IsNaN(result) || Double.IsInfinity(result) || result < min || result > max)
            throw new SpotifyException("invalid_request", key + " is out of range.");
        return result;
    }
    static bool Boolean(Dictionary<string, object> value, string key) {
        object item; if (!value.TryGetValue(key, out item) || !(item is bool)) throw new SpotifyException("invalid_request", "A boolean " + key + " is required.");
        return (bool)item;
    }
    static string Clean(string value, int limit = 240) { value = Regex.Replace(value ?? "", "[\\x00-\\x1f]", " ").Trim(); return value.Length > limit ? value.Substring(0, limit) : value; }
    static string Name(AutomationElement value) { try { return value.Current.Name ?? ""; } catch (ElementNotAvailableException) { return ""; } }
    static IEnumerable<AutomationElement> Elements(AutomationElement root, ControlType type = null) {
        if (root == null) return Enumerable.Empty<AutomationElement>();
        Condition condition = type == null ? Condition.TrueCondition : new PropertyCondition(AutomationElement.ControlTypeProperty, type);
        return root.FindAll(TreeScope.Descendants, condition).Cast<AutomationElement>().Take(3500);
    }
    static AutomationElement Find(AutomationElement root, Func<string, bool> predicate, ControlType type = null) {
        return Elements(root, type).FirstOrDefault(e => predicate(Name(e)));
    }
    static AutomationElement SearchField(AutomationElement root) {
        // Chromium can expose the same search input as either role. Never fall
        // back to an unrelated editable field, such as a browser address bar.
        foreach(var type in new[]{ControlType.ComboBox,ControlType.Edit}) {
            var field=Find(root,n=>Is(n,"What do you want to play?","Что хотите включить?"),type);
            if(field!=null && field.Current.IsEnabled)return field;
        }
        return null;
    }
    static async Task<AutomationElement> ReadySearchField() {
        // A restored Chromium window may publish its accessibility tree after
        // the first query. Retry discovery only; text entry happens once below.
        var timer=Stopwatch.StartNew();
        do {
            try { var field=SearchField(Root(true));if(field!=null)return field; }
            catch(ElementNotAvailableException) { }
            await Task.Delay(100);
        }while(timer.ElapsedMilliseconds<3000);
        throw new SpotifyException("search_unavailable","Spotify's search field is unavailable. Open its main window and close any dialog, then retry.");
    }
    static bool Is(string text, params string[] values) { return values.Any(v => String.Equals(text, v, StringComparison.OrdinalIgnoreCase)); }
    static bool MusicButton(string name){return name.StartsWith("Play ",StringComparison.OrdinalIgnoreCase)||name.StartsWith("Pause ",StringComparison.OrdinalIgnoreCase)||Is(name,"Pause")||name.StartsWith("Воспроизвести ",StringComparison.OrdinalIgnoreCase);}
    static string PlayLabel(string name){return name.StartsWith("Pause ",StringComparison.OrdinalIgnoreCase)?"Play "+name.Substring(6):name;}
    static Process SpotifyProcess() {
        var process = Process.GetProcessesByName("Spotify").FirstOrDefault(p => p.MainWindowHandle != IntPtr.Zero);
        if (process == null) throw new SpotifyException("spotify_closed", "Open Spotify and sign in before using music controls.");
        return process;
    }
    static AutomationElement Root(bool restore) {
        var process = SpotifyProcess();
        if (restore && IsIconic(process.MainWindowHandle)) ShowWindow(process.MainWindowHandle, 9);
        var root = AutomationElement.FromHandle(process.MainWindowHandle);
        if (root.Current.ProcessId != process.Id) throw new SpotifyException("target_changed", "The Spotify window changed. Try again.");
        return root;
    }
    static AutomationElement Player(bool restore = false) {
        var root = Root(restore);
        var player = Find(root, n => Is(n, "Now playing bar", "Панель воспроизведения", "Панель текущего трека"));
        if (player == null) throw new SpotifyException("player_not_ready", "Spotify's player controls are not accessible. Open its main window and close any dialog. Sign-in status could not be verified.");
        return player;
    }
    static AutomationElement MainContent() {
        var process=SpotifyProcess();var id=SpotifyAccessibility.MainId(process.MainWindowHandle);
        if(id==null)return null;
        return Elements(Root(true)).FirstOrDefault(e=>e.GetRuntimeId().SequenceEqual(id));
    }
    static void Invoke(AutomationElement element) {
        if (element == null || !element.Current.IsEnabled) throw new SpotifyException("control_unavailable", "This Spotify control is unavailable in the current state.");
        object pattern;
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); return; }
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return; }
        if (SpotifyAccessibility.InvokeDefault(element,SpotifyProcess().MainWindowHandle))return;
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return; }
        throw new SpotifyException("control_unavailable", "Spotify did not expose an accessible action for this control.");
    }
    static double SliderValue(AutomationElement element) {
        object pattern;
        if (element != null && element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) return ((RangeValuePattern)pattern).Current.Value;
        throw new SpotifyException("control_unavailable", "Spotify did not expose this slider.");
    }
    static string Link(AutomationElement element) {
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) { var value=((ValuePattern)pattern).Current.Value; if(!String.IsNullOrEmpty(value))return value; }
        var property = AutomationProperty.LookupById(30093); // LegacyIAccessible.Value
        if (property != null) { var value = element.GetCurrentPropertyValue(property, true) as string; if (!String.IsNullOrEmpty(value)) return value; }
        return SpotifyAccessibility.Link(element,SpotifyProcess().MainWindowHandle);
    }
    static string SpotifyUri(string value) {
        if (Regex.IsMatch(value ?? "", "^spotify:(track|album|artist|playlist):[A-Za-z0-9]{22}$")) return value;
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != "https" || !(uri.Host == "open.spotify.com" || uri.Host == "xpui.app.spotify.com")) return "";
        var match = Regex.Match(uri.AbsolutePath, "^/(?:intl-[a-z-]+/)?(track|album|artist|playlist)/([A-Za-z0-9]{22})/?$");
        return match.Success ? "spotify:" + match.Groups[1].Value + ":" + match.Groups[2].Value : "";
    }
    static void OpenUri(string uri) {
        if (!(SpotifyUri(uri) != "" || uri == "spotify:collection:tracks"))
            throw new SpotifyException("invalid_request", "Only Spotify music links are supported.");
        Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    }
    static async Task<GlobalSystemMediaTransportControlsSession> Session() {
        try {
            if (Manager == null) Manager = await Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
            return Manager.GetSessions().FirstOrDefault(s => s.SourceAppUserModelId.IndexOf("spotify", StringComparison.OrdinalIgnoreCase) >= 0);
        } catch (Exception) { Manager=null; return null; }
    }
    static async Task<Dictionary<string, object>> Status() {
        var state = D("running", Process.GetProcessesByName("Spotify").Length > 0, "provider", "windows-desktop");
        var session = await Session();
        if (session != null) {
            var media = await Wait(session.TryGetMediaPropertiesAsync()); var info = session.GetPlaybackInfo(); var timeline = session.GetTimelineProperties();
            state["title"] = Clean(media.Title); state["artist"] = Clean(media.Artist); state["album"] = Clean(media.AlbumTitle);
            state["playing"] = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            state["positionMs"] = (long)timeline.Position.TotalMilliseconds; state["durationMs"] = (long)timeline.EndTime.TotalMilliseconds;
            state["shuffle"] = info.IsShuffleActive; state["repeat"] = info.AutoRepeatMode.ToString().ToLowerInvariant();
            state["canSeek"] = info.Controls.IsPlaybackPositionEnabled; state["source"] = "windows-media-session";
        }
        try {
            var player = Player(); var volume = Find(player, n => Is(n, "Change volume", "Изменить громкость", "Громкость"), ControlType.Slider);
            if (volume != null) state["volumePercent"] = (int)Math.Round(SliderValue(volume) * 100);
            state["muted"] = Find(player, n => Is(n,"Unmute","Включить звук"),ControlType.Button) != null;
            // The UI commits playback changes before Windows refreshes SMTC
            // metadata. Prefer the live footer when it is accessible.
            var pause=Find(player,n=>Is(n,"Pause","Пауза"),ControlType.Button);
            var play=Find(player,n=>Is(n,"Play","Воспроизвести"),ControlType.Button);
            if(pause!=null || play!=null)state["playing"]=pause!=null;
            var now=Find(player,n=>n.StartsWith("Now playing:",StringComparison.OrdinalIgnoreCase));
            if(now!=null){var match=Regex.Match(Name(now),"^Now playing: (.+) by (.+)$");if(match.Success){state["title"]=Clean(match.Groups[1].Value);state["artist"]=Clean(match.Groups[2].Value);}}
            if (session == null) {
                state["playing"] = Find(player, n => Is(n,"Pause","Пауза"),ControlType.Button) != null;
                var current = Find(player, n => n.StartsWith("Now playing:",StringComparison.OrdinalIgnoreCase));
                if (current != null) state["description"] = Clean(Name(current));
                state["source"] = "spotify-accessibility";
            }
        } catch (Exception) { /* Media-session reads still work while the UI is unavailable. */ }
        try { foreach(var item in SpotifyAudio.Read())state[item.Key]=item.Value; }catch(Exception){state["volumeAvailable"]=false;}
        return state;
    }
    static async Task Require(bool accepted) { if (!accepted) throw new SpotifyException("spotify_rejected", "Spotify did not accept this command; it may be unavailable during an advert or on this device."); await Task.Delay(250); }
    static async Task<Dictionary<string, object>> Transport(string action) {
        var before=await Status();
        AutomationElement player=null;
        try{player=Player(true);}catch(SpotifyException){}
        if(player!=null) {
            if(action=="resume" && before.ContainsKey("playing") && (bool)before["playing"])return before;
            if(action=="pause" && before.ContainsKey("playing") && !(bool)before["playing"])return before;
            var names=action=="resume"?new[]{"Play","Воспроизвести"}:action=="pause"?new[]{"Pause","Пауза"}:
                action=="next"?new[]{"Next","Следующий"}:action=="previous"?new[]{"Previous","Предыдущий"}:new[]{"Play","Pause","Воспроизвести","Пауза"};
            Invoke(Find(player,n=>Is(n,names),ControlType.Button));await Task.Delay(200);
        }else{
            var session=await Session();
            if(session==null)throw new SpotifyException("player_not_ready","Spotify has not exposed a Windows playback session. Open the player and start a track once, then retry. Sign-in status could not be verified.");
            bool accepted = action == "resume" ? await Wait(session.TryPlayAsync()) : action == "pause" ? await Wait(session.TryPauseAsync()) :
                action == "next" ? await Wait(session.TrySkipNextAsync()) : action == "previous" ? await Wait(session.TrySkipPreviousAsync()) : await Wait(session.TryTogglePlayPauseAsync());
            await Require(accepted);
        }
        var timer=Stopwatch.StartNew();Dictionary<string,object> result;
        do {
            result=await Status();bool playing=result.ContainsKey("playing") && (bool)result["playing"];
            if(action=="pause" && !playing || action=="resume" && playing || action=="toggle" && playing!=((bool)before["playing"]) ||
                (action=="next" || action=="previous") && (Text(result,"title")!=Text(before,"title") || Text(result,"artist")!=Text(before,"artist") || Convert.ToInt64(result["positionMs"])<Convert.ToInt64(before["positionMs"])))return result;
            await Task.Delay(150);
        }while(timer.ElapsedMilliseconds<3500);
        throw new SpotifyException("not_verified","Spotify did not confirm the playback change. Check the player before retrying.");
    }
    static async Task<List<Dictionary<string, object>>> Search(string query, string kind) {
        if (query.Length < 1 || query.Length > 180 || Regex.IsMatch(query,"[\\x00-\\x1f]")) throw new SpotifyException("invalid_request","Use a short song, artist, album or playlist name.");
        if (!new[]{"track","album","artist","playlist","any"}.Contains(kind)) throw new SpotifyException("invalid_request","Unknown search type.");
        var root=Root(true);
        var searchField=await ReadySearchField();
        SpotifyAccessibility.EnterSearch(searchField,SpotifyProcess().MainWindowHandle,query);
        await Task.Delay(650);
        AutomationElement main = null;
        bool ready=false;
        var timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < 8000) {
            await Task.Delay(300);
            main = MainContent();
            root = Root(true);
            var field=SearchField(root);
            object valuePattern;
            bool queryMatches=field!=null && field.TryGetCurrentPattern(ValuePattern.Pattern,out valuePattern) && String.Equals(((ValuePattern)valuePattern).Current.Value.Replace('+',' '),query.Replace('+',' '),StringComparison.OrdinalIgnoreCase);
            var currentFilter=main==null?null:Find(main,n=>Is(n,"Songs","Треки"),ControlType.Hyperlink);
            var filterLink=currentFilter==null?"":Link(currentFilter);
            bool routeMatches=false;Uri route;
            if(Uri.TryCreate(filterLink,UriKind.Absolute,out route)){
                var parts=route.AbsolutePath.Split('/');
                if(parts.Length>2 && parts[1]=="search")routeMatches=String.Equals(Uri.UnescapeDataString(parts[2]).Replace('+',' '),query.Replace('+',' '),StringComparison.OrdinalIgnoreCase);
            }
            if (queryMatches && routeMatches && main != null && Find(main,MusicButton,ControlType.Button)!=null) {ready=true;break;}
        }
        if (!ready) throw new SpotifyException("search_unavailable","Spotify search did not open. Check its connection and sign-in.");
        var filters = kind == "track" ? new[]{"Songs","Треки"} : kind == "album" ? new[]{"Albums","Альбомы"} : kind == "artist" ? new[]{"Artists","Исполнители"} : kind == "playlist" ? new[]{"Playlists","Плейлисты"} : new string[0];
        var filter = Find(main,n=>Is(n,filters),ControlType.Hyperlink);
        if (filter != null) { Invoke(filter); await Task.Delay(650); }
        if(kind=="track") {
            AutomationElement songs=null; var gridTimer=Stopwatch.StartNew();
            while(gridTimer.ElapsedMilliseconds<5000) {
                songs=Find(Root(true),n=>(n.StartsWith("All songs",StringComparison.OrdinalIgnoreCase) || n.StartsWith("Все треки",StringComparison.OrdinalIgnoreCase)) && n.Replace('+',' ').IndexOf(query.Replace('+',' '),StringComparison.OrdinalIgnoreCase)>=0,ControlType.DataGrid);
                if(songs!=null)break;
                await Task.Delay(200);
            }
            if(songs==null)throw new SpotifyException("search_unavailable","Spotify's song-results grid did not open.");
            main=songs;
        } else {
            main=MainContent() ?? main;
        }
        var result = new List<Dictionary<string,object>>(); var seen = new HashSet<string>();
        var candidates = Elements(main,ControlType.Button).Where(e=>MusicButton(Name(e))).ToList();
        var playing=candidates.Any(e=>Is(Name(e),"Pause"))?await Status():null;
        foreach (var button in candidates) {
            var label = PlayLabel(Name(button)); var row = ResultContainer(button);
            if(Is(label,"Pause") && playing!=null && Text(playing,"title")!="")label="Play "+Text(playing,"title")+" by "+Text(playing,"artist");
            var uris = row == null ? new string[0] : Elements(row,ControlType.Hyperlink).Select(e=>SpotifyUri(Link(e))).Where(u=>u!="").ToArray();
            var uri=uris.FirstOrDefault(u=>kind=="any" || u.StartsWith("spotify:"+kind+":",StringComparison.Ordinal)) ?? "";
            // Never use a stale sidebar play button from the user's library as a search result.
            if (row != null && AncestorNamed(row,"Your Library","Медиатека","Now playing bar","Панель воспроизведения")) continue;
            var detail = row == null ? label : Name(row);
            if (detail.Length < label.Length && row!=null) detail=String.Join(" • ",Elements(row).Select(Name).Where(n=>n!="" && !n.StartsWith("Play ",StringComparison.OrdinalIgnoreCase)).Distinct().Take(10));
            if(detail.Length<label.Length)detail=label;
            var unique = uri != "" ? uri : detail;
            if (!seen.Add(unique)) continue;
            var id=Guid.NewGuid().ToString("N").Substring(0,16);
            Results[id]=new SearchItem { Query=query,Kind=kind,Label=label,Detail=detail,Uri=uri,RuntimeId=button.GetRuntimeId(),Created=DateTime.UtcNow };
            result.Add(D("resultId",id,"label",Clean(label),"detail",Clean(detail,480),"uri",uri,"type",kind));
            if (result.Count>=8) break;
        }
        foreach (var key in Results.Where(p=>DateTime.UtcNow-p.Value.Created>TimeSpan.FromMinutes(10)).Select(p=>p.Key).ToList()) Results.Remove(key);
        if (result.Count==0) throw new SpotifyException("no_results","No playable Spotify result was found. Try the title together with the artist.");
        return result;
    }
    static AutomationElement ResultContainer(AutomationElement button) {
        var element=TreeWalker.ControlViewWalker.GetParent(button); AutomationElement best=element;
        for(int i=0;i<8 && element!=null;i++,element=TreeWalker.ControlViewWalker.GetParent(element)) {
            if(element.Current.ControlType==ControlType.Window || element.Current.ControlType==ControlType.Document || Name(element).StartsWith("Spotify",StringComparison.OrdinalIgnoreCase)) break;
            int plays=Elements(element,ControlType.Button).Count(e=>MusicButton(Name(e)));
            if(plays>1)break;
            if(Elements(element,ControlType.Hyperlink).Any())best=element;
        }
        return best;
    }
    static bool AncestorNamed(AutomationElement element,params string[] names) {
        for (int i=0;i<12 && element!=null;i++,element=TreeWalker.ControlViewWalker.GetParent(element)) if (Is(Name(element),names)) return true;
        return false;
    }
    static async Task PlayResult(string id) {
        SearchItem item;
        if(!Results.TryGetValue(id,out item) || DateTime.UtcNow-item.Created>TimeSpan.FromMinutes(10))throw new SpotifyException("stale_result","Search again before using this result.");
        string title="",artist="";
        if(item.Kind=="track") {
            var label=item.Label.StartsWith("Play ",StringComparison.OrdinalIgnoreCase)?item.Label.Substring(5):"";
            int separator=label.LastIndexOf(" by ",StringComparison.Ordinal);
            if(separator>0){title=label.Substring(0,separator);artist=label.Substring(separator+4).Split(',')[0];}
        }
        if(title!="" && artist!="") {
            var current=await Status();
            if(current.ContainsKey("playing") && (bool)current["playing"] && Comparable(Text(current,"title"))==Comparable(title) && Comparable(Text(current,"artist")).Contains(Comparable(artist)) && Text(current,"album")!="" && Comparable(item.Detail).Contains(Comparable(Text(current,"album"))))return;
        }
        Invoke(await ResultButton(id));
        await VerifyPlaying(title,artist);
    }
    static string Comparable(string text) { return Regex.Replace(text??"","[^\\p{L}\\p{N}]","").ToLowerInvariant(); }
    static async Task VerifyPlaying(string title="",string artist="") {
        var timer=Stopwatch.StartNew();
        while(timer.ElapsedMilliseconds<6000) {
            await Task.Delay(300);var state=await Status();object playing;
            if(state.TryGetValue("playing",out playing) && playing is bool && (bool)playing &&
                (title=="" || Comparable(Text(state,"title"))==Comparable(title)) &&
                (artist=="" || Comparable(Text(state,"artist")).Contains(Comparable(artist))))return;
        }
        throw new SpotifyException("not_verified","Spotify did not start the selected music. Check for an advert or a client/account restriction before retrying.");
    }
    static async Task<AutomationElement> ResultButton(string id) {
        SearchItem item;
        if (!Results.TryGetValue(id,out item) || DateTime.UtcNow-item.Created>TimeSpan.FromMinutes(10)) throw new SpotifyException("stale_result","Search again before using this result.");
        var button=Elements(Root(true),ControlType.Button).FirstOrDefault(e=>e.GetRuntimeId().SequenceEqual(item.RuntimeId) && (PlayLabel(Name(e))==item.Label || Is(Name(e),"Pause")));
        if (button!=null) return button;
        var refreshed=await Search(item.Query,item.Kind);
        var match=refreshed.Select(r=>Results[(string)r["resultId"]]).FirstOrDefault(r=>item.Uri!=""?r.Uri==item.Uri:r.Label==item.Label && r.Detail==item.Detail);
        if (match==null) throw new SpotifyException("stale_result","Spotify search results changed. Search again before selecting one.");
        return Elements(Root(true),ControlType.Button).FirstOrDefault(e=>e.GetRuntimeId().SequenceEqual(match.RuntimeId) && (PlayLabel(Name(e))==match.Label || Is(Name(e),"Pause")));
    }
    static async Task<object> Execute(Dictionary<string,object> request) {
        string action=Text(request,"action");
        if (action=="status") return await Status();
        if (new[]{"resume","pause","toggle","next","previous"}.Contains(action)) return await Transport(action);
        if (action=="volume") {
            var current=SpotifyAudio.Read();
            if(!current.ContainsKey("volumePercent"))throw new SpotifyException("audio_session_unavailable","Play a song in Spotify once before changing its application volume.");
            double target=request.ContainsKey("delta")?Math.Max(0,Math.Min(1,Convert.ToDouble(current["volumePercent"])/100+Number(request,"delta",-100,100)/100)):Number(request,"value",0,100)/100;
            SpotifyAudio.Set(target,null); await Task.Delay(80);
            var changed=SpotifyAudio.Read();
            if(!changed.ContainsKey("volumePercent") || Math.Abs(Convert.ToDouble(changed["volumePercent"])-target*100)>1.5)throw new SpotifyException("not_verified","Spotify application volume did not reach the requested level.");
            return await Status();
        }
        if (action=="mute") {
            SpotifyAudio.Set(null,Boolean(request,"enabled")); await Task.Delay(80); return await Status();
        }
        if (action=="seek") {
            double position=Number(request,"seconds",0,86400); var session=await Session();
            if (session!=null) { if (!session.GetPlaybackInfo().Controls.IsPlaybackPositionEnabled) throw new SpotifyException("unsupported","Spotify disabled seeking for this item."); await Require(await Wait(session.TryChangePlaybackPositionAsync(TimeSpan.FromSeconds(position).Ticks))); }
            else throw new SpotifyException("unsupported","Spotify's Windows media session must be available for seeking.");
            var state=await Status();
            if(!state.ContainsKey("positionMs") || Math.Abs(Convert.ToDouble(state["positionMs"])-position*1000)>2000)throw new SpotifyException("not_verified","Spotify did not confirm the requested playback position.");
            return state;
        }
        if (action=="shuffle") {
            bool enabled=Boolean(request,"enabled"); var session=await Session();
            if (session!=null && session.GetPlaybackInfo().Controls.IsShuffleEnabled) await Require(await Wait(session.TryChangeShuffleActiveAsync(enabled)));
            else { var button=Find(Player(true),n=>n.IndexOf("Shuffle",StringComparison.OrdinalIgnoreCase)>=0 || n.IndexOf("Перемеш",StringComparison.OrdinalIgnoreCase)>=0,ControlType.Button);
                var name=Name(button); bool active=name.StartsWith("Disable",StringComparison.OrdinalIgnoreCase) || name.StartsWith("Выключ",StringComparison.OrdinalIgnoreCase);
                if (active!=enabled) Invoke(button); }
            var state=await Status();
            if(!state.ContainsKey("shuffle") || !Object.Equals(state["shuffle"],enabled))throw new SpotifyException("not_verified","Spotify did not confirm the shuffle setting.");
            return state;
        }
        if (action=="repeat") {
            var mode=Text(request,"mode"); var session=await Session();
            if (!new[]{"off","context","track"}.Contains(mode)) throw new SpotifyException("invalid_request","Repeat mode must be off, context or track.");
            if (session!=null && session.GetPlaybackInfo().Controls.IsRepeatEnabled)
                await Require(await Wait(session.TryChangeAutoRepeatModeAsync(mode=="off"?MediaPlaybackAutoRepeatMode.None:mode=="track"?MediaPlaybackAutoRepeatMode.Track:MediaPlaybackAutoRepeatMode.List)));
            else {
                bool reached=false;
                for (int i=0;i<4;i++) {
                    var control=Find(Player(true),n=>n.IndexOf("repeat",StringComparison.OrdinalIgnoreCase)>=0 || n.IndexOf("повтор",StringComparison.OrdinalIgnoreCase)>=0);
                    object pattern;
                    if (control==null || !control.TryGetCurrentPattern(TogglePattern.Pattern,out pattern)) break;
                    var state=((TogglePattern)pattern).Current.ToggleState;
                    string current=state==ToggleState.Off?"off":state==ToggleState.Indeterminate?"track":"context";
                    if (current==mode) { reached=true; break; }
                    ((TogglePattern)pattern).Toggle(); await Task.Delay(150);
                }
                if (!reached) throw new SpotifyException("unsupported","Spotify did not expose the requested repeat mode.");
            }
            var verified=await Status();var expected=mode=="off"?"none":mode=="context"?"list":"track";
            if(Text(verified,"repeat")!=expected)throw new SpotifyException("not_verified","Spotify did not confirm the repeat setting.");
            return verified;
        }
        if (action=="search") return D("results",await Search(Text(request,"query"),Text(request,"type","track")));
        if (action=="play") {
            var uri=Text(request,"uri"); var id=Text(request,"resultId"); var query=Text(request,"query");
            if (uri!="") {
                uri=SpotifyUri(uri);var title=Text(request,"resourceTitle");
                if (uri=="" || title=="" || title.Length>500) throw new SpotifyException("invalid_request","Spotify link metadata is missing. Use the song title and artist instead.");
                OpenUri(uri);await Task.Delay(900);var timer=Stopwatch.StartNew();AutomationElement play=null;
                bool track=uri.StartsWith("spotify:track:",StringComparison.Ordinal);
                while(timer.ElapsedMilliseconds<6000) {
                    // Desktop versions may autoplay a track URI. Verify its
                    // actual title before looking for a Play button (now Pause).
                    if(track){var current=await Status();if(current.ContainsKey("playing") && (bool)current["playing"] && Comparable(Text(current,"title"))==Comparable(title))return current;}
                    var main=MainContent();
                    if(track)play=Find(main,n=>n.StartsWith("Play "+title+" by ",StringComparison.OrdinalIgnoreCase),ControlType.Button);
                    else if(main!=null && Elements(main).Any(e=>String.Equals(Name(e),title,StringComparison.OrdinalIgnoreCase)))
                        play=Find(main,n=>Is(n,"Play","Play "+title,"Воспроизвести"),ControlType.Button);
                    if(play!=null)break;await Task.Delay(200);
                }
                if(play==null)throw new SpotifyException("not_verified","Spotify opened the link but its matching play control was unavailable. Request the title and artist instead.");
                string artist="";var label=Name(play);int separator=label.LastIndexOf(" by ",StringComparison.Ordinal);if(track && separator>0)artist=label.Substring(separator+4).Split(',')[0];
                Invoke(play);await VerifyPlaying(track?title:"",artist);
            }
            else { if (id=="") { var matches=await Search(query,Text(request,"type","track")); id=(string)matches[0]["resultId"]; } await PlayResult(id); }
            return await Status();
        }
        if (action=="liked_songs") { OpenUri("spotify:collection:tracks"); await Task.Delay(700); Invoke(Find(Root(true),n=>Is(n,"Play Liked Songs","Воспроизвести Любимые треки"),ControlType.Button)); await VerifyPlaying(); return await Status(); }
        if (action=="queue") {
            var panel=Elements(Root(true)).FirstOrDefault(e=>e.Current.AutomationId=="queue-panel");
            if(panel==null){Invoke(Find(Player(true),n=>Is(n,"Queue","Очередь")));await Task.Delay(400);panel=Elements(Root(true)).FirstOrDefault(e=>e.Current.AutomationId=="queue-panel");}
            if (panel==null) throw new SpotifyException("control_unavailable","Spotify's queue panel did not open.");
            return D("items",Elements(panel,ControlType.Button).Where(e=>!AncestorNamed(e,"Now playing","Сейчас играет")).Select(Name).Where(n=>n.StartsWith("Play ",StringComparison.OrdinalIgnoreCase) || n.StartsWith("Воспроизвести ",StringComparison.OrdinalIgnoreCase)).Select(n=>Clean(n,400)).Take(40).ToArray(),"visibleSlice",true);
        }
        if (action=="queue_add") {
            var id=Text(request,"resultId");
            if (id=="") { var matches=await Search(Text(request,"query"),"track"); id=(string)matches[0]["resultId"]; }
            var button=await ResultButton(id); var row=ResultContainer(button);
            if (row==null) throw new SpotifyException("control_unavailable","Spotify did not expose this search-result row.");
            var options=Find(row,n=>n.StartsWith("More options",StringComparison.OrdinalIgnoreCase) || n.StartsWith("Другие параметры",StringComparison.OrdinalIgnoreCase),ControlType.Button);
            if(options==null)throw new SpotifyException("queue_options_unavailable","Spotify did not expose this song's options button.");
            using(var focus=SpotifyAccessibility.Foreground(options,SpotifyProcess().MainWindowHandle)){
            SpotifyAccessibility.Click(options,SpotifyProcess().MainWindowHandle);AutomationElement add=null;var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<1200){await Task.Delay(100);add=Elements(Root(true)).FirstOrDefault(e=>Is(Name(e),"Add to queue","Добавить в очередь") && (e.Current.ControlType==ControlType.Button || e.Current.ControlType==ControlType.MenuItem));if(add!=null)break;}
            if(add==null)throw new SpotifyException("queue_menu_unavailable","Spotify did not open its Add to queue menu.");
            SpotifyAccessibility.Click(add,SpotifyProcess().MainWindowHandle);
            }
            return D("queued",true,"label",Results[id].Label,"confirmation","Spotify accepted the Add to queue menu action.");
        }
        if (action=="library") {
            var library=Find(Root(true),n=>Is(n,"Your Library","Медиатека"),ControlType.DataGrid);
            if (library==null) throw new SpotifyException("control_unavailable","Expand Spotify's library sidebar first.");
            return D("items",Elements(library,ControlType.DataItem).Select(e=>Clean(Name(e))).Where(n=>n!="").Distinct().Take(80).ToArray(),"visibleSlice",true);
        }
        throw new SpotifyException("invalid_request","Unknown Spotify action.");
    }
    [MTAThread] public static void Main(string[] args) {
        Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
        Console.WriteLine(Json.Serialize(D("type","ready","protocol",1)));
        while (true) {
            var line=Console.ReadLine(); if (line==null) return;
            if (line.Length>16384) return;
            object id=null;
            try {
                var request=Json.Deserialize<Dictionary<string,object>>(line); request.TryGetValue("request",out id);
                var result=Execute(request).GetAwaiter().GetResult();
                Console.WriteLine(Json.Serialize(D("type","result","request",id,"ok",true,"data",result)));
            } catch (SpotifyException error) { Console.WriteLine(Json.Serialize(D("type","result","request",id,"ok",false,"error",D("code",error.Code,"message",error.Message)))); }
            catch (Exception) { Console.WriteLine(Json.Serialize(D("type","result","request",id,"ok",false,"error",D("code","windows_bridge_error","message","The Spotify Windows control could not complete. Check the app and retry the command yourself.")))); }
        }
    }
}
}
