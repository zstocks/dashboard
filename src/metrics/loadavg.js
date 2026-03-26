// loadavg.js — Read system load average from /proc/loadavg
//
// How it works:
// /proc/loadavg contains a single line like:
//   0.45 0.67 0.89 2/345 12345
//
// The three numbers are the 1-minute, 5-minute, and 15-minute load averages.
// Load average = average number of processes that are either running on a CPU
// or waiting for a CPU over that time window.
//
// How to interpret it:
// - On a 2-core machine (like your CX22), a load of 2.0 means the CPUs are
//   fully utilized with no queue. Below 2.0 = headroom. Above 2.0 = processes
//   are waiting.
// - General rule: load / num_cores < 1.0 is healthy
//
// The "2/345" means 2 currently running processes out of 345 total.
// "12345" is the PID of the most recently created process.

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROC_PATH = process.env.PROC_PATH || '/proc';

function getLoadAverage() {
  const content = fs.readFileSync(path.join(PROC_PATH, 'loadavg'), 'utf8').trim();
  const parts = content.split(/\s+/);

  const load1 = parseFloat(parts[0]);
  const load5 = parseFloat(parts[1]);
  const load15 = parseFloat(parts[2]);

  // Parse running/total processes (e.g., "2/345")
  const [running, total] = (parts[3] || '0/0').split('/').map(Number);

  // Get core count to provide context for the load numbers
  // In Docker, os.cpus() reflects the host's CPUs unless you've limited them
  const coreCount = os.cpus().length;

  return {
    load1,
    load5,
    load15,
    runningProcesses: running,
    totalProcesses: total,
    coreCount,
    // Normalized: load per core. Under 1.0 = healthy
    normalized: {
      load1: Math.round((load1 / coreCount) * 100) / 100,
      load5: Math.round((load5 / coreCount) * 100) / 100,
      load15: Math.round((load15 / coreCount) * 100) / 100,
    },
  };
}

module.exports = { getLoadAverage };
