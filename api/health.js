// Public health check. Also usable as the target for an external uptime
// monitor, which doubles as a second keep-alive signal for the database.

const { applyCors } = require('../lib/cors');
const db = require('../lib/db');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const startedAt = Date.now();

  try {
    await db.ping();
    return res.status(200).json({
      status: 'ok',
      database: 'reachable',
      responseTimeMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(503).json({
      status: 'error',
      database: 'unreachable',
      error: error.code || error.message,
      responseTimeMs: Date.now() - startedAt
    });
  }
};
