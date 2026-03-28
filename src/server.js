// server.js — Dashboard API server with WebSocket and static file serving
//
// HTTP endpoints serve JSON from the ring buffer (collected on interval).
// WebSocket clients receive live pushes every collection cycle.
// Static files (the dashboard UI) are served from the public/ directory.
//
// Routes:
//   GET /               — serves public/index.html (the dashboard UI)
//   GET /health         — health check
//   GET /api/system     — latest system metrics
//   GET /api/containers — latest Docker container stats
//   GET /api/nginx      — latest Nginx metrics
//   GET /api/metrics    — latest full snapshot
//   GET /api/history    — full ring buffer (for chart backfill)
//   WS  /ws             — WebSocket stream (live updates)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const collector = require('./collector');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
// Maps file extensions to MIME types. When a request comes in that
// isn't an API route, we check if it matches a file in public/.
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return sendError(res, 'Not found', 404);
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Response helpers
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
const routes = {
  'GET /health': async (req, res) => {
    sendJson(res, { status: 'ok', app: 'dashboard' });
  },

  'GET /api/system': async (req, res) => {
    const latest = collector.getLatest();
    if (!latest) {
      return sendError(res, 'No data collected yet — try again shortly', 503);
    }
    sendJson(res, {
      timestamp: latest.timestamp,
      cpu: latest.cpu,
      cpuInfo: latest.cpuInfo,
      memory: latest.memory,
      disk: latest.disk,
      loadAverage: latest.loadAverage,
      uptime: latest.uptime,
    });
  },

  'GET /api/containers': async (req, res) => {
    const latest = collector.getLatest();
    if (!latest) {
      return sendError(res, 'No data collected yet — try again shortly', 503);
    }
    sendJson(res, {
      timestamp: latest.timestamp,
      containers: latest.containers,
    });
  },

  'GET /api/nginx': async (req, res) => {
    const latest = collector.getLatest();
    if (!latest) {
      return sendError(res, 'No data collected yet — try again shortly', 503);
    }
    sendJson(res, {
      timestamp: latest.timestamp,
      nginx: latest.nginx,
    });
  },

  'GET /api/metrics': async (req, res) => {
    const latest = collector.getLatest();
    if (!latest) {
      return sendError(res, 'No data collected yet — try again shortly', 503);
    }
    sendJson(res, latest);
  },

  'GET /api/history': async (req, res) => {
    sendJson(res, {
      interval: collector.COLLECT_INTERVAL,
      snapshots: collector.getHistory(),
    });
  },
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0].replace(/\/+$/, '') || '/';
  const key = `${req.method} ${urlPath}`;

  // Check API routes first
  const handler = routes[key];
  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Error handling ${key}:`, err);
      sendError(res, 'Internal server error');
    }
    return;
  }

  // Fall through to static file serving
  // Map "/" to "/index.html"
  const fileName = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, fileName);

  // Security: make sure the resolved path is still within PUBLIC_DIR
  // This prevents directory traversal attacks like "/../../../etc/passwd"
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendError(res, 'Forbidden', 403);
  }

  serveStaticFile(res, resolved);
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log(`WebSocket client connected (total: ${wss.clients.size})`);
  collector.addClient(ws);

  ws.on('close', () => {
    console.log(`WebSocket client disconnected (total: ${wss.clients.size})`);
  });
});

// ---------------------------------------------------------------------------
// Start everything
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Dashboard server listening on port ${PORT}`);
  collector.start();
});