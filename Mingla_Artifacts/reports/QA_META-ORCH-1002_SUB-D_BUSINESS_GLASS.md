# QA — META-ORCH-1002 Sub-D — Business app Android glass sweep (TESTER ADVERSARIAL, Step-0.5)

**Date:** 2026-05-29
**Skill:** mingla-tester (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-d-business-glass-sweep]/` on branch `META-ORCH-1002-sub-d-business-glass-sweep`
**Base for diff/fails-on-revert:** `origin/main` @ `c74498d66` · branch HEAD @ `1f07d786a`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-D_BUSINESS_GLASS.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_SUB-D_BUSINESS_GLASS.md`
**Scope under test:** 105 `mingla-business/` RN-mobile source files — 198 named style blocks gained `overflow:'hidden'` (202 raw added lines) + 3 Symptom-B stragglers (Toast inverted-guard, AiDisclosureModal, BlastCustomersCta) routed to opaque Android fallback.

---

## 0. Verdict

**CONDITIONAL PASS (source-level). On-device pixel proof DEFERRED to the orchestrator's build decision (dev-build drift, not a tester escape).**

- **P0:** 0 · **P1:** 0 · **P2:** 1 (F-1, iOS active-tab glow clipped) · **P3:** 0 · **P4:** 2
- The dominant change (198 clips + 3 stragglers) is source-correct, scope-clean, iOS-frozen for the stragglers, and provably non-flattening across **all** clipped blocks.
- One genuine iOS-render-not-frozen regression (F-1, P2) — the exact `BottomNav.spotlight` shadow-clip case the spec excluded, missed on two identical trip-intake tab pills. Below the P0/P1 bar that forces FAIL; must be fixed to fully satisfy SC-iOS-frozen.

**Why CONDITIONAL, not PASS:** SC-iOS-frozen is violated on two surfaces (F-1). Per the verdict gate, a UI/runtime change cannot reach PASS without `proven`-level on-device repro on every applicable platform; on-device is independently blocked by the dev-build drift the orchestrator is putting to the operator. Source verification is complete and clean except F-1.

---

## 1. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row targets `mingla-tester`, this META-ORCH-ID, or `ALL` requiring action. COMMS-0002 (backend strict-grep — N/A, no `supabase/functions` touch), COMMS-0003 (external-API docs — N/A, pure RN style/`Platform`), COMMS-0004 (INTAKE — N/A), COMMS-0011 (ORCH-0990 renumber — N/A). No new cross-ORCH discovery → no new ledger entry.

---

## 2. Adversarial test (different angle than the implementor happy-path)

**Path:** `mingla-business/src/components/__tests__/metaOrch1002SubDBusinessGlass.adversarial.test.ts` (NEW; not a rename of the happy-path).

**Angle separation:** the implementor happy-path (`metaOrch1002SubDBusinessGlass.test.ts`, 29 tests) proves the clip + stragglers were ADDED on a 17-surface hardcoded sample. This adversarial suite proves the sweep did not REGRESS anything it should have left alone, deriving ground truth from the live `git diff origin/main...HEAD` (all ~198 clipped blocks, not a sample):

| # | Angle | What it asserts | Result |
|---|---|---|---|
| A | **no-flatten (whole-sweep)** | every one of the 198 clipped blocks kept its EXACT `backgroundColor` from main — the sweep adds the clip, never converts a translucent glass fill to opaque. | GREEN (0 fills changed across 198 blocks) |
| B/C | **iOS-freeze + straggler-correctness** | Toast/AiDisclosure/Blast take the opaque ≥0.92 Android fallback ONLY behind `Platform.OS==='android'`; iOS keeps the real BlurView; no opaque branch leaked onto an unconditional / iOS-reachable / `!== 'ios'` path; Toast's inverted `!== 'web'` guard is gone. | GREEN |
| D | **overflow-child-safety (iOS shadow-clip)** | no clipped surface composes a shadow-bearing sibling style onto the SAME JSX element (on iOS `overflow:'hidden'` → masksToBounds → that element's drop shadow/glow is clipped — SC-iOS-frozen). Pinned to the known F-1 pair; FAILS the moment the offender set grows, shrinks, or moves. | GREEN (set == known F-1 pair) |

**Run output (final):**
```
Sub-D adversarial — diff harness sanity
  ✓ git diff harness resolved a non-trivial clipped-block set
Sub-D adversarial A — no clipped surface was flattened to opaque
  ✓ every block that gained overflow:'hidden' kept its main backgroundColor
Sub-D adversarial B/C — stragglers opaque on Android only, iOS frozen
  ✓ Toast: opaque-fallback branch is reachable, inverted guard is gone, iOS keeps blur
  ✓ AiDisclosureModal: Android opaque sheet is gated behind Platform.OS==='android', iOS keeps real BlurView
  ✓ BlastCustomersCta: Android L1 opaque, iOS/web keep BlurView, behind Platform guard
  ✓ no straggler opaque branch leaked onto an unconditional/iOS path
Sub-D adversarial D — overflow:'hidden' never clips an iOS shadow on a NEW element
  ✓ the composed-shadow-clip offender set has not grown beyond the known F-1 pair
Test Suites: 1 passed, 1 total · Tests: 7 passed, 7 total
```

**Fails-on-revert (teeth proven, captured):**
- Reverting `ui/Toast.tsx` to `origin/main` → angle B/C "Toast…" goes RED (the inverted `Platform.OS !== 'web'` guard returns and the assertion catches it). Restored → green.
- Flattening one clipped block (`ari/InputBar.tsx` `host` fill `glass.tint.profileBase` → opaque `#141113`) → angle A goes RED, reporting `from glass.tint.profileBase → to "#141113"`. Restored → green.
- Removing `overflow:'hidden'` from one known F-1 offender (`trip/TripCreatorStep6Intake.tsx`) → angle D goes RED (offender set shrank below the pinned pair), proving the same-commit-update force when F-1 is fixed. Restored → green.

**tsc/lint:** whole-project `npx tsc --noEmit` = **234 errors WITH the adversarial test present = the documented pre-existing baseline**; ZERO errors reference the adversarial test file (it compiles clean under `expo/tsconfig.base` → `esModuleInterop:true`, `target:ESNext`). The earlier isolated-`tsc` import errors were a false alarm from invoking `tsc` without the project tsconfig flags.

---

## 3. Overflow-child-safety findings (the dispatch's highest-value angle)

Static analysis of all 198 clipped style blocks for children/composed-styles positioned outside the rounded bounds (absolute + negative offset, negative margin, status dots, "+N" chips, avatars) that the clip would crop.

### Out-of-bounds FUNCTIONAL child crops (absolute+negative-offset / negative-margin descendants inside a clipped subtree): **NONE**

- 25 styles in the clipped files use `position:'absolute'` or a negative margin. For each, I matched the clipped JSX subtree and checked for the risky style as a descendant. Only `ari/InputBar.tsx` `host` (clipped) contains absolute children (`plusH`/`plusV`) — and those are **safe**: they are nested inside a `position:'relative'` 32×32 `suggestBtn`, centred, fully within `host`'s padding; the `host` clip cannot reach them. No badge/dot/+N-chip/negative-avatar is cropped by any clip. The single negative-margin style (`brand/BrandProfileView.tsx` `heroAvatarRow`) is not a descendant of any clipped block.

### iOS drop-shadow / glow clips on the SAME element (composed-sibling pattern): **2 — FINDING F-1 (P2)**

| File:line | Clipped style | Composed shadow sibling | Effect |
|---|---|---|---|
| `mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx:299` (style block `tab` @ L509; glow `tabActive` @ L522) | `tab` (gained `overflow:'hidden'` @ L514) | `tabActive` (`shadowColor:#eb7825`, `shadowRadius:14`, `shadowOpacity:0.35`) | iOS: `overflow:'hidden'` on the active pill sets masksToBounds=true → the orange active-tab glow draws outside the pill and is clipped away. SC-iOS-frozen violation. |
| `mingla-business/src/components/trip/TripCreatorStep6Intake.tsx:183` (style block `tab` @ L283; glow `tabActive` @ L296) | `tab` (gained `overflow:'hidden'` @ L288) | `tabActive` (same glow tokens) | Same — active intake-tab orange glow suppressed on iOS. |

Both `tab` and `tabActive` compose onto the **same** `<Pressable style={({pressed}) => [styles.tab, active && styles.tabActive, …]}>`. This is exactly the case the spec EXCLUDED for `BottomNav.spotlight` (§3.3 of the implementation report: "On iOS, `overflow:'hidden'` on a shadowed view clips the glow (`masksToBounds`). To preserve iOS exactly the clip was NOT applied"). The same rationale applies here but was not applied to these two pills. On main these `tab` blocks had no `overflow` and shipped the glow (Sub-1 S5 added the `tabActive` glow + Android-elevation-zero with the comment "iOS glow kept"); Sub-D's clip silently kills that iOS glow.

**Severity P2 (not P0/P1):** functionally benign — no interactive child cropped, no layout break; only a subtle active-state glow vanishes on iOS, on the dark canvas, on a niche published-trip edit-flow tab. Android is unaffected (elevation already zeroed; no native shadow). Web unaffected.

**Fix (mirrors BottomNav.spotlight exclusion):** drop `overflow:'hidden'` from the two `tab` style blocks (the dark-canvas inset-ring is negligible on a pill that is filled by `tabActive`/`glass.tint.profileBase` anyway), OR move the glow to a non-clipped wrapper. When fixed, clear the `KNOWN_SHADOW_CLIP_OFFENDERS` array in the adversarial test in the same commit (angle D will force this).

---

## 4. Other findings

- **F-2 (P4, praise):** the no-flatten contract is perfect — 0 of 198 clipped blocks changed `backgroundColor`. The "preserve the glass look" contract is held exactly; the sweep is genuinely clip-only.
- **F-3 (P4, note):** all 3 stragglers are correctly Android-gated (`=== 'android'`, never `!== 'ios'`), keep iOS real blur, and use the canonical opaque `rgba(20,22,26,0.92)` / `#1a1416` fallback ≥0.92. iOS-frozen for the straggler half is clean.

---

## 5. Desktop-web contract gates (re-run, no NEW failure)

Ran `npx jest desktopWebLayoutContracts wizardDesktopLayout BottomNavWebDesktopPolish --runInBand`:
- **11 passed / 1 failed (12 total).** The single failure is `desktopWebLayoutContracts.test.ts › "keeps Home desktop KPIs fixed…"` asserting `scrollEnabled={!isWideDesktop}` in `app/(tabs)/home.tsx`.
- **Confirmed PRE-EXISTING baseline, NOT Sub-D:** Sub-D does not touch `app/(tabs)/home.tsx` (`git diff origin/main...HEAD --name-only` excludes it); `origin/main:app/(tabs)/home.tsx` already lacks the asserted string (count 0), so the test fails identically on main. The wizard (4 assertions) + BottomNav desktop + all other composer/desktop contracts pass. No NEW desktop-web contract failure introduced by Sub-D.

---

## 6. Cross-surface / parity

| Surface | Result |
|---|---|
| Business iOS | Frozen for the straggler half (Platform-gated). **F-1: two trip-intake tab pills lose their active-glow on iOS** (P2). Otherwise the sweep clip is a no-op on iOS for the 196 shadow-free clipped surfaces. |
| Business Android | Target — 198 clips reach the rounded corner; 3 stragglers render opaque ≥0.92. On-device pixel proof deferred (dev-build drift). |
| Business / buyer Web | Unaffected — `*.web.tsx` untouched; web glass path is Sub-C. |
| Consumer iOS/Android, Admin Web | Unaffected — no `app-mobile`/`packages`/`mingla-admin` touch (diff confined to `mingla-business/src`). |

---

## 7. Source-level verdict (on-device deferred)

The mechanical sweep is source-correct and scope-clean: the no-flatten contract holds across **all 198** clipped blocks, no functional out-of-bounds child is cropped by any clip, and the 3 stragglers are iOS-frozen + opaque-on-Android. The one defect is **F-1 (P2)** — two trip-intake active-tab pills lose their iOS orange glow because the clip was applied to a shadow-composing element, the exact case the spec excluded for `BottomNav.spotlight`. It is below the release-blocking bar but must be fixed to fully satisfy SC-iOS-frozen, and the adversarial test pins it so a fix (or any new occurrence) is enforced.

**Source-level: CONDITIONAL PASS** — clean except F-1 (P2). On-device PASS is deferred to the orchestrator's dev-build decision; when the build is available, the Android leg must confirm the inset-ring is gone on a representative sample and the iOS leg must confirm F-1 is the only glow affected.
