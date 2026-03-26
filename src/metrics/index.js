// metrics/index.js — Aggregate all system metrics into a single snapshot
//
// This module provides two things:
// 1. getSystemMetrics() — returns a full snapshot of all system metrics
// 2. initCpuTracking() — takes the first CPU reading so the first real
//    call to getSystemMetrics() has a delta to work with

const { getCpuUsage, getCpuInfo } = require('./cpu');
const { getMemoryUsage, formatBytes } = require('./memory');
const { getDiskUsage } = require('./disk');
const { getLoadAverage } = require('./loadavg');
const { getUptime } = require('./uptime');

// Take the initial CPU reading immediately on import.
// The first call to getCpuUsage() stores the baseline;
// subsequent calls return the delta since the last read.
getCpuUsage();

function getSystemMetrics() {
  return {
    timestamp: new Date().toISOString(),
    cpu: getCpuUsage(),
    cpuInfo: getCpuInfo(),
    memory: getMemoryUsage(),
    disk: getDiskUsage(),
    loadAverage: getLoadAverage(),
    uptime: getUptime(),
  };
}

module.exports = { getSystemMetrics, formatBytes };
