/** Minimal auth + health handlers for Vercel (fast cold start, no full Express load). */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const store = require('./store.cjs');

const JWT_SECRET = process.env.JWT_SECRET || 'tartan-renewals-fallback-secret-2026';
const deterministicId = (str) => crypto.createHash('md5').update(str).digest('hex');

let usersInitDone = false;

function ensureUsersInit() {
  if (usersInitDone) return;
  const users = store.read('users');
  const adminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SUPERADMIN_PASSWORD || 'admin123';
  let superadmin = users.find(u => u.role === 'superadmin');

  if (!superadmin) {
    users.push({
      id: deterministicId('superadmin-' + adminUsername),
      username: adminUsername,
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      role: 'superadmin',
      createdAt: new Date().toISOString(),
    });
    store.write('users', users);
  } else {
    if (superadmin.username !== adminUsername) {
      superadmin.username = adminUsername;
      store.write('users', users);
    }
    if (process.env.SUPERADMIN_PASSWORD) {
      const matches = bcrypt.compareSync(process.env.SUPERADMIN_PASSWORD, superadmin.passwordHash);
      if (!matches) {
        superadmin.passwordHash = bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD, 10);
        store.write('users', users);
      }
    }
  }
  usersInitDone = true;
}

function readJsonBody(req, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    // Some Vercel runtimes provide parsed body directly.
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try {
        return resolve(req.body ? JSON.parse(req.body) : {});
      } catch (e) {
        return reject(e);
      }
    }

    // If stream already ended, avoid waiting forever.
    if (req.readableEnded || req.complete) return resolve({});

    let raw = '';
    let done = false;
    const finish = (fn) => (arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(arg);
    };
    const ok = finish(resolve);
    const fail = finish(reject);

    const timer = setTimeout(() => ok({}), timeoutMs);
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        ok(raw ? JSON.parse(raw) : {});
      } catch (e) {
        fail(e);
      }
    });
    req.on('error', fail);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function handleHealthLive(_req, res) {
  sendJson(res, 200, { ok: true, ts: new Date().toISOString(), vercel: true, lite: true });
}

async function handleLogin(req, res) {
  try {
    ensureUsersInit();
    const { username, password } = await readJsonBody(req);
    if (!username || !password) {
      return sendJson(res, 400, { error: 'Username and password are required' });
    }
    const users = store.read('users');
    const user = users.find(u => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Invalid username or password' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    sendJson(res, 200, { token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('Lite login error:', err);
    sendJson(res, 500, { error: 'Login failed', message: err.message });
  }
}

async function handleAuthMe(req, res) {
  try {
    ensureUsersInit();
    const h = req.headers.authorization || req.headers.Authorization;
    if (!h || !String(h).startsWith('Bearer ')) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    const payload = jwt.verify(String(h).split(' ')[1], JWT_SECRET);
    const users = store.read('users');
    const user = users.find(u => u.id === payload.id);
    if (!user) return sendJson(res, 401, { error: 'Invalid token' });
    sendJson(res, 200, { id: user.id, username: user.username, role: user.role });
  } catch {
    sendJson(res, 401, { error: 'Invalid token' });
  }
}

module.exports = { handleHealthLive, handleLogin, handleAuthMe, ensureUsersInit };
