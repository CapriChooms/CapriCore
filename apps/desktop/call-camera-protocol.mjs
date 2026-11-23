// SPDX-License-Identifier: GPL-3.0-only
export const CAMERA_WIDTH = 640;
export const CAMERA_HEIGHT = 360;
export const CAMERA_FRAME_BYTES = (CAMERA_WIDTH * CAMERA_HEIGHT * 3) / 2;
export const CAMERA_BACKGROUND_COLOR = '#0b151d';
export const CAMERA_BACKGROUND_IMAGE_BYTES = CAMERA_WIDTH * CAMERA_HEIGHT * 5;
export const cameraBackgroundColorValid = (value) =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export const CAMERA_RUNTIME_FOLDER = '.runtime/capri-camera';
export const CAMERA_LICENSE_FILE = 'THIRD-PARTY-LICENSES.txt';
export const CALL_CAMERA_FILES = Object.freeze([
  'capri-camera-host.exe',
  'capri-camera-x64.dll',
  'capri-camera-x86.dll',
]);
