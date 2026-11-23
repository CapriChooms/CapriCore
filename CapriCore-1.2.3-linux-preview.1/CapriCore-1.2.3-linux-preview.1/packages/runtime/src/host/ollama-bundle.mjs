// SPDX-License-Identifier: GPL-3.0-only
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

function ownedDirectory(directory, checked = new Map()) {
  const resolved = path.resolve(directory);
  if (checked.has(resolved)) return checked.get(resolved);
  let owned = false;
  try {
    const info = lstatSync(resolved),
      parent = path.dirname(resolved);
    owned =
      info.isDirectory() &&
      !info.isSymbolicLink() &&
      (parent === resolved || ownedDirectory(parent, checked));
  } catch {
    /* Missing or linked directories cannot supply managed runtime DLLs. */
  }
  checked.set(resolved, owned);
  return owned;
}
function ownedFile(file, checked) {
  if (!ownedDirectory(path.dirname(file), checked)) return false;
  try {
    const info = lstatSync(file);
    return info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size > 0;
  } catch {
    return false;
  }
}

// Required by the pinned Windows distribution, including CPU fallback. GPU DLLs
// are selected separately by Ollama; a surviving frontend is not a complete runtime.
export const OLLAMA_BACKEND_FILES = Object.freeze([
  'llama-server.exe',
  'libllama-server-impl.dll',
  'libllama-common.dll',
  'libllama.dll',
  'libmtmd.dll',
  'libllama-quantize-impl.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'libc++.dll',
  'libomp.dll',
  'libunwind.dll',
  'libwinpthread-1.dll',
  ...[
    'ggml-vulkan.dll',
    'concrt140.dll',
    'msvcp140.dll',
    'msvcp140_1.dll',
    'msvcp140_2.dll',
    'msvcp140_atomic_wait.dll',
    'msvcp140_codecvt_ids.dll',
    'vccorlib140.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'vcruntime140_threads.dll',
  ].map((name) => 'vulkan/' + name),
]);

export const OLLAMA_ROCM_DIRECTORY = 'rocm_v7_1';
export const OLLAMA_ROCM_FILES = Object.freeze([
  'amdhip64_7.dll',
  'amd_comgr0701.dll',
  'amd_comgr_3.dll',
  'ggml-hip.dll',
  'libhipblas.dll',
  'libhipblaslt.dll',
  'rocblas.dll',
  'concrt140.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
  'vccorlib140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'vcruntime140_threads.dll',
  'rocblas/library/TensileManifest.txt',
  ...['gfx1100', 'gfx1101', 'gfx1102'].map(
    (gfx) => `rocblas/library/TensileLibrary_lazy_${gfx}.dat`,
  ),
]);

/** Enumerates only regular owned backend files; installer receipts hash the full tree. */
export function inspectOllamaRocmBundle(executable, { requireFiles = true } = {}) {
  const base = path.dirname(executable);
  const folder = path.join(base, 'lib/ollama', OLLAMA_ROCM_DIRECTORY);
  const checked = new Map();
  if (!ownedDirectory(folder, checked)) {
    return { ready: false, missing: ['ROCm backend directory'], folder, files: [] };
  }
  const missing = requireFiles
    ? OLLAMA_ROCM_FILES.filter((name) => !ownedFile(path.join(folder, name), checked))
    : [];
  if (missing.length) return { ready: false, missing, folder, files: [] };
  const files = [];
  try {
    const walk = (directory) => {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Invalid backend directory');
      for (const name of readdirSync(directory)) {
        const file = path.join(directory, name),
          entry = lstatSync(file);
        if (entry.isSymbolicLink() || entry.nlink > 1) throw new Error('Invalid backend link');
        if (entry.isDirectory()) walk(file);
        // A structural check of the old tree must permit interrupted empty
        // files so Setup can replace them. Fresh/archive readiness stays strict.
        else if (entry.isFile() && (entry.size > 0 || !requireFiles))
          files.push(path.relative(folder, file).replaceAll('\\', '/'));
        else throw new Error('Invalid backend file');
      }
    };
    walk(folder);
    return { ready: true, missing: [], folder, files: files.sort() };
  } catch {
    return { ready: false, missing: ['ROCm backend files'], folder, files: [] };
  }
}
export function inspectOllamaBundle(executable, { bundled = false } = {}) {
  if (process.platform !== 'win32') return { ready: true, missing: [] };
  const base = path.dirname(executable);
  const folders = [
    path.join(base, 'lib/ollama'),
    ...(!bundled ? [path.join(base, '../lib/ollama')] : []),
  ];
  let missing = OLLAMA_BACKEND_FILES;
  const checked = new Map();
  for (const folder of folders) {
    const absent = OLLAMA_BACKEND_FILES.filter(
      (name) => !ownedFile(path.join(folder, name), checked),
    );
    if (!absent.length) return { ready: true, missing: [], folder };
    if (absent.length < missing.length) missing = absent;
  }
  return { ready: false, missing: [...missing] };
}
export function requireOllamaBundle(executable, options) {
  const report = inspectOllamaBundle(executable, options);
  if (!report.ready)
    throw Object.assign(
      new Error(
        `Ollama runtime files are missing or damaged (${report.missing.slice(0, 3).join(', ')}). Run Capri Setup and select this existing Capri folder to repair the runtime. Models and history are retained.`,
      ),
      { code: 'CAPRI_OLLAMA_BUNDLE_INCOMPLETE' },
    );
  return report;
}
