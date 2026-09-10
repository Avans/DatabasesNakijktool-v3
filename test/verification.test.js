// Exercise the verification logic with a stubbed database layer, so the rules a
// student's submission is judged by can be checked without a database.
//
//   node test/verification.test.js
const path = require('path');

const V3 = path.join(__dirname, '..');

// --- stub state -------------------------------------------------------------
const state = {
  assignments: [
    { ID: 1, query: 'SELECT naam FROM student', connectionID: 1, resultsHTML: '<table></table>',
      meta_tag: '1.1', title: 'Opdracht 1.1', description: 'Alle namen' }
  ],
  connections: [{ ID: 1, schema: 'fun4all' }],
  regexes: [],
  submissions: [],
  // what studentQuery returns per SQL text
  studentResults: {}
};

const dbStub = {
  APP_SCHEMA: 'databaas',
  async appQuery(sql, params = []) {
    if (/FROM assignments WHERE ID/.test(sql))
      return state.assignments.filter(a => a.ID === params[0]);
    if (/FROM regexes WHERE assignmentID/.test(sql))
      return state.regexes.filter(r => r.assignmentID === params[0]);
    if (/FROM connections WHERE ID/.test(sql))
      return state.connections.filter(c => c.ID === params[0]);
    if (/SELECT userName FROM submissions/.test(sql))
      return state.submissions.filter(s => s.assignmentID === params[0] && s.userName === params[1]);
    if (/SELECT \* FROM submissions/.test(sql))
      return state.submissions.filter(s => s.assignmentID === params[0] && s.userName === params[1]);
    if (/^INSERT INTO submissions/.test(sql)) {
      state.submissions.push({
        assignmentID: params[0], userName: params[1], query: params[2],
        statusID: params[3], message: null, timestamp: params[4]
      });
      return { affectedRows: 1 };
    }
    if (/^UPDATE submissions SET query/.test(sql)) {
      const s = state.submissions.find(x => x.assignmentID === params[3] && x.userName === params[4]);
      Object.assign(s, { query: params[0], statusID: params[1], message: null, timestamp: params[2] });
      return { affectedRows: 1 };
    }
    if (/^UPDATE submissions SET statusID/.test(sql)) {
      const s = state.submissions.find(x => x.assignmentID === params[2] && x.userName === params[3]);
      Object.assign(s, { statusID: params[0], message: params[1] });
      return { affectedRows: 1 };
    }
    throw new Error('Unhandled SQL in stub: ' + sql);
  },
  async studentQuery(schema, sql) {
    const key = sql.trim();
    if (!(key in state.studentResults)) {
      const err = new Error(`You have an error in your SQL syntax near '${key.slice(0, 20)}'`);
      err.sqlMessage = err.message;
      throw err;
    }
    return state.studentResults[key];
  },
  async ping() { return true; }
};

// Seed the module cache so every require of lib/db resolves to the stub.
const realDbPath = path.join(V3, 'lib', 'db.js');
require.cache[realDbPath] = {
  id: realDbPath,
  filename: realDbPath,
  loaded: true,
  exports: dbStub
};

const service = require(path.join(V3, 'lib', 'services', 'assignmentService.js'));

// --- test helpers -----------------------------------------------------------
let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
  ok ? passed++ : failed++;
}

async function submit(query, user = 'u1') {
  state.submissions = state.submissions.filter(s => s.userName !== user);
  await service.saveSubmission(1, user, query);
  return service.verifySubmission(1, user);
}

async function run() {
  const CORRECT = [{ naam: 'Ann' }, { naam: 'Bob' }];
  state.studentResults['SELECT naam FROM student'] = CORRECT;

  console.log('Status codes: 0=pending 1=approved 2=rejected 3=incorrect 4=denied\n');

  console.log('Basic verdicts:');
  let r = await submit('SELECT naam FROM student');
  check('correct query -> approved', r.statusId, 1);

  state.studentResults['SELECT naam FROM student LIMIT 1'] = [{ naam: 'Ann' }];
  r = await submit('SELECT naam FROM student LIMIT 1');
  check('too few rows -> incorrect', r.statusId, 3);
  check('  message mentions rows', /Too few rows/.test(r.message), true);

  state.studentResults['SELECT naam, id FROM student'] = [{ naam: 'Ann', id: 1 }, { naam: 'Bob', id: 2 }];
  r = await submit('SELECT naam, id FROM student');
  check('extra column -> incorrect', r.statusId, 3);
  check('  message mentions columns', /Too many columns/.test(r.message), true);

  state.studentResults['SELECT naam FROM leraar'] = [{ naam: 'Zoe' }, { naam: 'Yan' }];
  r = await submit('SELECT naam FROM leraar');
  check('wrong values -> incorrect', r.statusId, 3);
  check('  message names the column', /column 'naam' is different/.test(r.message), true);

  r = await submit('SELECT * FROM nonexistent');
  check('SQL error -> incorrect', r.statusId, 3);
  check('  message carries MySQL error', /error in your SQL syntax/.test(r.message), true);

  console.log('\nRejections:');
  r = await submit('SELECT naam FROM student -- cheat');
  check('-- comment -> rejected', r.statusId, 2);
  r = await submit('SELECT naam FROM student /* cheat */');
  check('/* comment -> rejected', r.statusId, 2);
  r = await submit('DROP TABLE student');
  check('DROP -> rejected', r.statusId, 2);
  r = await submit('DELETE FROM student');
  check('DELETE -> rejected', r.statusId, 2);
  r = await submit('UPDATE student SET naam = "x"');
  check('UPDATE -> rejected', r.statusId, 2);
  r = await submit('   ');
  check('empty -> rejected', r.statusId, 2);
  r = await submit('WITH x AS (SELECT 1) SELECT naam FROM student');
  check('WITH (CTE) is allowed through to checking', r.statusId !== 2, true);

  console.log('\nSemicolon truncation:');
  r = await submit('SELECT naam FROM student; DROP TABLE student');
  check('text after ; ignored -> approved', r.statusId, 1);

  console.log('\nRegex requirements:');
  state.regexes = [
    { assignmentID: 1, expression: 'JOIN', description: 'Gebruik een JOIN', type: 1 }
  ];
  r = await submit('SELECT naam FROM student');
  check('missing required JOIN -> denied', r.statusId, 4);
  check('  message is the description', /Gebruik een JOIN/.test(r.message), true);

  state.studentResults['SELECT naam FROM student JOIN klas ON 1=1'] = CORRECT;
  r = await submit('SELECT naam FROM student JOIN klas ON 1=1');
  check('required JOIN present -> approved', r.statusId, 1);

  state.regexes = [
    { assignmentID: 1, expression: 'WHERE', description: 'Geen WHERE gebruiken', type: 2 }
  ];
  state.studentResults['SELECT naam FROM student WHERE 1=1'] = CORRECT;
  r = await submit('SELECT naam FROM student WHERE 1=1');
  check('forbidden WHERE present -> denied', r.statusId, 4);

  state.regexes = [
    { assignmentID: 1, expression: '[invalid(regex', description: 'kapot', type: 1 }
  ];
  r = await submit('SELECT naam FROM student');
  check('invalid regex is skipped, not fatal', r.statusId, 1);
  state.regexes = [];

  console.log('\nToken handout:');
  r = await submit('SELECT naam FROM student');
  check('approved submission gets a token', typeof r.assignmentToken === 'string' && r.assignmentToken.length === 64, true);
  r = await submit('SELECT naam FROM leraar');
  check('incorrect submission gets no token', r.assignmentToken, null);

  console.log('\nResubmission:');
  await submit('SELECT naam FROM leraar', 'u2');
  const second = await service.saveSubmission(1, 'u2', 'SELECT naam FROM student')
    .then(() => service.verifySubmission(1, 'u2'));
  check('resubmit overwrites and re-checks', second.statusId, 1);
  check('  still one row per user+assignment', state.submissions.filter(s => s.userName === 'u2').length, 1);

  console.log('\nRead-back:');
  const fetched = await service.getSubmission(1, 'u2');
  check('getSubmission returns the stored query', fetched.query, 'SELECT naam FROM student');
  const missing = await service.getSubmission(1, 'nobody');
  check('unknown user -> null', missing, null);

  const vm = await service.getAssignmentViewModel(1);
  check('assignment view model has title', vm.title, 'Opdracht 1.1');
  check('assignment view model has expectedOutput', vm.expectedOutput, '<table></table>');
  check('unknown assignment -> null', await service.getAssignmentViewModel(999), null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
