// uptime.js — Read system uptime from /proc/uptime
//
// /proc/uptime contains two numbers:
//   12345.67 23456.78
//
// First number: seconds since the system booted
// Second number: cumulative idle time across all cores (less useful for us)

const fs = require('fs');
const path = require('path');

const PROC_PATH = process.env.PROC_PATH || '/proc';

function getUptime() {
  const content = fs.readFileSync(path.join(PROC_PATH, 'uptime'), 'utf8').trim();
  const [uptimeSeconds] = content.split(/\s+/).map(parseFloat);

  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  return {
    totalSeconds: Math.floor(uptimeSeconds),
    days,
    hours,
    minutes,
    seconds,
    formatted: days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : `${hours}h ${minutes}m ${seconds}s`,
  };
}

module.exports = { getUptime };
