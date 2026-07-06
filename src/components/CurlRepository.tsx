import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { CurlSnippetMeta, UserInfo } from '../api';

type Props = {
  user: UserInfo;
};

export default function CurlRepository({ user }: Props) {
  const [prefill] = useState(() => {
    try {
      const raw = sessionStorage.getItem('curl_repo_prefill');
      if (raw) {
        sessionStorage.removeItem('curl_repo_prefill');
        return JSON.parse(raw);
      }
    } catch { /* ignore */ }
    return undefined;
  });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<CurlSnippetMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!!prefill);
  const [form, setForm] = useState({
    label: '',
    curl: '',
    connectionId: prefill?.connectionId || '',
    clientId: prefill?.clientId || '',
    clientName: prefill?.clientName || '',
    orgName: prefill?.orgName || '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .searchCurlSnippets({
        q: debouncedQuery,
        connectionId: prefill?.connectionId,
        limit: 100,
      })
      .then(data => {
        setResults(data.results || []);
        setTotal(data.total || 0);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Search failed'))
      .finally(() => setLoading(false));
  }, [debouncedQuery, prefill?.connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReveal = async (snippet: CurlSnippetMeta) => {
    if (revealed[snippet.id]) {
      setRevealed(prev => {
        const next = { ...prev };
        delete next[snippet.id];
        return next;
      });
      return;
    }
    setRevealingId(snippet.id);
    try {
      const data = await api.revealCurlSnippet(snippet.id);
      setRevealed(prev => ({ ...prev, [snippet.id]: data.curl }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reveal curl');
    } finally {
      setRevealingId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim() || !form.curl.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.addCurlSnippet({
        label: form.label.trim(),
        curl: form.curl.trim(),
        connectionId: form.connectionId || undefined,
        clientId: form.clientId || undefined,
        clientName: form.clientName || undefined,
        orgName: form.orgName || undefined,
        notes: form.notes || undefined,
      });
      setForm(prev => ({
        ...prev,
        label: '',
        curl: '',
        notes: '',
      }));
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (snippet: CurlSnippetMeta) => {
    const canDelete = user.role === 'superadmin' || snippet.createdBy?.id === user.id;
    if (!canDelete) {
      alert('Only the creator or a superadmin can delete this snippet.');
      return;
    }
    if (!confirm(`Delete curl "${snippet.label}"?`)) return;
    try {
      await api.deleteCurlSnippet(snippet.id);
      setRevealed(prev => {
        const next = { ...prev };
        delete next[snippet.id];
        return next;
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const copyCurl = async (snippet: CurlSnippetMeta) => {
    let curl = revealed[snippet.id];
    if (!curl) {
      const data = await api.revealCurlSnippet(snippet.id);
      curl = data.curl;
      setRevealed(prev => ({ ...prev, [snippet.id]: curl }));
    }
    await navigator.clipboard.writeText(curl);
  };

  return (
    <div className="animate-fade-in curl-repo-page">
      <div className="view-header">
        <div>
          <h2 className="results-title">cURL repository</h2>
          <p className="subtitle page-subtitle">
            Save reusable cURL commands per connection with searchable labels. Commands are encrypted at rest and only
            revealed on demand — access is audit-logged. Never store production secrets in labels or notes.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Close form' : 'Add cURL'}
        </button>
      </div>

      {showForm && (
        <div className="form-container curl-repo-form">
          <form onSubmit={handleSave}>
            <div className="curl-form-grid">
              <div className="input-group">
                <label className="input-label">Label (searchable)</label>
                <input
                  className="token-input"
                  value={form.label}
                  onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="e.g. Darwinbox manual sync — Acme Corp"
                  required
                />
              </div>
              <div className="input-group">
                <label className="input-label">Connection ID (optional)</label>
                <input
                  className="token-input"
                  value={form.connectionId}
                  onChange={e => setForm(prev => ({ ...prev, connectionId: e.target.value }))}
                  placeholder="Links this curl to a connection"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Client / vendor</label>
                <input
                  className="token-input"
                  value={form.clientName}
                  onChange={e => setForm(prev => ({ ...prev, clientName: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Corporate name</label>
                <input
                  className="token-input"
                  value={form.orgName}
                  onChange={e => setForm(prev => ({ ...prev, orgName: e.target.value }))}
                />
              </div>
            </div>
            <div className="input-group" style={{ marginTop: '1rem' }}>
              <label className="input-label">cURL command</label>
              <textarea
                className="token-input curl-textarea"
                rows={8}
                value={form.curl}
                onChange={e => setForm(prev => ({ ...prev, curl: e.target.value }))}
                placeholder="Paste full curl command. Use {{token}} placeholders instead of real bearer tokens when possible."
                required
              />
            </div>
            <div className="input-group" style={{ marginTop: '0.75rem' }}>
              <label className="input-label">Notes (no secrets)</label>
              <input
                className="token-input"
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="When to use this, ticket link, etc."
              />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save encrypted snippet'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="curl-search-bar">
        <input
          type="search"
          className="token-input"
          placeholder="Search by label, client, corporate name, or connection ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="curl-result-count">{loading ? 'Searching…' : `${total} snippet${total === 1 ? '' : 's'}`}</span>
      </div>

      {error && <div className="error-card">{error}</div>}

      <div className="curl-snippet-list">
        {!loading && results.length === 0 && (
          <div className="empty-state card-glass">
            <h3 className="state-title">No cURL snippets yet</h3>
            <p className="state-muted">Add a labeled curl for a connection so your team can find it quickly.</p>
          </div>
        )}
        {results.map(snippet => (
          <div key={snippet.id} className="curl-snippet-card card-glass">
            <div className="curl-snippet-top">
              <div>
                <h3 className="curl-snippet-label">{snippet.label}</h3>
                <p className="curl-snippet-meta">
                  {snippet.clientName && <span>{snippet.clientName}</span>}
                  {snippet.orgName && <span> · {snippet.orgName}</span>}
                  {snippet.connectionId && <span> · Conn {snippet.connectionId}</span>}
                </p>
                {snippet.notes && <p className="curl-snippet-notes">{snippet.notes}</p>}
                <p className="curl-snippet-by">
                  Saved by {snippet.createdBy?.username} · {new Date(snippet.updatedAt || snippet.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="curl-snippet-actions">
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleReveal(snippet)} disabled={revealingId === snippet.id}>
                  {revealingId === snippet.id ? 'Loading…' : revealed[snippet.id] ? 'Hide curl' : 'Reveal curl'}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => copyCurl(snippet)}>
                  Copy
                </button>
                {(user.role === 'superadmin' || snippet.createdBy?.id === user.id) && (
                  <button type="button" className="btn-secondary btn-sm btn-danger" onClick={() => handleDelete(snippet)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            {revealed[snippet.id] && (
              <pre className="curl-snippet-revealed">{revealed[snippet.id]}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
