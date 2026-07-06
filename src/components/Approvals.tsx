import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { ApprovalRequest, UserInfo } from '../api';

type Tab = 'pending' | 'history' | 'mine';

type Props = { user: UserInfo };

export default function Approvals({ user }: Props) {
  const [tab, setTab] = useState<Tab>(user.role === 'superadmin' ? 'pending' : 'mine');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const fetcher =
      tab === 'mine' ? api.getMyApprovals() :
      user.role !== 'superadmin' ? Promise.resolve([]) :
      tab === 'pending' ? api.getApprovals('pending') :
      api.getApprovals('all').then(all => all.filter(r => r.status !== 'pending'));

    fetcher
      .then(r => { setRequests(r); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, [tab, user.role]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    try {
      await api.approveAction(id);
      setMsg('Action approved and executed successfully');
      setTimeout(() => setMsg(''), 3000);
      load();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await api.rejectAction(id);
      setMsg('Action rejected');
      setTimeout(() => setMsg(''), 3000);
      load();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Rejection failed');
    }
  };

  const statusStyle = (status: string) => {
    if (status === 'approved') return { color: 'var(--success-emerald)', borderColor: 'rgba(5,150,105,0.3)' };
    if (status === 'rejected') return { color: 'var(--p0-rose)', borderColor: 'rgba(225,29,72,0.3)' };
    return { color: 'var(--warning-amber)', borderColor: 'rgba(217,119,6,0.3)' };
  };

  if (loading) return <div className="empty-state">Loading approvals...</div>;

  return (
    <div className="animate-fade-in">
      <div className="view-header">
        <div>
          <h2 className="results-title">Approvals</h2>
          <p className="subtitle page-subtitle">
            Deletions and sensitive actions require superadmin consent. Review pending requests or browse history.
          </p>
        </div>
        <div className="tab-buttons">
          {user.role === 'superadmin' && (
            <>
              <button className={`btn-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>Pending</button>
              <button className={`btn-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
            </>
          )}
          <button className={`btn-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>My requests</button>
        </div>
      </div>

      {msg && <div className="toast-msg">{msg}</div>}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Requested By</th>
              <th>Action</th>
              <th>Details</th>
              <th>Status</th>
              <th>Date</th>
              {tab === 'pending' && <th style={{ width: '150px' }}>Decision</th>}
              {tab === 'history' && <th>Processed</th>}
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                <td>{r.requestedBy}</td>
                <td><span className="action-tag" style={{ borderColor: '#f43f5e', color: '#f43f5e' }}>{r.action}</span></td>
                <td>{r.details}</td>
                <td>
                  <span className="badge" style={statusStyle(r.status)}>{r.status}</span>
                </td>
                <td style={{ color: '#a1a1aa', fontSize: '0.8rem' }}>{new Date(r.requestedAt).toLocaleString()}</td>
                {tab === 'pending' && (
                  <td>
                    <div className="action-row">
                      <button className="btn-icon btn-success" onClick={() => handleApprove(r.id)} title="Approve">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                      </button>
                      <button className="btn-icon btn-danger" onClick={() => handleReject(r.id)} title="Reject">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                      </button>
                    </div>
                  </td>
                )}
                {tab === 'history' && (
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {r.processedBy ? `${r.processedBy} · ${r.processedAt ? new Date(r.processedAt).toLocaleString() : ''}` : '—'}
                  </td>
                )}
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={tab === 'pending' ? 6 : 6} className="text-center text-muted" style={{ padding: '3rem' }}>
                  {tab === 'pending' ? 'No pending approval requests.' :
                   tab === 'mine' ? 'You have not submitted any approval requests.' :
                   'No processed approval history yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
