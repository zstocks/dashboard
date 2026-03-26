// test-metrics.js — Quick test to verify all metric collectors work
//
// Run: node test-metrics.js
//
// This takes two readings 1 second apart so the CPU delta has
// something to calculate.

const { getSystemMetrics, formatBytes } = require('./src/metrics');

console.log('Taking first CPU reading...');
console.log('Waiting 1 second for delta...\n');

setTimeout(async () => {
  const metrics = await getSystemMetrics();

  // --- CPU ---
  console.log('=== CPU ===');
  if (metrics.cpu) {
    console.log(`  Total usage: ${metrics.cpu.total}%`);
    console.log(`  Cores: ${metrics.cpu.coreCount}`);
    metrics.cpu.cores.forEach(c => {
      console.log(`    Core ${c.core}: ${c.usage}%`);
    });
  }
  if (metrics.cpuInfo) {
    console.log(`  Model: ${metrics.cpuInfo.model}`);
  }

  // --- Memory ---
  console.log('\n=== Memory ===');
  const ram = metrics.memory.ram;
  console.log(`  Total: ${formatBytes(ram.totalBytes)}`);
  console.log(`  Used:  ${formatBytes(ram.usedBytes)} (${ram.usagePercent}%)`);
  console.log(`  Available: ${formatBytes(ram.availableBytes)}`);
  console.log(`  Buffers: ${formatBytes(ram.buffersBytes)}`);
  console.log(`  Cached:  ${formatBytes(ram.cachedBytes)}`);

  const swap = metrics.memory.swap;
  if (swap.totalBytes > 0) {
    console.log(`  Swap: ${formatBytes(swap.usedBytes)} / ${formatBytes(swap.totalBytes)} (${swap.usagePercent}%)`);
  } else {
    console.log('  Swap: none');
  }

  // --- Disk ---
  console.log('\n=== Disk ===');
  metrics.disk.forEach(d => {
    console.log(`  ${d.mountpoint} (${d.filesystem})`);
    console.log(`    ${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)} (${d.usagePercent}%)`);
  });

  // --- Load Average ---
  console.log('\n=== Load Average ===');
  const la = metrics.loadAverage;
  console.log(`  1m: ${la.load1}  5m: ${la.load5}  15m: ${la.load15}`);
  console.log(`  Per-core: ${la.normalized.load1} / ${la.normalized.load5} / ${la.normalized.load15}`);
  console.log(`  Processes: ${la.runningProcesses} running / ${la.totalProcesses} total`);

  // --- Uptime ---
  console.log('\n=== Uptime ===');
  console.log(`  ${metrics.uptime.formatted} (${metrics.uptime.totalSeconds}s)`);

  // --- Docker Containers ---
  console.log('\n=== Docker Containers ===');
  if (Array.isArray(metrics.containers)) {
    metrics.containers.forEach((c) => {
      const mem = c.stats?.memory ? `${formatBytes(c.stats.memory.usageBytes)}` : 'N/A';
      const cpu = c.stats?.cpuPercent != null ? `${c.stats.cpuPercent}%` : 'N/A';
      console.log(`  ${c.name} [${c.state}] — CPU: ${cpu}, Mem: ${mem}, Restarts: ${c.restartCount}`);
    });
  } else {
    console.log(`  ${metrics.containers.error || 'No Docker data'}`);
  }

  // --- Raw JSON ---
  console.log('\n=== Full JSON snapshot ===');
  console.log(JSON.stringify(metrics, null, 2));
}, 1000);