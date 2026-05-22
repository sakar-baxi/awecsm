import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { UserItem } from '../api';

export default function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => { api.getUsers().then(u => { setUsers(u); setLoading(false); }).catch(console.error); }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    try {
      await api.createUser(newUsername, newPassword, newRole);
      setNewUsername(''); setNewPassword(''); setNewRole('user');
      setMsg('User created successfully');
      setTimeout(() => setMsg(''), 3000);
      load();
    } catch (err: unknown) { setMsg(err instanceof Error ? err.message : 'Error'); }
  };

  const handleReset = async (id: string) => {
    if (!resetPw) return;
    try {
      await api.resetPassword(id, resetPw);
      setResetId(null); setResetPw('');
      setMsg('Password reset successfully');
      setTimeout(() => setMsg(''), 3000);
    } catch (err: unknown) { setMsg(err instanceof Error ? err.message : 'Error'); }
  };

  const handleDelete = async (id: string) => {
    const user = users.find(u => u.id === id);
    if (!user) return;
    if (!confirm('Request deletion of user: ' + user.username + '?')) return;
    try {
      await api.requestApproval('DELETE_USER', id, 'User: ' + user.username);
      setMsg('Deletion request sent for superadmin approval.');
      setTimeout(() => setMsg(''), 3000);
    } catch (err: any) { setMsg(err.message); }
  };

  if (loading) return <div className="empty-state">Loading users...</div>;

  return (
    <div className="animate-fade-in">
      <div className="view-header">
        <h2 className="results-title">User Management</h2>
        <p className="subtitle page-subtitle">
          Create and manage user accounts. Only superadmins can access this page.
        </p>
      </div>

      {msg && <div className="toast-msg">{msg}</div>}

      <div className="form-container">
        <form onSubmit={handleCreate} className="add-cred-form">
          <div className="input-group">
            <label className="input-label">Username</label>
            <input required value={newUsername} onChange={e => setNewUsername(e.target.value)} className="token-input" placeholder="New username" />
          </div>
          <div className="input-group">
            <label className="input-label">Password</label>
            <input required type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="token-input" placeholder="Password" />
          </div>
          <div className="input-group">
            <label className="input-label">Role</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className="token-input">
              <option value="user">User</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
          <div className="input-group" style={{ justifyContent: 'flex-end', paddingTop: '1.5rem' }}>
            <button type="submit" className="btn-primary">Create User</button>
          </div>
        </form>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th style={{ width: '180px' }}>Actions</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td><span className={'role-badge role-' + u.role}>{u.role}</span></td>
                <td style={{ color: '#a1a1aa' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  {u.role !== 'superadmin' ? (
                    <div className="action-row">
                      {resetId === u.id ? (
                        <div className="inline-reset">
                          <input value={resetPw} onChange={e => setResetPw(e.target.value)} className="token-input compact" placeholder="New password" type="password" />
                          <button onClick={() => handleReset(u.id)} className="btn-icon btn-success" title="Save">✓</button>
                          <button onClick={() => { setResetId(null); setResetPw(''); }} className="btn-icon" title="Cancel">✕</button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => setResetId(u.id)} className="btn-icon" title="Reset password">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M8 7a5 5 0 113.61 4.804l-1.903 1.903A1 1 0 019 14H8v1a1 1 0 01-1 1H6v1a1 1 0 01-1 1H3a1 1 0 01-1-1v-2a1 1 0 01.293-.707L8.196 8.39A5.002 5.002 0 018 7zm5-3a.75.75 0 000 1.5A1.5 1.5 0 0114.5 7 .75.75 0 0016 7a3 3 0 00-3-3z" clipRule="evenodd" /></svg>
                          </button>
                          <button onClick={() => handleDelete(u.id)} className="btn-icon btn-danger" title="Delete user">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
