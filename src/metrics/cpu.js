// cpu.js — Read CPU usage from /proc/stat
//
// How it works:
// /proc/stat exposes cumulative CPU time counters (in "jiffies", typically 1/100th of a second).
// Each line looks like:
//   cpu  12345 678 9012 345678 ...
//
// The columns are: user, nice, system, idle, iowait, irq, softirq, steal
//
// To get a *percentage*, you need TWO readings separated by a time interval.
// You compute the delta of each column, then:
//   usage% = (total_delta - idle_delta) / total_delta * 100
//
// This module stores the previous reading so each call to getCpuUsage()
// returns the usage since the last call.

const fs = require('fs');
const path = require('path');

// Default to /proc, but can be overridden for Docker (e.g., /host/proc)
const PROC_PATH = process.env.PROC_PATH || '/proc';

let previousReading = null;

function parseProcStat() {
  const content = fs.readFileSync(path.join(PROC_PATH, 'stat'), 'utf8');
  const lines = content.split('\n');
  const cpus = {};

  for (const line of lines) {
    // Match lines starting with "cpu" (e.g., "cpu", "cpu0", "cpu1")
    const match = line.match(/^(cpu\d*)\s+(.+)/);
    if (!match) continue;

    const name = match[1];
    const values = match[2].split(/\s+/).map(Number);

    // Columns: user, nice, system, idle, iowait, irq, softirq, steal
    const [user, nice, system, idle, iowait, irq, softirq, steal] = values;

    cpus[name] = {
      user,
      nice,
      system,
      idle,
      iowait: iowait || 0,
      irq: irq || 0,
      softirq: softirq || 0,
      steal: steal || 0,
    };
  }

  return cpus;
}

function calculateUsage(previous, current) {
  const prevTotal = Object.values(previous).reduce((sum, v) => sum + v, 0);
  const currTotal = Object.values(current).reduce((sum, v) => sum + v, 0);

  const totalDelta = currTotal - prevTotal;
  const idleDelta = (current.idle + current.iowait) - (previous.idle + previous.iowait);

  if (totalDelta === 0) return 0;

  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

function getCpuUsage() {
  const current = parseProcStat();

  if (!previousReading) {
    // First call — store reading and return null (no delta yet)
    previousReading = current;
    return null;
  }

  const result = {
    // Overall CPU usage (the "cpu" line aggregates all cores)
    total: Math.round(calculateUsage(previousReading.cpu, current.cpu) * 100) / 100,
    cores: [],
  };

  // Per-core usage
  let coreIndex = 0;
  while (current[`cpu${coreIndex}`]) {
    const key = `cpu${coreIndex}`;
    if (previousReading[key]) {
      result.cores.push({
        core: coreIndex,
        usage: Math.round(calculateUsage(previousReading[key], current[key]) * 100) / 100,
      });
    }
    coreIndex++;
  }

  result.coreCount = result.cores.length;
  previousReading = current;
  return result;
}

// Get static CPU info (model, speed) from /proc/cpuinfo
function getCpuInfo() {
  try {
    const content = fs.readFileSync(path.join(PROC_PATH, 'cpuinfo'), 'utf8');
    const modelMatch = content.match(/model name\s*:\s*(.+)/);
    const mhzMatch = content.match(/cpu MHz\s*:\s*(.+)/);
    const coreMatches = content.match(/processor\s*:/g);

    return {
      model: modelMatch ? modelMatch[1].trim() : 'Unknown',
      speedMHz: mhzMatch ? Math.round(parseFloat(mhzMatch[1])) : null,
      cores: coreMatches ? coreMatches.length : null,
    };
  } catch {
    return null;
  }
}

module.exports = { getCpuUsage, getCpuInfo };
