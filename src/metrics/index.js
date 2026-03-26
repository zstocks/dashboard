// metrics/index.js — Aggregate all system metrics into a single snapshot
//
// This module provides two things:
// 1. getSystemMetrics() — returns a full snapshot of all system metrics
// 2. getDockerMetrics re-exported for standalone use
//
// Note: getSystemMetrics() is now async because Docker metrics
// require HTTP requests over the Unix socket. The system metrics
// (CPU, memory, disk, etc.) are still synchronous reads from /proc,
// but we await the Docker call and include both in one snapshot.

const { getCpuUsage, getCpuInfo } = require('./cpu');
const { getMemoryUsage, formatBytes } = require('./memory');
const { getDiskUsage } = require('./disk');
const { getLoadAverage } = require('./loadavg');
const { getUptime } = require('./uptime');
const { getDockerMetrics } = require('./docker');

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
  // If Docker is unreachable, we still return system metrics
  try {
    system.containers = await getDockerMetrics();
  } catch (err) {
    system.containers = { error: err.message };
  }

  return system;
}

module.exports = { getSystemMetrics, getDockerMetrics, formatBytes };