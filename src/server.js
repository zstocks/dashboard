// server.js — Dashboard API server
//
// This is the main entry point for the dashboard app.
// It serves JSON endpoints for system, Docker, and Nginx metrics.
//
// Routes:
//   GET /               — basic info page
//   GET /health         — health check (for monitoring)
//   GET /api/system     — CPU, memory, disk, load average, uptime
//   GET /api/containers — Docker container stats
//   GET /api/nginx      — Nginx connection and request metrics
//   GET /api/metrics    — everything combined in one response

const http = require('http');
const { getSystemMetrics, getDockerMetrics, getNginxMetrics } = require('./metrics');
const { getCpuUsage, getCpuInfo } = require('./metrics/cpu');
const { getMemoryUsage } = require('./metrics/memory');
const { getDiskUsage } = require('./metrics/disk');
const { getLoadAverage } = require('./metrics/loadavg');
const { getUptime } = require('./metrics/uptime');

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
// These keep the route handlers clean. Instead of manually setting
// headers and calling res.end() everywhere, we call sendJson() or
// sendError() and move on.
// ---------------------------------------------------------------------------
function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, message, statusCode = 500) {
  sendJson(res, { error: message }, statusCode);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
// Each handler is an async function that takes (req, res).
// They're stored in a map keyed by URL path, which makes the
// request handler below simple: look up the path, call the
// function, done.
// ---------------------------------------------------------------------------
const routes = {
  // Root — basic landing page
  'GET /': async (req, res) => {
    sendJson(res, {
      app: 'dashboard',
      version: '1.0.0',
      endpoints: [
        'GET /health',
        'GET /api/system',
        'GET /api/containers',
        'GET /api/nginx',
        'GET /api/metrics',
      ],
    });
  },

  // Health check — keep this fast and simple
  // Other apps can ping this to verify the dashboard is alive
  'GET /health': async (req, res) => {
    sendJson(res, { status: 'ok', app: 'dashboard' });
  },

  // System metrics only (CPU, memory, disk, load, uptime)
  // These are synchronous /proc reads so they're very fast
  'GET /api/system': async (req, res) => {
    const data = {
      timestamp: new Date().toISOString(),
      cpu: getCpuUsage(),
      cpuInfo: getCpuInfo(),
      memory: getMemoryUsage(),
      disk: getDiskUsage(),
      loadAverage: getLoadAverage(),
      uptime: getUptime(),
    };
    sendJson(res, data);
  },

  // Docker container metrics only
  // Async — makes HTTP requests to Docker daemon over the Unix socket
  'GET /api/containers': async (req, res) => {
    try {
      const containers = await getDockerMetrics();
      sendJson(res, { timestamp: new Date().toISOString(), containers });
    } catch (err) {
      sendError(res, `Docker metrics failed: ${err.message}`);
    }
  },

  // Nginx metrics only
  // Async — makes HTTP request to stub_status on the host
  'GET /api/nginx': async (req, res) => {
    try {
      const nginx = await getNginxMetrics();
      sendJson(res, { timestamp: new Date().toISOString(), nginx });
    } catch (err) {
      sendError(res, `Nginx metrics failed: ${err.message}`);
    }
  },

  // Everything combined — one call to get the full picture
  // This is what the frontend dashboard will use
  'GET /api/metrics': async (req, res) => {
    try {
      const metrics = await getSystemMetrics();
      sendJson(res, metrics);
    } catch (err) {
      sendError(res, `Metrics collection failed: ${err.message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
// The request handler looks up the route by combining the HTTP method
// and URL path (e.g., "GET /api/system"). If it finds a match, it
// calls the handler. Otherwise, 404.
//
// This is a simple pattern that scales well without a framework.
// When you need more routes, just add another entry to the map.
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // Strip query strings and trailing slashes (except root)
  const path = req.url.split('?')[0].replace(/\/+$/, '') || '/';
  const key = `${req.method} ${path}`;

  const handler = routes[key];

  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Error handling ${key}:`, err);
      sendError(res, 'Internal server error');
    }
  } else {
    sendError(res, `Not found: ${req.method} ${path}`, 404);
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard server listening on port ${PORT}`);
});