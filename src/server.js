// server.js — Dashboard API server with auth, WebSocket, alerts, and static files
//
// Routes:
//   GET  /login          — login page (public)
//   POST /login          — authenticate and set session cookie (public)
//   GET  /logout         — clear session cookie and redirect to login
//   GET  /health         — health check (public, for monitoring)
//   GET  /               — dashboard UI (requires auth)
//   GET  /api/system     — latest system metrics (requires auth)
//   GET  /api/containers — latest Docker container stats (requires auth)
//   GET  /api/nginx      — latest Nginx metrics (requires auth)
//   GET  /api/metrics    — latest full snapshot (requires auth)
//   GET  /api/history    — full ring buffer (requires auth)
//   GET  /api/alerts     — currently active alerts (requires auth)
//   WS   /ws             — WebSocket stream (requires auth via cookie)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const collector = require('./collector');
const auth = require('./auth');
const { getActiveAlerts } = require('./alerts');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Validate auth config before anything else
auth.validateConfig();

// ---------------------------------------------------------------------------
// Static file serving
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

function redirect(res, location) {
  res.writeHead(302, { 'Location': location });
  res.end();
}

// ---------------------------------------------------------------------------
// Parse JSON request body
// ---------------------------------------------------------------------------
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Public routes (no auth required)
// ---------------------------------------------------------------------------
const publicRoutes = {
  'GET /health': async (req, res) => {
    sendJson(res, { status: 'ok', app: 'dashboard' });
  },

  'GET /login': async (req, res) => {
    if (auth.isAuthenticated(req)) {
      return redirect(res, '/');
    }
    serveStaticFile(res, path.join(PUBLIC_DIR, 'login.html'));
  },

  'POST /login': async (req, res) => {
    const body = await parseBody(req);

    if (auth.checkPassword(body.password)) {
      const token = auth.createToken();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': auth.buildCookieHeader(token),
      });
      res.end(JSON.stringify({ success: true }));
    } else {
      sendError(res, 'Invalid password', 401);
    }
  },

  'GET /logout': async (req, res) => {
    res.writeHead(302, {
      'Location': '/login',
      'Set-Cookie': auth.buildClearCookieHeader(),
    });
    res.end();
  },
};

// ---------------------------------------------------------------------------
// Protected routes (auth required)
// ---------------------------------------------------------------------------
const protectedRoutes = {
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

  'GET /api/alerts': async (req, res) => {
    sendJson(res, {
      alerts: getActiveAlerts(),
    });
  },
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0].replace(/\/+$/, '') || '/';
  const key = `${req.method} ${urlPath}`;

  // Check public routes first (no auth needed)
  const publicHandler = publicRoutes[key];
  if (publicHandler) {
    try {
      await publicHandler(req, res);
    } catch (err) {
      console.error(`Error handling ${key}:`, err);
      sendError(res, 'Internal server error');
    }
    return;
  }

  // Everything else requires authentication
  if (!auth.isAuthenticated(req)) {
    if (urlPath.startsWith('/api/')) {
      return sendError(res, 'Unauthorized', 401);
    }
    return redirect(res, '/login');
  }

  // Check protected API routes
  const protectedHandler = protectedRoutes[key];
  if (protectedHandler) {
    try {
      await protectedHandler(req, res);
    } catch (err) {
      console.error(`Error handling ${key}:`, err);
      sendError(res, 'Internal server error');
    }
    return;
  }

  // Fall through to static file serving (also requires auth)
  const fileName = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, fileName);

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

wss.on('connection', (ws, req) => {
  if (!auth.isAuthenticated(req)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

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