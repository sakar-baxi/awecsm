import { useState, useEffect } from 'react';
import { api } from '../api';
import type { CredentialItem } from '../api';

type GroupedConnection = { monthYear: string; sortDate: Date; orgs: string; count: number };
type TabState = { loading: boolean; error: string; data: GroupedConnection[] | null };

export default function Dashboard() {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Record<string, TabState>>({});

  useEffect(() => { api.getCredentials().then(setCredentials).catch(console.error); }, []);

  const processConnections = (connections: { org_name: string; date_of_connection: string }[]): GroupedConnection[] => {
    const grouped: Record<string, { sortDate: Date; orgs: string[]; count: number }> = {};
    connections.forEach(item => {
      if (!item.date_of_connection) return;
      const match = item.date_of_connection.match(/\d+(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})/);
      if (match) {
        const month = match[1], year = match[2], key = month + ' ' + year.slice(-2);
        if (!grouped[key]) grouped[key] = { sortDate: new Date(month + ' 1, ' + year), orgs: [], count: 0 };
        if (item.org_name) { grouped[key].orgs.push(item.org_name); grouped[key].count++; }
      }
    });
    return Object.entries(grouped)
      .map(([monthYear, info]) => ({ monthYear, sortDate: info.sortDate, orgs: info.orgs.join(', '), count: info.count }))
      .sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());
  };

  const fetchClientData = async (credId: string) => {
    setTabData(prev => ({ ...prev, [credId]: { loading: true, error: '', data: null } }));
    try {
      const json = await api.fetchConnections(credId);
      if (!json.data || !Array.isArray(json.data)) throw new Error('Invalid response');
      setTabData(prev => ({ ...prev, [credId]: { loading: false, error: '', data: processConnections(json.data) } }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setTabData(prev => ({ ...prev, [credId]: { loading: false, error: msg, data: null } }));
    }
  };

  const handleSelectClient = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    if (!openTabs.includes(id)) { setOpenTabs(prev => [...prev, id]); fetchClientData(id); }
    setActiveTabId(id);
    e.target.value = '';
  };

  const handleCloseTab = (id: string) => {
    const newTabs = openTabs.filter(t => t !== id);
    setOpenTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1] : null);
  };

  const downloadCSV = (clientId: string) => {
    const state = tabData[clientId];
    if (!state?.data?.length) return;
    const cred = credentials.find(c => c.id === clientId);
    const name = cred ? cred.clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'client';
    const rows = state.data.map(r => [r.monthYear, r.count.toString(), '"' + r.orgs.replace(/"/g, '""') + '"']);
    const csv = ['Month,Count,From Console', ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name + '_connections.csv';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="animate-fade-in">
      <div className="form-container" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
        <div className="input-group">
          <label className="input-label">Select Client to Fetch</label>
          <select className="token-input" onChange={handleSelectClient} defaultValue="">
            <option value="" disabled>-- Choose a Client --</option>
            {credentials.map(c => (
              <option key={c.id} value={c.id} disabled={openTabs.includes(c.id)}>
                {c.clientName}{openTabs.includes(c.id) ? ' (Open)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {openTabs.length > 0 ? (
        <div className="tabs-container">
          <div className="tabs-header">
            {openTabs.map(id => {
              const cred = credentials.find(c => c.id === id);
              return (
                <div key={id} className={'tab-item' + (activeTabId === id ? ' active' : '')} onClick={() => setActiveTabId(id)}>
                  <span className="tab-title">{cred?.clientName || 'Unknown'}</span>
                  <button className="tab-close" onClick={e => { e.stopPropagation(); handleCloseTab(id); }}>&times;</button>
                </div>
              );
            })}
          </div>
          <div className="tab-content">
            {activeTabId && tabData[activeTabId] && (
              <div className="results-container">
                {tabData[activeTabId].loading ? (
                  <div className="empty-state" style={{ border: 'none' }}>
                    <div className="spinner" style={{ margin: '0 auto 1rem', width: '2rem', height: '2rem' }} />
                    Fetching and processing data...
                  </div>
                ) : tabData[activeTabId].error ? (
                  <div className="error-message" style={{ padding: '2rem', background: 'rgba(239,68,68,0.1)', borderRadius: '1rem' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    {tabData[activeTabId].error}
                    <button onClick={() => fetchClientData(activeTabId)} className="btn-secondary" style={{ marginLeft: 'auto', background: '#ef4444', color: 'white' }}>Retry</button>
                  </div>
                ) : (
                  <>
                    <div className="results-header">
                      <h2 className="results-title">{credentials.find(c => c.id === activeTabId)?.clientName} Connections</h2>
                      <button onClick={() => downloadCSV(activeTabId)} className="btn-secondary">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v6.879l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3z" clipRule="evenodd" /><path d="M3 14.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" /></svg>
                        Download CSV
                      </button>
                    </div>
                    {tabData[activeTabId].data && tabData[activeTabId].data!.length > 0 ? (
                      <div className="table-wrapper">
                        <table className="table">
                          <thead><tr><th style={{ width: '150px' }}>Month</th><th style={{ width: '100px' }}>Count</th><th>From Console</th></tr></thead>
                          <tbody>
                            {tabData[activeTabId].data!.map((row, idx) => (
                              <tr key={idx}>
                                <td style={{ verticalAlign: 'top' }}><span className="month-tag">{row.monthYear}</span></td>
                                <td style={{ verticalAlign: 'top' }}><span className="count-badge">{row.count}</span></td>
                                <td>{row.orgs}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-state">No connections found for this client.</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <svg style={{ margin: '0 auto 1rem', color: '#3f3f46' }} xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          <h3 style={{ color: '#e4e4e7', margin: '0 0 0.5rem', fontWeight: 500 }}>No Clients Selected</h3>
          Select a client from the dropdown above to fetch and view their connections.
        </div>
      )}
    </div>
  );
}
