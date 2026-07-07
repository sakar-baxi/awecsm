const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VERCEL === '1'
  ? path.join('/tmp', 'data')
  : path.join(__dirname, 'data');

const LATEST_CSV = path.join(DATA_DIR, 'connections_latest.csv');
const HISTORY_CSV = path.join(DATA_DIR, 'connections_sync_history.csv');
const EMPLOYEES_CSV = path.join(DATA_DIR, 'connection_employees_history.csv');

const CONNECTION_HEADERS = [
  'id',
  'connection_id',
  'org_id',
  'org_name',
  'client_id',
  'client_name',
  'vendor_org_id',
  'vendor_org_name',
  'hrms_code',
  'hrms_name',
  'hrms_display',
  'email',
  'application_connection_status',
  'sync_enabled',
  'status',
  'last_successful_sync',
  'sync_frequency',
  'date_of_connection',
  'health_7d_status',
  'health_7d_success_rate',
  'health_7d_total_syncs',
  'health_30d_success_rate',
  'employee_emails',
  'employee_names',
  'searchable_text',
  'connection_json',
  'health7d_json',
  'health30d_json',
  'recent_sync_logs_json',
  'top_employees_json',
  'indexed_at',
  'sync_batch_id',
];

const EMPLOYEE_HEADERS = [
  'sync_batch_id',
  'synced_at',
  'connection_id',
  'client_id',
  'client_name',
  'org_name',
  'employee_rank',
  'employee_email',
  'employee_name',
  'employee_json',
];

let memoryIndex = {
  entries: [],
  lastIndexedAt: null,
  connectionCount: 0,
  clientCount: 0,
  filterOptions: { clients: [], hrms: [], applicationStatuses: [], healthStatuses: [] },
  csvPath: LATEST_CSV,
  lastSyncBatchId: null,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsvFile(filePath, headers) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines[0] === headers.join(',') ? 1 : 0;
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] != null ? cols[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

function readCsvText(text, headers) {
  if (!text || !String(text).trim()) return [];
  const lines = String(text).trim().split(/\r?\n/);
  const start = lines[0] === headers.join(',') ? 1 : 0;
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] != null ? cols[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

function writeCsvFile(filePath, headers, rows) {
  ensureDataDir();
  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function appendCsvRows(filePath, headers, rows) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    writeCsvFile(filePath, headers, rows);
    return;
  }
  const chunk = rows.map(row => headers.map(h => csvEscape(row[h])).join(',')).join('\n') + '\n';
  fs.appendFileSync(filePath, chunk, 'utf8');
}

function safeJsonParse(s, fallback = null) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function entryToCsvRow(entry, batchId) {
  const emails = (entry.topEmployees || [])
    .map(e => e.email)
    .filter(Boolean)
    .join(';');
  const names = (entry.topEmployees || [])
    .map(e => e.name)
    .filter(Boolean)
    .join(';');

  return {
    id: entry.id,
    connection_id: entry.connectionId,
    org_id: entry.orgId || '',
    org_name: entry.orgName || '',
    client_id: entry.clientId,
    client_name: entry.clientName,
    vendor_org_id: entry.vendorOrgId || '',
    vendor_org_name: entry.vendorOrgName || '',
    hrms_code: entry.hrmsCode || '',
    hrms_name: entry.hrmsName || '',
    hrms_display: entry.hrmsDisplay || '',
    email: entry.email || '',
    application_connection_status: entry.applicationConnectionStatus ?? '',
    sync_enabled: entry.syncEnabled == null ? '' : String(entry.syncEnabled),
    status: entry.status ?? '',
    last_successful_sync: entry.lastSuccessfulSync || '',
    sync_frequency: entry.syncFrequency || '',
    date_of_connection: entry.dateOfConnection || '',
    health_7d_status: entry.health7d?.overallStatus || '',
    health_7d_success_rate: entry.health7d?.successRate ?? '',
    health_7d_total_syncs: entry.health7d?.totalSyncs ?? '',
    health_30d_success_rate: entry.health30d?.successRate ?? '',
    employee_emails: emails,
    employee_names: names,
    searchable_text: entry.searchableText || '',
    connection_json: JSON.stringify(entry.connection || {}),
    health7d_json: JSON.stringify(entry.health7d || null),
    health30d_json: JSON.stringify(entry.health30d || null),
    recent_sync_logs_json: JSON.stringify(entry.recentSyncLogs || []),
    top_employees_json: JSON.stringify(entry.topEmployees || []),
    indexed_at: entry.indexedAt || new Date().toISOString(),
    sync_batch_id: batchId,
  };
}

function csvRowToEntry(row) {
  const syncEnabled =
    row.sync_enabled === '' ? null : row.sync_enabled === 'true' || row.sync_enabled === true;
  const health7d = safeJsonParse(row.health7d_json, null);
  const health30d = safeJsonParse(row.health30d_json, null);

  return {
    id: row.id,
    connectionId: row.connection_id,
    orgId: row.org_id || null,
    orgName: row.org_name || 'Unknown Corporate',
    clientId: row.client_id,
    clientName: row.client_name,
    vendorOrgId: row.vendor_org_id || null,
    vendorOrgName: row.vendor_org_name || null,
    hrmsCode: row.hrms_code,
    hrmsName: row.hrms_name,
    hrmsDisplay: row.hrms_display,
    email: row.email || null,
    applicationConnectionStatus: row.application_connection_status || null,
    syncEnabled,
    status: row.status || null,
    lastSuccessfulSync: row.last_successful_sync || null,
    syncFrequency: row.sync_frequency || null,
    dateOfConnection: row.date_of_connection || null,
    searchableText: row.searchable_text || '',
    connection: safeJsonParse(row.connection_json, {}),
    health7d,
    health30d,
    recentSyncLogs: safeJsonParse(row.recent_sync_logs_json, []),
    topEmployees: safeJsonParse(row.top_employees_json, []),
    indexedAt: row.indexed_at || null,
    syncBatchId: row.sync_batch_id || null,
  };
}

function buildFilterOptions(entries) {
  const clients = new Map();
  const hrms = new Map();
  const appStatuses = new Set();
  const healthStatuses = new Set();

  entries.forEach(e => {
    clients.set(e.clientId, e.clientName);
    hrms.set(e.hrmsCode, { code: e.hrmsCode, name: e.hrmsName, display: e.hrmsDisplay });
    if (e.applicationConnectionStatus != null) appStatuses.add(String(e.applicationConnectionStatus));
    if (e.health7d?.overallStatus) healthStatuses.add(e.health7d.overallStatus);
  });

  return {
    clients: Array.from(clients.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    hrms: Array.from(hrms.values()).sort((a, b) => a.name.localeCompare(b.name)),
    applicationStatuses: Array.from(appStatuses).sort(),
    healthStatuses: Array.from(healthStatuses).sort(),
  };
}

function loadFromDisk() {
  ensureDataDir();
  const rows = readCsvFile(LATEST_CSV, CONNECTION_HEADERS);
  const entries = rows.map(csvRowToEntry);
  memoryIndex = {
    entries,
    lastIndexedAt: entries[0]?.indexedAt || null,
    connectionCount: entries.length,
    clientCount: new Set(entries.map(e => e.clientId)).size,
    filterOptions: buildFilterOptions(entries),
    csvPath: LATEST_CSV,
    lastSyncBatchId: entries[0]?.syncBatchId || null,
  };
  return memoryIndex;
}

function getIndex() {
  if (!memoryIndex.entries.length && fs.existsSync(LATEST_CSV)) {
    loadFromDisk();
  }
  return memoryIndex;
}

function persistIndex(entries, meta = {}) {
  ensureDataDir();
  const batchId = meta.batchId || new Date().toISOString();
  const syncedAt = new Date().toISOString();
  const csvRows = entries.map(e => entryToCsvRow(e, batchId));

  writeCsvFile(LATEST_CSV, CONNECTION_HEADERS, csvRows);
  appendCsvRows(HISTORY_CSV, CONNECTION_HEADERS, csvRows);

  const employeeRows = [];
  entries.forEach(entry => {
    (entry.topEmployees || []).forEach((emp, idx) => {
      employeeRows.push({
        sync_batch_id: batchId,
        synced_at: syncedAt,
        connection_id: entry.connectionId,
        client_id: entry.clientId,
        client_name: entry.clientName,
        org_name: entry.orgName,
        employee_rank: String(idx + 1),
        employee_email: emp.email || '',
        employee_name: emp.name || '',
        employee_json: JSON.stringify(emp.raw || emp),
      });
    });
  });
  if (employeeRows.length) appendCsvRows(EMPLOYEES_CSV, EMPLOYEE_HEADERS, employeeRows);

  memoryIndex = {
    entries,
    lastIndexedAt: syncedAt,
    connectionCount: entries.length,
    clientCount: meta.clientCount || new Set(entries.map(e => e.clientId)).size,
    filterOptions: buildFilterOptions(entries),
    csvPath: LATEST_CSV,
    lastSyncBatchId: batchId,
    historyCsvPath: HISTORY_CSV,
    employeesCsvPath: EMPLOYEES_CSV,
  };

  return memoryIndex;
}

function getCsvPaths() {
  return {
    latest: LATEST_CSV,
    history: HISTORY_CSV,
    employees: EMPLOYEES_CSV,
  };
}

function migrateFromJson(jsonIndex) {
  if (!jsonIndex?.entries?.length) return null;
  return persistIndex(jsonIndex.entries, {
    batchId: `migrated-${Date.now()}`,
    clientCount: jsonIndex.clientCount,
  });
}

function importLatestCsvText(csvText, options = {}) {
  const rows = readCsvText(csvText, CONNECTION_HEADERS);
  if (!rows.length) {
    return { imported: 0, merged: 0, skipped: 0, index: getIndex() };
  }

  const incomingEntries = rows.map(csvRowToEntry).filter(e => e && e.id && e.connectionId);
  const mode = options.mode === 'merge' ? 'merge' : 'replace';

  let finalEntries = incomingEntries;
  let merged = 0;
  if (mode === 'merge') {
    const current = getIndex().entries || [];
    const map = new Map(current.map(e => [e.id, e]));
    incomingEntries.forEach(e => {
      if (map.has(e.id)) merged++;
      map.set(e.id, e);
    });
    finalEntries = Array.from(map.values());
  }

  const batchId = options.batchId || `import-${Date.now()}`;
  const persisted = persistIndex(finalEntries, {
    batchId,
    clientCount: new Set(finalEntries.map(e => e.clientId)).size,
  });
  return {
    imported: incomingEntries.length,
    merged,
    skipped: rows.length - incomingEntries.length,
    index: persisted,
  };
}

module.exports = {
  loadFromDisk,
  getIndex,
  persistIndex,
  getCsvPaths,
  migrateFromJson,
  importLatestCsvText,
  buildFilterOptions,
  LATEST_CSV,
  HISTORY_CSV,
  EMPLOYEES_CSV,
};
