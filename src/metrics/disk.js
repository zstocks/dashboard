// disk.js — Read disk usage via the `df` command
//
// Why not /proc for disk?
// Unlike CPU and memory, disk usage isn't cleanly exposed via /proc.
// /proc/diskstats gives I/O counters (reads, writes, latency) — useful
// for performance monitoring but not for space usage.
//
// The `df` command reads from the statfs() syscall, which gives us
// total/used/available space per mounted filesystem. That's what we want.
//
// Inside Docker, `df /` shows the overlay filesystem (the container's disk).
// To see the HOST's disk, we'd mount the host root at a known path (e.g., /host/root)
// and run `df /host/root`.
//
// We filter out virtual/temp filesystems (tmpfs, devtmpfs, overlay internals)
// and focus on real disk partitions.

const { execSync } = require('child_process');

// If running in Docker and host root is mounted, check that path too
const HOST_ROOT = process.env.HOST_ROOT || null;

function getDiskUsage() {
  // -B1 = output in bytes, -P = POSIX format (no line wrapping)
  const output = execSync('df -B1 -P', { encoding: 'utf8', timeout: 5000 });
  const lines = output.trim().split('\n').slice(1); // skip header

  const disks = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const [filesystem, totalStr, usedStr, availableStr, capacityStr, mountpoint] = parts;

    // Skip virtual filesystems
    if (['tmpfs', 'devtmpfs', 'udev', 'shm'].includes(filesystem)) continue;
    if (mountpoint.startsWith('/sys') || mountpoint.startsWith('/proc')) continue;
    if (mountpoint.startsWith('/dev/') && mountpoint !== '/dev') continue;
    // In Docker, /etc/hostname and similar bind mounts show up — skip them
    if (mountpoint.startsWith('/etc/')) continue;
    // Skip "none" filesystems UNLESS they're the root mount
    if (filesystem === 'none' && mountpoint !== '/') continue;

    const total = parseInt(totalStr, 10);
    const used = parseInt(usedStr, 10);
    const available = parseInt(availableStr, 10);

    disks.push({
      filesystem,
      mountpoint,
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      usagePercent: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
    });
  }

  // If HOST_ROOT is set, find that mount specifically and label it clearly
  if (HOST_ROOT) {
    const hostDisk = disks.find(d => d.mountpoint === HOST_ROOT);
    if (hostDisk) {
      hostDisk.label = 'Host Root Disk';
    }
  }

  return disks;
}

module.exports = { getDiskUsage };
