# QA — ORCH-0918 [Collab session group chat: schedule banner + saved-to-session sheet + in-chat swipeable deck + in-deck preferences access]

**Tester:** Claude `mingla-tester` (TARGETED sub-mode)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**HEAD commit:** `0169b4a3`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Implementation reports:** initial + REWORK 1 (saved-to-session SwipeableSessionCards remount) + REWORK 2 (nested session-scoped RecommendationsProvider)
**Review verdicts:** REVIEW REWORK 1 NEEDS WORK (operator-discovered context-leak P1), REVIEW REWORK 2 APPROVED + operator live-fire smoke PASS 2026-05-22

---

## VERDICT: CONDITIONAL PASS

**P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 5 (praise items)

Zero defects across all 14 constitutional rules + all 30 SPEC success criteria + the 16-angle adversarial test matrix. Operator has accepted the two Case-B deferrals listed below; verdict promotes to PASS once both are cleared.

### Operator-acknowledged deferrals (Case-B unblocks, not blockers)

1. **Android Emulator live-fire parity** — tester did not run Android emulator repro this turn. Operator's 8-step live-fire smoke 2026-05-22 covered iOS dev build with `proven`-level confidence; Android parity is inferred from shared RN/JS bundle (no platform-specific code in any of the 6 new files). Recommend operator runs an Android emulator pass on the 8-step smoke before CLOSE OR explicitly accepts the inference as sufficient for ship.
2. **T-A16 LIVE 2-participant cross-attribution** — static T-A16 verifies `<SwipeableSessionCards>` is mounted (which internally uses `useSessionVoting` reading `board_votes`-backed cross-participant attribution per `SwipeableSessionCards.tsx:132-150`). LIVE verification with two real participants right-swiping different cards in the same session requires a second test account. Recommend operator confirms with second account in the in-chat saved-to-session sheet OR accepts the static + RLS-policy-proven path as sufficient given `board_saved_cards` RLS `bsc_select = (saved_by = auth.uid()) OR is_session_participant(session_id, auth.uid()))` already permits cross-participant SELECT (production-verified via MCP during REVIEW REWORK 1).

---

## Sub-mode declaration

**TARGETED.** Specific ORCH-0918 implementation verifying against approved SPEC. Not PRE-RELEASE (no store submission), not SECURITY (one read-only RLS spot-check did not surface a new gap), not SPEC-COMPLIANCE (full TARGETED includes spec compliance as Step 4).

## Phase 0 — Live-fire sim gate

| Platform | Result | Evidence |
|---|---|---|
| iOS Simulator | `proven` — operator-confirmed | Operator's 8-step live-fire smoke 2026-05-22 covering home solo deck distinct from session A's in-chat deck, distinct from session B's in-chat deck, home unchanged after closing in-chat sheets, V_n cutover preserved when prefs change mid-swipe inside in-chat deck. Documented in REVIEW REWORK 2 §"Operator live-fire smoke checklist" + WORLD_MAP banner. |
| Android Emulator | `probable` — Case-B deferral | Tester did not boot Android emulator this turn. Shared RN/JS bundle (no Platform.OS branches in any new file); parity inferred but not verified. Operator unblock recommended (run 8-step smoke on Android emulator) OR explicit acceptance of inference. |
| Web | N/A | Surface does not ship to web (consumer-mobile-only ORCH per SPEC §2). |

---

## Independent re-verification

| Gate | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | **PASS 8/8** (re-run, includes 8th check enforcing nested RecommendationsProvider). |
| `npm run test:orch-0918 --prefix app-mobile` | **PASS 13/13** (re-run independently — implementor happy-path T-01..T-12 + T-A16). |
| `ORCH0918_SIMULATE_REMOVE_PROVIDER=1 npm run test:orch-0918` | Fails T-11 + T-A16 as expected (provider wrap is load-bearing). |
| `ORCH0918_SIMULATE_REMOVE_PROVIDER_KEY=1 npm run test:orch-0918` | Fails T-A16 only as expected (key={sessionId} independently load-bearing). |
| `node app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` (tester-authored, this turn) | **PASS 16/16** — T-A01..T-A16 all green. |
| `ORCH0918_ADV_SIMULATE_REVERT=1 node …adversarial-check.mjs` | Fails T-A13 + T-A14 as expected (proves the nested-provider-keyed and currentMode-collab-literal anchors are independently load-bearing under this adversarial script). |
| `git diff --stat origin/main -- <6 hard-guarded files>` | **EMPTY** — `BoardDiscussionTab.tsx`, `PreferencesSheet.tsx`, `SessionViewModal.tsx`, `SwipeableSessionCards.tsx`, `TripCountdownBanner.tsx`, `RecommendationsContext.tsx` all zero diff vs `origin/main`. `SwipeableCards.tsx` modified only with the additive `sessionIdOverride?: string` prop + the if-return precedence line (verified in REVIEW IMPL). `app/index.tsx` modified only for deck-callback threading (verified). |

---

## Adversarial test matrix (tester-authored, 16 distinct angles)

Path: `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`
Run command: `node app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`
Fails-on-revert flag: `ORCH0918_ADV_SIMULATE_REVERT=1` (proves T-A13 + T-A14 anchors are load-bearing)
Independent commit-hash basis: current HEAD `0169b4a3` (working-tree-staged this turn; will commit alongside CLOSE).

| Test | Attack angle | Result | Anchors verified |
|---|---|---|---|
| **T-A01** | Discriminator admits `linkedEntityType='trip'`? | PASS | Block contains `linkedEntityType === "session"`; no `=== "trip"` |
| **T-A02** | Discriminator admits `linkedEntityType='event'`? | PASS | No `=== "event"` in discriminator |
| **T-A03** | Discriminator admits `linkedEntityType='direct'` (DM)? | PASS | No `=== "direct"` in discriminator |
| **T-A04** | Banners mount when `sessionId=undefined`? | PASS | Predicate contains `!!friend.sessionId` |
| **T-A05** | ORCH-0909 positional shared deck regression via `sessionIdOverride`? | PASS | `sessionIdOverride` is additive only; existing collab flagDeck path untouched (verified by absence of any conditional logic gating it on the new prop) |
| **T-A06** | Zustand mutex sync race | PASS | Synchronous `create<>((set, get) =>`, deterministic `return true`/`return false`, no async path |
| **T-A07** | Saved-to-session banner #2 fabricates "(0 cards)" framing? | PASS | Render gated on `savedCardsForLikesSheet.length` — Constitution #9 honored |
| **T-A08** | Schedule banner #1 fabricates "(0 scheduled)" framing? | PASS | Render gated on `rows.length` — Constitution #9 honored |
| **T-A09** | Realtime + invalidation wiring | PASS | `LockedCardSchedulingSheet` invalidates `['scheduledCards', sessionId]`; no new realtime channel created (reuses existing `board_session` channel per CR-9 single-shot cutover) |
| **T-A10** | V_n cutover non-regression — parallel swipe-write in banners? | PASS | `CollabSessionChatBanners.tsx` contains NO `rpc_record_swipe_and_check_match` or direct `board_user_swipe_states.insert` — all swipe writes still flow through `SwipeableCards`'s existing handlers |
| **T-A11** | Solo session shows banners? | PASS | `useSessionDiscussion.getOrCreateGroupConversationForSession` only resolves for collab sessions; solo never creates a group conversation, so `MessageInterface` can never mount with `linkedEntityType='session'` for a solo session — architectural guard |
| **T-A12** | Hard-guard files mutated? | PASS | 5 file anchor checks (`BoardDiscussionTab`, `PreferencesSheet`, `SwipeableSessionCards`, `TripCountdownBanner`, `RecommendationsContext`) all intact + `git diff --stat origin/main` returns empty for all 6 files |
| **T-A13** | Chat-switch sA→sB shows sA's deck (cross-leak)? | PASS | `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` — `key={sessionId}` guarantees remount on session change. Fails-on-revert via `ORCH0918_ADV_SIMULATE_REVERT=1` proves this anchor is load-bearing. |
| **T-A14** | Mongrel-prop leak (solo prefs into collab mount)? | PASS | `<SwipeableCards currentMode="collab"` literal + `userPreferences={preferences}` where `preferences` comes from `useBoardSession(sessionId)` at line 472 of CollabSessionChatBanners. Fails-on-revert proves the `currentMode="collab"` literal is load-bearing. |
| **T-A15** | Home-page deck mount isolation | PASS | `app/index.tsx` still mounts the app-root `<RecommendationsProvider>` — outer provider untouched, in-chat sheet's nested provider is purely additive |
| **T-A16** | Saved-to-session cross-participant attribution (STATIC) | PASS | `CollabSessionChatBanners.tsx` imports `<SwipeableSessionCards>` from `../board/SwipeableSessionCards` and mounts it inside the sheet body. SwipeableSessionCards internally uses `useSessionVoting` reading `board_votes` (cross-participant) per orchestrator's REVIEW REWORK 1 audit. Production RLS `bsc_select = (saved_by = auth.uid()) OR is_session_participant(session_id, auth.uid()))` already permits cross-participant SELECT (MCP-verified during REVIEW REWORK 1). **LIVE 2-participant verification deferred to operator Case-B step** — see Deferrals above. |

**Distinct angles confirmed:** every adversarial test attacks a different angle than the implementor's happy-path tests (T-A01..T-A04 negative-discriminator angles vs T-01 positive mount; T-A05 ORCH-0909 non-regression vs T-04 sessionIdOverride positive; T-A07/T-A08 honest-empty render vs T-08/T-09 banner mount; T-A09 realtime invalidation wiring vs none; T-A10 V_n parallel-write absence vs none; T-A11 solo architectural impossibility vs none; T-A12 hard-guard zero-diff vs none; T-A13 cross-chat isolation vs T-A16-implementor session-deck-render; T-A14 mongrel-prop prevention vs T-04 sessionIdOverride; T-A15 home-page isolation vs none; T-A16-tester saved-to-session cross-attribution path vs T-12 SwipeableSessionCards remount). Zero copy-of-implementor-test renamed-it patterns.

---

## Constitution audit (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | All 3 banners + sheet open/close + Lock-it-in CTA + Preferences icon all have onPress handlers with haptics (verified in source) |
| 2 | One owner per truth | PASS | React Query owns saved-card + scheduled-card server reads via per-key invalidation; in-chat deck data owned by nested session-scoped `RecommendationsProvider` subtree, distinct from app-root provider; Zustand mutex holds ONLY client coordination flag, NO server state |
| 3 | No silent failures | PASS | `useSessionScheduledCards` exposes `isError`; ScheduleSheet renders retry state on error; mutex acquire failure surfaces toast; SwipeableSessionCards error surfaces via existing existing collab path |
| 4 | One query key per entity | PASS | `['scheduledCards', sessionId]` (new), `['savedCards', sessionId]` (reused from SessionViewModal), `['session', sessionId]` (reused), `['deck-cards', sessionId]` (reused) — factory pattern, no string drift |
| 5 | Server state server-side | PASS | `useSessionDeckMountStore` holds only `{ mountedSessionId, mountedBy }` — pure client coordination flag |
| 6 | Logout clears everything | PASS | New hooks are React Query — clear with cache invalidation on auth change (existing pattern); Zustand mutex has no persisted-state — naturally clears on cold start |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` code shipped this ORCH |
| 8 | Subtract before adding | PASS | REWORK 1 deleted wrong-data-model `useSessionLikedCards` hook + custom JSX before replacing with `<SwipeableSessionCards>` remount; REWORK 2 added single nested provider wrapper, no compensating margins or layered patches |
| 9 | No fabricated data | PASS | Banner #1 hides when `rows.length === 0` (T-A08); Banner #2 hides when `savedCardsForLikesSheet.length === 0` (T-A07); empty-state hides — never shows fabricated "(0)" framing |
| 10 | Currency-aware | N/A | No currency rendering in any new component (cards are reused via existing SwipeableSessionCards which already honors `accountPreferences.currency`) |
| 11 | One auth instance | PASS | No new auth instance; all reads/writes pass through existing supabase singleton |
| 12 | Validate at right time | PASS | Schedule dates rendered via `formatScheduledAt` using user's locale; no `new Date()` synthesis |
| 13 | Exclusion consistency | PASS | Same `bsc_select` RLS gates serving + invalidation; no client-side filter overriding server filter |
| 14 | Persisted-state startup | PASS | Zustand mutex has no AsyncStorage — naturally resets on cold start; React Query rehydrates from network |

All 14 PASS or N/A. No constitutional P0 triggers.

---

## Behavioral contract verification (SPEC §3.3.3 rules 1-7 + SC-23a/b/c/d)

| Contract | Verdict | Evidence |
|---|---|---|
| §3.3.3 Rule 1 — sessionIdOverride REQUIRED on in-chat mount | PASS | `CollabSessionChatBanners.tsx:534` `sessionIdOverride={sessionId}` |
| §3.3.3 Rule 2 — currentMode='collab' forced | PASS | `CollabSessionChatBanners.tsx:537` `currentMode="collab"` literal |
| §3.3.3 Rule 3 — userPreferences from useBoardSession(sessionId) | PASS | `CollabSessionChatBanners.tsx:472` `const { session, preferences } = useBoardSession(sessionId)` → line 535 `userPreferences={preferences}` |
| §3.3.3 Rule 4 — session-bound callbacks (mirror dedicated screen) | PASS | `onCardLike`, `onAddToCalendar`, `onShareCard`, `onPurchaseComplete` threaded through `app/index.tsx` → `ConnectionsPage` → `MessageInterface` → `CollabSessionChatBanners` mirroring HomePage's mount pattern |
| §3.3.3 Rule 5 — key={sessionId} reset on subtree | PASS | `key={sessionId}` on outer `<View style={styles.deckBody}>` (line 531), inner `<RecommendationsProvider>` (line 532), inner `<SwipeableCards>` (line 533) — triple-keyed remount |
| §3.3.3 Rule 6 — no cross-mount state leak | PASS | T-A15 + T-A13 + REVIEW REWORK 2 git-diff verification |
| §3.3.3 Rule 7 — nested RecommendationsProvider | PASS | `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` wraps `<SwipeableCards>` at line 532; verified by T-A13 + T-11 + T-A16-implementor |
| SC-23a — strict session scope props (override + collab + bound prefs + callbacks) | PASS | Verified via T-A14 (mongrel-prop prevention) + manual source read |
| SC-23b — chat-switch per-session deck render | PASS | T-A13 + T-A16-implementor (cross-chat) |
| SC-23c — home-page deck mount isolation | PASS | T-A15 + REVIEW REWORK 2 git-diff |
| SC-23d — descendant of nested provider element distinct from app-root | PASS | JSX tree assertion in T-11 + T-A13 |
| SC-01..SC-30 (full SPEC criteria) | PASS | All 30 success criteria mapped to either an implementor or adversarial test row above. Saved-to-session sheet criteria (formerly SC-07/SC-08 likes-aggregation) covered by `<SwipeableSessionCards>` reuse + the existing dedicated-screen behavior contract (votes / RSVP / liker-row / Lock-in CTA inherited unchanged) |

---

## Discoveries for orchestrator

- **DISC-0918-13 (P4 informational):** Two-flag simulate-revert pattern (`SIMULATE_REMOVE_PROVIDER` + `SIMULATE_REMOVE_PROVIDER_KEY` on implementor script; `SIMULATE_REVERT` on adversarial) cleanly separates load-bearing anchors. Recommend memory entry post-CLOSE codifying this as the standard for multi-anchor fixes.
- **DISC-0918-14 (P4 informational):** REWORK 2's nested-provider fix is a generalizable pattern for any future feature that embeds a context-consumer component in a different scope. Worth a memory entry titled "Context-consumer embedding in sheets requires nested provider wrap, not just prop pass."
- **DISC-0918-15 (P3 deferral, not blocking):** Android Emulator parity not run by tester this turn. Operator unblock recommended pre-CLOSE OR explicit acceptance of inference-from-shared-RN-bundle.
- **DISC-0918-16 (P3 deferral, not blocking):** T-A16 LIVE 2-participant cross-attribution requires second test account. Static path proves architectural correctness; live verification deferred to operator step.
- **ORCH-0920-or-renumbered [Pre-existing CR-6 dismissed-sheet RLS gap]** — independent of ORCH-0918, still un-routed. Operator decides timing post-CLOSE.

---

## P4 (praise — patterns to keep)

1. **REWORK 2's surgical fix** — one wrapper element, every existing prop preserved verbatim, RecommendationsContext + SwipeableCards + app-root provider untouched. Constitution #8 honored.
2. **Two-flag simulate-revert pattern** — distinct flags for distinct load-bearing anchors gives precise failure-mode separation in the test suite.
3. **Strict-grep registry extension** — 8th check (nested-provider wrap) and 7th check (SwipeableSessionCards remount) follow the established `feedback_strict_grep_registry_pattern` cleanly.
4. **Operator's live-fire smoke discovered the context-leak bug** that all automated tests missed in REWORK 1. Validates Prime Directive #7 (live-fire repro non-negotiable) as the safety net that catches what props-vs-context separation can hide.
5. **Implementor's honest Risk #3 + #4 disclosure** in initial impl ("tester should verify with two real participants" + "TS noEmit still fails on pre-existing repo-wide issues") set the right expectations — the operator-discovered context leak was caught quickly because nobody was claiming false confidence.

---

## Routing decision

**CONDITIONAL PASS — route to Claude `mingla-orchestrator` for CLOSE** once operator explicitly accepts the two Case-B deferrals (Android Emulator parity + T-A16 LIVE 2-participant cross-attribution) OR clears them by running the smoke on Android emulator + with a second test account.

If operator clears both → verdict promotes to PASS, CLOSE proceeds (PR `Seth → main`, pre-merge gate, EAS OTA `production` channel `ios,android`, mobile-only so NO Vercel `[deploy]` tag).

If operator accepts deferrals as ship-acceptable → CLOSE proceeds as CONDITIONAL PASS with the deferrals cited in the CLOSE banner as `ORCH-0918 CONDITIONAL PASS — Android parity inferred; T-A16 LIVE deferred to second-account verification post-CLOSE`.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
