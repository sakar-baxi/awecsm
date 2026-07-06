import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { TaskProgressBanner } from './TaskProgress';

type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const DAY_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
];

function BarChart({ series, title }: { series: { label: string; success: number; failed: number }[]; title?: string }) {
  const slice = series.slice(-30);
  const max = Math.max(1, ...slice.map(s => s.success + s.failed));

  return (
    <div>
      {title && <h5 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h5>}
      <div className="bar-chart">
        {slice.map((s, i) => {
          const total = s.success + s.failed;
          const h = Math.round((total / max) * 100);
          const successPct = total > 0 ? (s.success / total) * 100 : 0;
          return (
            <div key={i} className="bar-chart-col" title={`${s.label}: ${s.success} ok, ${s.failed} failed`}>
              <div className="bar-chart-stack" style={{ height: `${Math.max(h, total ? 4 : 0)}%` }}>
                {s.failed > 0 && <div className="seg-failed" style={{ height: `${100 - successPct}%` }} />}
                {s.success > 0 && <div className="seg-success" style={{ height: `${successPct}%` }} />}
              </div>
              <span className="bar-chart-label">{s.label.replace(/^\d{4}-/, '')}</span>
            </div>
          );
        })}
      </div>
      <div className="chart-legend">
        <span className="legend-success">Successful syncs</span>
        <span className="legend-failed">Failed syncs</span>
      </div>
    </div>
  );
}

function SimpleLineChart({ series, title }: { series: { label: string; value: number }[]; title?: string }) {
  const slice = series.slice(-24);
  const max = Math.max(1, ...slice.map(s => s.value));
  
  return (
    <div>
      {title && <h5 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h5>}
      <div className="bar-chart">
        {slice.map((s, i) => {
          const h = Math.round((s.value / max) * 100);
          return (
            <div key={i} className="bar-chart-col" title={`${s.label}: ${s.value}`}>
              <div className="bar-chart-stack" style={{ height: `${Math.max(h, s.value ? 4 : 0)}%`, background: 'linear-gradient(180deg, var(--accent-color), #5b9dff)' }} />
              <span className="bar-chart-label">{s.label.replace(/^\d{4}-/, '')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ActiveTab = 'overview' | 'product-manager' | 'customer-success';

export default function SyncMetrics() {
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .fetchSyncMetrics(days, granularity)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days, granularity]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => {
      api.fetchSyncMetrics(days, granularity).then(setData);
    }, 2500);
    return () => clearInterval(t);
  }, [data?.running, days, granularity]);

  const refresh = () => {
    setLoading(true);
    api.refreshSyncMetrics(days, granularity).then(() => load());
  };

  const s = data?.summary;
  const employeeSeries = data?.employeeTimeSeries || data?.timeSeries?.map((item: any) => ({
    label: item.label,
    value: item.total
  })) || [];

  return (
    <div className="animate-fade-in sync-metrics-page">
      <div className="view-header">
        <div>
          <h2 className="results-title">Sync Metrics Dashboard</h2>
          <p className="subtitle page-subtitle">
            Comprehensive platform-wide analytics for sync performance, employee throughput, and failure trends.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={refresh} disabled={data?.running}>
          {data?.running ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="spinner" />
              Computing Metrics…
            </span>
          ) : (
            'Refresh Metrics'
          )}
        </button>
      </div>

      <div className="form-container" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div className="input-group">
            <label className="input-label">Time Period</label>
            <select className="token-input compact" value={days} onChange={e => setDays(Number(e.target.value))}>
              {DAY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Granularity</label>
            <div className="granularity-tabs">
              {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as Granularity[]).map(g => (
                <button
                  key={g}
                  type="button"
                  className={granularity === g ? 'active' : ''}
                  onClick={() => setGranularity(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Perspective Tabs */}
      <div className="tab-buttons" style={{ marginBottom: 'var(--space-4)', width: 'fit-content' }}>
        <button 
          className={`btn-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={`btn-tab ${activeTab === 'product-manager' ? 'active' : ''}`}
          onClick={() => setActiveTab('product-manager')}
        >
          Product Manager
        </button>
        <button 
          className={`btn-tab ${activeTab === 'customer-success' ? 'active' : ''}`}
          onClick={() => setActiveTab('customer-success')}
        >
          Customer Success
        </button>
      </div>

      <TaskProgressBanner
        running={!!data?.running}
        taskName="Sync metrics computation"
        progress={data?.progress}
        total={data?.total}
        currentStep={data?.currentClient}
        startedAt={data?.startedAt}
        elapsedMs={data?.elapsedMs}
        estimatedRemainingMs={data?.estimatedRemainingMs}
        percentComplete={data?.percentComplete}
        unitLabel="vendor clients"
        className="form-container"
      />

      {loading && !s ? (
        <div className="empty-state">
          <div className="spinner large" style={{ margin: '0 auto 1rem' }} />
          Loading comprehensive sync metrics…
        </div>
      ) : s ? (
        <>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Main Metrics Grid */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-header">
                    <span>Number of Connections</span>
                    <span style={{ fontSize: '1rem' }}>🔗</span>
                  </div>
                  <div className="metric-value">{s.totalConnections.toLocaleString()}</div>
                  <div className="metric-footer">Active connections across all vendor credentials</div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-header">
                    <span>Employees Synced Till Date</span>
                    <span style={{ fontSize: '1rem' }}>👥</span>
                  </div>
                  <div className="metric-value">{s.employeesSyncedLatest.toLocaleString()}</div>
                  <div className="metric-footer">
                    {s.connectionsWithEmployeeDelta > 0 ? (
                      <>
                        Period start: {s.employeesEarliestInPeriod.toLocaleString()} → now ·{' '}
                        <span style={{ fontWeight: 700, color: s.employeeNetChangeInPeriod >= 0 ? 'var(--success-emerald)' : 'var(--p0-rose)' }}>
                          {s.employeeNetChangeInPeriod >= 0 ? '+' : ''}{s.employeeNetChangeInPeriod.toLocaleString()}
                        </span>
                      </>
                    ) : (
                      <>Across {s.connectionsWithEmployeeData.toLocaleString()} connections with sync data</>
                    )}
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-header">
                    <span>Total Syncs Ran</span>
                    <span style={{ fontSize: '1rem' }}>📊</span>
                  </div>
                  <div className="metric-value">{s.totalSyncs.toLocaleString()}</div>
                  <div className="metric-footer">
                    <span style={{ color: 'var(--success-emerald)', fontWeight: 600 }}>{s.successSyncs.toLocaleString()} successful</span> ·{' '}
                    <span style={{ color: s.failedSyncs > 0 ? 'var(--p0-rose)' : 'var(--text-muted)', fontWeight: s.failedSyncs > 0 ? 600 : 400 }}>
                      {s.failedSyncs.toLocaleString()} failed
                    </span>
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-header">
                    <span>Overall Success Rate</span>
                    <span style={{ fontSize: '1rem' }}>✅</span>
                  </div>
                  <div className="metric-value" style={{ color: s.successRate >= 90 ? 'var(--success-emerald)' : s.successRate >= 70 ? 'var(--warning-amber)' : 'var(--p0-rose)' }}>
                    {s.successRate}%
                  </div>
                  <div className="metric-footer">
                    Created: {s.employeesCreatedInPeriod.toLocaleString()} · Updated: {s.employeesUpdatedInPeriod.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Charts Grid */}
              <div className="charts-grid">
                <div className="chart-panel panel card-glass">
                  <h4>Sync Attempts Over Time</h4>
                  <BarChart series={data.timeSeries || []} />
                </div>
                
                <div className="chart-panel panel card-glass">
                  <h4>Employee Count Trend</h4>
                  <SimpleLineChart series={employeeSeries} />
                </div>
              </div>

              <div className="charts-grid">
                <div className="chart-panel panel card-glass">
                  <h4>Top Failure Reasons</h4>
                  {(data.topFailureReasons || []).length > 0 ? (
                    <div className="table-wrapper compact-table">
                      <table className="table">
                        <thead>
                          <tr><th style={{ width: '70%' }}>Failure Reason</th><th style={{ width: '30%' }}>Count</th></tr>
                        </thead>
                        <tbody>
                          {data.topFailureReasons.slice(0, 10).map((r: any, i: number) => (
                            <tr key={i}>
                              <td style={{ fontSize: '0.75rem', wordBreak: 'break-word' }}>{r.reason}</td>
                              <td><span className="count-badge">{r.count}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-diagnostics" style={{ textAlign: 'center', padding: '2rem', color: 'var(--success-emerald)', fontSize: '0.85rem', fontWeight: 600 }}>
                      🟢 No failure records in this selected period! Perfect sync health.
                    </div>
                  )}
                </div>

                <div className="chart-panel panel card-glass">
                  <h4>Success Rate Distribution</h4>
                  <div style={{ padding: '1rem 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span style={{ color: 'var(--success-emerald)', fontWeight: 600 }}>Successful</span>
                          <span style={{ fontWeight: 700 }}>{s.successRate}%</span>
                        </div>
                        <div style={{ background: 'var(--surface-muted)', height: '12px', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{ background: 'var(--success-emerald)', height: '100%', width: `${s.successRate}%`, borderRadius: '9999px', transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span style={{ color: 'var(--p0-rose)', fontWeight: 600 }}>Failed</span>
                          <span style={{ fontWeight: 700 }}>{100 - s.successRate}%</span>
                        </div>
                        <div style={{ background: 'var(--surface-muted)', height: '12px', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{ background: 'var(--p0-rose)', height: '100%', width: `${100 - s.successRate}%`, borderRadius: '9999px', transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Product Manager Tab */}
          {activeTab === 'product-manager' && (
            <>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-header"><span>Total HRMS Systems</span></div>
                  <div className="metric-value" style={{ color: 'var(--accent-color)', fontSize: '1.25rem' }}>
                    {(data?.hrmsPerformance || []).length}
                  </div>
                  <div className="metric-footer">Unique HRMS providers integrated</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Average Success Rate</span></div>
                  <div className="metric-value" style={{ color: 'var(--success-emerald)', fontSize: '1.25rem' }}>
                    {(data?.hrmsPerformance || []).length > 0 ? (
                      Math.round((data?.hrmsPerformance || []).reduce((acc: number, h: any) => acc + (h.successRate || 0), 0) / (data?.hrmsPerformance || []).length)
                    ) : 0}%
                  </div>
                  <div className="metric-footer">Across all HRMS systems</div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Total Vendors</span></div>
                  <div className="metric-value" style={{ color: 'var(--p1-purple)', fontSize: '1.25rem' }}>
                    {(data?.clientHealth || []).length}
                  </div>
                  <div className="metric-footer">Active vendor clients</div>
                </div>
              </div>

              {(data?.hrmsPerformance && data.hrmsPerformance.length > 0) ? (
                <div className="chart-panel panel card-glass section-block">
                  <h4>HRMS System Performance</h4>
                  <div className="table-wrapper compact-table">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>HRMS Provider</th>
                          <th>Connections</th>
                          <th>Total Syncs</th>
                          <th>Success Rate</th>
                          <th>Successful</th>
                          <th>Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.hrmsPerformance || []).slice(0, 15).map((hrms: any, idx: number) => (
                          <tr key={idx}>
                            <td>
                              <span className="hrms-badge">{hrms.hrmsDisplay || hrms.hrmsName}</span>
                            </td>
                            <td>{(hrms.totalConnections || 0).toLocaleString()}</td>
                            <td>{(hrms.totalSyncs || 0).toLocaleString()}</td>
                            <td>
                              <span style={{ 
                                fontWeight: 700, 
                                color: (hrms.successRate || 0) >= 90 ? 'var(--success-emerald)' : (hrms.successRate || 0) >= 70 ? 'var(--warning-amber)' : 'var(--p0-rose)'
                              }}>
                                {hrms.successRate || 0}%
                              </span>
                            </td>
                            <td style={{ color: 'var(--success-emerald)' }}>{(hrms.successSyncs || 0).toLocaleString()}</td>
                            <td style={{ color: 'var(--p0-rose)' }}>{(hrms.failedSyncs || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="chart-panel panel card-glass section-block">
                  <div className="empty-state" style={{ padding: '2rem', margin: 0 }}>
                    <svg className="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18"/>
                      <path d="M7 16l4-8 4 5 5-9"/>
                    </svg>
                    <h3 className="state-title">HRMS Performance Data Not Yet Available</h3>
                    <p className="state-muted" style={{ marginTop: '0.5rem' }}>
                      Click "Refresh Metrics" above to run a full platform scan and generate HRMS performance data.
                    </p>
                  </div>
                </div>
              )}

              <div className="charts-grid">
                <div className="chart-panel panel card-glass">
                  <h4>Employee Growth Trend</h4>
                  <SimpleLineChart series={employeeSeries} />
                </div>
                <div className="chart-panel panel card-glass">
                  <h4>Sync Volume Trend</h4>
                  <BarChart series={data?.timeSeries || []} />
                </div>
              </div>
            </>
          )}

          {/* Customer Success Tab */}
          {activeTab === 'customer-success' && (
            <>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-header"><span>At-Risk Clients (Success Rate &lt; 70%)</span></div>
                  <div className="metric-value" style={{ color: 'var(--p0-rose)', fontSize: '1.25rem' }}>
                    {(data?.clientHealth || []).filter((c: any) => (c.successRate || 0) < 70).length}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Healthy Clients (Success Rate ≥ 90%)</span></div>
                  <div className="metric-value" style={{ color: 'var(--success-emerald)', fontSize: '1.25rem' }}>
                    {(data?.clientHealth || []).filter((c: any) => (c.successRate || 0) >= 90).length}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-header"><span>Clients Needing Attention (70-89%)</span></div>
                  <div className="metric-value" style={{ color: 'var(--warning-amber)', fontSize: '1.25rem' }}>
                    {(data?.clientHealth || []).filter((c: any) => (c.successRate || 0) >= 70 && (c.successRate || 0) < 90).length}
                  </div>
                </div>
              </div>

              {(data?.clientHealth && data.clientHealth.length > 0) ? (
                <div className="chart-panel panel card-glass section-block">
                  <h4>Client Health Overview</h4>
                  <div className="table-wrapper compact-table">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Client Name</th>
                          <th>Connections</th>
                          <th>Total Syncs</th>
                          <th>Success Rate</th>
                          <th>Successful</th>
                          <th>Failed</th>
                          <th>Employees Synced</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.clientHealth || []).map((client: any, idx: number) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600 }}>{client.clientName}</td>
                            <td>{(client.totalConnections || 0).toLocaleString()}</td>
                            <td>{(client.totalSyncs || 0).toLocaleString()}</td>
                            <td>
                              <span className={`status-badge-premium ${
                                (client.successRate || 0) >= 90 ? 'healthy' : 
                                (client.successRate || 0) >= 70 ? 'warning' : 'failed'
                              }`}>
                                {client.successRate || 0}%
                              </span>
                            </td>
                            <td style={{ color: 'var(--success-emerald)' }}>{(client.successSyncs || 0).toLocaleString()}</td>
                            <td style={{ color: 'var(--p0-rose)' }}>{(client.failedSyncs || 0).toLocaleString()}</td>
                            <td>{(client.employeesLatest || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="chart-panel panel card-glass section-block">
                  <div className="empty-state" style={{ padding: '2rem', margin: 0 }}>
                    <svg className="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18"/>
                      <path d="M7 16l4-8 4 5 5-9"/>
                    </svg>
                    <h3 className="state-title">Client Health Data Not Yet Available</h3>
                    <p className="state-muted" style={{ marginTop: '0.5rem' }}>
                      Click "Refresh Metrics" above to run a full platform scan and generate client health data.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {data.generatedAt && (
            <p className="state-muted" style={{ marginTop: 'var(--space-6)', fontSize: '0.75rem', textAlign: 'center' }}>
              Generated on {new Date(data.generatedAt).toLocaleString()} · Date range: {data.fromDate} to {data.toDate} · Granularity: {data.granularity}
            </p>
          )}
        </>
      ) : (
        <div className="empty-state">
          <svg className="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 16l4-8 4 5 5-9"/>
          </svg>
          <h3 className="state-title">No Sync Metrics Yet</h3>
          <p className="state-muted" style={{ marginTop: '0.5rem' }}>
            Click "Refresh Metrics" above to run a full platform sync scan and generate comprehensive analytics.
          </p>
        </div>
      )}
    </div>
  );
}
