// Run every reference query against its practice schema and report the ones
// that fail.
//
//   node scripts/verify-assignments.js
//
// A failing reference query means students can never get that assignment
// approved, so run this after loading the database and after any change to the
// practice data.

const { loadEnv } = require('./load-env');
loadEnv();

const db = require('../lib/db');

async function main() {
  console.log('Fetching assignments...');

  const assignments = await db.appQuery(
    'SELECT a.ID, a.title, a.meta_tag, a.query, c.`schema` AS schemaName ' +
      'FROM assignments a JOIN connections c ON c.ID = a.connectionID ' +
      'ORDER BY a.ID'
  );

  console.log(`Checking ${assignments.length} reference queries...\n`);

  const failures = [];
  let checked = 0;

  for (const assignment of assignments) {
    checked++;
    process.stdout.write(`\r  ${checked}/${assignments.length}`);

    let query = assignment.query;
    const semicolonPos = query.indexOf(';');
    if (semicolonPos !== -1) query = query.substring(0, semicolonPos);

    try {
      const rows = await db.studentQuery(assignment.schemaName, query);

      if (rows.length === 0) {
        failures.push({
          id: assignment.ID,
          title: assignment.title || assignment.meta_tag,
          schema: assignment.schemaName,
          reason: 'returns 0 rows'
        });
      }
    } catch (error) {
      failures.push({
        id: assignment.ID,
        title: assignment.title || assignment.meta_tag,
        schema: assignment.schemaName,
        reason: error.sqlMessage || error.message
      });
    }
  }

  process.stdout.write('\r');
  console.log(`Checked ${checked} assignments.\n`);

  if (failures.length === 0) {
    console.log('All reference queries run successfully.');
  } else {
    console.log(`${failures.length} assignment(s) need attention:\n`);
    for (const failure of failures) {
      console.log(`  [${failure.id}] ${failure.title || '(no title)'} (${failure.schema})`);
      console.log(`      ${failure.reason}`);
    }
    console.log(
      '\nNote: "returns 0 rows" is not always a problem - some assignments ' +
        'legitimately have an empty result.'
    );
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('\nVerification failed:', error);
  process.exit(1);
});
