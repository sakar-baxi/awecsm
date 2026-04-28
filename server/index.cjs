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

if (!process.env.JWT_SECRET || !process.env.ENCRYPTION_KEY) {
  console.warn('WARNING: JWT_SECRET or ENCRYPTION_KEY not set. Using defaults (not secure for production).');
}

// ── Helpers ──────────────────────────────────────────────────────────

async function logAudit(userId, username, role, action, details) {
  try {
    await store.query(
      'INSERT INTO audit (id, user_id, username, role, action, details) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), userId, username, role, action, details]
    );
  } catch (e) {
    console.error('Audit logging failed:', e);
  }
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

// ── Database Init ──────────────────────────────────────────────────

async function initDatabase() {
  await store.init();
  
  // 1. Init superadmin
  const adminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
  const { rows: users } = await store.query('SELECT * FROM users WHERE role = $1', ['superadmin']);
  if (users.length === 0) {
    await store.query(
      'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
      [deterministicId('superadmin-' + adminUsername), adminUsername, bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD || 'admin123', 10), 'superadmin']
    );
    console.log('Superadmin account created.');
  }

  // 2. Init credentials
  const { rows: existingCreds } = await store.query('SELECT * FROM credentials');
  if (existingCreds.length === 0) {
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
    for (const [clientName, username, password] of defaults) {
      await store.query(
        'INSERT INTO credentials (id, client_name, username, password) VALUES ($1, $2, $3, $4)',
        [deterministicId('cred-' + clientName), clientName, JSON.stringify(encrypt(username)), JSON.stringify(encrypt(password))]
      );
    }
    console.log('Default credentials seeded.');
  }

  // 3. Init tools
  const { rows: existingTools } = await store.query('SELECT * FROM tools');
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

  for (const def of toolDefaults) {
    if (!existingTools.find(t => t.name === def.name)) {
      await store.query(
        'INSERT INTO tools (id, name, curl, variables, environments) VALUES ($1, $2, $3, $4, $5)',
        [deterministicId('tool-' + def.name), def.name, def.curl, JSON.stringify(def.variables), JSON.stringify(def.environments)]
      );
    }
  }
  console.log('Missing default tools seeded.');
}

initDatabase().catch(e => console.error('Database init failed:', e));

// ── AUTH ROUTES ──────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await store.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  await logAudit(user.id, user.username, user.role, 'LOGIN', 'User logged in');
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ── USER MANAGEMENT ──────────────────────────────────────────────────

app.get('/api/users', authenticate, requireSuperadmin, async (req, res) => {
  const { rows: users } = await store.query('SELECT id, username, role, created_at FROM users');
  res.json(users);
});

app.post('/api/users', authenticate, requireSuperadmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  
  const { rows: existing } = await store.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length > 0) return res.status(409).json({ error: 'Username already exists' });
  
  const id = uuidv4();
  await store.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, username, bcrypt.hashSync(password, 10), role || 'user']
  );
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'CREATE_USER', 'Created user: ' + username);
  res.json({ id, username, role: role || 'user' });
});

app.put('/api/users/:id/reset-password', authenticate, requireSuperadmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'New password required' });
  
  const { rows } = await store.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  
  await store.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), req.params.id]);
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'RESET_PASSWORD', 'Reset password for: ' + rows[0].username);
  res.json({ message: 'Password reset successfully' });
});

app.delete('/api/users/:id', authenticate, requireSuperadmin, async (req, res) => {
  const { rows } = await store.query('SELECT username, role FROM users WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  if (rows[0].role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin' });
  
  await store.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_USER', 'Deleted user: ' + rows[0].username);
  res.json({ message: 'User deleted' });
});

// ── CREDENTIALS ──────────────────────────────────────────────────────

app.get('/api/credentials', authenticate, async (req, res) => {
  const { rows: creds } = await store.query('SELECT id, client_name, created_at FROM credentials');
  res.json(creds);
});

app.post('/api/credentials', authenticate, async (req, res) => {
  const { clientName, username, password } = req.body;
  if (!clientName || !username || !password) return res.status(400).json({ error: 'All fields required' });
  
  const id = uuidv4();
  await store.query(
    'INSERT INTO credentials (id, client_name, username, password) VALUES ($1, $2, $3, $4)',
    [id, clientName, JSON.stringify(encrypt(username)), JSON.stringify(encrypt(password))]
  );
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'ADD_CREDENTIAL', 'Added credential for: ' + clientName);
  res.json({ id, clientName });
});

app.delete('/api/credentials/:id', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT client_name FROM credentials WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  
  await store.query('DELETE FROM credentials WHERE id = $1', [req.params.id]);
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_CREDENTIAL', 'Deleted credential for: ' + rows[0].client_name);
  res.json({ message: 'Deleted' });
});

app.get('/api/credentials/:id/reveal', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT client_name, username, password FROM credentials WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  
  const cred = rows[0];
  await logAudit(req.user.id, req.user.username, req.user.role, 'REVEAL_CREDENTIAL', 'Revealed credentials for: ' + cred.client_name);
  res.json({ username: decrypt(cred.username), password: decrypt(cred.password) });
});

// ── CONNECTIONS PROXY ────────────────────────────────────────────────

app.get('/api/connections/:credId', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT client_name, username, password FROM credentials WHERE id = $1', [req.params.credId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  
  const cred = rows[0];
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
    await logAudit(req.user.id, req.user.username, req.user.role, 'FETCH_CONNECTIONS', 'Fetched connections for: ' + cred.client_name);
    res.json(dataJson);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TOOLS ────────────────────────────────────────────────────────────

app.get('/api/tools', authenticate, async (req, res) => {
  const { rows: tools } = await store.query('SELECT * FROM tools');
  res.json(tools);
});

app.post('/api/tools', authenticate, async (req, res) => {
  const { name, curl, variables, environments } = req.body;
  if (!name || !curl) return res.status(400).json({ error: 'Name and curl required' });
  
  const id = uuidv4();
  await store.query(
    'INSERT INTO tools (id, name, curl, variables, environments) VALUES ($1, $2, $3, $4, $5)',
    [id, name, curl, JSON.stringify(variables || []), JSON.stringify(environments || [])]
  );
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'ADD_TOOL', 'Added tool: ' + name);
  res.json({ id, name, curl, variables: variables || [], environments: environments || [] });
});

app.delete('/api/tools/:id', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT name FROM tools WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  
  await store.query('DELETE FROM tools WHERE id = $1', [req.params.id]);
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'DELETE_TOOL', 'Deleted tool: ' + rows[0].name);
  res.json({ message: 'Deleted' });
});

// ── VENDOR INFO ──────────────────────────────────────────────────────

app.get('/api/vendor-info/:credId', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT client_name, username, password FROM credentials WHERE id = $1', [req.params.credId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  
  const cred = rows[0];
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

  const { rows } = await store.query('SELECT client_name, username, password FROM credentials WHERE id = $1', [credId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Credential not found' });

  const cred = rows[0];
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

    let finalUrl = url;
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

    await logAudit(req.user.id, req.user.username, req.user.role, 'EXECUTE_TOOL', 'Executed API: ' + finalUrl);
    res.status(toolRes.status).json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── APPROVALS ────────────────────────────────────────────────────────

app.get('/api/approvals', authenticate, requireSuperadmin, async (req, res) => {
  const { rows } = await store.query('SELECT * FROM approvals WHERE status = $1 ORDER BY requested_at DESC', ['pending']);
  res.json(rows);
});

app.post('/api/approvals/request', authenticate, async (req, res) => {
  const { action, targetId, details } = req.body;
  if (!action || !targetId) return res.status(400).json({ error: 'Action and targetId required' });
  
  const id = uuidv4();
  await store.query(
    'INSERT INTO approvals (id, status, action, target_id, details, requested_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, 'pending', action, targetId, details, req.user.username]
  );
  
  await logAudit(req.user.id, req.user.username, req.user.role, 'REQUEST_APPROVAL', 'Requested ' + action + ' for: ' + details);
  res.json({ id, status: 'pending', action, targetId, details, requestedBy: req.user.username });
});

app.post('/api/approvals/:id/approve', authenticate, requireSuperadmin, async (req, res) => {
  const { rows } = await store.query('SELECT * FROM approvals WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
  if (rows[0].status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

  const request = rows[0];
  let success = false;

  try {
    if (request.action === 'DELETE_CREDENTIAL') {
      await store.query('DELETE FROM credentials WHERE id = $1', [request.target_id]);
      success = true;
    } else if (request.action === 'DELETE_TOOL') {
      await store.query('DELETE FROM tools WHERE id = $1', [request.target_id]);
      success = true;
    } else if (request.action === 'DELETE_USER') {
      const { rows: userRows } = await store.query('SELECT role FROM users WHERE id = $1', [request.target_id]);
      if (userRows.length > 0 && userRows[0].role !== 'superadmin') {
        await store.query('DELETE FROM users WHERE id = $1', [request.target_id]);
        success = true;
      }
    }

    if (success) {
      await store.query(
        'UPDATE approvals SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3',
        ['approved', req.user.username, req.params.id]
      );
      
      await logAudit(req.user.id, req.user.username, req.user.role, 'APPROVE_ACTION', 'Approved ' + request.action + ': ' + request.details);
      res.json({ message: 'Action approved and executed' });
    } else {
      throw new Error('Action failed or target not found');
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/:id/reject', authenticate, requireSuperadmin, async (req, res) => {
  const { rows } = await store.query('SELECT * FROM approvals WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
  if (rows[0].status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

  const request = rows[0];
  await store.query(
    'UPDATE approvals SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3',
    ['rejected', req.user.username, req.params.id]
  );

  await logAudit(req.user.id, req.user.username, req.user.role, 'REJECT_ACTION', 'Rejected ' + request.action + ': ' + request.details);
  res.json({ message: 'Action rejected' });
});

// ── AUDIT LOG ────────────────────────────────────────────────────────

app.get('/api/audit', authenticate, async (req, res) => {
  const { rows } = await store.query('SELECT * FROM audit ORDER BY timestamp DESC');
  res.json(rows);
});

// ── Serve static in production ───────────────────────────────────────

if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}

module.exports = app;
