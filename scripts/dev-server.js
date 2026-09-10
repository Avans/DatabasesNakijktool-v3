// Local stand-in for `vercel dev`.
//
//   node scripts/dev-server.js          # http://localhost:3000
//   PORT=4000 node scripts/dev-server.js
//
// `vercel dev` needs a Vercel login and a linked project. This server needs
// neither: it loads the same handlers from api/ and gives them the few extras
// Vercel adds to req/res (req.query, req.body, res.status().json()), then
// applies the rewrites from vercel.json. Handy for testing against the real
// Aiven database before anything is deployed.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { loadEnv } = require('./load-env');
loadEnv();

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3000', 10);

// Mirrors the `rewrites` block in vercel.json.
const ROUTES = [
  { pattern: /^\/api\/health\/?$/, module: 'api/health.js' },
  { pattern: /^\/api\/cron\/keepalive\/?$/, module: 'api/cron/keepalive.js' },
  {
    // Mirrors the rewrite in vercel.json, which hands the tail over as ?path=a/b.
    pattern: /^\/(?:api\/)?assignments(?:\/(.*))?$/,
    module: 'api/assignments.js',
    query: match => ({ path: match[1] || '' })
  }
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Add the response helpers the handlers expect from Vercel. */
function decorate(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = payload => {
    if (!res.hasHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

function serveStatic(pathname, res) {
  const file = path.join(ROOT, 'public', pathname.replace(/^\/+/, ''));

  // Never serve outside public/.
  if (!file.startsWith(path.join(ROOT, 'public'))) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;

  const type = file.endsWith('.js')
    ? 'application/javascript; charset=utf-8'
    : 'text/plain; charset=utf-8';

  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(file));
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  decorate(res);

  const route = ROUTES.find(r => r.pattern.test(pathname));

  if (!route) {
    if (serveStatic(pathname, res)) return;
    res.status(404).json({
      error: 'Not found',
      hint: 'Try /api/health, /assignments/:id or /api/cron/keepalive'
    });
    return;
  }

  const match = pathname.match(route.pattern);

  req.query = Object.fromEntries(url.searchParams);
  if (route.query) Object.assign(req.query, route.query(match));

  if (req.method === 'POST' || req.method === 'PUT') {
    req.body = await readBody(req);
  }

  const started = Date.now();

  try {
    const handler = require(path.join(ROOT, route.module));
    await handler(req, res);
  } catch (error) {
    console.error('Handler threw:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: error.message });
    }
  } finally {
    console.log(`${req.method} ${pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

server.listen(PORT, () => {
  console.log(`Dev server on http://localhost:${PORT}`);
  console.log('');
  console.log('  GET  /api/health');
  console.log('  GET  /assignments/:id');
  console.log('  GET  /assignments/:id/submissions/:email');
  console.log('  POST /assignments/:id/submissions   {"email":"...","query":"..."}');
  console.log('  GET  /api/cron/keepalive');
  console.log('');
});
