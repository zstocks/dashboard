// alerts.js — Threshold-based alerts with Discord webhook notifications
//
// How it works:
// After each metrics collection cycle, the collector calls checkAlerts()
// with the latest snapshot. This module compares values against thresholds
// and sends a Discord notification if something is wrong.
//
// Cooldown logic:
// Each alert has a "key" (like "cpu_high" or "container_down:dashboard-app-1").
// Once an alert fires, it enters cooldown and won't fire again for that same
// key until the cooldown period expires (default: 5 minutes). When the
// condition clears, a recovery message is sent.
//
// Discord webhook format:
// Discord webhooks accept a JSON body with "embeds" — rich formatted messages
// with color, title, description, and fields. We use this to send clean,
// readable alert messages.

const https = require('https');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || null;

// Thresholds (override via environment variables)
const THRESHOLDS = {
  cpuPercent: parseInt(process.env.ALERT_CPU_PERCENT, 10) || 85,
  memoryPercent: parseInt(process.env.ALERT_MEMORY_PERCENT, 10) || 85,
  diskPercent: parseInt(process.env.ALERT_DISK_PERCENT, 10) || 90,
};

// Cooldown period in milliseconds (default: 5 minutes)
const COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MS, 10) || 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// Tracks which alerts are currently active and when they last fired.
//
// activeAlerts: Map of alert key → { firedAt, message }
//   - "cpu_high" → { firedAt: 1234567890, message: "CPU at 92%" }
//   - "container_down:raw-http" → { firedAt: ..., message: "..." }
//
// This lets us:
//   1. Skip re-firing during cooldown
//   2. Send recovery messages when the condition clears
// ---------------------------------------------------------------------------
const activeAlerts = new Map();

// Discord embed colors (decimal values, not hex)
const COLORS = {
  danger: 15548997,   // #ED4245 red
  warning: 16776960,  // #FFFF00 yellow
  success: 5763719,   // #57F287 green
};

// ---------------------------------------------------------------------------
// Send a message to Discord
// ---------------------------------------------------------------------------
// Discord's webhook API accepts a POST with a JSON body.
// We use "embeds" for formatted messages with color coding.
//
// This function is fire-and-forget — we don't wait for the response
// or retry on failure. Alert delivery is best-effort; we don't want
// a Discord outage to affect the dashboard itself.
// ---------------------------------------------------------------------------
function sendDiscordMessage(embed) {
  if (!WEBHOOK_URL) return;

  const payload = JSON.stringify({ embeds: [embed] });

  const url = new URL(WEBHOOK_URL);

  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    // Consume response to free the socket
    res.resume();
    if (res.statusCode >= 400) {
      console.error(`Discord webhook returned ${res.statusCode}`);
    }
  });

  req.on('error', (err) => {
    console.error('Discord webhook error:', err.message);
  });

  req.write(payload);
  req.end();
}

// ---------------------------------------------------------------------------
// Fire an alert (with cooldown check)
// ---------------------------------------------------------------------------
function fireAlert(key, title, description, color) {
  const existing = activeAlerts.get(key);
  const now = Date.now();

  // If this alert is already active and within cooldown, skip it
  if (existing && (now - existing.firedAt) < COOLDOWN_MS) {
    return;
  }

  activeAlerts.set(key, { firedAt: now, title });

  console.log(`ALERT [${key}]: ${title}`);

  sendDiscordMessage({
    title: title,
    description: description,
    color: color || COLORS.danger,
    timestamp: new Date().toISOString(),
    footer: { text: 'Server Dashboard Alert' },
  });
}

// ---------------------------------------------------------------------------
// Clear an alert and send recovery notification
// ---------------------------------------------------------------------------
function clearAlert(key) {
  const existing = activeAlerts.get(key);
  if (!existing) return;

  activeAlerts.delete(key);

  console.log(`RECOVERED [${key}]: ${existing.title}`);

  sendDiscordMessage({
    title: 'Recovered: ' + existing.title,
    description: 'The condition has returned to normal.',
    color: COLORS.success,
    timestamp: new Date().toISOString(),
    footer: { text: 'Server Dashboard Alert' },
  });
}

// ---------------------------------------------------------------------------
// Format bytes helper
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// ---------------------------------------------------------------------------
// Check all alert conditions against a metrics snapshot
// ---------------------------------------------------------------------------
// Called by the collector after each collection cycle.
// Each check follows the same pattern:
//   1. Is the condition bad? → fire or maintain the alert
//   2. Is the condition good? → clear the alert (sends recovery)
// ---------------------------------------------------------------------------
function checkAlerts(snapshot) {
  if (!WEBHOOK_URL) return; // No webhook configured, skip everything

  // --- CPU ---
  if (snapshot.cpu && snapshot.cpu.total != null) {
    const key = 'cpu_high';
    if (snapshot.cpu.total > THRESHOLDS.cpuPercent) {
      fireAlert(
        key,
        'High CPU usage',
        `CPU is at **${snapshot.cpu.total.toFixed(1)}%** (threshold: ${THRESHOLDS.cpuPercent}%)`,
        COLORS.danger
      );
    } else {
      clearAlert(key);
    }
  }

  // --- Memory ---
  if (snapshot.memory && snapshot.memory.ram) {
    const key = 'memory_high';
    const ram = snapshot.memory.ram;
    if (ram.usagePercent > THRESHOLDS.memoryPercent) {
      fireAlert(
        key,
        'High memory usage',
        `Memory is at **${ram.usagePercent.toFixed(1)}%** ` +
        `(${formatBytes(ram.usedBytes)} / ${formatBytes(ram.totalBytes)})\n` +
        `Threshold: ${THRESHOLDS.memoryPercent}%`,
        COLORS.danger
      );
    } else {
      clearAlert(key);
    }
  }

  // --- Disk ---
  if (Array.isArray(snapshot.disk)) {
    for (const disk of snapshot.disk) {
      const key = 'disk_high:' + disk.mountpoint;
      if (disk.usagePercent > THRESHOLDS.diskPercent) {
        fireAlert(
          key,
          'Disk space running low',
          `**${disk.mountpoint}** is at **${disk.usagePercent.toFixed(1)}%** ` +
          `(${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)})\n` +
          `Threshold: ${THRESHOLDS.diskPercent}%`,
          disk.usagePercent > 95 ? COLORS.danger : COLORS.warning
        );
      } else {
        clearAlert(key);
      }
    }
  }

  // --- Docker containers ---
  if (Array.isArray(snapshot.containers)) {
    for (const container of snapshot.containers) {
      const downKey = 'container_down:' + container.name;
      const restartKey = 'container_restarts:' + container.name;

      // Container not running
      if (container.state !== 'running') {
        fireAlert(
          downKey,
          'Container down: ' + container.name,
          `**${container.name}** is in state **${container.state}**\n` +
          `Image: ${container.image}`,
          COLORS.danger
        );
      } else {
        clearAlert(downKey);
      }

      // High restart count (3+ restarts suggests a crash loop)
      if (container.restartCount >= 3) {
        fireAlert(
          restartKey,
          'Container restarting: ' + container.name,
          `**${container.name}** has restarted **${container.restartCount} times**\n` +
          `This may indicate a crash loop.`,
          COLORS.warning
        );
      }
    }
  }

  // --- Nginx dropped connections ---
  if (snapshot.nginx && !snapshot.nginx.error && snapshot.nginx.dropped > 0) {
    fireAlert(
      'nginx_drops',
      'Nginx dropping connections',
      `Nginx has dropped **${snapshot.nginx.dropped}** connections\n` +
      `(accepts: ${snapshot.nginx.accepts}, handled: ${snapshot.nginx.handled})`,
      COLORS.warning
    );
  }
}

// ---------------------------------------------------------------------------
// Get current alert status (for the API/dashboard)
// ---------------------------------------------------------------------------
function getActiveAlerts() {
  const alerts = [];
  for (const [key, value] of activeAlerts) {
    alerts.push({
      key,
      title: value.title,
      firedAt: new Date(value.firedAt).toISOString(),
    });
  }
  return alerts;
}

module.exports = { checkAlerts, getActiveAlerts };
