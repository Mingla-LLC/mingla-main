# IMPLEMENTATION — META-ORCH-1233 — Explorer First-Run Polish

Worktree: `mingla-orchs/META-ORCH-1233-[firstrun-polish]` · branch `META-ORCH-1233-firstrun-polish`
Rebased on `origin/main` @ `104d0a133` (META-ORCH-1232). Three discrete commits, one per item.
Spec: `Mingla_Artifacts/specs/SPEC_META-ORCH-1233_EXPLORER_FIRSTRUN_POLISH.md` (binding, followed exactly).

Branch commits (newest first):

| Item | Commit | Test |
| --- | --- | --- |
| 1 | `2aa2583acd9e` | `app-mobile/src/components/__tests__/meta-orch-1233-item1-valueprop-scroll-sync.test.tsx` |
| 2 | `cf45239c91ac` | `app-mobile/src/components/__tests__/meta-orch-1233-item2-friends-skip-continue.test.tsx` |
| 3 | `48c10f18daf0` | `app-mobile/src/components/__tests__/meta-orch-1233-item3-spotlight-geometry.test.tsx` |

---

## ITEM 1 — Value-prop slides now advance on Next / timer (one source of truth)

### Files + lines changed
`app-mobile/src/components/OnboardingFlow.tsx`
- After line ~1014 (with the other `useRef`s): added `const valuePropScrollRef = useRef<ScrollView>(null)`.
- After the auto-advance effect (~line 1278): added a sync `useEffect` that runs only on the
  `value_prop` subStep, recomputes `pageWidth = winWidth - 48`, and calls
  `valuePropScrollRef.current?.scrollTo({ x: valuePropBeat * pageWidth, animated: true })`.
  Deps: `[valuePropBeat, navState.subStep, winWidth]`.
- Value-prop `ScrollView` (~line 2674): added `ref={valuePropScrollRef}`.

### Diff intent
Establish ONE source of truth (`valuePropBeat`) for swipe, Next button, dots, and the 3s
auto-advance. The strip is now driven programmatically: whenever `valuePropBeat` changes the effect
scrolls the `pagingEnabled` strip to the exact page boundary `beat * pageWidth`. `ScrollView`/`useRef`
already imported (lines 16 / 1). `pageWidth` recomputed (NOT module-captured) so rotation / split-view
width changes stay aligned. Footer Next CTA (`setValuePropBeat(Math.min(valuePropBeat+1,2)); if
(valuePropBeat>=2) handleGoNext()`) and the 3s timer are UNCHANGED — the strip now reacts to the
`setValuePropBeat` they already call. `onMomentumScrollEnd` unchanged (swipe writes `idx`; the effect
re-issues a no-op `scrollTo` to the same `idx*pageWidth`). Dots left as pure indicators (no tap
affordance added — out of scope per spec §1.7). No jiggle guard added (spec: only if observed at
runtime; deferred to tester).

### Gate results
- TypeScript (`tsc --noEmit`): ran to completion; **0 errors in `OnboardingFlow.tsx`**. (832 pre-existing
  monorepo errors, all in unrelated packages e.g. `packages/phone-input` missing react types — a
  worktree node_modules artifact, not introduced by this change.)
- ESLint (touched files): no new errors from the changed lines (only the repo-standard
  `no-require-imports` warnings on the Node test file, matching the existing `NotificationsSheet.test.tsx`
  convention).
- Test: `node src/components/__tests__/meta-orch-1233-item1-valueprop-scroll-sync.test.tsx` →
  `PASS META-ORCH-1233 Item1 value-prop scroll-sync regression`.

### Fails-on-revert proof
Removed the `scrollTo` line (`valuePropScrollRef.current?.scrollTo({...})` → comment), re-ran the test:
**FAILED** — `AssertionError: Item1: sync effect must scrollTo x = valuePropBeat * (winWidth - 48),
guarded to value_prop` (exit 1). Restored the file (`git diff --quiet` clean) → test **PASSES** again.
Fails-on-revert anchor commit: `a35d5197c2e0` (the pre-amend commit that introduced the fix + test;
final amended commit `2aa2583acd9e`).

### Deviation from spec
None.

---

## ITEM 2 — Inner-circle footer: Skip (0 friends) vs Continue (≥1 friend)

### Files + lines changed
`app-mobile/src/components/OnboardingFlow.tsx`
- `getCtaConfig` `case 'friends_and_pairing'` (~line 2257): replaced the hardcoded
  `label: t('common:continue')` / `onPress: () => goNext()` block with the conditional block from the spec.

### Diff intent
`const hasFriend = data.addedFriends.length > 0`. Label = `hasFriend ? t('common:continue') :
t('common:skip')`. `onPress`: if `!hasFriend`, `setData(prev => ({...prev, skippedFriends:true}))`
(preserves the resume/analytics intent the now-dead child `onSkip` used to set) then `goNext()`; if
`hasFriend`, just `goNext()` (does NOT set `skippedFriends`). `disabled:false`, `hide:false`. Trigger is
a friend actually IN the list (`addedFriends` only appended by `onAddFriend`/accept-request) — not a
number merely typed. `getCtaConfig` already lists `data` in its `useCallback` deps; `setData` is a
stable setter — no dep-array change. `data.addedFriends` and `skippedFriends` are valid `OnboardingData`
fields (`src/types/onboarding.ts:111,113`).

### i18n
No additions. Verified `common:skip` and `common:continue` exist in **all 29** locales
(`src/i18n/locales/*/common.json`); English `skip = "Skip"`, `continue = "Continue"`. Test asserts the
presence across every locale.

### Gate results
- TypeScript: **0 errors in `OnboardingFlow.tsx`** (same full-run as Item 1).
- ESLint: no new errors from the changed lines.
- Test: `node src/components/__tests__/meta-orch-1233-item2-friends-skip-continue.test.tsx` →
  `PASS META-ORCH-1233 Item2 friends Skip/Continue regression`.

### Fails-on-revert proof
Reverted `label: hasFriend ? t('common:continue') : t('common:skip')` → `label: t('common:continue')`,
re-ran the test: **FAILED** — `AssertionError: Item2: label must be hasFriend ? common:continue :
common:skip`. Restored (clean) → **PASSES**. Fails-on-revert anchor commit: `d1bc659ff524` (final
amended commit `cf45239c91ac`).

### Deviation from spec
None.

---

## ITEM 3 — Discover Trips spotlight overhang (coordinate-space fix)

### Files + lines changed
`app-mobile/src/components/DiscoverScreen.tsx`
- Module scope (~line 112, by the other layout constants): added
  `const TABS_1016_ROW_PADDING_H = 4;` with a comment tying it to
  `styles.tabs1016Row.paddingHorizontal`.
- Geometry effect (~line 958): `const targetX = layout.x + cc.nav.spotlightInset;` →
  `const targetX = TABS_1016_ROW_PADDING_H + layout.x + cc.nav.spotlightInset;`.
- `targetWidth` (line 959): UNCHANGED. `spotlightInset` (0), spring params, glow tokens, colors:
  UNCHANGED. Constant is module-level → no effect dep-array change (preferred path per spec §3.3).

### Diff intent
The spotlight `Animated.View` is a sibling of `tabs1016Row`, so its `left` lives in the capsule
padding-box, but each tab's `onLayout` `x` is relative to `tabs1016Row`'s content box, offset by the
row's `paddingHorizontal:4`. The old `targetX = layout.x` placed the pill 4px too far left, overhanging
the neighbor gutter and clipping short of the active tab's right edge (reading as "Events still
partially selected" with Trips active). Adding `TABS_1016_ROW_PADDING_H` moves the origin into the same
coordinate space as `left`. The `spotlightInset` term is retained (currently 0) so the token still
applies if ever raised.

### Gate results
- TypeScript: ran to completion; **0 errors in `DiscoverScreen.tsx`**.
- ESLint (touched file): the changed lines introduce **0 new errors**. The 4 `react/no-unescaped-entities`
  errors reported by ESLint are at lines 471–503 (pre-existing, NOT in this diff — confirmed via
  `git diff origin/main`, which only touches the comment block, the constant, and the `targetX` line).
- Test: `node src/components/__tests__/meta-orch-1233-item3-spotlight-geometry.test.tsx` →
  `PASS META-ORCH-1233 Item3 spotlight geometry regression`. Includes the spec's computable happy-path
  (`{x:155,width:155}, inset:0 → targetX===159, targetWidth===155`) and the drift sentinel
  (`TABS_1016_ROW_PADDING_H === styles.tabs1016Row.paddingHorizontal`).

### Fails-on-revert proof
Reverted `targetX = TABS_1016_ROW_PADDING_H + layout.x + cc.nav.spotlightInset` →
`targetX = layout.x + cc.nav.spotlightInset`, re-ran the test: **FAILED** — `AssertionError: Item3:
targetX must be TABS_1016_ROW_PADDING_H + layout.x + cc.nav.spotlightInset`. Restored (clean) →
**PASSES**. Fails-on-revert anchor commit: `7eb6cd00a69b` (final amended commit `48c10f18daf0`).

### Runtime note (deferred)
Item 3 is deterministic box-model geometry. **Runtime confirmation on a real Discover screen is deferred
to the tester** — a native consumer build of Discover is not installed on any simulator and Discover is
gated behind auth + full onboarding; native runtime was unreachable in the spec/implementation window.
Tester must screenshot Trips-active and Events-active on iOS and Android (Android opaque-glass path
included) and confirm the orange pill's left edge aligns with the active tab's content left (within
~1px) with no tint/border/glow extending onto the neighbor.

### Deviation from spec
None.

---

## Cross-item summary
- Files changed: `app-mobile/src/components/OnboardingFlow.tsx` (items 1 & 2),
  `app-mobile/src/components/DiscoverScreen.tsx` (item 3) + 3 append-only test files.
- No DB / edge function / migration / i18n-key additions. No business / buyer-web / admin files touched.
- Three discrete commits, each carrying its code + its test + its own fails-on-revert anchor.
- Did NOT deploy, merge, or close. Working tree clean (spec file remains untracked — not in scope to commit).
