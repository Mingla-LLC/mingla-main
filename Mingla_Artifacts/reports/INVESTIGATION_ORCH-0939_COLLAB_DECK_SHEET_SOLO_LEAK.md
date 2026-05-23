# INVESTIGATION ORCH-0939 — CollabDeckSheet renders solo deck instead of session deck

## Verdict

**Status:** Root cause **proven** with six-field evidence.
**Confidence:** `proven`. Live device evidence (screenshot of Lagos card under "Testing stuff" header) + DB inspection (zero matching cards in the session) + source-code trace (missing provider wrap) all triangulate the same root cause.
**Scope:** Investigation only. No product code changed. No SQL mutation. No live session mutation.

## Symptom

Inside the CollabDeckSheet for the "Testing stuff" session on the operator's dev build (signed in as Marcus, `c727d491-4884-4e72-b467-d6c124b9a8b9`), the user sees a curated card titled "Funtasticaland → Cilantro Ikeja" (both places in Ikeja, Lagos, Nigeria). The header correctly reads "Testing stuff" and the back chevron + settings gear chrome match the post-META-ORCH-0929 [collab decks in group chat] design.

But:
- The "Testing stuff" session's `session_deck_cards` table has zero rows containing any Lagos / Ikeja / Funtasticaland / Cilantro reference across all 44 frozen positions.
- The `session_curated_cache` table has zero rows for the session containing any Lagos / Ikeja / Funtasticaland / Cilantro reference.
- Across the entire database, zero `session_deck_cards` rows contain "Lagos" or "Ikeja" in their `curated_payload`.

The card shown on screen does not exist in this session's database state. It cannot have come from `discover-cards` for `session_id = daadd454-…`.

## Investigation manifest

| File | Why read | What found |
|---|---|---|
| `app-mobile/src/components/connections/CollabDeckSheet.tsx` | New CollabDeckSheet component shipped by META-ORCH-0929 | Renders `<SwipeableCards currentMode={sessionId} sessionIdOverride={sessionId} …/>` without wrapping it in a RecommendationsProvider |
| `app-mobile/src/components/SwipeableCards.tsx` lines 410–472 | How SwipeableCards consumes mode + sessionIdOverride vs context | Destructures `recommendations, availableRecommendations, deckUIState, loading, …` from `useRecommendations()` — context-driven data fetch, not prop-driven |
| `app-mobile/src/contexts/RecommendationsContext.tsx` lines 340–399 | How RecommendationsContext resolves currentMode | Handles UUID-as-currentMode via regex at line 349-351; `isCollaborationMode` becomes true when `currentMode !== "solo"` and `resolvedSessionId` exists |
| `app-mobile/app/index.tsx` lines 2286–2291 | Where the GLOBAL RecommendationsProvider is mounted | `currentMode="solo"` HARDCODED; refreshKey/persistedSessionId provided; no per-session variant |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 578–595 | Pre-META-ORCH-0929 chat-deck rendering for comparison | The OLD path wrapped `<SwipeableCards currentMode="collab" />` in `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` — provider mounted per-session |
| `app-mobile/src/components/MessageInterface.tsx` lines 2183–2186 | How CollabDeckSheet is opened post-META | `<CollabDeckSheet visible={showCollabDeckSheet} sessionId={sessionId} ... />` rendered directly inside MessageInterface, no provider wrap added |
| Live DB probes (Supabase Management API) | What's actually in the session's deck cards | All 44 frozen positions are Cary NC / Durham / DC / Raleigh places. Zero Lagos content anywhere in the session. |
| `preferences` table for `profile_id=c727d491-…` | Marcus's solo prefs | `use_gps_location=false, custom_location="Lagos, Nigeria", custom_lat=6.4551, custom_lng=3.3942, intents=["first-date"], categories=["play","upscale_fine_dining","movies","theatre"]` — exactly matches the Lagos card on screen |

## Five-layer cross-check

| Layer | Finding |
|---|---|
| Docs | `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` describes CollabDeckSheet as the chat-mounted collab deck. Does NOT specify the RecommendationsProvider wrap. **Doc-level gap.** |
| Schema | `collaboration_sessions`, `session_deck_cards`, `session_participants` schema unchanged. RLS unchanged. Aggregator unchanged. Schema is healthy. |
| Code | `CollabDeckSheet.tsx:111-130` renders SwipeableCards directly with no provider wrap. SwipeableCards' data comes from `useRecommendations()` (context). Global provider is solo. **Code-level root cause.** |
| Runtime | The operator's dev build screenshot shows a curated Lagos card matching Marcus's solo prefs (intents `["first-date"]`, categories `[play, upscale_fine_dining, movies, theatre]`, location Lagos). Card content cannot have come from session_deck_cards or session_curated_cache. |
| Data | Session DB state for daadd454: 44 frozen positions, all Cary/DC/Durham/Raleigh. Marcus's solo prefs in `preferences` table: Lagos + first-date + 4 categories matching the card on screen. Two layers disagree: Schema/Data say "session cards are NC/DC" but Runtime says "Lagos cards rendered." |

Contradictions concentrate at Code↔Runtime: the running app renders Lagos solo cards under a header claiming "Testing stuff." Schema/Data confirm those cards aren't in the session. Code confirms the rendering layer reads from the global solo context, not a per-session collab context.

## Findings

### 🔴 Root Cause — CollabDeckSheet missing RecommendationsProvider wrap

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/connections/CollabDeckSheet.tsx:111-130` |
| **Exact code** | `<View style={styles.deck}>` `  <SwipeableCards currentMode={sessionId} sessionIdOverride={sessionId} ... />` `</View>` — no `<RecommendationsProvider>` wrapping the SwipeableCards inside the Modal |
| **What it does** | SwipeableCards reads `recommendations`, `availableRecommendations`, `deckUIState`, `isExhausted`, `collabDeckDeadEndReason`, `loading`, and 20+ other fields from `useRecommendations()` at line 410-472 of SwipeableCards.tsx. With no provider wrapping CollabDeckSheet's contents, that hook traverses the React tree upward and finds the GLOBAL RecommendationsProvider in `app/index.tsx:2286-2291`, which is HARDCODED to `currentMode="solo"`. The data SwipeableCards renders is therefore Marcus's solo deck (Lagos prefs → Lagos cards) — regardless of what `sessionIdOverride` or `currentMode` props were passed to SwipeableCards. |
| **What it should do** | Wrap the SwipeableCards inside a per-session RecommendationsProvider with `currentMode={sessionId}`, mirroring the pre-META-ORCH-0929 pattern at `CollabSessionChatBanners.tsx:584`. The provider's collab mode (UUID-as-currentMode is detected at `RecommendationsContext.tsx:349-351` and resolved to the session) wins for its subtree. SwipeableCards then reads collab session cards from the in-context useDeckCards hook, displays them, dispatches realtime cache invalidations against the correct query key. |
| **Causal chain** | (1) META-ORCH-0929 [collab decks in group chat] deleted the chat banner stack that previously wrapped the deck in a per-session provider (`CollabSessionChatBanners.tsx:584` is no longer mounted by MessageInterface per the META impl report). (2) The new CollabDeckSheet component shipped without a replacement provider wrap. (3) The global RecommendationsProvider at `app/index.tsx:2286-2291` is the only provider in the tree, hardcoded to `currentMode="solo"`. (4) SwipeableCards inside CollabDeckSheet reads cards from this solo context. (5) On the dev build, Marcus's solo prefs (Lagos + first-date + play/movies categories) produce a Lagos-themed curated deck. (6) The user sees Lagos cards under "Testing stuff" header. |
| **Verification step** | Take SwipeableCards.tsx line 472 (`useRecommendations()`) and observe via React DevTools that the context value comes from the `app/index.tsx:2286` provider, not from any CollabDeckSheet-local provider. Probe the live React Query cache: the collab key `['deck-cards', 'collab', 'daadd454-…', N]` should be empty or stale, while the solo key `['deck-cards', 'solo', null, ...]` should be populated with Lagos cards — those are what's rendered. Independently: revert META-ORCH-0929's deletion of the chat banner stack, observe that the Lagos card disappears and Cary/DC session cards appear instead. |

### 🟠 Contributing Factor — ORCH-0931 [Realtime broadcast session_updated] cache invalidation lands in an unused query key

`useBoardSession.ts:331-341` (after the ORCH-0931 rework_2) calls `queryClient.invalidateQueries(['deck-cards', 'collab', sessionId])` when a `session_updated` broadcast arrives. The invalidation targets the COLLAB query key, which causes a fresh `discover-cards` fetch for that key. The fresh data lands correctly in React Query's cache. But because SwipeableCards in CollabDeckSheet reads from the SOLO context (per the root cause above), the cache update is never rendered. Broadcasts work as designed; the renderer just doesn't consume their output.

This is why prior QA reports saw `[ORCH-0923-DIAG] collab params changed, invalidating deck-cards` logs but no UI heal — the invalidation fired against an orphan query whose cache no UI was reading. ORCH-0931 is technically correct but invisible to users until ORCH-0939 closes.

### 🟡 Hidden Flaw — ORCH-0909 [positional shared deck] determinism contract silently violated for every collab session

Per the ORCH-0909 contract: "All participants see the same card at the same position." With ORCH-0939's root cause in effect, every participant sees their OWN solo deck under the collab UI. Ava sees her solo cards, Priya hers, Marcus his Lagos cards. The contract is silently broken for every collab session.

The Codex `tester-mingla` QA report `QA_ORCH-0931_POST_META_COLLAB_REALTIME_MATRIX.md` flagged this in Scenario 3 ("Same-GPS + same-prefs control case") as a FAIL — but classified it as an ORCH-0909 contract violation. The actual cause is ORCH-0939 (this investigation). Once this fix lands, the ORCH-0909 contract holds again automatically.

### 🟡 Hidden Flaw — Global solo provider's deck-cards query subscribes to its own realtime channel even when user is in collab session

The global `RecommendationsProvider currentMode="solo"` at `app/index.tsx:2286` mounts the solo deck path including its own data fetching and any solo-side realtime subscriptions. This continues to run even when the user is inside CollabDeckSheet — burning network bandwidth and battery on a solo deck the user can't see. Not visible as a defect today; will surface as a perf issue when battery monitoring tightens. Out of scope for ORCH-0939 fix; flag for future cleanup.

### 🔵 Observation — The "152 viewed" UI badge inside CollabDeckSheet is also Marcus's solo swipe history

The user observed "152 viewed cards" inside CollabDeckSheet. Marcus has 158 `swiped_left` rows in `board_user_swipe_states` for the Testing stuff session AND additional solo swipes counted via a different mechanism. The "152 viewed" count is almost certainly the solo context's dismissed/viewed total, not the collab session's. Once ORCH-0939 closes, this count will drop dramatically (to whatever this specific collab session has accumulated) — that's the bug correcting itself, not a regression.

### 🔵 Observation — META-ORCH-0929 SPEC + tests did not catch this regression

The META-ORCH-0929 SPEC at `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` specified the CollabDeckSheet component and `sessionIdOverride` flow, but did not require that the SwipeableCards inside CollabDeckSheet read from a per-session collab RecommendationsProvider. The implementor's 4 happy-path tests (`CollabDeckSheet.happy.test.tsx`) mock the realtime + deck-fetch layers, so they don't catch context-resolution bugs. The tester's QA passed META-ORCH-0929 with deferrals that exactly described this bug ("Sim A showed National Gallery of Art; Sim B showed Regal Crossroads - Cary at the top of the same session deck") — but it was classified as deck divergence rather than as a provider-wrap miss.

This is a SPEC + test-coverage gap. The chat-native sheet redesign META-ORCH (per `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`) MUST include a per-surface SC stating "the deck rendered inside CollabDeckSheet displays cards from `discover-cards` called with this session's sessionId, NOT from any other context." With test coverage that mocks the context provider chain explicitly.

## Blast radius

| Surface / file | Affected? |
|---|---|
| CollabDeckSheet on iOS (consumer) | **YES — primary** |
| CollabDeckSheet on Android (consumer) | **YES — shared RN code** |
| Solo deck (Home → Explore tab) | **NO** — uses global solo provider correctly |
| Chat messages, presence, RSVPs | **NO** — different channels, different surfaces |
| Match lock-in flow | Partially — matches save via SwipeableCards.onCardLike, but the card data being saved is solo, so saves likely land against wrong session_id. Tester must verify post-fix that lock-ins work correctly. |
| Saved-to-session cards sheet (Matches sub-tab inside chat) | Partially — depends on whether SavedToSessionCardsSheet reads from the same context. Likely needs same provider wrap. Out of scope for ORCH-0939; queue follow-up if needed. |
| ORCH-0931 [Realtime broadcast session_updated] | Indirectly affected — the fix is correct but invisible until ORCH-0939 closes. ORCH-0931 retest should be paused. |
| ORCH-0909 [Positional shared deck contract] | Silently violated for every collab session since META-ORCH-0929. Auto-heals when ORCH-0939 closes. |

## Invariant violations

- **I-PROPOSED-META-0929-COLLAB-DECK-IN-SHEET** (per the META-ORCH-0929 SPEC) — "Collab deck mounts inside CollabDeckSheet as a full-screen modal." Today the modal mounts but renders solo data. Invariant violated.
- **ORCH-0909 contract** — "Same card at same position for all participants." Violated for every collab session.
- **`PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 5** — backend untouched. ORCH-0939's fix is client-only, so this is preserved.

## Fix strategy

**Wrap the SwipeableCards inside CollabDeckSheet with a per-session RecommendationsProvider** — mirroring the pre-META-ORCH-0929 pattern at `CollabSessionChatBanners.tsx:584`. Three lines of code change in `CollabDeckSheet.tsx`. Provider mounts when the modal opens (visible=true), unmounts when the modal closes, key'd by sessionId so the provider rebuilds cleanly when the user switches sessions.

This is strictly a client-side change. No backend, no SPEC carve-out, no migration.

## Regression prevention

1. **New strict-grep CI gate** `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER`: scans `app-mobile/src/components/connections/CollabDeckSheet.tsx` to require that `<SwipeableCards` appears INSIDE a `<RecommendationsProvider currentMode={sessionId}` element. Catches future regressions where someone removes the wrap.
2. **New unit test** `CollabDeckSheet.providerWrap.test.tsx`: renders CollabDeckSheet and asserts the SwipeableCards' useContext call resolves to a provider with `currentMode === sessionId`, NOT `currentMode === "solo"`.
3. **Memory file** `feedback_collab_deck_must_wrap_with_provider.md`: documents the pattern for future implementors. The chat-native sheet redesign META-ORCH (post bug 3 close) MUST include this as a Contract.

## Discoveries for orchestrator

1. **The deck divergence flagged in QA_ORCH-0931** was ORCH-0939 all along. Not an ORCH-0909 contract violation per se — both clients were rendering the right same-card-at-same-position from each user's own solo deck. Update WORLD_MAP entry for ORCH-0931's prior QA to cross-reference ORCH-0939.
2. **META-ORCH-0929's CLOSE was premature.** It shipped a P0 functional regression (collab deck shows wrong data) that the QA classified as a P2 deferral. Recommend either reopening META-ORCH-0929 with a follow-up close-amendment OR documenting that ORCH-0939 IS the close-amendment.
3. **ORCH-0931's TESTER DISPATCH should be paused** until ORCH-0939 closes. The realtime broadcast fix lands in an unused query key today; no live-fire test can verify visible heal until the provider is fixed.
4. **The "left-swiped cards re-appear" bug (~3.7x re-serve rate)** the operator noticed earlier — that's likely cardCount from solo deck swipes, NOT collab. Once ORCH-0939 closes, the collab session's actual swipe count will be small (1-2 per position). This was a misclassified observation.
5. **The Marcus solo deck's Lagos cards keep getting served** because his solo `custom_location` is Lagos (likely set during prior testing). The chat-native sheet redesign should make solo↔collab pref isolation explicit so this can't happen again.

## Confidence

`proven` — DB inspection + source-code trace + live screenshot evidence all triangulate identically.

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. All ORCH-0931 [Realtime broadcast session_updated] diag scaffolding preserved; this fix layers on top, not under.
