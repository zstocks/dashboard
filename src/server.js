// server.js — Dashboard API server with WebSocket support
//
// HTTP endpoints serve JSON from the ring buffer (collected on interval).
// WebSocket clients receive live pushes every collection cycle.
//
// Routes:
//   GET /               — basic info + status
//   GET /health         — health check
//   GET /api/system     — latest system metrics (CPU, memory, disk, load, uptime)
//   GET /api/containers — latest Docker container stats
//   GET /api/nginx      — latest Nginx metrics
//   GET /api/metrics    — latest full snapshot
//   GET /api/history    — full ring buffer (for chart backfill)
//   WS  /ws             — WebSocket stream (live updates)

const http = require('http');
const { WebSocketServer } = require('ws');
const collector = require('./collector');

const PORT = process.env.PORT || 3000;

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
// API endpoints now read from the collector's ring buffer instead of
// calling metric functions directly. This means:
// - Responses are instant (no waiting for Docker/Nginx HTTP calls)
// - All clients see the same data for the same collection cycle
// - History is available for charts
// ---------------------------------------------------------------------------
const routes = {
  'GET /': async (req, res) => {
    sendJson(res, {
      app: 'dashboard',
      version: '1.0.0',
      status: 'collecting',
      interval: `${collector.COLLECT_INTERVAL / 1000}s`,
      historySize: collector.getHistory().length,
      wsClients: collector.getClientCount(),
      endpoints: [
        'GET /health',
        'GET /api/system',
        'GET /api/containers',
        'GET /api/nginx',
        'GET /api/metrics',
        'GET /api/history',
        'WS  /ws',
      ],
    });
  },

  'GET /health': async (req, res) => {
    sendJson(res, { status: 'ok', app: 'dashboard' });
  },

  // Individual metric endpoints — pull specific sections from the latest snapshot
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

  // Full snapshot — everything in one call
  'GET /api/metrics': async (req, res) => {
    const latest = collector.getLatest();
    if (!latest) {
      return sendError(res, 'No data collected yet — try again shortly', 503);
    }
    sendJson(res, latest);
  },

  // Full history — for chart backfill on page load
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

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
// The WebSocket server shares the same HTTP server. When a client
// connects to /ws, the HTTP upgrade handshake is handled by the ws
// library, and from then on it's a persistent bidirectional connection.
//
// On connect, the client receives the full history. After that,
// new snapshots are pushed automatically every collection cycle.
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