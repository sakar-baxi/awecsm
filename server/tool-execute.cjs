/** Server-side cURL / tool execution helpers */

function normalizeToolBody(body) {
  if (body == null || body === '') return undefined;
  if (typeof body === 'object') return JSON.stringify(body);
  const trimmed = String(body).trim();
  return trimmed || undefined;
}

function parseToolResponse(text, contentType) {
  if (!text) return null;
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function applyEnvironmentToUrl(url, environment) {
  if (!url || !environment || environment.toLowerCase() === 'prod') return url;
  const env = environment.toLowerCase();
  return url.replace('node.tartanhq.com', `${env}-node.tartanhq.com`);
}

module.exports = {
  normalizeToolBody,
  parseToolResponse,
  applyEnvironmentToUrl,
};
