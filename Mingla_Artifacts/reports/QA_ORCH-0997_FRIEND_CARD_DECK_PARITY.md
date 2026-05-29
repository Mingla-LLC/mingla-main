# QA — ORCH-0997 [Friend-page cards render + open like the swipeable deck]

**Mode:** TARGETED (spec-compliance + live-fire). **Verdict: CONDITIONAL PASS.**
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0997-[friend-card-deck-parity]/` on branch `ORCH-0997-friend-card-deck-parity` (off `origin/main` `aacf080bd`).
**Inputs:** SPEC, DESIGN, INVESTIGATION, IMPLEMENTATION reports (all in this worktree).

## Severity counts
P0: 0 · P1: 0 · P2: 1 · P3: 2 · P4: 1

## Verdict gate
- **Android = `proven`** (real device `R58R54YV7JT`): I independently re-applied the worktree fix to the anchor, reloaded, and verified myself.
- **iOS = `probable`** (attempted; BLOCKED by a named build issue — the iOS sim dev build predates `expo-video` and red-boxes `Cannot find native module 'ExpoVideo'` at app load, COMMS-0007; this is a global load crash from a different ORCH's dependency, not this change). The fix is shared RN code (expo-image / expo-linear-gradient / GlassBadge / Animated — all already run on iOS in the shipped app), so iOS parity is structural; Android is proven. iOS live-fire is deferred to Seth's pending fresh native build (which includes expo-video).
- Therefore the maximum honest verdict is **CONDITIONAL PASS**, deferral = the iOS live-fire leg. Requires Seth's explicit acceptance.

## Spec criteria
| SC | Result | Evidence |
|----|--------|----------|
| SC-1 hero photo (not grey box) | PASS (Android proven; iOS probable) | Implementor before/after on this device (`/tmp/o997_o2.png` grey → `/tmp/o997_open_fixed.png` hero); my unit T-01; corroborated by SC-4 stop photos rendering via the same image mapping. |
| SC-2 no-image honesty | PASS | Unit T-02 + adversarial A-07: `imageUrl` null/'' → `image:''`, `images:[]`, no throw. |
| SC-3 location populates | PASS (Android proven) | Device: detail showed distance (5523.6 mi — correct, Lagos place from Raleigh) + Weather/Traffic/Busy, all location-derived (dead before). Unit T-01 `location:{lat,lng}`. |
| SC-4 curated opens multi-stop | PASS (Android proven — verified by me) | I tapped the curated tile → full multi-stop layout: "Yenwa Art Gallery → Nest Lagos", START HERE ① (stop photo 1/5, 4.9, hours), ↓3 min, END WITH ②. `/tmp/qa_curated.png`. Unit T-03a + adversarial A-01/A-02/A-04/A-05. |
| SC-5 tile shape (deck language) | PASS (Android proven — verified by me) | Device: portrait hero tiles, GlassBadge chips, unified single/curated frame, curated accent hairline. `/tmp/qa_tiles2.png`. |
| SC-6 no regression | PASS | Birthday hero, Your Special Days empty state, vibe pills, Upcoming Holidays, tab bar all unchanged on device. |
| SC-7 type guard | PASS | Mapper returns `ExpandedCardData`; fails-on-revert proven (impl report @ `aacf080bd`); my tsc run shows touched files clean. |

## Independent tests
- **Tester adversarial:** `app-mobile/src/components/utils/__tests__/holidayCardToExpandedCardData.adversarial.test.ts` — 7 tests, **PASS**. Different angle than the implementor's happy-path: malformed `stopsData` (null / non-array / empty / garbage-elements), invalid price-tier enum, partial coords, empty-string image. `npx jest src/components/utils/__tests__/` → `Test Suites: 2 passed, Tests: 10 passed`.
- **Implementor happy-path:** `holidayCardToExpandedCardData.test.ts` — 3 tests, green, fails-on-revert verified by implementor @ `aacf080bd` (re-confirmed present).
- **Both ship in the PR:** both files exist in the worktree as new files; they will appear in `git diff origin/main...HEAD --name-only` once the CLOSE commit lands. (Not yet committed — verify at CLOSE.)

## Gates
- `tsc --noEmit`: the 3 touched production files + both test files = **zero new errors** (test files use `// @ts-nocheck` per the app-mobile convention — friendMenu/NotificationsSheet). The package's 270 pre-existing errors are unrelated to this ORCH.
- Lint: not separately run (no lint script wired for app-mobile components beyond tsc; touched code follows the local StyleSheet/import conventions).

## Constitution (touched)
- #2 one-owner-per-truth: mapper is the single `ExpandedCardData` producer — PASS.
- #8 subtract-before-add: old CompactCard layout/styles removed — PASS.
- #9 no fabrication: adversarial A-03/A-07 prove invalid tier → undefined, no-image → empty; branded fallback not a fake photo — PASS.
- #10 currency-aware: the mapper formats price via `formatTierLabel(tier, currencySymbol, currencyRate)` — PASS for the mapper. **Caveat → P2 below:** the modal MOUNT (`ViewFriendProfileScreen.tsx:817`) hard-codes `currency:'USD', measurementSystem:'Imperial'` — pre-existing, not introduced by this ORCH.
- Others N/A.

## Findings
- **P2-01 [pre-existing, out-of-scope] hard-coded locale at the friend-page modal mount.** `ViewFriendProfileScreen.tsx:817` passes `{ currency:'USD', measurementSystem:'Imperial' }`, so the expanded detail shows USD + miles regardless of the user's locale (visible as "5523.6 mi"). This predates ORCH-0997 (the old code passed the same hard-coded prefs) and the scoped fix neither introduces nor regresses it. NOT a blocker for this ORCH. Fix: wire the real `useLocalePreferences` into the modal mount (likely affects other modal mounts too). → register follow-up ORCH (implementor D-A).
- **P3-01 curated price display oddity.** The curated detail header showed "$20,000.00–$0.00" (totalPriceMax appears 0/missing). The mapper passes `totalPriceMin/Max` through faithfully; the deck renders the same source identically, so this is pre-existing source-data/curated-price-formatting, not a regression from ORCH-0997. → flag for the curated-price owner.
- **P3-02 a11y chip descendants.** The tile sets `importantForAccessibility="no-hide-descendants"` + `accessibilityElementsHidden` on the chip row, but the uiautomator dump still lists each chip's `content-desc`. Likely fine for TalkBack focus order (dump ≠ AT tree); tester recommends a TalkBack/VoiceOver pass to confirm ONE label per tile. Non-blocking. (implementor D-B)
- **P4-01 praise.** Clean root-cause fix: the typed `holidayCardToExpandedCardData` mapper makes the field-name drift a compile error (kills the RC#2 bug class), and the tile reshape correctly reuses the deck's `GlassBadge` rather than reinventing a chip. Honest empties throughout (no fabrication).

## Discoveries for orchestrator
- D-A (P2-01): hard-coded USD/Imperial at friend-page modal mount → follow-up ORCH.
- D-B (P3-02): TalkBack/VoiceOver one-label-per-tile confirmation.
- D-C: three recommendation-card renderers still exist (deck inline / this tile / PersonGridCard) → future consolidation ORCH (the rejected Option A).
- D-D (P3-01): curated price "$X–$0.00" display oddity (pre-existing).

## What Seth must accept for CONDITIONAL PASS → CLOSE
1. iOS live-fire deferred to the pending fresh native build (iOS sim can't load the app due to the pre-existing `expo-video` build gap; fix is shared RN code + Android proven).
2. P2-01 locale deferred to a follow-up ORCH (pre-existing, out of scope).
