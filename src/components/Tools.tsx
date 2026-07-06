import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { ToolItem, CredentialItem, UserInfo } from '../api';
import { parseCurl, extractCurlVariables, applyCurlReplacements, validateToolExecution } from '../utils/parseCurl';
import { MinorTaskTimer } from './TaskProgress';

type Props = { user: UserInfo };

type ExecResult = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  method?: string;
  data?: unknown;
  error?: string;
};

export default function Tools({ user }: Props) {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [creds, setCreds] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [newName, setNewName] = useState('');
  const [newCurl, setNewCurl] = useState('');
  const [newEnvs] = useState<string[]>(['Prod', 'Dev', 'Test']);

  const [selectedCredId, setSelectedCredId] = useState('');
  const [corporates, setCorporates] = useState<{ name: string; id: string }[]>([]);
  const [selectedCorpId, setSelectedCorpId] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('Prod');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<ExecResult | null>(null);
  const [execError, setExecError] = useState('');
  const [loadingCorps, setLoadingCorps] = useState(false);
  const [vendorInfo, setVendorInfo] = useState<{ vendor_org_id: string; org_name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([api.getTools(), api.getCredentials()]);
      setTools(t);
      setCreds(c);
      setActiveToolId(prev => prev || (t[0]?.id ?? null));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedCredId) {
      setVendorInfo(null);
      setCorporates([]);
      setSelectedCorpId('');
      return;
    }

    setLoadingCorps(true);
    setVendorInfo(null);
    setCorporates([]);
    setSelectedCorpId('');

    Promise.all([
      api.getVendorInfo(selectedCredId).catch(() => null),
      api.fetchConnections(selectedCredId).catch(() => null),
    ])
      .then(([vendor, connRes]) => {
        if (vendor) setVendorInfo(vendor);
        if (connRes?.data && Array.isArray(connRes.data)) {
          const uniqueCorps: { name: string; id: string }[] = [];
          const seen = new Set<string>();
          connRes.data.forEach((item: { org_name?: string; org_id?: string | number }) => {
            const orgId = item.org_id != null ? String(item.org_id) : '';
            if (item.org_name && orgId && !seen.has(orgId)) {
              seen.add(orgId);
              uniqueCorps.push({ name: item.org_name, id: orgId });
            }
          });
          uniqueCorps.sort((a, b) => a.name.localeCompare(b.name));
          setCorporates(uniqueCorps);
        }
      })
      .finally(() => setLoadingCorps(false));
  }, [selectedCredId]);

  useEffect(() => {
    setVariableValues({});
    setExecResult(null);
    setExecError('');
  }, [activeToolId]);

  const handleAddTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCurl) return;

    const vars = extractCurlVariables(newCurl);

    try {
      await api.addTool(newName, newCurl, vars, newEnvs);
      setNewName('');
      setNewCurl('');
      setShowAddForm(false);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add tool');
    }
  };

  const handleExecute = async () => {
    const tool = tools.find(t => t.id === activeToolId);
    if (!tool) return;

    const validationError = validateToolExecution(tool, {
      selectedCredId,
      selectedCorpId,
      vendorOrgId: vendorInfo?.vendor_org_id,
      variableValues,
    });
    if (validationError) {
      setExecError(validationError);
      return;
    }

    setExecuting(true);
    setExecResult(null);
    setExecError('');

    try {
      const parsed = parseCurl(tool.curl);
      if (!parsed.url) throw new Error('Could not parse URL from cURL. Check the saved command.');

      const replaced = applyCurlReplacements(parsed, {
        ...variableValues,
        vendor_org_id: vendorInfo?.vendor_org_id || '',
        org_id: selectedCorpId,
        token: '',
      });

      const result = await api.executeTool(
        selectedCredId,
        replaced.url,
        replaced.method,
        replaced.headers,
        replaced.body,
        selectedEnv,
        tool.name
      ) as ExecResult;

      setExecResult(result);
      if (result.ok === false) {
        setExecError(result.error || `API returned HTTP ${result.status || 'error'}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution failed';
      setExecError(message);
      setExecResult({ ok: false, error: message });
    } finally {
      setExecuting(false);
    }
  };

  const activeTool = tools.find(t => t.id === activeToolId);
  const isDestructive = activeTool && (/purge|data purge/i.test(activeTool.name) || /data_purge/i.test(activeTool.curl));
  const canExecute =
    !!activeTool &&
    !!selectedCredId &&
    !executing &&
    !loadingCorps &&
    (!activeTool.variables.includes('org_id') || !!selectedCorpId) &&
    (!activeTool.variables.includes('vendor_org_id') || !!vendorInfo?.vendor_org_id);

  if (loading) return <div className="empty-state">Loading tools...</div>;

  return (
    <div className="animate-fade-in tools-page">
      <div className="view-header">
        <div>
          <h2 className="results-title">Developer Tools</h2>
          <p className="subtitle page-subtitle">
            Execute saved APIs with automated auth, vendor org, and corporate variable injection.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add New Tool'}
        </button>
      </div>

      {showAddForm && (
        <div className="form-container animate-fade-in">
          <form onSubmit={handleAddTool} className="add-tool-form">
            <div className="input-group">
              <label className="input-label">Tool Name</label>
              <input required value={newName} onChange={e => setNewName(e.target.value)} className="token-input" placeholder="e.g. Sync Connection" />
            </div>
            <div className="input-group" style={{ gridColumn: 'span 2' }}>
              <label className="input-label">cURL Command</label>
              <textarea
                required
                value={newCurl}
                onChange={e => setNewCurl(e.target.value)}
                className="token-input textarea-tall"
                placeholder="Paste curl here. Use {{variable_name}} for dynamic fields."
              />
            </div>
            <div className="input-group" style={{ justifyContent: 'flex-end', paddingTop: '1rem', gridColumn: 'span 3' }}>
              <button type="submit" className="btn-primary">Save Tool</button>
            </div>
          </form>
          <div className="form-hint">
            <strong>Tip:</strong> Use <code>{'{{vendor_org_id}}'}</code> and <code>{'{{org_id}}'}</code> for auto-fill.
            <code>{'{{token}}'}</code> is injected automatically — do not fill it manually.
          </div>
        </div>
      )}

      {tools.length > 0 ? (
        <div className="tools-layout">
          <div className="tools-sidebar">
            <div className="table-wrapper">
              <div className="sidebar-list">
                {tools.map(t => (
                  <div
                    key={t.id}
                    className={`sidebar-item ${activeToolId === t.id ? 'active' : ''}`}
                    onClick={() => setActiveToolId(t.id)}
                  >
                    <span className="tool-name">{t.name}</span>
                    {user.role === 'superadmin' && (
                      <button
                        className="btn-icon btn-danger small"
                        onClick={async e => {
                          e.stopPropagation();
                          if (confirm('Request deletion of tool: ' + t.name + '?')) {
                            try {
                              await api.requestApproval('DELETE_TOOL', t.id, 'Tool: ' + t.name);
                              alert('Deletion request sent.');
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : 'Request failed');
                            }
                          }
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="tool-execution panel">
            {activeTool && (
              <div className="results-container">
                <div className="panel-header">
                  <h3 className="panel-title">{activeTool.name}</h3>
                  <div className="badge"><span className="badge-dot" /> {selectedEnv}</div>
                </div>

                {isDestructive && user.role !== 'superadmin' && (
                  <div className="tool-warning-banner">
                    This is a destructive tool. Only superadmins can execute it.
                  </div>
                )}

                <div className="execution-form">
                  <div className="input-group">
                    <label className="input-label">Select Client</label>
                    <select className="token-input" value={selectedCredId} onChange={e => setSelectedCredId(e.target.value)}>
                      <option value="">-- Choose Client --</option>
                      {creds.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">Select Corporate</label>
                    <select
                      className="token-input"
                      value={selectedCorpId}
                      onChange={e => setSelectedCorpId(e.target.value)}
                      disabled={!selectedCredId || loadingCorps}
                    >
                      <option value="">{loadingCorps ? 'Loading corporates…' : '-- Choose Corporate --'}</option>
                      {corporates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">Env</label>
                    <select className="token-input" value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)}>
                      {(activeTool.environments?.length ? activeTool.environments : ['Prod', 'Dev', 'Test']).map(env => (
                        <option key={env} value={env}>{env}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {activeTool.variables.filter(v => v !== 'org_id' && v !== 'vendor_org_id').length > 0 && (
                  <div className="variables-section" style={{ marginBottom: '2rem' }}>
                    <h4>Custom Variables</h4>
                    <div className="variables-grid">
                      {activeTool.variables.filter(v => v !== 'org_id' && v !== 'vendor_org_id').map(v => (
                        <div key={v} className="input-group">
                          <label className="input-label">{v}</label>
                          <input
                            className="token-input compact"
                            value={variableValues[v] || ''}
                            onChange={e => setVariableValues(prev => ({ ...prev, [v]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="exec-actions">
                  <button
                    className="btn-primary"
                    onClick={handleExecute}
                    disabled={!canExecute || (isDestructive && user.role !== 'superadmin')}
                  >
                    {executing ? <div className="spinner" /> : 'Execute API'}
                  </button>
                  {executing && <MinorTaskTimer active label="Executing tool" />}
                  {vendorInfo?.vendor_org_id && (
                    <span className="exec-success">
                      ✓ Vendor org: <code>{vendorInfo.vendor_org_id}</code>
                      {vendorInfo.org_name ? ` (${vendorInfo.org_name})` : ''}
                    </span>
                  )}
                </div>

                {execError && (
                  <div className="tool-error-banner">{execError}</div>
                )}

                {execResult && (
                  <div className="result-output" style={{ marginTop: '2rem' }}>
                    <div className="result-output-header">
                      <h4>Response</h4>
                      {execResult.status != null && (
                        <span className={`tool-status-badge ${execResult.ok ? 'ok' : 'fail'}`}>
                          HTTP {execResult.status}{execResult.statusText ? ` ${execResult.statusText}` : ''}
                        </span>
                      )}
                    </div>
                    {execResult.url && (
                      <p className="tool-request-line">
                        <strong>{execResult.method || 'GET'}</strong> {execResult.url}
                      </p>
                    )}
                    <div className={`table-wrapper code-output ${execResult.ok === false ? 'error' : 'success'}`}>
                      <pre>{JSON.stringify(execResult.data ?? execResult, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          No tools added yet. Click &quot;Add New Tool&quot; to get started.
        </div>
      )}
    </div>
  );
}
