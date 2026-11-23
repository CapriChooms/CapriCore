// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import path from 'node:path';

const script = Buffer.from(
  String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
} | Select-Object -First 1
function Await-OcrOperation($operation, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}
$bytes = [IO.MemoryStream]::new()
[Console]::OpenStandardInput().CopyTo($bytes)
$stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
$writer = [Windows.Storage.Streams.DataWriter]::new($stream)
$writer.WriteBytes($bytes.ToArray())
$null = Await-OcrOperation ($writer.StoreAsync()) ([uint32])
$null = $writer.DetachStream()
$stream.Seek(0)
$decoder = Await-OcrOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await-OcrOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$preferred = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$languages = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages |
  Where-Object { $_.LanguageTag -match '^(?:en|ru)(?:-|$)' -and $_.LanguageTag -ne $preferred.RecognizerLanguage.LanguageTag } |
  Group-Object { $_.LanguageTag.Split('-')[0] } | ForEach-Object { $_.Group[0] }
$engines = @($preferred) + @($languages | ForEach-Object { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($_) })
$lines = @($engines | Where-Object { $_ } | ForEach-Object {
  $result = Await-OcrOperation ($_.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  foreach ($line in $result.Lines) {
    ,@($line.Words | ForEach-Object {
      $rect = $_.BoundingRect
      @{ text = $_.Text; x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }
    })
  }
})
[Console]::Write((ConvertTo-Json -InputObject $lines -Depth 4 -Compress))
`,
  'utf16le',
).toString('base64');

export async function readSteamScreenText(png, signal) {
  if (process.platform !== 'win32' || signal?.aborted) return [];
  const deadline = AbortSignal.timeout(5000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  return new Promise((resolve) => {
    const worker = spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script],
      { signal: combined, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let output = '';
    worker.stdout.setEncoding('utf8').on('data', (part) => {
      output += part;
      if (output.length > 512000) worker.kill();
    });
    worker.on('error', () => resolve([]));
    worker.stdin.on('error', () => {});
    worker.on('close', (code) => {
      try {
        const lines = code === 0 ? JSON.parse(output) : [];
        resolve(Array.isArray(lines) ? lines : []);
      } catch {
        resolve([]);
      }
    });
    worker.stdin.end(png);
  });
}

const wordKey = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

function nearGameWord(observed, wanted) {
  if (observed === wanted) return true;
  // In small Steam fonts OCR may misread several strokes in a long word.
  // Keep numerals and short words exact and require a shared word prefix.
  if (wanted.length < 8 || !/^\p{L}+$/u.test(wanted) || observed.slice(0, 4) !== wanted.slice(0, 4))
    return false;
  let distances = Array.from({ length: observed.length + 1 }, (_, i) => i);
  for (const [index, letter] of [...wanted].entries()) {
    const next = [index + 1];
    for (const [offset, seen] of [...observed].entries())
      next.push(
        Math.min(
          next[offset] + 1,
          distances[offset + 1] + 1,
          distances[offset] + Number(letter !== seen),
        ),
      );
    distances = next;
  }
  return distances.at(-1) <= Math.floor(wanted.length / 3);
}

export function steamTextPoint(lines, target, viewport) {
  const row = target.steamRole === 'game_row';
  const title = target.untrustedLabel ?? target.label;
  const wanted = String(title ?? '')
    .split(/\s+/u)
    .map(wordKey)
    .filter(Boolean);
  if (!wanted.length) return null;
  const points = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const words = line.filter((word) => wordKey(word.text));
    for (let i = 0; i <= words.length - wanted.length; i++) {
      const segment = words.slice(i, i + wanted.length);
      if (
        row &&
        (i + wanted.length !== words.length ||
          words.slice(0, i).some((word) => wordKey(word.text).length > 2))
      )
        continue;
      if (
        !segment.every((word, j) =>
          row ? nearGameWord(wordKey(word.text), wanted[j]) : wordKey(word.text) === wanted[j],
        )
      )
        continue;
      const { x, y, width, height } = segment[0];
      const point = { x: Math.floor(x + width / 2), y: Math.floor(y + height / 2) };
      const relativeX = (point.x - viewport.x) / viewport.width;
      const relativeY = (point.y - viewport.y) / viewport.height;
      if (relativeX < 0 || relativeX >= 1 || relativeY < 0 || relativeY >= 1) continue;
      if (row && (relativeX > 0.35 || relativeY < 0.09)) continue;
      if (target.steamRole === 'library' && relativeY > 0.12) continue;
      if (['play', 'install'].includes(target.steamRole) && (relativeX < 0.12 || relativeY < 0.09))
        continue;
      if (
        !points.some((other) => Math.abs(other.x - point.x) < 8 && Math.abs(other.y - point.y) < 5)
      )
        points.push(point);
    }
  }
  return points.length === 1 ? points[0] : null;
}
