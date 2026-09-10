#!/usr/bin/env bash
#
# Run a single SQL file (or an inline statement) against the Aiven service using
# the credentials from .env.
#
#   ./scripts/run-sql.sh sql/02-student-user.sql
#   ./scripts/run-sql.sh -e "SELECT COUNT(*) FROM databaas.submissions"
#
# In a SQL file, ${VAR} is replaced with that variable from .env, so secrets
# such as the student account password stay out of the tracked SQL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V3_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$V3_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$V3_DIR/.env"
  set +a
else
  echo "ERROR: $V3_DIR/.env not found." >&2
  exit 1
fi

CA_FILE=""
SSL_ARGS=(--ssl-mode=REQUIRED)

if [ -n "${DB_SSL_CA:-}" ]; then
  CA_FILE="$(mktemp)"
  printf '%b\n' "$DB_SSL_CA" > "$CA_FILE"
  SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$CA_FILE")
elif [ -f "$V3_DIR/ca.pem" ]; then
  SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$V3_DIR/ca.pem")
fi

cleanup() {
  if [ -n "$CA_FILE" ]; then rm -f "$CA_FILE"; fi
}
trap cleanup EXIT

# SQL files may carry ${VAR} placeholders, filled from .env at run time. That
# keeps secrets - the student account password above all - out of the tracked
# SQL, which would otherwise hold them in plain text.
expand_placeholders() {
  local file="$1"
  local content name value token
  content="$(cat "$file")"

  for token in $(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$file" | sort -u); do
    name="${token:2:${#token}-3}"
    value="${!name:-}"

    if [ -z "$value" ]; then
      echo "ERROR: $(basename "$file") uses \${$name}, but $name is empty or unset in .env" >&2
      exit 1
    fi

    # A single quote would otherwise end the SQL string literal early.
    value="${value//\'/\'\'}"
    # The replacement half stays unquoted on purpose: bash 3.2, which is what
    # macOS ships, copies the quote characters into the result instead of
    # treating them as syntax.
    content="${content//"$token"/$value}"
  done

  printf '%s\n' "$content"
}

mysql_cmd=(
  mysql
  --host="$DB_HOST"
  --port="$DB_PORT"
  --user="$DB_USER"
  --password="$DB_PASSWORD"
  "${SSL_ARGS[@]}"
  --default-character-set=utf8mb4
)

if [ $# -eq 0 ]; then
  echo "Usage: $0 <file.sql> | -e \"<statement>\"" >&2
  exit 1
fi

if [ "$1" = "-e" ]; then
  "${mysql_cmd[@]}" "${DB_NAME:-databaas}" -e "$2"
else
  file="$1"
  [ -f "$file" ] || file="$V3_DIR/$1"

  if [ ! -f "$file" ]; then
    echo "ERROR: file not found: $1" >&2
    exit 1
  fi

  expand_placeholders "$file" | "${mysql_cmd[@]}"
  echo "Loaded $(basename "$file")"
fi
