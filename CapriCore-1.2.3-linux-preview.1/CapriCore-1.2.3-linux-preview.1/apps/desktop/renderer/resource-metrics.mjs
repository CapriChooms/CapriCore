// SPDX-License-Identifier: GPL-3.0-only
export const MAX_RESOURCE_METRICS = 4;
export const RESOURCE_REFRESH_INTERVALS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => index + 1),
);

export const RESOURCE_METRICS = [
  { id: 'cpu', label: 'CPU' },
  { id: 'gpu', label: 'GPU' },
  { id: 'ram', label: 'RAM' },
  { id: 'vram', label: 'VRAM' },
  { id: 'capriCpu', label: 'Capri CPU' },
  { id: 'capriRam', label: 'Capri RAM' },
  { id: 'cpuTemperature', label: 'CPU temperature' },
  { id: 'gpuTemperature', label: 'GPU temperature' },
  { id: 'disk', label: 'Disk usage' },
];
export const DEFAULT_RESOURCE_GRAPHS = Object.freeze(['cpu', 'gpu', 'ram', 'vram']);
export const DEFAULT_RESOURCE_METERS = DEFAULT_RESOURCE_GRAPHS;

const metricIds = new Set(RESOURCE_METRICS.map(({ id }) => id));

export function validateResourceMetrics(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RESOURCE_METRICS ||
    new Set(value).size !== value.length ||
    ![...value].every((id) => metricIds.has(id))
  )
    throw new Error('Invalid resource metrics');
  return [...value];
}

export function resourceMonitorDisplay(settings) {
  const graphs = settings.processGraphs ? (settings.graphMetrics ?? DEFAULT_RESOURCE_GRAPHS) : [];
  const meters =
    !graphs.length && settings.memoryMonitor
      ? (settings.meterMetrics ?? DEFAULT_RESOURCE_METERS)
      : [];
  return { graphs, meters };
}

export function resourceMonitorNeedsProcessLoad({ graphs, meters }) {
  const visible = graphs.length ? graphs : meters;
  return (
    graphs.includes('cpu') ||
    graphs.includes('ram') ||
    visible.includes('capriCpu') ||
    visible.includes('capriRam')
  );
}
