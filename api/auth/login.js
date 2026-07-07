import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { handleLogin } = require('../../server/vercel-auth.cjs');

export default function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  return handleLogin(req, res);
}
