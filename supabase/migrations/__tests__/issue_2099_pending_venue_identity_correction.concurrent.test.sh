#!/usr/bin/env bash
# #2099 — §D5 authenticated TWO-CONNECTION race harness.
#
# The independent tester's P1-5 rejected the previous shape because it locked the
# guard table directly and never invoked the RPC: "the central safety claim — no
# dependency/DDL can slip between proof and correction — remains unverified."
# Every CORRECTION lane below therefore
#   · sets a real authenticated request claim for an exact owner fixture that has
#     accepted `brand_owner` membership in the database,
#   · obtains a FRESH preview, and
#   · calls `public.correct_pending_venue_identity(...)` with the CAS values and
#     fingerprints that preview returned.
# Locking the guard table directly is used ONLY as competitor setup, never as a
# correction lane.
#
# No sleep alone counts as proof: every blocking assertion records a
# not-completed checkpoint BEFORE the first transaction is released, then a
# bounded completion afterwards, and every losing correction is proved to have
# made ZERO product writes and ZERO audit rows.
#
# RUN-SCOPED AND LANE-SCOPED, and that is a correctness requirement rather than
# tidiness. The first version of this harness re-seeded ONE venue between races
# and began by deleting its audit rows — and `venue_identity_correction_audit`
# is immutable by trigger, for the table owner and for a superuser alike. Race 1
# commits an audit row, race 2 tries to delete it, the trigger refuses, and
# `ON_ERROR_STOP=1` + `set -e` take the harness down before races 2-6 ever run.
# It was written, wired into CI, and never executed once. So: every race now
# owns its own brand/pool/venue, `request_id` is globally UNIQUE and therefore
# derived from a per-run token, and NOTHING here ever deletes an audit row.
set -euo pipefail

DB_CONTAINER="${ISSUE2099_DB_CONTAINER:-$(cat /tmp/issue2099-db-container)}"
DB_PASSWORD="${ISSUE2099_DB_PASSWORD:-$(cat /tmp/issue2099-db-password)}"

# Per-run token. `venue_identity_correction_audit.request_id` is globally
# UNIQUE, so a fixed request id succeeds exactly once per database and returns
# REQUEST_CONFLICT for ever after — which would make a second run of this
# harness fail for a reason that has nothing to do with the product.
RUN_TOKEN="${ISSUE2099_RUN_TOKEN:-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')}"
OWNER="20990001-0000-4000-8000-$RUN_TOKEN"

# Set by seed_fixture for the current race.
BRAND=""
POOL=""
VENUE=""
LANE=""

psql_raw() {
  docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f -
}
psql_soft() {
  docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U postgres -d postgres -At -f -
}

fail() { echo "issue-2099 concurrency FAIL: $*" >&2; exit 1; }
ok() { echo "  ok  $*"; }

# ---------------------------------------------------------------------------
# Durable, COMMITTED fixture, ONE PER RACE. Two connections cannot see each
# other's uncommitted rows, so the fixture cannot live in a transaction the way
# the single-session SQL contract's does — and it cannot be shared between
# races either, because tearing one down would mean deleting audit rows.
# ---------------------------------------------------------------------------
seed_fixture() {
  LANE="$1"
  BRAND="20990003-0000-4000-80${LANE}0-$RUN_TOKEN"
  POOL="20990010-0000-4000-80${LANE}0-$RUN_TOKEN"
  VENUE="20990020-0000-4000-80${LANE}0-$RUN_TOKEN"
  psql_raw <<SQL
INSERT INTO auth.users(id,email) VALUES('$OWNER','owner-2099-race-$RUN_TOKEN@example.test')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.creator_accounts(id) VALUES('$OWNER') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency)
VALUES('$BRAND','$OWNER','Issue 2099 race brand $LANE','issue-2099-race-$RUN_TOKEN-$LANE','USD','USD');
UPDATE public.brand_team_members SET role='brand_owner',accepted_at=now(),removed_at=NULL
WHERE brand_id='$BRAND' AND user_id='$OWNER';
INSERT INTO public.place_pool(id,name,lat,lng,types,primary_type,is_active,is_claimed,is_servable,fetched_via,
  business_author_brand_id,business_authoring_status,business_authoring_inputs,ai_signal_scores,photo_collage_url)
VALUES('$POOL','Old venue',6.45,3.40,ARRAY['amusement_center'],'amusement_center',true,true,false,'business_authored',
  '$BRAND','draft','{"tier1":{"name":"Old venue","venueCategory":"play"}}','{}'::jsonb,'');
INSERT INTO public.venue_listings(id,brand_id,place_pool_id,slug,name,address,city,country_code,lat,lng,venue_category,claim_status)
VALUES('$VENUE','$BRAND','$POOL','oldvenue','Old venue','1 Preserve Road','Lagos','NG',6.45,3.40,'play','pending_review');
INSERT INTO public.brand_hours(brand_id,venue_id,weekday,open_time,close_time,is_closed)
SELECT '$BRAND','$VENUE',d,'09:00','17:00',false FROM generate_series(0,6) d;
INSERT INTO public.brand_place_pipeline_state(brand_id,place_pool_id,venue_id,status,last_error_message)
VALUES('$BRAND','$POOL','$VENUE','needs_fix','');
INSERT INTO public.venue_reservation_settings(brand_id,place_pool_id,venue_id,reservations_enabled,fee_enabled,fee_amount_cents,fee_currency)
VALUES('$BRAND','$POOL','$VENUE',true,true,900,'USD');
INSERT INTO public.venue_availability_config(brand_id,place_pool_id,venue_id,buffer_minutes,iana_timezone,iana_timezone_source)
VALUES('$BRAND','$POOL','$VENUE',20,'Africa/Lagos','operator');
INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('STAY_VENUE_AUTHORING',true,'#2099 race fixture')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
SQL
}

# One AUTHENTICATED correction lane. $1 = request suffix, $2 = new slug,
# $3 = extra SQL executed INSIDE the same transaction after the RPC (so the
# transaction's locks are still held), $4 = commit|rollback.
correction_lane() {
  local request_id="20990100-0000-4000-8$1-$RUN_TOKEN" new_slug="$2" inside="$3" finish="$4"
  psql_soft <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$OWNER',true);
DO \$lane\$
DECLARE p jsonb; r jsonb;
BEGIN
  p := public.preview_pending_venue_identity_correction('$VENUE');
  r := public.correct_pending_venue_identity(
    '$VENUE',(p->>'brand_id')::uuid,(p->>'place_pool_id')::uuid,
    (p#>>'{current,updated_at}')::timestamptz,p#>>'{current,name}',p#>>'{current,slug}',p#>>'{current,category}',
    'Ramble Away Resort','$new_slug','stay','Race harness correction',
    '$request_id',p->>'schema_fingerprint',p->>'state_fingerprint');
  RAISE NOTICE 'LANE_RESULT %', COALESCE(r->>'code','ok');
END
\$lane\$;
$inside
$finish;
SQL
}

audit_count() {
  psql_raw <<SQL
SELECT count(*) FROM public.venue_identity_correction_audit WHERE corrected_venue_id='$VENUE';
SQL
}
venue_identity() {
  psql_raw <<SQL
SELECT name || '|' || slug || '|' || venue_category FROM public.venue_listings WHERE id='$VENUE';
SQL
}

echo "#2099 §D5 — authenticated two-connection race matrix"

# ---------------------------------------------------------------------------
# RACE 1 — CORRECTION FIRST vs DDL. The correction's SHARE lock on the guard
# makes the competitor's CREATE TABLE wait at ddl_command_start until commit.
# ---------------------------------------------------------------------------
seed_fixture 1
( correction_lane '11a' 'raceonea' 'SELECT pg_sleep(4);' 'COMMIT' \
    > /tmp/issue2099-race1-correction.out 2>&1 ) &
correction_pid=$!
sleep 1
( psql_soft > /tmp/issue2099-race1-ddl.out 2>&1 <<SQL
CREATE TABLE public.issue_2099_race_ddl_a(venue_id uuid);
SQL
) &
ddl_pid=$!
sleep 1
# CHECKPOINT — the competitor must NOT have completed while the correction holds.
if ! kill -0 "$ddl_pid" 2>/dev/null; then
  fail "race 1: competitor DDL completed while the correction still held its SHARE lock"
fi
ok "race 1 checkpoint: competitor DDL is blocked before the correction commits"
wait "$correction_pid"
wait "$ddl_pid"
grep -q "LANE_RESULT ok" /tmp/issue2099-race1-correction.out \
  || fail "race 1: the correction did not succeed: $(cat /tmp/issue2099-race1-correction.out)"
[ "$(venue_identity)" = "Ramble Away Resort|raceonea|stay" ] \
  || fail "race 1: the corrected identity is not the committed one"
[ "$(audit_count)" = "1" ] || fail "race 1: expected exactly one audit row"
psql_raw <<'SQL'
DROP TABLE IF EXISTS public.issue_2099_race_ddl_a;
SQL
ok "race 1: correction-first wins, competitor DDL waits, exactly one audit row"

# ---------------------------------------------------------------------------
# RACE 2 — DDL FIRST. The event trigger's EXCLUSIVE lock makes the correction's
# SHARE ... NOWAIT return the stable CORRECTION_BUSY with ZERO writes.
# ---------------------------------------------------------------------------
seed_fixture 2
before_audit="$(audit_count)"
before_identity="$(venue_identity)"
( psql_soft > /tmp/issue2099-race2-ddl.out 2>&1 <<SQL
BEGIN;
CREATE TABLE public.issue_2099_race_ddl_b(place_pool_id uuid);
SELECT pg_sleep(4);
COMMIT;
SQL
) &
ddl_pid=$!
sleep 1
correction_lane '22b' 'racetwob' '' 'ROLLBACK' \
  > /tmp/issue2099-race2-correction.out 2>&1
grep -q "LANE_RESULT CORRECTION_BUSY" /tmp/issue2099-race2-correction.out \
  || fail "race 2: expected CORRECTION_BUSY, got: $(cat /tmp/issue2099-race2-correction.out)"
[ "$(venue_identity)" = "$before_identity" ] || fail "race 2: the losing correction wrote product state"
[ "$(audit_count)" = "$before_audit" ] || fail "race 2: the losing correction wrote an audit row"
wait "$ddl_pid"
psql_raw <<'SQL'
DROP TABLE IF EXISTS public.issue_2099_race_ddl_b;
SQL
ok "race 2: DDL-first makes the correction CORRECTION_BUSY with zero writes and zero audit"

# ---------------------------------------------------------------------------
# RACE 3 — a COMMITTED disallowed dependency must make the correction ineligible
# rather than silently correcting a venue that is now in use.
# ---------------------------------------------------------------------------
seed_fixture 3
psql_raw <<SQL
CREATE TABLE IF NOT EXISTS public.issue_2099_race_semantic(id serial PRIMARY KEY, venue_id uuid);
INSERT INTO public.issue_2099_race_semantic(venue_id) VALUES('$VENUE');
SQL
before_identity="$(venue_identity)"
before_audit="$(audit_count)"
correction_lane '33c' 'racethree' '' 'ROLLBACK' \
  > /tmp/issue2099-race3.out 2>&1
grep -qE "LANE_RESULT (DEPENDENCY_NOT_EMPTY|DEPENDENCY_SCHEMA_CHANGED|CORRECTION_BUSY)" /tmp/issue2099-race3.out \
  || fail "race 3: a new semantic venue_id lane did not stop the correction: $(cat /tmp/issue2099-race3.out)"
[ "$(venue_identity)" = "$before_identity" ] || fail "race 3: the losing correction wrote product state"
[ "$(audit_count)" = "$before_audit" ] || fail "race 3: the losing correction wrote an audit row"
psql_raw <<'SQL'
DROP TABLE IF EXISTS public.issue_2099_race_semantic;
SQL
ok "race 3: an unknown/occupied dependency lane fails closed with zero writes"

# ---------------------------------------------------------------------------
# RACE 4 — a sensitive field that turns non-empty between preview and correction
# can never be erased by the correction.
# ---------------------------------------------------------------------------
seed_fixture 4
psql_raw <<SQL
UPDATE public.place_pool SET ai_signal_scores='{"private":"must-not-leak"}' WHERE id='$POOL';
SQL
before_identity="$(venue_identity)"
before_audit="$(audit_count)"
correction_lane '44d' 'racefour' '' 'ROLLBACK' \
  > /tmp/issue2099-race4.out 2>&1
grep -q "LANE_RESULT SENSITIVE_STATE_NOT_EMPTY" /tmp/issue2099-race4.out \
  || fail "race 4: expected SENSITIVE_STATE_NOT_EMPTY, got: $(cat /tmp/issue2099-race4.out)"
grep -q "must-not-leak" /tmp/issue2099-race4.out \
  && fail "race 4: the seeded sensitive value leaked into the safe response"
[ "$(venue_identity)" = "$before_identity" ] || fail "race 4: the losing correction wrote product state"
[ "$(audit_count)" = "$before_audit" ] || fail "race 4: the losing correction wrote an audit row"
[ "$(psql_raw <<SQL
SELECT ai_signal_scores::text FROM public.place_pool WHERE id='$POOL';
SQL
)" = '{"private": "must-not-leak"}' ] || fail "race 4: the correction erased a sensitive field"
ok "race 4: an empty→non-empty sensitive transition wins; the correction cannot clear it"

# ---------------------------------------------------------------------------
# RACE 5 — two SIMULTANEOUS byte-equivalent same-request writers: exactly one
# mutation, exactly one audit row, identical recorded success.
# ---------------------------------------------------------------------------
seed_fixture 5
( correction_lane '55e' 'racefive' '' 'COMMIT' > /tmp/issue2099-race5-a.out 2>&1 ) &
a_pid=$!
( correction_lane '55e' 'racefive' '' 'COMMIT' > /tmp/issue2099-race5-b.out 2>&1 ) &
b_pid=$!
wait "$a_pid"; wait "$b_pid"
grep -q "LANE_RESULT ok" /tmp/issue2099-race5-a.out || fail "race 5: session A did not succeed"
grep -q "LANE_RESULT ok" /tmp/issue2099-race5-b.out || fail "race 5: session B did not return the recorded success"
[ "$(audit_count)" = "1" ] || fail "race 5: byte-equivalent replay produced $(audit_count) audit rows, expected 1"
ok "race 5: simultaneous byte-equivalent writers produce one mutation and one audit row"

# ---------------------------------------------------------------------------
# RACE 6 — two SIMULTANEOUS distinct-request writers over the same CAS: one
# success, one STALE_VERSION, one audit row.
# ---------------------------------------------------------------------------
seed_fixture 6
( correction_lane '66f' 'racesixa' '' 'COMMIT' > /tmp/issue2099-race6-a.out 2>&1 ) &
a_pid=$!
( correction_lane '67f' 'racesixb' '' 'COMMIT' > /tmp/issue2099-race6-b.out 2>&1 ) &
b_pid=$!
wait "$a_pid"; wait "$b_pid"
wins="$(grep -l "LANE_RESULT ok" /tmp/issue2099-race6-a.out /tmp/issue2099-race6-b.out | wc -l | tr -d ' ')"
[ "$wins" = "1" ] || fail "race 6: expected exactly one winner, got $wins"
grep -hqE "LANE_RESULT (STALE_VERSION|CORRECTION_BUSY)" /tmp/issue2099-race6-a.out /tmp/issue2099-race6-b.out \
  || fail "race 6: the loser did not return a contractually correct code"
[ "$(audit_count)" = "1" ] || fail "race 6: expected exactly one audit row"
ok "race 6: distinct-request writers over one CAS produce one winner and one audit row"

# ---------------------------------------------------------------------------
# Cleanup — product rows for all six lanes. Audit rows are NEVER deleted: the
# migration's immutability trigger refuses that for the table owner too, which
# is the product being right and was the defect that stopped this harness at
# race 2. The fixture database is disposable, so the rows simply stay.
# ---------------------------------------------------------------------------
for lane in 1 2 3 4 5 6; do
  v="20990020-0000-4000-80${lane}0-$RUN_TOKEN"
  b="20990003-0000-4000-80${lane}0-$RUN_TOKEN"
  pl="20990010-0000-4000-80${lane}0-$RUN_TOKEN"
  psql_raw <<SQL
DELETE FROM public.brand_hours WHERE venue_id='$v';
DELETE FROM public.brand_place_pipeline_state WHERE venue_id='$v';
DELETE FROM public.venue_availability_config WHERE venue_id='$v';
DELETE FROM public.venue_reservation_settings WHERE venue_id='$v';
DELETE FROM public.venue_listings WHERE id='$v';
DELETE FROM public.place_pool WHERE id='$pl';
DELETE FROM public.brand_team_members WHERE brand_id='$b';
DELETE FROM public.brands WHERE id='$b';
SQL
done

echo "#2099 §D5 — all six authenticated races passed."
