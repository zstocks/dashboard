// nginx.js — Parse Nginx stub_status for connection and request metrics
//
// How it works:
// Nginx's stub_status module exposes a plain-text page like this:
//
//   Active connections: 3
//   server accepts handled requests
//    156 156 890
//   Reading: 0 Writing: 1 Waiting: 2
//
// What each number means:
//
//   Active connections — current open connections (including idle keep-alives)
//   Accepts   — total accepted connections since Nginx started
//   Handled   — total handled connections (should equal accepts; if lower,
//               Nginx hit a resource limit and dropped some)
//   Requests  — total HTTP requests served (one connection can serve many
//               requests via keep-alive, so this is usually much higher
//               than accepts)
//   Reading   — connections where Nginx is reading the request headers
//   Writing   — connections where Nginx is sending back a response
//   Waiting   — idle keep-alive connections (client is connected but not
//               sending anything right now — this is normal and healthy)
//
// To calculate request RATE (requests per second), we store the previous
// reading and compute the delta over the time interval — same concept
// as the CPU collector.

const http = require('http');

// Where to reach Nginx stub_status from inside the Docker container.
// host.docker.internal resolves to the host machine thanks to
// extra_hosts in docker-compose.yml.
const NGINX_STATUS_URL = process.env.NGINX_STATUS_URL
  || 'http://host.docker.internal:8085/nginx_status';

let previousReading = null;
let previousTimestamp = null;

// ---------------------------------------------------------------------------
// Fetch the stub_status page
// ---------------------------------------------------------------------------
function fetchStubStatus() {
  return new Promise((resolve, reject) => {
    const url = new URL(NGINX_STATUS_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      timeout: 3000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });

    req.on('error', (err) => {
      reject(new Error(`Nginx status request failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy(new Error('Nginx status request timed out'));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Parse the stub_status plain-text response
// ---------------------------------------------------------------------------
function parseStubStatus(text) {
  // Active connections: 3
  const activeMatch = text.match(/Active connections:\s*(\d+)/);

  // The three numbers on the "server accepts handled requests" line
  const countersMatch = text.match(/\n\s+(\d+)\s+(\d+)\s+(\d+)/);

  // Reading: 0 Writing: 1 Waiting: 2
  const stateMatch = text.match(
    /Reading:\s*(\d+)\s+Writing:\s*(\d+)\s+Waiting:\s*(\d+)/
  );

  if (!activeMatch || !countersMatch || !stateMatch) {
    throw new Error('Unexpected stub_status format');
  }

  return {
    activeConnections: parseInt(activeMatch[1], 10),
    accepts: parseInt(countersMatch[1], 10),
    handled: parseInt(countersMatch[2], 10),
    requests: parseInt(countersMatch[3], 10),
    reading: parseInt(stateMatch[1], 10),
    writing: parseInt(stateMatch[2], 10),
    waiting: parseInt(stateMatch[3], 10),
  };
}

// ---------------------------------------------------------------------------
// Get Nginx metrics with computed rates
// ---------------------------------------------------------------------------
// Returns the raw counters plus computed per-second rates for
// requests, accepts, and handled connections.
//
// On the first call, rates will be null (no previous reading to
// compute a delta from). After that, each call returns the rate
// since the previous call.
// ---------------------------------------------------------------------------
async function getNginxMetrics() {
  const text = await fetchStubStatus();
  const current = parseStubStatus(text);
  const now = Date.now();

  let rates = null;

  if (previousReading && previousTimestamp) {
    const elapsedSeconds = (now - previousTimestamp) / 1000;

    if (elapsedSeconds > 0) {
      rates = {
        requestsPerSecond: Math.round(
          ((current.requests - previousReading.requests) / elapsedSeconds) * 100
        ) / 100,
        acceptsPerSecond: Math.round(
          ((current.accepts - previousReading.accepts) / elapsedSeconds) * 100
        ) / 100,
        handledPerSecond: Math.round(
          ((current.handled - previousReading.handled) / elapsedSeconds) * 100
        ) / 100,
      };
    }
  }

  previousReading = current;
  previousTimestamp = now;

  // Dropped connections = accepts - handled (should normally be 0)
  const dropped = current.accepts - current.handled;

  return {
    ...current,
    dropped,
    rates,
  };
}

module.exports = { getNginxMetrics };
