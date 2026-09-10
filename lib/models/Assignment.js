// Model for an assignment: the reference query plus everything shown to
// the student.
const db = require('../db');
const QueryResult = require('./QueryResult');

class Assignment {
  constructor(data) {
    this.id = data.id;
    this.resultsHTML = data.results_html;
    this.description = data.description;
    this.metaTag = data.meta_tag;
    this.title = data.title;
    this.connectionId = data.connectionId;
    this.query = data.query;
    this.regexes = data.regexes || [];
  }

  static fromDb(row) {
    return new Assignment({
      id: row.ID,
      results_html: row.resultsHTML,
      description: row.description,
      meta_tag: row.meta_tag,
      title: row.title,
      connectionId: row.connectionID,
      query: row.query
    });
  }

  /**
   * The public shape of an assignment, matching v2 field for field.
   *
   * connectionId stays off it on purpose: it says which practice database the
   * assignment runs against, nothing outside this service needs it, and v2
   * never sent it.
   */
  toViewModel() {
    return {
      assignmentId: this.id,
      expectedOutput: this.resultsHTML,
      description: this.description,
      title: this.title || `Opdracht ${this.metaTag}`
    };
  }

  setRegexes(regexes) {
    this.regexes = regexes;
  }

  getRegexes() {
    return this.regexes;
  }

  /** Run a query against a practice schema, never throwing. */
  async executeQuery(schema, query) {
    try {
      const results = await db.studentQuery(schema, query);
      return QueryResult.fromMySqlResults(results);
    } catch (error) {
      return new QueryResult([], false, error.sqlMessage || error.message);
    }
  }

  /**
   * Compare a submission result against the result of the reference query.
   * Differences are appended to `message.value`.
   */
  async isSimilarToAssignmentResult(schema, submissionResult, message) {
    try {
      const assignmentResult = await this.executeQuery(schema, this.query);

      if (!assignmentResult.isSuccessful()) {
        console.error(
          `Reference query of assignment ${this.id} failed:`,
          assignmentResult.getMessage()
        );
        message.value = 'The assignment could not be checked right now. ' + message.value;
        return false;
      }

      let similar = true;

      if (submissionResult.getRowCount() < assignmentResult.getRowCount()) {
        message.value = 'Too few rows. ' + message.value;
        similar = false;
      } else if (submissionResult.getRowCount() > assignmentResult.getRowCount()) {
        message.value = 'Too many rows. ' + message.value;
        similar = false;
      }

      if (submissionResult.getColumnCount() < assignmentResult.getColumnCount()) {
        message.value = 'Too few columns. ' + message.value;
        similar = false;
      } else if (submissionResult.getColumnCount() > assignmentResult.getColumnCount()) {
        message.value = 'Too many columns. ' + message.value;
        similar = false;
      }

      if (!similar) return similar;

      for (let rowNr = 0; rowNr < assignmentResult.getRowCount(); rowNr++) {
        const rowSubmission = submissionResult.getRow(rowNr);
        const rowAssignment = assignmentResult.getRow(rowNr);

        if (!rowSubmission || !rowAssignment) break;

        for (const columnName of Object.keys(rowAssignment)) {
          const submissionValue = rowSubmission[columnName];
          const assignmentValue = rowAssignment[columnName];

          const inconsistent =
            (submissionValue === undefined) ||
            (submissionValue === null && assignmentValue !== null) ||
            (submissionValue !== null && assignmentValue === null) ||
            (submissionValue !== null &&
              assignmentValue !== null &&
              String(submissionValue) !== String(assignmentValue));

          if (inconsistent) {
            message.value +=
              `The value of row number ${rowNr + 1}, column '${columnName}' is different ` +
              'between submission and assignment results. ';
            similar = false;
          }
        }
      }

      return similar;
    } catch (error) {
      console.error('Error comparing results:', error);
      message.value = 'Error comparing results: ' + error.message;
      return false;
    }
  }
}

module.exports = Assignment;
