const TOKEN_KEY = 'tartan_token';
const USER_KEY = 'tartan_user';

export type UserInfo = { id: string; username: string; role: 'superadmin' | 'user' };
export type CredentialItem = { id: string; clientName: string; createdAt: string };
export type AuditEntry = { id: string; timestamp: string; userId: string; username: string; role: string; action: string; details: string };
export type UserItem = { id: string; username: string; role: string; createdAt: string };
export type ToolItem = { id: string; name: string; curl: string; variables: string[]; environments: string[]; createdAt: string };
export type CurlSnippetMeta = {
  id: string;
  label: string;
  connectionId: string | null;
  clientId: string | null;
  clientName: string | null;
  orgName: string | null;
  notes: string;
  createdBy: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
};
export type ApprovalRequest = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  action: string;
  targetId: string;
  details: string;
  requestedBy: string;
  requestedAt: string;
  processedBy?: string;
  processedAt?: string;
};

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveAuth(token: string, user: UserInfo) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadUser(): UserInfo | null {
  const s = localStorage.getItem(USER_KEY);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { clearAuth(); window.location.reload(); throw new Error('Session expired'); }
  const text = await res.text();
  let json: T;
  try {
    json = (text ? JSON.parse(text) : {}) as T;
  } catch {
    if (text.trim().startsWith('<')) {
      throw new Error('API route not found. Ensure the backend server is running on port 3001.');
    }
    throw new Error('Invalid server response');
  }
  if (!res.ok) {
    const err = json as { error?: string };
    throw new Error(err?.error || 'Request failed');
  }
  return json;
}

// Auth
export const api = {
  login: (username: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/api/auth/me'),

  // Users
  getUsers: (): Promise<UserItem[]> => request('/api/users'),
  createUser: (username: string, password: string, role: string) => request('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }),
  resetPassword: (id: string, password: string) => request('/api/users/' + id + '/reset-password', { method: 'PUT', body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => request('/api/users/' + id, { method: 'DELETE' }),

  // Credentials
  getCredentials: (): Promise<CredentialItem[]> => request('/api/credentials'),
  addCredential: (clientName: string, username: string, password: string) => request('/api/credentials', { method: 'POST', body: JSON.stringify({ clientName, username, password }) }),
  importCredentialsCsv: (): Promise<{ added: number; updated: number; total: number }> =>
    request('/api/credentials/import-csv', { method: 'POST' }),
  deleteCredential: (id: string) => request('/api/credentials/' + id, { method: 'DELETE' }),
  revealCredential: (id: string): Promise<{ username: string; password: string }> => request('/api/credentials/' + id + '/reveal'),

  // Connections
  fetchConnections: (credId: string): Promise<{ data: { org_name: string; date_of_connection: string }[] }> =>
    request('/api/connections/' + credId),

  // Audit
  getAuditLog: (): Promise<AuditEntry[]> => request('/api/audit'),

  // Tools
  getTools: (): Promise<ToolItem[]> => request('/api/tools'),
  addTool: (name: string, curl: string, variables: string[], environments: string[]) => request('/api/tools', { method: 'POST', body: JSON.stringify({ name, curl, variables, environments }) }),
  deleteTool: (id: string) => request('/api/tools/' + id, { method: 'DELETE' }),
  executeTool: (credId: string, url: string, method: string, headers: any, body: any, environment: string, toolName?: string) => 
    request('/api/tools/execute', { method: 'POST', body: JSON.stringify({ credId, url, method, headers, body, environment, toolName }) }),
  
  // Vendor Info
  getVendorInfo: (credId: string): Promise<{ vendor_org_id: string; org_name: string }> => request('/api/vendor-info/' + credId),

  // Approvals
  getApprovals: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<ApprovalRequest[]> =>
    request('/api/approvals?status=' + status),
  getMyApprovals: (): Promise<ApprovalRequest[]> => request('/api/approvals/mine'),
  requestApproval: (action: string, targetId: string, details: string) => request('/api/approvals/request', { method: 'POST', body: JSON.stringify({ action, targetId, details }) }),
  approveAction: (id: string) => request('/api/approvals/' + id + '/approve', { method: 'POST' }),
  rejectAction: (id: string) => request('/api/approvals/' + id + '/reject', { method: 'POST' }),

  // Health Monitor
  fetchClientHealth: (credId: string, fromDate: string, toDate: string): Promise<any> => 
    request(`/api/health/client/${credId}?from_date=${fromDate}&to_date=${toDate}`),
  fetchGlobalHealthStatus: (): Promise<any> => request('/api/health/global-status'),
  triggerGlobalHealthCheck: (): Promise<any> => request('/api/health/global-check', { method: 'POST' }),
  fetchSyncMetrics: (days: number, granularity: string): Promise<any> =>
    request(`/api/health/sync-metrics?days=${days}&granularity=${granularity}`),
  refreshSyncMetrics: (days: number, granularity: string): Promise<any> =>
    request('/api/health/sync-metrics/refresh', {
      method: 'POST',
      body: JSON.stringify({ days, granularity }),
    }),

  // Global Search
  fetchSearchStatus: (): Promise<any> => request('/api/search/status'),
  triggerSearchReindex: (): Promise<any> => request('/api/search/reindex', { method: 'POST' }),
  searchConnections: (params: {
    q?: string;
    clientId?: string;
    hrmsCode?: string;
    healthStatus?: string;
    applicationStatus?: string;
    syncEnabled?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.clientId) qs.set('clientId', params.clientId);
    if (params.hrmsCode) qs.set('hrmsCode', params.hrmsCode);
    if (params.healthStatus) qs.set('healthStatus', params.healthStatus);
    if (params.applicationStatus) qs.set('applicationStatus', params.applicationStatus);
    if (params.syncEnabled) qs.set('syncEnabled', params.syncEnabled);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return request('/api/search?' + qs.toString());
  },
  fetchConnectionDetail: (connectionId: string, clientId: string, fresh = false): Promise<any> => {
    const qs = new URLSearchParams({ clientId });
    if (fresh) qs.set('fresh', '1');
    return request(`/api/search/connection/${encodeURIComponent(connectionId)}?${qs.toString()}`);
  },
  downloadSearchCsv: (type: 'latest' | 'history' | 'employees' = 'latest') => {
    const token = localStorage.getItem('tartan_token');
    return fetch(`/api/search/export/csv?type=${type}`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }).then(async res => {
      if (res.status === 401) { clearAuth(); window.location.reload(); throw new Error('Session expired'); }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Download failed');
      }
      return res.blob();
    });
  },

  // Curl snippet repository (encrypted at rest; curl revealed on demand)
  searchCurlSnippets: (params: {
    q?: string;
    connectionId?: string;
    clientId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; results: CurlSnippetMeta[]; limit: number; offset: number }> => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.connectionId) qs.set('connectionId', params.connectionId);
    if (params.clientId) qs.set('clientId', params.clientId);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return request('/api/curl-snippets?' + qs.toString());
  },
  addCurlSnippet: (payload: {
    label: string;
    curl: string;
    connectionId?: string;
    clientId?: string;
    clientName?: string;
    orgName?: string;
    notes?: string;
  }) => request('/api/curl-snippets', { method: 'POST', body: JSON.stringify(payload) }),
  revealCurlSnippet: (id: string): Promise<CurlSnippetMeta & { curl: string }> =>
    request('/api/curl-snippets/' + encodeURIComponent(id) + '/reveal'),
  updateCurlSnippet: (id: string, payload: Partial<{
    label: string;
    curl: string;
    connectionId: string;
    clientId: string;
    clientName: string;
    orgName: string;
    notes: string;
  }>) => request('/api/curl-snippets/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCurlSnippet: (id: string) =>
    request('/api/curl-snippets/' + encodeURIComponent(id), { method: 'DELETE' }),
};
