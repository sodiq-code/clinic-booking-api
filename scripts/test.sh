#!/usr/bin/env bash
# scripts/test.sh — end-to-end verification of all 5 levels of the
# Clinic Booking API. Run with: bash scripts/test.sh
#
# Assumes the dev server is running on http://localhost:3001 and .env has
# API_KEY="test-key-123".
set -u

BASE="${BASE:-http://localhost:3001}"
API_KEY="${API_KEY:-test-key-123}"
BODY=/tmp/cb_body
export API_KEY

PASS=0
FAIL=0
section() { echo; echo "════════════════════════════════════════════════════════════"; echo "  $1"; echo "════════════════════════════════════════════════════════════"; }
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# JSON field extractor (id / status / error / available / next_cursor).
# Uses python3 if available, otherwise grep.
extract() {
  local field="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; d=json.load(open('$BODY')); print(d.get('$field','') if not isinstance(d.get('$field'),bool) else str(d.get('$field')).lower())" 2>/dev/null
  else
    grep -o "\"$field\":\"[^\"]*\"" "$BODY" 2>/dev/null | head -1 | sed "s/\"$field\":\"//;s/\"$//"
  fi
}
extract_bool() {
  local field="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json; d=json.load(open('$BODY')); print(str(d.get('$field')).lower())" 2>/dev/null
  else
    grep -o "\"$field\":\(true\|false\)" "$BODY" 2>/dev/null | head -1 | sed "s/\"$field\"://"
  fi
}

# req METHOD PATH [DATA] [EXTRA_HEADER]
req() {
  local method="$1" path="$2" data="${3:-}" extra="${4:-}"
  local args=(-s -o "$BODY" -w "%{http_code}" -X "$method" "$BASE$path" -H "X-API-Key: $API_KEY")
  [ -n "$extra" ] && args+=(-H "$extra")
  [ -n "$data" ] && args+=(--data "$data")
  curl "${args[@]}"
}
# reqn METHOD PATH [DATA]  — no api key (for 401 tests)
reqn() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-s -o "$BODY" -w "%{http_code}" -X "$method" "$BASE$path")
  [ -n "$data" ] && args+=(--data "$data")
  curl "${args[@]}"
}

echo "Clinic Booking API — end-to-end verification"
echo "BASE=$BASE  API_KEY=$API_KEY"

# Future ISO timestamps for slot fixtures.
FUTURE_ISO="$(python3 -c "import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))" 2>/dev/null || date -u -d '+2 days' '+%Y-%m-%dT%H:%M:%S.000Z')"
PAST_ISO="$(python3 -c "import datetime; print((datetime.datetime.utcnow()-datetime.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))" 2>/dev/null || date -u -d '-1 day' '+%Y-%m-%dT%H:%M:%S.000Z')"
FAR_ISO="$(python3 -c "import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(days=10)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))" 2>/dev/null || date -u -d '+10 days' '+%Y-%m-%dT%H:%M:%S.000Z')"

# ─────────────────────────────────────────────────────────────────────────────
section "LEVEL 1 — reset / list slots / book / get booking"

SLOTS_JSON="{\"slots\":[
  {\"id\":\"l1-a\",\"provider\":\"Dr. Alice\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"l1-b\",\"provider\":\"Dr. Bob\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"}
]}"
st=$(req POST /reset "$SLOTS_JSON")
[ "$st" = "200" ] && ok "POST /reset -> 200" || bad "POST /reset -> 200 (got $st)"

st=$(req GET /slots)
if [ "$st" = "200" ]; then
  cnt=$(python3 -c "import json; print(len(json.load(open('$BODY'))['slots']))" 2>/dev/null || echo 0)
  [ "$cnt" = "2" ] && ok "GET /slots -> 200, 2 slots" || bad "GET /slots -> 2 slots (got $cnt)"
else
  bad "GET /slots -> 200 (got $st)"
fi

# availability flag present (on the first slot)
st=$(req GET /slots)
av=$(python3 -c "import json; s=json.load(open('$BODY'))['slots']; print(str(s[0]['available']).lower() if s else 'none')" 2>/dev/null)
[ "$av" = "true" ] && ok "slots carry available=true when free" || bad "available flag (got '$av')"

# book a slot
st=$(req POST /bookings '{"slot_id":"l1-a","name":" Alice ","email":"Alice@TEST.com"}')
if [ "$st" = "201" ]; then
  ok "POST /bookings -> 201"
  bid=$(extract id)
  em=$(extract email)
  nm=$(extract name)
  [ "$em" = "alice@test.com" ] && ok "email lowercased (got '$em')" || bad "email lowercased (got '$em')"
  [ "$nm" = "Alice" ] && ok "name trimmed (got '$nm')" || bad "name trimmed (got '$nm')"
  [ -n "$bid" ] && ok "booking id returned ($bid)" || bad "booking id returned"
else
  bad "POST /bookings -> 201 (got $st)"
  bid=""
fi

# get the booking
if [ -n "$bid" ]; then
  st=$(req GET "/bookings/$bid")
  [ "$st" = "200" ] && ok "GET /bookings/{id} -> 200" || bad "GET /bookings/{id} -> 200 (got $st)"
fi

# 404 for unknown booking
st=$(req GET "/bookings/does-not-exist")
[ "$st" = "404" ] && ok "GET /bookings/{unknown} -> 404" || bad "GET /bookings/{unknown} -> 404 (got $st)"

# availability now false for l1-a (it has a confirmed booking)
st=$(req GET /slots)
av=$(python3 -c "import json; s=[x for x in json.load(open('$BODY'))['slots'] if x['id']=='l1-a'][0]; print(str(s['available']).lower())" 2>/dev/null)
[ "$av" = "false" ] && ok "slot l1-a available=false after booking" || bad "slot available=false after booking (got '$av')"

# ─────────────────────────────────────────────────────────────────────────────
section "LEVEL 2 — auth + validation"

# reset to a clean, predictable state
req POST /reset "$SLOTS_JSON" >/dev/null

# 401 without api key
st=$(reqn POST /bookings '{"slot_id":"l1-a","name":"x","email":"x@y.com"}')
[ "$st" = "401" ] && ok "POST /bookings without X-API-Key -> 401" || bad "no key -> 401 (got $st)"

# 401 with wrong key
st=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "$BASE/bookings" -H "X-API-Key: wrong-key" --data '{"slot_id":"l1-a","name":"x","email":"x@y.com"}')
[ "$st" = "401" ] && ok "POST /bookings wrong key -> 401" || bad "wrong key -> 401 (got $st)"

# 401 on /slots without key
st=$(reqn GET /slots)
[ "$st" = "401" ] && ok "GET /slots without key -> 401" || bad "GET /slots no key -> 401 (got $st)"

# missing slot_id
st=$(req POST /bookings '{"name":"x","email":"x@y.com"}')
[ "$st" = "400" ] && ok "missing slot_id -> 400" || bad "missing slot_id -> 400 (got $st)"
# missing name
st=$(req POST /bookings '{"slot_id":"l1-a","email":"x@y.com"}')
[ "$st" = "400" ] && ok "missing name -> 400" || bad "missing name -> 400 (got $st)"
# missing email
st=$(req POST /bookings '{"slot_id":"l1-a","name":"x"}')
[ "$st" = "400" ] && ok "missing email -> 400" || bad "missing email -> 400 (got $st)"
# empty fields (after trim)
st=$(req POST /bookings '{"slot_id":"l1-a","name":"   ","email":"x@y.com"}')
[ "$st" = "400" ] && ok "blank name -> 400" || bad "blank name -> 400 (got $st)"
# invalid email
st=$(req POST /bookings '{"slot_id":"l1-a","name":"x","email":"not-an-email"}')
[ "$st" = "400" ] && ok "invalid email -> 400" || bad "invalid email -> 400 (got $st)"
# nonexistent slot
st=$(req POST /bookings '{"slot_id":"nope","name":"x","email":"x@y.com"}')
[ "$st" = "404" ] && ok "nonexistent slot -> 404" || bad "nonexistent slot -> 404 (got $st)"

# slot already started (past slot)
PAST_SLOTS="{\"slots\":[{\"id\":\"past1\",\"provider\":\"Dr. Alice\",\"start\":\"$PAST_ISO\",\"end\":\"$PAST_ISO\"}]}"
req POST /reset "$PAST_SLOTS" >/dev/null
st=$(req POST /bookings '{"slot_id":"past1","name":"x","email":"x@y.com"}')
[ "$st" = "400" ] && ok "past slot -> 400 (already started)" || bad "past slot -> 400 (got $st)"

# ─────────────────────────────────────────────────────────────────────────────
section "LEVEL 3 — concurrency-safe booking + cancel"

# one future slot, 20 concurrent bookings for it (distinct emails)
CONC_SLOTS="{\"slots\":[{\"id\":\"conc\",\"provider\":\"Dr. Concurrency\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"}]}"
req POST /reset "$CONC_SLOTS" >/dev/null

rm -f /tmp/cb_c_*
for i in $(seq 1 20); do
  ( curl -s -o /tmp/cb_c_body_$i -w "%{http_code}" -X POST "$BASE/bookings" \
      -H "X-API-Key: $API_KEY" \
      --data "{\"slot_id\":\"conc\",\"name\":\"U$i\",\"email\":\"conc$i@test.com\"}" \
      > /tmp/cb_c_st_$i ) &
done
wait

s201=0; s409=0; sother=0
for i in $(seq 1 20); do
  st=$(cat /tmp/cb_c_st_$i)
  case "$st" in
    201) s201=$((s201+1));;
    409) s409=$((s409+1));;
    *)   sother=$((sother+1)); echo "    [concurrency] unexpected status $st for request $i";;
  esac
done
echo "    concurrency: 201=$s201  409=$s409  other=$sother"
[ "$s201" = "1" ] && ok "exactly ONE 201 under 20 concurrent bookings" || bad "expected 1 success, got $s201"
[ "$s409" = "19" ] && ok "the other 19 got 409" || bad "expected 19 conflicts, got $s409"
[ "$sother" = "0" ] && ok "no unexpected statuses" || bad "unexpected statuses present"

# sequential double-book -> 409
req POST /reset "$CONC_SLOTS" >/dev/null
st=$(req POST /bookings '{"slot_id":"conc","name":"First","email":"first@test.com"}')
[ "$st" = "201" ] && ok "first sequential book -> 201" || bad "first book -> 201 (got $st)"
first_bid=$(extract id)
st=$(req POST /bookings '{"slot_id":"conc","name":"Second","email":"second@test.com"}')
[ "$st" = "409" ] && ok "second sequential book same slot -> 409" || bad "second book -> 409 (got $st)"

# cancel + rebook
if [ -n "$first_bid" ]; then
  st=$(req DELETE "/bookings/$first_bid")
  [ "$st" = "200" ] && ok "DELETE booking -> 200" || bad "DELETE -> 200 (got $st)"
  cst=$(extract status)
  [ "$cst" = "cancelled" ] && ok "cancelled booking status=cancelled" || bad "status=cancelled (got '$cst')"
  # slot available again
  st=$(req GET /slots)
  av=$(python3 -c "import json; s=[x for x in json.load(open('$BODY'))['slots'] if x['id']=='conc'][0]; print(str(s['available']).lower())" 2>/dev/null)
  [ "$av" = "true" ] && ok "slot available again after cancel" || bad "slot available after cancel (got '$av')"
  # delete again -> 409
  st=$(req DELETE "/bookings/$first_bid")
  [ "$st" = "409" ] && ok "DELETE already-cancelled -> 409" || bad "DELETE twice -> 409 (got $st)"
  # rebook the freed slot (fresh email to avoid rate limit)
  st=$(req POST /bookings '{"slot_id":"conc","name":"Rebook","email":"rebook@test.com"}')
  [ "$st" = "201" ] && ok "rebook freed slot -> 201" || bad "rebook -> 201 (got $st)"
fi
# 404 deleting unknown
st=$(req DELETE "/bookings/does-not-exist")
[ "$st" = "404" ] && ok "DELETE unknown -> 404" || bad "DELETE unknown -> 404 (got $st)"

# ─────────────────────────────────────────────────────────────────────────────
section "LEVEL 4 — idempotency + cursor pagination"

# Setup: one slot for idempotency + 5 slots for pagination (same email).
L4_SLOTS="{\"slots\":[
  {\"id\":\"idem-a\",\"provider\":\"Dr. Idem\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"pg-1\",\"provider\":\"Dr. Page\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"pg-2\",\"provider\":\"Dr. Page\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"pg-3\",\"provider\":\"Dr. Page\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"pg-4\",\"provider\":\"Dr. Page\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"},
  {\"id\":\"pg-5\",\"provider\":\"Dr. Page\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"}
]}"
req POST /reset "$L4_SLOTS" >/dev/null

# Idempotency: same key + same body -> same booking id; different body -> 422.
B1='{"slot_id":"idem-a","name":"Idem","email":"idem@test.com"}'
st=$(req POST /bookings "$B1" "Idempotency-Key: K1")
[ "$st" = "201" ] && ok "POST K1+B1 -> 201" || bad "POST K1+B1 -> 201 (got $st)"
k1_bid=$(extract id)

st=$(req POST /bookings "$B1" "Idempotency-Key: K1")
[ "$st" = "201" ] && ok "POST K1+B1 again -> 201" || bad "POST K1+B1 again -> 201 (got $st)"
k1_bid2=$(extract id)
[ "$k1_bid" = "$k1_bid2" ] && [ -n "$k1_bid" ] && ok "same booking id ($k1_bid) on retry" || bad "same booking id (got '$k1_bid' vs '$k1_bid2')"

# different body, same key -> 422
B2='{"slot_id":"idem-a","name":"Other","email":"idem@test.com"}'
st=$(req POST /bookings "$B2" "Idempotency-Key: K1")
[ "$st" = "422" ] && ok "POST K1+different body -> 422" || bad "K1 different body -> 422 (got $st)"

# only ONE booking should exist for the idem slot
st=$(req GET /slots)
idem_booked=$(python3 -c "import json; s=[x for x in json.load(open('$BODY'))['slots'] if x['id']=='idem-a'][0]; print(str(s['available']).lower())" 2>/dev/null)
[ "$idem_booked" = "false" ] && ok "idempotency did not create a second booking" || bad "idem slot still available?! (got '$idem_booked')"

# Pagination: 5 bookings for page@test.com (5 distinct slots -> under 5? exactly 5, ok).
for s in pg-1 pg-2 pg-3 pg-4 pg-5; do
  req POST /bookings "{\"slot_id\":\"$s\",\"name\":\"Pager\",\"email\":\"page@test.com\"}" >/dev/null
done

# page 1, limit=2
st=$(req GET "/bookings?email=page@test.com&limit=2")
[ "$st" = "200" ] && ok "GET /bookings limit=2 -> 200" || bad "GET /bookings limit=2 -> 200 (got $st)"
page1_count=$(python3 -c "import json; print(len(json.load(open('$BODY'))['bookings']))" 2>/dev/null)
nextc=$(python3 -c "import json; print(json.load(open('$BODY'))['next_cursor'] or '')" 2>/dev/null)
[ "$page1_count" = "2" ] && ok "page 1 has 2 bookings" || bad "page 1 has 2 (got $page1_count)"
[ -n "$nextc" ] && ok "page 1 has next_cursor" || bad "page 1 next_cursor missing"

# page 2 using cursor
st=$(req GET "/bookings?email=page@test.com&limit=2&cursor=$nextc")
[ "$st" = "200" ] || bad "GET /bookings page 2 -> 200 (got $st)"
page2_count=$(python3 -c "import json; print(len(json.load(open('$BODY'))['bookings']))" 2>/dev/null)
nextc2=$(python3 -c "import json; print(json.load(open('$BODY'))['next_cursor'] or '')" 2>/dev/null)
[ "$page2_count" = "2" ] && ok "page 2 has 2 bookings" || bad "page 2 has 2 (got $page2_count)"
[ -n "$nextc2" ] && ok "page 2 has next_cursor" || bad "page 2 next_cursor missing"

# page 3 (last) -> 1 booking, next_cursor null
st=$(req GET "/bookings?email=page@test.com&limit=2&cursor=$nextc2")
[ "$st" = "200" ] || bad "GET /bookings page 3 -> 200 (got $st)"
page3_count=$(python3 -c "import json; print(len(json.load(open('$BODY'))['bookings']))" 2>/dev/null)
nextc3=$(python3 -c "import json; print(json.load(open('$BODY'))['next_cursor'] or '')" 2>/dev/null)
[ "$page3_count" = "1" ] && ok "page 3 (last) has 1 booking" || bad "page 3 has 1 (got $page3_count)"
[ -z "$nextc3" ] && ok "last page next_cursor=null" || bad "last page next_cursor should be null (got '$nextc3')"

# email match ignores case
st=$(req GET "/bookings?email=PAGE@TEST.COM&limit=1")
ic=$(python3 -c "import json; print(len(json.load(open('$BODY'))['bookings']))" 2>/dev/null)
[ "$ic" = "1" ] && ok "email match ignores case" || bad "email case-insensitive (got $ic)"

# invalid limits -> 400
st=$(req GET "/bookings?email=page@test.com&limit=0")
[ "$st" = "400" ] && ok "limit=0 -> 400" || bad "limit=0 -> 400 (got $st)"
st=$(req GET "/bookings?email=page@test.com&limit=51")
[ "$st" = "400" ] && ok "limit=51 -> 400" || bad "limit=51 -> 400 (got $st)"
st=$(req GET "/bookings?email=page@test.com&limit=abc")
[ "$st" = "400" ] && ok "limit=abc -> 400" || bad "limit=abc -> 400 (got $st)"
# missing email -> 400
st=$(req GET "/bookings?limit=5")
[ "$st" = "400" ] && ok "missing email -> 400" || bad "missing email -> 400 (got $st)"

# ─────────────────────────────────────────────────────────────────────────────
section "LEVEL 5 — per-email rate limiting (5/min, Retry-After)"

# 6 future slots for the same email; 5 succeed, 6th -> 429.
L5_SLOTS="{\"slots\":["
for i in 1 2 3 4 5 6; do
  [ "$i" != "1" ] && L5_SLOTS+=","
  L5_SLOTS+="{\"id\":\"rl-$i\",\"provider\":\"Dr. Rate\",\"start\":\"$FUTURE_ISO\",\"end\":\"$FAR_ISO\"}"
done
L5_SLOTS+="]}"
req POST /reset "$L5_SLOTS" >/dev/null

rl_ok=0; rl_fail=0
for i in 1 2 3 4 5; do
  st=$(req POST /bookings "{\"slot_id\":\"rl-$i\",\"name\":\"Rate\",\"email\":\"rate@test.com\"}")
  [ "$st" = "201" ] && rl_ok=$((rl_ok+1)) || rl_fail=$((rl_fail+1))
done
[ "$rl_ok" = "5" ] && ok "first 5 attempts for rate@test.com -> 201" || bad "first 5 -> 201 (ok=$rl_ok fail=$rl_fail)"

# 6th -> 429 with Retry-After header
hdr_out=/tmp/cb_hdr
st=$(curl -s -o "$BODY" -D "$hdr_out" -w "%{http_code}" -X POST "$BASE/bookings" \
    -H "X-API-Key: $API_KEY" \
    --data '{"slot_id":"rl-6","name":"Rate","email":"rate@test.com"}')
ra=$(grep -i "^retry-after:" "$hdr_out" | tr -d '\r' | awk '{print $2}')
[ "$st" = "429" ] && ok "6th attempt -> 429" || bad "6th attempt -> 429 (got $st)"
if [ -n "$ra" ] && [ "$ra" -ge 1 ] 2>/dev/null && [ "$ra" -le 60 ] 2>/dev/null; then
  ok "Retry-After header present and in 1..60 (got $ra)"
else
  bad "Retry-After header valid 1..60 (got '$ra')"
fi

# different email is NOT affected (book rl-6 with other@test.com -> 201)
st=$(req POST /bookings '{"slot_id":"rl-6","name":"Other","email":"other@test.com"}')
[ "$st" = "201" ] && ok "different email unaffected -> 201" || bad "other email -> 201 (got $st)"

# a 7th attempt for rate@test.com still 429 (within window)
st=$(req POST /bookings '{"slot_id":"rl-6","name":"Rate","email":"rate@test.com"}')
[ "$st" = "429" ] && ok "still 429 within the 60s window" || bad "still 429 within window (got $st)"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════"
echo "  RESULT:  PASS=$PASS   FAIL=$FAIL"
echo "════════════════════════════════════════════════════════════"
[ "$FAIL" = "0" ] && exit 0 || exit 1
