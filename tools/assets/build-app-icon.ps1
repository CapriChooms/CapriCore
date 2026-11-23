param(
    [Alias('SourcePNG')][string]$Source,
    [string]$SourceSVG,
    [string]$OutputIcon,
    [string]$OutputPNG
)
# SPDX-License-Identifier: GPL-3.0-only
# Canonical brand SVG: line paths, translate and scale. Render every icon size
# directly from the vector with supersampling, without external dependencies.
$ErrorActionPreference='Stop'
$capriIconRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Add-Type -AssemblyName System.Drawing
if($Source -and $SourceSVG){throw 'Choose either -SourcePNG or -SourceSVG.'}
if(-not $OutputIcon){$OutputIcon=Join-Path $capriIconRoot 'assets/default/app.ico'}
if(-not $OutputPNG){$OutputPNG=Join-Path $capriIconRoot 'assets/default/icon-source.png'}
if(-not $Source -and -not $SourceSVG){$SourceSVG=Join-Path $capriIconRoot 'assets/default/brand/capricore.svg'}
if(-not ('Capri.BrandIconRasterizer' -as [type])){
    Add-Type -ReferencedAssemblies System.Drawing,System.Xml -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Xml;

namespace Capri {
    public static class BrandIconRasterizer {
        private const string Numeric = @"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?";
        private static readonly Regex Tokens = new Regex(@"[MmLlHhVvZz]|" + Numeric);
        private static float Number(string value) { return Single.Parse(value, CultureInfo.InvariantCulture); }
        private static float Next(List<string> tokens, ref int index) {
            if (index >= tokens.Count || Regex.IsMatch(tokens[index], @"^[A-Za-z]$"))
                throw new InvalidDataException("Incomplete SVG line path.");
            return Number(tokens[index++]);
        }
        private static GraphicsPath LinePath(string data) {
            if (!String.IsNullOrWhiteSpace(Tokens.Replace(data, "").Replace(",", "")))
                throw new InvalidDataException("The brand SVG supports only M/L/H/V/Z line paths.");
            var tokens = new List<string>();
            foreach (Match match in Tokens.Matches(data)) tokens.Add(match.Value);
            var path = new GraphicsPath(FillMode.Winding);
            float x = 0, y = 0, startX = 0, startY = 0;
            char command = '\0';
            int index = 0;
            try {
                while (index < tokens.Count) {
                    if (Regex.IsMatch(tokens[index], @"^[A-Za-z]$")) command = tokens[index++][0];
                    bool relative = Char.IsLower(command);
                    char operation = Char.ToUpperInvariant(command);
                    if (operation == 'Z') {
                        path.CloseFigure(); x = startX; y = startY; command = '\0'; continue;
                    }
                    float nextX = x, nextY = y;
                    if (operation == 'M' || operation == 'L') {
                        nextX = Next(tokens, ref index) + (relative ? x : 0);
                        nextY = Next(tokens, ref index) + (relative ? y : 0);
                    } else if (operation == 'H') nextX = Next(tokens, ref index) + (relative ? x : 0);
                    else if (operation == 'V') nextY = Next(tokens, ref index) + (relative ? y : 0);
                    else throw new InvalidDataException("Unsupported SVG path command.");
                    if (operation == 'M') {
                        path.StartFigure(); startX = nextX; startY = nextY;
                        command = relative ? 'l' : 'L';
                    } else path.AddLine(x, y, nextX, nextY);
                    x = nextX; y = nextY;
                }
                return path;
            } catch { path.Dispose(); throw; }
        }
        private static Matrix Transform(XmlElement element) {
            var ancestors = new List<XmlElement>();
            for (XmlNode node = element; node is XmlElement; node = node.ParentNode)
                ancestors.Add((XmlElement)node);
            ancestors.Reverse();
            float sx = 1, sy = 1, tx = 0, ty = 0;
            foreach (XmlElement ancestor in ancestors) {
                string value = ancestor.GetAttribute("transform");
                var functions = new Regex(@"(translate|scale)\s*\(([^)]*)\)");
                if (!String.IsNullOrWhiteSpace(functions.Replace(value, "")))
                    throw new InvalidDataException("Unsupported brand SVG transform.");
                foreach (Match function in functions.Matches(value)) {
                    string[] values = Regex.Split(function.Groups[2].Value.Trim(), @"[\s,]+");
                    if (values.Length < 1 || values.Length > 2) throw new InvalidDataException("Invalid SVG transform.");
                    float first = Number(values[0]);
                    float second = values.Length == 2 ? Number(values[1]) : function.Groups[1].Value == "scale" ? first : 0;
                    if (function.Groups[1].Value == "translate") { tx += sx * first; ty += sy * second; }
                    else { sx *= first; sy *= second; }
                }
            }
            return new Matrix(sx, 0, 0, sy, tx, ty);
        }
        public static Bitmap Resize(Image source, int size) {
            var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(bitmap)) {
                graphics.Clear(Color.Transparent);
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.DrawImage(source, new Rectangle(0, 0, size, size), 0, 0, source.Width, source.Height, GraphicsUnit.Pixel);
            }
            return bitmap;
        }
        public static Bitmap FromSvg(string file, int size) {
            var document = new XmlDocument { XmlResolver = null };
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null, MaxCharactersInDocument = 65536 };
            using (var reader = XmlReader.Create(file, settings)) document.Load(reader);
            var root = document.DocumentElement;
            if (root == null || root.LocalName != "svg" || root.GetAttribute("viewBox") != "0 0 64 64")
                throw new InvalidDataException("Expected the canonical 64x64 brand SVG.");
            int sampling = size <= 64 ? 8 : 4;
            using (var canvas = new Bitmap(size * sampling, size * sampling, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(canvas)) {
                graphics.Clear(Color.Transparent);
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.ScaleTransform(canvas.Width / 64f, canvas.Height / 64f);
                int paths = 0;
                foreach (XmlNode node in root.SelectNodes(".//*")) {
                    var element = node as XmlElement;
                    if (element == null || element.LocalName == "g" || element.LocalName == "title") continue;
                    if (element.LocalName != "path" || !Regex.IsMatch(element.GetAttribute("fill"), @"^#[0-9a-fA-F]{6}$"))
                        throw new InvalidDataException("Unsupported brand SVG element or fill.");
                    using (var path = LinePath(element.GetAttribute("d")))
                    using (var transform = Transform(element))
                    using (var brush = new SolidBrush(ColorTranslator.FromHtml(element.GetAttribute("fill")))) {
                        path.Transform(transform);
                        graphics.FillPath(brush, path);
                    }
                    ++paths;
                }
                if (paths == 0) throw new InvalidDataException("The brand SVG contains no paths.");
                return Resize(canvas, size);
            }
        }
    }
}
'@
}
$image=$null
$sizes=@(16,24,32,48,64,128,256)
$frames=@()
try {
    if($Source){$image=[Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))}
    else {
        $png=[Capri.BrandIconRasterizer]::FromSvg([IO.Path]::GetFullPath($SourceSVG),512)
        try {$png.Save([IO.Path]::GetFullPath($OutputPNG),[Drawing.Imaging.ImageFormat]::Png)}finally{$png.Dispose()}
    }
    foreach($size in $sizes){
        $bitmap=if($Source){[Capri.BrandIconRasterizer]::Resize($image,$size)}else{[Capri.BrandIconRasterizer]::FromSvg([IO.Path]::GetFullPath($SourceSVG),$size)}
        $memory=New-Object IO.MemoryStream
        try {
            $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
            $frames+=,@($size,$memory.ToArray())
        } finally {$memory.Dispose();$bitmap.Dispose()}
    }
    $stream=[IO.File]::Create([IO.Path]::GetFullPath($OutputIcon))
    $writer=New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([UInt16]0);$writer.Write([UInt16]1);$writer.Write([UInt16]$frames.Count)
        $offset=6+16*$frames.Count
        foreach($frame in $frames){
            $dimension=if($frame[0] -eq 256){0}else{$frame[0]}
            $writer.Write([byte]$dimension);$writer.Write([byte]$dimension)
            $writer.Write([UInt16]0);$writer.Write([UInt16]1);$writer.Write([UInt16]32)
            $writer.Write([UInt32]$frame[1].Length);$writer.Write([UInt32]$offset)
            $offset+=$frame[1].Length
        }
        foreach($frame in $frames){$writer.Write([byte[]]$frame[1])}
    } finally {$writer.Dispose();$stream.Dispose()}
} finally {if($image){$image.Dispose()}}
