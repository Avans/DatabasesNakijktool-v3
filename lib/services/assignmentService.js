// Business logic for assignments and submissions.
const db = require('../db');
const Assignment = require('../models/Assignment');
const AssignmentRegex = require('../models/AssignmentRegex');
const Submission = require('../models/Submission');
const { SubmissionStatus } = require('../models/Submission');
const secretService = require('./secretService');

/** Statements a student is allowed to submit. */
const ALLOWED_STATEMENT = /^\s*(SELECT|WITH)\b/i;

async function getAssignment(assignmentId) {
  const rows = await db.appQuery('SELECT * FROM assignments WHERE ID = ?', [assignmentId]);

  if (!rows || rows.length === 0) return null;

  const assignment = Assignment.fromDb(rows[0]);

  const regexRows = await db.appQuery('SELECT * FROM regexes WHERE assignmentID = ?', [
    assignmentId
  ]);

  if (regexRows && regexRows.length > 0) {
    assignment.setRegexes(regexRows.map(row => AssignmentRegex.fromDb(row)));
  }

  return assignment;
}

async function getAssignmentViewModel(assignmentId) {
  const assignment = await getAssignment(assignmentId);
  return assignment ? assignment.toViewModel() : null;
}

async function getSubmission(assignmentId, userId) {
  const rows = await db.appQuery(
    'SELECT * FROM submissions WHERE assignmentID = ? AND userName = ?',
    [assignmentId, userId]
  );

  if (!rows || rows.length === 0) return null;

  const submission = Submission.fromDb(rows[0]);

  let assignmentToken = null;
  if (
    submission.statusId === SubmissionStatus.Approved ||
    submission.statusId === SubmissionStatus.ManuallyApproved
  ) {
    assignmentToken = secretService.getAssignmentToken(submission.userName, assignmentId);
  }

  return submission.toViewModel(assignmentToken);
}

/** Store the submission with status "unprocessed". */
async function saveSubmission(assignmentId, userName, query) {
  const existing = await db.appQuery(
    'SELECT userName FROM submissions WHERE assignmentID = ? AND userName = ?',
    [assignmentId, userName]
  );

  const timestamp = new Date();

  if (!existing || existing.length === 0) {
    await db.appQuery(
      'INSERT INTO submissions (assignmentID, userName, query, statusID, message, timestamp) ' +
        'VALUES (?, ?, ?, ?, NULL, ?)',
      [assignmentId, userName, query, SubmissionStatus.Unprocessed, timestamp]
    );
  } else {
    await db.appQuery(
      'UPDATE submissions SET query = ?, statusID = ?, message = NULL, timestamp = ? ' +
        'WHERE assignmentID = ? AND userName = ?',
      [query, SubmissionStatus.Unprocessed, timestamp, assignmentId, userName]
    );
  }
}

/** Look up the practice schema an assignment runs against. */
async function getSchemaForAssignment(assignment) {
  const rows = await db.appQuery('SELECT `schema` FROM connections WHERE ID = ?', [
    assignment.connectionId
  ]);

  if (!rows || rows.length === 0) return null;
  return rows[0].schema;
}

/**
 * Check a stored submission and write the verdict back.
 *
 * The order of checks mirrors v2: strip everything after the first semicolon,
 * reject comments, run the query, compare the result against the reference
 * answer and finally apply the regex requirements.
 */
async function verifySubmission(assignmentId, userName) {
  const rows = await db.appQuery(
    'SELECT * FROM submissions WHERE assignmentID = ? AND userName = ?',
    [assignmentId, userName]
  );

  if (!rows || rows.length === 0) return null;

  let query = rows[0].query;
  let status = SubmissionStatus.Unprocessed;
  let message = '';

  // Everything after the first semicolon is ignored.
  const semicolonPos = query.indexOf(';');
  if (semicolonPos !== -1) {
    query = query.substring(0, semicolonPos);
  }

  query = query.replace(/\r?\n/g, ' ');

  if (query.includes('--')) {
    status = SubmissionStatus.Rejected;
    message = 'Comments not allowed in query text.';
  } else if (query.includes('/*')) {
    status = SubmissionStatus.Rejected;
    message = 'Comments not allowed in query text.';
  } else if (query.trim() === '') {
    status = SubmissionStatus.Rejected;
    message = 'No query submitted.';
  } else if (!ALLOWED_STATEMENT.test(query)) {
    status = SubmissionStatus.Rejected;
    message = 'Only SELECT statements are allowed.';
  } else {
    const assignment = await getAssignment(assignmentId);

    if (!assignment) {
      console.error(`Assignment ${assignmentId} not found during verification`);
      return null;
    }

    const schema = await getSchemaForAssignment(assignment);

    if (!schema) {
      console.error(`No connection/schema found for assignment ${assignmentId}`);
      return null;
    }

    const submissionResult = await assignment.executeQuery(schema, query);

    if (!submissionResult.isSuccessful()) {
      status = SubmissionStatus.Incorrect;
      message = submissionResult.getMessage();
    } else {
      const messageObj = { value: '' };
      const isCorrect = await assignment.isSimilarToAssignmentResult(
        schema,
        submissionResult,
        messageObj
      );
      message = messageObj.value;

      if (!isCorrect) {
        status = SubmissionStatus.Incorrect;
        message = 'Submission result and Assignment result are different. ' + message;
      } else {
        let isDenied = false;

        for (const regex of assignment.getRegexes()) {
          let regExpression;
          try {
            regExpression = new RegExp(regex.getExpression(), 'i');
          } catch (error) {
            console.error(
              `Invalid regex on assignment ${assignmentId}: ${regex.getExpression()}`,
              error.message
            );
            continue;
          }

          switch (regex.getType()) {
            case 1: // must occur
              if (!regExpression.test(query)) {
                message = regex.getDescription() + '. ' + message;
                isDenied = true;
              }
              break;
            case 2: // must not occur
              if (regExpression.test(query)) {
                message = regex.getDescription() + '. ' + message;
                isDenied = true;
              }
              break;
            default:
              console.error(`Unknown regex type ${regex.getType()} found.`);
              break;
          }
        }

        if (isDenied) {
          status = SubmissionStatus.Denied;
        } else {
          status = SubmissionStatus.Approved;
          message = 'Submission verified and approved.';
        }
      }
    }
  }

  await db.appQuery(
    'UPDATE submissions SET statusID = ?, message = ? WHERE assignmentID = ? AND userName = ?',
    [status, message.trim(), assignmentId, userName]
  );

  return getSubmission(assignmentId, userName);
}

module.exports = {
  getAssignment,
  getAssignmentViewModel,
  getSubmission,
  saveSubmission,
  verifySubmission
};
