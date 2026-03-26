// test-nginx.js — Test Nginx stub_status collector
//
// Run on your VPS: node test-nginx.js
//
// Takes two readings 3 seconds apart so you can see
// the rate calculation in action.

const { getNginxMetrics } = require('./src/metrics/nginx');

async function main() {
  console.log('Fetching Nginx status (first reading)...\n');

  try {
    const first = await getNginxMetrics();
    console.log('=== Nginx Status ===');
    console.log(`  Active connections: ${first.activeConnections}`);
    console.log(`  Total accepts:     ${first.accepts}`);
    console.log(`  Total handled:     ${first.handled}`);
    console.log(`  Total requests:    ${first.requests}`);
    console.log(`  Dropped:           ${first.dropped}`);
    console.log(`  Reading: ${first.reading}  Writing: ${first.writing}  Waiting: ${first.waiting}`);
    console.log(`  Rates:             (need two readings — waiting 3 seconds...)`);

    setTimeout(async () => {
      const second = await getNginxMetrics();
      console.log('\n=== After 3 seconds ===');
      console.log(`  Active connections: ${second.activeConnections}`);
      console.log(`  New requests:      ${second.requests - first.requests}`);

      if (second.rates) {
        console.log(`  Requests/sec:      ${second.rates.requestsPerSecond}`);
        console.log(`  Accepts/sec:       ${second.rates.acceptsPerSecond}`);
      }

      console.log('\n=== Full JSON ===');
      console.log(JSON.stringify(second, null, 2));
    }, 3000);
  } catch (err) {
    console.error('Failed to fetch Nginx status:', err.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Is stub_status configured? Try: curl http://127.0.0.1:8085/nginx_status');
    console.error('  2. Is the server block enabled? Check /etc/nginx/sites-enabled/stub-status');
    console.error('  3. Running inside Docker? Make sure extra_hosts is set in docker-compose.yml');
    console.error('  4. Custom URL? Set NGINX_STATUS_URL environment variable');
  }
}

main();
