import { availableParallelism, totalmem, freemem, cpus, platform, arch, release } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { findExecutable, root } from '../host/paths.mjs';
const run = promisify(execFile);
const probeOptions = { windowsHide: true, timeout: 5000, maxBuffer: 65536, encoding: 'utf8' };
const inventoryFile = path.join(root, 'packages/installer/windows/gpu-inventory.ps1');
const softwareAdapter =
  /\b(?:software|microsoft basic render|microsoft remote display|remote display adapter)\b/i;
const memoryMiB = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
const gpuName = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  !softwareAdapter.test(value)
    ? value.trim()
    : null;
const vendorOf = (value, name) =>
  ['nvidia', 'amd', 'intel'].includes(value)
    ? value
    : /nvidia/i.test(name)
      ? 'nvidia'
      : /amd|radeon/i.test(name)
        ? 'amd'
        : /intel/i.test(name)
          ? 'intel'
          : 'unknown';
const luidOf = (value) => {
  const match = typeof value === 'string' && /^0x([0-9a-f]{8})_0x([0-9a-f]{8})$/i.exec(value);
  return match ? `0x${match[1].toUpperCase()}_0x${match[2].toUpperCase()}` : null;
};
const freeMemoryMiB = (value, total) =>
  total !== null &&
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= total
    ? value
    : null;
function windowsAdapter(value) {
  if (!value || typeof value !== 'object' || value.software === true || value.remote === true)
    return null;
  const name = gpuName(value.name);
  if (!name) return null;
  const vramMiB = memoryMiB(value.vramMiB);
  const memoryKind =
    vramMiB !== null && ['dedicated', 'shared'].includes(value.memoryKind)
      ? value.memoryKind
      : 'unknown';
  const luid = luidOf(value.luid);
  return {
    name,
    vendor: vendorOf(value.vendor, name),
    vramMiB,
    memoryKind,
    luid,
    freeVramMiB:
      memoryKind === 'dedicated' && luid ? freeMemoryMiB(value.freeVramMiB, vramMiB) : null,
    cudaCandidate: false,
  };
}
/** Only a successful DXGI envelope can establish capacity; a valid empty list is authoritative. */
export function parseWindowsGpuInventory(text) {
  const value = JSON.parse(typeof text === 'string' ? text.replace(/^\uFEFF/, '').trim() : '');
  if (value?.success !== true || !Array.isArray(value.adapters) || value.adapters.length > 64)
    throw new Error('Windows dedicated GPU inventory unavailable');
  const adapters = value.adapters.map(windowsAdapter).filter(Boolean);
  return adapters.filter(
    (gpu, index) => !gpu.luid || adapters.findIndex((item) => item.luid === gpu.luid) === index,
  );
}
export function parseNvidia(text) {
  if (typeof text !== 'string') return [];
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const fields = line.split(',').map((x) => x.trim()),
        driver = fields.pop(),
        memory = memoryMiB(Number(fields.pop())),
        name = gpuName(fields.join(', '));
      return name && memory !== null
        ? [
            {
              name,
              vendor: 'nvidia',
              vramMiB: memory,
              memoryKind: 'dedicated',
              driver,
              cudaCandidate: true,
            },
          ]
        : [];
    });
}
const nameKey = (name) =>
  name
    .replace(/[®™]/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^nvidia\s+/i, '')
    .toLowerCase();
/** Keep each physical adapter separate; NVIDIA's driver-reported total takes precedence. */
export function mergeGpuInventory(windows, nvidia) {
  const remaining = [...windows];
  const drivers = [...nvidia];
  const merged = [];
  const join = (gpu, native) => ({
    ...native,
    ...gpu,
    ...(native?.luid || luidOf(gpu.luid) ? { luid: native?.luid ?? luidOf(gpu.luid) } : {}),
    freeVramMiB: freeMemoryMiB(gpu.freeVramMiB ?? native?.freeVramMiB, gpu.vramMiB),
  });
  const take = (gpu, native) => {
    merged.push(join(gpu, native));
    drivers.splice(drivers.indexOf(gpu), 1);
    remaining.splice(remaining.indexOf(native), 1);
  };
  // Driver order and DXGI order need not agree, even for the same model name.
  for (const gpu of [...drivers]) {
    const luid = luidOf(gpu.luid);
    const native = luid && remaining.find((item) => item.vendor === 'nvidia' && item.luid === luid);
    if (native) take(gpu, native);
  }
  const compatible = (gpu, native) =>
    native.vendor === 'nvidia' &&
    !(luidOf(gpu.luid) && native.luid && luidOf(gpu.luid) !== native.luid) &&
    nameKey(native.name) === nameKey(gpu.name) &&
    (memoryMiB(native.vramMiB) === null || Math.abs(native.vramMiB - gpu.vramMiB) <= 128);
  const distance = (gpu, native) =>
    memoryMiB(native.vramMiB) === null ? Infinity : Math.abs(native.vramMiB - gpu.vramMiB);
  const closest = (items, score) => {
    const best = Math.min(...items.map(score));
    const matches = items.filter((item) => score(item) === best);
    return matches.length === 1 ? matches[0] : null;
  };
  // Require the nearest match to be unique in both directions. Equal-capacity
  // cards cannot acquire each other's LUID or free-memory counter by row order.
  let matched;
  do {
    matched = false;
    for (const gpu of drivers) {
      const native = closest(
        remaining.filter((item) => compatible(gpu, item)),
        (item) => distance(gpu, item),
      );
      if (!native) continue;
      const reciprocal = closest(
        drivers.filter((item) => compatible(item, native)),
        (item) => distance(item, native),
      );
      if (reciprocal !== gpu) continue;
      take(gpu, native);
      matched = true;
      break;
    }
  } while (matched);
  const anonymous = (gpu) => ({ ...gpu, luid: null, freeVramMiB: null });
  while (drivers.length) {
    const group = new Set([drivers[0]]),
      natives = new Set();
    for (const gpu of group) {
      for (const native of remaining.filter((item) => compatible(gpu, item))) {
        natives.add(native);
        for (const other of drivers.filter((item) => compatible(item, native))) group.add(other);
      }
    }
    if (!natives.size) {
      merged.push(join(drivers.shift(), null));
      continue;
    }
    const known = [...natives].every((gpu) => gpu.memoryKind === 'dedicated');
    if (known) {
      // Their original DXGI identities/counters are valid; leave them untouched.
      merged.push(...natives);
      const surplus = Math.max(0, group.size - natives.size);
      merged.push(
        ...[...group]
          .sort((a, b) => a.vramMiB - b.vramMiB)
          .slice(0, surplus)
          .map(anonymous),
      );
    } else {
      // SMI still establishes dedicated capacity when UMA detection is unknown,
      // but it cannot establish which native LUID belongs to which driver row.
      merged.push(...[...group].map(anonymous));
      for (let i = group.size; i < natives.size; i++)
        merged.push({ ...anonymous([...natives][0]), vramMiB: null, memoryKind: 'unknown' });
    }
    for (const gpu of group) drivers.splice(drivers.indexOf(gpu), 1);
    for (const native of natives) remaining.splice(remaining.indexOf(native), 1);
  }
  return [...merged, ...remaining];
}
export async function probeHardware({
  runCommand = run,
  locateExecutable = findExecutable,
  platform: hostPlatform = platform(),
  arch: hostArch = arch(),
  env = process.env,
} = {}) {
  const report = {
    platform: hostPlatform,
    arch: hostArch,
    osRelease: release(),
    cpu: cpus()[0]?.model ?? 'Unknown',
    cpuThreads: availableParallelism(),
    ramBytes: totalmem(),
    availableRamBytes: freemem(),
    gpus: [],
    warnings: [],
  };
  const nvidia = locateExecutable('nvidia-smi', {
    env,
    platform: hostPlatform,
    extra: [env.SystemRoot ? path.join(env.SystemRoot, 'System32/nvidia-smi.exe') : null],
  });
  const queryNvidia = async () => {
    if (!nvidia) return [];
    try {
      const { stdout } = await runCommand(
        nvidia,
        ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
        { ...probeOptions, env },
      );
      return parseNvidia(stdout);
    } catch {
      report.warnings.push('NVIDIA driver query unavailable; driver details may be unknown.');
      return [];
    }
  };
  const queryWindows = async () => {
    if (report.platform !== 'win32') return [];
    const powershell =
      locateExecutable('powershell', {
        env,
        platform: hostPlatform,
        extra: [
          env.SystemRoot
            ? path.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
            : null,
        ],
      }) ?? 'powershell.exe';
    try {
      const { stdout } = await runCommand(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          inventoryFile,
          '-Json',
        ],
        { ...probeOptions, env },
      );
      return parseWindowsGpuInventory(stdout);
    } catch {
      report.warnings.push(
        'Windows dedicated GPU inventory unavailable; other memory sizes are unknown.',
      );
    }
    try {
      const { stdout } = await runCommand(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '@(Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress',
        ],
        { ...probeOptions, env },
      );
      const names = JSON.parse(stdout);
      const gpus = [];
      for (const value of Array.isArray(names) ? names : [names]) {
        const name = gpuName(value);
        if (name && !gpus.some((gpu) => nameKey(gpu.name) === nameKey(name)))
          gpus.push({
            name,
            vendor: vendorOf(null, name),
            vramMiB: null,
            memoryKind: 'unknown',
            freeVramMiB: null,
            cudaCandidate: false,
          });
      }
      return gpus;
    } catch {
      report.warnings.push('Windows GPU inventory unavailable; no memory sizes are assumed.');
      return [];
    }
  };
  const [nvidiaGpus, windowsGpus] = await Promise.all([queryNvidia(), queryWindows()]);
  report.gpus = mergeGpuInventory(windowsGpus, nvidiaGpus);
  if (report.platform !== 'win32' || report.arch !== 'x64')
    report.warnings.push('The desktop is currently qualified for Windows x64 only.');
  return report;
}
