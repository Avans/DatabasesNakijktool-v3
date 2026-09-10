// Database connection handling for the serverless environment.
//
// Two separate pools are used on purpose:
//   appPool     - fixed on the `databaas` schema, used for assignments/submissions.
//   studentPool - no default schema; every borrowed connection switches to the
//                 practice schema of the assignment before running student SQL.
//
// Keeping them apart means a schema switch can never leak into a bookkeeping
// query, which was possible in v2 where both shared one pool.

const mysql = require('mysql2/promise');

// Serverless functions are frozen between invocations rather than torn down, so
// pools cached on globalThis survive warm starts and avoid reconnect churn.
const cache = globalThis.__nakijkPools || (globalThis.__nakijkPools = {});

const APP_SCHEMA = process.env.DB_NAME || 'databaas';

function sslOptions() {
  const ca = process.env.DB_SSL_CA;

  if (!ca) {
    // Aiven always serves TLS; without the CA we still encrypt, but cannot
    // verify the certificate chain.
    return { rejectUnauthorized: false };
  }

  return {
    // Vercel env vars keep newlines escaped when pasted as a single line.
    ca: ca.includes('\\n') ? ca.replace(/\\n/g, '\n') : ca,
    rejectUnauthorized: true
  };
}

function baseConfig() {
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: sslOptions(),
    waitForConnections: true,
    // Aiven's free plan allows a limited number of connections and several
    // serverless instances may be warm at once, so stay modest.
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '3', 10),
    queueLimit: 0,
    // A suspended service needs time to accept the first connection.
    connectTimeout: 20000,
    enableKeepAlive: true,
    // Stacked statements ("SELECT 1; DROP TABLE x") must stay impossible.
    multipleStatements: false,
    dateStrings: false,
    timezone: 'Z'
  };
}

function getAppPool() {
  if (!cache.app) {
    cache.app = mysql.createPool({ ...baseConfig(), database: APP_SCHEMA });
  }
  return cache.app;
}

function getStudentPool() {
  if (!cache.student) {
    cache.student = mysql.createPool({
      ...baseConfig(),
      // Credentials of the restricted read-only account when configured,
      // otherwise the main account (still wrapped in a read-only transaction).
      user: process.env.STUDENT_DB_USER || process.env.DB_USER,
      password: process.env.STUDENT_DB_PASSWORD || process.env.DB_PASSWORD
    });
  }
  return cache.student;
}

/**
 * Run a bookkeeping query against the `databaas` schema.
 *
 * Retries once on a connection-level failure: an Aiven service that was powered
 * down needs a moment to accept its first connection, and a student should see a
 * slow response rather than an error.
 */
async function appQuery(sql, params = []) {
  const pool = getAppPool();

  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    if (!isConnectionError(error)) throw error;

    console.warn('Connection failed, retrying after wake-up delay:', error.code);
    // Discard the cached pool so the retry dials a fresh connection.
    await discardPool('app');
    await sleep(3000);

    const [rows] = await getAppPool().query(sql, params);
    return rows;
  }
}

/** Close and forget a cached pool so the next call builds a new one. */
async function discardPool(name) {
  const pool = cache[name];
  cache[name] = null;

  if (!pool) return;

  try {
    await pool.end();
  } catch (error) {
    // A pool that already lost its connections throws here; nothing to do.
    console.warn(`Closing ${name} pool failed:`, error.code || error.message);
  }
}

function isConnectionError(error) {
  const codes = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'ER_CON_COUNT_ERROR',
    'EPIPE'
  ];
  return codes.includes(error.code) || error.fatal === true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a single statement against a practice schema under student-grade limits.
 *
 * The statement runs inside a read-only transaction with a server-side execution
 * timeout, on a connection that is switched to the practice schema and released
 * afterwards. Both guards are enforced by MySQL itself, so they hold even if the
 * restricted database account is not configured.
 */
async function studentQuery(schema, sql) {
  const pool = getStudentPool();
  let connection;

  try {
    connection = await pool.getConnection();
  } catch (error) {
    if (!isConnectionError(error)) throw error;

    await discardPool('student');
    await sleep(3000);
    connection = await getStudentPool().getConnection();
  }

  const timeoutMs = parseInt(process.env.STUDENT_QUERY_TIMEOUT_MS || '5000', 10);

  try {
    // Schema names come from our own `connections` table, never from a student,
    // but validate anyway so this helper stays safe wherever it is called.
    if (!/^[A-Za-z0-9_]+$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }

    await connection.query(`USE \`${schema}\``);
    await connection.query(`SET SESSION max_execution_time = ${timeoutMs}`);
    await connection.query('START TRANSACTION READ ONLY');

    const [rows] = await connection.query(sql);
    return Array.isArray(rows) ? rows : [];
  } finally {
    if (connection) {
      try {
        await connection.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError.message);
      }
      connection.release();
    }
  }
}

/** Cheap round-trip used by the health check and the keep-alive cron. */
async function ping() {
  const rows = await appQuery('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

module.exports = {
  appQuery,
  studentQuery,
  ping,
  APP_SCHEMA
};
