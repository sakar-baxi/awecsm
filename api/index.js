import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const serverless = require('serverless-http');
const app = require('../server/index.cjs');

const handler = serverless(app, {
  binary: false,
  request(req, _event, context) {
    req.vercel = { event: _event, context };
  },
});

/** Vercel serverless entry — Express via serverless-http for reliable POST/body handling */
export default async function vercelHandler(req, res) {
  return handler(req, res);
}
