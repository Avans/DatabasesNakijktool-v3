// A syntax requirement attached to an assignment.
// Type 1: the expression must occur in the query.
// Type 2: the expression must NOT occur in the query.
class AssignmentRegex {
  constructor(data) {
    this.assignmentId = data.assignmentId;
    this.expression = data.expression;
    this.description = data.description;
    this.type = data.type;
  }

  static fromDb(row) {
    return new AssignmentRegex({
      assignmentId: row.assignmentID,
      expression: row.expression,
      description: row.description,
      type: row.type
    });
  }

  getExpression() {
    return this.expression;
  }

  getDescription() {
    return this.description;
  }

  getType() {
    return this.type;
  }
}

module.exports = AssignmentRegex;
