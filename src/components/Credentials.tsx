import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { CredentialItem } from '../api';

type RevealedData = { username: string; password: string };

export default function Credentials() {
  const [creds, setCreds] = useState<CredentialItem[]>([]);
  const [revealed, setRevealed] = useState<Record<string, RevealedData | null>>({});
  const [timers, setTimers] = useState<Record<string, number>>({});
  const intervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const [newName, setNewName] = useState('');
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => { api.getCredentials().then(c => { setCreds(c); setLoading(false); }).catch(console.error); }, []);
  useEffect(() => { load(); return () => { Object.values(intervals.current).forEach(clearInterval); }; }, [load]);

  const handleReveal = async (id: string) => {
    if (revealed[id]) { hideCredential(id); return; }
    try {
      const data = await api.revealCredential(id);
      setRevealed(prev => ({ ...prev, [id]: data }));
      setTimers(prev => ({ ...prev, [id]: 60 }));
      if (intervals.current[id]) clearInterval(intervals.current[id]);
      intervals.current[id] = setInterval(() => {
        setTimers(prev => {
          const next = (prev[id] || 0) - 1;
          if (next <= 0) { hideCredential(id); return { ...prev, [id]: 0 }; }
          return { ...prev, [id]: next };
        });
      }, 1000);
    } catch (err) { console.error(err); }
  };

  const hideCredential = (id: string) => {
    setRevealed(prev => { const n = { ...prev }; delete n[id]; return n; });
    setTimers(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (intervals.current[id]) { clearInterval(intervals.current[id]); delete intervals.current[id]; }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUser || !newPass) return;
    await api.addCredential(newName, newUser, newPass);
    setNewName(''); setNewUser(''); setNewPass('');
    load();
  };

  const handleDelete = async (id: string) => {
    const cred = creds.find(c => c.id === id);
    if (!cred) return;
    if (!confirm('Request deletion of credential for "' + cred.clientName + '"?')) return;
    try {
      await api.requestApproval('DELETE_CREDENTIAL', id, 'Credential for ' + cred.clientName);
      alert('Deletion request sent for superadmin approval.');
    } catch (err: any) {
      alert(err.message || 'Request failed');
    }
  };

  const copyText = (text: string) => { navigator.clipboard.writeText(text); };

  if (loading) return <div className="empty-state">Loading credentials...</div>;

  return (
    <div className="animate-fade-in">
      <div className="view-header">
        <h2 className="results-title">Manage Credentials</h2>
        <p className="subtitle" style={{ textAlign: 'left', margin: '0.5rem 0 0' }}>
          Client API credentials are AES-256 encrypted. Reveal access is logged and auto-hides after 60 seconds.
        </p>
      </div>

      <div className="form-container">
        <form onSubmit={handleAdd} className="add-cred-form">
          <div className="input-group">
            <label className="input-label">Client Name</label>
            <input required value={newName} onChange={e => setNewName(e.target.value)} className="token-input" placeholder="e.g. MMT" />
          </div>
          <div className="input-group">
            <label className="input-label">Username</label>
            <input required value={newUser} onChange={e => setNewUser(e.target.value)} className="token-input" placeholder="Username" />
          </div>
          <div className="input-group">
            <label className="input-label">Password</label>
            <input required type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="token-input" placeholder="Password" />
          </div>
          <div className="input-group" style={{ justifyContent: 'flex-end', paddingTop: '1.5rem' }}>
            <button type="submit" className="btn-primary">Add Client</button>
          </div>
        </form>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Username</th>
              <th>Password</th>
              <th style={{ width: '120px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {creds.map(c => {
              const rev = revealed[c.id];
              const timer = timers[c.id];
              return (
                <tr key={c.id}>
                  <td>{c.clientName}</td>
                  <td>
                    {rev ? (
                      <span className="revealed-text" onClick={() => copyText(rev.username)} title="Click to copy">{rev.username}</span>
                    ) : (
                      <span className="encrypted-text">••••••••••</span>
                    )}
                  </td>
                  <td>
                    {rev ? (
                      <span className="revealed-text" onClick={() => copyText(rev.password)} title="Click to copy">{rev.password}</span>
                    ) : (
                      <span className="encrypted-text">••••••••••</span>
                    )}
                  </td>
                  <td>
                    <div className="action-row">
                      <button onClick={() => handleReveal(c.id)} className={'btn-icon' + (rev ? ' btn-active' : '')} title={rev ? 'Hide' : 'Reveal'}>
                        {rev ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.092 1.092a4 4 0 00-5.558-5.558z" clipRule="evenodd" /><path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" /></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                        )}
                      </button>
                      {timer != null && timer > 0 && <span className="timer-badge">{timer}s</span>}
                      <button onClick={() => handleDelete(c.id)} className="btn-icon btn-danger" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {creds.length === 0 && <tr><td colSpan={4} className="text-center text-muted">No credentials found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
