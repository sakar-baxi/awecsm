require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const deterministicId = (str) => crypto.createHash('md5').update(str).digest('hex');
const path = require('path');
const fs = require('fs');
const store = require('./store.cjs');
const { encrypt, decrypt } = require('./crypto.cjs');
const {
  buildIndexEntry,
  searchIndex,
  buildConnectionDetail,
  buildFilterOptions,
} = require('./connection-search.cjs');
const csvSearchStore = require('./csv-search-store.cjs');
const curlRepository = require('./curl-repository.cjs');
const { withTaskTiming, markTaskStarted, markTaskFinished } = require('./task-timing.cjs');
const { normalizeToolBody, parseToolResponse, applyEnvironmentToUrl } = require('./tool-execute.cjs');

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

function readStoreObject(collection, fallback = {}) {
  const data = store.read(collection);
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  return fallback;
}

function isDestructiveToolRequest(method, url) {
  const m = (method || 'GET').toUpperCase();
  const u = String(url || '');
  return m === 'DELETE' || /data_purge|purge|admin\/app_conn/i.test(u);
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
      {
        name: "Run Initial Sync",
        curl: `curl --location 'https://node.tartanhq.com/api/initial_sync/' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {{token}}' \\
--data '{
  "mode": "corporate",
  "org_ids": ["{{org_id}}"],
  "trigger_sync": true
}'`,
        variables: ["org_id"],
        environments: ["Prod", "Dev", "Test"]
      },
      {
        name: "Payroll Connection Activation",
        curl: `curl --location 'https://node.tartanhq.com/api/payroll-connection/update-status/' \\
--header 'Authorization: Bearer {{token}}' \\
--header 'Content-Type: application/json' \\
--data '{
    "org": "{{org_id}}",
    "connection_status": true
}'`,
        variables: ["org_id"],
        environments: ["Prod", "Dev", "Test"]
      },
      {
        name: "Data Purge API",
        curl: `curl --location --request DELETE 'https://node.tartanhq.com/api/admin/app_conn/data_purge?vendor_org={{vendor_org_id}}&client_org={{org_id}}' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer {{token}}'`,
        variables: ["org_id", "vendor_org_id"],
        environments: ["Prod", "Dev", "Test"]
      }
    ];
    let toolAdded = false;
    toolDefaults.forEach(def => {
      const existing = tools.find(t => t.name === def.name);
      if (!existing) {
        tools.push({ id: deterministicId('tool-' + def.name), ...def, createdAt: new Date().toISOString() });
        toolAdded = true;
      } else if (existing.curl === '...') {
        existing.curl = def.curl;
        existing.variables = def.variables;
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
  logAudit(req.user.id, req.user.username, req.user.role, 'ADD_USER', 'Created user ' + username);
  res.json({ id: newUser.id, username });
});

app.put('/api/users/:id/reset-password', authenticate, requireSuperadmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const users = store.read('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.passwordHash = bcrypt.hashSync(password, 10);
  store.write('users', users);
  logAudit(req.user.id, req.user.username, req.user.role, 'RESET_PASSWORD', 'Reset password for ' + user.username);
  res.json({ message: 'Password updated' });
});

app.delete('/api/users/:id', authenticate, requireSuperadmin, (req, res) => {
  const users = store.read('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user || user.role === 'superadmin') return res.status(403).json({ error: 'Denied' });
  store.write('users', users.filter(u => u.id !== req.params.id));
  logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_USER', 'Deleted user ' + user.username);
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
  logAudit(req.user.id, req.user.username, req.user.role, 'ADD_CREDENTIAL', 'Added credential for ' + clientName);
  res.json({ id: newCred.id, clientName });
});

app.post('/api/credentials/import-csv', authenticate, requireSuperadmin, (req, res) => {
  const csvPath = path.join(__dirname, '..', 'credentials.csv');
  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'credentials.csv not found in project root' });
  }
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV is empty' });

  const creds = store.read('credentials');
  let added = 0;
  let updated = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const clientName = parts[0].trim();
    const username = parts[1].trim();
    const password = parts.slice(2).join(',').trim();
    if (!clientName || !username || !password) continue;

    const existing = creds.find(c => c.clientName === clientName);
    if (existing) {
      existing.username = encrypt(username);
      existing.password = encrypt(password);
      updated++;
    } else {
      creds.push({
        id: deterministicId('cred-' + clientName),
        clientName,
        username: encrypt(username),
        password: encrypt(password),
        createdAt: new Date().toISOString(),
      });
      added++;
    }
  }

  store.write('credentials', creds);
  logAudit(req.user.id, req.user.username, req.user.role, 'IMPORT_CREDENTIALS', `Imported CSV: ${added} added, ${updated} updated`);
  res.json({ added, updated, total: creds.length });
});

app.delete('/api/credentials/:id', authenticate, (req, res) => {
  res.status(403).json({ error: 'Credential deletion requires superadmin approval. Submit a deletion request from the Credentials page.' });
});

app.get('/api/credentials/:id/reveal', authenticate, (req, res) => {
  const cred = store.read('credentials').find(c => c.id === req.params.id);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  logAudit(req.user.id, req.user.username, req.user.role, 'REVEAL_CREDENTIAL', 'Revealed credential for ' + cred.clientName);
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
    const connections = await fetchAllConnections(loginData.access_token);
    res.json({
      data: connections,
      pageInfo: { total: connections.length, allPagesFetched: true },
    });
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
  logAudit(req.user.id, req.user.username, req.user.role, 'ADD_TOOL', 'Added tool ' + name);
  res.json(newTool);
});

app.delete('/api/tools/:id', authenticate, (req, res) => {
  res.status(403).json({ error: 'Tool deletion requires superadmin approval. Submit a deletion request from the Tools page.' });
});

app.post('/api/tools/execute', authenticate, async (req, res) => {
  const { credId, url, method, headers, body, environment, toolName } = req.body;
  const cred = store.read('credentials').find(c => c.id === credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });

  const destructive =
    isDestructiveToolRequest(method, url) ||
    /purge|data purge/i.test(toolName || '');
  if (destructive && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Destructive tool execution requires superadmin role.' });
  }

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
    logAudit(req.user.id, req.user.username, req.user.role, 'EXECUTE_TOOL', `${method || 'GET'} ${finalUrl} for ${cred.clientName}`);
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
    res.json({
      vendor_org_id: userData.vendor_org_id || userData.org_id || userData.Organisation?.id || null,
      org_name: userData.org_name || userData.name || userData.Organisation?.org_name || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── APPROVALS ────────────────────────────────────────────────────────

app.get('/api/approvals', authenticate, requireSuperadmin, (req, res) => {
  const status = req.query.status || 'pending';
  let items = store.read('approvals');
  if (status !== 'all') items = items.filter(a => a.status === status);
  res.json(items.reverse());
});

app.get('/api/approvals/mine', authenticate, (req, res) => {
  const items = store.read('approvals').filter(a => a.requestedBy === req.user.username);
  res.json(items.reverse());
});

app.post('/api/approvals/request', authenticate, (req, res) => {
  const { action, targetId, details } = req.body;
  const newRequest = { id: uuidv4(), status: 'pending', action, targetId, details, requestedBy: req.user.username, requestedAt: new Date().toISOString() };
  store.append('approvals', newRequest);
  logAudit(req.user.id, req.user.username, req.user.role, 'REQUEST_' + action, details);
  res.json(newRequest);
});

function findApproval(id) {
  return store.read('approvals').find(a => a.id === id);
}

function updateApproval(id, updates) {
  const approvals = store.read('approvals');
  const idx = approvals.findIndex(a => a.id === id);
  if (idx === -1) return null;
  approvals[idx] = { ...approvals[idx], ...updates };
  store.write('approvals', approvals);
  return approvals[idx];
}

function executeApprovalAction(approval) {
  switch (approval.action) {
    case 'DELETE_CREDENTIAL': {
      const creds = store.read('credentials');
      if (!creds.some(c => c.id === approval.targetId)) throw new Error('Credential not found');
      store.write('credentials', creds.filter(c => c.id !== approval.targetId));
      return { message: 'Credential deleted' };
    }
    case 'DELETE_USER': {
      const users = store.read('users');
      const user = users.find(u => u.id === approval.targetId);
      if (!user) throw new Error('User not found');
      if (user.role === 'superadmin') throw new Error('Cannot delete superadmin');
      store.write('users', users.filter(u => u.id !== approval.targetId));
      return { message: 'User deleted' };
    }
    case 'DELETE_TOOL': {
      const tools = store.read('tools');
      if (!tools.some(t => t.id === approval.targetId)) throw new Error('Tool not found');
      store.write('tools', tools.filter(t => t.id !== approval.targetId));
      return { message: 'Tool deleted' };
    }
    default:
      throw new Error('Unsupported action: ' + approval.action);
  }
}

app.post('/api/approvals/:id/approve', authenticate, requireSuperadmin, (req, res) => {
  const approval = findApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Request not found' });
  if (approval.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  try {
    const result = executeApprovalAction(approval);
    updateApproval(req.params.id, {
      status: 'approved',
      processedBy: req.user.username,
      processedAt: new Date().toISOString(),
    });
    logAudit(req.user.id, req.user.username, req.user.role, 'APPROVE_' + approval.action, approval.details);
    res.json({ ...result, approvalId: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/approvals/:id/reject', authenticate, requireSuperadmin, (req, res) => {
  const approval = findApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Request not found' });
  if (approval.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  updateApproval(req.params.id, {
    status: 'rejected',
    processedBy: req.user.username,
    processedAt: new Date().toISOString(),
  });
  logAudit(req.user.id, req.user.username, req.user.role, 'REJECT_' + approval.action, approval.details);
  res.json({ message: 'Request rejected', approvalId: req.params.id });
});

// ── HEALTH MONITOR ───────────────────────────────────────────────────

let globalCheckState = {
  running: false,
  progress: 0,
  total: 0,
  currentClient: '',
  lastRun: null,
  error: null,
  startedAt: null,
  completedAt: null,
};

/** Known HRMS codes from connections API → display label */
const HRMS_CODE_LABELS = {
  csvupload: 'CSV Upload',
  darwinbox: 'Darwinbox',
  keka: 'Keka',
  greythr: 'GreytHR',
  zoho: 'Zoho People',
  zohopeople: 'Zoho People',
  humaans: 'Humaans',
  bamboohr: 'BambooHR',
  workday: 'Workday',
  successfactors: 'SAP SuccessFactors',
  adp: 'ADP',
  paychex: 'Paychex',
  razorpayx: 'RazorpayX Payroll',
  sumhr: 'SumHR',
  facto: 'FactoHR',
  pocket: 'Pocket HRMS',
  nitso: 'Nitso',
  hrone: 'HR One',
  peoplestrong: 'PeopleStrong',
  paybooks: 'PayBooks',
};

function formatHrmsCode(code) {
  if (!code || String(code).trim() === '') return null;
  const key = String(code).toLowerCase().trim();
  if (HRMS_CODE_LABELS[key]) return HRMS_CODE_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Primary HRMS identity from connections API `hrms_code` */
function getHrmsFromConnection(conn) {
  const hrmsCode = (conn.hrms_code || conn.hrmsCode || '').toString().trim() || null;
  const fromCode = hrmsCode ? formatHrmsCode(hrmsCode) : null;
  const fallback =
    conn.hrms_name ||
    conn.hrms ||
    conn.integration_name ||
    conn.integration ||
    conn.hrms_provider ||
    (conn.vendor && conn.vendor.name) ||
    conn.integration_type ||
    null;
  const hrmsName = fromCode || fallback || 'Unknown HRMS';
  return {
    hrmsCode: hrmsCode || 'unknown',
    hrmsName,
    hrmsDisplay: hrmsCode && hrmsCode !== 'unknown' ? `${hrmsName} (${hrmsCode})` : hrmsName,
  };
}

function getHrmsName(conn) {
  return getHrmsFromConnection(conn).hrmsName;
}

/** Parse sync timestamps (ISO or "22nd May 2026, 01:01 PM") → YYYY-MM-DD */
function parseSyncDateToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      const d = new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10));
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
}

function parseSyncTimestamp(raw) {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).getTime() || 0;
  const m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      let h = parseInt(m[4], 10);
      const min = parseInt(m[5], 10);
      const ampm = (m[6] || '').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10), h, min).getTime() || 0;
    }
  }
  return new Date(s).getTime() || 0;
}

async function fetchAllConnections(token) {
  const all = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 60) {
    const connRes = await fetch(
      `https://node.tartanhq.com/api/dashboard/vendor/connections/?status=active&page_size=100&page=${page}&is_post_processing_rules_added=false&sort=last_successful_sync%3Adesc`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!connRes.ok) throw new Error('Fetch connections failed (page ' + page + ')');
    const connData = await connRes.json();
    if (connData && Array.isArray(connData.data)) all.push(...connData.data);
    hasNext = !!(connData && connData.pageInfo && connData.pageInfo.next);
    page++;
  }
  return all;
}

async function fetchAllSyncLogs(token, fromDate, toDate, maxPages = 20) {
  const allLogs = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= maxPages) {
    const logsRes = await fetch(
      `https://node.tartanhq.com/api/dashboard/sync_logs/?from_date=${fromDate}&to_date=${toDate}&page=${page}&page_size=100`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!logsRes.ok) break;
    const logsData = await logsRes.json();
    if (logsData && Array.isArray(logsData.data)) {
      allLogs.push(...logsData.data);
      hasNext = logsData.pageInfo?.next || false;
    } else {
      hasNext = false;
    }
    page++;
  }
  return allLogs;
}

function classifyConnectionHealth(totalSyncs, successSyncs, failedSyncs) {
  if (totalSyncs === 0) return 'no_sync';
  if (successSyncs === 0 && failedSyncs > 0) return 'failed';
  if (failedSyncs > 0) return 'warning';
  return 'healthy';
}

function buildConnectionHealth(conn, connLogs, dates) {
  const connId = conn.connection_id || conn.id;
  const hrms = getHrmsFromConnection(conn);
  const sortedLogs = [...connLogs].sort(
    (a, b) => parseSyncTimestamp(b.sync_start_time) - parseSyncTimestamp(a.sync_start_time)
  );

  const totalSyncs = sortedLogs.length;
  const successSyncs = sortedLogs.filter(l => l.sync_status === 'success').length;
  const failedSyncs = sortedLogs.filter(l => l.sync_status === 'failed').length;
  const otherSyncs = totalSyncs - successSyncs - failedSyncs;
  const overallStatus = classifyConnectionHealth(totalSyncs, successSyncs, failedSyncs);
  const successRate = totalSyncs > 0 ? Math.round((successSyncs / totalSyncs) * 100) : 0;

  const dailyStatus = dates.map(date => {
    const dayLogs = sortedLogs.filter(l => parseSyncDateToIso(l.sync_start_time) === date);
    let status = 'no_sync';
    let successCount = 0;
    let failedCount = 0;
    dayLogs.forEach(l => {
      if (l.sync_status === 'success') {
        status = 'success';
        successCount++;
      } else if (l.sync_status === 'failed') {
        if (status !== 'success') status = 'failed';
        failedCount++;
      }
    });
    return { date, status, successCount, failedCount, totalCount: dayLogs.length };
  });

  const failures = sortedLogs.filter(l => l.sync_status === 'failed');
  const failureReasons = Array.from(new Set(failures.map(f => f.failure_reason).filter(Boolean)));

  const lastFailedLog = sortedLogs.find(l => l.sync_status === 'failed');
  const partialSyncNote =
    overallStatus === 'warning'
      ? `${successSyncs} succeeded and ${failedSyncs} failed in period (partial sync — not acceptable for steady state)`
      : null;

  return {
    id: connId,
    orgName: conn.org_name || 'Unknown Corporate',
    orgId: conn.org_id,
    hrmsCode: hrms.hrmsCode,
    hrmsName: hrms.hrmsName,
    hrmsDisplay: hrms.hrmsDisplay,
    overallStatus,
    totalSyncs,
    successSyncs,
    failedSyncs,
    otherSyncs,
    successRate,
    dailyStatus,
    lastSyncStatus: sortedLogs[0]?.sync_status || null,
    lastSyncTime: sortedLogs[0]?.sync_start_time || conn.last_successful_sync || null,
    lastFailureReason: lastFailedLog?.failure_reason || null,
    partialSyncNote,
    failureReasons,
    metrics: {
      totalEmployeesFound: sortedLogs.reduce((acc, l) => acc + (l.employees_found || 0), 0),
      totalEmployeesCreated: sortedLogs.reduce((acc, l) => acc + (l.employees_created || 0), 0),
      totalEmployeesUpdated: sortedLogs.reduce((acc, l) => acc + (l.employees_updated || 0), 0),
      avgDurationSeconds:
        sortedLogs.length > 0
          ? Math.round((sortedLogs.reduce((acc, l) => acc + (l.duration_seconds || 0), 0) / sortedLogs.length) * 10) / 10
          : 0,
    },
  };
}

function buildPeriodMetrics(conn, connLogs, dates) {
  const sortedLogs = [...connLogs].sort(
    (a, b) => parseSyncTimestamp(b.sync_start_time) - parseSyncTimestamp(a.sync_start_time)
  );
  const totalSyncs = sortedLogs.length;
  const successSyncs = sortedLogs.filter(l => l.sync_status === 'success').length;
  const failedSyncs = sortedLogs.filter(l => l.sync_status === 'failed').length;
  const status = classifyConnectionHealth(totalSyncs, successSyncs, failedSyncs);
  const successRate = totalSyncs > 0 ? Math.round((successSyncs / totalSyncs) * 100) : 0;
  const successLogs = sortedLogs.filter(l => l.sync_status === 'success');
  const latestSuccess = successLogs[0];
  const earliestSuccess = successLogs[successLogs.length - 1];
  const employeesLatest = latestSuccess?.employees_found ?? null;
  const employeesEarliest = earliestSuccess?.employees_found ?? null;
  return {
    status,
    totalSyncs,
    successSyncs,
    failedSyncs,
    successRate,
    lastFailureReason: sortedLogs.find(l => l.sync_status === 'failed')?.failure_reason || null,
    employeesLatest,
    employeesEarliest,
    employeesCreated: sortedLogs.reduce((a, l) => a + (l.employees_created || 0), 0),
    employeesUpdated: sortedLogs.reduce((a, l) => a + (l.employees_updated || 0), 0),
    employeeDelta:
      employeesLatest != null && employeesEarliest != null ? employeesLatest - employeesEarliest : null,
    dailyBuckets: dates.map(date => {
      const dayLogs = sortedLogs.filter(l => parseSyncDateToIso(l.sync_start_time) === date);
      return {
        date,
        success: dayLogs.filter(l => l.sync_status === 'success').length,
        failed: dayLogs.filter(l => l.sync_status === 'failed').length,
        total: dayLogs.length,
      };
    }),
  };
}

function deriveHrmsAggregateStatus(h) {
  const t = h.totalConnections;
  if (t === 0) return 'healthy';
  if (
    h.failedConnections > 0 &&
    h.healthyConnections === 0 &&
    h.warningConnections === 0 &&
    h.failedConnections + h.noSyncConnections >= t
  ) {
    return 'outage';
  }
  if (h.failedConnections > 0 || h.warningConnections > 0 || h.noSyncConnections > 0) {
    return 'warning';
  }
  return 'healthy';
}

function hrmsStatusExplanation(h, status) {
  if (status === 'healthy') {
    return `All ${h.totalConnections} connections recorded only successful sync attempts in the last 7 days.`;
  }
  if (status === 'outage') {
    return `Every connection under this HRMS failed or had no syncs, with at least one hard failure. Immediate action required.`;
  }
  const parts = [];
  if (h.failedConnections) parts.push(`${h.failedConnections} fully failed`);
  if (h.warningConnections) parts.push(`${h.warningConnections} partial (mixed success/failure)`);
  if (h.noSyncConnections) parts.push(`${h.noSyncConnections} no sync attempts`);
  return `Degraded HRMS: ${parts.join(', ')} in the last 7 days. Partial syncs count as warning — goal is zero partial failures.`;
}

function summarizeFailureReasons(connections) {
  const map = {};
  connections.forEach(c => {
    let r = c.lastFailureReason;
    if (!r && c.status === 'no_sync') r = 'No sync attempts in period';
    if (!r && c.status === 'warning') r = 'Partial sync (success and failure in same period)';
    if (!r) return;
    map[r] = (map[r] || 0) + 1;
  });
  return Object.entries(map)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function buildVendorInsights30d(connections) {
  const byClient = {};
  connections.forEach(c => {
    if (!byClient[c.clientName]) {
      byClient[c.clientName] = { clientName: c.clientName, connections: [] };
    }
    byClient[c.clientName].connections.push({
      orgName: c.orgName,
      connectionId: c.connectionId,
      status7d: c.status,
      status30d: c.metrics30d?.status || 'unknown',
      totalSyncs30d: c.metrics30d?.totalSyncs ?? 0,
      success30d: c.metrics30d?.successSyncs ?? 0,
      failed30d: c.metrics30d?.failedSyncs ?? 0,
      successRate30d: c.metrics30d?.successRate ?? 0,
      lastFailureReason: c.lastFailureReason || c.metrics30d?.lastFailureReason || '',
      employeesLatest: c.metrics30d?.employeesLatest,
      employeeDelta30d: c.metrics30d?.employeeDelta,
    });
  });
  return Object.values(byClient).sort((a, b) => a.clientName.localeCompare(b.clientName));
}

function bucketKey(dateIso, granularity) {
  const d = new Date(dateIso + 'T12:00:00');
  if (granularity === 'yearly') return String(d.getFullYear());
  if (granularity === 'quarterly') {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  if (granularity === 'monthly') return dateIso.slice(0, 7);
  if (granularity === 'weekly') {
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    return start.toISOString().split('T')[0];
  }
  return dateIso;
}

let syncMetricsState = {
  running: false,
  progress: 0,
  total: 0,
  currentClient: '',
  error: null,
  startedAt: null,
  completedAt: null,
};

async function runSyncMetricsInBackground(days, granularity) {
  if (syncMetricsState.running) return;
  markTaskStarted(syncMetricsState);

  const toDate = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const dates = [];
  let curr = new Date(fromDate);
  const end = new Date(toDate);
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }

  const bucketMap = {};
  const failureReasonMap = {};
  const hrmsPerformanceMap = {};
  const clientHealthMap = {};
  const employeeBucketMap = {};
  
  let totalConnections = 0;
  let totalSyncs = 0;
  let successSyncs = 0;
  let failedSyncs = 0;
  let employeesLatestSum = 0;
  let employeesLatestForDeltaSum = 0;
  let employeesEarliestSum = 0;
  let employeesCreatedSum = 0;
  let employeesUpdatedSum = 0;
  let connectionsWithEmployeeDelta = 0;
  let connectionsWithEmployees = 0;
  let partialSyncConnections = 0;

  try {
    const credentials = store.read('credentials');
    syncMetricsState.total = credentials.length;

    for (const cred of credentials) {
      syncMetricsState.currentClient = cred.clientName;
      try {
        const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: decrypt(cred.username), password: decrypt(cred.password) }),
        });
        if (!loginRes.ok) throw new Error('UMS login failed');
        const { access_token: token } = await loginRes.json();
        const connections = await fetchAllConnections(token);
        const logs = await fetchAllSyncLogs(token, fromDate, toDate, Math.min(50, Math.ceil(days / 7) + 5));
        totalConnections += connections.length;

        let clientTotalSyncs = 0;
        let clientSuccessSyncs = 0;
        let clientFailedSyncs = 0;
        let clientEmployeesLatest = 0;

        connections.forEach(conn => {
          const connId = conn.connection_id || conn.id;
          const hrms = getHrmsFromConnection(conn);
          const connLogs = logs.filter(l => l.connection_id === connId);
          const pm = buildPeriodMetrics(conn, connLogs, dates);
          
          totalSyncs += pm.totalSyncs;
          successSyncs += pm.successSyncs;
          failedSyncs += pm.failedSyncs;
          clientTotalSyncs += pm.totalSyncs;
          clientSuccessSyncs += pm.successSyncs;
          clientFailedSyncs += pm.failedSyncs;
          
          employeesCreatedSum += pm.employeesCreated;
          employeesUpdatedSum += pm.employeesUpdated;
          if (pm.employeesLatest != null) {
            employeesLatestSum += pm.employeesLatest;
            clientEmployeesLatest += pm.employeesLatest;
            connectionsWithEmployees++;
          }
          if (pm.employeesLatest != null && pm.employeesEarliest != null) {
            employeesLatestForDeltaSum += pm.employeesLatest;
            employeesEarliestSum += pm.employeesEarliest;
            connectionsWithEmployeeDelta++;
          }
          if (pm.status === 'warning') partialSyncConnections++;

          // Track HRMS Performance
          const hrmsKey = hrms.hrmsCode || hrms.hrmsName;
          if (!hrmsPerformanceMap[hrmsKey]) {
            hrmsPerformanceMap[hrmsKey] = {
              hrmsCode: hrms.hrmsCode,
              hrmsName: hrms.hrmsName,
              hrmsDisplay: hrms.hrmsDisplay,
              totalConnections: 0,
              totalSyncs: 0,
              successSyncs: 0,
              failedSyncs: 0,
              successRate: 0
            };
          }
          hrmsPerformanceMap[hrmsKey].totalConnections++;
          hrmsPerformanceMap[hrmsKey].totalSyncs += pm.totalSyncs;
          hrmsPerformanceMap[hrmsKey].successSyncs += pm.successSyncs;
          hrmsPerformanceMap[hrmsKey].failedSyncs += pm.failedSyncs;
          hrmsPerformanceMap[hrmsKey].successRate = 
            hrmsPerformanceMap[hrmsKey].totalSyncs > 0 
              ? Math.round((hrmsPerformanceMap[hrmsKey].successSyncs / hrmsPerformanceMap[hrmsKey].totalSyncs) * 100) 
              : 0;

          // Time series buckets
          pm.dailyBuckets.forEach(b => {
            if (b.total === 0) return;
            const key = bucketKey(b.date, granularity);
            if (!bucketMap[key]) bucketMap[key] = { label: key, success: 0, failed: 0, total: 0 };
            bucketMap[key].success += b.success;
            bucketMap[key].failed += b.failed;
            bucketMap[key].total += b.total;
          });

          // Employee count per day: latest success log employees_found per connection per calendar day
          const successLogsByDay = {};
          connLogs
            .filter(l => l.sync_status === 'success')
            .forEach(l => {
              const day = parseSyncDateToIso(l.sync_start_time);
              if (!day) return;
              const ts = parseSyncTimestamp(l.sync_start_time);
              if (!successLogsByDay[day] || ts > successLogsByDay[day].ts) {
                successLogsByDay[day] = { ts, count: l.employees_found || 0 };
              }
            });
          Object.entries(successLogsByDay).forEach(([day, info]) => {
            const key = bucketKey(day, granularity);
            if (!employeeBucketMap[key]) employeeBucketMap[key] = { label: key, value: 0 };
            employeeBucketMap[key].value += info.count;
          });

          connLogs
            .filter(l => l.sync_status === 'failed' && l.failure_reason)
            .forEach(l => {
              failureReasonMap[l.failure_reason] = (failureReasonMap[l.failure_reason] || 0) + 1;
            });
        });

        // Track Client Health for CSM
        clientHealthMap[cred.clientName] = {
          clientName: cred.clientName,
          totalConnections: connections.length,
          totalSyncs: clientTotalSyncs,
          successSyncs: clientSuccessSyncs,
          failedSyncs: clientFailedSyncs,
          successRate: clientTotalSyncs > 0 ? Math.round((clientSuccessSyncs / clientTotalSyncs) * 100) : 0,
          employeesLatest: clientEmployeesLatest
        };
      } catch (err) {
        console.error('Sync metrics client error', cred.clientName, err.message);
      }
      syncMetricsState.progress++;
    }

    const timeSeries = Object.values(bucketMap).sort((a, b) => a.label.localeCompare(b.label));
    const employeeTimeSeries = Object.values(employeeBucketMap).sort((a, b) => a.label.localeCompare(b.label));
    const topFailureReasons = Object.entries(failureReasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const hrmsPerformance = Object.values(hrmsPerformanceMap)
      .sort((a, b) => b.totalConnections - a.totalConnections);
    const clientHealth = Object.values(clientHealthMap)
      .sort((a, b) => a.successRate - b.successRate);

    store.write('sync_metrics', {
      generatedAt: new Date().toISOString(),
      days,
      granularity,
      fromDate,
      toDate,
      summary: {
        totalConnections,
        totalSyncs,
        successSyncs,
        failedSyncs,
        otherSyncs: totalSyncs - successSyncs - failedSyncs,
        successRate: totalSyncs > 0 ? Math.round((successSyncs / totalSyncs) * 100) : 0,
        employeesSyncedLatest: employeesLatestSum,
        employeesEarliestInPeriod: employeesEarliestSum,
        connectionsWithEmployeeData: connectionsWithEmployees,
        connectionsWithEmployeeDelta,
        employeesCreatedInPeriod: employeesCreatedSum,
        employeesUpdatedInPeriod: employeesUpdatedSum,
        employeeNetChangeInPeriod:
          connectionsWithEmployeeDelta > 0 ? employeesLatestForDeltaSum - employeesEarliestSum : 0,
        outageAttempts: failedSyncs,
        partialSyncConnectionsEstimate: partialSyncConnections,
      },
      timeSeries,
      employeeTimeSeries,
      topFailureReasons,
      hrmsPerformance,
      clientHealth
    });
  } catch (err) {
    syncMetricsState.error = err.message;
  } finally {
    markTaskFinished(syncMetricsState);
  }
}

async function runGlobalCheckInBackground() {
  if (globalCheckState.running) return;
  markTaskStarted(globalCheckState);
  
  try {
    const credentials = store.read('credentials');
    globalCheckState.total = credentials.length;
    
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const fromDate30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dates30 = [];
    let c30 = new Date(fromDate30);
    const end30 = new Date(toDate);
    while (c30 <= end30) {
      dates30.push(c30.toISOString().split('T')[0]);
      c30.setDate(c30.getDate() + 1);
    }
    
    const allHrmsConnections = [];
    const clientSummary = [];
    
    for (const cred of credentials) {
      globalCheckState.currentClient = cred.clientName;
      
      try {
        const username = decrypt(cred.username);
        const password = decrypt(cred.password);
        
        // Ums login
        const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (!loginRes.ok) throw new Error('UMS Login failed');
        const loginData = await loginRes.json();
        
        const activeConnections = await fetchAllConnections(loginData.access_token);
        const logs = await fetchAllSyncLogs(loginData.access_token, fromDate, toDate, 15);
        const logs30 = await fetchAllSyncLogs(loginData.access_token, fromDate30, toDate, 35);

        const dates = [];
        let curr = new Date(fromDate);
        const end = new Date(toDate);
        while (curr <= end) {
          dates.push(curr.toISOString().split('T')[0]);
          curr.setDate(curr.getDate() + 1);
        }

        let clientHealthy = 0;
        let clientWarning = 0;
        let clientFailed = 0;
        let clientNoSync = 0;

        activeConnections.forEach(conn => {
          const connId = conn.connection_id || conn.id;
          const connLogs = logs.filter(l => l.connection_id === connId);
          const built = buildConnectionHealth(conn, connLogs, dates);
          const status = built.overallStatus;

          if (status === 'healthy') clientHealthy++;
          else if (status === 'warning') clientWarning++;
          else if (status === 'failed') clientFailed++;
          else if (status === 'no_sync') clientNoSync++;

          const connLogs30 = logs30.filter(l => l.connection_id === connId);
          const metrics30d = buildPeriodMetrics(conn, connLogs30, dates30);

          allHrmsConnections.push({
            connectionId: connId,
            orgName: built.orgName,
            orgId: built.orgId,
            clientName: cred.clientName,
            clientId: cred.id,
            hrmsCode: built.hrmsCode,
            hrmsName: built.hrmsName,
            hrmsDisplay: built.hrmsDisplay,
            status,
            totalAttempts: built.totalSyncs,
            successAttempts: built.successSyncs,
            failedAttempts: built.failedSyncs,
            successRate: built.successRate,
            lastSyncTime: built.lastSyncTime,
            lastFailureReason: built.lastFailureReason,
            partialSyncNote: built.partialSyncNote,
            metrics30d,
          });
        });

        clientSummary.push({
          clientId: cred.id,
          clientName: cred.clientName,
          status: 'success',
          totalConnections: activeConnections.length,
          healthy: clientHealthy,
          warning: clientWarning,
          failed: clientFailed,
          noSync: clientNoSync,
        });
      } catch (err) {
        console.error(`Global Health Check failed for client ${cred.clientName}:`, err.message);
        clientSummary.push({
          clientId: cred.id,
          clientName: cred.clientName,
          status: 'error',
          error: err.message
        });
      }
      
      globalCheckState.progress++;
    }
    
    const hrmsMap = {};
    allHrmsConnections.forEach(conn => {
      const key = conn.hrmsCode || conn.hrmsName;
      if (!hrmsMap[key]) {
        hrmsMap[key] = {
          hrmsCode: conn.hrmsCode,
          hrmsName: conn.hrmsName,
          hrmsDisplay: conn.hrmsDisplay,
          clients: new Set(),
          connections: [],
          totalConnections: 0,
          failedConnections: 0,
          warningConnections: 0,
          healthyConnections: 0,
          noSyncConnections: 0,
        };
      }

      hrmsMap[key].clients.add(conn.clientName);
      hrmsMap[key].connections.push(conn);
      hrmsMap[key].totalConnections++;

      if (conn.status === 'failed') hrmsMap[key].failedConnections++;
      else if (conn.status === 'warning') hrmsMap[key].warningConnections++;
      else if (conn.status === 'healthy') hrmsMap[key].healthyConnections++;
      else if (conn.status === 'no_sync') hrmsMap[key].noSyncConnections++;
    });

    const hrmsList = Object.values(hrmsMap).map(h => {
      const status = deriveHrmsAggregateStatus(h);
      const healthScore =
        h.totalConnections > 0
          ? Math.round((h.healthyConnections / h.totalConnections) * 100)
          : 100;

      return {
        hrmsCode: h.hrmsCode,
        hrmsName: h.hrmsName,
        hrmsDisplay: h.hrmsDisplay,
        clients: Array.from(h.clients),
        totalConnections: h.totalConnections,
        failedConnections: h.failedConnections,
        warningConnections: h.warningConnections,
        healthyConnections: h.healthyConnections,
        noSyncConnections: h.noSyncConnections,
        healthScore,
        status,
        statusExplanation: hrmsStatusExplanation(h, status),
        failureReasonSummary: summarizeFailureReasons(h.connections),
        vendorInsights30d: buildVendorInsights30d(h.connections),
        connections: h.connections.sort((a, b) => {
          const rank = { failed: 0, no_sync: 1, warning: 2, healthy: 3 };
          return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        }),
      };
    }).sort((a, b) => b.failedConnections - a.failedConnections || b.warningConnections - a.warningConnections);

    const alerts = allHrmsConnections
      .filter(c => c.status === 'failed' || c.status === 'no_sync' || c.status === 'warning')
      .map(c => ({
        ...c,
        disruptionLabel:
          c.status === 'failed'
            ? 'FAILED'
            : c.status === 'warning'
              ? 'PARTIAL'
              : 'NO SYNC',
      }));

    store.write('health_status', {
      lastRun: new Date().toISOString(),
      disruptionWindow: { from: fromDate, to: toDate, days: 7 },
      hrmsList,
      clientSummary,
      alerts,
    });
    
  } catch (err) {
    console.error('Global check failed completely:', err);
    globalCheckState.error = err.message;
  } finally {
    markTaskFinished(globalCheckState);
  }
}

app.get('/api/health/client/:credId', authenticate, async (req, res) => {
  const { from_date, to_date } = req.query;
  if (!from_date || !to_date) return res.status(400).json({ error: 'from_date and to_date are required' });
  
  const cred = store.read('credentials').find(c => c.id === req.params.credId);
  if (!cred) return res.status(404).json({ error: 'Client not found' });
  
  try {
    const username = decrypt(cred.username);
    const password = decrypt(cred.password);
    
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!loginRes.ok) throw new Error('UMS Login failed');
    const loginData = await loginRes.json();
    const token = loginData.access_token;
    
    const activeConnections = await fetchAllConnections(token);
    const allLogs = await fetchAllSyncLogs(token, from_date, to_date, 25);
    const logsMayBeTruncated = allLogs.length >= 2500;

    const dates = [];
    let curr = new Date(from_date);
    const end = new Date(to_date);
    while (curr <= end) {
      dates.push(curr.toISOString().split('T')[0]);
      curr.setDate(curr.getDate() + 1);
    }

    let healthyCount = 0;
    let warningCount = 0;
    let failedCount = 0;
    let noSyncCount = 0;

    const processedConnections = activeConnections.map(conn => {
      const connId = conn.connection_id || conn.id;
      const connLogs = allLogs.filter(l => l.connection_id === connId);
      const built = buildConnectionHealth(conn, connLogs, dates);

      if (built.overallStatus === 'healthy') healthyCount++;
      else if (built.overallStatus === 'warning') warningCount++;
      else if (built.overallStatus === 'failed') failedCount++;
      else if (built.overallStatus === 'no_sync') noSyncCount++;

      return built;
    });

    const statusSum = healthyCount + warningCount + failedCount + noSyncCount;

    res.json({
      clientName: cred.clientName,
      fromDate: from_date,
      toDate: to_date,
      connections: processedConnections,
      dates,
      summary: {
        totalConnections: activeConnections.length,
        healthy: healthyCount,
        warning: warningCount,
        failed: failedCount,
        noSync: noSyncCount,
        statusSum,
        reconciled: statusSum === activeConnections.length,
        totalSyncAttempts: processedConnections.reduce((a, c) => a + c.totalSyncs, 0),
        totalSuccessfulSyncs: processedConnections.reduce((a, c) => a + c.successSyncs, 0),
        totalFailedSyncs: processedConnections.reduce((a, c) => a + c.failedSyncs, 0),
      },
      meta: {
        connectionsSource: 'vendor/connections API (all pages, active status)',
        hrmsSource: 'hrms_code field per connection',
        syncLogSource: 'sync_logs API for selected date range',
        syncLogsMayBeTruncated: logsMayBeTruncated,
        syncLogCount: allLogs.length,
      },
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/global-status', authenticate, (req, res) => {
  const data = readStoreObject('health_status', {
    hrmsList: [],
    alerts: [],
    clientSummary: [],
    lastRun: null,
  });
  res.json({
    ...data,
    ...withTaskTiming(globalCheckState),
  });
});

app.post('/api/health/global-check', authenticate, (req, res) => {
  logAudit(req.user.id, req.user.username, req.user.role, 'TRIGGER_GLOBAL_HEALTH', 'Triggered global network health scan');
  if (!globalCheckState.running) {
    runGlobalCheckInBackground().catch(console.error);
  }
  res.json(withTaskTiming(globalCheckState));
});

app.get('/api/health/sync-metrics', authenticate, (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
  const granularity = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(req.query.granularity)
    ? req.query.granularity
    : 'daily';
  const cached = readStoreObject('sync_metrics', null);
  const cacheValid =
    cached &&
    cached.days === days &&
    cached.granularity === granularity &&
    !req.query.refresh;

  if (cacheValid) {
    return res.json({
      ...cached,
      ...withTaskTiming(syncMetricsState),
    });
  }

  if (!syncMetricsState.running) {
    runSyncMetricsInBackground(days, granularity).catch(console.error);
  }

  res.json({
    ...withTaskTiming(syncMetricsState),
    ...(cached || { message: 'Computing sync metrics…' }),
  });
});

app.post('/api/health/sync-metrics/refresh', authenticate, (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.body?.days, 10) || 30));
  const granularity = req.body?.granularity || 'daily';
  if (!syncMetricsState.running) {
    runSyncMetricsInBackground(days, granularity).catch(console.error);
  }
  res.json(withTaskTiming(syncMetricsState));
});

// ── GLOBAL CONNECTION SEARCH ─────────────────────────────────────────

let searchIndexState = {
  running: false,
  progress: 0,
  total: 0,
  currentClient: '',
  lastRun: null,
  error: null,
  connectionCount: 0,
  startedAt: null,
  completedAt: null,
};

function readConnectionIndex() {
  const csvIndex = csvSearchStore.getIndex();
  if (csvIndex.entries?.length) {
    return {
      entries: csvIndex.entries,
      lastIndexedAt: csvIndex.lastIndexedAt,
      connectionCount: csvIndex.connectionCount,
      clientCount: csvIndex.clientCount,
      filterOptions: csvIndex.filterOptions,
      storage: 'csv',
      csvPaths: csvSearchStore.getCsvPaths(),
      lastSyncBatchId: csvIndex.lastSyncBatchId,
    };
  }

  const jsonData = store.read('connection_index');
  if (jsonData && !Array.isArray(jsonData) && jsonData.entries?.length) {
    const migrated = csvSearchStore.migrateFromJson(jsonData);
    if (migrated?.entries?.length) {
      return readConnectionIndex();
    }
    return { ...jsonData, storage: 'json' };
  }

  return {
    entries: [],
    lastIndexedAt: null,
    filterOptions: { clients: [], hrms: [], applicationStatuses: [], healthStatuses: [] },
    storage: 'csv',
    csvPaths: csvSearchStore.getCsvPaths(),
  };
}

function extractEmployeeFields(emp) {
  const email =
    emp.email ||
    emp.work_email ||
    emp.official_email ||
    emp.personal_email ||
    emp.company_email ||
    emp.workEmail ||
    emp.personalEmail ||
    null;
  const name =
    emp.name ||
    emp.full_name ||
    emp.fullName ||
    emp.employee_name ||
    [emp.first_name, emp.last_name].filter(Boolean).join(' ') ||
    [emp.firstName, emp.lastName].filter(Boolean).join(' ') ||
    null;
  return {
    email: email ? String(email) : null,
    name: name ? String(name) : null,
    raw: emp,
  };
}

async function fetchTopEmployees(token, connectionId, maxEmployees = 50) {
  const all = [];
  let page = 1;
  const pageSize = 25;
  try {
    while (all.length < maxEmployees && page <= 5) {
      const url =
        `https://node.tartanhq.com/api/v2/dashboard/v2/employee_list/?connection_id=${encodeURIComponent(connectionId)}` +
        `&page=${page}&size=${pageSize}&source=db&sort=doj:desc&data_source=transformed&data_type=all&partial_shared_status=shared`;
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/plain, */*' },
      });
      if (!res.ok) break;
      const data = await res.json();
      const list = data.data || data.results || data.employees || (Array.isArray(data) ? data : []);
      if (!list.length) break;
      all.push(...list);
      const hasNext = data.pageInfo?.next || data.next || list.length >= pageSize;
      if (!hasNext) break;
      page++;
    }
    return all.slice(0, maxEmployees).map(extractEmployeeFields);
  } catch {
    return [];
  }
}

async function fetchVendorInfo(token) {
  try {
    const userRes = await fetch('https://node.tartanhq.com/api/dashboard/user/', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!userRes.ok) return { vendorOrgId: null, vendorOrgName: null };
    const userData = await userRes.json();
    return {
      vendorOrgId: userData.vendor_org_id || userData.org_id || null,
      vendorOrgName: userData.org_name || userData.name || null,
    };
  } catch {
    return { vendorOrgId: null, vendorOrgName: null };
  }
}

async function runSearchIndexInBackground() {
  if (searchIndexState.running) return;
  markTaskStarted(searchIndexState);
  searchIndexState.connectionCount = 0;

  const toDate = new Date().toISOString().split('T')[0];
  const fromDate7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fromDate30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const dates7 = [];
  let c7 = new Date(fromDate7);
  const end7 = new Date(toDate);
  while (c7 <= end7) {
    dates7.push(c7.toISOString().split('T')[0]);
    c7.setDate(c7.getDate() + 1);
  }

  const dates30 = [];
  let c30 = new Date(fromDate30);
  const end30 = new Date(toDate);
  while (c30 <= end30) {
    dates30.push(c30.toISOString().split('T')[0]);
    c30.setDate(c30.getDate() + 1);
  }

  const allEntries = [];

  try {
    const credentials = store.read('credentials');
    searchIndexState.total = credentials.length;

    for (const cred of credentials) {
      searchIndexState.currentClient = cred.clientName;
      try {
        const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: decrypt(cred.username), password: decrypt(cred.password) }),
        });
        if (!loginRes.ok) throw new Error('UMS login failed');
        const { access_token: token } = await loginRes.json();

        const vendor = await fetchVendorInfo(token);
        const connections = await fetchAllConnections(token);
        const logs7 = await fetchAllSyncLogs(token, fromDate7, toDate, 15);
        const logs30 = await fetchAllSyncLogs(token, fromDate30, toDate, 30);

        const prepared = connections.map(conn => {
          const connId = conn.connection_id || conn.id;
          const connLogs7 = logs7.filter(l => l.connection_id === connId);
          const connLogs30 = logs30.filter(l => l.connection_id === connId);
          const health7d = buildConnectionHealth(conn, connLogs7, dates7);
          const health30d = buildPeriodMetrics(conn, connLogs30, dates30);
          const recentSyncLogs = [...connLogs30]
            .sort((a, b) => parseSyncTimestamp(b.sync_start_time) - parseSyncTimestamp(a.sync_start_time))
            .slice(0, 30);
          return { conn, connId, health7d, health30d, recentSyncLogs };
        });

        for (let i = 0; i < prepared.length; i += 4) {
          const batch = prepared.slice(i, i + 4);
          await Promise.all(
            batch.map(async item => {
              item.topEmployees = await fetchTopEmployees(token, item.connId);
            })
          );
        }

        prepared.forEach(item => {
          const entry = buildIndexEntry(item.conn, {
            clientId: cred.id,
            clientName: cred.clientName,
            vendorOrgId: vendor.vendorOrgId,
            vendorOrgName: vendor.vendorOrgName,
            getHrmsFromConnection,
            health7d: item.health7d,
            health30d: item.health30d,
            recentSyncLogs: item.recentSyncLogs,
            topEmployees: item.topEmployees,
          });
          allEntries.push(entry);
        });
      } catch (err) {
        console.error('Search index client error', cred.clientName, err.message);
      }
      searchIndexState.progress++;
    }

    searchIndexState.connectionCount = allEntries.length;
    const batchId = new Date().toISOString();
    const persisted = csvSearchStore.persistIndex(allEntries, {
      batchId,
      clientCount: searchIndexState.total,
    });

    store.write('connection_index_meta', {
      lastIndexedAt: persisted.lastIndexedAt,
      connectionCount: persisted.connectionCount,
      clientCount: persisted.clientCount,
      lastSyncBatchId: persisted.lastSyncBatchId,
      storage: 'csv',
      csvPaths: csvSearchStore.getCsvPaths(),
    });
    searchIndexState.lastRun = persisted.lastIndexedAt;
  } catch (err) {
    searchIndexState.error = err.message;
  } finally {
    markTaskFinished(searchIndexState);
  }
}

app.get('/api/search/status', authenticate, (req, res) => {
  const index = readConnectionIndex();
  res.json({
    lastIndexedAt: index.lastIndexedAt,
    connectionCount: index.connectionCount || (index.entries || []).length,
    clientCount: index.clientCount || 0,
    filterOptions: index.filterOptions || buildFilterOptions(index.entries || []),
    storage: index.storage || 'csv',
    csvPaths: index.csvPaths || csvSearchStore.getCsvPaths(),
    lastSyncBatchId: index.lastSyncBatchId || null,
    ...withTaskTiming(searchIndexState),
  });
});

app.post('/api/search/reindex', authenticate, (req, res) => {
  logAudit(req.user.id, req.user.username, req.user.role, 'TRIGGER_SEARCH_REINDEX', 'Triggered connection search reindex');
  if (!searchIndexState.running) {
    runSearchIndexInBackground().catch(console.error);
  }
  res.json(withTaskTiming(searchIndexState));
});

app.get('/api/search', authenticate, (req, res) => {
  const index = readConnectionIndex();
  const entries = index.entries || [];

  if (entries.length === 0 && !searchIndexState.running) {
    runSearchIndexInBackground().catch(console.error);
    return res.json({
      total: 0,
      results: [],
      indexing: true,
      message: 'Building search index — results will appear shortly.',
      filterOptions: index.filterOptions || { clients: [], hrms: [], applicationStatuses: [], healthStatuses: [] },
      ...withTaskTiming(searchIndexState),
    });
  }

  const result = searchIndex(entries, {
    q: req.query.q || '',
    clientId: req.query.clientId || '',
    hrmsCode: req.query.hrmsCode || '',
    healthStatus: req.query.healthStatus || '',
    applicationStatus: req.query.applicationStatus || '',
    syncEnabled: req.query.syncEnabled || '',
    limit: Math.min(100, parseInt(req.query.limit, 10) || 50),
    offset: parseInt(req.query.offset, 10) || 0,
  });

  res.json({
    ...result,
    lastIndexedAt: index.lastIndexedAt,
    indexing: searchIndexState.running,
    storage: index.storage || 'csv',
    filterOptions: index.filterOptions || buildFilterOptions(entries),
    ...(searchIndexState.running ? withTaskTiming(searchIndexState) : {}),
  });
});

app.get('/api/search/export/csv', authenticate, (req, res) => {
  const paths = csvSearchStore.getCsvPaths();
  const type = req.query.type || 'latest';
  const filePath =
    type === 'history' ? paths.history : type === 'employees' ? paths.employees : paths.latest;

  if (!require('fs').existsSync(filePath)) {
    return res.status(404).json({ error: 'CSV not found. Run a search reindex first.' });
  }

  const filename =
    type === 'history'
      ? 'connections_sync_history.csv'
      : type === 'employees'
        ? 'connection_employees_history.csv'
        : 'connections_latest.csv';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(require('fs').readFileSync(filePath, 'utf8'));
});

app.get('/api/search/connection/:connectionId', authenticate, async (req, res) => {
  const index = readConnectionIndex();
  const clientId = req.query.clientId || '';
  const connectionId = req.params.connectionId;

  let entry = (index.entries || []).find(
    e => e.connectionId === connectionId && (!clientId || e.clientId === clientId)
  );
  if (!entry && clientId) {
    entry = (index.entries || []).find(e => e.connectionId === connectionId);
  }

  if (!entry) {
    return res.status(404).json({ error: 'Connection not found in index. Run a search reindex first.' });
  }

  if (req.query.fresh === '1') {
    try {
      const cred = store.read('credentials').find(c => c.id === entry.clientId);
      if (cred) {
        const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: decrypt(cred.username), password: decrypt(cred.password) }),
        });
        if (loginRes.ok) {
          const { access_token: token } = await loginRes.json();
          const toDate = new Date().toISOString().split('T')[0];
          const fromDate30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const dates30 = [];
          let c = new Date(fromDate30);
          const end = new Date(toDate);
          while (c <= end) {
            dates30.push(c.toISOString().split('T')[0]);
            c.setDate(c.getDate() + 1);
          }
          const connections = await fetchAllConnections(token);
          const freshConn = connections.find(c => (c.connection_id || c.id) === connectionId);
          if (freshConn) {
            const logs30 = await fetchAllSyncLogs(token, fromDate30, toDate, 30);
            const connLogs30 = logs30.filter(l => l.connection_id === connectionId);
            const fromDate7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const dates7 = [];
            let c7 = new Date(fromDate7);
            while (c7 <= end) {
              dates7.push(c7.toISOString().split('T')[0]);
              c7.setDate(c7.getDate() + 1);
            }
            const logs7 = connLogs30.filter(l => {
              const d = parseSyncDateToIso(l.sync_start_time);
              return d && d >= fromDate7;
            });
            entry = {
              ...entry,
              connection: freshConn,
              health7d: buildConnectionHealth(freshConn, logs7, dates7),
              health30d: buildPeriodMetrics(freshConn, connLogs30, dates30),
              recentSyncLogs: [...connLogs30]
                .sort((a, b) => parseSyncTimestamp(b.sync_start_time) - parseSyncTimestamp(a.sync_start_time))
                .slice(0, 30),
              topEmployees: await fetchTopEmployees(token, connectionId),
              indexedAt: new Date().toISOString(),
            };

            const allEntries = (readConnectionIndex().entries || []).map(e =>
              e.id === entry.id ? entry : e
            );
            csvSearchStore.persistIndex(allEntries, { batchId: `fresh-${connectionId}-${Date.now()}` });
          }
        }
      }
    } catch (err) {
      console.error('Fresh connection fetch failed:', err.message);
    }
  }

  res.json(buildConnectionDetail(entry));
});

// ── CURL SNIPPET REPOSITORY ──────────────────────────────────────────

app.get('/api/curl-snippets', authenticate, (req, res) => {
  const result = curlRepository.searchSnippets({
    q: req.query.q || '',
    connectionId: req.query.connectionId || '',
    clientId: req.query.clientId || '',
    limit: Math.min(100, parseInt(req.query.limit, 10) || 50),
    offset: parseInt(req.query.offset, 10) || 0,
  });
  res.json(result);
});

app.post('/api/curl-snippets', authenticate, (req, res) => {
  try {
    const snippet = curlRepository.createSnippet(req.body, req.user);
    logAudit(
      req.user.id,
      req.user.username,
      req.user.role,
      'ADD_CURL_SNIPPET',
      `Saved curl "${snippet.label}"${snippet.connectionId ? ' for connection ' + snippet.connectionId : ''}`
    );
    res.json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/curl-snippets/:id/reveal', authenticate, (req, res) => {
  try {
    const snippet = curlRepository.revealSnippet(req.params.id);
    logAudit(
      req.user.id,
      req.user.username,
      req.user.role,
      'REVEAL_CURL_SNIPPET',
      `Revealed curl "${snippet.label}"${snippet.connectionId ? ' for connection ' + snippet.connectionId : ''}`
    );
    res.json(snippet);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.put('/api/curl-snippets/:id', authenticate, (req, res) => {
  try {
    const snippet = curlRepository.updateSnippet(req.params.id, req.body, req.user);
    logAudit(req.user.id, req.user.username, req.user.role, 'UPDATE_CURL_SNIPPET', `Updated curl "${snippet.label}"`);
    res.json(snippet);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/curl-snippets/:id', authenticate, (req, res) => {
  try {
    const snippet = curlRepository.deleteSnippet(req.params.id, req.user);
    logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_CURL_SNIPPET', `Deleted curl "${snippet.label}"`);
    res.json({ message: 'Deleted', id: snippet.id });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// Load CSV search cache on startup
csvSearchStore.loadFromDisk();

// Schedule daily check (once every 24 hours)
setInterval(() => {
  console.log('Running scheduled daily global sync health check...');
  runGlobalCheckInBackground().catch(console.error);
}, 24 * 60 * 60 * 1000);

// Run initial check after 10 seconds of startup if file doesn't exist
setTimeout(() => {
  const existing = readStoreObject('health_status', null);
  if (!existing || !existing.lastRun) {
    console.log('No health status found on startup. Triggering initial health scan...');
    runGlobalCheckInBackground().catch(console.error);
  }
  const searchIdx = readConnectionIndex();
  if (!searchIdx.entries || searchIdx.entries.length === 0) {
    console.log('No connection search CSV index found. Triggering initial index build...');
    runSearchIndexInBackground().catch(console.error);
  }
}, 10000);

setInterval(() => {
  console.log('Running scheduled daily connection search reindex...');
  runSearchIndexInBackground().catch(console.error);
}, 24 * 60 * 60 * 1000);

const distPath = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

if (process.env.VERCEL !== '1') app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
