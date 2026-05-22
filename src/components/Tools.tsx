import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { ToolItem, CredentialItem, UserInfo } from '../api';

type Props = { user: UserInfo };

export default function Tools({ user }: Props) {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [creds, setCreds] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Tool Form State
  const [newName, setNewName] = useState('');
  const [newCurl, setNewCurl] = useState('');
  const [newEnvs] = useState<string[]>(['Prod', 'Dev', 'Test']);

  // Execution State
  const [selectedCredId, setSelectedCredId] = useState('');
  const [corporates, setCorporates] = useState<any[]>([]);
  const [selectedCorpId, setSelectedCorpId] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('Prod');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<any>(null);
  const [vendorInfo, setVendorInfo] = useState<{ vendor_org_id: string; org_name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([api.getTools(), api.getCredentials()]);
      setTools(t);
      setCreds(c);
      if (t.length > 0 && !activeToolId) setActiveToolId(t[0].id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeToolId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selectedCredId) {
      // Fetch Vendor Info and Corporates
      api.getVendorInfo(selectedCredId).then(setVendorInfo).catch(console.error);
      api.fetchConnections(selectedCredId).then(res => {
        if (res.data && Array.isArray(res.data)) {
          // Extract unique corporates with their org_id
          const uniqueCorps: any[] = [];
          const seen = new Set();
          res.data.forEach((item: any) => {
            if (item.org_name && item.org_id && !seen.has(item.org_id)) {
              seen.add(item.org_id);
              uniqueCorps.push({ name: item.org_name, id: item.org_id });
            }
          });
          setCorporates(uniqueCorps);
        }
      }).catch(console.error);
    } else {
      setVendorInfo(null);
      setCorporates([]);
      setSelectedCorpId('');
    }
  }, [selectedCredId]);

  const handleAddTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCurl) return;
    
    // Extract variables from curl (looking for {{variable}})
    const matches = newCurl.match(/\{\{([^}]+)\}\}/g) || [];
    const vars = Array.from(new Set(matches.map(m => m.replace(/[{}]/g, ''))));
    
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
    if (!tool || !selectedCredId) return;

    setExecuting(true);
    setExecResult(null);

    try {
      // Parse cURL to extract method, headers, and body
      let method = 'GET';
      if (/(-X\s+POST|--request\s+POST)/i.test(tool.curl)) method = 'POST';
      else if (/(-X\s+PUT|--request\s+PUT)/i.test(tool.curl)) method = 'PUT';
      else if (/(-X\s+DELETE|--request\s+DELETE)/i.test(tool.curl)) method = 'DELETE';
      else if (/(-d|--data|--data-raw)/.test(tool.curl)) method = 'POST';

      const cleanedCurl = tool.curl.replace(/\\\n/g, ' ');
      
      const urlMatch = cleanedCurl.match(/'(https?:\/\/[^']+)'/) || 
                       cleanedCurl.match(/"(https?:\/\/[^"]+)"/) ||
                       cleanedCurl.match(/(https?:\/\/[^\s]+)/);
      let url = urlMatch ? urlMatch[1] : '';

      const headerMatches = cleanedCurl.match(/(-H|--header)\s+(['"])(.*?)\2/g) || 
                            cleanedCurl.match(/(-H|--header)\s+([^\s"']+)/g) || [];
      const headers: Record<string, string> = {};
      headerMatches.forEach(h => {
        const content = h.replace(/^(-H|--header)\s+(['"]?)/, '').replace(/(['"]?)$/, '');
        const [key, ...val] = content.split(':');
        if (key) headers[key.trim()] = val.join(':').trim();
      });

      const bodyMatch = cleanedCurl.match(/(-d|--data|--data-raw|--data-binary)\s+(['"])([\s\S]*?)\2/) ||
                        cleanedCurl.match(/(-d|--data|--data-raw|--data-binary)\s+([^\s"']+)/);
      let body = bodyMatch ? (bodyMatch[3] || bodyMatch[2]) : null;

      // Replace variables in URL, headers, and body
      const replacements: Record<string, string> = {
        ...variableValues,
        vendor_org_id: vendorInfo?.vendor_org_id || '',
        org_id: selectedCorpId || ''
      };

      const replace = (str: string) => {
        let res = str;
        Object.entries(replacements).forEach(([k, v]) => {
          res = res.split(`{{${k}}}`).join(v);
        });
        return res;
      };

      url = replace(url);
      if (body) body = replace(body);
      Object.keys(headers).forEach(k => {
        headers[k] = replace(headers[k]);
      });

      const result = await api.executeTool(selectedCredId, url, method, headers, body, selectedEnv);
      setExecResult(result);
    } catch (err) {
      setExecResult({ error: err instanceof Error ? err.message : 'Execution failed' });
    } finally {
      setExecuting(false);
    }
  };

  const activeTool = tools.find(t => t.id === activeToolId);

  if (loading) return <div className="empty-state">Loading tools...</div>;

  return (
    <div className="animate-fade-in tools-page">
      <div className="view-header">
        <div>
          <h2 className="results-title">Developer Tools</h2>
          <p className="subtitle page-subtitle">
            Execute saved APIs with automated variable injection.
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
            <strong>Tip:</strong> You can use <code>{"{{vendor_org_id}}"}</code> and <code>{"{{org_id}}"}</code> which will be automatically filled based on the selected client and corporate.
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
                    onClick={() => { setActiveToolId(t.id); setExecResult(null); }}
                  >
                    <span className="tool-name">{t.name}</span>
                    {user.role === 'superadmin' && (
                      <button className="btn-icon btn-danger small" onClick={async (e) => { 
                        e.stopPropagation(); 
                        if (confirm('Request deletion of tool: ' + t.name + '?')) {
                          try {
                            await api.requestApproval('DELETE_TOOL', t.id, 'Tool: ' + t.name);
                            alert('Deletion request sent.');
                          } catch (err: any) { alert(err.message); }
                        }
                      }}>
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
                    <select className="token-input" value={selectedCorpId} onChange={e => setSelectedCorpId(e.target.value)} disabled={!selectedCredId}>
                      <option value="">-- Choose Corporate --</option>
                      {corporates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">Env</label>
                    <select className="token-input" value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)}>
                      <option value="Prod">Prod</option>
                      <option value="Dev">Dev</option>
                      <option value="Test">Test</option>
                    </select>
                  </div>
                </div>

                {activeTool.variables.length > 0 && (
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
                    disabled={executing || !selectedCredId || (activeTool.variables.includes('org_id') && !selectedCorpId)}
                  >
                    {executing ? <div className="spinner" /> : 'Execute API'}
                  </button>
                  {vendorInfo && (
                    <span className="exec-success">
                      ✓ Auto-fetched Vendor ID: <code>{vendorInfo.vendor_org_id}</code>
                    </span>
                  )}
                </div>

                {execResult && (
                  <div className="result-output" style={{ marginTop: '2rem' }}>
                    <h4>Response</h4>
                    <div className="table-wrapper code-output">
                      <pre>{JSON.stringify(execResult, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          No tools added yet. Click "Add New Tool" to get started.
        </div>
      )}
    </div>
  );
}
