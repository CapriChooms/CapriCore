import { execFile } from 'node:child_process';
import path from 'node:path';
import { screenshotDimensions } from './screenshot-files.mjs';

export function captureActiveDisplay(
  root,
  { signal, ownedWindow, displayWindow, withGeometry = false } = {},
) {
  if (ownedWindow !== undefined && !/^\d{1,20}$/.test(ownedWindow))
    throw new Error('Invalid owned verification window');
  if (displayWindow !== undefined && (ownedWindow || !/^[1-9]\d{0,18}$/.test(displayWindow)))
    throw new Error('Invalid display window');
  return new Promise((resolve, reject) => {
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'integrations/perception/native/capture-display.ps1'),
    ];
    if (ownedWindow) args.push('-OwnedWindow', ownedWindow);
    if (displayWindow) args.push('-DisplayWindow', displayWindow);
    if (withGeometry) args.push('-WithGeometry');
    execFile(
      'powershell.exe',
      args,
      { windowsHide: true, signal, timeout: 15000, maxBuffer: 96 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error('Windows could not capture the active display'));
          return;
        }
        try {
          let text = stdout.trim(),
            bounds;
          if (withGeometry) {
            const value = JSON.parse(text);
            if (!['x', 'y', 'width', 'height'].every((key) => Number.isInteger(value[key])))
              throw new Error('Invalid capture bounds');
            bounds = { x: value.x, y: value.y, width: value.width, height: value.height };
            text = value.png;
          }
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Invalid capture response');
          const png = Buffer.from(text, 'base64');
          const dimensions = screenshotDimensions(png);
          if (
            withGeometry &&
            (bounds.width !== dimensions.width || bounds.height !== dimensions.height)
          )
            throw new Error('Capture geometry differs from its image');
          resolve(withGeometry ? { png, bounds } : png);
        } catch {
          reject(new Error('Windows returned an invalid screenshot'));
        }
      },
    );
  });
}
