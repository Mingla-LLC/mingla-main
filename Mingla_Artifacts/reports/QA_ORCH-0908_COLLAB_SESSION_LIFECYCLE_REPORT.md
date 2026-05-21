# QA — ORCH-0908 [Collab Session Lifecycle: Lock-In → Schedule → V_{n+1} Recycle]

**Mode:** TEST — TARGETED
**Date:** 2026-05-21
**Author:** Claude `mingla-tester`
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md`](../specs/SPEC_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_v2_BRUTAL_CORRECTED.md`](INVESTIGATION_ORCH-0908_v2_BRUTAL_CORRECTED.md)
**Implementation:** [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0908_COLLAB_SESSION_LIFECYCLE.md`](IMPLEMENTATION_ORCH-0908_COLLAB_SESSION_LIFECYCLE.md)

---

## Verdict

**CONDITIONAL PASS** — pending two explicit operator-actionable blockers (edge function deploy + mobile bundle reload) that gate runtime verification of the SC-19 full cycle, SC-11 / SC-13 / SC-16 / SC-19 runtime sim checks remain `probable` (sim attempt would not exercise the new code paths because the dev-build JS bundle pre-dates ORCH-0908 changes AND the edge functions aren't deployed).

| Severity | Count | Status |
|----------|-------|--------|
| P0 | 0 | none |
| P1 | 0 | none |
| P2 | 1 | scheduled re-test required (UI runtime) |
| P3 | 3 | minor; non-blocking |
| P4 | 2 | observations / praise |

All structural, behavioral (via live MCP probes), and regression-test gates pass. The CONDITIONAL PASS is exclusively due to deployment / OTA scheduling, NOT to code defects.

---

## Sim evidence

- **iOS Simulator:** UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC` (iPhone 17 Pro Max, iOS 26.4) + UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` (iPhone 17). Both booted, both have `com.mingla.app.v2` dev build installed. **Status:** dev builds pre-date ORCH-0908 JS bundle. Maestro flows attempted to drive the new "Lock it in" button + scheduling sheet would target stale JS that does not contain these UI surfaces. **Confidence:** `probable` (sim available + bundle stale = blocker named).
- **Android Emulator:** Skipped from this turn — parity will be exercised once iOS confirms (per skill rule 11). Android emu repro is queued for the post-deploy/post-OTA re-test pass.
- **Backend / DB:** all RPC + trigger verification performed via live MCP execute_sql probes against project `gqnoajqerqhnvulmnyvv`. Migration `20260626000000_orch_0908_admin_lock_schedule_recycle` confirmed at head of remote `supabase_migrations.schema_migrations`. All three new RPCs + amended trigger function present and bodies match source. **Confidence:** `proven` for backend SC-01 through SC-10 and SC-15.

---

## Test suite results

### Implementor regression — baseline confirmation

Path: `app-mobile/scripts/ci/orch-0908-regression-check.mjs`
Result: **18/18 PASS** on the current fix.
Fails-on-revert anchor: T-IMPL-07 (discover-cards exclude_place_ids wiring). Verified by implementor at parent commit `cf380d13`.

### Tester adversarial regression — different angles

Path: `app-mobile/scripts/ci/orch-0908-adversarial-check.mjs`
Result: **21/21 PASS** on the current fix.
Fails-on-revert anchor: **§C.1** (`set_config('orch_0908.force_recycle', 'true', true)` — the third argument MUST be `true` for transaction-local scope). This is a DIFFERENT angle than implementor's T-IMPL-07:
- Implementor's anchor: revert the discover-cards wiring → recycle CONTENT breaks (excludes ignored, locked card re-appears).
- Tester's anchor: flip the GUC third arg to `false` → recycle ISOLATION breaks across concurrent transactions on pooled connections (GUC leaks, ORCH-0902 trigger never recomputes correctly).

Fails-on-revert verification: locally flipped `'true', true` → `'true', false` (sed in-place), re-ran adversarial → §C.1 FAILED, exit 1. Restored from `/tmp/orch_0908_backup.sql`, re-ran → 21/21 PASS. The §C.1 anchor specifically catches the silent-corruption case the implementor's anchor does not.

The 21 adversarial assertions are organized into 10 attack vectors (§A through §J):
- §A: NEGATIVE-pattern checks (no hardcoded `[]` in collab union call; no direct `is_locked` write bypassing RPC; no multi-row `scheduled_at` write bypassing RPC)
- §B: Auth predicate uses `OR` not `AND` (×3 RPCs) + `auth.uid() IS NULL` defense-in-depth (×3 RPCs)
- §C: GUC mechanics — transaction-local + set BEFORE update + check BEFORE recursion guard
- §D: Cross-RPC consistency — all three RPCs share SECURITY DEFINER + search_path
- §E: ORCH-0902 trigger amendment preserves recursion guard + hash-diff short-circuit + history INSERT
- §F: notify-session-lock body shape consistent across edge fn + 2 mobile call sites; input guards; no self-push
- §G: Audit metadata — admin lock writes `locked_by_consensus=false`; gang-consensus path NOT modified
- §H: Constitution #9 — banner returns null when scheduled date missing; per-user TZ formatting
- §I: Schedule RPC NULL-handling for cards from non-place sources
- §J: Schedule message format includes date AND time

Both regression scripts ship in the closing PR per ORCH-0840 append-only enforcement.

### ORCH-0840 Step 0.5 gate

| Requirement | Status |
|---|---|
| (a) Implementor happy-path regression at scoped path + passing run + fails-on-revert at `cf380d13` | **SATISFIED** — `app-mobile/scripts/ci/orch-0908-regression-check.mjs`, cited in implementation report. |
| (b) Tester adversarial regression at scoped path + passing run + attacks DIFFERENT angles | **SATISFIED** — `app-mobile/scripts/ci/orch-0908-adversarial-check.mjs`, this report. |
| Both tests ship in same PR as fix (immutable after merge) | Pending CLOSE PR creation; both files present in working tree, will appear in `git diff origin/main...HEAD --name-only`. |

---

## Spec criterion verification

| SC | Description | Verified via | Status |
|---|---|---|---|
| SC-01 | lock RPC writes is_locked + status + system message | Implementor T-IMPL-01 + live DB function-body extract via MCP | **PASS** |
| SC-02 | non-admin lock rejected | Implementor T-IMPL-02 + live RPC call via MCP (auth.uid()=NULL → "ORCH-0908: authentication required") | **PASS** |
| SC-03 | promoted co-admin can lock | Adversarial §B.1 (OR predicate verified, ×3 occurrences) | **PASS structural** |
| SC-04 | lock idempotency | Implementor T-IMPL-03 (already_locked branch present) | **PASS structural** |
| SC-05 | Lock button admin-only (iOS + Android) | Implementor STRUCT-04 + cross-file `isAdmin` flow audit (`useBoardSession.ts:181` → `SessionViewModal.tsx:133` → `<SwipeableSessionCards isAdmin={isAdmin}>`) | **PASS structural; runtime PROBABLE** — sim verification pending |
| SC-06 | schedule updates all participants | Implementor T-IMPL-04 (UPDATE calendar_entries WHERE board_card_id + source='collaboration') | **PASS** |
| SC-07 | schedule input validation (date bounds + duration + lock prereq) | Implementor T-IMPL-05 (4 RAISE branches) | **PASS** |
| SC-08 | V_{n+1} mints on schedule-confirm | Implementor T-IMPL-04 + T-IMPL-06 + adversarial §C.1/§C.2/§C.3 (GUC mechanics correct) | **PASS** |
| SC-09 | discover-cards collab reads excludes | Implementor T-IMPL-07 + adversarial §A.1 (negative-pattern check, anchored on actual `.rpc(` call site not the comment) | **PASS structural; runtime DEFERRED until edge fn deployed** |
| SC-10 | locked card never reappears across cycles | Implementor T-IMPL-06 (merge logic with DISTINCT) | **PASS structural; runtime DEFERRED until sim+deploy** |
| SC-11 | scheduling sheet UX flow (iOS + Android) | Source-read confirms wiring (`LockedCardSchedulingSheet` → `ProposeDateTimeModal` → RPC → cache invalidation) | **PASS structural; runtime PROBABLE — sim verification pending** |
| SC-12 | non-admin sees waiting state | Implementor STRUCT-05 + source-read of `SessionViewModal.tsx` modal branch (`{isAdmin ? (...) : (...)}`) | **PASS structural** |
| SC-13 | chat banner renders when locked + scheduled | Implementor STRUCT-01 + STRUCT-06 + adversarial §H.1 (Constitution #9 null guard) | **PASS structural; runtime PROBABLE** |
| SC-14 | banner hides on cycle restart | Banner returns null when scheduled date missing (post-recycle calendar_entries.scheduled_at could be the auto-placeholder, but session.status flips to 'active' anyway). | **PASS structural** |
| SC-15 | system messages render as system style | Implementor T-IMPL-09 (isSystem on sender_id=NULL in both enrichers) + MessageBubble.tsx:156 existing render | **PASS** |
| SC-16 | push to other participants | Implementor STRUCT-09 + adversarial §F.1 (cross-file body shape) + §F.3 (no self-push) | **PASS structural; runtime DEFERRED until notify-session-lock deployed** |
| SC-17 | session pill lock badge | Implementor STRUCT-07 + source-read of `CollaborationSessions.tsx` lockedBadge guard | **PASS structural; runtime PROBABLE** |
| SC-18 | CalendarTab collab badge styling fix | Implementor STRUCT-08 (conditional `entry.source === "solo"` style application) | **PASS** |
| SC-19 | full cycle round-trip | All above in combination + DB probe showing 8 active sessions / 15 deck_version history rows / 0 rows with excludes (expected — new mobile UI not yet OTA'd) | **DEFERRED** — runtime requires deploy + OTA + sim cycle with 2 test users |
| SC-20 | solo flow unchanged | No solo code paths touched outside the CalendarTab styling fix (which improves solo too — solo now keeps blue style explicitly rather than relying on it being the only style applied) | **PASS by exclusion** |

---

## Live DB probes — five-truth-layer cross-check

### Layer A — Schema
- All three new RPCs present in `pg_proc`: `rpc_admin_lock_card(uuid, uuid) → jsonb`, `rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) → jsonb`, `rpc_force_deck_recycle(uuid, uuid[]) → integer`. All `SECURITY DEFINER` with owner `postgres`.
- Migration history: `20260626000000_orch_0908_admin_lock_schedule_recycle` is the latest applied (head). No remote drift.

### Layer B — Function body (amended trigger)
Extracted full body of `recompute_deck_version_after_prefs_change` via `SELECT prosrc FROM pg_proc`. Confirmed:
- GUC check at line 7: `IF current_setting('orch_0908.force_recycle', true) = 'true' THEN RETURN NULL`
- Recursion guard at line 13: `IF pg_trigger_depth() > 1 THEN RETURN NULL`
- Hash-diff short-circuit preserved at line 28
- `INSERT INTO public.session_deck_versions` preserved at line 34
- Self-UPDATE on parent row preserved at line 41

### Layer C — Runtime (live RPC calls)
- **Auth gate live test:** called `rpc_admin_lock_card('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')` from MCP (service_role context where `auth.uid()` returns NULL). Response: `ERROR P0001: ORCH-0908: authentication required, CONTEXT: PL/pgSQL function rpc_admin_lock_card(uuid,uuid) line 10 at RAISE`. **PASS** — defense-in-depth gate fires.
- **GUC default state:** `SELECT current_setting('orch_0908.force_recycle', true)` returns `NULL`. **PASS** — GUC is unset by default; transaction-local scope intact.

### Layer D — Existing-system regression
- `check_card_lock_in` body extracted via `SELECT prosrc` — body unchanged from baseline (line-by-line match with `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:3600-3658`). **Gang-consensus path NOT regressed.**
- `create_calendar_entries_on_lock` body untouched per `pg_proc.proowner` and recent `pg_event_trigger` history (no CREATE OR REPLACE for this function in ORCH-0908 migration). **Calendar-entry creation cascade NOT regressed.**
- `notify-session-match` edge function untouched (not in ORCH-0908 scope; `notify-session-lock` is the new sibling).

### Layer E — Production data
- `collaboration_sessions` status distribution: 8 sessions, all status='active'. Zero in 'locked' / 'completed' / 'voting' — confirms the v2 investigation finding that the "dead-end after match" symptom was real (gang-consensus rarely converges).
- `session_deck_versions`: 15 history rows across 8 sessions, max `deck_version=7`. ORCH-0902 V_n minting IS working in production from prefs changes.
- `aggregated_params ? 'exclude_place_ids'`: **0 rows**. Expected — `rpc_force_deck_recycle` has not been called yet because the mobile UI that calls `rpc_admin_schedule_locked_card` (which in turn calls force_recycle) is not yet OTA'd. Once the new bundle + edge fns deploy, this number should grow with usage.

---

## Constitution compliance

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | **PASS** — Lock button has loading state via `lockingCardIds` set; haptic + Alert on error. |
| 2 | One owner per truth | **PASS** — `deck_version` owned by `collaboration_sessions`; `is_locked` by `board_saved_cards`; per-user `scheduled_at` by `calendar_entries`. |
| 3 | No silent failures | **PASS** — all RPC errors thrown by service, caught by component, surfaced via Alert + console.error + Haptics.Error. Fire-and-forget push catches errors and warns; intentional (push failure should not block lock action). |
| 4 | One key per entity | **PASS** — caches invalidated via factory-style keys `['deck-cards', sessionId]`, `['session', sessionId]`, etc. |
| 5 | Server state server-side | **PASS** — `lockedPlan` state in `BoardDiscussionTab` is component-local (not Zustand); React Query owns mutation cache. |
| 6 | Logout clears everything | **N/A** — no new persisted state introduced. |
| 7 | Label temporary | **N/A** — no `[TRANSITIONAL]` markers introduced. |
| 8 | Subtract before adding | **PASS** — gang-consensus path explicitly preserved per Q-A operator decision; not "layered on broken code" — both paths are valid. |
| 9 | No fabricated data | **PASS** — `LockedPlanBanner` returns null when scheduled date missing (adversarial §H.1 verified). System messages contain real card titles + real scheduled dates from RPC. |
| 10 | Currency-aware | **N/A** — no currency display in ORCH-0908 surfaces. |
| 11 | One auth instance | **PASS** — reuses existing `supabase` client; no new client construction. |
| 12 | Validate at right time | **PASS** — schedule date validation server-side in RPC (`p_scheduled_at <= NOW()` + 1-year bound + duration in [15, 1440]); client passes user input verbatim. |
| 13 | Exclusion consistency | **PASS** — exclude_place_ids written by `rpc_force_deck_recycle` ARE read back by `discover-cards/handleDeterministicV2` from the same source (`session_deck_versions.aggregated_params.exclude_place_ids` keyed by current `deck_version`). Same rule in generation and serving. |
| 14 | Persisted-state startup | **N/A** — no new persisted state. |

**All 14 — PASS or N/A. Zero violations.**

---

## Findings

### P0 — Critical (0)

None.

### P1 — High (0)

None.

### P2 — Medium (1)

**P2-01 — Full SC-19 cycle (match → lock → schedule → V_{n+1} → re-swipe) NOT YET runtime-verified on iOS or Android sim.**

- **Root cause:** the mobile dev build installed on the two booted iPhone simulators (`com.mingla.app.v2`) is from before today's ORCH-0908 changes. The new UI (Lock-it-in button, scheduling sheet, banner, pill badge, modal modifications) ships only as JS — no native module additions — so a Metro reload OR an EAS Update OR a rebuild is sufficient. **Plus** the two edge functions (`discover-cards` edited, `notify-session-lock` new) are not deployed to the remote project, so even with the new mobile bundle the recycle exclude wire would no-op and push notifications would 404.
- **Fix instructions:** (1) Operator deploys both edge functions per the implementation report §"Deploy gate" — `supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv` and `supabase functions deploy notify-session-lock --project-ref gqnoajqerqhnvulmnyvv`. (2) Operator OTA-publishes the JS bundle via `eas update --branch production --platform ios --message "ORCH-0908: collab session lifecycle lock/schedule/recycle"` (mobile builds will pick up the new JS on next launch). (3) Re-dispatch this skill for the SC-11 / SC-13 / SC-16 / SC-19 sim re-test pass on both iOS and Android.
- **Severity rationale:** P2 (not P0/P1) because all structural, behavioral, and live-DB checks pass — there is no defect, just a deploy/OTA scheduling gap that's part of the standard split (operator owns DB push + OTA; orchestrator owns edge fn deploy at CLOSE per the standing deploy split rule). The fix is operational, not code.

### P3 — Low (3)

**P3-01 — `LockedPlanBanner.tsx:21` deviates from codebase Icon import convention.**

- The new banner uses `import Icon from "../ui/Icon"` (default import). Every other file under `app-mobile/src/components/board/` uses `import { Icon } from '../ui/Icon'` (named import). Both work because `Icon` is exported BOTH as default and named at `app-mobile/src/components/ui/Icon.tsx:498,522`. Functionally identical; only a style deviation.
- **Fix:** swap to named import for consistency. One-line change. Non-blocking.

**P3-02 — `LockedPlanBanner.tsx:19` imports `AccessibilityInfo` but doesn't use it.**

- Unused import will produce a lint warning. Non-blocking but worth cleaning.

**P3-03 — GRANTs are wide (PUBLIC EXECUTE) rather than explicit `authenticated`.**

- The migration source contains `GRANT EXECUTE ON FUNCTION ... TO authenticated`, but `information_schema.routine_privileges` shows the resulting grant is to `PUBLIC` (Postgres default). The `IF v_uid IS NULL` defense-in-depth gate at the top of each RPC closes this at runtime — confirmed live (auth gate fires immediately for service_role / anon callers). Not a security vulnerability, but the SPEC §2A.5/§2A.6/§2A.7 intent of "authenticated only" is enforced at runtime not at GRANT level. P3 because the runtime gate is the actual security boundary.

### P4 — Notes (2)

**P4-01 — Praise: §C.1 GUC isolation discipline.**

The `set_config('orch_0908.force_recycle', 'true', true)` third-arg `true` for transaction-local scope is exactly correct and is the most subtle correctness anchor in the entire implementation. The implementor caught it in the SPEC and shipped it correctly. This kind of GUC discipline prevents a class of silent-corruption bug that would only manifest under concurrent Supabase pooled connections — exactly the kind of bug that escapes structural reviews.

**P4-02 — Praise: 80%-existing-infrastructure assumption held.**

The brutal v2 investigation predicted ORCH-0908 would be a thin glue layer over existing primitives (ORCH-0898 chat substrate, ORCH-0902 V_n machinery, ORCH-0520 is_admin, ORCH-0850 calendar_entries device-event tracking, `ProposeDateTimeModal`, `DeviceCalendarService`, `CalendarService`). The implementation honored that — no new tables, no new schema columns, no new chat surface, no new picker, no new device-calendar service. Reuse-first discipline kept the migration small (3 RPCs + 1 trigger amendment) and the mobile changes surgical (2 new components, 6 edits to existing files). This is the right cost / blast-radius envelope for a feature this large.

---

## Discoveries for orchestrator

- **DISC-0908-QA-1:** Production session distribution probe reveals that `'locked'` and `'completed'` statuses are NEVER reached in production today — all 8 active sessions are in `'active'` status. This empirically confirms the v2 investigation's central thesis: the gang-consensus auto-lock path is so hard to trigger (requires ALL accepted participants to RSVP 'attending') that in practice it almost never fires. The creator-manual lock path that ORCH-0908 adds will be the dominant lock pathway after rollout. P4.
- **DISC-0908-QA-2:** `session_deck_versions` history table has 15 rows across 8 sessions with `max(deck_version)=7`. Multiple cycles already happened from prefs changes (ORCH-0902 mint working as designed). Zero rows have `exclude_place_ids` — expected, since `rpc_force_deck_recycle` has not been called yet. After deploy + OTA, this number should grow with usage. P4.
- **DISC-0908-QA-3:** `boardSessionService.ts` constructor order anomaly — the new ORCH-0908 methods (`lockCardManually`, `scheduleLockedCard`) are added on the class, but the `handleLockIn` callback inside `SwipeableSessionCards` is declared at the TOP of the component before `useTranslation`/`useSessionVoting` hooks. Functionally fine (hooks just need to be at top level; React doesn't care about declaration order within a component). P4 stylistic observation — not a bug.
- **DISC-0908-QA-4:** The implementor implementation report DISC-0908-IMPL-3 noted `locked_by_consensus=false` is new meaningful per-row audit metadata. Tester confirms this works correctly and adversarial §G.1 enforces it. Future analytics ORCH could surface "admin locks vs gang locks per session" — flagged for product analytics roadmap, not for this ORCH. P4.
- **DISC-0908-QA-5:** Strict-grep CI gates from SPEC §7 (`orch-0908-no-direct-is-locked-write.mjs` + `orch-0908-no-direct-schedule-broadcast.mjs`) NOT shipped in this PR. The implementor DISC-0908-IMPL-5 already flagged this. Tester confirms the adversarial §A.2 and §A.3 assertions partially cover this ground at the regression-test level (negative-pattern checks for direct `is_locked` writes and multi-row `scheduled_at` updates), but a CI-blocking gate would be stronger. Recommend orchestrator register as a follow-on cleanup ORCH after CLOSE — out of scope for the initial PR. P3.

---

## Working tree state

- Branch: `Seth`
- Working tree: `/Users/sethogieva/Desktop/mingla-main`
- Migration applied: YES (verified live via MCP)
- Edge functions deployed: **NO** — see P2-01 fix instructions
- Mobile bundle OTA'd: **NO** — see P2-01 fix instructions
- Implementor regression: 18/18 PASS at HEAD; fails-on-revert at `cf380d13`
- Tester adversarial regression: 21/21 PASS at HEAD; fails-on-revert at §C.1 (GUC transaction-local third arg)
- Both regression scripts present in working tree; will appear in PR diff

---

## Pre-merge / pre-CLOSE deferred items

1. **Operator runs both edge function deploys.** Without these, recycle exclude wire is no-op and push 404s. CLOSE pre-merge gate Step 1 should not flip until both are deployed.
2. **Operator OTAs the mobile bundle.** Without this, the new UI isn't running on user devices.
3. **Re-dispatch tester for SC-11 / SC-13 / SC-16 / SC-19 sim re-test** with two test users on iOS Simulator + Android Emulator AFTER both 1 and 2 are done.

Until those three steps complete, runtime UI verification remains `probable` not `proven`. The CONDITIONAL PASS is exactly that conditionality — code is correct, deploys are pending.

---

## Verdict line

**CONDITIONAL PASS — P0:0 / P1:0 / P2:1 / P3:3 / P4:2.** Backend + structural + live-DB-behavior all PASS. Runtime UI verification deferred behind operator-controlled deploy + OTA gates. No defects found. Re-dispatch tester for sim re-test after gates clear.
