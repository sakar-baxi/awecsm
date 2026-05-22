import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { CredentialItem } from '../api';

type Tab = 'client-history' | 'hrms-dashboard';

export default function HealthMonitor() {
  const [activeTab, setActiveTab] = useState<Tab>('client-history');
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [selectedCredId, setSelectedCredId] = useState('');
  
  // Date Range State (Default: Last 30 Days)
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Client Sync History Data
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyData, setHistoryData] = useState<any>(null);

  // Connection Alert Filter Threshold (Days)
  const [alertDaysFilter, setAlertDaysFilter] = useState<number>(3);

  // Global HRMS Dashboard Data
  const [globalStatus, setGlobalStatus] = useState<any>(null);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [pollingGlobal, setPollingGlobal] = useState(false);

  // Fetch initial client credentials list
  useEffect(() => {
    api.getCredentials()
      .then(setCredentials)
      .catch(err => console.error('Failed to load credentials:', err));
  }, []);

  // Poll global status if a scan is active
  useEffect(() => {
    fetchGlobalStatus();
    let interval: any;
    if (pollingGlobal) {
      interval = setInterval(() => {
        fetchGlobalStatus();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [pollingGlobal]);

  const fetchGlobalStatus = async () => {
    try {
      const res = await api.fetchGlobalHealthStatus();
      setGlobalStatus(res);
      if (res.running) {
        setPollingGlobal(true);
      } else {
        setPollingGlobal(false);
      }
    } catch (err) {
      console.error('Failed to load global status:', err);
    }
  };

  const triggerGlobalCheck = async () => {
    setLoadingGlobal(true);
    try {
      const res = await api.triggerGlobalHealthCheck();
      setGlobalStatus((prev: any) => ({ ...prev, ...res, running: true }));
      setPollingGlobal(true);
    } catch (err) {
      alert('Failed to trigger scan: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoadingGlobal(false);
    }
  };

  const fetchClientHealth = async () => {
    if (!selectedCredId) return;
    setLoadingHistory(true);
    setHistoryError('');
    setHistoryData(null);
    try {
      const res = await api.fetchClientHealth(selectedCredId, fromDate, toDate);
      setHistoryData(res);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to fetch sync history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handlePresetDate = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setFromDate(start.toISOString().split('T')[0]);
    setToDate(end.toISOString().split('T')[0]);
  };

  // CSV Exporter
  const downloadClientCSV = () => {
    if (!historyData || !historyData.connections.length) return;
    const clientName = credentials.find(c => c.id === selectedCredId)?.clientName || 'client';
    
    // Headers
    const headers = [
      'Corporate Name',
      'Connection ID',
      'HRMS Provider',
      'Status',
      'Success Rate (%)',
      'Total Syncs',
      'Successful Syncs',
      'Failed Syncs',
      'Avg Latency (sec)',
      'Employees Found',
      'Employees Created',
      'Employees Updated',
      'Last Sync Time',
      'Last Sync Status',
      'Failure Reasons'
    ];

    const rows = historyData.connections.map((c: any) => [
      c.orgName,
      c.id,
      c.hrmsName,
      c.overallStatus.toUpperCase(),
      c.successRate,
      c.totalSyncs,
      c.successSyncs,
      c.failedSyncs,
      c.metrics.avgDurationSeconds,
      c.metrics.totalEmployeesFound,
      c.metrics.totalEmployeesCreated,
      c.metrics.totalEmployeesUpdated,
      c.lastSyncTime || 'N/A',
      c.lastSyncStatus || 'N/A',
      c.failureReasons.join(' | ') || 'None'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((r: any) => r.map((field: any) => `"${String(field).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_health_report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compute connections matching alert filter
  const alertingConnections = useMemo(() => {
    if (!historyData) return [];
    return historyData.connections.filter((c: any) => {
      // Find dailyStatus dates matching the last X days
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - alertDaysFilter);
      const limitStr = limitDate.toISOString().split('T')[0];

      // Filter dailyStatus entries in the alert window
      const recentDays = c.dailyStatus.filter((day: any) => day.date >= limitStr);
      
      // If there were only failures, or zero successful runs in the last X days, and we expected syncs or it had failures
      const hasRecentFailures = recentDays.some((d: any) => d.status === 'failed');
      const hasZeroSuccesses = !recentDays.some((d: any) => d.status === 'success');
      
      // If there are failures or no successful sync runs recently
      return hasRecentFailures || (hasZeroSuccesses && c.overallStatus === 'failed');
    });
  }, [historyData, alertDaysFilter]);

  return (
    <div className="animate-fade-in health-monitor-wrapper">
      <div className="view-header">
        <div>
          <h2 className="results-title">Operational Health Monitor</h2>
          <p className="subtitle page-subtitle">
            CSM Enterprise intelligence portal for vendor sync success rates and HRMS network status.
          </p>
        </div>
        <div className="tab-buttons">
          <button 
            className={`btn-tab ${activeTab === 'client-history' ? 'active' : ''}`}
            onClick={() => setActiveTab('client-history')}
          >
            Client Sync History
          </button>
          <button 
            className={`btn-tab ${activeTab === 'hrms-dashboard' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('hrms-dashboard');
              fetchGlobalStatus();
            }}
          >
            Global HRMS Health
          </button>
        </div>
      </div>

      {activeTab === 'client-history' && (
        <div className="tab-pane">
          {/* Controls Panel */}
          <div className="form-container" style={{ marginBottom: '1.5rem' }}>
            <div className="controls-grid">
              <div className="input-group">
                <label className="input-label">Select Client Vendor</label>
                <select 
                  className="token-input" 
                  value={selectedCredId} 
                  onChange={e => setSelectedCredId(e.target.value)}
                >
                  <option value="">-- Select Client Vendor --</option>
                  {credentials.map(c => (
                    <option key={c.id} value={c.id}>{c.clientName}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Date Range Quick Filters</label>
                <div className="preset-buttons">
                  <button type="button" className="btn-preset" onClick={() => handlePresetDate(3)}>Last 3 Days</button>
                  <button type="button" className="btn-preset" onClick={() => handlePresetDate(5)}>Last 5 Days</button>
                  <button type="button" className="btn-preset" onClick={() => handlePresetDate(7)}>1 Week</button>
                  <button type="button" className="btn-preset" onClick={() => handlePresetDate(30)}>1 Month</button>
                </div>
              </div>

              <div className="date-inputs-group">
                <div className="input-group">
                  <label className="input-label">From Date</label>
                  <input 
                    type="date" 
                    className="token-input compact" 
                    value={fromDate} 
                    onChange={e => setFromDate(e.target.value)} 
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">To Date</label>
                  <input 
                    type="date" 
                    className="token-input compact" 
                    value={toDate} 
                    onChange={e => setToDate(e.target.value)} 
                  />
                </div>
              </div>

              <div className="action-group">
                <button 
                  className="btn-primary full-width" 
                  onClick={fetchClientHealth} 
                  disabled={loadingHistory || !selectedCredId}
                >
                  {loadingHistory ? <span className="spinner" /> : 'Fetch History & Map'}
                </button>
              </div>
            </div>
          </div>

          {/* Results Area */}
          {loadingHistory && (
            <div className="empty-state card-glass">
              <div className="spinner large" style={{ margin: '0 auto 1.5rem' }} />
              <h3 className="state-title">Fetching Sync Metrics</h3>
              <p className="state-muted">Gathering daily sync logs and mapping them to connection endpoints...</p>
            </div>
          )}

          {historyError && (
            <div className="error-card animate-fade-in">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="24" height="24" style={{ color: '#ef4444' }}><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.732 6.232a.75.75 0 011.017-.072l.08.072 2.5 2.5a.75.75 0 01-.976 1.137l-.084-.072L10 8.56l-1.27 1.27a.75.75 0 01-1.137-.976l.072-.084 1.27-1.27-1.27-1.27a.75.75 0 01-.072-1.017l.072-.08z" clipRule="evenodd" /></svg>
              <div>
                <h4 className="state-title" style={{ fontSize: '0.9rem' }}>Fetch Failed</h4>
                <p className="state-muted">{historyError}</p>
              </div>
              <button className="btn-secondary btn-danger" style={{ marginLeft: 'auto' }} onClick={fetchClientHealth}>Retry</button>
            </div>
          )}

          {!loadingHistory && !historyError && !historyData && (
            <div className="empty-state card-glass">
              <svg className="empty-icon" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              <h3 className="state-title">No Client Selected</h3>
              Select a vendor client and pick a date range to generate a visual health report.
            </div>
          )}

          {historyData && (
            <div className="history-results animate-fade-in">
              {/* Summary Cards */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-title">Active Connections</span>
                    <span className="metric-icon">🔗</span>
                  </div>
                  <div className="metric-value">{historyData.summary.totalConnections}</div>
                  <div className="metric-footer">Across all mapped corporates</div>
                </div>

                <div className="metric-card healthy">
                  <div className="metric-header">
                    <span className="metric-title">Healthy Syncs</span>
                    <span className="metric-icon green">✓</span>
                  </div>
                  <div className="metric-value">{historyData.summary.healthy}</div>
                  <div className="metric-footer">Connections with 100% success</div>
                </div>

                <div className="metric-card warning">
                  <div className="metric-header">
                    <span className="metric-title">Partial/Stalled Warnings</span>
                    <span className="metric-icon orange">⚠️</span>
                  </div>
                  <div className="metric-value">{historyData.summary.warning}</div>
                  <div className="metric-footer">Failed attempts or no recent sync</div>
                </div>

                <div className="metric-card critical">
                  <div className="metric-header">
                    <span className="metric-title">Critical Failures</span>
                    <span className="metric-icon red">✗</span>
                  </div>
                  <div className="metric-value">{historyData.summary.failed}</div>
                  <div className="metric-footer">Connections completely failing</div>
                </div>
              </div>

              {/* CSM Alerts & Escalation Center */}
              <div className="alert-center-card">
                <div className="alert-center-header">
                  <div className="alert-header-row">
                    <span className="alert-icon-pulse">🚨</span>
                    <div>
                      <h3 className="state-title" style={{ fontSize: '1rem' }}>CSM Outage Escalation Center</h3>
                      <p className="state-muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Pinpoint integrations with critical outages or sync disruptions.
                      </p>
                    </div>
                  </div>
                  
                  {/* Outage Threshold Picker */}
                  <div className="alert-filters">
                    <span className="filter-label">Failing within last:</span>
                    <div className="pill-group">
                      <button className={`btn-pill ${alertDaysFilter === 3 ? 'active' : ''}`} onClick={() => setAlertDaysFilter(3)}>3 Days</button>
                      <button className={`btn-pill ${alertDaysFilter === 5 ? 'active' : ''}`} onClick={() => setAlertDaysFilter(5)}>5 Days</button>
                      <button className={`btn-pill ${alertDaysFilter === 7 ? 'active' : ''}`} onClick={() => setAlertDaysFilter(7)}>7 Days</button>
                      <button className={`btn-pill ${alertDaysFilter === 30 ? 'active' : ''}`} onClick={() => setAlertDaysFilter(30)}>30 Days</button>
                    </div>
                  </div>
                </div>

                <div className="alert-center-body">
                  {alertingConnections.length > 0 ? (
                    <div className="alerting-grid">
                      {alertingConnections.map((c: any) => (
                        <div key={c.id} className="alerting-item-card">
                          <div className="alerting-item-top">
                            <span className="alerting-corp-name">{c.orgName}</span>
                            <span className="badge-critical">OUTAGE</span>
                          </div>
                          <div className="alerting-item-detail">
                            <span><strong>HRMS:</strong> {c.hrmsName}</span>
                            <span><strong>Success Rate:</strong> {c.successRate}%</span>
                          </div>
                          {c.failureReasons.length > 0 && (
                            <div className="alerting-failure-reason">
                              <strong>Reason:</strong> {c.failureReasons[0]}
                            </div>
                          )}
                          <div className="alerting-item-footer">
                            Last synced: {c.lastSyncTime ? new Date(c.lastSyncTime).toLocaleString() : 'Never'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="alert-center-empty">
                      🎉 Perfect operational health! No connections are experiencing outages in this window.
                    </div>
                  )}
                </div>
              </div>

              {/* Main Health Grid Table */}
              <div className="results-header section-block">
                <h3 className="section-title">Mapped corporates</h3>
                <button className="btn-secondary" onClick={downloadClientCSV}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  Export CSV Report
                </button>
              </div>

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '220px' }}>Corporate / Connection ID</th>
                      <th style={{ width: '130px' }}>HRMS Provider</th>
                      <th style={{ width: '100px' }}>Status</th>
                      <th>Daily History Grid ({fromDate} to {toDate})</th>
                      <th style={{ width: '120px' }}>Success Rate</th>
                      <th style={{ width: '120px' }}>Last Sync Attempt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.connections.map((c: any) => (
                      <tr key={c.id} className="health-row">
                        <td>
                          <div className="corp-name-cell">{c.orgName}</div>
                          <div className="connection-id-cell">{c.id}</div>
                        </td>
                        <td>
                          <span className="hrms-badge">{c.hrmsName}</span>
                        </td>
                        <td>
                          <span className={`status-badge-premium ${c.overallStatus}`}>
                            {c.overallStatus.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          {/* Daily Visual Heatmap Grid */}
                          <div className="daily-grid-wrapper">
                            {c.dailyStatus.map((day: any, idx: number) => (
                              <div 
                                key={idx} 
                                className={`day-block ${day.status}`}
                                title={`${day.date}: ${day.status.toUpperCase()} (${day.successCount} success, ${day.failedCount} failed)`}
                              >
                                {day.status === 'success' && <span className="day-tick">✓</span>}
                                {day.status === 'failed' && <span className="day-cross">✗</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="success-rate-wrapper">
                            <div className="success-progress-bg">
                              <div 
                                className={`success-progress-fill ${c.overallStatus}`} 
                                style={{ width: `${c.successRate}%` }}
                              />
                            </div>
                            <span className="success-rate-val">{c.successRate}%</span>
                          </div>
                          <div className="sync-attempts-sub">{c.successSyncs}/{c.totalSyncs} syncs</div>
                        </td>
                        <td>
                          {c.lastSyncTime ? (
                            <>
                              <div className="last-sync-time">{new Date(c.lastSyncTime).toLocaleDateString()}</div>
                              <div className="last-sync-sub">{new Date(c.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            </>
                          ) : (
                            <span className="text-muted">Never Synced</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Extra PM Insights & Analytics */}
              <div className="pm-insights-section section-block">
                <h3 className="section-title">Analytics & diagnostics</h3>
                <div className="analytics-details-grid">
                  {/* Latency & Load Analysis */}
                  <div className="analytics-box card-glass">
                    <h4>Sync Latency & Load Analysis</h4>
                    <div className="table-wrapper compact-table">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Corporate Name</th>
                            <th>Avg Latency</th>
                            <th>Total Records</th>
                            <th>Avg / Sync</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyData.connections.slice(0, 5).map((c: any) => (
                            <tr key={c.id}>
                              <td>{c.orgName}</td>
                              <td><span className="latency-val">{c.metrics.avgDurationSeconds}s</span></td>
                              <td>{c.metrics.totalEmployeesFound} emps</td>
                              <td>{c.totalSyncs > 0 ? Math.round(c.metrics.totalEmployeesFound / c.totalSyncs) : 0} / sync</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Failure Category Diagnostics */}
                  <div className="analytics-box card-glass">
                    <h4>Active Diagnostics & Failure Root Causes</h4>
                    <div className="root-cause-list">
                      {historyData.connections.filter((c: any) => c.failureReasons.length > 0).slice(0, 4).map((c: any) => (
                        <div key={c.id} className="root-cause-item">
                          <div className="root-cause-header">
                            <span className="root-cause-corp">{c.orgName}</span>
                            <span className="root-cause-hrms">{c.hrmsName}</span>
                          </div>
                          <p className="root-cause-reason">{c.failureReasons[0]}</p>
                        </div>
                      ))}
                      {historyData.connections.filter((c: any) => c.failureReasons.length > 0).length === 0 && (
                        <div className="empty-diagnostics">
                          🟢 No failure records in this selected period! Perfect API response rates.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'hrms-dashboard' && (
        <div className="tab-pane animate-fade-in">
          {/* Global Scanner Header */}
          <div className="global-scanner-card card-glass">
            <div className="scanner-layout">
              <div className="scanner-info">
                <h3>Global HRMS Providers Network Status</h3>
                <p>
                  System-wide analytics compiled across all active client instances. Auto-updates daily.
                </p>
                {globalStatus?.lastRun && (
                  <div className="last-run-badge">
                    <span>Last Full System Sync:</span> <strong>{new Date(globalStatus.lastRun).toLocaleString()}</strong>
                  </div>
                )}
              </div>

              <div className="scanner-action">
                <button 
                  className="btn-primary btn-scan" 
                  onClick={triggerGlobalCheck}
                  disabled={loadingGlobal || globalStatus?.running}
                >
                  {globalStatus?.running ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="spinner" />
                      Scanning Network...
                    </div>
                  ) : (
                    'Run Global Network Scan'
                  )}
                </button>
              </div>
            </div>

            {/* Polling / Running Progress Bar */}
            {globalStatus?.running && (
              <div className="progress-section animate-fade-in">
                <div className="progress-details">
                  <span>Currently scanning: <strong>{globalStatus.currentClient || 'Starting...'}</strong></span>
                  <span>{globalStatus.progress} / {globalStatus.total} Clients Scanned</span>
                </div>
                <div className="progress-track">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${(globalStatus.progress / (globalStatus.total || 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Global Outage Alerts */}
          {globalStatus?.alerts && globalStatus.alerts.length > 0 && (
            <div className="global-alert-banner card-glass">
              <div className="banner-title">
                ⚠️ Continuous Sync Disruptions in Last 7 Days ({globalStatus.alerts.length} connections)
              </div>
              <div className="banner-body">
                <div className="alert-horizontal-list">
                  {globalStatus.alerts.slice(0, 6).map((alert: any, idx: number) => (
                    <div key={idx} className="alert-banner-item">
                      <span className="alert-banner-client">{alert.clientName}</span> 
                      <span className="alert-banner-arrow">→</span>
                      <span className="alert-banner-corp">{alert.orgName}</span>
                      <span className="alert-banner-hrms">{alert.hrmsName}</span>
                      <span className="alert-banner-status red">FAILED</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* HRMS Grid */}
          <h3 className="section-title section-block">Aggregated HRMS registry</h3>
          
          {globalStatus?.hrmsList && globalStatus.hrmsList.length > 0 ? (
            <div className="hrms-cards-grid">
              {globalStatus.hrmsList.map((hrms: any, idx: number) => (
                <div key={idx} className={`hrms-card card-glass ${hrms.status}`}>
                  <div className="hrms-card-top">
                    <div>
                      <h4 className="hrms-card-name">{hrms.hrmsName}</h4>
                      <span className="hrms-card-clients-count">{hrms.clients.length} Clients using this HRMS</span>
                    </div>
                    <span className={`hrms-status-badge ${hrms.status}`}>
                      {hrms.status === 'outage' && '🚨 OUTAGE'}
                      {hrms.status === 'warning' && '⚠️ WARNING'}
                      {hrms.status === 'healthy' && '🟢 HEALTHY'}
                    </span>
                  </div>

                  <div className="hrms-clients-pills">
                    {hrms.clients.map((client: string, cIdx: number) => (
                      <span key={cIdx} className="client-pill">{client}</span>
                    ))}
                  </div>

                  <div className="hrms-metrics-bar">
                    <div className="hrms-metric-item">
                      <span className="h-m-val">{hrms.totalConnections}</span>
                      <span className="h-m-lbl">Connections</span>
                    </div>
                    <div className="hrms-metric-item green">
                      <span className="h-m-val">{hrms.healthyConnections}</span>
                      <span className="h-m-lbl">Healthy</span>
                    </div>
                    <div className="hrms-metric-item orange">
                      <span className="h-m-val">{hrms.warningConnections + hrms.noSyncConnections}</span>
                      <span className="h-m-lbl">Warning / Stalled</span>
                    </div>
                    <div className="hrms-metric-item red">
                      <span className="h-m-val">{hrms.failedConnections}</span>
                      <span className="h-m-lbl">Failed</span>
                    </div>
                  </div>

                  {hrms.status !== 'healthy' && (
                    <div className="hrms-failure-details-box">
                      <h5 className="state-title" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>Recent Outage Logs (Last 7 Days)</h5>
                      <div className="hrms-failure-scroller">
                        {hrms.connections.filter((c: any) => c.status === 'failed' || c.status === 'no_sync').map((c: any, cIdx: number) => (
                          <div key={cIdx} className="hrms-fail-log-item">
                            <span className="fail-log-client">[{c.clientName}] {c.orgName}</span>
                            <span className="fail-log-reason">{c.lastFailureReason || 'Stalled Connection (No attempts in 7 days)'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state card-glass">
              <svg className="empty-icon muted" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              <h3 className="state-title">No HRMS Data Found</h3>
              <p className="state-muted">Run a global system check scan above to fetch network status across all active integrations.</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
