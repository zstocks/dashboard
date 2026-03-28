// collector.js — Metrics collection engine
//
// This module ties everything together:
// 1. Collects metrics on a fixed interval (default: every 5 seconds)
// 2. Stores each snapshot in a ring buffer (default: 120 entries = 10 minutes)
// 3. Broadcasts each new snapshot to all connected WebSocket clients
//
// The HTTP API endpoints read from the ring buffer instead of
// collecting fresh metrics on every request. This means:
// - Consistent data: every client sees the same snapshot
// - Lower overhead: metrics are collected once, served many times
// - History available: the ring buffer provides data for charts

const RingBuffer = require('./ring-buffer');
const { getSystemMetrics } = require('./metrics');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const COLLECT_INTERVAL = parseInt(process.env.COLLECT_INTERVAL, 10) || 5000;  // ms
const HISTORY_SIZE = parseInt(process.env.HISTORY_SIZE, 10) || 120;           // entries

// 120 entries × 5 seconds = 10 minutes of history
// Adjust via environment variables if you want more or less

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const history = new RingBuffer(HISTORY_SIZE);
let intervalId = null;
let wsClients = new Set();  // Connected WebSocket clients

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
// Called every COLLECT_INTERVAL milliseconds. Collects a full metrics
// snapshot, stores it in the ring buffer, and broadcasts to all
// connected WebSocket clients.
// ---------------------------------------------------------------------------
async function collect() {
  try {
    const snapshot = await getSystemMetrics();
    history.push(snapshot);

    // Broadcast to all connected WebSocket clients
    const message = JSON.stringify(snapshot);
    for (const client of wsClients) {
      // readyState 1 = OPEN (WebSocket.OPEN)
      if (client.readyState === 1) {
        client.send(message);
      } else {
        // Client disconnected — clean up
        wsClients.delete(client);
      }
    }
  } catch (err) {
    console.error('Metrics collection error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Start / stop collection
// ---------------------------------------------------------------------------
function start() {
  if (intervalId) return; // Already running

  console.log(`Collecting metrics every ${COLLECT_INTERVAL / 1000}s, keeping ${HISTORY_SIZE} snapshots`);

  // Collect immediately on start, then on interval
  collect();
  intervalId = setInterval(collect, COLLECT_INTERVAL);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ---------------------------------------------------------------------------
// WebSocket client management
// ---------------------------------------------------------------------------
// Called by server.js when a new WebSocket connection is established.
// We send the full history immediately so the client can populate
// charts without waiting for the next collection cycle.
// ---------------------------------------------------------------------------
function addClient(ws) {
  wsClients.add(ws);

  // Send full history on connect
  const historyData = history.toArray();
  ws.send(JSON.stringify({
    type: 'history',
    data: historyData,
    interval: COLLECT_INTERVAL,
  }));

  // Clean up on disconnect
  ws.on('close', () => {
    wsClients.delete(ws);
  });
}

// ---------------------------------------------------------------------------
// Data access for HTTP endpoints
// ---------------------------------------------------------------------------
// These functions let the API routes read from the ring buffer
// instead of collecting fresh metrics on every request.
// ---------------------------------------------------------------------------
function getLatest() {
  return history.latest();
}

function getHistory() {
  return history.toArray();
}

function getClientCount() {
  return wsClients.size;
}

module.exports = {
  start,
  stop,
  addClient,
  getLatest,
  getHistory,
  getClientCount,
  COLLECT_INTERVAL,
};
