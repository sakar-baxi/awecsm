import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { CredentialItem } from '../api';
import { TaskProgressBanner, MinorTaskTimer } from './TaskProgress';

type Tab = 'client-history' | 'hrms-dashboard';
type StatusFilter = 'all' | 'healthy' | 'warning' | 'failed' | 'no_sync';
type DisruptionFilter = 'all' | 'failed' | 'warning' | 'no_sync';

type Props = { onOpenHelp?: () => void };

function statusFilterLabel(filter: StatusFilter): string {
  switch (filter) {
    case 'healthy': return 'healthy';
    case 'warning': return 'partial failures';
    case 'failed': return 'critical failures';
    case 'no_sync': return 'no sync / stalled';
    default: return 'all connections';
  }
}

function disruptionBadge(status: string) {
  if (status === 'warning') return { label: 'PARTIAL', className: 'badge-warning' };
  if (status === 'no_sync') return { label: 'STALLED', className: 'badge-stalled' };
  return { label: 'OUTAGE', className: 'badge-critical' };
}

function csvEscape(val: unknown): string {
  return `"${String(val ?? '').replace(/"/g, '""')}"`;
}

export default function HealthMonitor({ onOpenHelp }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('client-history');
  const [expandedHrmsCode, setExpandedHrmsCode] = useState<string | null>(null);
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

  // Connection status filter (metric cards act as filter tabs)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [disruptionFilter, setDisruptionFilter] = useState<DisruptionFilter>('all');

  // Connection Alert Filter Threshold (Days)
  const [alertDaysFilter, setAlertDaysFilter] = useState<number>(3);

  // Global HRMS Dashboard Data
  const [globalStatus, setGlobalStatus] = useState<any>(null);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [pollingGlobal, setPollingGlobal] = useState(false);

  const toggleStatusFilter = (filter: StatusFilter) => {
    setStatusFilter(prev => (prev === filter ? 'all' : filter));
  };

  const toggleDisruptionFilter = (filter: DisruptionFilter) => {
    setDisruptionFilter(prev => (prev === filter ? 'all' : filter));
  };

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
    setStatusFilter('all');
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

  const downloadDisruptionsCSV = () => {
    if (!globalStatus?.alerts?.length) return;
    const win = globalStatus.disruptionWindow || { from: '', to: '', days: 7 };
    const headers = [
      'Client',
      'Corporate',
      'Connection ID',
      'HRMS Code',
      'HRMS Provider',
      'Disruption Type (7d)',
      'Success Rate % (7d)',
      'Total Attempts (7d)',
      'Successful (7d)',
      'Failed (7d)',
      'Last Failure Reason',
      'Partial Sync Note',
      'Success Rate % (30d)',
      'Total Attempts (30d)',
      'Failed (30d)',
      'Employees Latest (30d)',
    ];
    const rows = globalStatus.alerts.map((a: any) => [
      a.clientName,
      a.orgName,
      a.connectionId,
      a.hrmsCode,
      a.hrmsDisplay || a.hrmsName,
      a.disruptionLabel || a.status,
      a.successRate,
      a.totalAttempts,
      a.successAttempts,
      a.failedAttempts,
      a.lastFailureReason || '',
      a.partialSyncNote || '',
      a.metrics30d?.successRate ?? '',
      a.metrics30d?.totalSyncs ?? '',
      a.metrics30d?.failedSyncs ?? '',
      a.metrics30d?.employeesLatest ?? '',
    ]);
    const meta = [
      ['Report', 'Continuous Sync Disruptions'],
      ['Window from', win.from],
      ['Window to', win.to],
      ['Window days', win.days],
      ['Total disruptions', globalStatus.alerts.length],
      ['Generated at', new Date().toISOString()],
      [''],
    ];
    const csv = [
      ...meta.map(r => r.map(csvEscape).join(',')),
      headers.map(csvEscape).join(','),
      ...rows.map((r: unknown[]) => r.map(csvEscape).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sync_disruptions_${win.days || 7}d_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadClientCSV = () => {
    if (!historyData || !historyData.connections.length) return;
    const clientName = historyData.clientName || credentials.find(c => c.id === selectedCredId)?.clientName || 'client';
    const s = historyData.summary;
    const generatedAt = new Date().toISOString();

    const metaRows = [
      ['Report', 'Health Monitor — Client Sync History'],
      ['Client', clientName],
      ['Date range from', historyData.fromDate || fromDate],
      ['Date range to', historyData.toDate || toDate],
      ['Generated at (UTC)', generatedAt],
      [''],
    ];

    const sumRows = [
      ['--- SUMMARY (must reconcile) ---', ''],
      ['Total active connections', s.totalConnections],
      ['Healthy (all attempts succeeded)', s.healthy],
      ['Warning (mixed success/failure)', s.warning],
      ['Failed (attempts, zero successes)', s.failed],
      ['No sync (zero attempts in range)', s.noSync ?? 0],
      ['Sum of status buckets', s.statusSum ?? (s.healthy + s.warning + s.failed + (s.noSync || 0))],
      ['Reconciliation check', s.reconciled ? 'PASS' : 'FAIL — re-fetch report'],
      ['Total sync attempts (all connections)', s.totalSyncAttempts ?? ''],
      ['Total successful attempts', s.totalSuccessfulSyncs ?? ''],
      ['Total failed attempts', s.totalFailedSyncs ?? ''],
      [''],
    ];

    const detailHeaders = [
      'Corporate Name',
      'Connection ID',
      'HRMS Code',
      'HRMS Provider',
      'Status',
      'Success Rate (%)',
      'Success Rate Verified',
      'Total Syncs',
      'Successful Syncs',
      'Failed Syncs',
      'Other Status Syncs',
      'Sync Count Check',
      'Avg Latency (sec)',
      'Employees Found (sum)',
      'Employees Created (sum)',
      'Employees Updated (sum)',
      'Last Sync Time',
      'Last Sync Status',
      'Failure Reasons',
    ];

    const detailRows = historyData.connections.map((c: any) => {
      const verified =
        c.totalSyncs > 0 ? Math.round((c.successSyncs / c.totalSyncs) * 100) : 0;
      const countCheck = c.successSyncs + c.failedSyncs + (c.otherSyncs || 0);
      return [
        c.orgName,
        c.id,
        c.hrmsCode || '',
        c.hrmsName,
        c.overallStatus,
        c.successRate,
        verified,
        c.totalSyncs,
        c.successSyncs,
        c.failedSyncs,
        c.otherSyncs || 0,
        countCheck === c.totalSyncs ? 'OK' : 'MISMATCH',
        c.metrics.avgDurationSeconds,
        c.metrics.totalEmployeesFound,
        c.metrics.totalEmployeesCreated,
        c.metrics.totalEmployeesUpdated,
        c.lastSyncTime || '',
        c.lastSyncStatus || '',
        c.failureReasons.join(' | ') || '',
      ];
    });

    const csvLines = [
      ...metaRows.map(r => r.map(csvEscape).join(',')),
      ...sumRows.map(r => r.map(csvEscape).join(',')),
      detailHeaders.map(csvEscape).join(','),
      ...detailRows.map((r: unknown[]) => r.map(csvEscape).join(',')),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_health_report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compute connections matching alert filter (all non-healthy in the selected window)
  const alertingConnections = useMemo(() => {
    if (!historyData) return [];
    const nonHealthy = historyData.connections.filter((c: any) => c.overallStatus !== 'healthy');
    const rangeEnd = historyData.toDate || toDate;
    const rangeStart = historyData.fromDate || fromDate;
    const rangeDays = Math.ceil(
      (new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86400000
    ) + 1;

    if (alertDaysFilter >= rangeDays) return nonHealthy;

    const limitDate = new Date(rangeEnd);
    limitDate.setDate(limitDate.getDate() - alertDaysFilter);
    let limitStr = limitDate.toISOString().split('T')[0];
    if (limitStr < rangeStart) limitStr = rangeStart;

    return nonHealthy.filter((c: any) => {
      const recentDays = c.dailyStatus.filter(
        (day: any) => day.date >= limitStr && day.date <= rangeEnd
      );
      if (recentDays.length === 0) return false;
      if (c.overallStatus === 'no_sync') {
        return recentDays.every((d: any) => d.status === 'no_sync');
      }
      return recentDays.some((d: any) => d.status === 'failed' || d.status === 'success');
    });
  }, [historyData, alertDaysFilter, fromDate, toDate]);

  const filteredConnections = useMemo(() => {
    if (!historyData) return [];
    if (statusFilter === 'all') return historyData.connections;
    return historyData.connections.filter((c: any) => c.overallStatus === statusFilter);
  }, [historyData, statusFilter]);

  const filteredAlerts = useMemo(() => {
    if (!globalStatus?.alerts) return [];
    if (disruptionFilter === 'all') return globalStatus.alerts;
    return globalStatus.alerts.filter((a: any) => a.status === disruptionFilter);
  }, [globalStatus?.alerts, disruptionFilter]);

  return (
    <div className="animate-fade-in health-monitor-wrapper">
      <div className="view-header">
        <div>
          <h2 className="results-title">Operational Health Monitor</h2>
          <p className="subtitle page-subtitle">
            CSM Enterprise intelligence portal for vendor sync success rates and HRMS network status.
            HRMS is mapped from each connection&apos;s <code>hrms_code</code> field.
          </p>
          {onOpenHelp && (
            <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={onOpenHelp}>
              Read metrics guide
            </button>
          )}
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
              <div style={{ marginTop: '1rem' }}>
                <MinorTaskTimer active label="Loading client sync history" />
              </div>
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
              {historyData.meta?.syncLogsMayBeTruncated && (
                <div className="toast-msg" style={{ background: 'rgba(217,119,6,0.08)', borderColor: 'rgba(217,119,6,0.25)', color: '#92400e' }}>
                  Sync log volume exceeded the fetch limit ({historyData.meta.syncLogCount?.toLocaleString()} logs loaded).
                  Health status may be incomplete for high-volume clients — narrow the date range or contact engineering.
                </div>
              )}
              {historyData.summary && historyData.summary.reconciled === false && (
                <div className="toast-msg" style={{ background: 'rgba(225,29,72,0.08)', borderColor: 'rgba(225,29,72,0.25)', color: '#9f1239' }}>
                  Summary counts do not reconcile with active connections. Re-fetch the report or see Help guide.
                </div>
              )}
              <div className="metrics-grid metrics-grid-five">
                <button
                  type="button"
                  className={`metric-card filterable${statusFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setStatusFilter('all')}
                >
                  <div className="metric-header">
                    <span className="metric-title">Active Connections</span>
                    <span className="metric-icon">🔗</span>
                  </div>
                  <div className="metric-value">{historyData.summary.totalConnections}</div>
                  <div className="metric-footer">Click to show all corporates</div>
                </button>

                <button
                  type="button"
                  className={`metric-card filterable healthy${statusFilter === 'healthy' ? ' active' : ''}`}
                  onClick={() => toggleStatusFilter('healthy')}
                >
                  <div className="metric-header">
                    <span className="metric-title">Healthy Syncs</span>
                    <span className="metric-icon green">✓</span>
                  </div>
                  <div className="metric-value">{historyData.summary.healthy}</div>
                  <div className="metric-footer">100% success in period</div>
                </button>

                <button
                  type="button"
                  className={`metric-card filterable warning${statusFilter === 'warning' ? ' active' : ''}`}
                  onClick={() => toggleStatusFilter('warning')}
                >
                  <div className="metric-header">
                    <span className="metric-title">Partial Failures</span>
                    <span className="metric-icon orange">⚠️</span>
                  </div>
                  <div className="metric-value">{historyData.summary.warning}</div>
                  <div className="metric-footer">Mixed success and failure</div>
                </button>

                <button
                  type="button"
                  className={`metric-card filterable critical${statusFilter === 'failed' ? ' active' : ''}`}
                  onClick={() => toggleStatusFilter('failed')}
                >
                  <div className="metric-header">
                    <span className="metric-title">Critical Failures</span>
                    <span className="metric-icon red">✗</span>
                  </div>
                  <div className="metric-value">{historyData.summary.failed}</div>
                  <div className="metric-footer">Attempts with zero successes</div>
                </button>

                <button
                  type="button"
                  className={`metric-card filterable stalled${statusFilter === 'no_sync' ? ' active' : ''}`}
                  onClick={() => toggleStatusFilter('no_sync')}
                >
                  <div className="metric-header">
                    <span className="metric-title">No Sync / Stalled</span>
                    <span className="metric-icon">⏸</span>
                  </div>
                  <div className="metric-value">{historyData.summary.noSync ?? 0}</div>
                  <div className="metric-footer">Zero attempts in date range</div>
                </button>
              </div>

              <p className="reconciliation-line">
                <strong>{historyData.summary.totalConnections}</strong> active ={' '}
                <strong>{historyData.summary.healthy}</strong> healthy +{' '}
                <strong>{historyData.summary.warning}</strong> partial +{' '}
                <strong>{historyData.summary.failed}</strong> critical +{' '}
                <strong>{historyData.summary.noSync ?? 0}</strong> no sync
                {historyData.summary.reconciled === false && (
                  <span className="reconciliation-warn"> · counts do not reconcile</span>
                )}
              </p>

              {/* CSM Alerts & Escalation Center */}
              <div className="alert-center-card">
                <div className="alert-center-header">
                  <div className="alert-header-row">
                    <span className="alert-icon-pulse">🚨</span>
                    <div>
                      <h3 className="state-title" style={{ fontSize: '1rem' }}>CSM Outage Escalation Center</h3>
                      <p className="state-muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Non-healthy connections within the selected report window (last N days relative to report end date).
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
                      {alertingConnections.map((c: any) => {
                        const badge = disruptionBadge(c.overallStatus);
                        return (
                        <div key={c.id} className="alerting-item-card">
                          <div className="alerting-item-top">
                            <span className="alerting-corp-name">{c.orgName}</span>
                            <span className={badge.className}>{badge.label}</span>
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
                        );
                      })}
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
                <h3 className="section-title">
                  Mapped corporates
                  {statusFilter !== 'all' && (
                    <span className="filter-chip"> · {filteredConnections.length} {statusFilterLabel(statusFilter)}</span>
                  )}
                </h3>
                {statusFilter !== 'all' && (
                  <button type="button" className="btn-secondary" onClick={() => setStatusFilter('all')}>
                    Clear filter
                  </button>
                )}
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
                    {filteredConnections.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty-filter-row">
                          No connections match this status filter.
                        </td>
                      </tr>
                    ) : filteredConnections.map((c: any) => (
                      <tr key={c.id} className="health-row">
                        <td>
                          <div className="corp-name-cell">{c.orgName}</div>
                          <div className="connection-id-cell">{c.id}</div>
                        </td>
                        <td>
                          <span className="hrms-badge" title={c.hrmsCode ? `hrms_code: ${c.hrmsCode}` : undefined}>
                            {c.hrmsDisplay || c.hrmsName}
                          </span>
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
                          {filteredConnections.slice(0, 5).map((c: any) => (
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
                          {historyData.connections.filter((c: any) =>
                            statusFilter === 'all' ? c.failureReasons.length > 0 : c.overallStatus === statusFilter && c.failureReasons.length > 0
                          ).slice(0, 4).map((c: any) => (
                        <div key={c.id} className="root-cause-item">
                          <div className="root-cause-header">
                            <span className="root-cause-corp">{c.orgName}</span>
                            <span className="root-cause-hrms">{c.hrmsName}</span>
                          </div>
                          <p className="root-cause-reason">{c.failureReasons[0]}</p>
                        </div>
                      ))}
                      {historyData.connections.filter((c: any) =>
                        statusFilter === 'all' ? c.failureReasons.length > 0 : c.overallStatus === statusFilter && c.failureReasons.length > 0
                      ).length === 0 && (
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
            <TaskProgressBanner
              running={!!globalStatus?.running}
              taskName="Global network health scan"
              progress={globalStatus?.progress}
              total={globalStatus?.total}
              currentStep={globalStatus?.currentClient}
              startedAt={globalStatus?.startedAt}
              elapsedMs={globalStatus?.elapsedMs}
              estimatedRemainingMs={globalStatus?.estimatedRemainingMs}
              percentComplete={globalStatus?.percentComplete}
              className="progress-section"
            />
          </div>

          {/* Global Outage Alerts */}
          {globalStatus?.alerts && globalStatus.alerts.length > 0 && (
            <div className="disruptions-panel panel card-glass section-block">
              <div className="disruptions-panel-header">
                <div>
                  <h3 className="section-title">Continuous Sync Disruptions (Last 7 Days) - {globalStatus.alerts.length} Connections</h3>
                  <p className="state-muted" style={{ marginTop: '0.35rem', fontSize: '0.75rem' }}>
                    Includes full failures, partial syncs (mixed success/failure), and connections with no sync attempts.
                    Export all {globalStatus.alerts.length} rows for CSM or engineering follow-up.
                  </p>
                </div>
                <button type="button" className="btn-primary" onClick={downloadDisruptionsCSV}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  Download Disruptions Report
                </button>
              </div>
              <div className="disruptions-summary-chips">
                <button
                  type="button"
                  className={`badge chip-filter${disruptionFilter === 'failed' ? ' active' : ''}`}
                  style={{ background: 'rgba(225, 29, 72, 0.1)', borderColor: 'rgba(225, 29, 72, 0.2)', color: 'var(--p0-rose)' }}
                  onClick={() => toggleDisruptionFilter('failed')}
                >
                  {globalStatus.alerts.filter((a: any) => a.status === 'failed').length} Failed
                </button>
                <button
                  type="button"
                  className={`badge chip-filter${disruptionFilter === 'warning' ? ' active' : ''}`}
                  style={{ borderColor: 'rgba(217,119,6,0.3)', color: 'var(--warning-amber)' }}
                  onClick={() => toggleDisruptionFilter('warning')}
                >
                  {globalStatus.alerts.filter((a: any) => a.status === 'warning').length} Partial
                </button>
                <button
                  type="button"
                  className={`badge chip-filter${disruptionFilter === 'no_sync' ? ' active' : ''}`}
                  style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
                  onClick={() => toggleDisruptionFilter('no_sync')}
                >
                  {globalStatus.alerts.filter((a: any) => a.status === 'no_sync').length} No Sync
                </button>
                {disruptionFilter !== 'all' && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setDisruptionFilter('all')}>
                    Show all
                  </button>
                )}
              </div>
              <div className="table-wrapper disruptions-table-wrap">
                <table className="table compact-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Corporate</th>
                      <th>HRMS</th>
                      <th>Type</th>
                      <th>7d Rate</th>
                      <th>7d Attempts</th>
                      <th>Last Failure Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-filter-row">No disruptions match this filter.</td>
                      </tr>
                    ) : filteredAlerts.slice(0, 100).map((alert: any, idx: number) => (
                      <tr key={idx}>
                        <td>{alert.clientName}</td>
                        <td>{alert.orgName}</td>
                        <td><span className="hrms-badge">{alert.hrmsDisplay || alert.hrmsName}</span></td>
                        <td>
                          <span className={`status-badge-premium ${alert.status === 'warning' ? 'warning' : alert.status === 'no_sync' ? 'no_sync' : 'failed'}`}>
                            {alert.disruptionLabel || alert.status}
                          </span>
                        </td>
                        <td>{alert.successRate}%</td>
                        <td>
                          {alert.successAttempts}/{alert.totalAttempts}
                        </td>
                        <td className="fail-reason-cell">{alert.lastFailureReason || alert.partialSyncNote || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredAlerts.length > 100 && (
                <p className="state-muted" style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
                  Showing first 100 of {filteredAlerts.length}. Download the CSV for the full list.
                </p>
              )}
              {disruptionFilter !== 'all' && filteredAlerts.length <= 100 && filteredAlerts.length > 0 && (
                <p className="state-muted" style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
                  Showing {filteredAlerts.length} of {globalStatus.alerts.length} disruptions.
                </p>
              )}
            </div>
          )}

          {/* HRMS Grid */}
          <h3 className="section-title section-block">Aggregated HRMS registry</h3>
          
          {globalStatus?.hrmsList && globalStatus.hrmsList.length > 0 ? (
            <div className="hrms-cards-grid">
              {globalStatus.hrmsList.map((hrms: any, idx: number) => (
                <div key={idx} className={`hrms-card card-glass ${hrms.status} ${expandedHrmsCode === hrms.hrmsCode ? 'expanded' : ''}`}>
                  <div className="hrms-card-top">
                    <div>
                      <h4 className="hrms-card-name">{hrms.hrmsDisplay || hrms.hrmsName}</h4>
                      <span className="hrms-card-clients-count">
                        {hrms.hrmsCode && hrms.hrmsCode !== 'unknown' ? `code: ${hrms.hrmsCode} · ` : ''}
                        {hrms.clients.length} clients · {hrms.healthScore}% healthy (7d)
                      </span>
                      <p className="hrms-status-explanation">{hrms.statusExplanation}</p>
                    </div>
                    <span className={`hrms-status-badge ${hrms.status}`}>
                      {hrms.status === 'outage' && 'OUTAGE'}
                      {hrms.status === 'warning' && 'DEGRADED'}
                      {hrms.status === 'healthy' && 'HEALTHY'}
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

                  {hrms.failureReasonSummary?.length > 0 && (
                    <div className="hrms-failure-summary-box">
                      <h5 className="state-title" style={{ fontSize: '0.75rem' }}>Top failure reasons (7d)</h5>
                      <ul className="failure-reason-list">
                        {hrms.failureReasonSummary.slice(0, 5).map((fr: any, i: number) => (
                          <li key={i}><span>{fr.reason}</span> <strong>{fr.count}</strong></li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-secondary hrms-expand-btn"
                    onClick={() => setExpandedHrmsCode(expandedHrmsCode === hrms.hrmsCode ? null : hrms.hrmsCode)}
                  >
                    {expandedHrmsCode === hrms.hrmsCode ? 'Hide' : 'View'} 30-day vendor breakdown & detailed analysis
                  </button>

                  {expandedHrmsCode === hrms.hrmsCode && (
                    <div className="vendor-insights-panel">
                      <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-color)', marginBottom: '0.75rem' }}>
                        Detailed Analysis & 30-Day Vendor-Wise Insights
                      </h4>
                      
                      {hrms.vendorInsights30d && hrms.vendorInsights30d.length > 0 ? (
                        <>
                          {/* Additional Analytics Panel */}
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(4, 1fr)', 
                            gap: '0.75rem', 
                            marginBottom: '1rem',
                            padding: '0.75rem', 
                            background: 'var(--surface-muted)', 
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)'
                          }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent-color)' }}>{hrms.totalConnections}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Connections</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--success-emerald)' }}>{hrms.healthyConnections}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Healthy</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--warning-amber)' }}>{hrms.warningConnections + hrms.noSyncConnections}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Warning/No Sync</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--p0-rose)' }}>{hrms.failedConnections}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Failed</div>
                            </div>
                          </div>

                          {/* Vendor Insights Table */}
                          <div className="table-wrapper compact-table">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Client (Vendor)</th>
                                  <th>Corporate</th>
                                  <th>7d Status</th>
                                  <th>30d Success Rate</th>
                                  <th>30d Syncs</th>
                                  <th>30d Success</th>
                                  <th>30d Failed</th>
                                  <th>Latest Employee Count</th>
                                  <th>Last Failure Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {hrms.vendorInsights30d.flatMap((v: any) =>
                                  v.connections.map((c: any, ci: number) => (
                                    <tr key={v.clientName + ci}>
                                      {ci === 0 && (
                                        <td rowSpan={v.connections.length} style={{ verticalAlign: 'top', fontWeight: 600 }}>
                                          {v.clientName}
                                        </td>
                                      )}
                                      <td>{c.orgName}</td>
                                      <td><span className={`status-badge-premium ${c.status7d}`}>{c.status7d}</span></td>
                                      <td style={{ fontWeight: 700, color: c.successRate30d >= 90 ? 'var(--success-emerald)' : c.successRate30d >=70 ? 'var(--warning-amber)' : 'var(--p0-rose)' }}>{c.successRate30d}%</td>
                                      <td>{c.totalSyncs30d}</td>
                                      <td style={{ color: 'var(--success-emerald)' }}>{c.success30d}</td>
                                      <td style={{ color: 'var(--p0-rose)' }}>{c.failed30d}</td>
                                      <td>{c.employeesLatest ?? '—'}</td>
                                      <td className="fail-reason-cell">{c.lastFailureReason || '—'}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <div style={{ 
                          textAlign: 'center', 
                          padding: '2rem', 
                          background: 'var(--surface-muted)', 
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem'
                        }}>
                          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                            Vendor insights data not available
                          </p>
                          <p>
                            Click "Run Global Network Scan" above to refresh all HRMS data and generate the complete 30-day breakdown!
                          </p>
                        </div>
                      )}
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
