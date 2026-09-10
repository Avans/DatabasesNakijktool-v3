// CORS handling for calls coming from Brightspace pages.

/**
 * Apply CORS headers and answer preflight requests.
 *
 * @returns {boolean} true when the request was a preflight and is fully handled.
 */
function applyCors(req, res) {
  const allowed = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim());
  const origin = req.headers.origin;

  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}

module.exports = { applyCors };
