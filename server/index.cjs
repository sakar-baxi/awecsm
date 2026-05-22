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

// ── HEALTH MONITOR ───────────────────────────────────────────────────

let globalCheckState = {
  running: false,
  progress: 0,
  total: 0,
  currentClient: '',
  lastRun: null,
  error: null
};

function getHrmsName(item) {
  return item.hrms_name || 
         item.hrms || 
         item.integration_name || 
         item.integration || 
         item.source || 
         item.vendor_name || 
         item.hrms_provider || 
         (item.vendor && item.vendor.name) || 
         item.integration_type || 
         "Unknown HRMS";
}

async function runGlobalCheckInBackground() {
  if (globalCheckState.running) return;
  
  globalCheckState.running = true;
  globalCheckState.progress = 0;
  globalCheckState.error = null;
  
  try {
    const credentials = store.read('credentials');
    globalCheckState.total = credentials.length;
    
    // We want to scan the last 7 days for global HRMS health
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
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
        
        // Fetch connections
        const connRes = await fetch('https://node.tartanhq.com/api/dashboard/vendor/connections/?status=active&page_size=500&page=1&is_post_processing_rules_added=false&sort=last_successful_sync%3Adesc', {
          headers: { 'Authorization': 'Bearer ' + loginData.access_token }
        });
        if (!connRes.ok) throw new Error('Fetch connections failed');
        const connData = await connRes.json();
        
        if (connData && Array.isArray(connData.data)) {
          // Fetch sync logs for the last 7 days
          let page = 1;
          let logs = [];
          let hasNext = true;
          while (hasNext && page <= 5) {
            const logsRes = await fetch(`https://node.tartanhq.com/api/dashboard/sync_logs/?from_date=${fromDate}&to_date=${toDate}&page=${page}&page_size=100`, {
              headers: { 'Authorization': 'Bearer ' + loginData.access_token }
            });
            if (!logsRes.ok) break;
            const logsData = await logsRes.json();
            if (logsData && Array.isArray(logsData.data)) {
              logs.push(...logsData.data);
              hasNext = logsData.pageInfo?.next || false;
              page++;
            } else {
              hasNext = false;
            }
          }
          
          let clientTotal = connData.data.length;
          let clientFailed = 0;
          let clientWarning = 0;
          let clientHealthy = 0;
          
          connData.data.forEach(conn => {
            const connId = conn.id || conn.connection_id;
            const connLogs = logs.filter(l => l.connection_id === connId);
            
            let totalAttempts = connLogs.length;
            let successAttempts = connLogs.filter(l => l.sync_status === 'success').length;
            let failedAttempts = connLogs.filter(l => l.sync_status === 'failed').length;
            
            let status = 'healthy';
            if (totalAttempts > 0) {
              if (successAttempts === 0 && failedAttempts > 0) {
                status = 'failed';
                clientFailed++;
              } else if (failedAttempts > 0) {
                status = 'warning';
                clientWarning++;
              } else {
                clientHealthy++;
              }
            } else {
              status = 'no_sync';
              clientWarning++;
            }
            
            allHrmsConnections.push({
              connectionId: connId,
              orgName: conn.org_name || 'Unknown Corporate',
              orgId: conn.org_id,
              clientName: cred.clientName,
              clientId: cred.id,
              hrmsName: getHrmsName(conn),
              status,
              totalAttempts,
              successAttempts,
              failedAttempts,
              lastSyncTime: connLogs[0]?.sync_start_time || conn.last_successful_sync || null,
              lastFailureReason: connLogs.find(l => l.sync_status === 'failed')?.failure_reason || null
            });
          });
          
          clientSummary.push({
            clientId: cred.id,
            clientName: cred.clientName,
            status: 'success',
            totalConnections: clientTotal,
            healthy: clientHealthy,
            warning: clientWarning,
            failed: clientFailed
          });
        }
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
      const hrms = conn.hrmsName;
      if (!hrmsMap[hrms]) {
        hrmsMap[hrms] = {
          hrmsName: hrms,
          clients: new Set(),
          connections: [],
          totalConnections: 0,
          failedConnections: 0,
          warningConnections: 0,
          healthyConnections: 0,
          noSyncConnections: 0
        };
      }
      
      hrmsMap[hrms].clients.add(conn.clientName);
      hrmsMap[hrms].connections.push(conn);
      hrmsMap[hrms].totalConnections++;
      
      if (conn.status === 'failed') hrmsMap[hrms].failedConnections++;
      else if (conn.status === 'warning') hrmsMap[hrms].warningConnections++;
      else if (conn.status === 'healthy') hrmsMap[hrms].healthyConnections++;
      else if (conn.status === 'no_sync') hrmsMap[hrms].noSyncConnections++;
    });
    
    const hrmsList = Object.values(hrmsMap).map(h => {
      const hasContinuousFailures = h.connections.some(c => c.status === 'failed');
      const isOutage = h.totalConnections > 0 && h.connections.every(c => c.status === 'failed' || c.status === 'no_sync') && h.failedConnections > 0;
      
      return {
        hrmsName: h.hrmsName,
        clients: Array.from(h.clients),
        totalConnections: h.totalConnections,
        failedConnections: h.failedConnections,
        warningConnections: h.warningConnections,
        healthyConnections: h.healthyConnections,
        noSyncConnections: h.noSyncConnections,
        status: isOutage ? 'outage' : (hasContinuousFailures ? 'warning' : 'healthy'),
        connections: h.connections
      };
    });
    
    store.write('health_status', {
      lastRun: new Date().toISOString(),
      hrmsList,
      clientSummary,
      alerts: allHrmsConnections.filter(c => c.status === 'failed' || c.status === 'no_sync')
    });
    
  } catch (err) {
    console.error('Global check failed completely:', err);
    globalCheckState.error = err.message;
  } finally {
    globalCheckState.running = false;
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
    
    const connRes = await fetch('https://node.tartanhq.com/api/dashboard/vendor/connections/?status=active&page_size=500&page=1&is_post_processing_rules_added=false&sort=last_successful_sync%3Adesc', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!connRes.ok) throw new Error('Fetch active connections failed');
    const connData = await connRes.json();
    const activeConnections = connData.data || [];
    
    // Fetch logs
    let page = 1;
    let allLogs = [];
    let hasNext = true;
    while (hasNext && page <= 15) {
      const logsRes = await fetch(`https://node.tartanhq.com/api/dashboard/sync_logs/?from_date=${from_date}&to_date=${to_date}&page=${page}&page_size=100`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!logsRes.ok) break;
      const logsData = await logsRes.json();
      if (logsData && Array.isArray(logsData.data)) {
        allLogs.push(...logsData.data);
        hasNext = logsData.pageInfo?.next || false;
        page++;
      } else {
        hasNext = false;
      }
    }
    
    // Generate date sequence
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
    
    const processedConnections = activeConnections.map(conn => {
      const connId = conn.id || conn.connection_id;
      const connLogs = allLogs.filter(l => l.connection_id === connId);
      
      let totalSyncs = connLogs.length;
      let successSyncs = connLogs.filter(l => l.sync_status === 'success').length;
      let failedSyncs = connLogs.filter(l => l.sync_status === 'failed').length;
      
      // Calculate daily status map
      const dailyStatus = dates.map(date => {
        const dayLogs = connLogs.filter(l => l.sync_start_time && l.sync_start_time.startsWith(date));
        let status = 'no_sync';
        let sCount = 0;
        let fCount = 0;
        
        dayLogs.forEach(l => {
          if (l.sync_status === 'success') {
            status = 'success';
            sCount++;
          } else if (l.sync_status === 'failed') {
            if (status !== 'success') status = 'failed';
            fCount++;
          }
        });
        
        return { date, status, successCount: sCount, failedCount: fCount, totalCount: dayLogs.length };
      });
      
      // Overall health category
      let overallStatus = 'healthy';
      if (totalSyncs > 0) {
        if (successSyncs === 0 && failedSyncs > 0) {
          overallStatus = 'failed';
          failedCount++;
        } else if (failedSyncs > 0) {
          overallStatus = 'warning';
          warningCount++;
        } else {
          healthyCount++;
        }
      } else {
        overallStatus = 'no_sync';
        warningCount++; // No sync is a warning (inactive)
      }
      
      const successRate = totalSyncs > 0 ? Math.round((successSyncs / totalSyncs) * 100) : 0;
      
      // Failure categories
      const failures = connLogs.filter(l => l.sync_status === 'failed');
      const failureReasons = Array.from(new Set(failures.map(f => f.failure_reason).filter(Boolean)));
      
      // PM Metrics
      const totalEmployeesFound = connLogs.reduce((acc, l) => acc + (l.employees_found || 0), 0);
      const totalEmployeesCreated = connLogs.reduce((acc, l) => acc + (l.employees_created || 0), 0);
      const totalEmployeesUpdated = connLogs.reduce((acc, l) => acc + (l.employees_updated || 0), 0);
      const avgDuration = connLogs.length > 0 ? Math.round(connLogs.reduce((acc, l) => acc + (l.duration_seconds || 0), 0) / connLogs.length * 10) / 10 : 0;
      
      return {
        id: connId,
        orgName: conn.org_name || 'Unknown Corporate',
        orgId: conn.org_id,
        hrmsName: getHrmsName(conn),
        overallStatus,
        totalSyncs,
        successSyncs,
        failedSyncs,
        successRate,
        dailyStatus,
        lastSyncStatus: connLogs[0]?.sync_status || null,
        lastSyncTime: connLogs[0]?.sync_start_time || conn.last_successful_sync || null,
        failureReasons,
        metrics: {
          totalEmployeesFound,
          totalEmployeesCreated,
          totalEmployeesUpdated,
          avgDurationSeconds: avgDuration
        }
      };
    });
    
    res.json({
      connections: processedConnections,
      dates,
      summary: {
        totalConnections: activeConnections.length,
        healthy: healthyCount,
        warning: warningCount,
        failed: failedCount
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/global-status', authenticate, (req, res) => {
  const data = store.read('health_status');
  res.json({
    ...data,
    running: globalCheckState.running,
    progress: globalCheckState.progress,
    total: globalCheckState.total,
    currentClient: globalCheckState.currentClient,
    error: globalCheckState.error
  });
});

app.post('/api/health/global-check', authenticate, (req, res) => {
  if (!globalCheckState.running) {
    runGlobalCheckInBackground().catch(console.error);
  }
  res.json({
    running: globalCheckState.running,
    progress: globalCheckState.progress,
    total: globalCheckState.total,
    currentClient: globalCheckState.currentClient
  });
});

// Schedule daily check (once every 24 hours)
setInterval(() => {
  console.log('Running scheduled daily global sync health check...');
  runGlobalCheckInBackground().catch(console.error);
}, 24 * 60 * 60 * 1000);

// Run initial check after 10 seconds of startup if file doesn't exist
setTimeout(() => {
  const existing = store.read('health_status');
  if (!existing || Object.keys(existing).length === 0) {
    console.log('No health status found on startup. Triggering initial health scan...');
    runGlobalCheckInBackground().catch(console.error);
  }
}, 10000);

if (process.env.VERCEL !== '1') app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
