#!/usr/bin/env bash
#
# Load the v2 dumps into the Aiven MySQL service.
#
# Reads the connection details from v3/.env. Run once when setting up, and again
# whenever you want to reset the practice databases to their original state.
#
#   cd v3 && ./scripts/load-database.sh
#
# Requires the `mysql` client:
#   macOS:   brew install mysql-client
#   Ubuntu:  sudo apt install mysql-client

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V3_DIR="$(dirname "$SCRIPT_DIR")"
DUMP_DIR="$(dirname "$V3_DIR")/sqlinit"
SQL_DIR="$V3_DIR/sql"

if [ -f "$V3_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$V3_DIR/.env"
  set +a
else
  echo "ERROR: $V3_DIR/.env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

for var in DB_HOST DB_PORT DB_USER DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in .env" >&2
    exit 1
  fi
done

if ! command -v mysql >/dev/null 2>&1; then
  echo "ERROR: the 'mysql' client is not installed or not on PATH." >&2
  echo "  macOS:  brew install mysql-client" >&2
  exit 1
fi

# Aiven requires TLS. Verify the chain when the CA certificate is available.
CA_FILE=""
SSL_ARGS=(--ssl-mode=REQUIRED)

if [ -n "${DB_SSL_CA:-}" ]; then
  CA_FILE="$(mktemp)"
  # The env var may hold literal \n instead of real newlines.
  printf '%b\n' "$DB_SSL_CA" > "$CA_FILE"
  SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$CA_FILE")
elif [ -f "$V3_DIR/ca.pem" ]; then
  CA_FILE="$V3_DIR/ca.pem"
  SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$CA_FILE")
fi

cleanup() {
  # Only remove the certificate when this script created it.
  if [ -n "$CA_FILE" ] && [ "$CA_FILE" != "$V3_DIR/ca.pem" ]; then
    rm -f "$CA_FILE"
  fi
}
trap cleanup EXIT

run_mysql() {
  mysql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --user="$DB_USER" \
    --password="$DB_PASSWORD" \
    "${SSL_ARGS[@]}" \
    --default-character-set=utf8mb4 \
    "$@"
}

# The v2 dumps come from a MySQL 5.7 server and carry DEFINER clauses pointing at
# accounts that do not exist on Aiven. Setting another DEFINER needs SUPER, which
# a managed service does not hand out, so strip them.
load_dump() {
  local file="$1"
  local name
  name="$(basename "$file")"

  if [ ! -f "$file" ]; then
    echo "  SKIP  $name (not found)"
    return
  fi

  printf '  LOAD  %-45s' "$name"
  sed -E \
    -e 's/DEFINER=`[^`]*`@`[^`]*`//g' \
    -e 's/SQL SECURITY DEFINER/SQL SECURITY INVOKER/g' \
    "$file" | run_mysql
  echo "ok"
}

echo "Connecting to $DB_HOST:$DB_PORT as $DB_USER"
if ! run_mysql -e "SELECT VERSION()" >/dev/null 2>&1; then
  echo "ERROR: could not connect. Check the credentials in .env, and make sure the" >&2
  echo "       Aiven service is running (a powered-off service must be started once" >&2
  echo "       from the Aiven console)." >&2
  exit 1
fi
echo "Connection ok: $(run_mysql -N -B -e 'SELECT VERSION()')"
echo

echo "Creating databases..."
# Aiven's avnadmin can normally create databases. If this is refused, create the
# eight databases listed below in the Aiven console (Databases tab) and re-run.
if ! run_mysql < "$DUMP_DIR/001_databases_create.sql" 2>/dev/null; then
  echo "  WARNING: CREATE DATABASE was refused." >&2
  echo "  Create these databases in the Aiven console, then run this script again:" >&2
  echo "    databaas fun4all muziekscholen outerspace studentactiviteiten" >&2
  echo "    muziekstukken ruimtereis employees" >&2
  exit 1
fi
echo "  ok"
echo

# Order matters: tables referenced by a foreign key are loaded first.
echo "Loading the databaas schema (assignments, regexes, bookkeeping)..."
load_dump "$DUMP_DIR/003_databaas_connections.sql"
load_dump "$DUMP_DIR/004_databaas_regex_types.sql"
load_dump "$DUMP_DIR/009_databaas_submission_status.sql"
load_dump "$DUMP_DIR/002_databaas_assignments.sql"
load_dump "$DUMP_DIR/005_databaas_regexes.sql"
load_dump "$DUMP_DIR/007_databaas_studentnrs.sql"
load_dump "$DUMP_DIR/010_databaas_routines.sql"

echo
echo "Creating an empty submissions table..."
load_dump "$SQL_DIR/01-submissions-schema.sql"

echo
echo "Loading the practice databases..."
for schema in fun4all muziekscholen outerspace studentactiviteiten muziekstukken ruimtereis employees; do
  echo "  $schema:"
  for file in "$DUMP_DIR/${schema}_"*.sql; do
    [ -e "$file" ] || continue
    printf '  '
    load_dump "$file"
  done
done

echo
echo "Verifying..."
run_mysql -N -B databaas -e "
  SELECT CONCAT('  assignments: ', COUNT(*)) FROM assignments;
  SELECT CONCAT('  regexes:     ', COUNT(*)) FROM regexes;
  SELECT CONCAT('  connections: ', COUNT(*)) FROM connections;
  SELECT CONCAT('  submissions: ', COUNT(*)) FROM submissions;
"

echo
echo "Done."
echo
echo "Next steps:"
echo "  1. Set a password in sql/02-student-user.sql and load it:"
echo "       ./scripts/run-sql.sh sql/02-student-user.sql"
echo "  2. Check the reference queries:"
echo "       node scripts/verify-assignments.js"
