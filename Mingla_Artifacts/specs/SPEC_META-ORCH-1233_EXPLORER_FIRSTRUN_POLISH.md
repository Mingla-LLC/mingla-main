# SPEC — META-ORCH-1233 — Explorer First-Run Polish

Status: BINDING. Implementor builds exactly this; no scope expansion, no redesign.
Surfaces: Consumer iOS + Consumer Android (`app-mobile/`). NOT business/buyer-web/admin.
Worktree: `mingla-orchs/META-ORCH-1233-[firstrun-polish]` (branch `META-ORCH-1233-firstrun-polish`).

Three independent UI fixes bundled in one PR. Each item is self-contained — implement, test, and
revert-prove each separately. All line anchors below are against `origin/main` after the rebase in
this worktree (verified live during forensics, 2026-06-26).

---

## ITEM 1 — Value-prop ("Know exactly where to go") slides don't advance on Next

### Proven root cause (evidence)
File: `app-mobile/src/components/OnboardingFlow.tsx`
- The 3-beat strip renders inside a horizontal `pagingEnabled` `ScrollView` at **line 2650-2672**.
  That `ScrollView` has **NO `ref`** — it is only ever moved by a physical swipe; its
  `onMomentumScrollEnd` (2656-2661) writes `valuePropBeat` from the settled offset.
- State `valuePropBeat` is declared at **line 895** (`useState(0)`).
- `valuePropBeat` drives ONLY: the dot indicator (`i === valuePropBeat`, **line 2675**) and the
  icon glow/lightning animation (`isLightning = valuePropBeat === 2`, **line 1174**). It does NOT
  scroll the strip.
- Footer Next CTA (`case 'value_prop'`, **line 2197**) does:
  `setValuePropBeat(Math.min(valuePropBeat + 1, 2)); if (valuePropBeat >= 2) handleGoNext()`.
  It never scrolls the ScrollView.
- Auto-advance timer (**line 1272-1277**) increments `valuePropBeat` every 3000ms and likewise
  never scrolls.
- `pageWidth = winWidth - 48` is computed inside the render at **line 2647** (live from
  `useWindowDimensions()`, line 698). The buggy `valuePropBeat` advances dots while the visible
  slide (headline/icon/sub) stays frozen on beat 0, then on the 3rd Next press it jumps subStep.
  Swipe is the only path that keeps strip + dots + state in sync.

### Change contract
Establish ONE source of truth so swipe, Next button, dot indicator, and the auto-advance timer all
agree. Drive the strip programmatically from `valuePropBeat`.

1. Add a ref near the other onboarding refs (top of the `OnboardingFlow` component body, with the
   existing `useRef`s):
   ```ts
   const valuePropScrollRef = useRef<ScrollView>(null)
   ```
   `ScrollView` is from `react-native` — confirm it is in the existing RN import block at the top
   of the file (it is already used for the value-prop strip; no new import needed beyond the type).

2. Attach the ref to the value-prop `ScrollView` at **line 2650**:
   ```tsx
   <ScrollView
     ref={valuePropScrollRef}
     horizontal
     pagingEnabled
     ...
   ```

3. Add ONE effect (place it adjacent to the auto-advance effect, after line 1277) that scrolls the
   strip whenever `valuePropBeat` changes WHILE on the value_prop subStep:
   ```ts
   // Keep the visible value-prop slide locked to valuePropBeat (button + timer + dot taps).
   useEffect(() => {
     if (navState.subStep !== 'value_prop') return
     const pageWidth = winWidth - 48
     valuePropScrollRef.current?.scrollTo({ x: valuePropBeat * pageWidth, animated: true })
   }, [valuePropBeat, navState.subStep, winWidth])
   ```
   `pageWidth` MUST be recomputed here as `winWidth - 48` (identical to the render at line 2647) so
   rotation / split-view width changes stay correct. Do NOT capture a module-scope width.

4. Footer Next CTA (**line 2197**) — keep the existing behavior contract exactly, only the visible
   strip now follows because of (3). No change to the onPress logic is required; the new effect
   reacts to the `setValuePropBeat` it already calls. Final beat (index 2) Next press STILL advances
   subStep via `handleGoNext()` exactly as today. Leave `disabled:false`, leave `hide:false`.

5. Auto-advance timer (**line 1272-1277**) — no change; the new effect reacts to its
   `setValuePropBeat`. Verify the strip animates on each 3s tick.

6. `onMomentumScrollEnd` (**line 2656-2661**) — no change. When the user swipes, it writes
   `valuePropBeat = idx`; the new effect will issue a `scrollTo` to the SAME `idx * pageWidth`
   (a no-op visually since the strip is already there). This is harmless and keeps one source of
   truth. (If `scrollTo` to the current position causes a perceptible jiggle in testing, guard the
   effect with a ref tracking the last-scrolled beat and early-return when equal — only add this if
   a jiggle is actually observed at runtime; do not add speculatively.)

7. Dot indicator (**line 2673-2677**): dots are currently NON-interactive `View`s. Per the prompt's
   "(+ dot tap if any)" — there is NO existing dot tap handler. Do NOT add tap interactivity in this
   ITEM (out of scope; would be a new affordance). Leave dots as pure indicators. They now stay
   correct automatically because they already read `valuePropBeat`.

### UI states
- Beat 0 (navigate-outline): strip at x=0, dot 0 active. Initial render.
- Beat 1 (people-outline): Next or 3s tick → strip animates to x=pageWidth, dot 1 active.
- Beat 2 (flash-outline, lightning glow): strip at x=2·pageWidth, dot 2 active, timer stops
  (guard `if (valuePropBeat >= 2) return` at line 1274 still holds).
- Beat 2 + Next: advances subStep (intents). No extra scroll.
- Swipe at any beat: momentum settles → state + dots + (no-op) scrollTo agree.

### i18n
None touched. (Headlines/subs use existing `onboarding:value_prop.beat{1,2,3}_*` keys.)

### Per-platform deltas
- iOS & Android: `scrollTo({ animated: true })` on a `pagingEnabled` horizontal ScrollView behaves
  identically. No platform branch.
- Android: confirm `pagingEnabled` snap still aligns after a programmatic `scrollTo` (it does; the
  scrollTo target is an exact page boundary `beat * pageWidth`).

### Regression-test contract
- Happy-path (implementor writes, unit/integration where feasible): tapping Next from beat 0
  advances `valuePropBeat` to 1 AND issues a `scrollTo({x: pageWidth})`; mock `valuePropScrollRef`
  and assert `scrollTo` was called with `x = (winWidth-48)` on first Next and `x = 2*(winWidth-48)`
  on second. Assert third Next (beat>=2) calls `handleGoNext` (subStep advance).
- Adversarial (tester): on a physical device, tap Next THREE times rapidly without swiping — strip,
  dots, headline/icon must move in lockstep each tap; the headline must visibly change to beat 2's
  copy BEFORE the subStep advances on the third tap. Then rotate device mid-strip (or trigger a
  width change) and confirm the strip re-aligns to the active beat (no half-page offset). Also let
  the 3s auto-advance run untouched and confirm the visible slide moves, not just the dots.

---

## ITEM 2 — Inner-circle footer button: Skip (no friend) vs Continue (≥1 friend)

### Proven root cause (evidence)
File: `app-mobile/src/components/OnboardingFlow.tsx`
- `getCtaConfig` `case 'friends_and_pairing'` (**line 2241-2248**) HARDCODES
  `label: t('common:continue')` and `onPress: () => goNext()`, `disabled:false`.
- `data.addedFriends` is PARENT state: `OnboardingFlow` passes `addedFriends={data.addedFriends}`
  into the child at **line 3347** and mutates it via `onAddFriend`/`onRemoveFriend`/accept-request
  (lines 3348-3396). The footer can read `data.addedFriends.length` directly — NO state lifting.
- The child `OnboardingFriendsAndPairingStep` DECLARES `onContinue`/`onSkip` props (child lines
  93-94, 109-110) but NEVER invokes them (0 call sites — verified). So the ONLY footer for this step
  is the shell CTA at line 2241. The child's `onSkip` wiring (which sets `skippedFriends:true`,
  parent line 3368-3371) is currently DEAD CODE reachable only through the shell footer.
- `skippedFriends` (type `app-mobile/src/types/onboarding.ts:113`, default
  `useOnboardingResume.ts:67`) is written only by that `onSkip` and is never read for branching —
  it is persisted resume/analytics state. It SHOULD be set when the user leaves with no friends, to
  preserve the existing intent now that the footer owns the action.
- Adjacent proven pattern: `case 'collaborations'` (**line 2249-2258**):
  `label: hasActed ? t('common:continue') : t('common:ill_do_this_later')`.

### i18n verification (done)
`common:skip` already exists in ALL 29 `app-mobile/src/i18n/locales/*/common.json` (verified: every
locale has exactly one `"skip"` key). English value = `"Skip"` (`en/common.json` line 7).
**No i18n additions required.** Exact key: **`common:skip`**. (`common:continue` = "Continue", line 2.)

### Change contract
Replace the hardcoded `case 'friends_and_pairing'` block (**line 2241-2248**) with:
```ts
case 'friends_and_pairing': {
  const hasFriend = data.addedFriends.length > 0
  return {
    label: hasFriend ? t('common:continue') : t('common:skip'),
    disabled: false,
    loading: false,
    onPress: () => {
      if (!hasFriend) {
        // Preserve the original skip intent (resume/analytics state) that the
        // now-dead child onSkip used to set.
        setData(prev => ({ ...prev, skippedFriends: true }))
      }
      goNext()
    },
    hide: false,
  }
}
```
- Trigger is "a friend is actually IN the list" (`data.addedFriends.length > 0`), NOT a valid phone
  number merely typed — `addedFriends` is only appended by `onAddFriend`/accept-request, satisfying
  this exactly.
- Both paths call `goNext()`. Never disabled. Never hidden.
- Add `'friends_and_pairing'`'s new dependency: `getCtaConfig` already lists `data` in its useCallback
  deps (**line 2267**), so `data.addedFriends` and `setData` are covered (`setData` is a stable
  state setter). No dep-array change needed beyond confirming `data` is present (it is).

### UI states
- 0 friends added: label "Skip"; press sets `skippedFriends:true` then advances.
- ≥1 friend added (typed+added, or accepted incoming request): label "Continue"; press advances
  (does NOT set `skippedFriends`).
- Friend added then removed back to 0: label reverts to "Skip" (reactive on `data.addedFriends.length`).

### Per-platform deltas
None. Pure label/handler logic; identical iOS/Android.

### Regression-test contract
- Happy-path (implementor): with `data.addedFriends = []`, `getCtaConfig()` for
  `friends_and_pairing` returns `label === t('common:skip')`; pressing it calls `setData` with
  `skippedFriends:true` and then `goNext`. With `data.addedFriends = [oneFriend]`, label
  `=== t('common:continue')` and press does NOT set `skippedFriends`.
- Adversarial (tester): on device, reach the inner-circle step → footer reads "Skip" with empty
  list → add a friend → footer flips to "Continue" live → remove the friend → flips back to "Skip".
  Accept an incoming friend request and confirm the footer flips to "Continue" (covers the
  accept-request append path at line 3389-3394). Tap "Skip" with no friends and confirm onboarding
  advances AND resume state records `skippedFriends:true` (check via resume reload).

---

## ITEM 3 — Discover "Trips" tab spotlight bleeds onto "Events" (PROVEN: candidate (d))

### Proven root cause — coordinate-space mismatch (candidate (d))
File: `app-mobile/src/components/DiscoverScreen.tsx`
Render tree (lines 2007-2055):
```
pillBar1016Absolute (paddingHorizontal = filterBar token)            <- styles line 2594
  └ pillBar1016Capsule (borderWidth:1, NO horizontal padding, overflow:hidden)  <- line 2601
      ├ Animated.View spotlight1016  (position:absolute, left = spotlight1016X)  <- line 2009-2015 / styles 2622
      └ tabs1016Row  (paddingHorizontal:4, paddingVertical:4, flexDirection:row) <- line 2016 / styles 2609
          ├ Pressable tab "events" (flex:1)  onLayout -> x,width                 <- line 2020-2050
          └ Pressable tab "trips"  (flex:1)  onLayout -> x,width
```
Geometry effect (lines 955-991):
```ts
const targetX = layout.x + cc.nav.spotlightInset;          // line 958
const targetWidth = layout.width - cc.nav.spotlightInset*2; // line 959
```
- `cc = glass.chrome` (line 934). `cc.nav.spotlightInset = 0` (`designSystem.ts` **line 686**) →
  inset is a no-op. Candidate (a) (inset overshoot) RULED OUT.
- The spotlight `Animated.View` is a **direct child of `pillBar1016Capsule`** and a **sibling of
  `tabs1016Row`** (lines 2009 vs 2016). Its `left` therefore lives in the **capsule padding-box**
  coordinate space (origin = inside the 1px capsule border).
- Each tab's `onLayout` reports `x` **relative to its parent `tabs1016Row`** (RN onLayout is
  parent-relative). `tabs1016Row` has `paddingHorizontal:4`, so the row's content box (where tab
  x=0 starts) is offset **+4px** from the row's own left edge, and the row sits flush inside the
  capsule padding box. Net: a tab's true left edge in capsule-space = `layout.x + 4`.
- The code sets `spotlight.left = layout.x` (with inset 0) — i.e. **4px too far LEFT**. With
  `width = layout.width` (full tab width, no inset), the pill is shifted left by 4px at full width,
  so it **overhangs the left-neighbor gutter and clips short of the active tab's right edge**. When
  Trips is active, the pill's left border + orange glow read over the Events side → "Events still
  looks partially selected." Candidate **(d)** PROVEN.
- Candidate (b) glow halo: `shadowRadius = glowRadius = 14` (designSystem 580), small and symmetric;
  it is NOT the primary read — the primary read is the 4px positional overhang of the solid
  tint+border. (b) is secondary, fixed automatically by (d).
- Candidate (c) inactive label/icon contrast: inactive label `rgba(255,255,255,0.55)` vs active
  white/600 (designSystem 586/591) — well separated; NOT the cause.
- Candidate (e) spring overshoot: spring (damping 18 / stiffness 260 / mass 0.9, lines 699-701) can
  transiently straddle during the slide, but the SETTLED state is wrong too, which only (d) explains.
  (d) is the steady-state cause; fixing (d) also removes the misleading settled overhang.

### Runtime evidence
A native consumer build of Discover does not exist on any simulator (only `minglabusiness.app` is
installed) and Discover is gated behind auth + full onboarding with no running Metro — a from-scratch
consumer build + auth + onboarding to reach Discover was not feasible in this forensic window
(analogous to the documented "authed runtime unreachable — cap claims" reality). The cause here is
**deterministic box-model geometry, not a perceptual judgment**, so it is proven by exact layout math
plus a faithful 1:1 box-model reproduction (same capsule border, row padding, tab flex, spotlight
absolute positioning, and the same orange tint/border/glow tokens):
- `Mingla_Artifacts/evidence/META-ORCH-1233/item3_boxmodel_repro.png` — TOP (current/buggy): with
  Trips active, the orange pill's left edge + border/glow sit in the gutter encroaching toward
  Events and the pill clips short of Trips' right edge. BOTTOM (fixed: `left += 4`): pill centers
  cleanly under Trips, no Events bleed.
- `Mingla_Artifacts/evidence/META-ORCH-1233/item3_boxmodel_repro.html` — the source (exact box model
  + token values, annotated with the px math).

Verdict on runtime: source+geometry proof is conclusive; runtime is capped at "reproduced via
faithful box-model render." **Tester MUST confirm on a real Discover screen post-implementation**
(see regression contract).

### Change contract
The spotlight must be positioned in the SAME coordinate space its `left` is applied in. Add the
`tabs1016Row` horizontal padding to `targetX`. Use a named constant so it can't drift from the style.

1. Introduce a single source for the row inset. At module scope near the other layout constants (or
   inline as a named const above the effect), define:
   ```ts
   const TABS_1016_ROW_PADDING_H = 4 // MUST equal styles.tabs1016Row.paddingHorizontal
   ```
   Then set `styles.tabs1016Row.paddingHorizontal` to reference it is NOT required, but the constant
   MUST carry the comment tying it to the style so a future edit keeps them in lockstep.

2. In the geometry effect (**line 958**), change:
   ```ts
   const targetX = layout.x + cc.nav.spotlightInset;
   ```
   to:
   ```ts
   const targetX = TABS_1016_ROW_PADDING_H + layout.x + cc.nav.spotlightInset;
   ```
   (`spotlightInset` stays at 0; keep the term so the inset token still applies if ever raised.)
   `targetWidth` (line 959) is UNCHANGED — width is already correct (full tab width minus 2·inset);
   only the origin was wrong.

3. Add `TABS_1016_ROW_PADDING_H` to the effect dependency array (**line 981-991**) if it is a
   non-constant; if it is a module-level `const`, no dep change is needed (preferred — define it at
   module scope so it is dependency-free).

DO NOT change `spotlightInset`, the spring params, the glow tokens, or any color — none are the
cause. DO NOT add horizontal padding to the capsule or remove it from the row — the row padding is
the intended inner gutter; the fix is to account for it, not delete it.

### UI states
- Events active: `targetX = 4 + events.x(0) + 0 = 4`; width = events.width. Pill sits exactly over
  Events with the 4px gutter respected on the left. (Currently `targetX = 0` → pill kisses the
  capsule border, looked acceptable only because Events is the left tab.)
- Trips active: `targetX = 4 + trips.x + 0`; pill centers under Trips, no Events overhang. (THE FIX.)
- Toggle Events↔Trips: spring slides between the two corrected positions; settled state is exact.
- reduceMotion on: `setValue(targetX/targetWidth)` path (lines 960-963) uses the same corrected
  `targetX` — instant, correct.

### Per-platform deltas
- iOS & Android identical math. Android note: `glass` may use the opaque fallback
  (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`, imported line 75) — the spotlight tint/border/glow render
  the same absolute geometry regardless, so the 4px correction is platform-agnostic. No branch.

### Regression-test contract
- Happy-path (implementor): a focused unit test on the targetX math — given a tab layout
  `{x: 155, width: 155}` and `spotlightInset:0`, assert the computed `targetX === 159`
  (`4 + 155 + 0`), proving the row-padding term is applied. Add a guard test that fails if
  `TABS_1016_ROW_PADDING_H !== styles.tabs1016Row.paddingHorizontal` (drift sentinel).
- Adversarial (tester — RUNTIME REQUIRED, the cap-lift gate for item 3): on a real consumer build,
  reach Discover, screenshot with Trips selected and with Events selected. Overlay/measure: the
  orange pill's left edge must align with the active tab's content left edge (within ~1px), and NO
  orange tint/border/glow may extend past the active tab onto the neighbor. Capture both screenshots
  into `Mingla_Artifacts/evidence/META-ORCH-1233/` (e.g. `item3_runtime_trips_active.png`,
  `item3_runtime_events_active.png`). Also toggle rapidly and confirm no settled straddle. Capture
  on BOTH iOS and Android (Android opaque-glass path included).

---

## Cross-item notes
- Three items are independent — implement as three discrete commits within the single PR, each with
  its own fail-on-revert proof.
- No DB, no edge function, no migration, no i18n key additions (Item 2 verified `common:skip`
  pre-exists in all 29 locales).
- No business / buyer-web / admin files are touched.
- Files changed: `app-mobile/src/components/OnboardingFlow.tsx` (items 1 & 2),
  `app-mobile/src/components/DiscoverScreen.tsx` (item 3). Item 3 may also reference (not edit)
  `app-mobile/src/constants/designSystem.ts` for the token sanity check.
