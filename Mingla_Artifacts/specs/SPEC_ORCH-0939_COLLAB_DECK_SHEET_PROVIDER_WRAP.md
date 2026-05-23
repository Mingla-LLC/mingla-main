# SPEC ORCH-0939 — Wrap CollabDeckSheet in per-session RecommendationsProvider

**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0939_COLLAB_DECK_SHEET_SOLO_LEAK.md`
**Mode:** SPEC (forensics)
**Status:** Ready for implementor
**Target:** Production-ready, ships ahead of ORCH-0931 [Realtime broadcast session_updated] retest

## §1 Plain-English summary

CollabDeckSheet is the post-META-ORCH-0929 [collab decks in group chat] full-screen modal that opens when a user taps "Swipe" in a session-linked group chat. Today, its SwipeableCards renders the **solo deck** under the collab UI chrome because no per-session RecommendationsProvider wraps the modal's contents — the data falls through to the global `currentMode="solo"` provider at `app/index.tsx:2287`. Every collab session participant sees their own solo cards, violating the ORCH-0909 [positional shared deck] contract silently.

Fix: wrap the SwipeableCards inside CollabDeckSheet with `<RecommendationsProvider currentMode={sessionId} key={sessionId}>`, mirroring the pre-META-ORCH-0929 pattern at `CollabSessionChatBanners.tsx:584`. Three lines of code. Pure client-side.

## §2 Scope and non-goals

### In scope

1. Edit `app-mobile/src/components/connections/CollabDeckSheet.tsx` — wrap the existing SwipeableCards mount in a per-session RecommendationsProvider.
2. New unit test `CollabDeckSheet.providerWrap.test.tsx` proving the provider wrap is present + `currentMode={sessionId}` reaches the context.
3. New strict-grep CI gate `i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` enforcing the wrap can't be removed in future refactors.
4. New memory file `feedback_collab_deck_must_wrap_with_provider.md` documenting the pattern for future implementors.

### Non-goals (explicitly out of scope)

- **Removing the global RecommendationsProvider at `app/index.tsx:2286-2291`.** It still serves the Home Explore (solo) deck correctly. Leave it.
- **Fixing the solo-context wasted work** when user is in CollabDeckSheet (the global solo provider keeps fetching its solo deck in the background). Real but separate; perf concern not user-visible. Queue as ORCH follow-up.
- **Saved-to-session cards sheet** (`SavedToSessionCardsSheet`, opened from the chat header's Matches pill) — may have the same context-resolution issue. NOT confirmed broken in this investigation; investigate separately if reports surface.
- **ORCH-0931 [Realtime broadcast session_updated]** — strictly downstream of ORCH-0939. Once this fix lands, the ORCH-0931 broadcast→invalidate→refetch chain becomes user-visible. Retest ORCH-0931 after ORCH-0939 closes.
- **Bug 2 (chat-deck legibility)**, **bug 3 (collab Apply coord-write corruption)**, **rebind storm**, **left-swiped re-serve** — all separate, all out of scope.

### Assumptions

1. The global `RecommendationsProvider currentMode="solo"` at `app/index.tsx:2286-2291` is still required for the Home Explore tab (solo deck surface). Verified — `HomePage.tsx` Explore tab renders SwipeableCards directly and depends on this provider.
2. `RecommendationsProvider`'s props (`currentMode`, `refreshKey`, `persistedSessionId`, `onSessionLost`) are stable; we can pass `currentMode={sessionId}` (a UUID) and the existing UUID-handling at `RecommendationsContext.tsx:349-351` will resolve correctly.
3. Mounting/unmounting the provider on Modal open/close is acceptable — provider lifecycle aligns with sheet lifecycle. Channel subscribes/unsubscribes per session-open per ORCH-0926's existing rebind logic.

## §2.5 Cross-Surface Impact

| Surface | Coverage | Behaviour |
|---|---|---|
| Consumer iOS | **PRIMARY — covered** | CollabDeckSheet renders the actual session deck cards (Cary/DC/Raleigh places for "Testing stuff", not Lagos). Realtime broadcasts from ORCH-0931 become visible. ORCH-0909 determinism contract holds again. |
| Consumer Android | **PRIMARY — covered** | Shared RN code path. Parity automatic. |
| Buyer/anonymous Web | **NOT covered** | No CollabDeckSheet in buyer-web. |
| Business iOS / Android | **NOT covered** | mingla-business does not render CollabDeckSheet. |
| Admin Web | **NOT covered** | Admin does not render CollabDeckSheet. |
| Business Web preview | **NOT covered** | Same. |

Parity: automatic across iOS + Android (one shared TS file change). Single success criterion suffices.

## §3 Layer-by-layer specification

### §3.1 Component layer — `CollabDeckSheet.tsx`

**File:** `app-mobile/src/components/connections/CollabDeckSheet.tsx`

**Import addition** at the top of the file (alongside existing component imports):

```ts
import { RecommendationsProvider } from "../../contexts/RecommendationsContext";
```

**Body edit** — lines 111-130 (the existing `<View style={styles.deck}>` block). Replace:

```jsx
<View style={styles.deck}>
  <SwipeableCards
    userPreferences={userPreferences}
    accountPreferences={accountPreferences}
    currentMode={sessionId}
    sessionIdOverride={sessionId}
    boardsSessions={[]}
    onAddToCalendar={onAddToCalendar ?? noop}
    onCardLike={onSaveCard ?? asyncNoop}
    onShareCard={onShareCard}
    onPurchaseComplete={onPurchaseComplete}
    removedCardIds={[]}
    onResetCards={noop}
    onOpenPreferences={onOpenPreferences}
    onOpenCollabPreferences={handleOpenPreferences}
    generateNewMockCard={noop}
    refreshKey={0}
    savedCards={savedCards}
  />
</View>
```

With:

```jsx
<View style={styles.deck}>
  {/* ORCH-0939: per-session RecommendationsProvider wraps the SwipeableCards so it
      reads collab session data via useRecommendations() instead of falling through
      to the global currentMode="solo" provider at app/index.tsx:2286. Mirrors the
      pre-META-ORCH-0929 pattern at CollabSessionChatBanners.tsx:584 (deleted by
      META-ORCH-0929 without a replacement, which produced the regression this
      fix closes).
      key={sessionId} forces a clean remount when switching sessions. */}
  <RecommendationsProvider
    currentMode={sessionId}
    refreshKey={0}
    persistedSessionId={sessionId}
    onSessionLost={onClose}
    key={sessionId}
  >
    <SwipeableCards
      userPreferences={userPreferences}
      accountPreferences={accountPreferences}
      currentMode={sessionId}
      sessionIdOverride={sessionId}
      boardsSessions={[]}
      onAddToCalendar={onAddToCalendar ?? noop}
      onCardLike={onSaveCard ?? asyncNoop}
      onShareCard={onShareCard}
      onPurchaseComplete={onPurchaseComplete}
      removedCardIds={[]}
      onResetCards={noop}
      onOpenPreferences={onOpenPreferences}
      onOpenCollabPreferences={handleOpenPreferences}
      generateNewMockCard={noop}
      refreshKey={0}
      savedCards={savedCards}
    />
  </RecommendationsProvider>
</View>
```

**RecommendationsProvider prop rationale:**

| Prop | Value | Why |
|---|---|---|
| `currentMode` | `{sessionId}` | UUID-as-currentMode is detected at `RecommendationsContext.tsx:349-351` regex → `resolvedSessionId` becomes that UUID → `isCollaborationMode` becomes true. Same as the pre-META pattern. |
| `refreshKey` | `0` | We're not driving solo-prefs-refresh from here; the collab pref-change flow uses its own invalidation path via ORCH-0923 [collab params change detector]. Static 0 is safe. |
| `persistedSessionId` | `{sessionId}` | Persisted-session fast-path expects this. Speeds up cold-start session resolution if the modal mounts before `availableSessions` loads. |
| `onSessionLost` | `{onClose}` | If the session is deleted/lost while the modal is open, close the modal cleanly. Per ORCH-0444's INV-DEL-1 monitor pattern. |
| `key` | `{sessionId}` | Forces full remount when sessionId changes (e.g., user backs out and opens a different chat's deck). Prevents stale state from one session leaking into another. |

**File touched:** 1 (`CollabDeckSheet.tsx`).
**Lines added:** ~8 net (provider wrap + import).
**Lines removed:** 0.

### §3.2 No other layer changes

- **Database layer:** unchanged.
- **Edge function layer:** unchanged.
- **Service layer:** unchanged.
- **Hook layer:** unchanged.
- **Realtime layer:** unchanged. ORCH-0926 [Realtime scoped authenticated rebind] + ORCH-0931 [Realtime broadcast session_updated] continue to work as designed; this fix makes their output visible.

## §4 Success criteria

| ID | Criterion | How to verify |
|---|---|---|
| **SC-1** | When CollabDeckSheet opens for session X, SwipeableCards inside it renders cards from the X session's deck (frozen positions OR fresh positions generated via the session's aggregator), NOT cards from the current user's solo deck. | Live test on dev build: open Testing stuff CollabDeckSheet. Expected first card: a Cary/Durham/DC/Raleigh place (matching the session's actual aggregator), NOT a Lagos place. Sample positions to verify against DB: position 41 = "Pro's Epicurean Ristorante, Cary, NC". |
| **SC-2** | Two participants opening the same session's CollabDeckSheet see the same card at the same `current_position` (ORCH-0909 contract restored). | Two-sim test: both open Testing stuff CollabDeckSheet at `current_position=N`. Both screens show the same card. (Will not be true today; will be true after SC-1.) |
| **SC-3** | ORCH-0931 [Realtime broadcast session_updated] becomes user-visible: when one participant changes prefs, the other participants' CollabDeckSheet refetches and re-renders the new aggregate within 2 seconds. | Two-device live-fire: change pref on device A. Within 2s, device B's metro log shows `broadcast session_updated` + `onSessionUpdated fired` + `collab params changed, invalidating deck-cards`, AND the deck UI refetches via the collab query key, AND the rendered cards update. |
| **SC-4** | Home Explore tab (solo deck) continues to work correctly — solo cards render, swipes work, prefs sheet works. | Regression smoke: open Explore tab on the same sim, swipe a card, verify it's a solo card matching current solo prefs. |
| **SC-5** | The new strict-grep CI gate `i-proposed-orch-0939-collab-deck-has-per-session-provider` fails any future PR that removes the RecommendationsProvider wrap from CollabDeckSheet. | CI dry-run on a fixture PR with the provider deleted → gate fails with a clear error citing the ORCH-0939 invariant. |
| **SC-6** | The unit test `CollabDeckSheet.providerWrap.test.tsx` asserts that rendering CollabDeckSheet with a given sessionId produces a React tree where SwipeableCards' useContext call resolves to a provider with `currentMode === sessionId`. | `npx jest CollabDeckSheet.providerWrap.test.tsx` passes. Fails-on-revert: deleting the provider wrap from CollabDeckSheet.tsx → test fails with assertion error. |
| **SC-7** | Switching from one session's CollabDeckSheet to another (close modal, tap a different chat, tap Swipe) cleanly remounts with the new sessionId — no stale state from the prior session leaks. | Live test: open session A's deck, close, open session B's deck. Verify B's deck shows B's session cards, not A's. |
| **SC-8** | Closing the CollabDeckSheet modal tears down the per-session provider cleanly (no orphan realtime subscriptions, no leaked channels). | Probe `realtime.subscription` table before/after modal close. Channel for `board_session:<sessionId>` should be present while modal is open and absent after close (or persists per useBoardSession unmount logic — confirm with the implementor that the existing teardown still fires). |
| **SC-9** | The "152 viewed" badge inside CollabDeckSheet reflects the SESSION's accumulated swipe history, not the user's solo deck history. (Bug correcting itself.) | Live observation: after the fix, the badge count drops dramatically (44 positions max, however many have been swiped within those). |

## §5 Invariants

### Preserved

| Invariant | How preserved |
|---|---|
| `ORCH-0909` positional shared deck contract | Restored — all participants finally read from the same session-keyed query, see the same frozen card at the same position. |
| `ORCH-0902` deterministic deck aggregation | Unchanged at backend; the new provider correctly hands the session UUID to the deck-fetching machinery. |
| `ORCH-0926` realtime scoped authenticated rebind | Unchanged. The realtime channel inside the new per-session context still fires under the same ORCH-0926 setAuth+rebind logic. |
| `ORCH-0931` realtime broadcast session_updated | Becomes visible — broadcasts now reach a SwipeableCards that reads from the matching collab context. |
| `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5 (backend untouched) | Preserved — this fix is purely client-side. |
| Global solo deck (Home Explore tab) | Preserved — the global `currentMode="solo"` provider at `app/index.tsx:2286` still serves Home Explore exclusively. |

### New invariant established

**`I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER`** — `app-mobile/src/components/connections/CollabDeckSheet.tsx` MUST wrap its inner `<SwipeableCards>` in a `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` so the deck reads from the correct collab context, not the global solo provider. CI gate: `.github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` scans CollabDeckSheet.tsx for the pattern `<RecommendationsProvider[\s\S]+currentMode=\{sessionId\}[\s\S]+<SwipeableCards`. Self-test: 1 positive (correct file with wrap), 1 negative (file without wrap), 0 allowlist.

## §6 Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-IMP-1** (happy path, implementor) | CollabDeckSheet renders SwipeableCards wrapped in a RecommendationsProvider | Mock `<CollabDeckSheet visible sessionId="test-uuid" ...>` and traverse the React tree | Assert that there exists a `RecommendationsProvider` ancestor of `SwipeableCards` in the rendered tree, with `currentMode={sessionId}` | Component unit test |
| **T-IMP-2** (happy path, implementor) | `useRecommendations()` inside the CollabDeckSheet's SwipeableCards reads from the per-session provider, not the global solo one | Render CollabDeckSheet wrapped in a parent that mounts `<RecommendationsProvider currentMode="solo">`; inspect the inner SwipeableCards' useContext result | Inner provider's `currentMode === sessionId` (UUID), NOT "solo" | Context unit test |
| **T-IMP-3** (happy path, implementor) | Provider remounts cleanly when sessionId changes | Render `<CollabDeckSheet sessionId="A">`, then re-render with `sessionId="B"`, verify the inner provider's context value reflects "B" not "A" | New context value with `currentMode === "B"`; no stale state from "A" leaking | Context unit test |
| **T-IMP-FAIL-ON-REVERT** | Reverting the provider wrap to bare SwipeableCards causes T-IMP-1 to fail | Manually delete the `<RecommendationsProvider>` lines in CollabDeckSheet.tsx, re-run T-IMP-1 | Test fails with "expected RecommendationsProvider ancestor, found none" or equivalent | Verify implementor's fails-on-revert hash matches ORCH-0840 Step 0.5 gate |
| **T-TESTER-A1** (adversarial, tester) | Two real iOS sims in the same session see the same card at the same position post-fix | Both sims open Testing stuff CollabDeckSheet; both at `current_position=N`; assert visually-identical card content | Same card title, same place, same price range. (ORCH-0909 contract holds.) | Live two-sim |
| **T-TESTER-A2** (adversarial, tester) | Remote pref change on device A causes device B's CollabDeckSheet to refetch and re-render the new aggregate within 2 seconds | Device A bumps travel_time via UI → device B's metro shows `broadcast session_updated` + `onSessionUpdated fired` + new deck-cards query result | Within 2s. New card or same card depending on whether the change moved the aggregate enough to alter position N+1's outcome. | Live two-device |
| **T-TESTER-A3** (adversarial, tester) | Solo deck unaffected by the new wrap | Open Home Explore (solo deck) on the same sim that just used CollabDeckSheet; swipe a card | Solo card from current solo prefs renders; swipe persists; no regression. | Live single-sim |
| **T-TESTER-A4** (adversarial, tester) | Session switch — close session A's deck, open session B's deck | Tap close on CollabDeckSheet A; navigate to chat B; tap Swipe; observe session B's deck content | Session B's actual frozen cards render. No card from A's deck appears in B's deck. | Live single-sim |

Implementor delivers T-IMP-1..3 + T-IMP-FAIL-ON-REVERT at the file path `app-mobile/src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx`. Tester delivers T-TESTER-A1..A4 live-fire evidence in the QA report.

## §7 Implementation order

1. **Edit `CollabDeckSheet.tsx`** per §3.1 — add import + wrap SwipeableCards in provider. ~8 lines net.
2. **Write `CollabDeckSheet.providerWrap.test.tsx`** with T-IMP-1..3. Verify fails-on-revert by reverting the §3.1 edit, running the test, capturing the failure, restoring. Record the commit hash.
3. **Write the strict-grep CI gate** at `.github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` + `.test.mjs`. Wire into `.github/workflows/strict-grep-mingla-business.yml`. Self-test: 1 positive fixture, 1 negative fixture.
4. **Write the memory file** `feedback_collab_deck_must_wrap_with_provider.md` documenting the pattern for future implementors.
5. **Local typecheck + lint** scoped to `CollabDeckSheet.tsx` and the new test file. `npx tsc --noEmit` on `app-mobile/`. ESLint on changed files.
6. **Write the implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md` with old→new receipts, test run output, fails-on-revert commit hash, and deploy notes (none — client-only change).
7. **No backend changes; no migration; no edge deploy.** EAS Update ships the JS via the standard orchestrator CLOSE Step 3.

## §8 Regression prevention

| Class of bug | Safeguard |
|---|---|
| Future refactor removes the provider wrap from CollabDeckSheet | Strict-grep CI gate `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER` fails the PR |
| Future implementor adds a new collab-deck surface without per-session provider | The `feedback_collab_deck_must_wrap_with_provider.md` memory file warns future implementors; the chat-native sheet redesign META-ORCH (per `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`) MUST cite this Contract |
| Provider's `currentMode` accidentally hardcoded to "solo" | The strict-grep gate matches the EXACT pattern `currentMode={sessionId}`; literal "solo" would fail the regex |
| `RecommendationsContext.tsx:349-351` UUID regex breaks | Out of scope here; would surface as session resolution failure (no Lagos cards but no Cary/DC cards either). Defensive coverage of that regex is its own concern. |

## §9 Operational considerations

- **No migration.** No `supabase db push` step.
- **No edge deploy.** No `supabase functions deploy` step.
- **EAS Update only.** `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0939: CollabDeckSheet reads collab session deck, not solo"`.
- **Backwards compatibility:** Old clients (pre-fix) continue to render their solo deck under CollabDeckSheet chrome — same broken behaviour as today. New clients render the correct collab deck. Inconsistency is brief (until EAS update is downloaded).
- **Rollback:** Revert the §3.1 diff via a follow-up PR + EAS update. App returns to broken-but-stable state.

## §10 Confidence and risk

| Factor | Level | Justification |
|---|---|---|
| Root cause certainty | High | DB inspection + source trace + screenshot evidence triangulate identically. |
| Fix mechanism correctness | High | Exact pattern was used pre-META-ORCH-0929 at `CollabSessionChatBanners.tsx:584` and worked; we're restoring it in the new home. |
| Implementation complexity | Low | ~8 lines net change in one component file + one new test file + one new CI gate + one memory file. |
| Backwards compatibility risk | Low | Old and new clients coexist; the deck rendered for old clients was already broken. |
| Performance impact | Negligible | One additional provider instance while modal is open; tears down on close. The existing global solo provider still runs (separate ORCH addresses its waste). |
| Test coverage | High | 4 implementor tests + 4 adversarial tester tests + 1 CI gate + 1 fails-on-revert commit. |
| Routing of dependent ORCHs | Clear | ORCH-0931 retest paused until this closes; META-ORCH-0929 close gets a note. |

## §11 Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. The ORCH-0931 [Realtime broadcast session_updated] code + migration are in place on `Seth`; this fix is purely additive in `CollabDeckSheet.tsx`. ORCH-0926 [Realtime scoped authenticated rebind] diag scaffolding preserved. No conflict with prior in-flight work.
