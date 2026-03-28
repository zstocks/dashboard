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

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------
// DASHBOARD_PASSWORD: the password to access the dashboard (required)
// SESSION_SECRET: secret key for signing session tokens (required)
//
// Both are set in docker-compose.yml as environment variables.
// The server will refuse to start if either is missing.
// ---------------------------------------------------------------------------
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

// Cookie expires after 7 days (in milliseconds)
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Cookie name
const COOKIE_NAME = 'dashboard_session';

// ---------------------------------------------------------------------------
// Validate that required env vars are set
// ---------------------------------------------------------------------------
function validateConfig() {
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

  header.split(';').forEach(function(pair) {
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
// Check if a request is authenticated
// ---------------------------------------------------------------------------
function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verifyToken(token);
}

module.exports = {
  validateConfig,
  createToken,
  verifyToken,
  checkPassword,
  parseCookies,
  buildCookieHeader,
  buildClearCookieHeader,
  isAuthenticated,
  COOKIE_NAME,
};
