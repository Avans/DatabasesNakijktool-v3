#!/usr/bin/env bash
#
# Check an instance end to end, deployed or local.
#
#   ./scripts/smoke-test.sh https://your-app.vercel.app 20105
#   ./scripts/smoke-test.sh http://localhost:3000 20105    # with npm run dev:local
#
# Submits a deliberately wrong query, so it leaves one throwaway submission
# behind for the test user "smoke-test-user".

set -euo pipefail

BASE_URL="${1:-}"
ASSIGNMENT_ID="${2:-}"
TEST_USER="smoke-test-user"

if [ -z "$BASE_URL" ] || [ -z "$ASSIGNMENT_ID" ]; then
  echo "Usage: $0 <base-url> <assignment-id>" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1" >&2; exit 1; }

echo "Testing $BASE_URL"
echo

echo "1. Health check"
health=$(curl -sS -w '\n%{http_code}' "$BASE_URL/api/health")
code=$(echo "$health" | tail -n1)
body=$(echo "$health" | sed '$d')
[ "$code" = "200" ] || fail "expected 200, got $code: $body"
pass "database reachable ($body)"

echo
echo "2. Fetch assignment $ASSIGNMENT_ID"
assignment=$(curl -sS -w '\n%{http_code}' "$BASE_URL/assignments/$ASSIGNMENT_ID")
code=$(echo "$assignment" | tail -n1)
body=$(echo "$assignment" | sed '$d')
[ "$code" = "200" ] || fail "expected 200, got $code: $body"
echo "$body" | grep -q '"title"' || fail "no title in response: $body"
pass "assignment returned"

echo
echo "3. Submit a wrong query (should come back as not approved)"
submission=$(curl -sS -w '\n%{http_code}' \
  -X POST "$BASE_URL/assignments/$ASSIGNMENT_ID/submissions" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_USER\",\"query\":\"SELECT 1\"}")
code=$(echo "$submission" | tail -n1)
body=$(echo "$submission" | sed '$d')
[ "$code" = "201" ] || fail "expected 201, got $code: $body"
echo "$body" | grep -q '"statusId"' || fail "no statusId in response: $body"
pass "submission checked: $body"

echo
echo "4. Reject a non-SELECT statement"
blocked=$(curl -sS \
  -X POST "$BASE_URL/assignments/$ASSIGNMENT_ID/submissions" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_USER\",\"query\":\"DROP TABLE assignments\"}")
echo "$blocked" | grep -q '"statusId":2' || fail "DROP was not rejected: $blocked"
pass "non-SELECT rejected"

echo
echo "5. Read the submission back"
readback=$(curl -sS -w '\n%{http_code}' \
  "$BASE_URL/assignments/$ASSIGNMENT_ID/submissions/$TEST_USER")
code=$(echo "$readback" | tail -n1)
[ "$code" = "200" ] || fail "expected 200, got $code"
pass "submission readable"

echo
echo "6. CORS headers present"
curl -sS -I -X OPTIONS "$BASE_URL/assignments/$ASSIGNMENT_ID" \
  | grep -qi 'access-control-allow-origin' || fail "no CORS header"
pass "CORS configured"

echo
echo "7. Component script served"
curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/datab1-component.js" \
  | grep -q '200' || fail "component not served"
pass "datab1-component.js served"

echo
echo "All checks passed."
echo "Clean up the test submission with:"
echo "  ./scripts/run-sql.sh -e \"DELETE FROM submissions WHERE userName='$TEST_USER'\""
