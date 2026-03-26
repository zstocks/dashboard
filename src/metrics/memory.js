// memory.js — Read memory usage from /proc/meminfo
//
// How it works:
// /proc/meminfo lists memory stats in KB, one per line:
//   MemTotal:       4028592 kB
//   MemFree:         234567 kB
//   MemAvailable:   1234567 kB
//   Buffers:         123456 kB
//   Cached:          654321 kB
//   SwapTotal:      2097148 kB
//   SwapFree:       1234567 kB
//   ...
//
// "Available" memory (MemAvailable) is what the kernel estimates is actually
// usable without swapping. It accounts for buffers/cache that can be reclaimed.
// This is the number you actually care about — not MemFree, which excludes
// reclaimable cache and will look scary-low on a healthy system.
//
// Used memory = Total - Available (simple and accurate)

const fs = require('fs');
const path = require('path');

const PROC_PATH = process.env.PROC_PATH || '/proc';

function parseMeminfo() {
  const content = fs.readFileSync(path.join(PROC_PATH, 'meminfo'), 'utf8');
  const entries = {};

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) {
      // Values in /proc/meminfo are in kB — convert to bytes
      entries[match[1]] = parseInt(match[2], 10) * 1024;
    }
  }

  return entries;
}

function getMemoryUsage() {
  const info = parseMeminfo();

  const total = info.MemTotal || 0;
  const available = info.MemAvailable || 0;
  const free = info.MemFree || 0;
  const buffers = info.Buffers || 0;
  const cached = info.Cached || 0;
  const used = total - available;

  const swapTotal = info.SwapTotal || 0;
  const swapFree = info.SwapFree || 0;
  const swapUsed = swapTotal - swapFree;

  return {
    ram: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      freeBytes: free,
      buffersBytes: buffers,
      cachedBytes: cached,
      usagePercent: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
    },
    swap: {
      totalBytes: swapTotal,
      usedBytes: swapUsed,
      freeBytes: swapFree,
      usagePercent: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 10000) / 100 : 0,
    },
  };
}

// Helper: format bytes into human-readable string
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

module.exports = { getMemoryUsage, formatBytes };
