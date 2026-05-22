const TOKEN_KEY = 'tartan_token';
const USER_KEY = 'tartan_user';

export type UserInfo = { id: string; username: string; role: 'superadmin' | 'user' };
export type CredentialItem = { id: string; clientName: string; createdAt: string };
export type AuditEntry = { id: string; timestamp: string; userId: string; username: string; role: string; action: string; details: string };
export type UserItem = { id: string; username: string; role: string; createdAt: string };
export type ToolItem = { id: string; name: string; curl: string; variables: string[]; environments: string[]; createdAt: string };
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

async function request(url: string, opts: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { clearAuth(); window.location.reload(); throw new Error('Session expired'); }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
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
  deleteCredential: (id: string) => request('/api/credentials/' + id, { method: 'DELETE' }),
  revealCredential: (id: string): Promise<{ username: string; password: string }> => request('/api/credentials/' + id + '/reveal'),

  // Connections
  fetchConnections: (credId: string) => request('/api/connections/' + credId),

  // Audit
  getAuditLog: (): Promise<AuditEntry[]> => request('/api/audit'),

  // Tools
  getTools: (): Promise<ToolItem[]> => request('/api/tools'),
  addTool: (name: string, curl: string, variables: string[], environments: string[]) => request('/api/tools', { method: 'POST', body: JSON.stringify({ name, curl, variables, environments }) }),
  deleteTool: (id: string) => request('/api/tools/' + id, { method: 'DELETE' }),
  executeTool: (credId: string, url: string, method: string, headers: any, body: any, environment: string) => 
    request('/api/tools/execute', { method: 'POST', body: JSON.stringify({ credId, url, method, headers, body, environment }) }),
  
  // Vendor Info
  getVendorInfo: (credId: string): Promise<{ vendor_org_id: string; org_name: string }> => request('/api/vendor-info/' + credId),

  // Approvals
  getApprovals: (): Promise<ApprovalRequest[]> => request('/api/approvals'),
  requestApproval: (action: string, targetId: string, details: string) => request('/api/approvals/request', { method: 'POST', body: JSON.stringify({ action, targetId, details }) }),
  approveAction: (id: string) => request('/api/approvals/' + id + '/approve', { method: 'POST' }),
  rejectAction: (id: string) => request('/api/approvals/' + id + '/reject', { method: 'POST' }),

  // Health Monitor
  fetchClientHealth: (credId: string, fromDate: string, toDate: string): Promise<any> => 
    request(`/api/health/client/${credId}?from_date=${fromDate}&to_date=${toDate}`),
  fetchGlobalHealthStatus: (): Promise<any> => request('/api/health/global-status'),
  triggerGlobalHealthCheck: (): Promise<any> => request('/api/health/global-check', { method: 'POST' }),
};
