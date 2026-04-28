require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const deterministicId = (str) => crypto.createHash('md5').update(str).digest('hex');
const path = require('path');
const store = require('./store.cjs');
const { encrypt, decrypt } = require('./crypto.cjs');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'tartan-renewals-fallback-secret-2026';
const PORT = process.env.PORT || 3001;

// ── Helpers ──────────────────────────────────────────────────────────

function logAudit(userId, username, role, action, details) {
  try {
    store.append('audit', {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      userId, username, role, action, details
    });
  } catch (e) { console.error('Audit failed:', e); }
}

function authenticate(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.split(' ')[1], JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

function requireSuperadmin(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── Init Data ────────────────────────────────────────────────────────

try {
  (function initAll() {
    // 1. Superadmin
    const users = store.read('users');
    const adminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
    if (!users.find(u => u.role === 'superadmin')) {
      users.push({
        id: deterministicId('superadmin-' + adminUsername),
        username: adminUsername,
        passwordHash: bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD || 'admin123', 10),
        role: 'superadmin',
        createdAt: new Date().toISOString()
      });
      store.write('users', users);
    }

    // 2. Credentials
    const creds = store.read('credentials');
    if (creds.length === 0) {
      const defaults = [
        ["Prosperr.io","ankur@prosperr.io","4IOISi7E"],
        ["MMT","sakar+mybizfd5ece","2lrMvXlT"],
        ["Bharatsure","risvan@bharatsure.com","Tartan@2025"],
        ["Tifin India","siddharth@tifin.com","5llxWRVv"],
        ["HDFC Bank Baas","chirag@tartanhq.com","DIADHfRa"],
        ["Plum Benefits","PlumBenefitsTesting","eU59b851"],
        ["HDFC Pension","akshaya+sriram@tartanhq.com","uBhDNqNH"],
        ["Acko","ankur+acko@tartanhq.com","Acko-tartan@2025"],
        ["Pensionbox","developer@pensionbox.in","CNPS@pensionbox"],
        ["Policynation","jayakumar.g@policynation.com","Policynation-tartanHQ@2025"],
        ["Loop","prashant.prabhakar@loophealth.com","oVixirBU"],
        ["Happay by MMT","MyBiz_API_User","API_User@my_biz"],
        ["BenefitWise (Earnest)","koushik.puppala@earnestdata-analytics.in","benefitwise-tartanHQ@2025"],
        ["Ekincare","ankur+ekinUAT@tartanhq.com","ekin-tartan@2025"],
        ["Tripjack","ankur+tripjackf8bdeb","tripjack-sync@2025"],
        ["Tripare","kaushal42c836","Tripare@2026"],
        ["Tifin USA","shoaib.haroon6eca9c","h123456789@H"],
        ["TravelPlus","ankur+travelpluspoc@tartanhq.com","travelplus-tartan@2025"],
        ["GoPrimo","amar7e8bc6","goprimo@2026"],
        ["Ungender","ankur+getconductd51518","getconduct-tartan@2025"],
        ["Ziptrip","ankur+ziptrrippoc74453e","ziptrrip-sync@2025"]
      ];
      defaults.forEach(([clientName, username, password]) => {
        creds.push({
          id: deterministicId('cred-' + clientName), clientName,
          username: encrypt(username), password: encrypt(password),
          createdAt: new Date().toISOString()
        });
      });
      store.write('credentials', creds);
    }

    // 3. Tools
    const tools = store.read('tools');
    const toolDefaults = [
      { name: "Run Initial Sync", curl: "...", variables: ["org_id"], environments: ["Prod", "Dev", "Test"] },
      { name: "Payroll Connection Activation", curl: "...", variables: ["org_id"], environments: ["Prod", "Dev", "Test"] },
      { name: "Data Purge API", curl: "...", variables: ["org_id", "vendor_org_id"], environments: ["Prod", "Dev", "Test"] }
    ];
    let toolAdded = false;
    toolDefaults.forEach(def => {
      if (!tools.find(t => t.name === def.name)) {
        tools.push({ id: deterministicId('tool-' + def.name), ...def, createdAt: new Date().toISOString() });
        toolAdded = true;
      }
    });
    if (toolAdded) store.write('tools', tools);
  })();
} catch (e) { console.error('Init failed:', e); }

// ── AUTH ROUTES ──────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = store.read('users');
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  logAudit(user.id, user.username, user.role, 'LOGIN', 'User logged in');
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ── USER MANAGEMENT ──────────────────────────────────────────────────

app.get('/api/users', authenticate, requireSuperadmin, (req, res) => {
  res.json(store.read('users').map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })));
});

app.post('/api/users', authenticate, requireSuperadmin, (req, res) => {
  const { username, password, role } = req.body;
  const users = store.read('users');
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'Exists' });
  const newUser = { id: uuidv4(), username, passwordHash: bcrypt.hashSync(password, 10), role: role || 'user', createdAt: new Date().toISOString() };
  users.push(newUser);
  store.write('users', users);
  res.json({ id: newUser.id, username });
});

app.delete('/api/users/:id', authenticate, requireSuperadmin, (req, res) => {
  const users = store.read('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user || user.role === 'superadmin') return res.status(403).json({ error: 'Denied' });
  store.write('users', users.filter(u => u.id !== req.params.id));
  res.json({ message: 'Deleted' });
});

// ── CREDENTIALS ──────────────────────────────────────────────────────

app.get('/api/credentials', authenticate, (req, res) => {
  const creds = store.read('credentials').map(c => ({ id: c.id, clientName: c.clientName, createdAt: c.createdAt }));
  res.json(creds.sort((a,b) => a.clientName.localeCompare(b.clientName)));
});

app.post('/api/credentials', authenticate, (req, res) => {
  const { clientName, username, password } = req.body;
  const creds = store.read('credentials');
  const newCred = { id: uuidv4(), clientName, username: encrypt(username), password: encrypt(password), createdAt: new Date().toISOString() };
  creds.push(newCred);
  store.write('credentials', creds);
  res.json({ id: newCred.id, clientName });
});

app.delete('/api/credentials/:id', authenticate, (req, res) => {
  const creds = store.read('credentials');
  store.write('credentials', creds.filter(c => c.id !== req.params.id));
  res.json({ message: 'Deleted' });
});

app.get('/api/credentials/:id/reveal', authenticate, (req, res) => {
  const cred = store.read('credentials').find(c => c.id === req.params.id);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  res.json({ username: decrypt(cred.username), password: decrypt(cred.password) });
});

// ── CONNECTIONS PROXY ────────────────────────────────────────────────

app.get('/api/connections/:credId', authenticate, async (req, res) => {
  const cred = store.read('credentials').find(c => c.id === req.params.credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const username = decrypt(cred.username);
  const password = decrypt(cred.password);
  try {
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const loginData = await loginRes.json();
    const dataRes = await fetch('https://node.tartanhq.com/api/dashboard/vendor/connections/?status=active&page_size=300&page=1&is_post_processing_rules_added=false&sort=last_successful_sync%3Adesc', {
      headers: { 'Authorization': 'Bearer ' + loginData.access_token }
    });
    res.json(await dataRes.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TOOLS ────────────────────────────────────────────────────────────

app.get('/api/tools', authenticate, (req, res) => res.json(store.read('tools')));

app.post('/api/tools', authenticate, (req, res) => {
  const { name, curl, variables, environments } = req.body;
  const tools = store.read('tools');
  const newTool = { id: uuidv4(), name, curl, variables: variables || [], environments: environments || [], createdAt: new Date().toISOString() };
  tools.push(newTool);
  store.write('tools', tools);
  res.json(newTool);
});

app.post('/api/tools/execute', authenticate, async (req, res) => {
  const { credId, url, method, headers, body, environment } = req.body;
  const cred = store.read('credentials').find(c => c.id === credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const username = decrypt(cred.username);
  const password = decrypt(cred.password);
  try {
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const loginData = await loginRes.json();
    let finalUrl = url;
    if (environment && environment.toLowerCase() !== 'prod') {
      finalUrl = finalUrl.replace('node.tartanhq.com', environment.toLowerCase() + '-node.tartanhq.com');
    }
    const finalHeaders = { ...headers, 'Authorization': 'Bearer ' + loginData.access_token };
    const toolRes = await fetch(finalUrl, { method: method || 'GET', headers: finalHeaders, body: body ? JSON.stringify(body) : undefined });
    res.status(toolRes.status).json(await toolRes.json().catch(() => ({})));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AUDIT LOG ────────────────────────────────────────────────────────

app.get('/api/audit', authenticate, (req, res) => res.json(store.read('audit').reverse()));

// ── VENDOR INFO ──────────────────────────────────────────────────────

app.get('/api/vendor-info/:credId', authenticate, async (req, res) => {
  const cred = store.read('credentials').find(c => c.id === req.params.credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const username = decrypt(cred.username);
  const password = decrypt(cred.password);
  try {
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const loginData = await loginRes.json();
    const userRes = await fetch('https://node.tartanhq.com/api/dashboard/user/', {
      headers: { 'Authorization': 'Bearer ' + loginData.access_token }
    });
    const userData = await userRes.json();
    res.json({ vendor_org_id: userData.Organisation?.id, org_name: userData.Organisation?.org_name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── APPROVALS ────────────────────────────────────────────────────────

app.get('/api/approvals', authenticate, requireSuperadmin, (req, res) => {
  res.json(store.read('approvals').filter(a => a.status === 'pending').reverse());
});

app.post('/api/approvals/request', authenticate, (req, res) => {
  const { action, targetId, details } = req.body;
  const newRequest = { id: uuidv4(), status: 'pending', action, targetId, details, requestedBy: req.user.username, requestedAt: new Date().toISOString() };
  store.append('approvals', newRequest);
  res.json(newRequest);
});

if (process.env.VERCEL !== '1') app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
