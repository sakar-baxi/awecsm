/** Connection search index helpers */

function buildSearchableText(parts) {
  return Object.values(parts)
    .filter(v => v != null && v !== '')
    .map(v => String(v))
    .join(' ')
    .toLowerCase();
}

function buildIndexEntry(conn, meta) {
  const connectionId = String(conn.connection_id || conn.id || '');
  const orgId = conn.org_id != null ? String(conn.org_id) : null;
  const hrms = meta.getHrmsFromConnection(conn);
  const topEmployees = meta.topEmployees || [];

  const searchableText = buildSearchableText({
    connectionId,
    orgId,
    orgName: conn.org_name,
    clientName: meta.clientName,
    vendorOrgName: meta.vendorOrgName,
    hrmsCode: hrms.hrmsCode,
    hrmsName: hrms.hrmsName,
    email: conn.email,
    status: conn.status,
    applicationStatus: conn.application_connection_status,
    syncFrequency: conn.sync_frequency,
    employeeEmails: topEmployees.map(e => e.email).filter(Boolean).join(' '),
    employeeNames: topEmployees.map(e => e.name).filter(Boolean).join(' '),
  });

  return {
    id: `${meta.clientId}:${connectionId}`,
    connectionId,
    orgId,
    orgName: conn.org_name || 'Unknown Corporate',
    clientId: meta.clientId,
    clientName: meta.clientName,
    vendorOrgId: meta.vendorOrgId || null,
    vendorOrgName: meta.vendorOrgName || null,
    hrmsCode: hrms.hrmsCode,
    hrmsName: hrms.hrmsName,
    hrmsDisplay: hrms.hrmsDisplay,
    email: conn.email || null,
    applicationConnectionStatus: conn.application_connection_status ?? null,
    syncEnabled: conn.sync_enabled ?? null,
    status: conn.status ?? null,
    lastSuccessfulSync: conn.last_successful_sync || null,
    syncFrequency: conn.sync_frequency || null,
    dateOfConnection: conn.date_of_connection || null,
    searchableText,
    connection: conn,
    health7d: meta.health7d || null,
    health30d: meta.health30d || null,
    recentSyncLogs: meta.recentSyncLogs || [],
    topEmployees,
    indexedAt: new Date().toISOString(),
  };
}

function scoreEntry(entry, query) {
  let score = 0;
  const q = query.toLowerCase();
  if (entry.connectionId.toLowerCase() === q) score += 120;
  if (entry.orgId && entry.orgId.toLowerCase() === q) score += 110;
  if (entry.orgName.toLowerCase() === q) score += 100;
  if (entry.orgName.toLowerCase().startsWith(q)) score += 60;
  if (entry.hrmsName.toLowerCase().includes(q)) score += 45;
  if (entry.hrmsCode.toLowerCase() === q) score += 40;
  if (entry.clientName.toLowerCase().includes(q)) score += 35;
  (entry.topEmployees || []).forEach(emp => {
    if (emp.email && emp.email.toLowerCase() === q) score += 95;
    else if (emp.email && emp.email.toLowerCase().includes(q)) score += 70;
    if (emp.name && emp.name.toLowerCase().includes(q)) score += 30;
  });
  if (entry.searchableText.includes(q)) score += 20;
  return score;
}

function searchIndex(entries, opts = {}) {
  const {
    q = '',
    clientId = '',
    hrmsCode = '',
    healthStatus = '',
    applicationStatus = '',
    syncEnabled = '',
    limit = 50,
    offset = 0,
  } = opts;

  const query = String(q || '').trim().toLowerCase();
  let results = Array.isArray(entries) ? [...entries] : [];

  if (query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    results = results.filter(e => {
      if (e.connectionId.toLowerCase() === query) return true;
      if (e.orgId && e.orgId.toLowerCase() === query) return true;
      return tokens.every(t => e.searchableText.includes(t));
    });
    results.sort((a, b) => scoreEntry(b, query) - scoreEntry(a, query));
  } else {
    results.sort((a, b) => (a.orgName || '').localeCompare(b.orgName || ''));
  }

  if (clientId) results = results.filter(e => e.clientId === clientId);
  if (hrmsCode) results = results.filter(e => e.hrmsCode === hrmsCode);
  if (healthStatus) results = results.filter(e => e.health7d?.overallStatus === healthStatus);
  if (applicationStatus) {
    results = results.filter(
      e => String(e.applicationConnectionStatus || '').toLowerCase() === applicationStatus.toLowerCase()
    );
  }
  if (syncEnabled === 'true' || syncEnabled === 'false') {
    const enabled = syncEnabled === 'true';
    results = results.filter(e => e.syncEnabled === enabled);
  }

  const total = results.length;
  const slice = results.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 50));

  return {
    total,
    results: slice.map(e => ({
      id: e.id,
      connectionId: e.connectionId,
      orgId: e.orgId,
      orgName: e.orgName,
      clientId: e.clientId,
      clientName: e.clientName,
      hrmsCode: e.hrmsCode,
      hrmsName: e.hrmsName,
      hrmsDisplay: e.hrmsDisplay,
      email: e.email,
      applicationConnectionStatus: e.applicationConnectionStatus,
      syncEnabled: e.syncEnabled,
      lastSuccessfulSync: e.lastSuccessfulSync,
      syncFrequency: e.syncFrequency,
      health7d: e.health7d
        ? {
            overallStatus: e.health7d.overallStatus,
            successRate: e.health7d.successRate,
            totalSyncs: e.health7d.totalSyncs,
            lastFailureReason: e.health7d.lastFailureReason,
          }
        : null,
      matchedEmployees: (e.topEmployees || [])
        .filter(emp => {
          if (!query) return false;
          const email = (emp.email || '').toLowerCase();
          const name = (emp.name || '').toLowerCase();
          return email.includes(query) || name.includes(query);
        })
        .slice(0, 3)
        .map(emp => ({ email: emp.email, name: emp.name })),
    })),
  };
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    if (typeof val[0] === 'object') return JSON.stringify(val, null, 2);
    return val.join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

const DETAIL_SKIP_KEYS = new Set(['connection']);

function buildConnectionDetail(entry) {
  const conn = entry.connection || {};
  const shared = conn.shared_data_points || conn.sharedDataPoints || [];
  const notShared = conn.not_shared_data_points || conn.notSharedDataPoints || [];

  const knownFields = {
    connection_id: conn.connection_id || conn.id,
    org_id: conn.org_id,
    org_name: conn.org_name,
    hrms_code: conn.hrms_code || conn.hrmsCode,
    email: conn.email,
    status: conn.status,
    application_connection_status: conn.application_connection_status,
    sync_enabled: conn.sync_enabled,
    sync_frequency: conn.sync_frequency,
    last_successful_sync: conn.last_successful_sync,
    date_of_connection: conn.date_of_connection,
    employees_count: conn.employees_count ?? conn.employee_count,
    is_post_processing_rules_added: conn.is_post_processing_rules_added,
  };

  const additionalFields = Object.entries(conn)
    .filter(([k]) => !(k in knownFields) && !k.startsWith('_'))
    .map(([key, value]) => ({ key, label: humanizeKey(key), value: formatValue(value) }));

  return {
    id: entry.id,
    connectionId: entry.connectionId,
    orgId: entry.orgId,
    orgName: entry.orgName,
    clientId: entry.clientId,
    clientName: entry.clientName,
    vendor: {
      vendorOrgId: entry.vendorOrgId,
      vendorOrgName: entry.vendorOrgName,
    },
    hrms: {
      code: entry.hrmsCode,
      name: entry.hrmsName,
      display: entry.hrmsDisplay,
    },
    identity: {
      connectionId: entry.connectionId,
      orgId: entry.orgId,
      orgName: entry.orgName,
      email: entry.email,
      dateOfConnection: entry.dateOfConnection,
    },
    sync: {
      enabled: entry.syncEnabled,
      frequency: entry.syncFrequency,
      lastSuccessfulSync: entry.lastSuccessfulSync,
      applicationStatus: entry.applicationConnectionStatus,
      status: entry.status,
    },
    dataSharing: {
      shared: Array.isArray(shared) ? shared : [],
      notShared: Array.isArray(notShared) ? notShared : [],
      sharedCount: Array.isArray(shared) ? shared.length : 0,
      notSharedCount: Array.isArray(notShared) ? notShared.length : 0,
    },
    health7d: entry.health7d,
    health30d: entry.health30d,
    recentSyncLogs: entry.recentSyncLogs || [],
    topEmployees: (entry.topEmployees || []).map(emp => ({
      email: emp.email,
      name: emp.name,
      fields: emp.raw ? Object.entries(emp.raw).map(([key, value]) => ({
        key,
        label: humanizeKey(key),
        value: formatValue(value),
      })) : [],
      raw: emp.raw || emp,
    })),
    fields: Object.entries(knownFields).map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value: formatValue(value),
    })),
    additionalFields,
    raw: conn,
    indexedAt: entry.indexedAt,
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

module.exports = {
  buildIndexEntry,
  searchIndex,
  buildConnectionDetail,
  buildFilterOptions,
};
