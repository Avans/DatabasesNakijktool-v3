// Result set of a single query, used to compare a submission against the
// reference answer of an assignment.
class QueryResult {
  constructor(rows = [], success = true, message = '') {
    this.rows = rows;
    this.success = success;
    this.message = message;
  }

  getRow(rowIndex) {
    if (rowIndex >= this.rows.length) return null;
    return this.rows[rowIndex];
  }

  getMessage() {
    return this.message;
  }

  isSuccessful() {
    return this.success;
  }

  getRowCount() {
    return this.rows.length;
  }

  getColumnCount() {
    if (this.rows.length === 0) return 0;
    return Object.keys(this.rows[0]).length;
  }

  static fromMySqlResults(results) {
    if (!results || results.length === 0) {
      return new QueryResult([], true, '');
    }
    return new QueryResult([...results], true, '');
  }

  makeHTML() {
    let html = '<html><body><table border="1">';

    if (this.getRowCount() > 0) {
      html += '<tr>';
      for (const columnName of Object.keys(this.getRow(0))) {
        html += `<td bgcolor="Thistle" class="medium">${columnName}</td>`;
      }
      html += '</tr>';

      for (let r = 0; r < this.getRowCount(); r++) {
        const row = this.getRow(r);
        html += '<tr>';
        for (const columnName of Object.keys(row)) {
          const value = row[columnName];
          if (value === null) {
            html += '<td bgcolor="Gainsboro" class="normal" valign="top"><i>NULL</i></td>';
          } else {
            html += `<td class="normal" valign="top">${value}</td>`;
          }
        }
        html += '</tr>';
      }
    }

    html += '</table></body></html>';
    return html;
  }
}

module.exports = QueryResult;
