# IMPLEMENTATION — ORCH-1028 PART 2 [Onboarding responsive / visual polish]

**Skill:** mingla-implementor (Claude) · **Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1028-[onboarding-launch-city-gate]/` on branch `ORCH-1028-onboarding-launch-city-gate`
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`) only.
**Scope:** ORCH-1028 **Part 2** (responsive sweep §D, R-1..R-4). **Part 1 (launch-city gate) is OUT OF SCOPE this pass** — blocked on ORCH-1027 `check-launch-city` deploy. No Part-1 code written.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1028_ONBOARDING_LAUNCH_CITY_GATE.md` §D / §G SC-P2-*.

---

## Comms ledger (read on entry)

Scanned `COMMS_LEDGER.md`. No `BLOCK`+`OPEN` row targets ORCH-1028, `mingla-implementor`, or `ALL`. The three `ALL`+`WARN` rows are N/A for this pass: COMMS-0003 (external-API docs — no external API touched; gate call is Part 1), COMMS-0004 (INTAKE double-booking — not an INTAKE), COMMS-0002 (strict-grep C7 backend — no `supabase/functions/` or migration touched). No new cross-ORCH discovery this turn → no new ledger entry written.

---

## Files changed

| File | SHA-256 (post) | Change |
|------|----------------|--------|
| `app-mobile/src/components/OnboardingFlow.tsx` | `e10b8f64f7ededff054905198fe20c9c6e133756a8141db457173d4625b765ed` | R-1 scaling tokens + R-2 live `useWindowDimensions()` |
| `app-mobile/src/components/onboarding/OnboardingShell.tsx` | `e1562823cc4b91950267eb025242e0d1e16aa7e7386d2443933038359c1c2f60` | **UNCHANGED** — R-3 safe-area + R-4 keyboard audited and already correct (see below) |

`git diff --stat`: 1 file changed, 52 insertions(+), 20 deletions(-).

---

## Cross-surface impact (Step 3.5)

| Surface | Affected | Why / parity |
|---------|----------|--------------|
| Consumer iOS | YES | Onboarding screens scale on small (SE 3) / large (Pro Max). Files: `OnboardingFlow.tsx`. |
| Consumer Android | YES | Same shared RN code path → R-1/R-2 parity AUTOMATIC. R-3 edge-to-edge inset handling lives in `OnboardingShell` (unchanged, already correct). |
| Buyer/anon Web, Business iOS/Android, Admin, Business Web | NO | No consumer onboarding flow on those surfaces. |

Parity across iOS/Android is automatic (one RN code path). No manual-parity drift introduced.

---

## What was implemented (R-1..R-4)

### R-1 — Scaling tokens (LOCKED, §D.0)
Migrated the onboarding text that was hard-sized for the 390pt reference frame to the existing `responsiveTypography` / `ms()` helpers (`designSystem.ts:243-263`, `utils/responsive.ts`), so it shrinks gently on iPhone SE / small Android and grows on Pro Max. **Only the tokens the SPEC named as overflow-risk were touched** (no blanket replacement — avoids churn per §D.0):

- `locHeadline` — `...typography.xxxl` (fixed 32) → `...responsiveTypography.xxxl` (`ms(32)`). This is the gate host screen (location step), highest priority.
- `welcomeName` — raw `fontSize:40 / lineHeight:48` → `ms(40) / ms(48)` (already had `adjustsFontSizeToFit` as a second net).
- `nameGreeting` — raw `fontSize:28 / lineHeight:36` → `ms(28) / ms(36)`.
- `nameGreetingAccent` — raw `fontSize:36 / lineHeight:44` → `ms(36) / ms(44)` (the worst SE overflow risk in the name-collection stack).

### R-2 — Live `useWindowDimensions()` (LOCKED, §D.0 / §0.9)
Removed the module-load `const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')` capture (it never updated on rotation / Android fold / split-view). Added `const { width: winWidth, height: winHeight } = useWindowDimensions()` inside the component and repointed every layout-driving consumer:

- **value_prop carousel** — `ScrollView` page width + each beat page + the `onMomentumScrollEnd` index math now use `pageWidth = winWidth - 48`.
- **`valuePropCenter.minHeight`** — `SCREEN_HEIGHT * 0.55` (static) → inline `winHeight * 0.55` (live).
- **intents grid** — `INTENT_CARD_WIDTH` (module const) → `intentCardWidth(winWidth)` helper called live.
- **transport + travel_time selection tiles** — `selectionTile.width` (static `SCREEN_WIDTH` math in StyleSheet) → inline `selectionTileWidth = (winWidth - 48 - 8) / 2` applied at both call sites; the static width was removed from the StyleSheet entry.

The `Dimensions` import was removed (no longer used).

### R-3 — Safe-area / edge-to-edge (LOCKED, §D.0) — AUDITED, NO CHANGE NEEDED
`OnboardingShell.tsx` already: wraps `SafeAreaView edges={['top','left','right']}` (line 271); applies the bottom inset to the fixed CTA bar via `paddingBottom: Math.max(insets.bottom, spacing.md)` (line 304); applies `insets.bottom` to the `hideBottomBar` scroll padding (line 291). The progress bar sits inside the top safe-area. The two NEW gate screens (Part 1) render inside this shell and inherit safe-area for free. **Conclusion: top/left/right/bottom + Android gesture-nav clearance are already correct; no shell edit.** (Android edge-to-edge live screenshot below confirms system bars do not occlude content.)

### R-4 — Keyboard avoidance (LOCKED, §D.0) — AUDITED, NO CHANGE NEEDED
`OnboardingShell` wraps `KeyboardAwareView` with `bottomOffset` driven by `disableKeyboardAvoidance` and sets `keyboardShouldPersistTaps="handled"` (line 297) so list rows stay tappable with the keyboard up. `welcome` and `collaborations` opt out of keyboard avoidance intentionally (line 2882). The Part-1 picker filter input will inherit `keyboardShouldPersistTaps` automatically. **No shell edit required for Part 2.** (`welcome`-on-SE keyboard fit is a per-screen live-fire check — see coverage gap below.)

---

## Old → New receipts

### `app-mobile/src/components/OnboardingFlow.tsx`
**Before:** Module-scope `Dimensions.get('window')` captured once at load; `INTENT_CARD_WIDTH` a module const; value_prop/intents/selectionTile/valuePropCenter all read the stale module width/height; `locHeadline` used fixed `typography.xxxl` (32); `welcomeName`/`nameGreeting`/`nameGreetingAccent` used raw fixed font sizes (40/28/36).
**Now:** Live `useWindowDimensions()` drives every layout width/height in `renderContent`; the four flagged text styles use `ms()`/`responsiveTypography` so they scale on SE/small-Android and Pro Max; `locContainer` switched `flex:1`→`flexGrow:1` so the location stack centers when it fits and the shell ScrollView scrolls (rather than clips) when scaled content still exceeds the SE viewport.
**Why:** SPEC §D R-1 (scaling), R-2 (live dimensions §0.9), and the §D.1 `location`-row "highest priority" note.
**Lines changed:** ~52 insertions / ~20 deletions.

---

## Per-substep audit (§D.1)

| Substep | SPEC fix class | Action taken | Live-fire verdict |
|---------|----------------|--------------|-------------------|
| `language` | constraint | none needed (scroll list already in shell ScrollView) | pending tester F.3 |
| `welcome` | **R-1 + R-4** | R-1 applied (`welcomeName`/`nameGreeting`/`nameGreetingAccent` → `ms()`); R-4 already handled by shell | pending tester F.3 (keyboard-on-SE) |
| `phone` | constraint + R-1 | none needed (PhoneInput + consent inside shell scroll) | pending tester F.3 |
| `otp` | R-2 + R-4 | OTPInput box width is component-internal; shell keyboard OK | pending tester F.3 |
| `gender_identity` | constraint | `scrollEnabled=false` in shell; 8 options — confirm fit | pending tester F.3 |
| `details` | per-platform | native DateTimePicker — no responsive code change | pending tester F.3 |
| `value_prop` | **R-2 + R-1** | R-2 applied (live page width + live `minHeight`) | pending tester F.3 |
| `intents` | **R-2** | R-2 applied (`intentCardWidth(winWidth)`) | pending tester F.3 |
| **`location`** | **R-1 + scroll** | R-1 (`locHeadline`→responsive) + `locContainer` flex→flexGrow (scroll-safe) | pending tester F.3 (host screen, highest priority) |
| `celebration` | constraint | none needed | pending tester F.3 |
| `categories` | R-2 + measure | grid tile **height** is `onLayout`-measured (already responsive); no static width on the category grid (the §D.1 "line 3266" ref is actually `selectionTile`, fixed under R-2) | pending tester F.3 |
| `transport` | constraint | **R-2** applied to selection tiles (live width) | pending tester F.3 |
| `travel_time` | R-4 | **R-2** applied to selection tiles; keyboard via shell | pending tester F.3 |
| `friends_and_pairing` | constraint | none needed | pending tester F.3 |
| `collaborations` | R-4 | shell `disableKeyboardAvoidance` intentional | pending tester F.3 |
| `consent` | constraint | none needed | pending tester F.3 |
| `getting_experiences` | R-1 (review) | **REVIEWED — no change:** uses `typography.xxl` (24pt) headline + 96px icon, fully centered; at 24pt this fits SE 667pt comfortably. No overflow risk. | pending tester F.3 |

### §D.2 designer-escalation flag
None of the borderline screens (`welcome`, `value_prop`, `intents`, `categories`, `location` non-gate) required escalation to `mingla-designer` — all were resolved by R-1/R-2 constraint scaling alone. No screen still overflows after scaling (subject to tester F.3 confirmation). The two NEW gate screens that DO need a designer pass are Part-1 scope (not this pass).

---

## Verification

### tsc (clause 3)
Ran `node_modules/.bin/tsc --noEmit -p tsconfig.json` from `app-mobile/`. **Zero errors in `OnboardingFlow.tsx`** (grep of the touched-file name against tsc output returned nothing). Pre-existing unrelated errors remain in other files (BoardDiscussion.tsx, ConnectionsPage.tsx, TripCard.tsx, payments tests, packages/brand-rendering, Deno-targeted `__tests__` under jest path) — none introduced or touched by this change. Logged under Discoveries.

### Runtime live-fire (what IS proven)
Metro could not bundle from the worktree (symlinked `node_modules` → anchor breaks the Metro resolver: `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry` — the known worktree hazard). Per the standing testing-handoff rule, the changed file was copied onto the **anchor checkout** (real `node_modules`), Metro run from the anchor, evidence captured, then **the anchor file was restored byte-for-byte** (`git diff --quiet` on the anchor = CLEAN; backup hash `ecc06dc7abba` restored exactly). No anchor pollution.

- **iPhone SE (3rd gen), 375×667pt** (sim `E07985BA…`): the changed bundle (`iOS Bundled … expo-router/entry.js (5041 modules)`) loaded and ran with **no crash / no red-box**. Screenshot: `…/se3_375pt_app-runs-changed-bundle.png`.
- **Large Android — Pixel 8 Pro, 1344×2992 @480dpi (~448dp), Android 15 / API 35 edge-to-edge** (emulator-5554): the changed bundle (`Android Bundled … (5051 modules)`) loaded and ran; status/nav bars render edge-to-edge without occluding content. Screenshot: `…/android_448dp_edge-to-edge_app-runs-changed-bundle.png`.

### Live-fire COVERAGE GAP (honest label — hands to tester F.3)
Both booted devices have **already-onboarded** users, so `OnboardingFlow` does not mount (`AppStateManager` gates on `has_completed_onboarding`). Signing out on the SE 3 reached the pre-`OnboardingFlow` auth/welcome screen (`…/se3_375pt_auth-welcome-pre-onboarding.png`), but the 16 onboarding substeps need an **authenticated-but-not-onboarded** account, reachable only via a fresh OTP/OAuth sim login (operator-gated; no test credential available to this session). Therefore **per-substep visual screenshots of the 16 onboarding screens are NOT captured this pass** and are explicitly assigned to the tester's F.3 device-matrix gate, which the SPEC already designates as a tester responsibility.

**What the tester needs to run F.3:** a non-onboarded test account (or a dev-build "reset onboarding" affordance / clear AsyncStorage `has_completed_onboarding`). Then render each substep on iPhone SE 3 (375pt) + large Android 15 edge-to-edge and confirm no clip/overflow/horizontal-scroll, CTAs reachable, ≥44pt targets, keyboard does not cover input/CTA on `welcome`/`phone`/`otp`/`travel_time`/`collaborations`.

### Verification matrix vs Part-2 success criteria
| SC | Status | Evidence |
|----|--------|----------|
| SC-P2-iOS (no clip/overflow on SE 3 + Pro Max) | **implemented, partially verified** | R-1/R-2 applied + changed bundle runs on SE 3; per-substep visual confirmation → tester F.3 |
| SC-P2-A (Android edge-to-edge insets honored) | **implemented, partially verified** | R-3 shell audit + changed bundle runs on 448dp Android 15 edge-to-edge (bars do not occlude) |
| SC-P2-KB (keyboard never covers input/CTA on SE) | **implemented, unverified** | shell `KeyboardAwareView` + `keyboardShouldPersistTaps` audited correct; on-screen confirmation → tester F.3 |

---

## Regression test (Step 0.5 / §F)

Part 2 is **constraint-level / visual-only** layout wiring (scaling tokens + live-dimension reads). The SPEC (SC-P2 / F.3) states responsive layout evidence is **device screenshots**, not a unit test, and the F.1/F.2 unit tests it defines are **Part-1** (the `useLaunchCityGate` hook + the override write) — out of scope this pass. There is no pure, headlessly-assertable behavior unit introduced by Part 2 that would fail-on-revert (the changes are RN layout-prop wiring exercised only by the renderer). **Per the implementor regression-gate exemption, Part-2 responsive-only work is covered by the §F.3 live-fire device gate (tester-owned), not a jest test.** This is stated here so CLOSE sees the deliberate routing rather than a skipped gate. The Part-1 implement (post-1027) ships F.1/F.2.

---

## Invariants

No ORCH-1028 invariant is in Part-2 scope (I-1028-* all concern the Part-1 gate logic). Part 2 introduced no new owner-of-truth, no DB write, no edge call. The existing `I-LOCATION-INVALIDATE-ON-LOCATION-ONLY` is untouched (no preferences write added).

---

## Part 1 confirmation — UNTOUCHED

No Part-1 artifact was created or modified: no `useLaunchCityGate.ts`, no `LaunchCityPicker.tsx`, no `check-launch-city` invoke, no reassurance/picker render block, no `custom_*` preferences write, no `onboarding.json` `launch_gate` copy. `git status` shows exactly one changed file (`OnboardingFlow.tsx`) and the new evidence/report artifacts. The location-step gate-insertion point (`captureLocation`) was not modified.

---

## Discoveries for orchestrator

1. **Worktree Metro is broken by the symlinked `node_modules`** (`node_modules -> /Users/sethogieva/Desktop/mingla-main/app-mobile/node_modules`): Metro's resolver emits `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry`. Workaround used: stage the changed file on the anchor, bundle there, restore. Worth fixing the spawn/worktree recipe so future UI ORCHs can live-fire from their own worktree.
2. **Onboarding live-fire needs a non-onboarded test account or a dev "reset onboarding" affordance.** Both standing sims are onboarded; there is no non-login path to the onboarding substeps. A seeded non-onboarded test login (or a dev-menu reset) would unblock the F.3 gate for this and every future onboarding ORCH.
3. **Pre-existing `tsc` errors** (not introduced here): `BoardDiscussion.tsx` (DirectMessage vs BoardMessage type drift), `ConnectionsPage.tsx` (GroupEventMeta.publicCard missing displayPriceCents/displayCurrency), `TripCard.tsx` (Icon `accessibilityLabel` prop not on IconProps), `LockedPlanBanner.tsx`/`LockedCardSchedulingSheet.tsx` (`JSX` namespace), `nativeCheckoutFlow.ts` (`applePay` not in PaymentSheetInitInput), jest/Deno `__tests__` resolving under the app tsconfig, and `packages/brand-rendering/PublicBrandPage.tsx` (`react` module + implicit-any). These predate this ORCH and should be triaged separately.

---

## Status

**implemented, partially verified.** R-1..R-4 applied/audited across the onboarding screens; tsc clean on the touched file; the changed bundle runs without crash on iPhone SE 3 (375pt) and large Android 15 edge-to-edge (448dp). Per-substep onboarding visual screenshots are deferred to the tester's F.3 gate (blocked on a non-onboarded test account). Part 1 untouched.
