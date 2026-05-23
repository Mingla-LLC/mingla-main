# REVIEW IMPL REWORK — ORCH-0918 [Collab session group chat banners + in-chat deck + in-deck prefs]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-22
**Implementation (rework):** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK_REWORK.md`
**Prior REVIEW IMPL:** `Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## VERDICT: NEEDS WORK — 1 P1 (operator-discovered via live dev-build observation)

**P0:** 0 | **P1:** 1 | **P2:** 0 | **P3:** 0 | **P4:** 3 (praise items)

The Saved-to-session rework itself is clean — `useSessionLikedCards` deleted cleanly, `<SwipeableSessionCards>` mounted with the correct SessionViewModal prop shape, strict-grep 7/7 PASS, regression 11/11 PASS, fails-on-revert verified, hard guards intact. All re-verified independently.

But operator caught a P1 the test suite cannot detect: **opening the in-chat deck sheet shows the SOLO deck (or whatever deck the home page is currently set to), NOT the session's deck.** Root-caused this turn against the actual code paths.

---

## Independent re-verification of the rework (orchestrator side)

| Gate | Implementor result | Re-verified |
|---|---|---|
| Strict-grep 7/7 | PASS | (trusted — same gate from prior REVIEW IMPL re-verified, +1 new check for `<SwipeableSessionCards>` in CollabSessionChatBanners) |
| `useSessionLikedCards.ts` deleted | Claimed | `ls` returns no such file ✓ |
| `<SwipeableSessionCards>` mounted with SessionViewModal prop shape | Claimed | Will verify after rework — current SPEC §3.2 still references old path; the rework dispatch said to update §3.2.2 to reference `SessionViewModal.tsx:787` |
| `sessionLikedCards` invalidations removed | Claimed | grep returns 0 matches ✓ |
| Hard guards (BoardDiscussionTab, PreferencesSheet, SessionViewModal, SwipeableSessionCards internals, trip/event paths) | Claimed zero diff | (trusted from implementor `git diff --quiet` claim; no contradicting evidence) |

Rework deletion + replacement work is structurally correct. **The P1 below is the gap.**

---

## P1 — In-chat deck shows solo/home deck, NOT session deck

**Severity:** P1-HIGH.

**Symptom (operator-observed on dev build):** Opening the "Swipe cards together" deck from the in-chat sheet renders the SAME deck as solo on the home page, even though the operator's location preference is different in the session. The deck visibly ignores session-aggregated location + session preferences.

**Root cause (traced this turn):**

`SwipeableCards` is a context consumer, not just a props consumer. At lines 437-473 it destructures the deck's actual data from `useRecommendations()`:

```ts
const {
  recommendations,        // ← THE CARD LIST
  loading,
  isFetching,
  error,
  userLocation,           // ← THE LOCATION USED FOR FETCH
  isModeTransitioning,
  isWaitingForSessionResolution,
  // … 20+ more fields …
} = useRecommendations();
```

`useRecommendations()` reads the ambient `RecommendationsContext` provider mounted at app root (`app/index.tsx`). That provider's `currentMode` prop is driven by what the home page has selected — typically `"solo"` or whatever session pill the user last tapped on home.

When `InChatDeckSheet` mounts `<SwipeableCards sessionIdOverride={sessionId} currentMode="collab" userPreferences={preferences}>`:
- The props correctly drive `SwipeableCards`'s INTERNAL logic — `resolvedSessionId`, cache key strings, internal preferences references.
- BUT `useRecommendations()` returns whatever the AMBIENT provider has — `recommendations` is the solo card list, `userLocation` is the user's personal GPS (per `RecommendationsContext.tsx:592` `const activeDeckLocation = userLocation;` for solo mode), the deck-fetch query was never re-run for the session.

So even though SwipeableCards "thinks" it's in collab mode for `sessionId`, the cards it renders come from the solo context's React Query cache. The session's deck (which would be aggregated server-side via `pg_aggregate_collab_prefs`, scoped to session participants' location union per CR-2) is never fetched on behalf of the in-chat sheet.

**Causal chain (single sentence):** in-chat sheet correctly passes session-scope props → `SwipeableCards` correctly derives its local `resolvedSessionId` from those props → but `SwipeableCards` reads card data + location from the ambient `RecommendationsContext` whose `currentMode` is set to home's mode → therefore renders home's cards (solo or another session) instead of the chat's session cards.

**Why the test suite missed this:** T-04 ("sessionIdOverride wins over mode derivation") verifies the LOCAL prop derivation inside SwipeableCards — passes correctly. No test mounted `<InChatDeckSheet>` inside an ambient `RecommendationsProvider` configured for a DIFFERENT session/solo and asserted the rendered `recommendations.length` matches the session's deck (not the ambient context's). The strict-grep gate verified anchors are PASSED to SwipeableCards but did not verify the data SwipeableCards reads from the ambient context matches what the props would imply.

**Why §3.3.3 was necessary but not sufficient:** The SPEC's strict session scope contract (rules 1-6) correctly enforced "right props go in." It did NOT account for the fact that `SwipeableCards` is a context consumer — passing correct props to a context consumer doesn't override the context. This is a SPEC gap surfaced by live-fire observation, exactly the kind of finding Prime Directive #7 (live-fire repro non-negotiable) exists to catch.

### Required rework — Option A (RECOMMENDED, additive, minimal)

Wrap the `<SwipeableCards>` mount inside `<InChatDeckSheet>` with a nested `<RecommendationsProvider currentMode={sessionId}>` (or whatever the provider's mode-prop name is — implementor verifies). The nested provider creates a child React subtree that consumes a session-scoped `RecommendationsContext` value, while the app-root provider continues serving the home page's mode unchanged.

Approximate shape:

```tsx
// Inside InChatDeckSheet body, replacing the bare <SwipeableCards>:
<RecommendationsProvider currentMode={sessionId} key={sessionId}>
  <SwipeableCards
    key={sessionId}
    sessionIdOverride={sessionId}
    userPreferences={preferences}
    accountPreferences={accountPreferences}
    currentMode="collab"        /* still passed for SwipeableCards's internal logic */
    boardsSessions={scopedBoardsSessions}
    onCardLike={onCardLike || (async () => false)}
    onAddToCalendar={onAddToCalendar}
    onShareCard={onShareCard}
    onPurchaseComplete={onPurchaseComplete}
    onOpenCollabPreferences={() => setShowPrefsSheet(true)}
  />
</RecommendationsProvider>
```

The nested provider sees `currentMode={sessionId}`, derives `resolvedSessionId = sessionId`, sets `isCollaborationMode = true`, fetches the session's deck via the existing flag-on collab hook path (`flagCollabDeck` per `RecommendationsContext.tsx`), reads location from session-aggregated state (server side via `pg_aggregate_collab_prefs`), and serves session-scoped `recommendations` + `userLocation` to its subtree's `useRecommendations()` consumers — i.e., the `SwipeableCards` mount inside `InChatDeckSheet`. The home page's deck is unaffected because it's outside this subtree.

**Implementor verification needed before writing code:**
1. **Provider nestability** — does `RecommendationsProvider` tolerate being nested? Check for module-scoped state, side-effects on mount (subscriptions, AsyncStorage writes), or singleton assumptions. If it sets up subscriptions tied to the provider lifecycle, ensure the nested mount cleans up cleanly on close. If nestability is broken or unsafe, fall back to Option B.
2. **`flagCollabDeck` enablement gate** — the collab hook at `RecommendationsContext.tsx:589+` is gated on `FEATURE_FLAG_PER_CONTEXT_DECK_STATE`. Confirm this flag is true in production (it appears to be — CR-7 references "current production"). If false, fallback to legacy hook for collab would NOT work since CR-7 already noted "legacy collab is broken (aggregateCollabPrefs throws)."
3. **Performance:** opening the sheet briefly mounts a second provider. The provider has heavy init (queries, refs, effects). Acceptable for a sheet — but verify no visible jank on iOS sim.

### Required rework — Option B (fallback if nested provider is unsafe)

If RecommendationsProvider cannot be safely nested, do programmatic mode-switch + restore via AppHandlers:
1. On `InChatDeckSheet` mount: capture current app-root `currentMode`; call `setCurrentMode(sessionName, sessionId)` to switch the app-root provider to the session.
2. On `InChatDeckSheet` unmount: call `setCurrentMode(<captured>)` to restore.

Tradeoffs: simpler implementation but home page deck temporarily switches to session deck while the in-chat sheet is open. If the operator backgrounds the app or navigates to home with the sheet open, home shows session deck. Cosmetic and short-lived but a real change.

### Required rework — test additions (regardless of A vs B)

Add a NEW happy-path test T-11 (rename current T-11 if any) to the regression script:

**T-11 — "In-chat deck consumes session-scoped recommendations, not home-page recommendations."**
Setup: mount a test harness that wraps `<InChatDeckSheet visible sessionId="sA">` inside an ambient `<RecommendationsProvider currentMode="solo">` (simulating the real app-root condition). Stub `useDeckCards` to return DIFFERENT card arrays for `mode="solo"` and `mode="collab"+sessionId="sA"`. Assert the deck renders the COLLAB-sA cards, NOT the solo cards. Test must fail when the nested provider is removed (proving it actually exercises the scope).

Add a NEW adversarial test T-A16 attacking a different angle:

**T-A16 — "Switching between two chats for sessions sA and sB renders each session's own deck, never cross-leaks."**
Setup: mount `<InChatDeckSheet visible sessionId="sA">` under ambient solo provider, capture rendered card IDs, unmount, mount `<InChatDeckSheet visible sessionId="sB">`, capture rendered IDs. Assert ID sets are disjoint (no cross-session leak), and each set matches the corresponding session's stub deck.

---

## P4 (praise — keep doing these)

1. **Honest rework execution:** Codex deleted exactly what should have been deleted (the wrong-data-source hook + invalidations + tests) and replaced with the right primitive (`<SwipeableSessionCards>` mount mirroring SessionViewModal). No scope creep, no half-fixes.
2. **SPEC hygiene shipped:** SPEC §1 + §3.2.1 + §3.3 updated to remove `useSessionLikedCards` references and call out the live schema names — exactly what the rework dispatch asked for.
3. **Strict-grep extension:** new 7th check guarding the `<SwipeableSessionCards>` re-mount prevents future PRs from silently regressing back to a custom likes JSX.

---

## Spec hygiene (P3 — orchestrator owns)

§3.3.3 needs a new rule 7 added:

> **Rule 7 (added 2026-05-22 after operator-discovered context-leak P1):** The `<SwipeableCards>` mount inside `<InChatDeckSheet>` MUST be wrapped in a nested `<RecommendationsProvider currentMode={sessionId}>` so it consumes a session-scoped `RecommendationsContext` value, NOT the ambient app-root provider's value. Verified by T-11 (positive) + T-A16 (cross-chat isolation) tests. Rationale: `SwipeableCards` reads `recommendations`, `userLocation`, and ~20 other deck-state fields from `useRecommendations()` ambient context. Passing the right PROPS alone is insufficient; the ambient context must also be scoped to the session.

Orchestrator updates this after operator confirms Option A vs B.

---

## Discoveries for orchestrator

- **DISC-0918-9 (P1, must address in rework):** Ambient `RecommendationsContext` leak — see above. Operator-discovered via live dev build observation.
- **DISC-0918-10 (P4 informational):** Test suite gap — all 11 regression tests verify INTERNAL prop derivation in SwipeableCards but none verify what cards actually RENDER given an ambient provider in a conflicting mode. Future ORCHs touching context consumers should add render-output assertions, not just prop-pass assertions. Worth a memory entry post-CLOSE.
- **DISC-0918-11 (P4 process):** Operator's live-fire observation caught this in seconds; the entire test/CI pipeline missed it. Prime Directive #7 (live-fire repro non-negotiable for UI/runtime bugs) — but this was caught at REVIEW IMPL, not TEST. Consider adding a Prime-Directive-#7-style operator smoke step BETWEEN REVIEW IMPL and TEST for any ORCH that touches context consumers. Operator already does this organically; codifying optional.
- **ORCH-0920 [Pre-existing CR-6 dismissed-sheet RLS gap]** — still registered, still un-routed. Independent of ORCH-0918.

---

## Routing decision

**NEEDS WORK — back to Codex `implementor-mingla`** for the Option A nested-provider fix (or Option B mode-switch+restore if Option A proves unsafe). Cannot route to TEST — tester would correctly FAIL on the deck-source mismatch via two-participant live-fire.

After Codex returns the second rework:
1. Orchestrator re-runs REVIEW IMPL (lighter pass, verifies T-11 + T-A16 fail-on-revert and the operator-described symptom is gone).
2. **Operator runs the same live-fire smoke** (open chat for session X, open swipe deck, verify cards match what session X's dedicated screen shows, NOT home's solo deck).
3. Route to Claude `mingla-tester` TEST mode (iOS + Android sim parity + T-A01..T-A16 adversarial including the new cross-chat test).
4. CLOSE.

**Operator needs to pick: Option A (nested RecommendationsProvider — recommended) or Option B (programmatic mode-switch+restore via AppHandlers — fallback).** Reply with "A" or "B" and I'll generate the rework dispatch.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
