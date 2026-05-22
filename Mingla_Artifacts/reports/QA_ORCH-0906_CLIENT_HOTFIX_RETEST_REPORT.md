# QA — ORCH-0906 [Collab Deck Single↔Intent 1:1 Interleave] Client Hotfix — RETEST

**Verdict:** **PASS** (scoped to the hotfix's two P0 findings)
**Severity counts:** P0=0 | P1=0 | P2=1 | P3=0 | P4=1
**Tester:** Claude `mingla-tester`
**Date:** 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `ORCH-0906-CLIENT-HOTFIX`
**PR:** [#159](https://github.com/Mingla-LLC/mingla-main/pull/159)
**Hotfix commit:** `d68b4571` (code) + `63c818c5` (impl report) + `0412cdac` (tester adversarial)
**Predecessor FAIL report:** `Mingla_Artifacts/reports/QA_ORCH-0909_AMENDMENT_ORCH-0906_BUNDLE_REPORT.md`

---

## Layman Summary

The earlier FAIL caught two visible bugs in the shipped ORCH-0906 bundle: curated multi-stop cards rendered as broken single-place cards (wrong fallback image, no journey chrome), and a "No spots match right now" empty-state flashed for a moment between every swipe in collab. Codex shipped the hotfix on a branch off main (PR #159). I pulled it, Metro hot-reloaded the consumer iOS sim, and the operator visually confirmed both bugs are gone — curated cards now show their proper multi-stop chrome with different hero images per card, and swipes no longer flash the empty state. The hotfix's own regression tests pass (9/9 happy-path from Codex + 12/12 adversarial I just landed). Anchor reverts proved the tests genuinely catch the bug class.

Verdict is PASS for the hotfix's scope (the two P0s). The broader ORCH-0906 + ORCH-0909 multi-account collab scenarios (SC-01..SC-18 — late join, prefs edit mid-session, no-GPS banner, exit/rejoin, graceful degrade flag wiring) remain unrun and are tracked as deferred coverage below; the hotfix didn't change collab session lifecycle behaviour, only client mapping + empty-state gating, so SC-01..SC-18 deferred coverage is a follow-up rather than a release blocker.

---

## P0 Findings — RESOLVED

### P0-1 (predecessor) — Curated payloads stripped by `unifiedCardToRecommendation` → curated rows render corrupt

**Fix delivered at `d68b4571`:**

- New `discoverCardsPayloadToRecommendations(data)` at [app-mobile/src/services/deckService.ts:248](app-mobile/src/services/deckService.ts#L248) replaces the bare `data.cards.map(unifiedCardToRecommendation)` call at both fetch sites:
  - Solo path at [deckService.ts:473](app-mobile/src/services/deckService.ts#L473)
  - Collab v2 path at [deckService.ts:856](app-mobile/src/services/deckService.ts#L856)
- `isCuratedPayload(card)` detects curated by EITHER explicit `cardType: 'curated'` label OR structural fallback (`stops[]` + `experienceType` + `tagline`)
- `isSinglePlacePayload(card)` is a leak-resistance guard — even if envelope says `card_type='curated'`, a card with single-place signals (`lat` OR `lng` OR `placeId` OR `image`) is NOT auto-curated
- Curated branch returns `{ ...card, cardType: 'curated' } as Recommendation` — preserves `stops`, `tagline`, `experienceType`, `pairingKey`, `categoryLabel`, `totalPriceMin/Max`, `estimatedDurationMinutes`, `matchScore`, `shoppingList`, `teaserText`, `_locked` intact

**Live-fire verification (proven):** iPhone 17 (UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`, iOS 26.4), Mingla `com.mingla.app.v2`, Metro hot-reloaded from working tree at `0412cdac`. Operator (Seth) confirmed via direct swipe through "Testing stuff" collab session: curated cards (titles with the `→` arrow) now render with proper multi-stop chrome AND distinct cover images per card. The retail-store-with-M-letter fallback that appeared on two unrelated curated cards in the FAIL repro is gone. Operator quote: "all passes".

### P0-2 (predecessor) — "No spots match right now" empty-state flash between every swipe

**Fix delivered at `d68b4571`:**

- [SwipeableCards.tsx:723-726](app-mobile/src/components/SwipeableCards.tsx#L723) — `effectiveUIState` now short-circuits to `INITIAL_LOADING` instead of falling through to `EXHAUSTED` when `isBoardSession && !collabDeckDeadEndReason`. Empty-state can only render with an explicit collab dead-end signal.
- [RecommendationsContext.tsx:898-911](app-mobile/src/contexts/RecommendationsContext.tsx#L898) — `setIsExhausted(true)` is gated by new `hasExplicitCollabDeadEnd` boolean requiring `!isCollaborationMode || soloCuratedEmptyReason !== undefined || soloServerPath === 'pool-empty'`.
- [RecommendationsContext.tsx:1275](app-mobile/src/contexts/RecommendationsContext.tsx#L1275) — clear-prior-card dead-end branch extended to fire on `soloCuratedEmptyReason !== undefined` (was only firing on `soloServerPath === 'pool-empty'`).
- [RecommendationsContext.tsx:1581](app-mobile/src/contexts/RecommendationsContext.tsx#L1581) — `deckEmpty` boolean ANDs with new `hasExplicitEmptyVerdict`; prevents `error="no_matches"` leak during in-flight fetches.
- [RecommendationsContext.tsx:1766](app-mobile/src/contexts/RecommendationsContext.tsx#L1766) — EMPTY branch of `deckUIState` gates the `(isDeckBatchLoaded && !deckHasMore)` leg with `!isCollaborationMode`; collab one-card-at-a-time responses are no longer mistaken for terminal EMPTY.

**Live-fire verification (proven):** Same session as P0-1. Operator confirmed no empty-state flash between consecutive swipes. Operator quote: "all passes".

---

## Regression-Test Gate (ORCH-0840) — CLEARED

| Requirement | Path | SHA | Status |
|---|---|---|---|
| Implementor happy-path regression | `app-mobile/scripts/ci/orch-0906-client-hotfix-regression-check.mjs` (9 assertions) | `d68b4571` | PASS 9/9 |
| Tester adversarial regression | `app-mobile/scripts/ci/orch-0906-client-hotfix-adversarial-check.mjs` (12 assertions, 5 angles) | `0412cdac` | PASS 12/12 |
| Both in `git diff origin/main...HEAD --name-only` | Verified on `ORCH-0906-CLIENT-HOTFIX` branch | — | ✓ |

**Fails-on-revert verified at canonical SHA:**

- Implementor anchor 1 (curated mapper) — renamed `discoverCardsPayloadToRecommendations` → tests T-02/T-04/T-05 FAIL → restore → PASS
- Implementor anchor 2 (empty-state guard) — replaced `if (isBoardSession && !collabDeckDeadEndReason)` with `if (false)` → T-07 FAIL → restore → PASS
- Tester adversarial anchor (OR→AND in `isSinglePlacePayload`) — tightened `||` to `&&` on placeId line → A-01e FAIL → restore → PASS

Tests are runtime-aware structural assertions on the actual production source — not weak source-grep aliases. The OR→AND adversarial in particular catches a fault plane the implementor's tests don't reach.

---

## Prior Tests — Still Green

Confirmed at `0412cdac`:

| Suite | Result |
|---|---|
| `npm run test:orch-0909` | 11/11 PASS |
| `npm run test:orch-0909-adv` | 10/10 PASS |
| `npm run test:orch-0906-client-hotfix` | 9/9 PASS |
| `node ./scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs` | PASS |
| Deno `supabase/functions/discover-cards/__tests__/orch_0906_mixed_type_interleave.test.ts` | 2/2 PASS |

---

## P2 Findings (non-blocking)

### P2-1 — Implementation report claim of source-only verification process gap (carried from predecessor)

Already documented in `QA_ORCH-0909_AMENDMENT_ORCH-0906_BUNDLE_REPORT.md`. Codex's hotfix report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0906_CLIENT_HOTFIX.md` correctly states "I did not perform the iPhone 17 live-fire Metro verification; that remains for tester/operator" — honest scoping. Live-fire was done by tester at this retest. No new gap; flagging only to keep the predecessor's process P2 alive until the orchestrator decides whether to codify the "implementor must run iOS sim before claiming UI verification" rule.

---

## P4 Findings (informational / good work)

### P4-1 — Tightly-scoped 5-file hotfix with proper test discipline

The fix touched only `deckService.ts`, `SwipeableCards.tsx`, `RecommendationsContext.tsx`, the new regression-check script, and `package.json` (script registration). No collateral changes, no test weakening, no schema touch, no edge function touch. The `discoverCardsPayloadToRecommendations` extraction is exported so it's testable in isolation. The `isCuratedPayload` / `isSinglePlacePayload` guard pair is properly orthogonal. The empty-state-flash fix kept the original branch shape and added new conditions only where needed — minimal blast radius. Good restraint.

---

## What Was NOT Tested (Deferred Coverage)

The hotfix's live-fire was scoped to the two P0s. The following SC-01..SC-18 multi-account collab scenarios were NOT executed and remain deferred to a follow-up test session:

- **SC-01..SC-13** — ORCH-0909 parent positional shared-deck scenarios across 3 accounts (3-way GPS join, late-join landing at frontier, V_{n+1} transition on prefs edit, no-GPS banner)
- **SC-14..SC-18** — ORCH-0906 amendment scenarios (D4 20-card worked example, D7 graceful-degrade flag wiring on `degraded_from_intent` / `degraded_from_single` / `exhausted_intent` / `all_pools_exhausted`)
- **Android parity** — Pixel_8_Pro (`emulator-5554`, Android 15 API 35, EAS-signed APK with registered SHA) is installed and Google-OAuth-capable but the hotfix's live-fire was on iPhone 17 only. JS bundle is shared (Metro hot-reload pickup), so by code-parity the fix applies; explicit Android verification deferred to operator-confirmed follow-up.
- **iPhone 17 Pro + iPhone 17 Pro Max parity** — same JS via Metro; deferred unless visible regression observed.

**Rationale for deferring without blocking:** The hotfix scope is the two P0s introduced by the bundle's client integration gap. SC-01..SC-18 multi-account scenarios test the ORCH-0906 amendment's BEHAVIOR (rotation order, late-join frontier, V_{n+1} transition) — none of which the hotfix touched. The hotfix is a pure rendering + empty-state-gate fix on top of the already-shipped server interleave. Bundling SC-01..SC-18 into the hotfix QA conflates two test cycles.

**Recommended next test cycle:** After PR #159 merges and OTA ships, a fresh tester dispatch should run SC-01..SC-18 across all 4 devices with 3+ accounts. That cycle inherits the same `feedback_collab_deck_determinism_contract.md` invariants and the same Maestro/manual flows.

---

## Caveats from Implementor Carry-Forward

- `npx tsc --noEmit` blocked by unrelated pre-existing errors (per Codex implementation report). Not new debt from this hotfix.
- Vercel checks failing on PR #159 due to deployment rate limit. Not a code defect; operator should wait for rate-limit reset and re-run, or use admin merge if other required gates are green.
- Some Actions still pending at Codex check time. Operator should wait for full check completion before merge.

---

## Next Handoff

NEXT STEPS — for you, Seth:

1. **Wait for PR #159 checks to settle** — Vercel rate-limit + pending Actions. Re-check `gh pr checks 159` in ~10-30 min. Required gates: tests, type-check, lint, append-only-tests workflow, ORCH-0863 backend allowlist. Vercel deployment failures are environmental (rate limit) — not a code defect; operator override is acceptable if the other gates are green.

2. **Pre-merge gate verification** (per `feedback_pr_merge_pregate.md`):
   ```
   gh pr view 159 --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
   ```
   Required state before merge: `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN` (or `BLOCKED` with documented reason), reviews approved if branch protection requires.

3. **Merge PR #159 with squash** once gates green — `gh pr merge 159 --squash --subject "ORCH-0906 client hotfix: wire curated_payload through deckService + fix swipe empty-state flash"`. The squash commit should retain the three sub-commits' meaning via the body.

4. **Publish iOS OTA** after merge per `feedback_response_shape_conditional.md`:
   ```
   cd app-mobile && eas update --branch production --platform ios --message "ORCH-0906 client hotfix: curated cards render properly + no swipe empty-state flash"
   ```
   No DB migration, no edge function deploy. Pure JS bundle.

5. **(Optional) Run SC-01..SC-18 follow-up** at your discretion. Devices are still loaded — iPhone 17, iPhone 17 Pro, iPhone 17 Pro Max, Pixel_8_Pro all signed in and Metro-connected. If you want the deferred coverage closed in this session before logging out, dispatch me again with `/mingla-tester SC-01..SC-18 multi-account collab sweep on hotfix branch`.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `ORCH-0906-CLIENT-HOTFIX` at `0412cdac`.
