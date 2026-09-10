// Keep-alive for the Aiven free-tier database.
//
// Aiven powers off free services that see no continuative activity, which would
// otherwise need a manual power-on in the console. Two scheduled hits a day
// (see the `crons` block in vercel.json) keep the service counted as active,
// including during holidays when no student touches the tool.
//
// Real queries against both the app schema and a practice schema are used
// rather than a bare connect, so the activity is unambiguous.

const db = require('../../lib/db');

module.exports = async function handler(req, res) {
  // Vercel signs cron invocations with CRON_SECRET when that variable is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const result = { app: false, practice: false };

  try {
    const rows = await db.appQuery('SELECT COUNT(*) AS assignments FROM assignments');
    result.app = true;
    result.assignments = rows[0].assignments;

    // Practice schemas live in the same service, but touch one anyway so the
    // read-only account stays exercised too.
    const schemaRows = await db.appQuery('SELECT `schema` FROM connections ORDER BY ID LIMIT 1');
    if (schemaRows.length > 0) {
      await db.studentQuery(schemaRows[0].schema, 'SELECT 1');
      result.practice = true;
    }

    console.log('Keep-alive succeeded', result);
    return res.status(200).json({
      status: 'ok',
      ...result,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    // A non-200 makes the failure visible in the Vercel cron log.
    console.error('Keep-alive failed:', error);
    return res.status(500).json({
      status: 'error',
      ...result,
      error: error.code || error.message,
      durationMs: Date.now() - startedAt
    });
  }
};
