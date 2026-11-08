// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

// Embedded in both native launchers, including errors before their scripts are available.
internal static class CapriSetupLocale {
    private static readonly Dictionary<string,object> Catalog=Load();
    internal static string Language=Resolve(CultureInfo.CurrentUICulture.Name);
    internal static bool RightToLeft {
        get { return Language=="ar" || Language=="fa" || Language=="he" || Language=="ur"; }
    }
    private static Dictionary<string,object> Load() {
        try {
            using(Stream stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("CapriSetupTranslations"))
            using(StreamReader reader=new StreamReader(stream)) {
                string json=reader.ReadToEnd();
                if(json.Length>2*1024*1024)throw new InvalidDataException("Installer translations exceed their size limit.");
                return new JavaScriptSerializer {MaxJsonLength=2*1024*1024}.Deserialize<Dictionary<string,object>>(json);
            }
        } catch { return new Dictionary<string,object>(); }
    }
    internal static string Resolve(string culture) {
        string id=(culture??"").ToLowerInvariant().Split('-')[0];
        if(id=="fil")id="tl";
        if(id=="nb"||id=="nn")id="no";
        if(id=="iw")id="he";
        return Catalog.ContainsKey(id)?id:"en";
    }
    internal static bool Select(string language) {
        if(!Catalog.ContainsKey(language))return false;
        Language=language;return true;
    }
    internal static void SelectInstalled(string root) {
        try {
            string file=root;
            foreach(string part in new string[]{"data","desktop","languages.json"}) {
                file=Path.Combine(file,part);
                if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)return;
            }
            if(new FileInfo(file).Length>64*1024)return;
            var preferences=new JavaScriptSerializer{MaxJsonLength=64*1024}
                .Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
            object value,language;
            if(!preferences.TryGetValue("settings",out value))return;
            var settings=value as IDictionary<string,object>;
            if(settings!=null && settings.TryGetValue("interface",out language) && language is string)
                Select((string)language);
        } catch { /* Fall back to the Windows interface language. */ }
    }
    internal static string Text(string key, string fallback = null) {
        foreach(string id in new string[]{Language,"en"}) {
            object row,value;
            if(Catalog.TryGetValue(id,out row)) {
                IDictionary<string,object> text=row as IDictionary<string,object>;
                if(text!=null && text.TryGetValue(key,out value) && value is string)return (string)value;
            }
        }
        if(fallback!=null)return fallback;
        if(key=="title")return "Capri Setup";
        if(key=="technicalDetails")return "Technical details";
        return "Setup could not finish ("+key+").";
    }
}
