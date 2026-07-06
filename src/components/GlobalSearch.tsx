import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { TaskProgressBanner, MinorTaskTimer } from './TaskProgress';

type SearchResult = {
  id: string;
  connectionId: string;
  orgId: string | null;
  orgName: string;
  clientId: string;
  clientName: string;
  hrmsCode: string;
  hrmsName: string;
  hrmsDisplay: string;
  applicationConnectionStatus: string | null;
  syncEnabled: boolean | null;
  lastSuccessfulSync: string | null;
  health7d: { overallStatus: string; successRate: number } | null;
  matchedEmployees?: { email: string | null; name: string | null }[];
};

type FilterOptions = {
  clients: { id: string; name: string }[];
  hrms: { code: string; name: string; display: string }[];
  applicationStatuses: string[];
  healthStatuses: string[];
};

type ConnectionDetail = {
  id: string;
  connectionId: string;
  orgName: string;
  clientName: string;
  vendor: { vendorOrgId: string | null; vendorOrgName: string | null };
  hrms: { code: string; name: string; display: string };
  identity: Record<string, unknown>;
  sync: Record<string, unknown>;
  dataSharing: { shared: string[]; notShared: string[]; sharedCount: number; notSharedCount: number };
  health7d: Record<string, unknown> | null;
  health30d: Record<string, unknown> | null;
  recentSyncLogs: Record<string, unknown>[];
  fields: { key: string; label: string; value: string }[];
  additionalFields: { key: string; label: string; value: string }[];
  topEmployees?: {
    email: string | null;
    name: string | null;
    fields: { key: string; label: string; value: string }[];
    raw: Record<string, unknown>;
  }[];
  raw: Record<string, unknown>;
  indexedAt: string;
};

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const cls = ['healthy', 'warning', 'failed', 'no_sync'].includes(status) ? status : 'no_sync';
  return <span className={`status-pill ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

function KvGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="search-kv-grid">
      {items.map(item => (
        <div key={item.label} className="search-kv">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function GlobalSearch({ onOpenCurlLibrary }: { onOpenCurlLibrary?: (prefill: {
  connectionId: string;
  clientId: string;
  clientName: string;
  orgName: string;
}) => void }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [hrmsCode, setHrmsCode] = useState('');
  const [healthStatus, setHealthStatus] = useState('');
  const [applicationStatus, setApplicationStatus] = useState('');
  const [syncEnabled, setSyncEnabled] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    clients: [],
    hrms: [],
    applicationStatuses: [],
    healthStatuses: [],
  });
  const [indexMeta, setIndexMeta] = useState<{
    lastIndexedAt?: string;
    connectionCount?: number;
    indexing?: boolean;
    storage?: string;
  }>({});
  const [taskStatus, setTaskStatus] = useState<{
    running?: boolean;
    progress?: number;
    total?: number;
    currentClient?: string;
    startedAt?: string | null;
    elapsedMs?: number | null;
    estimatedRemainingMs?: number | null;
    percentComplete?: number;
  }>({});
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [detail, setDetail] = useState<ConnectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;
  const [reindexing, setReindexing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const loadStatus = useCallback(() => {
    api.fetchSearchStatus().then(s => {
      setIndexMeta({
        lastIndexedAt: s.lastIndexedAt,
        connectionCount: s.connectionCount,
        indexing: s.running,
        storage: s.storage,
      });
      setTaskStatus({
        running: s.running,
        progress: s.progress,
        total: s.total,
        currentClient: s.currentClient,
        startedAt: s.startedAt,
        elapsedMs: s.elapsedMs,
        estimatedRemainingMs: s.estimatedRemainingMs,
        percentComplete: s.percentComplete,
      });
      if (s.filterOptions) setFilterOptions(s.filterOptions);
      setReindexing(s.running);
    }).catch(() => {});
  }, []);

  const runSearch = useCallback((append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    const nextOffset = append ? offset + PAGE_SIZE : 0;
    api
      .searchConnections({
        q: debouncedQuery,
        clientId,
        hrmsCode,
        healthStatus,
        applicationStatus,
        syncEnabled,
        limit: PAGE_SIZE,
        offset: append ? nextOffset : 0,
      })
      .then(data => {
        if (append) {
          setResults(prev => [...prev, ...(data.results || [])]);
          setOffset(nextOffset);
        } else {
          setResults(data.results || []);
          setOffset(0);
        }
        setTotal(data.total || 0);
        if (data.filterOptions) setFilterOptions(data.filterOptions);
        setIndexMeta(prev => ({
          ...prev,
          lastIndexedAt: data.lastIndexedAt,
          indexing: data.indexing,
        }));
        if (data.running) {
          setTaskStatus({
            running: data.running,
            progress: data.progress,
            total: data.total,
            currentClient: data.currentClient,
            startedAt: data.startedAt,
            elapsedMs: data.elapsedMs,
            estimatedRemainingMs: data.estimatedRemainingMs,
            percentComplete: data.percentComplete,
          });
        }
      })
      .catch(() => {
        if (!append) {
          setResults([]);
          setTotal(0);
        }
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  }, [debouncedQuery, clientId, hrmsCode, healthStatus, applicationStatus, syncEnabled, offset]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 8000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    runSearch(false);
  }, [debouncedQuery, clientId, hrmsCode, healthStatus, applicationStatus, syncEnabled]);

  const openDetail = (item: SearchResult) => {
    setSelected(item);
    setDetail(null);
    setShowRaw(false);
    setDetailLoading(true);
    api
      .fetchConnectionDetail(item.connectionId, item.clientId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  };

  const refreshDetail = () => {
    if (!selected) return;
    setDetailLoading(true);
    api
      .fetchConnectionDetail(selected.connectionId, selected.clientId, true)
      .then(setDetail)
      .finally(() => setDetailLoading(false));
  };

  const handleReindex = () => {
    setReindexing(true);
    api.triggerSearchReindex().then(() => {
      loadStatus();
      setTimeout(() => runSearch(false), 2000);
    });
  };

  const downloadCsv = async (type: 'latest' | 'history' | 'employees') => {
    const blob = await api.downloadSearchCsv(type);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      type === 'history'
        ? 'connections_sync_history.csv'
        : type === 'employees'
          ? 'connection_employees_history.csv'
          : 'connections_latest.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  };

  return (
    <div className="search-page animate-fade-in">
      <div className="search-hero">
        <h2>Global connection search</h2>
        <p>
          Search across all vendor credentials by connection ID, org ID, corporate name, HRMS, client, or employee email.
          Data is stored in CSV (latest snapshot + append-only history) and loaded into memory for instant search.
        </p>
        <div className="search-bar-row">
          <div className="search-input-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Connection ID, org ID, corporate name, HRMS…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleReindex} disabled={reindexing}>
            {reindexing ? 'Syncing…' : 'Fresh sync'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadCsv('latest')}>
            Download CSV
          </button>
        </div>
        <div className="search-index-meta">
          {indexMeta.connectionCount != null && (
            <span className="pill">{indexMeta.connectionCount.toLocaleString()} connections indexed</span>
          )}
          {indexMeta.storage && (
            <span className="pill">Storage: {indexMeta.storage.toUpperCase()} (in-memory cache)</span>
          )}
          {indexMeta.lastIndexedAt && (
            <span>Last indexed {new Date(indexMeta.lastIndexedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {taskStatus.running && (
        <TaskProgressBanner
          running
          taskName="Global search fresh sync"
          progress={taskStatus.progress}
          total={taskStatus.total}
          currentStep={taskStatus.currentClient}
          startedAt={taskStatus.startedAt}
          elapsedMs={taskStatus.elapsedMs}
          estimatedRemainingMs={taskStatus.estimatedRemainingMs}
          percentComplete={taskStatus.percentComplete}
          unitLabel="vendor clients"
        />
      )}

      <div className="search-filters">
        <label>
          Client / vendor
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {filterOptions.clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          HRMS
          <select value={hrmsCode} onChange={e => setHrmsCode(e.target.value)}>
            <option value="">All HRMS</option>
            {filterOptions.hrms.map(h => (
              <option key={h.code} value={h.code}>{h.display}</option>
            ))}
          </select>
        </label>
        <label>
          Health (7d)
          <select value={healthStatus} onChange={e => setHealthStatus(e.target.value)}>
            <option value="">Any</option>
            {filterOptions.healthStatuses.map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label>
          App status
          <select value={applicationStatus} onChange={e => setApplicationStatus(e.target.value)}>
            <option value="">Any</option>
            {filterOptions.applicationStatuses.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Sync enabled
          <select value={syncEnabled} onChange={e => setSyncEnabled(e.target.value)}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      <div className="search-layout">
        <div className="search-results-panel">
          <div className="search-results-header">
            {loading ? 'Searching…' : `${total} result${total === 1 ? '' : 's'}`}
          </div>
          <div className="search-results-list">
            {!loading && results.length === 0 && (
              <div className="search-detail-empty">
                {debouncedQuery || clientId || hrmsCode
                  ? 'No connections match your search. Try different terms or clear filters.'
                  : 'Enter a search term or use filters to browse connections.'}
              </div>
            )}
            {results.map(item => (
              <button
                key={item.id}
                type="button"
                className={`search-result-item${selected?.id === item.id ? ' active' : ''}`}
                onClick={() => openDetail(item)}
              >
                <div className="search-result-title">{item.orgName}</div>
                <div className="search-result-sub">
                  {item.clientName} · {item.hrmsDisplay}
                  <br />
                  Conn {item.connectionId}
                  {item.orgId ? ` · Org ${item.orgId}` : ''}
                </div>
                <div className="search-result-badges">
                  <StatusPill status={item.health7d?.overallStatus} />
                  {item.lastSuccessfulSync && (
                    <span className="search-tag">Last sync: {item.lastSuccessfulSync}</span>
                  )}
                  {item.matchedEmployees?.map(emp => (
                    <span key={`${emp.email}-${emp.name}`} className="search-tag shared">
                      Employee: {emp.name || emp.email}
                    </span>
                  ))}
                </div>
              </button>
            ))}
            {results.length < total && (
              <button
                type="button"
                className="btn btn-secondary search-load-more"
                onClick={() => runSearch(true)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${results.length} of ${total})`}
              </button>
            )}
          </div>
        </div>

        <div className="search-detail-panel">
          {!selected && (
            <div className="search-detail-empty">
              Select a connection from the results to view the full profile.
            </div>
          )}
          {selected && detailLoading && (
            <div className="search-detail-empty">
              <div className="spinner" style={{ margin: '0 auto 1rem' }} />
              Loading connection details…
              <div style={{ marginTop: '0.75rem' }}>
                <MinorTaskTimer active label="Fetching connection profile" />
              </div>
            </div>
          )}
          {selected && !detailLoading && detail && (
            <>
              <div className="search-detail-header">
                <h3>{detail.orgName}</h3>
                <div className="meta-line">
                  {detail.clientName}
                  {detail.vendor.vendorOrgName ? ` · Vendor: ${detail.vendor.vendorOrgName}` : ''}
                  {' · '}
                  {detail.hrms.display}
                </div>
                <div className="search-result-badges" style={{ marginTop: '0.5rem' }}>
                  <StatusPill status={detail.health7d?.overallStatus as string} />
                </div>
                <div className="search-detail-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={refreshDetail}>
                    Refresh from API
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadCsv('employees')}>
                    Employee CSV
                  </button>
                  {onOpenCurlLibrary && selected && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenCurlLibrary({
                        connectionId: selected.connectionId,
                        clientId: selected.clientId,
                        clientName: selected.clientName,
                        orgName: selected.orgName,
                      })}
                    >
                      Save cURL
                    </button>
                  )}
                </div>
              </div>

              <div className="search-detail-body">
                <section className="search-section">
                  <h4 className="search-section-title">Identity</h4>
                  <KvGrid
                    items={[
                      { label: 'Connection ID', value: detail.connectionId },
                      { label: 'Org ID', value: String(detail.identity.orgId ?? '—') },
                      { label: 'Corporate name', value: detail.orgName },
                      { label: 'Email', value: String(detail.identity.email ?? '—') },
                      { label: 'Client credential', value: detail.clientName },
                      { label: 'Vendor org ID', value: String(detail.vendor.vendorOrgId ?? '—') },
                      { label: 'Connected on', value: String(detail.identity.dateOfConnection ?? '—') },
                    ]}
                  />
                </section>

                <section className="search-section">
                  <h4 className="search-section-title">HRMS & integration</h4>
                  <KvGrid
                    items={[
                      { label: 'HRMS name', value: detail.hrms.name },
                      { label: 'HRMS code', value: detail.hrms.code },
                    ]}
                  />
                </section>

                <section className="search-section">
                  <h4 className="search-section-title">Sync configuration</h4>
                  <KvGrid
                    items={[
                      { label: 'Sync enabled', value: detail.sync.enabled === true ? 'Yes' : detail.sync.enabled === false ? 'No' : '—' },
                      { label: 'Sync frequency', value: String(detail.sync.frequency ?? '—') },
                      { label: 'Last successful sync', value: String(detail.sync.lastSuccessfulSync ?? '—') },
                      { label: 'Application status', value: String(detail.sync.applicationStatus ?? '—') },
                      { label: 'Connection status', value: String(detail.sync.status ?? '—') },
                    ]}
                  />
                </section>

                {detail.topEmployees && detail.topEmployees.length > 0 && (
                  <section className="search-section">
                    <h4 className="search-section-title">Top employees (sample of 5)</h4>
                    {detail.topEmployees.map((emp, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                        <p style={{ fontWeight: 600, fontSize: '0.875rem', margin: '0 0 0.5rem' }}>
                          {emp.name || `Employee ${idx + 1}`}
                          {emp.email ? ` · ${emp.email}` : ''}
                        </p>
                        {emp.fields.length > 0 && <KvGrid items={emp.fields.map(f => ({ label: f.label, value: f.value }))} />}
                      </div>
                    ))}
                  </section>
                )}

                <section className="search-section">
                  <h4 className="search-section-title">
                    Data sharing ({detail.dataSharing.sharedCount} shared · {detail.dataSharing.notSharedCount} not shared)
                  </h4>
                  {detail.dataSharing.shared.length > 0 && (
                    <>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Shared data points</p>
                      <div className="search-tag-list" style={{ marginBottom: '1rem' }}>
                        {detail.dataSharing.shared.map(dp => (
                          <span key={dp} className="search-tag shared">{dp}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {detail.dataSharing.notShared.length > 0 && (
                    <>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Not shared</p>
                      <div className="search-tag-list">
                        {detail.dataSharing.notShared.map(dp => (
                          <span key={dp} className="search-tag not-shared">{dp}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {detail.dataSharing.sharedCount === 0 && detail.dataSharing.notSharedCount === 0 && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No data point flags on this connection.</p>
                  )}
                </section>

                {(detail.health7d || detail.health30d) && (
                  <section className="search-section">
                    <h4 className="search-section-title">Sync health</h4>
                    <div className="search-health-cards">
                      {detail.health7d && (
                        <>
                          <div className="search-health-card">
                            <div className="label">7-day status</div>
                            <div className="value" style={{ fontSize: '0.875rem' }}>
                              <StatusPill status={detail.health7d.overallStatus as string} />
                            </div>
                          </div>
                          <div className="search-health-card">
                            <div className="label">7d success rate</div>
                            <div className="value">{detail.health7d.successRate as number}%</div>
                          </div>
                          <div className="search-health-card">
                            <div className="label">7d sync attempts</div>
                            <div className="value">{detail.health7d.totalSyncs as number}</div>
                          </div>
                        </>
                      )}
                      {detail.health30d && (
                        <>
                          <div className="search-health-card">
                            <div className="label">30d success rate</div>
                            <div className="value">{detail.health30d.successRate as number}%</div>
                          </div>
                          <div className="search-health-card">
                            <div className="label">30d employees (latest)</div>
                            <div className="value">{String(detail.health30d.employeesLatest ?? '—')}</div>
                          </div>
                          <div className="search-health-card">
                            <div className="label">30d created / updated</div>
                            <div className="value" style={{ fontSize: '0.875rem' }}>
                              +{detail.health30d.employeesCreated as number} / ~{detail.health30d.employeesUpdated as number}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {detail.health7d?.lastFailureReason != null && String(detail.health7d.lastFailureReason) !== '' && (
                      <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--p0-rose)' }}>
                        Last failure: {String(detail.health7d.lastFailureReason)}
                      </p>
                    )}
                    {Array.isArray(detail.health7d?.failureReasons) && (detail.health7d.failureReasons as string[]).length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Failure reasons (7d)</p>
                        <div className="search-tag-list">
                          {(detail.health7d.failureReasons as string[]).map(r => (
                            <span key={r} className="search-tag not-shared">{r}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {detail.recentSyncLogs.length > 0 && (
                  <section className="search-section">
                    <h4 className="search-section-title">Recent sync logs (30 days)</h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="search-logs-table">
                        <thead>
                          <tr>
                            <th>Started</th>
                            <th>Status</th>
                            <th>Found</th>
                            <th>Created</th>
                            <th>Updated</th>
                            <th>Duration</th>
                            <th>Failure reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.recentSyncLogs.map((log, i) => (
                            <tr key={i}>
                              <td>{String(log.sync_start_time ?? '—')}</td>
                              <td>
                                <StatusPill status={log.sync_status === 'success' ? 'healthy' : log.sync_status === 'failed' ? 'failed' : 'no_sync'} />
                              </td>
                              <td>{String(log.employees_found ?? '—')}</td>
                              <td>{String(log.employees_created ?? '—')}</td>
                              <td>{String(log.employees_updated ?? '—')}</td>
                              <td>{log.duration_seconds != null ? `${log.duration_seconds}s` : '—'}</td>
                              <td>{String(log.failure_reason ?? '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                <section className="search-section">
                  <h4 className="search-section-title">Connection API fields</h4>
                  <KvGrid items={detail.fields.map(f => ({ label: f.label, value: f.value }))} />
                </section>

                {detail.additionalFields.length > 0 && (
                  <section className="search-section">
                    <h4 className="search-section-title">Additional API fields</h4>
                    <KvGrid items={detail.additionalFields.map(f => ({ label: f.label, value: f.value }))} />
                  </section>
                )}

                <section className="search-section">
                  <button type="button" className="search-raw-toggle" onClick={() => setShowRaw(v => !v)}>
                    {showRaw ? '▼ Hide raw API payload' : '▶ Show complete raw API payload'}
                  </button>
                  {showRaw && (
                    <pre className="search-raw-json">{JSON.stringify(detail.raw, null, 2)}</pre>
                  )}
                </section>

                <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
                  Indexed at {formatDate(detail.indexedAt)}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
