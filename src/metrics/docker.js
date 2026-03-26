// docker.js — Query Docker Engine API for container metrics
//
// How it works:
// The Docker daemon exposes a REST API over a Unix socket at
// /var/run/docker.sock. We send standard HTTP requests through
// the socket and get JSON responses — same as any REST API,
// just using a file instead of a network port as the transport.
//
// Key endpoints we use:
//   GET /containers/json?all=true     — list all containers (like `docker ps -a`)
//   GET /containers/{id}/json         — inspect one container (detailed info)
//   GET /containers/{id}/stats?stream=false  — one-shot resource stats
//
// The ?stream=false flag on the stats endpoint is important.
// Without it, Docker streams stats continuously (like `docker stats`
// in your terminal). With it, you get a single JSON snapshot and
// the connection closes — which is what we want for polling.
//
// CPU percentage calculation:
// Docker gives us two sets of CPU counters in each stats response:
// cpu_stats (current) and precpu_stats (previous). This is the same
// delta concept as /proc/stat, but Docker conveniently gives us both
// readings in one response so we don't have to store state ourselves.

const http = require('http');

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const API_VERSION = 'v1.44';

// ---------------------------------------------------------------------------
// Helper: Make an HTTP request to the Docker socket
// ---------------------------------------------------------------------------
// This is the core of the module. It sends an HTTP request through
// the Unix socket and returns the parsed JSON response.
//
// Under the hood, this is identical to calling http.request() against
// localhost:port — the only difference is socketPath instead of hostname.
// ---------------------------------------------------------------------------
function dockerRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: SOCKET_PATH,
      path: `/${API_VERSION}${path}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse Docker response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      // Common errors:
      // - ENOENT: socket file doesn't exist (Docker not running or not mounted)
      // - EACCES: permission denied (container user can't access the socket)
      // - ECONNREFUSED: Docker daemon not responding
      reject(new Error(`Docker API request failed: ${err.message}`));
    });

    // Timeout after 5 seconds — stats endpoint can be slow on busy hosts
    req.setTimeout(5000, () => {
      req.destroy(new Error('Docker API request timed out'));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// List all containers
// ---------------------------------------------------------------------------
// Returns basic info for every container (running or stopped).
// This is equivalent to `docker ps -a`.
// ---------------------------------------------------------------------------
async function listContainers() {
  const containers = await dockerRequest('/containers/json?all=true');

  return containers.map((c) => ({
    id: c.Id.slice(0, 12),            // Short ID, same as `docker ps` shows
    name: c.Names[0].replace(/^\//, ''),  // Docker prefixes names with "/"
    image: c.Image,
    state: c.State,                    // "running", "exited", "paused", etc.
    status: c.Status,                  // Human-readable, e.g. "Up 3 hours"
    created: new Date(c.Created * 1000).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Inspect a single container
// ---------------------------------------------------------------------------
// Returns detailed info including restart count, start time, health checks,
// environment variables, port mappings, and more.
// ---------------------------------------------------------------------------
async function inspectContainer(containerId) {
  const info = await dockerRequest(`/containers/${containerId}/json`);

  return {
    id: info.Id.slice(0, 12),
    name: info.Name.replace(/^\//, ''),
    image: info.Config.Image,
    state: info.State.Status,
    startedAt: info.State.StartedAt,
    finishedAt: info.State.FinishedAt,
    restartCount: info.RestartCount,
    // Calculate uptime from StartedAt
    uptimeSeconds: info.State.Status === 'running'
      ? Math.floor((Date.now() - new Date(info.State.StartedAt).getTime()) / 1000)
      : 0,
    ports: Object.entries(info.NetworkSettings.Ports || {}).map(([container, host]) => ({
      container,
      host: host ? host.map((h) => `${h.HostIp || '0.0.0.0'}:${h.HostPort}`).join(', ') : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Get resource stats for a running container
// ---------------------------------------------------------------------------
// CPU and memory usage from Docker's stats endpoint.
//
// CPU calculation:
//   Docker provides cpu_stats.cpu_usage.total_usage (current) and
//   precpu_stats.cpu_usage.total_usage (previous reading).
//   The delta of container CPU time divided by the delta of system
//   CPU time gives us the percentage.
//
// Memory:
//   usage_in_bytes includes cache. To get actual working memory,
//   subtract the cache. The limit is either the container's memory
//   limit or the host's total memory if no limit is set.
// ---------------------------------------------------------------------------
async function getContainerStats(containerId) {
  const stats = await dockerRequest(`/containers/${containerId}/stats?stream=false`);

  // --- CPU percentage ---
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage
                 - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage
                    - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus || 1;

  let cpuPercent = 0;
  if (systemDelta > 0 && cpuDelta >= 0) {
    cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
  }

  // --- Memory ---
  const memUsage = stats.memory_stats.usage || 0;
  // cache is in stats.memory_stats.stats.cache (cgroup v1) or
  // stats.memory_stats.stats.inactive_file (cgroup v2)
  const memCache = stats.memory_stats.stats?.cache
                || stats.memory_stats.stats?.inactive_file
                || 0;
  const memActual = memUsage - memCache;
  const memLimit = stats.memory_stats.limit || 0;

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memory: {
      usageBytes: memActual,
      cacheBytes: memCache,
      limitBytes: memLimit,
      usagePercent: memLimit > 0
        ? Math.round((memActual / memLimit) * 10000) / 100
        : 0,
    },
    network: summarizeNetwork(stats.networks),
    pids: stats.pids_stats?.current || null,
  };
}

// ---------------------------------------------------------------------------
// Summarize network I/O across all interfaces
// ---------------------------------------------------------------------------
function summarizeNetwork(networks) {
  if (!networks) return null;

  let rxBytes = 0;
  let txBytes = 0;

  for (const iface of Object.values(networks)) {
    rxBytes += iface.rx_bytes || 0;
    txBytes += iface.tx_bytes || 0;
  }

  return { rxBytes, txBytes };
}

// ---------------------------------------------------------------------------
// Get full metrics for all containers
// ---------------------------------------------------------------------------
// This is the main function the rest of the app should call.
// It lists all containers, then fetches detailed stats for each
// running one. Stopped containers get basic info but no stats
// (Docker can't report CPU/memory for a stopped container).
// ---------------------------------------------------------------------------
async function getDockerMetrics() {
  const containers = await listContainers();
  const detailed = [];

  for (const container of containers) {
    const info = await inspectContainer(container.id);

    let stats = null;
    if (container.state === 'running') {
      try {
        stats = await getContainerStats(container.id);
      } catch (err) {
        // Stats can fail for containers that just started or are shutting down
        stats = { error: err.message };
      }
    }

    detailed.push({
      ...info,
      stats,
    });
  }

  return detailed;
}

module.exports = { getDockerMetrics, listContainers, inspectContainer, getContainerStats };
