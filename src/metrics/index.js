// metrics/index.js — Aggregate all system metrics into a single snapshot
//
// Collects:
// - System metrics from /proc (CPU, memory, disk, load, uptime) — synchronous
// - Docker container metrics via Unix socket — async
// - Nginx connection/request metrics via stub_status — async
//
// getSystemMetrics() is async because Docker and Nginx collectors
// make HTTP requests. If either is unreachable, the rest still works.

const { getCpuUsage, getCpuInfo } = require('./cpu');
const { getMemoryUsage, formatBytes } = require('./memory');
const { getDiskUsage } = require('./disk');
const { getLoadAverage } = require('./loadavg');
const { getUptime } = require('./uptime');
const { getDockerMetrics } = require('./docker');
const { getNginxMetrics } = require('./nginx');

// Take the initial CPU reading immediately on import.
// The first call to getCpuUsage() stores the baseline;
// subsequent calls return the delta since the last read.
getCpuUsage();

async function getSystemMetrics() {
  // System metrics from /proc — synchronous, fast
  const system = {
    timestamp: new Date().toISOString(),
    cpu: getCpuUsage(),
    cpuInfo: getCpuInfo(),
    memory: getMemoryUsage(),
    disk: getDiskUsage(),
    loadAverage: getLoadAverage(),
    uptime: getUptime(),
  };

  // Docker metrics — async, requires socket communication
  try {
    system.containers = await getDockerMetrics();
  } catch (err) {
    system.containers = { error: err.message };
  }

  // Nginx metrics — async, requires HTTP request to stub_status
  try {
    system.nginx = await getNginxMetrics();
  } catch (err) {
    system.nginx = { error: err.message };
  }

  return system;
}

module.exports = { getSystemMetrics, getDockerMetrics, getNginxMetrics, formatBytes };