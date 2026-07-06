import { useState, useEffect } from 'react';
import { api } from '../api';
import type { AuditEntry } from '../api';

const ACTION_COLORS: Record<string, string> = {
  LOGIN: '#059669', REVEAL_CREDENTIAL: '#d97706', FETCH_CONNECTIONS: '#1a6eff',
  ADD_CREDENTIAL: '#3b82f6', DELETE_CREDENTIAL: '#ef4444', ADD_USER: '#8b5cf6',
  DELETE_USER: '#ef4444', RESET_PASSWORD: '#f97316', VIEW_USERS: '#64748b',
  ADD_TOOL: '#10b981', DELETE_TOOL: '#f43f5e', EXECUTE_TOOL: '#8b5cf6',
  ADD_CURL_SNIPPET: '#0ea5e9', REVEAL_CURL_SNIPPET: '#d97706', UPDATE_CURL_SNIPPET: '#6366f1',
  DELETE_CURL_SNIPPET: '#ef4444', TRIGGER_GLOBAL_HEALTH: '#14b8a6', TRIGGER_SEARCH_REINDEX: '#14b8a6',
  APPROVE_DELETE_CREDENTIAL: '#059669', APPROVE_DELETE_USER: '#059669', APPROVE_DELETE_TOOL: '#059669',
  REJECT_DELETE_CREDENTIAL: '#ef4444', REJECT_DELETE_USER: '#ef4444', REJECT_DELETE_TOOL: '#ef4444',
};

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  useEffect(() => { api.getAuditLog().then(l => { setLogs(l); setLoading(false); }).catch(console.error); }, []);

  const filtered = logs.filter(l => {
    const matchAction = !actionFilter || l.action === actionFilter;
    const matchUser = !userFilter || l.username === userFilter;
    return matchAction && matchUser;
  });

  const actions = [...new Set(logs.map(l => l.action))];
  const users = [...new Set(logs.map(l => l.username))];

  if (loading) return <div className="empty-state">Loading audit log...</div>;

  return (
    <div className="animate-fade-in">
      <div className="view-header">
        <h2 className="results-title">Audit Log</h2>
        <p className="subtitle page-subtitle">
          Immutable record of privileged actions (logins, credential reveals, tool execution, curl access, approvals).
        </p>
      </div>

      <div className="audit-controls">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <select className="token-input compact" value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ maxWidth: '200px' }}>
            <option value="">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="token-input compact" value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ maxWidth: '200px' }}>
            <option value="">All Users</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <span className="text-muted" style={{ fontSize: '0.875rem', marginLeft: 'auto' }}>{filtered.length} entries</span>
      </div>

      <div className="table-wrapper">
        <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
          <table className="table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr><th style={{ width: '170px' }}>Timestamp</th><th style={{ width: '120px' }}>User</th><th style={{ width: '80px' }}>Role</th><th style={{ width: '170px' }}>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td className="text-muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{new Date(l.timestamp).toLocaleString()}</td>
                  <td>{l.username}</td>
                  <td><span className={'role-badge role-' + l.role}>{l.role}</span></td>
                  <td><span className="action-tag" style={{ borderColor: ACTION_COLORS[l.action] || '#52525b', color: ACTION_COLORS[l.action] || '#a1a1aa' }}>{l.action}</span></td>
                  <td style={{ fontSize: '0.8rem' }}>{l.details}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} className="text-center text-muted">No log entries found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
