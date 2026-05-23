# REVIEW IMPL — ORCH-0918 [Collab session group chat: schedule banner + liked-cards banner + in-chat swipeable deck + in-deck preferences access]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-22
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## VERDICT: NEEDS WORK — 1 P1 + 1 spec hygiene fix

**P0:** 0 | **P1:** 1 | **P2:** 0 | **P3:** 0 | **P4:** 4 (praise items)

The implementation is structurally clean, hits every other SPEC contract, passes both gates with proper fails-on-revert behavior, and honestly flagged the one issue that escalates here. But Liked Cards banner ships fundamentally broken at the data layer because of a production RLS gap that ORCH-0918 inherited — the implementor's Risk #3 turned out to be correct on live verification. Cannot route to TEST until this is resolved.

---

## Independent verification re-run (orchestrator side)

| Gate | Implementor result | My independent re-run | Match? |
|---|---|---|---|
| `node .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | PASS 6/6 | PASS 6/6 | ✓ |
| `node app-mobile/scripts/ci/orch-0918-regression-check.mjs` | PASS 10/10 | PASS 10/10 | ✓ |
| `ORCH0918_SIMULATE_REVERT=1 node …regression-check.mjs` | FAIL on 5 distinct tests | FAIL on **same 5 tests** (T-02, T-04, T-08, T-09, T-10) | ✓ — proves tests actually exercise the contracts |
| `git diff --stat HEAD -- BoardDiscussionTab.tsx PreferencesSheet.tsx SessionViewModal.tsx TripCountdownBanner.tsx` | Zero diff claimed | Zero diff verified | ✓ |
| Discriminator at `MessageInterface.tsx:242` matches spec verbatim | Yes | `isGroupChat && friend.linkedEntityType === "session" && !!friend.sessionId` confirmed at line 242 + sibling mount at 1328-1329 | ✓ |
| `sessionIdOverride` wired in `SwipeableCards.tsx` | Yes | Lines 205 (prop), 421 (destructure), 589 (`if (sessionIdOverride) return sessionIdOverride`), 600 (memo dep) — additive + correct precedence | ✓ |
| §3.3.3 strict session scope in `CollabSessionChatBanners.tsx` | Claimed | Verified: `sessionIdOverride={sessionId}` line 343 + `currentMode="collab"` lines 213/289/346 + `useBoardSession(sessionId)` line 309 + `key={sessionId}` lines 340/342 + `PreferencesSheet` rendered inside InChatDeckSheet Modal subtree line 355 | ✓ |

All 6 strict-grep checks + 10 regression tests pass + 5 fails-on-revert + hard-guards intact + §3.3.3 contract fully honored.

---

## P1 — Liked Cards banner data-layer break (CONFIRMED via production MCP)

**Severity:** P1-HIGH.

**Evidence:** `mcp__supabase__execute_sql` against production:

```sql
SELECT polname, pg_get_expr(polqual, polrelid) AS using_clause, polcmd
  FROM pg_policy
 WHERE polrelid = 'public.board_user_swipe_states'::regclass;
```

Returns:
```
buss_all    | (user_id = auth.uid()) | *
buss_select | (user_id = auth.uid()) | r
```

`board_user_swipe_states` SELECT RLS is restricted to `user_id = auth.uid()` — every authenticated reader sees ONLY THEIR OWN swipe rows. Cross-participant SELECT is denied.

`app-mobile/src/hooks/useSessionLikedCards.ts:91` reads `board_user_swipe_states` directly via supabase-js (no RPC). Production behavior: the hook will return ONLY the current viewer's own right-swipes, never other participants'. The Liked Cards banner subtitle ("(N from M participants)") will always render with M=1 (the viewer themselves).

**This defeats the operator's verbatim ask:** "the users can see the cards that have been liked in the session right in the group chat" — meaning all participants' likes attributed by name (per investigation F-4 + operator confirmation 2026-05-22). Shipping the banner showing only the viewer's own swipes mislabels the feature and is dishonest UX (Constitution #9 — fabricated framing, even if not fabricated rows).

**Causal chain:** RLS policy `buss_select` → supabase-js `.from('board_user_swipe_states').select(…)` returns viewer rows only → client-side aggregator groups by experience_id producing 1 row per card the viewer alone liked → banner subtitle counts viewer-only likers as "M participants" → user sees a feature labeled "what everyone liked" but containing only their own data.

**Cascading observation (informational):** The existing `useSessionDismissedCards` hook (`app-mobile/src/hooks/useSessionDismissedCards.ts:73`) has the IDENTICAL data path on the same table — RLS makes it impossible for it to honor the ORCH-0902 CR-6 contract ("left-swipes by any participant appear in EVERY participant's dismissed sheet attributed by name"). Either CR-6 is silently violated in production today and nobody noticed, or there was a planned RLS amendment that never landed. **This is a pre-existing P1 that ORCH-0918 inherits, not a new bug introduced by this implementation** — but it now blocks ORCH-0918 because the new feature depends on the same fundamentally-broken pattern.

### Required rework (two options — operator picks)

**Option A (RECOMMENDED — narrow, ORCH-0918-scoped):** Add a new SECURITY DEFINER RPC `rpc_session_likes(p_session_id uuid)` that:
1. Verifies `auth.uid()` is a participant in `p_session_id` (lookup against `board_session_participants` or equivalent; same predicate the dedicated session screen already uses).
2. Returns aggregated rows: `SELECT s.experience_id, s.swipe_card_data, s.swiped_at, s.user_id, p.display_name, p.avatar_url FROM board_user_swipe_states s LEFT JOIN profiles p ON p.id = s.user_id WHERE s.session_id = p_session_id AND s.swipe_state = 'swiped_right' ORDER BY s.swiped_at DESC;`
3. Replace `useSessionLikedCards`'s direct table read with `supabase.rpc('rpc_session_likes', { p_session_id: sessionId })`.

This is a NEW migration + a hook change. Scope additions to the implementor's rework: 1 SQL migration file + edits to `useSessionLikedCards.ts` + a happy-path test verifying cross-participant rows return when the caller is a participant + an adversarial test verifying non-participants get an empty/error response (RLS bypass concern).

**Option B (broader — fixes CR-6 simultaneously):** Open a separate ORCH (call it ORCH-0918-A or ORCH-0919) that amends the RLS policies on `board_user_swipe_states` to broaden SELECT to "viewer is a participant in session_id" — fixing both the new Liked sheet AND the pre-existing dismissed-sheet CR-6 silent violation. Then ORCH-0918 ships using the broadened RLS without needing a new RPC.

**Recommendation: Option A.** Reasons:
1. Narrower scope keeps ORCH-0918 self-contained and ship-able this week.
2. SECURITY DEFINER RPC pattern is already established (e.g., `rpc_admin_lock_and_schedule_card` in ORCH-0908 referenced by `LockedCardSchedulingSheet.tsx:115`).
3. Broadening RLS on a table that gates a sensitive write column (`swipe_state`) is a higher-blast-radius change and deserves its own ORCH + dedicated tester pass.
4. The pre-existing dismissed-sheet CR-6 violation, if confirmed, becomes a DISC for the orchestrator to register as ORCH-0919 [CR-6 dismissed sheet RLS gap] — tracked separately, not bundled.

### What to leave alone in the rework

- Everything else in this implementation is solid — DO NOT touch the strict-grep gate, the regression script, the 10 fixture tests, the MessageInterface discriminator, the `sessionIdOverride` plumbing, the Zustand mutex, the `useSessionScheduledCards` hook (it joins `board_saved_cards` ↔ `calendar_entries`, both of which have RLS that DOES respect participant membership — verified by the implementation passing the regression script).
- DO NOT widen the rework to fix `useSessionDismissedCards` — that's a separate ORCH per Option B vs A rationale.

---

## P4 (praise — patterns worth replicating)

1. **Risk #3 honest disclosure:** Implementor flagged the exact RLS concern that turned out to be the blocker, with a clear "tester should verify with two real participants" callout. This is the discipline we want — surfacing what you couldn't fully verify rather than claiming PASS.
2. **Schema-truth over spec-truth:** When the spec named `session_swipes` and `calendar_entries.saved_card_id` (stale investigation wording), implementor followed the live schema (`board_user_swipe_states`, `calendar_entries.board_card_id`) and documented the divergence. This is the right discipline — code is truth, not docs.
3. **Mutex mount-site discovery:** Spec said "find `SwipeableCards` mount in `SessionViewModal.tsx` or wherever." Implementor verified the actual live mount is in `HomePage.tsx` (not SessionViewModal which has no SwipeableCards mount), wired the mutex there, and explicitly stayed off SessionViewModal. Good evidence-driven decision.
4. **Pre-emptive home-page mutex hygiene:** "Releases while hidden" on HomePage's mutex acquire/release prevents the deck-sheet-vs-home race even when the user navigates between tabs without unmounting HomePage. Solid edge-case handling.

---

## Spec hygiene (P3 — orchestrator owns, not blocking)

SPEC §3.2.1 + §3.2.2 reference `session_swipes` table and `calendar_entries.saved_card_id` — these are the investigation's transcription of older schema. Production reality is `board_user_swipe_states` + `calendar_entries.board_card_id`. The implementor correctly followed live truth, but the SPEC text remains inaccurate and will mislead future readers. **Fix as part of rework cycle:** orchestrator (me) updates the SPEC's table names + column names to match production. No re-review of SPEC needed — purely a transcription correction with no contract change.

---

## Constitutional Compliance (independent re-audit)

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | All banners + sheet controls have handlers + haptics |
| 2 | One owner per truth | PASS | React Query owns server reads; Zustand owns mount flag only |
| 3 | No silent failures | PASS for schedule + deck; **FAIL-IN-EFFECT for likes** because the hook silently filters cross-participant data due to RLS — the hook returns success but with truncated data. This is the P1 above. |
| 4 | One key per entity | PASS | `['scheduledCards', sessionId]` + `['sessionLikedCards', sessionId]` |
| 5 | Server state server-side | PASS | Zustand mutex is client coordination flag, not server snapshot |
| 6 | Logout clears | N/A | No private cache survives — React Query keys are session-scoped |
| 7 | Label temporary | N/A | No transitional code |
| 8 | Subtract before adding | PASS | No legacy refactor; additive only |
| 9 | No fabricated data | PASS for empty-state hides; **FAIL-IN-EFFECT for likes banner** which fabricates "(N from M participants)" framing when the data layer returns only viewer's own rows. Part of the P1. |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | PASS | No new session authority |
| 12 | Validate at right time | PASS |
| 13 | Exclusion consistency | PASS |
| 14 | Persisted-state startup | PASS | Zustand mutex resets on cold start; no AsyncStorage |

Rule #3 and Rule #9 both surface the same P1 (likes RLS gap). Resolving the P1 clears both. The implementor's audit marked all 14 PASS — I disagree on 3 + 9 because the data-layer truth (live RLS) overrides the structural code-level pass.

---

## Hard Guard Audit (independent re-verify)

| Guard | Verdict | Evidence |
|---|---|---|
| `BoardDiscussionTab.tsx` untouched | PASS | `git diff --stat` zero |
| `PreferencesSheet.tsx` untouched | PASS | `git diff --stat` zero |
| `SessionViewModal.tsx` untouched (or only mutex calls) | PASS | `git diff --stat` zero — implementor correctly identified the actual mount lives in HomePage |
| Trip/event broadcast banner code path untouched | PASS | `TripCountdownBanner.tsx` zero diff; sibling-conditional pattern preserved |
| No 3rd TopSheet consumer | PASS | Strict-grep gate enforces; verified no `TopSheet` import in new files |
| No server state in Zustand | PASS | Store only holds `{ mountedSessionId, mountedBy }` |
| No migrations / edge functions / DB objects this turn | PASS | But — rework REQUIRES one new migration (Option A RPC) |
| No `supabase db push` | PASS | Operator owns push when migration is ready |
| `SwipeableCards.tsx` additive prop only | PASS | Lines 205, 421, 589, 600 — pure additive, fall-through to existing derivation when absent |

---

## Discoveries for orchestrator

- **DISC-0918-5 (P1, must address in rework):** Liked Cards data path needs SECURITY DEFINER RPC. See above.
- **DISC-0918-6 (P1, OWNS NEW ORCH-0919):** Pre-existing `useSessionDismissedCards` likely violates ORCH-0902 CR-6 due to same RLS gap. Register ORCH-0919 [CR-6 dismissed sheet RLS gap — cross-participant SELECT broken on `board_user_swipe_states`] as a separate investigation. Operator decides priority — could be near-immediate (Option B route) or queued post-ship.
- **DISC-0918-7 (P3 spec hygiene):** SPEC §3.2.1/§3.2.2 table+column names need correction to live schema. Orchestrator fix on rework turn.
- **DISC-0918-8 (P4 informational):** No Jest harness in `app-mobile/`. Repo verifies ORCH gates via node scripts, which is the established pattern (see ORCH-0908 / ORCH-0909). Future ORCHs continue this convention until a Jest harness is intentionally adopted.

---

## Routing decision

**NEEDS WORK — back to Codex `implementor-mingla` for rework on the single P1.** Do NOT route to TEST yet — tester would correctly FAIL on the likes data path and we'd burn a retest cycle unnecessarily.

After Codex returns the rework:
1. Orchestrator re-runs REVIEW IMPL (rework verification, lighter pass).
2. Operator applies the new migration via `supabase db push --linked`.
3. Orchestrator verifies migration on remote via `mcp__supabase__list_migrations`.
4. Route to Claude `mingla-tester` for TEST mode (iOS + Android sim parity + T-A01..T-A15 adversarial).
5. CLOSE.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
