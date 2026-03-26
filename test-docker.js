// test-docker.js — Test Docker metrics collector
//
// Run on your VPS: node test-docker.js
//
// This will list all your containers and pull stats
// for each running one. You should see your raw-http
// and dashboard containers with CPU/memory usage.

const { getDockerMetrics } = require('./src/metrics/docker');
const { formatBytes } = require('./src/metrics/memory');

async function main() {
  console.log('Querying Docker daemon...\n');

  try {
    const containers = await getDockerMetrics();

    for (const c of containers) {
      console.log(`=== ${c.name} (${c.id}) ===`);
      console.log(`  Image:    ${c.image}`);
      console.log(`  State:    ${c.state}`);
      console.log(`  Restarts: ${c.restartCount}`);

      if (c.uptimeSeconds > 0) {
        const hours = Math.floor(c.uptimeSeconds / 3600);
        const mins = Math.floor((c.uptimeSeconds % 3600) / 60);
        console.log(`  Uptime:   ${hours}h ${mins}m`);
      }

      if (c.ports.length > 0) {
        c.ports.forEach((p) => {
          console.log(`  Port:     ${p.host || 'none'} → ${p.container}`);
        });
      }

      if (c.stats && !c.stats.error) {
        console.log(`  CPU:      ${c.stats.cpuPercent}%`);
        console.log(`  Memory:   ${formatBytes(c.stats.memory.usageBytes)} / ${formatBytes(c.stats.memory.limitBytes)} (${c.stats.memory.usagePercent}%)`);
        console.log(`  PIDs:     ${c.stats.pids}`);
        if (c.stats.network) {
          console.log(`  Net RX:   ${formatBytes(c.stats.network.rxBytes)}`);
          console.log(`  Net TX:   ${formatBytes(c.stats.network.txBytes)}`);
        }
      } else if (c.stats?.error) {
        console.log(`  Stats:    Error — ${c.stats.error}`);
      } else {
        console.log(`  Stats:    N/A (container not running)`);
      }

      console.log('');
    }

    console.log(`Total containers: ${containers.length}`);
    console.log(`Running: ${containers.filter((c) => c.state === 'running').length}`);
  } catch (err) {
    console.error('Failed to query Docker:', err.message);
    console.error('');
    console.error('Common causes:');
    console.error('  - Docker socket not mounted (check docker-compose.yml volumes)');
    console.error('  - Permission denied (container user needs access to the socket)');
    console.error('  - Docker daemon not running');
  }
}

main();
