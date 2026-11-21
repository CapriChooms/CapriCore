// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Text.RegularExpressions;

namespace Capri.Spotify {
static class SpotifySearch {
    public static bool SearchName(string name) {
        return EqualsText(name, "What do you want to play?") || EqualsText(name, "O que você quer ouvir?") ||
            EqualsText(name, "Что хотите включить?") || EqualsText(name, "Что хочешь послушать?");
    }

    public static bool InputEligible(bool editableRole, bool enabled, bool offscreen, bool focusable, bool editableValue,
                                     bool withinSearch, string name) {
        return editableRole && enabled && !offscreen && focusable && editableValue && (withinSearch || SearchName(name));
    }

    public static bool EqualsText(string left, string right) {
        return String.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }

    public static bool FilterMatches(string link, string query, string kind) {
        Uri uri;
        if (!Uri.TryCreate(link, UriKind.Absolute, out uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo != "" ||
            !(uri.Host == "open.spotify.com" || uri.Host == "xpui.app.spotify.com")) return false;
        var route = Regex.Match(uri.AbsolutePath, @"^/(?:intl-[a-z-]+/)?search/([^/]+)/(tracks|albums|artists|playlists)/?$");
        return route.Success && EqualsText(Uri.UnescapeDataString(route.Groups[1].Value.Replace('+', ' ')), query) &&
            (kind == "any" || route.Groups[2].Value == kind + "s");
    }

    public static bool SongResultsName(string name, string query) {
        // Spotify's track grids usually include the query in the title. Some
        // versions instead expose only the generic label on the verified route.
        foreach (var prefix in new[]{"All songs for ", "Todas as músicas para ", "Все треки"}) {
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) &&
                name.IndexOf(query, prefix.Length, StringComparison.OrdinalIgnoreCase) >= 0) return true;
        }
        return EqualsText(name, "Songs search results") || EqualsText(name, "Resultados da busca de músicas") ||
            EqualsText(name, "Результаты поиска по трекам");
    }

    public static bool GenericPause(string name) {
        return EqualsText(name, "Pause") || EqualsText(name, "Pausar") || EqualsText(name, "Пауза");
    }

    public static bool Pausing(string name) {
        return GenericPause(name) || name.StartsWith("Pause ", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Pausar ", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Поставить на паузу ", StringComparison.OrdinalIgnoreCase);
    }

    public static bool MusicButton(string name) {
        return Pausing(name) || name.StartsWith("Play ", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Tocar ", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Воспроизвести ", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Включить трек «", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("Слушать плейлист «", StringComparison.OrdinalIgnoreCase);
    }

    public static string PlayLabel(string name) {
        if (name.StartsWith("Pause ", StringComparison.OrdinalIgnoreCase)) return "Play " + name.Substring(6);
        if (name.StartsWith("Pausar ", StringComparison.OrdinalIgnoreCase)) return "Tocar " + name.Substring(7);
        var track = Regex.Match(name, @"^Поставить на паузу то, что сейчас играет: «(.+)» \((.+)\)$", RegexOptions.IgnoreCase);
        if (track.Success) return "Включить трек «" + track.Groups[1].Value + "» исполнителя " + track.Groups[2].Value;
        const string playlist = "Поставить на паузу плейлист ";
        if (name.StartsWith(playlist, StringComparison.OrdinalIgnoreCase)) return "Слушать плейлист " + name.Substring(playlist.Length);
        return name;
    }

    public static bool TrackIdentity(string label, out string title, out string artist) {
        title = artist = "";
        var ru = Regex.Match(label, @"^Включить трек «(.+)» исполнителя (.+)$", RegexOptions.IgnoreCase);
        if (ru.Success) {
            title = ru.Groups[1].Value;
            artist = ru.Groups[2].Value.Split(',')[0];
            return true;
        }
        var pt = label.StartsWith("Tocar ", StringComparison.OrdinalIgnoreCase);
        if (!pt && !label.StartsWith("Play ", StringComparison.OrdinalIgnoreCase)) return false;
        var words = label.Substring(pt ? 6 : 5);
        var separator = words.LastIndexOf(pt ? " de " : " by ", StringComparison.Ordinal);
        if (separator <= 0) return false;
        title = words.Substring(0, separator);
        artist = words.Substring(separator + 4).Split(',')[0];
        return artist.Length > 0;
    }
}
}
