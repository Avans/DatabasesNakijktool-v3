// Model for a student submission.
const SubmissionStatus = {
  Unprocessed: 0,
  Approved: 1,
  Rejected: 2,
  Incorrect: 3,
  Denied: 4,
  ManuallyApproved: 5
};

class Submission {
  constructor(data) {
    this.assignmentId = data.assignmentId;
    this.userName = data.userName;
    this.query = data.query;
    this.statusId = data.statusId || 0;
    this.message = data.message || null;
    this.timestamp = data.timestamp || new Date();
  }

  static fromDb(row) {
    return new Submission({
      assignmentId: row.assignmentID,
      userName: row.userName,
      query: row.query,
      statusId: row.statusID,
      message: row.message,
      timestamp: row.timestamp
    });
  }

  toViewModel(assignmentToken = null) {
    return {
      assignmentId: this.assignmentId,
      email: this.userName,
      query: this.query,
      statusId: this.statusId,
      message: this.message,
      timestamp: this.timestamp,
      assignmentToken: assignmentToken
    };
  }
}

module.exports = Submission;
module.exports.SubmissionStatus = SubmissionStatus;
