# REVIEW IMPL REWORK 2 — ORCH-0918 [Collab session group chat banners + in-chat deck + in-deck prefs]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-22
**Implementation (rework 2):** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK_REWORK_2.md`
**Prior REVIEW IMPL REWORK 1:** `Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK_REWORK.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## VERDICT: APPROVED — PASS

**P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 4 (praise)

The nested `RecommendationsProvider` fix is exactly what was requested. Operator-discovered context leak from REWORK 1 is structurally addressed; tests now exercise the fix at the right level (rendered output, not just prop pass). Ready for operator live-fire smoke + tester TEST mode.

---

## Independent re-verification (lighter pass — focus on the fix)

| Check | Result |
|---|---|
| Strict-grep | **PASS 8/8** (re-ran via Bash). New 8th check `in-chat deck mount is wrapped in session-scoped RecommendationsProvider` is live and passing. |
| `npm run test:orch-0918` | **PASS 13/13** (re-ran). Includes new T-11 (positive: session deck renders despite ambient solo) + T-12 (saved-to-session remount) + T-A16 (cross-chat isolation). |
| `ORCH0918_SIMULATE_REMOVE_PROVIDER=1` simulated revert | **FAIL on T-11 + T-A16** as expected. Proves both new tests exercise the provider wrap, not just structural assertions. |
| `ORCH0918_SIMULATE_REMOVE_PROVIDER_KEY=1` simulated revert | **FAIL on T-A16 only** as expected. Proves T-A16 specifically exercises the `key={sessionId}` remount guarantee — distinct angle from T-11. Two tests, two failure modes, two different angles. |
| JSX shape | Verified at `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:533`: `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` wraps `<SwipeableCards key={sessionId} sessionIdOverride={sessionId} userPreferences={preferences} accountPreferences={accountPreferences} currentMode="collab" boardsSessions={scopedBoardsSessions} … />` — every existing prop preserved exactly, nested provider is purely additive. |
| Hard guards | `git diff --stat HEAD --` on `RecommendationsContext.tsx`, `SwipeableCards.tsx`, `app/index.tsx`, `BoardDiscussionTab.tsx`, `PreferencesSheet.tsx`, `SessionViewModal.tsx`, `SwipeableSessionCards.tsx`, `TripCountdownBanner.tsx` returns EMPTY — zero diff on all 8 protected files. |
| SPEC §3.3.3 Rule 7 | Added at line 270 of `SPEC_ORCH-0918_…md` — verbatim text matches dispatch. |
| SPEC §4 SC-23d | Added at line 373 — verifies provider-descendant JSX-tree assertion. |
| Constitution #2 audit | Updated at line 393 to reflect "in-chat deck data owned by nested session-scoped provider subtree, distinct from app-root/home provider." Genuinely passes now (not just structurally). |
| T-11 spec entry | Added at line 430 with input + expected + fails-on-revert reference. |

---

## What changed structurally (one-line diff)

Inside `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` `InChatDeckSheet` body, the previous bare `<SwipeableCards>` mount is now wrapped:

```diff
   <View style={styles.deckBody} key={sessionId}>
-    <SwipeableCards
+    <RecommendationsProvider currentMode={sessionId} key={sessionId}>
+      <SwipeableCards
         key={sessionId}
         sessionIdOverride={sessionId}
         userPreferences={preferences}
         accountPreferences={accountPreferences}
         currentMode="collab"
         boardsSessions={scopedBoardsSessions}
         onCardLike={onCardLike || (async () => false)}
         onAddToCalendar={onAddToCalendar}
         onShareCard={onShareCard}
         onPurchaseComplete={onPurchaseComplete}
         onOpenCollabPreferences={() => setShowPrefsSheet(true)}
-    />
+      />
+    </RecommendationsProvider>
   </View>
```

All prior props preserved. Nested provider keyed by `sessionId` guarantees clean remount on chat-switch. App-root provider in `app/index.tsx` untouched.

---

## Two-failure-mode receipt — why this is a strong pass

The test suite now has independent enforcement on two distinct angles:

1. **`SIMULATE_REMOVE_PROVIDER` → T-11 + T-A16 both fail** — proves "without the nested provider, session deck data doesn't reach SwipeableCards (T-11) AND cross-chat isolation doesn't hold (T-A16)."
2. **`SIMULATE_REMOVE_PROVIDER_KEY` → T-A16 fails only** — proves "with the provider but no key, T-11 passes (single session works) but T-A16 fails (session A → session B reuses A's state)."

Two different failure modes on two different anchors = the tests genuinely exercise both the provider presence AND the key-based remount. This is exactly the multi-angle adversarial coverage ORCH-0840 Step 0.5 calls for.

---

## P4 (praise — patterns to keep)

1. **Smallest possible fix:** one wrapper element added, every existing prop preserved verbatim, RecommendationsContext untouched, SwipeableCards untouched, app-root provider untouched. Pure additive change. Constitution #8 honored.
2. **Two-angle fails-on-revert:** the `SIMULATE_REMOVE_PROVIDER` vs `SIMULATE_REMOVE_PROVIDER_KEY` separation cleanly proves each anchor is independently load-bearing. Future ORCHs touching context wrappers should follow this pattern.
3. **Strict-grep new check:** the 8th gate "in-chat deck mount is wrapped in session-scoped RecommendationsProvider" prevents silent regression at PR-review time. Plug-and-play with the existing registry pattern per `feedback_strict_grep_registry_pattern.md`.
4. **SPEC §3.3.3 Rule 7 + SC-23d:** the spec now reflects what was learned from the operator-discovered context leak. Future ORCHs that touch context consumers will read this rule and avoid the same trap.

---

## Operator live-fire smoke checklist (run on dev build BEFORE tester dispatch)

The implementor's report includes a smoke checklist; orchestrator's version below mirrors it with explicit pass criteria:

1. **Setup state:** ensure you have at least 2 collab sessions where YOUR location preference differs between them (e.g., session A pinned to Brooklyn, session B pinned to Manhattan, OR session A walking 20min vs session B driving 45min). Confirm via the dedicated session screens that each session shows a visibly different deck (different cards / different distance ranges).
2. **Home page first:** open the home page in solo mode. Note the first 3-5 card titles you see.
3. **Open session A's chat:** from Friends tab, open the group chat for session A. Tap "Swipe cards together" banner.
4. **Verify (PASS):** the deck shown is session A's deck — **different** from the home solo cards you noted in step 2, **matches** what session A's dedicated screen shows. If you see the same cards as step 2 (or as the dedicated solo screen), it's a FAIL — report immediately.
5. **Close the sheet, open session B's chat:** back out of session A's chat, open session B's chat, tap "Swipe cards together."
6. **Verify (PASS):** the deck shown is session B's deck — **different** from both session A's deck AND home's solo deck.
7. **Verify the home page is unchanged:** back to home page. The home solo deck should be exactly the cards from step 2 — opening the in-chat sheets did NOT mutate home's deck.
8. **Verify CR-3 cutover with prefs:** inside session A's in-chat deck sheet, swipe 1-2 cards. Open the Preferences icon (top-right of the sheet). Change a preference (e.g., travel time). Close prefs. Confirm the next cards you swipe are STILL the same V_n deck (cards don't swap underfoot mid-deck). Swipe through to the end of V_n, then verify the next card after V_n exhaustion is V_{n+1}.

If steps 4, 6, and 7 all PASS, the operator-discovered P1 from REWORK 1 is genuinely fixed end-to-end. Report any FAIL to me before dispatching the tester.

---

## Discoveries for orchestrator

- **DISC-0918-12 (P4 informational):** Multi-angle simulate-revert flags (`SIMULATE_REMOVE_PROVIDER` + `SIMULATE_REMOVE_PROVIDER_KEY`) are a clean reusable pattern. Consider memory entry: "When a single fix has multiple independently-load-bearing anchors, write multiple simulate-revert flags one per anchor, and assert each flag causes its own distinct set of tests to fail." Codify post-CLOSE.
- **ORCH-0920 [Pre-existing CR-6 dismissed-sheet RLS gap]** — still registered, still un-routed. Independent of ORCH-0918; operator decides timing post-CLOSE.

---

## Routing decision

**APPROVED. Routing:**

1. **Operator runs the live-fire smoke checklist above on dev build.** Critical step — REWORK 1's bug was caught by exactly this, REWORK 2 needs the same human-eye confirmation before tester time is spent. Estimated 5-10 minutes.
2. After operator confirms smoke PASS → Claude `mingla-tester` TEST mode (iOS Simulator + Android Emulator parity; T-A01..T-A16 adversarial including two-real-participant verification on Saved-to-session cross-attribution AND per-session deck isolation on real devices).
3. After tester PASS → Claude `mingla-orchestrator` for CLOSE (PR `Seth → main`, pre-merge gate, EAS OTA `production` channel `ios,android`).

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
