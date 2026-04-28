require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const store = require('./store.cjs');
const { encrypt, decrypt } = require('./crypto.cjs');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const PORT = process.env.PORT || 3001;

// ── Helpers ──────────────────────────────────────────────────────────

function logAudit(userId, username, role, action, details) {
  store.append('audit', {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId, username, role, action, details
  });
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

// ── Init superadmin ──────────────────────────────────────────────────

(function initSuperadmin() {
  const users = store.read('users');
  if (!users.find(u => u.role === 'superadmin')) {
    users.push({
      id: uuidv4(),
      username: process.env.SUPERADMIN_USERNAME || 'admin',
      passwordHash: bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD || 'admin123', 10),
      role: 'superadmin',
      createdAt: new Date().toISOString()
    });
    store.write('users', users);
    console.log('Superadmin account created.');
  }
})();

// ── Init default credentials from CSV ────────────────────────────────

(function initCredentials() {
  const creds = store.read('credentials');
  if (creds.length > 0) return;
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
      id: uuidv4(), clientName,
      username: encrypt(username), password: encrypt(password),
      createdAt: new Date().toISOString()
    });
  });
  store.write('credentials', creds);
  console.log('Default credentials seeded.');
})();

// ── Init default tools ───────────────────────────────────────────────

(function initTools() {
  let tools = store.read('tools');
  const defaults = [
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

  let added = false;
  defaults.forEach(def => {
    if (!tools.find(t => t.name === def.name)) {
      tools.push({ id: uuidv4(), ...def, createdAt: new Date().toISOString() });
      added = true;
    }
  });

  if (added) {
    store.write('tools', tools);
    console.log('Missing default tools seeded.');
  }
})();

// ── AUTH ROUTES ──────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = store.read('users');
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  logAudit(user.id, user.username, user.role, 'LOGIN', 'User logged in');
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ── USER MANAGEMENT ──────────────────────────────────────────────────

app.get('/api/users', authenticate, requireSuperadmin, (req, res) => {
  const users = store.read('users').map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
  res.json(users);
});

app.post('/api/users', authenticate, requireSuperadmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = store.read('users');
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'Username already exists' });
  const newUser = { id: uuidv4(), username, passwordHash: bcrypt.hashSync(password, 10), role: role || 'user', createdAt: new Date().toISOString() };
  users.push(newUser);
  store.write('users', users);
  logAudit(req.user.id, req.user.username, req.user.role, 'CREATE_USER', 'Created user: ' + username);
  res.json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

app.put('/api/users/:id/reset-password', authenticate, requireSuperadmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'New password required' });
  const users = store.read('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.passwordHash = bcrypt.hashSync(password, 10);
  store.write('users', users);
  logAudit(req.user.id, req.user.username, req.user.role, 'RESET_PASSWORD', 'Reset password for: ' + user.username);
  res.json({ message: 'Password reset successfully' });
});

app.delete('/api/users/:id', authenticate, requireSuperadmin, (req, res) => {
  const users = store.read('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin' });
  store.write('users', users.filter(u => u.id !== req.params.id));
  logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_USER', 'Deleted user: ' + user.username);
  res.json({ message: 'User deleted' });
});

// ── CREDENTIALS ──────────────────────────────────────────────────────

app.get('/api/credentials', authenticate, (req, res) => {
  const creds = store.read('credentials').map(c => ({ id: c.id, clientName: c.clientName, createdAt: c.createdAt }));
  res.json(creds);
});

app.post('/api/credentials', authenticate, (req, res) => {
  const { clientName, username, password } = req.body;
  if (!clientName || !username || !password) return res.status(400).json({ error: 'All fields required' });
  const creds = store.read('credentials');
  const newCred = { id: uuidv4(), clientName, username: encrypt(username), password: encrypt(password), createdAt: new Date().toISOString() };
  creds.push(newCred);
  store.write('credentials', creds);
  logAudit(req.user.id, req.user.username, req.user.role, 'ADD_CREDENTIAL', 'Added credential for: ' + clientName);
  res.json({ id: newCred.id, clientName });
});

app.delete('/api/credentials/:id', authenticate, (req, res) => {
  const creds = store.read('credentials');
  const cred = creds.find(c => c.id === req.params.id);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  store.write('credentials', creds.filter(c => c.id !== req.params.id));
  logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_CREDENTIAL', 'Deleted credential for: ' + cred.clientName);
  res.json({ message: 'Deleted' });
});

app.get('/api/credentials/:id/reveal', authenticate, (req, res) => {
  const creds = store.read('credentials');
  const cred = creds.find(c => c.id === req.params.id);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  logAudit(req.user.id, req.user.username, req.user.role, 'REVEAL_CREDENTIAL', 'Revealed credentials for: ' + cred.clientName);
  res.json({ username: decrypt(cred.username), password: decrypt(cred.password) });
});

// ── CONNECTIONS PROXY ────────────────────────────────────────────────

app.get('/api/connections/:credId', authenticate, async (req, res) => {
  const creds = store.read('credentials');
  const cred = creds.find(c => c.id === req.params.credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const username = decrypt(cred.username);
  const password = decrypt(cred.password);
  try {
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://hrmssync.tartanhq.com', 'Referer': 'https://hrmssync.tartanhq.com/' },
      body: JSON.stringify({ username, password })
    });
    if (!loginRes.ok) throw new Error('Login failed: ' + loginRes.status);
    const loginData = await loginRes.json();
    if (!loginData.access_token) throw new Error('No access token received');
    const dataRes = await fetch('https://node.tartanhq.com/api/dashboard/vendor/connections/?status=active&page_size=300&page=1&is_post_processing_rules_added=false&sort=last_successful_sync%3Adesc', {
      headers: { 'Authorization': 'Bearer ' + loginData.access_token, 'Accept': 'application/json' }
    });
    if (!dataRes.ok) throw new Error('Data fetch failed: ' + dataRes.status);
    const dataJson = await dataRes.json();
    logAudit(req.user.id, req.user.username, req.user.role, 'FETCH_CONNECTIONS', 'Fetched connections for: ' + cred.clientName);
    res.json(dataJson);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TOOLS ────────────────────────────────────────────────────────────

app.get('/api/tools', authenticate, (req, res) => {
  const tools = store.read('tools');
  res.json(tools);
});

app.post('/api/tools', authenticate, (req, res) => {
  const { name, curl, variables, environments } = req.body;
  if (!name || !curl) return res.status(400).json({ error: 'Name and curl required' });
  const tools = store.read('tools');
  const newTool = { id: uuidv4(), name, curl, variables: variables || [], environments: environments || [], createdAt: new Date().toISOString() };
  tools.push(newTool);
  store.write('tools', tools);
  logAudit(req.user.id, req.user.username, req.user.role, 'ADD_TOOL', 'Added tool: ' + name);
  res.json(newTool);
});

app.delete('/api/tools/:id', authenticate, (req, res) => {
  const tools = store.read('tools');
  const tool = tools.find(t => t.id === req.params.id);
  if (!tool) return res.status(404).json({ error: 'Not found' });
  store.write('tools', tools.filter(t => t.id !== req.params.id));
  logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_TOOL', 'Deleted tool: ' + tool.name);
  res.json({ message: 'Deleted' });
});

// ── VENDOR INFO ──────────────────────────────────────────────────────

app.get('/api/vendor-info/:credId', authenticate, async (req, res) => {
  const creds = store.read('credentials');
  const cred = creds.find(c => c.id === req.params.credId);
  if (!cred) return res.status(404).json({ error: 'Not found' });
  const username = decrypt(cred.username);
  const password = decrypt(cred.password);
  try {
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://hrmssync.tartanhq.com', 'Referer': 'https://hrmssync.tartanhq.com/' },
      body: JSON.stringify({ username, password })
    });
    if (!loginRes.ok) throw new Error('Login failed: ' + loginRes.status);
    const loginData = await loginRes.json();
    if (!loginData.access_token) throw new Error('No access token received');

    const userRes = await fetch('https://node.tartanhq.com/api/dashboard/user/', {
      headers: { 'Authorization': 'Bearer ' + loginData.access_token, 'Accept': 'application/json' }
    });
    if (!userRes.ok) throw new Error('User fetch failed: ' + userRes.status);
    const userData = await userRes.json();
    res.json({ vendor_org_id: userData.Organisation?.id, org_name: userData.Organisation?.org_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TOOL EXECUTION PROXY ─────────────────────────────────────────────

app.post('/api/tools/execute', authenticate, async (req, res) => {
  const { credId, url, method, headers, body, environment } = req.body;
  if (!credId || !url) return res.status(400).json({ error: 'credId and url required' });

  const creds = store.read('credentials');
  const cred = creds.find(c => c.id === credId);
  if (!cred) return res.status(404).json({ error: 'Credential not found' });

  const username = decrypt(cred.username);
  const password = decrypt(cred.password);

  try {
    // 1. Get Tartan Token
    const loginRes = await fetch('https://ums.tartanhq.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Origin': 'https://hrmssync.tartanhq.com', 'Referer': 'https://hrmssync.tartanhq.com/' },
      body: JSON.stringify({ username, password })
    });
    if (!loginRes.ok) throw new Error('Login failed: ' + loginRes.status);
    const loginData = await loginRes.json();
    if (!loginData.access_token) throw new Error('No access token received');

    // 2. Prepare Tool Request
    let finalUrl = url;
    // Replace domain if environment is specified (Dev, Test, Prod)
    // Basic implementation: replace node.tartanhq.com with {env}-node.tartanhq.com if not prod
    if (environment && environment.toLowerCase() !== 'prod') {
      finalUrl = finalUrl.replace('node.tartanhq.com', environment.toLowerCase() + '-node.tartanhq.com');
    }

    const finalHeaders = { ...headers };
    finalHeaders['Authorization'] = 'Bearer ' + loginData.access_token;
    if (!finalHeaders['Accept']) finalHeaders['Accept'] = 'application/json';
    if (!finalHeaders['Content-Type'] && body) finalHeaders['Content-Type'] = 'application/json';

    const fetchOptions = {
      method: method || 'GET',
      headers: finalHeaders
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const toolRes = await fetch(finalUrl, fetchOptions);
    const responseText = await toolRes.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText;
    }

    logAudit(req.user.id, req.user.username, req.user.role, 'EXECUTE_TOOL', 'Executed API: ' + finalUrl);

    res.status(toolRes.status).json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── APPROVALS ────────────────────────────────────────────────────────

app.get('/api/approvals', authenticate, requireSuperadmin, (req, res) => {
  const approvals = store.read('approvals');
  res.json(approvals.filter(a => a.status === 'pending').reverse());
});

app.post('/api/approvals/request', authenticate, (req, res) => {
  const { action, targetId, details } = req.body;
  if (!action || !targetId) return res.status(400).json({ error: 'Action and targetId required' });
  
  const approvals = store.read('approvals');
  const newRequest = {
    id: uuidv4(),
    status: 'pending',
    action,
    targetId,
    details,
    requestedBy: req.user.username,
    requestedAt: new Date().toISOString()
  };
  
  approvals.push(newRequest);
  store.write('approvals', approvals);
  
  logAudit(req.user.id, req.user.username, req.user.role, 'REQUEST_APPROVAL', 'Requested ' + action + ' for: ' + details);
  res.json(newRequest);
});

app.post('/api/approvals/:id/approve', authenticate, requireSuperadmin, async (req, res) => {
  const approvals = store.read('approvals');
  const index = approvals.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Request not found' });
  if (approvals[index].status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

  const request = approvals[index];
  let success = false;

  // Execute the actual action
  try {
    if (request.action === 'DELETE_CREDENTIAL') {
      const creds = store.read('credentials');
      store.write('credentials', creds.filter(c => c.id !== request.targetId));
      success = true;
    } else if (request.action === 'DELETE_TOOL') {
      const tools = store.read('tools');
      store.write('tools', tools.filter(t => t.id !== request.targetId));
      success = true;
    } else if (request.action === 'DELETE_USER') {
      const users = store.read('users');
      const user = users.find(u => u.id === request.targetId);
      if (user && user.role !== 'superadmin') {
        store.write('users', users.filter(u => u.id !== request.targetId));
        success = true;
      }
    }

    if (success) {
      request.status = 'approved';
      request.processedBy = req.user.username;
      request.processedAt = new Date().toISOString();
      store.write('approvals', approvals);
      
      logAudit(req.user.id, req.user.username, req.user.role, 'APPROVE_ACTION', 'Approved ' + request.action + ': ' + request.details);
      res.json({ message: 'Action approved and executed' });
    } else {
      throw new Error('Action failed or target not found');
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/:id/reject', authenticate, requireSuperadmin, (req, res) => {
  const approvals = store.read('approvals');
  const index = approvals.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Request not found' });
  if (approvals[index].status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

  const request = approvals[index];
  request.status = 'rejected';
  request.processedBy = req.user.username;
  request.processedAt = new Date().toISOString();
  store.write('approvals', approvals);

  logAudit(req.user.id, req.user.username, req.user.role, 'REJECT_ACTION', 'Rejected ' + request.action + ': ' + request.details);
  res.json({ message: 'Action rejected' });
});

// ── AUDIT LOG ────────────────────────────────────────────────────────

app.get('/api/audit', authenticate, (req, res) => {
  const logs = store.read('audit');
  res.json(logs.reverse());
});

// ── Serve static in production ───────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}

module.exports = app;
