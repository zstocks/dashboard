// auth.js — Simple cookie-based authentication
//
// How it works:
//
// 1. User visits the dashboard → server checks for a session cookie
// 2. No cookie (or invalid cookie) → redirect to /login
// 3. User submits the password → server verifies it
// 4. Correct password → server creates a signed token, sets it as a cookie
// 5. Subsequent requests include the cookie → server validates the signature
//
// The token is an HMAC-SHA256 signature. HMAC takes two inputs:
//   - A secret key (SESSION_SECRET env var)
//   - A message to sign (we use "dashboard-session" + creation timestamp)
//
// The server can verify the token by recalculating the HMAC and comparing.
// If someone modifies the cookie value, the signature won't match.
//
// This is NOT the same as encryption — the token content is readable.
// But it IS tamper-proof: you can't forge a valid token without the secret.

const crypto = require('crypto');
const net = require('net');

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------
// AUTH_MODE: how requests are authenticated (optional, default "password")
//   "password" — cookie session issued after a correct password (original)
//   "tailnet"  — trust any request that arrived over the Tailscale interface
// DASHBOARD_PASSWORD: the password to access the dashboard (password mode)
// SESSION_SECRET: secret key for signing session tokens (password mode)
//
// All are set in .env. The server refuses to start on an invalid mode, or on
// a missing password/secret in password mode.
// ---------------------------------------------------------------------------
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const AUTH_MODE = process.env.AUTH_MODE || 'password';

// ---------------------------------------------------------------------------
// Tailnet address ranges
// ---------------------------------------------------------------------------
// Tailscale assigns every node an IPv4 from the CGNAT block and an IPv6 from
// its own ULA /48. These must match the allow list in Nginx's
// snippets/tailnet-only.conf — Nginx is gate one, this is gate two.
// ---------------------------------------------------------------------------
const TAILNET = new net.BlockList();
TAILNET.addSubnet('100.64.0.0', 10, 'ipv4');
TAILNET.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6');

// Cookie expires after 7 days (in milliseconds)
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Cookie name
const COOKIE_NAME = 'dashboard_session';

// ---------------------------------------------------------------------------
// Validate that required env vars are set
// ---------------------------------------------------------------------------
function validateConfig() {
  if (AUTH_MODE !== 'password' && AUTH_MODE !== 'tailnet') {
    console.error(`ERROR: AUTH_MODE must be "password" or "tailnet" (got "${AUTH_MODE}")`);
    process.exit(1);
  }

  if (AUTH_MODE === 'tailnet') {
    console.log('Auth mode: tailnet — password login disabled, trusting X-Real-IP within Tailscale ranges');
    return;
  }

  if (!DASHBOARD_PASSWORD) {
    console.error('ERROR: DASHBOARD_PASSWORD environment variable is required');
    process.exit(1);
  }
  if (!SESSION_SECRET) {
    console.error('ERROR: SESSION_SECRET environment variable is required');
    process.exit(1);
  }
  if (DASHBOARD_PASSWORD.length < 8) {
    console.error('ERROR: DASHBOARD_PASSWORD must be at least 8 characters');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Create a signed session token
// ---------------------------------------------------------------------------
// The token format is: timestamp.signature
//
// The timestamp records when the session was created, so we can expire it.
// The signature proves the token was created by this server.
// ---------------------------------------------------------------------------
function createToken() {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update('dashboard-session:' + timestamp)
    .digest('hex');

  return timestamp + '.' + signature;
}

// ---------------------------------------------------------------------------
// Verify a session token
// ---------------------------------------------------------------------------
// Checks two things:
// 1. The signature is valid (token wasn't tampered with)
// 2. The token hasn't expired
// ---------------------------------------------------------------------------
function verifyToken(token) {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;

  // Check expiration
  const created = parseInt(timestamp, 10);
  if (isNaN(created)) return false;
  if (Date.now() - created > SESSION_MAX_AGE) return false;

  // Recalculate the signature and compare
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update('dashboard-session:' + timestamp)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  // (constant-time comparison so attackers can't guess the signature
  // byte by byte based on how long the comparison takes)
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Check if a password attempt is correct
// ---------------------------------------------------------------------------
function checkPassword(attempt) {
  if (!attempt) return false;

  // Use timingSafeEqual here too, to prevent timing attacks on the password
  const attemptBuf = Buffer.from(attempt);
  const passwordBuf = Buffer.from(DASHBOARD_PASSWORD);

  // Buffers must be the same length for timingSafeEqual
  if (attemptBuf.length !== passwordBuf.length) return false;

  return crypto.timingSafeEqual(attemptBuf, passwordBuf);
}

// ---------------------------------------------------------------------------
// Parse cookies from the request
// ---------------------------------------------------------------------------
// Cookies arrive as a single header string like:
//   "name1=value1; name2=value2; name3=value3"
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;

  header.split(';').forEach(function (pair) {
    const [name, ...rest] = pair.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });

  return cookies;
}

// ---------------------------------------------------------------------------
// Build a Set-Cookie header value
// ---------------------------------------------------------------------------
function buildCookieHeader(token) {
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE / 1000);
  return (
    COOKIE_NAME + '=' + token +
    '; Path=/' +
    '; HttpOnly' +       // JavaScript can't read it (XSS protection)
    '; Secure' +         // Only sent over HTTPS
    '; SameSite=Strict' + // Not sent on cross-site requests (CSRF protection)
    '; Max-Age=' + maxAgeSeconds
  );
}

// ---------------------------------------------------------------------------
// Build a cookie-clearing header (for logout)
// ---------------------------------------------------------------------------
function buildClearCookieHeader() {
  return (
    COOKIE_NAME + '=' +
    '; Path=/' +
    '; HttpOnly' +
    '; Secure' +
    '; SameSite=Strict' +
    '; Max-Age=0'
  );
}

// ---------------------------------------------------------------------------
// Tailnet check
// ---------------------------------------------------------------------------
// Nginx sets X-Real-IP to $remote_addr on every proxied request, overwriting
// anything the client sent. We deliberately ignore X-Forwarded-For: Nginx
// *appends* to that one, so a client can plant a fake first entry.
//
// Trust boundary: the container is bound to 127.0.0.1 on the host, so only
// Nginx can reach it to set this header. Fail closed — a missing or
// unparseable header is treated as not-from-tailnet.
// ---------------------------------------------------------------------------
function getClientIp(req) {
  const raw = req.headers['x-real-ip'];
  if (!raw) return null;
  const ip = String(raw).trim();
  return net.isIP(ip) ? ip : null;
}

function isFromTailnet(req) {
  const ip = getClientIp(req);
  if (!ip) return false;
  const family = net.isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  return TAILNET.check(ip, family);
}

// ---------------------------------------------------------------------------
// Check if a request is authenticated
// ---------------------------------------------------------------------------
function isAuthenticated(req) {
  if (AUTH_MODE === 'tailnet') {
    return isFromTailnet(req);
  }
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verifyToken(token);
}

module.exports = {
  AUTH_MODE,
  validateConfig,
  createToken,
  verifyToken,
  checkPassword,
  parseCookies,
  buildCookieHeader,
  buildClearCookieHeader,
  isAuthenticated,
  isFromTailnet,
  COOKIE_NAME,
};
