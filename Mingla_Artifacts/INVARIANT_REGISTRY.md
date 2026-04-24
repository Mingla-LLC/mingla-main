# Invariant Registry

> Rules that must ALWAYS hold in the Mingla codebase. Every invariant lists
> (a) the rule, (b) the enforcement mechanism, (c) the test that catches a
> regression. When a change breaks one of these, the severity is raised
> and a structural fix is required — not a patch.

---

## ORCH-0558 invariants (2026-04-21) — Collab match promotion

### I-MATCH-PROMOTION-DETERMINISTIC

**Rule:** Meeting the collab quorum threshold (≥2 right-swipes on the same
experience in the same session) MUST produce exactly one
`board_saved_cards` row, regardless of concurrency or timing.

**Enforcement:**
- Advisory lock on `(session_id, experience_id)` at check_mutual_like
  trigger entry (migration `20260421000003_orch_0558_trigger_v3.sql`)
- Unique index `board_saved_cards_session_experience_unique` on
  `(session_id, experience_id)` (migration `20260421000002`)
- `INSERT … ON CONFLICT (session_id, experience_id) DO NOTHING` in the
  promotion path — losers fall into attach-vote branch

**Test:** `supabase/tests/concurrency/collab_match_race.sql` — 100-run
harness with dblink-spawned concurrent transactions; exactly 1 saved_card
and exactly N votes per run. Orchestrator Close gate.

### I-BOARD-SAVED-CARDS-EXPERIENCE-ID-NOT-NULL

**Rule:** No row in `board_saved_cards` may have `experience_id = NULL`.
Historical ghosts were cleaned up in migration `20260421000001`.

**Enforcement:** `ALTER TABLE board_saved_cards ALTER COLUMN experience_id
SET NOT NULL` (migration `20260421000002`).

**Test:** `SELECT count(*) FROM board_saved_cards WHERE experience_id IS
NULL` must always return 0. Any INSERT with NULL fails with `23502`.

### I-CHECK-FOR-MATCH-COLUMN-ALIGNED

**Rule:** Any code that determines "was this card promoted in this
session?" must use the same semantics as the trigger's existence check.
Post-ORCH-0558 the single server authority is
`rpc_record_swipe_and_check_match`; no client-side `board_saved_cards`
query determines match state.

**Enforcement:**
- `BoardCardService.checkForMatch` removed
- Client-side match detection goes through the RPC only

**Test:** `git grep -n "'experience_id'" app-mobile/src/services/boardCardService.ts`
must return zero lines within 20 lines of a `.from('board_saved_cards')`
match-intent read. Enforced during code review.

### I-MATCH-NOTIFICATION-FAILS-OPEN

**Rule:** If push delivery fails or is disabled, in-app notification
still fires. If in-app fails, the match toast still fires (client-local,
no external dependency).

**Enforcement:**
- `notify-dispatch` INSERTs the `notifications` row BEFORE attempting
  push (existing behavior verified 2026-04-21). The
  `useNotifications` hook subscribes via Supabase Realtime and surfaces
  new matches in-app instantly.
- `notify-session-match` emits `collab_match_notification_delivered`
  per successful in-app insert and `collab_match_notification_failed`
  per dispatch error.
- `collabSaveCard` match toast is client-local — fires from local RPC
  response, independent of push/edge-fn availability.

**Test:** Device test with airplane mode toggled after the RPC returns
matched=true — match toast still fires on the matcher's device. Non-matcher
participants see the `notifications` row via Realtime INSERT as soon as
network returns.

### I-REALTIME-COLD-FETCH-PARITY

**Rule:** Session Cards tab shows the same set of saved cards whether
reached via realtime INSERT event or via cold-open fetch.

**Enforcement:**
- `SessionViewModal.loadSavedCards` runs on modal open (cold fetch)
- `onCardSaved` realtime subscription updates on board_saved_cards INSERT
- `onMatchPromoted` (board_votes INSERT) belt catches missed INSERT
  events with a 1s debounced refetch
- Ghost rows eliminated by migration 000001, so saved_at DESC ordering
  stops hiding fresh matches behind stale entries

**Test:** Device test — match occurs while user is on Home tab, then
opens Cards tab cold — card must be present.

### I-COLLAB-MATCH-OBSERVABLE

**Rule:** Every attempted match promotion emits a telemetry event with a
machine-readable reason — engineering sees failures in production without
waiting for user reports.

**Enforcement:**
- `match_telemetry_events` table (migration 000004) receives events from:
  - `check_mutual_like` trigger (every decision path)
  - `rpc_record_swipe_and_check_match` RPC (attempt events)
  - `notify-session-match` edge fn (delivered / failed)
- Mobile `collabSaveCard` mirrors outcomes to Mixpanel
  (`Collab Match Attempt`, `Collab Match Promotion Success`,
  `Collab Match Promotion Skipped`, `Collab Match RPC Error`)

**Test:** After a successful match,
`SELECT count(*) FROM match_telemetry_events WHERE session_id = X AND
event_type = 'collab_match_promotion_success'` returns exactly 1.
Mixpanel shows the mirror events in the product funnel.

---

## Carried invariants (preserved from prior ORCH work)

- **I-02 One owner per truth** — no two systems authoritatively describe
  the same state. ORCH-0558: RPC is the single server authority for
  match state; client has no independent match-detection query path.
- **I-03 No silent failures** — every catch block surfaces the error via
  toast, telemetry, or console.warn. ORCH-0558 preserves this across the
  new RPC call, the rewired `collabSaveCard`, and the edge fn telemetry.
- **I-08 Subtract before adding** — `saveCardToBoard` and `checkForMatch`
  were removed entirely, not deprecated and left in place. No dead code
  paths left behind.
- **I-11 One auth instance** — RPC uses `auth.uid()` and validates
  against `session_participants.has_accepted`. No separate auth layer.
- **I-TRIGGER-READS-CURRENT-SCHEMA** — `check_mutual_like` must never
  reference a dropped table (ORCH-0556 origin). Enforced by the periodic
  `supabase/tests/concurrency/collab_match_race.sql` run, which would
  fail on 42P01.

---

## ORCH-0646 invariants (2026-04-23) — Column-drop cleanup discipline

### I-COLUMN-DROP-CLEANUP-EXHAUSTIVE

**Rule:** Any migration that drops a column (or renames a materialized-view
projection) MUST be paired with grep gates before its cutover migration is
considered ready:

1. Grep `mingla-admin/src/` for the dropped column name — ZERO matches.
2. Grep `app-mobile/src/` for the dropped column name — ZERO matches.
3. Grep `supabase/functions/` for the dropped column name — ZERO matches
   (allowing deletion-proving comments like `// ORCH-XXXX ch13: COLUMN dropped`).
4. Inspect every function body in `public` schema via
   `SELECT pg_get_functiondef(oid) FROM pg_proc` grep for the column name —
   ZERO matches (or only in functions scheduled for drop in the same cutover).

**Enforcement:** CI script `scripts/ci-check-invariants.sh` covers gates
(1)-(3) at the source-tree level. Gate (4) is a manual pre-cutover check
until there's automation against live DB.

**Origin:** ORCH-0640 dropped `place_pool.ai_approved` on 2026-04-23 with
mobile cleanup verified and 14 admin RPCs rewritten, but six other RPCs and
23 admin JSX sites were missed. Admin Place Pool + Signal Library broke in
prod for hours until the user surfaced it. CLOSE Grade A was awarded without
admin smoke because the tester matrix was mobile-only. ORCH-0646 completed
the cleanup and registered this invariant so column drops never again ship
with missing surface coverage.

**Regression test:** The CI script runs on every push. Any new
`ai_approved` / `ai_override` / `ai_validated` reference introduced in
`mingla-admin/src/`, `app-mobile/src/`, or the four serving edge functions
fails the gate (exit 1).

**Manual pre-cutover check (example template):**
```bash
COLUMN="ai_approved"
for DIR in mingla-admin/src/ app-mobile/src/ supabase/functions/; do
  MATCHES=$(grep -rn "$COLUMN" "$DIR" | grep -vE '\.md$' || true)
  if [ -n "$MATCHES" ]; then
    echo "FAIL: $COLUMN still referenced in $DIR:"
    echo "$MATCHES"
    exit 1
  fi
done
```
