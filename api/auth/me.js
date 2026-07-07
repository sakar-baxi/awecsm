import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { handleAuthMe } = require('../../server/vercel-auth.cjs');

export default function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  return handleAuthMe(req, res);
}
