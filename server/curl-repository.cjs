const store = require('./store.cjs');
const { encrypt, decrypt } = require('./crypto.cjs');
const crypto = require('crypto');

const uuidv4 = () => crypto.randomUUID();

function readSnippets() {
  const data = store.read('curl_snippets');
  return Array.isArray(data) ? data : [];
}

function writeSnippets(snippets) {
  store.write('curl_snippets', snippets);
}

function toPublicMeta(snippet) {
  return {
    id: snippet.id,
    label: snippet.label,
    connectionId: snippet.connectionId || null,
    clientId: snippet.clientId || null,
    clientName: snippet.clientName || null,
    orgName: snippet.orgName || null,
    notes: snippet.notes || '',
    createdBy: snippet.createdBy,
    createdAt: snippet.createdAt,
    updatedAt: snippet.updatedAt,
  };
}

function searchSnippets({ q = '', connectionId = '', clientId = '', limit = 50, offset = 0 } = {}) {
  const needle = String(q).trim().toLowerCase();
  let items = readSnippets();

  if (connectionId) {
    items = items.filter(s => s.connectionId === connectionId);
  }
  if (clientId) {
    items = items.filter(s => s.clientId === clientId);
  }
  if (needle) {
    items = items.filter(s => {
      const haystack = [s.label, s.orgName, s.clientName, s.connectionId, s.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  items.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const total = items.length;
  const results = items.slice(offset, offset + limit).map(toPublicMeta);
  return { total, results, limit, offset };
}

function createSnippet(payload, user) {
  const { label, curl, connectionId, clientId, clientName, orgName, notes } = payload;
  if (!label?.trim()) throw new Error('Label is required');
  if (!curl?.trim()) throw new Error('cURL command is required');

  const now = new Date().toISOString();
  const snippet = {
    id: uuidv4(),
    label: label.trim(),
    connectionId: connectionId?.trim() || null,
    clientId: clientId?.trim() || null,
    clientName: clientName?.trim() || null,
    orgName: orgName?.trim() || null,
    notes: (notes || '').trim(),
    curl: encrypt(curl.trim()),
    createdBy: { id: user.id, username: user.username },
    createdAt: now,
    updatedAt: now,
  };

  const snippets = readSnippets();
  snippets.push(snippet);
  writeSnippets(snippets);
  return toPublicMeta(snippet);
}

function updateSnippet(id, payload, user) {
  const snippets = readSnippets();
  const idx = snippets.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('Snippet not found');

  const existing = snippets[idx];
  if (user.role !== 'superadmin' && existing.createdBy?.id !== user.id) {
    throw new Error('Only the creator or a superadmin can edit this snippet');
  }

  if (payload.label?.trim()) existing.label = payload.label.trim();
  if (payload.notes !== undefined) existing.notes = String(payload.notes || '').trim();
  if (payload.curl?.trim()) existing.curl = encrypt(payload.curl.trim());
  if (payload.connectionId !== undefined) existing.connectionId = payload.connectionId?.trim() || null;
  if (payload.clientId !== undefined) existing.clientId = payload.clientId?.trim() || null;
  if (payload.clientName !== undefined) existing.clientName = payload.clientName?.trim() || null;
  if (payload.orgName !== undefined) existing.orgName = payload.orgName?.trim() || null;
  existing.updatedAt = new Date().toISOString();

  snippets[idx] = existing;
  writeSnippets(snippets);
  return toPublicMeta(existing);
}

function revealSnippet(id) {
  const snippet = readSnippets().find(s => s.id === id);
  if (!snippet) throw new Error('Snippet not found');
  return {
    ...toPublicMeta(snippet),
    curl: decrypt(snippet.curl),
  };
}

function deleteSnippet(id, user) {
  const snippets = readSnippets();
  const snippet = snippets.find(s => s.id === id);
  if (!snippet) throw new Error('Snippet not found');
  if (user.role !== 'superadmin' && snippet.createdBy?.id !== user.id) {
    throw new Error('Only the creator or a superadmin can delete this snippet');
  }
  writeSnippets(snippets.filter(s => s.id !== id));
  return toPublicMeta(snippet);
}

module.exports = {
  searchSnippets,
  createSnippet,
  updateSnippet,
  revealSnippet,
  deleteSnippet,
};
