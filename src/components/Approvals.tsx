import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { ApprovalRequest } from '../api';

export default function Approvals() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getApprovals().then(r => {
      setRequests(r);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    try {
      await api.approveAction(id);
      setMsg('Action approved and executed successfully');
      setTimeout(() => setMsg(''), 3000);
      load();
    } catch (err: any) {
      setMsg(err.message || 'Approval failed');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await api.rejectAction(id);
      setMsg('Action rejected');
      setTimeout(() => setMsg(''), 3000);
      load();
    } catch (err: any) {
      setMsg(err.message || 'Rejection failed');
    }
  };

  if (loading) return <div className="empty-state">Loading pending approvals...</div>;

  return (
    <div className="animate-fade-in">
      <div className="view-header">
        <h2 className="results-title">Pending Approvals</h2>
        <p className="subtitle" style={{ textAlign: 'left', margin: '0.5rem 0 0' }}>
          Deletions and sensitive actions require superadmin consent before execution.
        </p>
      </div>

      {msg && <div className="toast-msg">{msg}</div>}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Requested By</th>
              <th>Action</th>
              <th>Details</th>
              <th>Date</th>
              <th style={{ width: '150px' }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                <td>{r.requestedBy}</td>
                <td><span className="action-tag" style={{ borderColor: '#f43f5e', color: '#f43f5e' }}>{r.action}</span></td>
                <td>{r.details}</td>
                <td style={{ color: '#a1a1aa', fontSize: '0.8rem' }}>{new Date(r.requestedAt).toLocaleString()}</td>
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
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted" style={{ padding: '3rem' }}>
                  No pending approval requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
