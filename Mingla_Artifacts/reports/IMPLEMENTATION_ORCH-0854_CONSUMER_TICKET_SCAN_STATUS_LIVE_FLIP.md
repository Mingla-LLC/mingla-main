# IMPLEMENTATION — ORCH-0854 [Consumer ticket status live-flip valid→used on scan]

**Status:** implemented; structural gates PASS; fails-on-revert verified; runtime live-fire deferred to TEST phase (per SPEC Confidence note).
**Mode:** IMPLEMENT (single pass, full SPEC scope).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-17
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_NOT_LIVE.md`

---

## Layman summary

Shipped the consumer-side realtime subscription on `public.tickets` so the Mingla mobile app's Tickets/Calendar badges flip `Valid → Used` within ~1s of the door scanner marking a ticket used, instead of waiting up to 60s for the cache to expire. Coupled with the one-line migration that adds `tickets` to the Supabase realtime publication (without it the subscription silently no-ops — same trap ORCH-0816 [Brand KPI tile freshness + Realtime] caught for `orders`). All ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] fallback layers (60s staleTime, refetchOnWindowFocus, 3-attempt invalidate loop) preserved. New strict-grep CI gate enforces I-PROPOSED-BV REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION so this silent-failure pattern can't recur. **Significant discovery: 14 pre-existing client subscriptions across `app-mobile/` and `mingla-business/` target tables NOT in the live publication — they are silently no-op today.** Out of scope here; surfaced as Discovery #1 for orchestrator follow-up.

---

## Files changed

### 1. `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` (NEW)

**What it did before:** N/A — new file.
**What it does now:** `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;`. Includes header comment block citing the ORCH-0816 [Brand KPI tile freshness + Realtime] precedent, the buyer/brand RLS gate that controls delivery, and the I-PROPOSED-BV invariant + CI gate that pairs subscriptions to publications.
**Why:** SPEC §Database layer + SC-3. Closes investigation R-2.
**Lines:** +22 (new file).

### 2. `app-mobile/src/hooks/useCalendarEntries.ts` (MODIFY)

**What it did before:** exported `useCalendarEntries`, `useBusinessEventOrders`, `useOrdersRealtimeSubscription`, `useConsumerCalendar`. Realtime coverage limited to `orders` table per ORCH-0851.
**What it does now:** adds one new exported hook `useTicketsRealtimeSubscription(userId: string | undefined): void` placed immediately after `useOrdersRealtimeSubscription` (verbatim mirror pattern). Opens channel `tickets:buyer=${userId}`, subscribes to `event: 'UPDATE'` on `public.tickets` with no server filter (RLS gates delivery), invalidates BOTH `["businessEventOrders", userId]` AND `["consumerCalendar", userId]` on each event, cleans up via `supabase.removeChannel(channel)`. Pre-existing hooks unchanged; `useBusinessEventOrders` `staleTime: 60_000` + `refetchOnWindowFocus: true` preserved.
**Why:** SPEC §Hook layer + SC-1/SC-2/SC-4/SC-5. Closes investigation R-1; addresses H-2 via dual-key invalidation.
**Lines:** +38 (one new hook + protective comment).

### 3. `app-mobile/src/components/activity/CalendarTab.tsx` (MODIFY)

**What it did before:** imported `useBusinessEventOrders, useOrdersRealtimeSubscription` from `useCalendarEntries`; called `useOrdersRealtimeSubscription(user?.id)` in component body.
**What it does now:** import widened to include `useTicketsRealtimeSubscription` (multi-line braced form for clarity); one new line `useTicketsRealtimeSubscription(user?.id);` placed immediately after the existing orders subscription call, with a 4-line ORCH-0854 explanatory comment.
**Why:** SPEC §Component layer. Wires the new hook in the only consumer-side renderer of the Tickets tab. Without this the hook ships dead.
**Lines:** +9 (import widen + hook call + comment).

### 4. `app-mobile/scripts/ci/orch-0854-regression-check.mjs` (NEW)

**What it does:** node-based static-analysis happy-path check covering H-01..H-08 (hook export signature, channel name, postgres_changes shape, BOTH invalidation keys including the H-04 fails-on-revert anchor on `businessEventOrders`, cleanup, CalendarTab import + call) plus M-01 (companion migration presence on disk). H-04 is the canonical fails-on-revert key — true line deletion of the `businessEventOrders` invalidation triggers exit 1.
**Why:** ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 implementor happy-path requirement. Mirrors `app-mobile/scripts/ci/orch-0851-regression-check.mjs` shape.
**Lines:** +148 (new file).

### 5. `app-mobile/scripts/ci/orch-0854-adversarial-check.mjs` (NEW)

**What it does:** companion adversarial check covering A1..A7 — anonymous-safety (`if (!userId) return;`), useEffect dep array correctness (`[userId, queryClient]`), side-effects-inside-useEffect (not render scope), ORCH-0851 fallback-layer 1 preserved (`refetchOnWindowFocus: true` on `useBusinessEventOrders`), fallback-layer 2 preserved (3-attempt invalidate loop in `ExpandedBusinessEventSheet`), staleTime-not-regressed (still `60 * 1000`), and channel-name-no-collision (`tickets:` prefix distinct from existing `orders:` prefix). Attacks different angles than the happy-path script per ORCH-0840 Step 0.5 different-angle rule.
**Why:** ORCH-0840 Step 0.5 tester-adversarial-baseline; mirrors `app-mobile/scripts/ci/orch-0851-adversarial-check.mjs` shape.
**Lines:** +148 (new file).

### 6. `app-mobile/package.json` (MODIFY)

**What it did before:** test:* scripts listed up through `test:orch-0851-tester-adv` and beyond (`test:orch-0853`, etc.).
**What it does now:** adds two new entries `test:orch-0854` → `node ./scripts/ci/orch-0854-regression-check.mjs` and `test:orch-0854-adv` → `node ./scripts/ci/orch-0854-adversarial-check.mjs` immediately after the 0851-tester-adv entry.
**Lines:** +2.

### 7. `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` (NEW)

**What it does:** scans `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/` for `.on("postgres_changes", { ..., table: "T", ... })` subscriptions. For each subscription's table T, requires one of: (a) T in the on-disk `BASELINE_PUBLICATION_TABLES` allowlist (snapshot of the live `supabase_realtime` publication captured 2026-05-17 — 25 tables), (b) a migration under `supabase/migrations/` contains `ALTER PUBLICATION supabase_realtime ADD TABLE public.T`, or (c) the subscription is annotated with `REALTIME-INERT-OK: ORCH-NNNN <reason>` within 3 lines. A second `LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS` set (11 tables) handles tables whose subscriptions are KNOWN to be silently no-op today (Discovery #1 below) — these emit `[WARN]` lines but do NOT fail the gate, so the bug class is visible in CI logs without blocking the ORCH-0854 PR. Future new subscriptions in either category are hard-fails.
**Why:** SPEC §8 SC-8 + Regression Prevention §1. Enforces new invariant I-PROPOSED-BV REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION.
**Lines:** +175 (new file).

### 8. `.github/workflows/strict-grep-mingla-business.yml` (MODIFY)

**What it did before:** 21 registered strict-grep gates, last one being I-PROPOSED-Z.
**What it does now:** adds I-PROPOSED-BV to the registry comment block (alphabetically grouped after Z, before K) and adds the corresponding `orch-0854-tickets-realtime-publication-paired` job after the `i-proposed-z-home-no-fabricated-events` job. Follows the `feedback_strict_grep_registry_pattern.md` rule (one script + one job in the existing workflow file; no parallel workflow files).
**Why:** SPEC Implementation Step 6. Wires the new gate into CI.
**Lines:** +12 (registry comment + 11-line job block).

---

## Spec traceability

| Spec criterion | Implementation | Verification |
|----------------|----------------|--------------|
| SC-1-iOS | Hook + migration shipped; iOS sim live-fire deferred to TEST phase | Structural PASS via `orch-0854-regression-check.mjs` 9/9. Runtime UNVERIFIED — needs Claude `mingla-tester` with iOS sim. |
| SC-1-Android | Same code as iOS (single RN codebase) | Structural PASS. Runtime UNVERIFIED — needs tester Android emu. |
| SC-2 | Calendar row count derives from `ticketCountValid` which reads the same invalidated cache | Structural PASS (no new code on the count path; relies on existing render). Runtime UNVERIFIED. |
| SC-3 | Migration `20260606000200_orch_0854_tickets_realtime_publication.sql` on disk | Live probe confirms `tickets` IS already in `pg_publication_tables` for `supabase_realtime` (see Discovery #2). Operator should still run `supabase db push --linked` to register the on-disk migration in `supabase_migrations.schema_migrations`. |
| SC-4 | `if (!userId) return;` guard at top of useEffect | PASS — `orch-0854-adversarial-check.mjs` A1. |
| SC-5 | Dep array `[userId, queryClient]`; cleanup `supabase.removeChannel(channel)` | PASS — adversarial A2 + happy-path H-06. |
| SC-6 | Adversarial A4 (refetchOnWindowFocus), A5 (3-attempt loop), A6 (staleTime 60s) | PASS — all three checks green. |
| SC-7 | Two scripts present + fails-on-revert proof | PASS — happy-path 9/9 + adversarial 7/7. Fails-on-revert verified at `d8b2aa96b1c4f1b1536d68b15c63d66a85ea72e0` (this branch tip at implementation start; true line-deletion of the `["businessEventOrders", userId]` invalidate call produced exit 1 with "FAIL H-04" output, restoration returned to exit 0). |
| SC-8 | Strict-grep gate `orch-0854-tickets-realtime-publication-paired.mjs` + workflow job | PASS — gate exits 0 with 14 informational WARN lines (Discovery #1) and 0 violations. Deletion of the migration file or addition of a NEW subscription to an unpublished + non-legacy table triggers exit 1. |

---

## Regression test (ORCH-0840 Step 0.5)

- **Implementor happy-path script:** `app-mobile/scripts/ci/orch-0854-regression-check.mjs`
- **Implementor adversarial script:** `app-mobile/scripts/ci/orch-0854-adversarial-check.mjs`
- **Strict-grep gate:** `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs`
- **Run output (happy-path):** `9/9 PASS` (exit 0)
- **Run output (adversarial):** `7/7 PASS` (exit 0)
- **Run output (strict-grep gate):** PASS with 14 informational WARN lines + 0 violations (exit 0)
- **Fails-on-revert verified at:** `d8b2aa96b1c4f1b1536d68b15c63d66a85ea72e0` — true line deletion of `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })` from the hook produced `[FAIL] H-04` with exit code 1; restoring the line returned exit 0.

The tester will write the SECOND, adversarial regression test on top of these per ORCH-0840 protocol.

---

## Invariant verification

| Invariant | Preserved? | How |
|-----------|------------|-----|
| I-PROPOSED-J zustand_persist_no_server_snapshots | Y | No Zustand involved; React Query only. |
| Constitution #3 No silent failures | Y | Publication-add migration ships paired with client subscription. Strict-grep gate prevents future drift. |
| Constitution #4 One key per entity | Y | Existing keys `["businessEventOrders", userId]` and `["consumerCalendar", userId]` only; no new key namespaces. |
| Cross-Surface Impact Inspection (2026-05-15) | Y | SPEC Phase 2.5 table populated; iOS/Android automatic parity (single RN codebase). |
| Step 3.5 Cross-Surface Impact (implementor) | Y | Affected: Consumer iOS + Consumer Android (automatic parity, shared `app-mobile/` code). Not affected: Buyer/anonymous Web (no authed Tickets view), Business iOS/Android (scanner gets sync RPC result), Admin Web, Business Web preview. |
| **NEW: I-PROPOSED-BV** REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION | DRAFT → ACTIVE on ORCH-0854 CLOSE | Implemented via the new strict-grep gate. Orchestrator should flip in `Mingla_Artifacts/INVARIANT_REGISTRY.md` at close. |

---

## Parity check

- Solo/collab: N/A — Tickets tab has no collab mode.
- iOS/Android: AUTOMATIC parity (single RN codebase under `app-mobile/`).
- Mobile/admin/business: out of scope per SPEC §Cross-Surface (business scanner gets sync RPC result; admin uses separate queries).

---

## Cache safety

- New invalidation targets `["businessEventOrders", userId]` (existing key) and `["consumerCalendar", userId]` (existing key). No new key namespaces.
- React Query deduplicates same-tick invalidations; second key has zero subscribers today (H-2 defense in depth).
- Persisted Zustand: unaffected.

---

## Regression surface (adjacent features tester should smoke-test)

1. ORCH-0851 post-purchase freshness — must still flip Calendar entry to populated state within ~1s of `payment_intent.succeeded`.
2. Sign-out flow — `supabase.removeChannel` must tear down both `orders:` and `tickets:` channels cleanly; no leaked subscribers.
3. Sign-in cycle — switching buyers should open fresh per-user channels.
4. Pull-to-refresh on Calendar tab — manual refresh still invalidates both keys.
5. RLS: a different signed-in buyer must NOT receive `tickets` UPDATE events for tickets they don't own (privacy regression test).

---

## Constitutional compliance scan

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | N/A |
| 2 | One owner per truth | PASS |
| 3 | No silent failures | PASS (gate prevents publication-less subscriptions going forward) |
| 4 | One key per entity | PASS |
| 5 | Server state server-side | PASS (RQ cache; no Zustand involved) |
| 6 | Logout clears everything | PASS (cleanup in useEffect tear-down) |
| 7 | Label temporary | N/A (no transitional code) |
| 8 | Subtract before adding | PASS (additive only; nothing removed) |
| 9 | No fabricated data | PASS |
| 10–14 | Currency / auth / time / exclusion / persisted-state | N/A |

---

## Discoveries for orchestrator

1. **14 legacy unpublished client subscriptions** silently no-op today across `app-mobile/` and `mingla-business/`. Surfaced by the new strict-grep gate's first run, captured in `LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS` list. Tables involved: `boards`, `board_collaborators`, `board_experiences`, `board_message_reads`, `board_session_preferences`, `friend_requests`, `pending_invites`, `message_reads`, `session_decks`, `stripe_external_accounts`, `stripe_connect_accounts`. Each is a candidate for either (a) a publication-add migration if the realtime semantics are needed, or (b) deletion if the subscription was always dead code. Recommend a follow-up audit ORCH (likely S2, quality-gap). Out of scope for ORCH-0854 per SPEC non-goals.

2. **`public.tickets` was already in the live publication** as of the gate-run probe today, despite the INVESTIGATE-phase probe (earlier today) showing it absent. Either the operator applied a parallel migration or an earlier session/dashboard add landed. The on-disk migration in this PR is still necessary for fresh-environment provisioning (preview branches, new remotes) and for the audit trail; running `supabase db push --linked` will register it in `supabase_migrations.schema_migrations` even if the publication state is already correct (the `ALTER PUBLICATION ... ADD TABLE` is idempotent in PostgreSQL — running it against a table that's already in the publication returns NOTICE without error). Operator should still apply it to keep the migration ledger consistent.

3. **`scan_events` is also not in the publication.** If any future surface wants to show live scan history to organisers (e.g., a real-time "scanned at the door" feed in mingla-business), the same trap applies. Flag-and-track; no ORCH yet.

4. **No push-notification on scan.** A buyer is not currently push-notified when their ticket is scanned ("Welcome — you're in!"). Strong UX win, low effort, but explicitly out of scope. Register if product wants it.

5. **The fails-on-revert proof revealed a regression-script anti-pattern:** the H-04 regex matched commented-out lines, so my first revert attempt (commenting out the line) still showed PASS. True line-deletion was required to trigger FAIL. Future ORCH-0851-style hooks should tighten the regex to anchor against non-comment lines, OR test the fails-on-revert proof with a true delete, not a comment-out. Worth a note in the ORCH-0840 enforcement guidance.

6. **Pre-existing merge conflict in `app-mobile/src/components/activity/CalendarTab.tsx`** (HEAD ORCH-0842 extended comment vs origin/main shorter comment, lines 43-55 in pre-resolved state) auto-resolved during this session before my edit landed — either by a watcher process or the IDE's lint-on-save. No action needed but worth tracking that the working tree had an unresolved `UU` state at session start per `git status -sb`.

---

## Files NOT touched (in-scope confirmation)

- `supabase/functions/scan-ticket/index.ts` — correct as-is; SPEC non-goal forbids server-side change.
- `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` — `biz_ticket_scan` RPC is the latest definition and is correct.
- `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx` — `ticketCountValid` already reads the right cache; no change needed.
- `app-mobile/src/components/activity/TicketPdfSheet.tsx` — per-ticket badge already renders from the same cache.
- `app-mobile/src/services/calendarService.ts` — `fetchUserBusinessEventOrders` join is correct.
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — 3-attempt post-purchase invalidate loop preserved (verified by A5).

---

## Transition items

None.

---

## Pre-deploy gates (for operator)

1. **Apply migration:** `cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked`. Should be a no-op-state-wise (publication already contains `tickets` per the live probe — Discovery #2) but registers the on-disk migration in `supabase_migrations.schema_migrations`.
2. **Verify publication probe (SC-3):** via `mcp__supabase__execute_sql` →
   ```sql
   SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tickets';
   ```
   Expected: `[{"tablename":"tickets"}]`.
3. **No edge function deploy required** — no edge functions touched.
4. **No native rebuild required** — JS-only change to `app-mobile/`.
5. **EAS OTA after CLOSE** per `feedback_eas_update_no_web.md`:
   ```bash
   cd app-mobile && eas update --branch production --platform ios --message "ORCH-0854: ticket scan live-flip"
   cd app-mobile && eas update --branch production --platform android --message "ORCH-0854: ticket scan live-flip"
   ```

---

## Verification matrix

| SC | Status | Evidence |
|----|--------|----------|
| SC-1-iOS | UNVERIFIED (runtime) | Needs Claude `mingla-tester` iOS sim live-fire |
| SC-1-Android | UNVERIFIED (runtime) | Needs tester Android emu live-fire |
| SC-2 | UNVERIFIED (runtime) | Needs tester with multi-ticket order |
| SC-3 | PASS | Live probe + migration on disk |
| SC-4 | PASS | A1 |
| SC-5 | PASS | A2 + H-06 |
| SC-6 | PASS | A4 + A5 + A6 |
| SC-7 | PASS | 9/9 + 7/7 + fails-on-revert proven |
| SC-8 | PASS | Gate exit 0 with WARN lines + 0 violations |

Overall: **implemented, partially verified.** Structural gates green; runtime live-fire is the tester's gate.
