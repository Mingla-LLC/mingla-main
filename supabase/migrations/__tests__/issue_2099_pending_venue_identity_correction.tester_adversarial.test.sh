#!/usr/bin/env bash
# =============================================================================
# #2099 — Amendment 4 §D7 TESTER-OWNED ADVERSARIAL GUARD.
#
# Written by the independent tester. The implementor must not author or edit
# this file. Amendment 12 §M3 is why it exists in this shape: every other
# artefact on this issue — Check H, Check P, jest.issue2099.web.render.cjs, the
# native-absence probe, the workflow itself — is implementor-authored, and §L7
# concedes that a hostile or careless suite defeats all of it. This guard and
# the tester's own §D6 browser matrix are the two proofs outside that chain.
#
# DIFFERENT ANGLE from the implementor's §D5 harness. That harness races the
# correction against DDL, against a committed dependency, against a sensitive
# field turning non-empty, and against itself (byte-equivalent replay + CAS).
# What it never does is change WHO THE ACTOR IS, revert a transaction, refuse a
# rollback, or attack the audit row. This guard does exactly those four:
#
#   T-1  MID-FLIGHT DEAUTHORISATION. The RPC checks authorisation twice: once
#        before `pg_advisory_xact_lock` and once after it. The second check is
#        the only thing standing between a correction and an actor whose
#        ownership was revoked while the correction sat in the lock queue. T-1
#        parks the issue lock in a third session, lets an authorised correction
#        block on it, revokes the actor's `brand_owner` membership from a fourth
#        session, then releases. The correction must come back NOT_AUTHORIZED
#        with zero product writes and zero audit rows. Deleting the post-lock
#        re-check reds this lane, and nothing else on this issue sees it.
#
#   T-2  TRANSACTION-REVERT TRUTH. A correction that returns ok inside a
#        transaction that is then ROLLED BACK must leave no trace: a concurrent
#        reader must never observe the uncommitted identity, and afterwards the
#        identity and the audit cardinality must be exactly what they were. An
#        audit write that escaped the caller's transaction reds here.
#
#   T-3  ROLLBACK REFUSAL AFTER A LATER EDIT. Forward-correct, let a competing
#        session edit the venue, then attempt the §D3 rollback against the
#        original audit row. The rollback must refuse rather than silently
#        overwrite the newer edit, and must write nothing.
#
#   T-4  AUDIT IMMUTABILITY, IN BOTH EXECUTION CONTEXTS, EACH NAMED. As
#        `authenticated` the write must be denied; as the table OWNER it must
#        still be denied, by the immutability trigger, with its exact message.
#        The owner lane is the only context in which the trigger is observable
#        at all — a privilege check run as a superuser proves nothing about the
#        trigger. Both are asserted, and each states the context it runs in.
#
# NON-VACUITY. Every lane increments LANES_RUN and the script fails unless
# exactly EXPECTED_LANES completed. Every fixture assertion is preceded by a
# proof that the fixture row exists, so no comparison is ever run over an empty
# payload. Every mutation this guard makes is read back and confirmed to have
# landed before its consequence is asserted.
#
# ENFORCEMENT (Amendment 12 §M3 — the §D7 gap). §D7 is independent in CONTENT,
# but its INVOCATION lives in the implementor-authored workflow and P-9, which
# guards that invocation, is implementor-authored too. The W lanes below are the
# tester's own independent assertion that the invocation is fail-closed on both
# events AND that this guard's database half is scheduled in a job that owns a
# PostgreSQL fixture. Matching a paths glob is not the same as being executed: a
# registered-but-unrun guard is worse than an absent one, because it reads as
# passing.
#
# MODES, named out loud and asserted. The web-contracts job has no database; the
# postgres-contract job does.
#   · db mode   — W lanes + T-1…T-4 against the real RPC.
#   · wire mode — W lanes only. The W lanes are what prove db mode runs
#                 somewhere; wire mode never reports T-1…T-4 as proven.
# Neither mode is a silent skip: both fail closed.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD_REL="supabase/migrations/__tests__/issue_2099_pending_venue_identity_correction.tester_adversarial.test.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/issue-2099-pending-venue-identity-correction-tests.yml"

fail() { echo "issue-2099 TESTER GUARD FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }

LANES_RUN=0
WIRE_RUN=0

# -----------------------------------------------------------------------------
# W — the §D7 enforcement lanes. Always run, in every mode.
# -----------------------------------------------------------------------------
[ -f "$WORKFLOW" ] || fail "W: the issue workflow is missing at $WORKFLOW"
wf="$(cat "$WORKFLOW")"

# Collect the step block(s) containing a token, split at the six-space `- `
# boundary a step is written at, so a token in one step is never credited to
# another.
steps_with() {
  awk -v needle="$1" '
    /^      - / { if (blk != "" && hit) printf "%s", blk; blk=""; hit=0 }
    { blk = blk $0 "\n"; if (index($0, needle)) hit=1 }
    END { if (blk != "" && hit) printf "%s", blk }
  ' "$WORKFLOW"
}

assert_step_fail_closed() {
  local label="$1" block="$2"
  [ -n "$block" ] || fail "W: no step found for $label"
  if printf '%s' "$block" | grep -qE '^[[:space:]]+continue-on-error'; then
    fail "W: the $label step carries continue-on-error"
  fi
  if printf '%s' "$block" | grep -qE '^[[:space:]]+if:'; then
    fail "W: the $label step carries an if: condition"
  fi
  if printf '%s' "$block" | grep -qE '\|\|[[:space:]]*true'; then
    fail "W: the $label step carries a '|| true' bypass"
  fi
  if printf '%s' "$block" | grep -qE 'set[[:space:]]+\+e'; then
    fail "W: the $label step disables errexit"
  fi
}

# W-1 — the fail-closed existence check in the web-contracts job.
web_block="$(steps_with 'tester guard pending')"
[ -n "$web_block" ] || fail "W-1: no step fails closed on this guard's absence"
assert_step_fail_closed "fail-closed existence" "$web_block"
printf '%s' "$web_block" | grep -qE '(test[[:space:]]+-f|\[[[:space:]]*!?[[:space:]]*-f)' \
  || fail "W-1: the fail-closed step does not test for the guard file"
printf '%s' "$web_block" | grep -q 'exit 1' \
  || fail "W-1: the fail-closed step does not exit non-zero on absence"
printf '%s' "$web_block" | grep -q 'tester_adversarial.test.sh' \
  || fail "W-1: the fail-closed step does not name this guard"
WIRE_RUN=$((WIRE_RUN + 1)); ok "W-1: an absent tester guard fails the job closed, with no bypass token"

# W-2 — BOTH events. §D7 says PR and push, so the branch list is read rather
# than assumed: a `push:` key pointed at a branch that never receives this code
# would satisfy a naive token check and enforce nothing.
printf '%s' "$wf" | grep -qE '^on:' || fail "W-2: the workflow has no trigger block"
printf '%s' "$wf" | grep -qE '^  pull_request:' || fail "W-2: no pull_request trigger"
printf '%s' "$wf" | grep -qE '^  push:' || fail "W-2: no push trigger"
push_branches="$(printf '%s\n' "$wf" | awk '/^  push:/{f=1;next} /^  [a-z_]+:/{f=0} f && /branches:/{print}')"
[ -n "$push_branches" ] || fail "W-2: the push trigger names no branches"
printf '%s' "$push_branches" | grep -q 'main' \
  || fail "W-2: the push trigger does not cover main — it is: $push_branches"
WIRE_RUN=$((WIRE_RUN + 1)); ok "W-2: the workflow runs on pull_request and on push to main"

# W-3 — this guard's own path is in the paths filter, so landing the file
# actually triggers the workflow instead of matching nothing.
printf '%s' "$wf" | grep -q "$GUARD_REL" \
  || fail "W-3: $GUARD_REL is not in the workflow's paths filter"
WIRE_RUN=$((WIRE_RUN + 1)); ok "W-3: this guard's path is in the workflow paths filter"

# W-4 — THE DATABASE HALF IS ACTUALLY SCHEDULED, in a job that has a fixture,
# after the fixture exists, with no bypass token. Without this lane the T lanes
# could be registered against a job that can never run them.
pg_job="$(awk '
  /^  issue-2099-postgres-contract:/ { f=1; print; next }
  /^  [a-z0-9_-]+:[[:space:]]*$/     { if (f) f=0 }
  f { print }
' "$WORKFLOW")"
[ -n "$pg_job" ] || fail "W-4: the issue-2099-postgres-contract job is missing"
printf '%s' "$pg_job" | grep -q "$GUARD_REL" \
  || fail "W-4: the postgres-contract job never invokes this guard — its DB lanes would never execute"
fixture_line="$(printf '%s\n' "$pg_job" | grep -n 'supabase start' | head -1 | cut -d: -f1)"
guard_line="$(printf '%s\n' "$pg_job" | grep -n "$GUARD_REL" | head -1 | cut -d: -f1)"
[ -n "$fixture_line" ] || fail "W-4: the postgres-contract job never starts a fixture"
[ "$guard_line" -gt "$fixture_line" ] \
  || fail "W-4: this guard runs before the fixture exists (line $guard_line vs $fixture_line)"
pg_guard_block="$(printf '%s\n' "$pg_job" | awk -v needle="$GUARD_REL" '
  /^      - / { if (blk != "" && hit) { printf "%s", blk; exit } ; blk=""; hit=0 }
  { blk = blk $0 "\n"; if (index($0, needle)) hit=1 }
  END { if (blk != "" && hit) printf "%s", blk }')"
assert_step_fail_closed "postgres-contract guard" "$pg_guard_block"
WIRE_RUN=$((WIRE_RUN + 1)); ok "W-4: the DB half is invoked in the postgres-contract job, after the fixture, fail-closed"

[ "$WIRE_RUN" -eq 4 ] || fail "W: expected 4 enforcement lanes, ran $WIRE_RUN"

# -----------------------------------------------------------------------------
# Mode selection.
# -----------------------------------------------------------------------------
DB_CONTAINER="${ISSUE2099_DB_CONTAINER:-}"
if [ -z "$DB_CONTAINER" ] && [ -f /tmp/issue2099-db-container ]; then
  DB_CONTAINER="$(cat /tmp/issue2099-db-container)"
fi
DB_PASSWORD="${ISSUE2099_DB_PASSWORD:-}"
if [ -z "$DB_PASSWORD" ] && [ -f /tmp/issue2099-db-password ]; then
  DB_PASSWORD="$(cat /tmp/issue2099-db-password)"
fi
TCP_HOST="${ISSUE2099_PGHOST:-}"
TCP_PORT="${ISSUE2099_PGPORT:-}"

MODE="wire"
if [ -n "$DB_CONTAINER" ]; then MODE="db"
elif [ -n "$TCP_HOST" ] && [ -n "$TCP_PORT" ]; then MODE="db"
fi

echo "#2099 §D7 tester adversarial guard — EXECUTION CONTEXT: mode=$MODE repo=$REPO_ROOT"

if [ "$MODE" = "wire" ]; then
  echo "  -- wire mode: no PostgreSQL fixture is reachable from this job."
  echo "  -- The four W lanes proved the database half is scheduled in the"
  echo "  -- postgres-contract job, after its fixture, with no bypass token."
  echo "  -- This mode does NOT report T-1…T-4 as proven."
  echo "#2099 §D7 tester guard: 4 enforcement lanes passed (wire mode)."
  exit 0
fi

# -----------------------------------------------------------------------------
# db mode.
# -----------------------------------------------------------------------------
psql_run() { # $1 = ON_ERROR_STOP (0|1)
  if [ -n "$DB_CONTAINER" ]; then
    docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
      psql -U postgres -d postgres -At -q -v ON_ERROR_STOP="$1" -f -
  else
    PGPASSWORD="${ISSUE2099_PGPASSWORD:-postgres}" psql \
      -h "$TCP_HOST" -p "$TCP_PORT" -U "${ISSUE2099_PGUSER:-postgres}" -d postgres \
      -At -q -v ON_ERROR_STOP="$1" -f -
  fi
}
psql_raw()  { psql_run 1; }
psql_soft() { psql_run 0; }

# The execution context must be REAL, not assumed. A lane that silently ran as a
# superuser would prove nothing about an owner's rights.
ctx="$(psql_raw <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT current_user || '|' || COALESCE((SELECT 'rpc' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='correct_pending_venue_identity' LIMIT 1),'norpc');
ROLLBACK;
SQL
)"
[ "$ctx" = "authenticated|rpc" ] \
  || fail "execution context is not an authenticated session against the #2099 RPC: '$ctx'"
ok "execution context asserted: SET ROLE authenticated, correct_pending_venue_identity present"

# Identities are RUN-SCOPED as well as lane-scoped. `venue_identity_correction_audit`
# is append-only AND immutable and `request_id` is globally UNIQUE, so a guard
# with fixed ids passes exactly once per database and returns REQUEST_CONFLICT
# ever after — a harness defect that would read as a product defect.
RUN12="$(psql_raw <<<"SELECT substr(replace(gen_random_uuid()::text,'-',''),1,12);")"
printf '%s' "$RUN12" | grep -qE '^[0-9a-f]{12}$' || fail "could not derive a run suffix: '$RUN12'"

OWNER='' BRAND='' POOL='' VENUE='' LANE=''
set_lane_identity() {
  LANE="$1"
  OWNER="20990000-000${1}-0001-2099-${RUN12}"
  BRAND="20990000-000${1}-0002-2099-${RUN12}"
  POOL="20990000-000${1}-0003-2099-${RUN12}"
  VENUE="20990000-000${1}-0004-2099-${RUN12}"
}
new_request_id() { psql_raw <<<"SELECT gen_random_uuid();"; }

REQ_T1="$(new_request_id)"; REQ_T2="$(new_request_id)"
REQ_T3F="$(new_request_id)"; REQ_T3R="$(new_request_id)"; REQ_T4="$(new_request_id)"
for r in "$REQ_T1" "$REQ_T2" "$REQ_T3F" "$REQ_T3R" "$REQ_T4"; do
  printf '%s' "$r" | grep -qE '^[0-9a-f-]{36}$' || fail "bad generated request id: '$r'"
done
ok "run-scoped identities derived (suffix $RUN12); no prior run's audit row can collide"

seed_fixture() {
  set_lane_identity "$1"
  psql_raw >/dev/null <<SQL
DELETE FROM public.brand_hours WHERE venue_id='$VENUE';
DELETE FROM public.brand_place_pipeline_state WHERE venue_id='$VENUE';
DELETE FROM public.venue_availability_config WHERE venue_id='$VENUE';
DELETE FROM public.venue_reservation_settings WHERE venue_id='$VENUE';
DELETE FROM public.venue_listings WHERE id='$VENUE';
DELETE FROM public.place_pool WHERE id='$POOL';
DELETE FROM public.brand_team_members WHERE brand_id='$BRAND';
DELETE FROM public.brands WHERE id='$BRAND';
DELETE FROM public.creator_accounts WHERE id='$OWNER';
DELETE FROM auth.users WHERE id='$OWNER';

INSERT INTO auth.users(id,email) VALUES('$OWNER','tester-2099-d7-l$LANE-$RUN12@example.test');
INSERT INTO public.creator_accounts(id) VALUES('$OWNER');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,pricing_currency)
VALUES('$BRAND','$OWNER','Issue 2099 tester brand l$LANE','issue-2099-tester-l$LANE-$RUN12','USD','USD');
UPDATE public.brand_team_members SET role='brand_owner',accepted_at=now(),removed_at=NULL
WHERE brand_id='$BRAND' AND user_id='$OWNER';
INSERT INTO public.place_pool(id,name,lat,lng,types,primary_type,is_active,is_claimed,is_servable,fetched_via,
  business_author_brand_id,business_authoring_status,business_authoring_inputs,ai_signal_scores,photo_collage_url)
VALUES('$POOL','Old venue',6.45,3.40,ARRAY['amusement_center'],'amusement_center',true,true,false,'business_authored',
  '$BRAND','draft','{"tier1":{"name":"Old venue","venueCategory":"play"}}','{}'::jsonb,'');
INSERT INTO public.venue_listings(id,brand_id,place_pool_id,slug,name,address,city,country_code,lat,lng,venue_category,claim_status)
VALUES('$VENUE','$BRAND','$POOL','oldvenue$LANE','Old venue','1 Preserve Road','Lagos','NG',6.45,3.40,'play','pending_review');
INSERT INTO public.brand_hours(brand_id,venue_id,weekday,open_time,close_time,is_closed)
SELECT '$BRAND','$VENUE',d,'09:00','17:00',false FROM generate_series(0,6) d;
INSERT INTO public.brand_place_pipeline_state(brand_id,place_pool_id,venue_id,status,last_error_message)
VALUES('$BRAND','$POOL','$VENUE','needs_fix','');
INSERT INTO public.venue_reservation_settings(brand_id,place_pool_id,venue_id,reservations_enabled,fee_enabled,fee_amount_cents,fee_currency)
VALUES('$BRAND','$POOL','$VENUE',true,true,900,'USD');
INSERT INTO public.venue_availability_config(brand_id,place_pool_id,venue_id,buffer_minutes,iana_timezone,iana_timezone_source)
VALUES('$BRAND','$POOL','$VENUE',20,'Africa/Lagos','operator');
INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('STAY_VENUE_AUTHORING',true,'#2099 tester guard fixture')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
SQL
  # NON-VACUITY: the fixture must actually exist before anything is asserted
  # about it. A stronger comparison over an absent row still compares nothing.
  local seeded
  seeded="$(psql_raw <<SQL
SELECT (SELECT count(*) FROM public.venue_listings WHERE id='$VENUE' AND claim_status='pending_review')::text || '|'
    || (SELECT count(*) FROM public.brand_team_members WHERE brand_id='$BRAND' AND user_id='$OWNER'
          AND role='brand_owner' AND accepted_at IS NOT NULL AND removed_at IS NULL)::text || '|'
    || (SELECT count(*) FROM public.brand_hours WHERE venue_id='$VENUE')::text || '|'
    || (SELECT count(*) FROM public.venue_identity_correction_audit WHERE corrected_venue_id='$VENUE')::text;
SQL
)"
  [ "$seeded" = "1|1|7|0" ] \
    || fail "lane $1 fixture did not seed (venue|owner|hours|audit = '$seeded', expected 1|1|7|0)"
}

audit_count() { psql_raw <<SQL
SELECT count(*) FROM public.venue_identity_correction_audit WHERE corrected_venue_id='$VENUE';
SQL
}
venue_identity() { psql_raw <<SQL
SELECT name || '|' || slug || '|' || venue_category FROM public.venue_listings WHERE id='$VENUE';
SQL
}

# One AUTHENTICATED correction lane: fresh preview, then the real RPC with the
# CAS values that preview returned. $1 request id, $2 new slug, $3 finish.
correction_lane() {
  local request_id="$1" new_slug="$2" finish="$3"
  psql_soft <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$OWNER',true);
DO \$lane\$
DECLARE p jsonb; r jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'lane is not authenticated'; END IF;
  p := public.preview_pending_venue_identity_correction('$VENUE');
  r := public.correct_pending_venue_identity(
    '$VENUE',(p->>'brand_id')::uuid,(p->>'place_pool_id')::uuid,
    (p#>>'{current,updated_at}')::timestamptz,p#>>'{current,name}',p#>>'{current,slug}',p#>>'{current,category}',
    'Ramble Away Resort','$new_slug','stay','Tester adversarial guard',
    '$request_id',p->>'schema_fingerprint',p->>'state_fingerprint');
  RAISE NOTICE 'LANE_RESULT %', COALESCE(r->>'code','ok');
END
\$lane\$;
$finish;
SQL
}

echo "#2099 §D7 — tester adversarial matrix (4 lanes)"

# ---------------------------------------------------------------------------
# T-1 — MID-FLIGHT DEAUTHORISATION.
# ---------------------------------------------------------------------------
seed_fixture 1
before_identity="$(venue_identity)"
before_audit="$(audit_count)"
[ "$before_identity" = "Old venue|oldvenue1|play" ] || fail "T-1: fixture identity is '$before_identity'"

# A third session parks the issue advisory lock so the correction is guaranteed
# to be waiting INSIDE the RPC, past its first authorisation check.
( psql_soft > /tmp/issue2099-t1-lock.out 2>&1 <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('issue-2099-pending-venue-identity-correction',0));
SELECT pg_sleep(8);
COMMIT;
SQL
) &
lock_pid=$!
sleep 2

( correction_lane "$REQ_T1" 'deauthone' 'COMMIT' > /tmp/issue2099-t1-correction.out 2>&1 ) &
correction_pid=$!
sleep 2

# CHECKPOINT — no sleep alone counts as proof. The correction must be provably
# still running, i.e. genuinely queued behind the lock.
kill -0 "$correction_pid" 2>/dev/null \
  || fail "T-1: the correction completed before the lock was released; the race never happened"
ok "T-1 checkpoint: the correction is blocked inside the RPC, past its first authorisation check"

# Revoke the actor's ownership and PROVE the revocation landed before drawing
# any conclusion from it.
revoked="$(psql_raw <<SQL | tail -1
UPDATE public.brand_team_members SET removed_at=now()
WHERE brand_id='$BRAND' AND user_id='$OWNER' AND removed_at IS NULL;
SELECT count(*) FROM public.brand_team_members
WHERE brand_id='$BRAND' AND user_id='$OWNER' AND role='brand_owner'
  AND accepted_at IS NOT NULL AND removed_at IS NULL;
SQL
)"
[ "$revoked" = "0" ] \
  || fail "T-1: the deauthorisation did not land — the actor still holds brand_owner ('$revoked')"
ok "T-1: the actor's brand_owner membership is revoked and committed while the correction waits"

wait "$lock_pid" || true
wait "$correction_pid" || true

grep -q "LANE_RESULT NOT_AUTHORIZED" /tmp/issue2099-t1-correction.out \
  || fail "T-1: a de-authorised actor was not refused. Got: $(cat /tmp/issue2099-t1-correction.out)"
[ "$(venue_identity)" = "$before_identity" ] \
  || fail "T-1: the refused correction still wrote product state ($(venue_identity))"
[ "$(audit_count)" = "$before_audit" ] \
  || fail "T-1: the refused correction still wrote an audit row"
LANES_RUN=$((LANES_RUN + 1))
ok "T-1: ownership revoked mid-flight -> NOT_AUTHORIZED, zero product writes, zero audit rows"

# ---------------------------------------------------------------------------
# T-2 — TRANSACTION-REVERT TRUTH.
# ---------------------------------------------------------------------------
seed_fixture 2
before_identity="$(venue_identity)"
before_audit="$(audit_count)"

( correction_lane "$REQ_T2" 'revertone' 'SELECT pg_sleep(5); ROLLBACK' > /tmp/issue2099-t2.out 2>&1 ) &
t2_pid=$!
sleep 2
kill -0 "$t2_pid" 2>/dev/null \
  || fail "T-2: the correction transaction closed before the concurrent read; the window never existed"
mid_identity="$(venue_identity)"
[ "$mid_identity" = "$before_identity" ] \
  || fail "T-2: a concurrent reader observed the UNCOMMITTED corrected identity ('$mid_identity')"
[ "$(audit_count)" = "$before_audit" ] \
  || fail "T-2: a concurrent reader observed an uncommitted audit row"
ok "T-2 checkpoint: the in-flight correction is invisible to a concurrent reader"
wait "$t2_pid" || true

grep -q "LANE_RESULT ok" /tmp/issue2099-t2.out \
  || fail "T-2: the correction did not succeed before its rollback: $(cat /tmp/issue2099-t2.out)"
[ "$(venue_identity)" = "$before_identity" ] \
  || fail "T-2: a ROLLED BACK correction still changed the identity ($(venue_identity))"
[ "$(audit_count)" = "$before_audit" ] \
  || fail "T-2: a ROLLED BACK correction left an audit row behind — the audit write escaped the transaction"
LANES_RUN=$((LANES_RUN + 1))
ok "T-2: an ok correction inside a rolled back transaction leaves zero identity and zero audit"

# ---------------------------------------------------------------------------
# T-3 — ROLLBACK REFUSAL AFTER A LATER EDIT.
# ---------------------------------------------------------------------------
seed_fixture 3
correction_lane "$REQ_T3F" 'laterone' 'COMMIT' > /tmp/issue2099-t3-forward.out 2>&1
grep -q "LANE_RESULT ok" /tmp/issue2099-t3-forward.out \
  || fail "T-3: the forward correction did not succeed: $(cat /tmp/issue2099-t3-forward.out)"
[ "$(venue_identity)" = "Ramble Away Resort|laterone|stay" ] \
  || fail "T-3: the forward correction did not land ($(venue_identity))"
audit_id="$(psql_raw <<SQL
SELECT id::text FROM public.venue_identity_correction_audit
WHERE corrected_venue_id='$VENUE' AND action='forward' ORDER BY created_at DESC LIMIT 1;
SQL
)"
[ -n "$audit_id" ] || fail "T-3: no forward audit row to roll back from"

# A competing session edits the venue AFTER the correction. Proved landed.
psql_raw >/dev/null <<SQL
UPDATE public.venue_listings SET name='Edited after the correction' WHERE id='$VENUE';
SQL
[ "$(venue_identity)" = "Edited after the correction|laterone|stay" ] \
  || fail "T-3: the later edit did not land ($(venue_identity))"
after_edit_identity="$(venue_identity)"
after_edit_audit="$(audit_count)"
ok "T-3: a later edit is committed on top of the corrected identity"

psql_soft > /tmp/issue2099-t3-rollback.out 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$OWNER',true);
DO \$rb\$
DECLARE p jsonb; r jsonb;
BEGIN
  p := public.preview_pending_venue_identity_correction('$VENUE');
  r := public.correct_pending_venue_identity(
    '$VENUE',(p->>'brand_id')::uuid,(p->>'place_pool_id')::uuid,
    (p#>>'{current,updated_at}')::timestamptz,p#>>'{current,name}',p#>>'{current,slug}',p#>>'{current,category}',
    'Old venue','oldvenue3','play','Tester adversarial rollback after a later edit',
    '$REQ_T3R',p->>'schema_fingerprint',p->>'state_fingerprint',
    'rollback','$audit_id');
  RAISE NOTICE 'ROLLBACK_RESULT %', COALESCE(r->>'code','ok');
END
\$rb\$;
COMMIT;
SQL
grep -qE "ROLLBACK_RESULT (STALE_VERSION|REQUEST_CONFLICT)" /tmp/issue2099-t3-rollback.out \
  || fail "T-3: a rollback over a later edit was not refused. Got: $(cat /tmp/issue2099-t3-rollback.out)"
[ "$(venue_identity)" = "$after_edit_identity" ] \
  || fail "T-3: the refused rollback overwrote the later edit ($(venue_identity))"
[ "$(audit_count)" = "$after_edit_audit" ] \
  || fail "T-3: the refused rollback wrote an audit row"
LANES_RUN=$((LANES_RUN + 1))
ok "T-3: a rollback whose after-image is stale is refused, and writes nothing"

# ---------------------------------------------------------------------------
# T-4 — AUDIT IMMUTABILITY IN BOTH EXECUTION CONTEXTS, EACH NAMED.
# ---------------------------------------------------------------------------
seed_fixture 4
correction_lane "$REQ_T4" 'auditone' 'COMMIT' > /tmp/issue2099-t4-forward.out 2>&1
grep -q "LANE_RESULT ok" /tmp/issue2099-t4-forward.out \
  || fail "T-4: the forward correction did not succeed: $(cat /tmp/issue2099-t4-forward.out)"
[ "$(audit_count)" = "1" ] || fail "T-4: expected exactly one audit row to attack, got $(audit_count)"
audit_before="$(psql_raw <<SQL
SELECT md5(t::text) FROM public.venue_identity_correction_audit t WHERE corrected_venue_id='$VENUE';
SQL
)"
[ -n "$audit_before" ] || fail "T-4: no audit row fingerprint — nothing to compare"

# CONTEXT A — the application role. The property under test here is
# reachability from an authenticated session, not the trigger.
psql_soft > /tmp/issue2099-t4-authenticated.out 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','$OWNER',true);
SELECT 'CTX_A ' || current_user;
UPDATE public.venue_identity_correction_audit SET reason='tampered' WHERE corrected_venue_id='$VENUE';
COMMIT;
SQL
grep -q "CTX_A authenticated" /tmp/issue2099-t4-authenticated.out \
  || fail "T-4: context A did not run as authenticated: $(cat /tmp/issue2099-t4-authenticated.out)"
grep -qiE "permission denied|must be owner|immutable" /tmp/issue2099-t4-authenticated.out \
  || fail "T-4: an authenticated actor was allowed to UPDATE the audit: $(cat /tmp/issue2099-t4-authenticated.out)"
ok "T-4 context A (role=authenticated): the audit is unreachable; UPDATE denied"

# CONTEXT B — the table OWNER, the only context in which the immutability
# trigger is observable at all. Asserted by its exact message.
psql_soft > /tmp/issue2099-t4-owner.out 2>&1 <<SQL
SELECT 'CTX_B ' || current_user;
UPDATE public.venue_identity_correction_audit SET reason='tampered' WHERE corrected_venue_id='$VENUE';
SQL
grep -q "venue_identity_correction_audit_is_immutable" /tmp/issue2099-t4-owner.out \
  || fail "T-4: the immutability trigger did not fire for the table owner: $(cat /tmp/issue2099-t4-owner.out)"
psql_soft > /tmp/issue2099-t4-owner-delete.out 2>&1 <<SQL
DELETE FROM public.venue_identity_correction_audit WHERE corrected_venue_id='$VENUE';
SQL
grep -q "venue_identity_correction_audit_is_immutable" /tmp/issue2099-t4-owner-delete.out \
  || fail "T-4: the immutability trigger did not refuse a DELETE: $(cat /tmp/issue2099-t4-owner-delete.out)"
ok "T-4 context B (role=table owner): UPDATE and DELETE both refused by the immutability trigger"

audit_after="$(psql_raw <<SQL
SELECT md5(t::text) FROM public.venue_identity_correction_audit t WHERE corrected_venue_id='$VENUE';
SQL
)"
[ "$audit_after" = "$audit_before" ] \
  || fail "T-4: the audit row changed under attack ($audit_before -> $audit_after)"
[ "$(audit_count)" = "1" ] || fail "T-4: the audit row count changed under attack"
LANES_RUN=$((LANES_RUN + 1))
ok "T-4: the audit row is byte-identical after both attacks"

# ---------------------------------------------------------------------------
# Cleanup — the disposable fixture never outlives the guard. The audit table is
# deliberately NOT swept: it is immutable by construction, and attempting to
# clear it would be refused by the product's own trigger.
# ---------------------------------------------------------------------------
for lane in 1 2 3 4; do
  set_lane_identity "$lane"
  psql_raw >/dev/null <<SQL
DELETE FROM public.brand_hours WHERE venue_id='$VENUE';
DELETE FROM public.brand_place_pipeline_state WHERE venue_id='$VENUE';
DELETE FROM public.venue_availability_config WHERE venue_id='$VENUE';
DELETE FROM public.venue_reservation_settings WHERE venue_id='$VENUE';
DELETE FROM public.venue_listings WHERE id='$VENUE';
DELETE FROM public.place_pool WHERE id='$POOL';
DELETE FROM public.brand_team_members WHERE brand_id='$BRAND';
DELETE FROM public.brands WHERE id='$BRAND';
DELETE FROM public.creator_accounts WHERE id='$OWNER';
DELETE FROM auth.users WHERE id='$OWNER';
SQL
done

EXPECTED_LANES=4
[ "$LANES_RUN" -eq "$EXPECTED_LANES" ] \
  || fail "NON-VACUITY: expected $EXPECTED_LANES database lanes, only $LANES_RUN completed"
echo "#2099 §D7 tester guard: 4 enforcement lanes + $LANES_RUN adversarial database lanes passed (db mode)."
