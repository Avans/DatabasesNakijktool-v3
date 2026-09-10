// All assignment endpoints, kept on the same URL shape as v2 so the
// Brightspace component only needs a new host. vercel.json rewrites
// /assignments/... onto this one function; see resolveSegments below.
//
//   GET  /assignments/:assignmentId
//   GET  /assignments/:assignmentId/submissions/:userId
//   POST /assignments/:assignmentId/submissions

const { applyCors } = require('../lib/cors');
const assignmentService = require('../lib/services/assignmentService');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  const segments = resolveSegments(req);
  const assignmentId = parseInt(segments[0], 10);

  if (Number.isNaN(assignmentId)) {
    return res.status(400).json({ error: 'Invalid assignment id' });
  }

  try {
    // GET /assignments/:id
    if (req.method === 'GET' && segments.length === 1) {
      const assignment = await assignmentService.getAssignmentViewModel(assignmentId);

      if (!assignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
      return res.status(200).json(assignment);
    }

    // GET /assignments/:id/submissions/:userId
    if (req.method === 'GET' && segments.length === 3 && segments[1] === 'submissions') {
      const submission = await assignmentService.getSubmission(assignmentId, segments[2]);

      if (!submission) {
        // The component treats 204 as "nothing submitted yet".
        return res.status(204).end();
      }
      return res.status(200).json(submission);
    }

    // POST /assignments/:id/submissions
    if (req.method === 'POST' && segments.length === 2 && segments[1] === 'submissions') {
      const body = parseBody(req.body);
      const userName = body.email;
      const query = body.query;

      if (!userName || typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({ error: 'Email and query are required' });
      }

      if (query.length > 10000) {
        return res.status(400).json({ error: 'Query is too long' });
      }

      await assignmentService.saveSubmission(assignmentId, String(userName), query);

      // Checked straight away, so the response already carries the verdict.
      // The component still polls afterwards, which stays harmless.
      const verified = await assignmentService.verifySubmission(
        assignmentId,
        String(userName)
      );

      return res.status(201).json(verified);
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Error handling request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * The path segments after /assignments/.
 *
 * This used to live in api/assignments/[...path].js and lean on Vercel filling
 * req.query.path. On a real deploy that catch-all only ever matched a single
 * segment: /assignments/:id answered, while /assignments/:id/submissions got a
 * platform 404 and never reached this function. So the route is spelled out in
 * vercel.json instead, which hands the segments over as ?path=a/b/c.
 *
 * Three shapes therefore have to work: that query string, an array (what a
 * catch-all would give), and the plain URL (the local dev server, and any
 * direct /api/assignments/... call).
 */
function resolveSegments(req) {
  const raw = (req.query && req.query.path) || [];

  const fromQuery = []
    .concat(raw)
    // ?path=20105/submissions arrives as one string holding the whole tail.
    .flatMap(part => String(part).split('/'))
    // A trailing slash yields an empty final segment.
    .filter(Boolean);

  if (fromQuery.length > 0) return fromQuery;

  const pathname = new URL(req.url || '', 'http://localhost').pathname;
  const match = pathname.match(/^\/(?:api\/)?assignments(?:\/(.*))?$/);

  return match && match[1] ? match[1].split('/').filter(Boolean) : [];
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}
