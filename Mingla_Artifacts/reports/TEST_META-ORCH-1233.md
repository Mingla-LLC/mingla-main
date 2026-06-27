# TEST — META-ORCH-1233 — Explorer First-Run Polish

Worktree: `mingla-orchs/META-ORCH-1233-[firstrun-polish]` · branch `META-ORCH-1233-firstrun-polish`
Gatekeeper posture: assumed BROKEN until independently proven. Source-only conclusions capped at
"suspected"; only runtime/live-fire lifts the cap.

Fix commits under test: item1 `2aa2583acd9e`, item2 `cf45239c91ac`, item3 `48c10f18daf0`.
Tester adversarial-suite commit: **`62851d96cea0`** (append-only; source files untouched).

## Overall verdict: CONDITIONAL PASS
Items 1 and 2: **PASS**. Item 3: **CONDITIONAL PASS** (box-model/geometry proof conclusive; live
consumer-Discover runtime genuinely unreachable in this window — confirmation condition below).

| Item | Verdict | Basis |
| --- | --- | --- |
| 1 — value-prop strip follows valuePropBeat | PASS | code read + runtime-model adversarial suite + fail-on-revert + tsc clean |
| 2 — inner-circle Skip/Continue footer | PASS | code read + state-transition adversarial suite + fail-on-revert + 29-locale i18n + tsc clean |
| 3 — Discover spotlight no-bleed | CONDITIONAL PASS | exact box-model geometry independently re-derived + both-tab no-bleed adversarial test + fail-on-revert + tsc clean; native runtime unreachable |

---

## Gate results (all items)
- **Implementor's 3 suites**: re-run green (PASS each).
- **Tester's 3 adversarial suites**: green (PASS each), DIFFERENT angle per item (see below).
- **tsc --noEmit (app-mobile)**: ran to completion. **0 errors in the two touched files**
  (`OnboardingFlow.tsx`, `DiscoverScreen.tsx`). 832 total errors are all pre-existing monorepo noise
  (`packages/phone-input` missing react types; Deno `__tests__` files importing `deno.land`) — none in
  the touched files, none introduced by this change (verified by filtering tsc output).
- **Fail-on-revert**: proven for ALL three items against BOTH the implementor's test and the tester's
  adversarial test (each reverted in place, both tests went red exit 1, restored, both green exit 0).

---

## ITEM 1 — value-prop strip follows valuePropBeat — PASS

### Independent code read (live code, not the diff)
- `valuePropScrollRef = useRef<ScrollView>(null)` declared (OnboardingFlow.tsx ~1015); attached to the
  value-prop `ScrollView` (~2677). Sync effect (~1288-1292): guarded `if (navState.subStep !==
  'value_prop') return`, recomputes `pageWidth = winWidth - 48`, `scrollTo({ x: valuePropBeat *
  pageWidth, animated: true })`, deps `[valuePropBeat, navState.subStep, winWidth]`.
- The render's `pageWidth` (line 2673), the ScrollView `style={{ width: pageWidth }}` and each page
  width all use the identical `winWidth - 48` → effect target lands on an exact page boundary (Android
  paging snap stays aligned). Confirmed.
- Next CTA (line 2212) and the 3s timer (1276-1281) are UNCHANGED — the strip now reacts to the
  `setValuePropBeat` they already call. `getCtaConfig` deps include `valuePropBeat` (line 2293) so the
  CTA closure is fresh each render.

### Adversarial suite (DIFFERENT angle = runtime behavioral model, not source-grep)
`app-mobile/src/components/__tests__/meta-orch-1233-item1-valueprop-scroll-sync.adversarial.test.tsx`
Executes a faithful reducer model of the strip (Next closure-capture, guarded 3s timer, swipe-settle,
sync effect) and asserts the strip-offset/dots/state invariant across edge sequences:
- **swipe-then-Next** does NOT desync (swipe to 1 → Next → beat 2, offset locked, no premature goNext).
- **final-beat clamp**: third Next keeps beat at 2 (no over-scroll past `2*pageWidth`) and fires
  `goNext` exactly once.
- **rapid triple-tap**: deterministic 0→1→2→advance, no skipped beat, no double-goNext.
- **rotation/width change** mid-strip re-aligns to `beat*newPageWidth` (no half-page offset).
- **3s timer** moves the visible offset (not just dots) and stops at beat 2.
- **single-source invariant**: exactly ONE *live* (comment-stripped) `valuePropScrollRef.scrollTo`
  driver, scrolling to the state-derived `valuePropBeat * pageWidth`, guarded to `value_prop`.

### Fail-on-revert
Reverted the `scrollTo` line by comment (the documented revert path). Implementor test → FAIL
(exit 1). Adversarial test → FAIL `exactly ONE LIVE valuePropScrollRef scrollTo driver expected,
found 0` (exit 1). Restored → both PASS (exit 0).

### Note (pre-existing, NOT a regression)
The Next CTA uses `setValuePropBeat(Math.min(valuePropBeat + 1, 2))` with the closure-captured beat
(not a functional updater). This is the spec-mandated UNCHANGED code; in RN each tap is a discrete
event with a re-render between, so the closure is fresh and the modeled triple-tap is deterministic.
Flagged for awareness only.

---

## ITEM 2 — inner-circle Skip/Continue footer — PASS

### Independent code read
- `case 'friends_and_pairing'` (lines 2256-2274): `hasFriend = data.addedFriends.length > 0`;
  `label = hasFriend ? t('common:continue') : t('common:skip')`; `disabled:false`, `hide:false`;
  `onPress` sets `skippedFriends:true` only on the `!hasFriend` path, then `goNext()` on both paths.
- Mutators traced: `onAddFriend` appends (~3375), `onRemoveFriend` filters by `phoneE164` (~3381),
  accept-request appends with userId dedup (~3405-3420). So add→remove returns length to 0 → reverts
  to "Skip"; reactive because `getCtaConfig` lists `data` in deps.
- `skippedFriends` is a real `OnboardingData` field (`types/onboarding.ts:113`, default false
  `useOnboardingResume.ts:67`).

### i18n verified live
29 locales present; `common:skip` and `common:continue` are real strings in every one. Spot-checked
non-English resolutions: es=Omitir, fr=Passer, ar=تخطي, ja=スキップ, zh=跳过, hi=छोड़ें, pt=Pular,
de=Überspringen — no raw-key passthrough.

### Adversarial suite (DIFFERENT angle = wired state-transition model + real i18n resolution)
`app-mobile/src/components/__tests__/meta-orch-1233-item2-friends-skip-continue.adversarial.test.tsx`
Drives the real mutators against a model of the shipped CTA branch with a translator backed by real
`en/common.json` (throws on a missing key): empty→Skip; add→Continue (Continue must NOT set
skippedFriends); add→remove→reverts to Skip; accept-request→Continue with userId dedup; Skip sets
skippedFriends:true AND advances; Continue leaves a pre-existing skippedFriends untouched; disabled
never true at 0/1/2 friends; skip resolves in 8 non-English locales. Plus a LIVE-source anchor: the
real branch must reference both `common:skip` and `common:continue` in a friend-count ternary and
guard the skippedFriends write behind `!hasFriend`.

### Fail-on-revert
Reverted `label` to hardcoded `t('common:continue')`. Implementor test → FAIL (exit 1). Adversarial
test → FAIL `live branch must reference common:skip (no-friend path)` (exit 1). Restored → both PASS.

---

## ITEM 3 — Discover spotlight no-bleed — CONDITIONAL PASS

### Independent geometry re-derivation (box model verified line-by-line)
- `pillBar1016Capsule`: `borderWidth:1`, NO horizontal padding, `overflow:hidden` → the spotlight
  `Animated.View` (direct child, `position:absolute`, `left = spotlight1016X`) is measured from the
  capsule **padding-box** (inside the 1px border).
- `tabs1016Row`: `flex:1`, `paddingHorizontal:4` → content box starts +4px from the capsule
  padding-box origin. Each `tab1016` Pressable `onLayout.x` is parent(row)-relative.
  ⇒ a tab's true left in spotlight-space = `4 + layout.x`.
- Fix: `targetX = TABS_1016_ROW_PADDING_H(4) + layout.x + cc.nav.spotlightInset`. `spotlightInset = 0`
  (designSystem.ts:686, confirmed). `targetWidth = layout.width - inset*2` UNCHANGED. No double-count:
  the spotlight style carries no baked-in left/margin; `top:4/bottom:4` handle the vertical inset.
  **Geometry is correct.** Drift sentinel valid: constant 4 == `styles.tabs1016Row.paddingHorizontal` 4.

### Adversarial suite (DIFFERENT angle = two-tab no-bleed invariant + bug proof)
`app-mobile/src/components/__tests__/meta-orch-1233-item3-spotlight-geometry.adversarial.test.tsx`
Reconstructs the two-tab box model from shipped tokens (read from source) across several content
widths and asserts the NO-BLEED invariant for BOTH Events-active and Trips-active (pill left aligns
to tab content-left within 0.5px; pill right never crosses the tab right). Proves the OLD math placed
the pill exactly `rowPad`(4)px too far left so its left edge landed inside the Events extent (the
bleed), and the FIXED math does not. Sweeps `spotlightInset` ∈ {0,2,4} (term composes), and guards
`targetWidth` integrity.

### Fail-on-revert
Reverted `targetX` to `layout.x + cc.nav.spotlightInset`. Implementor test → FAIL (exit 1).
Adversarial test → FAIL `targetX must add TABS_1016_ROW_PADDING_H` (exit 1). Restored → both PASS.

### Runtime effort (REQUIRED) — what I tried, and why it is capped
The implementor claimed "only minglabusiness.app installed." **That is inaccurate** — consumer
`Mingla.app` (bundle `com.mingla.app.v2`) IS installed on several simulators (iPhone-17 F7ECAC25,
SE-3rd-gen E07985BA, 5A325571). I inspected them. Findings that nonetheless block a faithful runtime:
1. Those `Mingla.app` builds are **dev-client** (no `main.jsbundle`) dated **May 21 / May 29** — over
   a month stale, predating 3 native build bumps (consumer builds 29→30→31 since). They require a
   running Metro serving JS and may be native-ABI-incompatible with current worktree JS.
2. The worktree's `app-mobile/node_modules` is a **symlink to `Desktop/mingla-main/app-mobile/
   node_modules`** (the active, currently-dirty main checkout). Starting Metro from here risks the
   documented **cross-session Metro-cache poisoning** hazard.
3. **No bypass route to Discover**: `DiscoverScreen` is rendered only inside `app/index.tsx` behind
   `isAuthenticated && user?.id && !showOnboardingFlow && !needsOnboarding` (verified lines ~897,
   2132). There is no deep-linkable standalone Discover route. Reaching it requires live phone-OTP
   auth (PROD DB wiped 2026-06-22, no seeded consumer) **and** completing the entire onboarding flow.
A from-scratch consumer build + auth + full onboarding to reach Discover was not feasible in this
window — consistent with the documented "authed runtime unreachable — cap claims" reality.

### Standing proof (cap = "reproduced via faithful box-model render")
- Implementor: `Mingla_Artifacts/evidence/META-ORCH-1233/item3_boxmodel_repro.png` (Trips-active,
  buggy vs fixed) — reviewed, faithful.
- **Tester (independent corroboration, BOTH tabs + pixel rulers)**:
  `Mingla_Artifacts/evidence/META-ORCH-1233/item3_tester_boxmodel_both_tabs.png` (+ `.html` source).
  Rows: BUGGY Events Δ=−4px (left bleed), BUGGY Trips Δ=−4px (bleeds toward Events), FIXED Events
  Δ=0px (aligned), FIXED Trips Δ=0px (aligned). Yellow pill-left and blue tab-left markers coincide
  exactly only in the FIXED rows. (Evidence dir is gitignored per repo policy → local-only.)

### Cap-lift condition (the standing runtime requirement)
On a real consumer build reaching Discover (iOS + Android, Android opaque-glass path included),
screenshot Trips-active and Events-active; the orange pill's left edge must align with the active
tab's content-left within ~1px with NO tint/border/glow extending onto the neighbor, and rapid toggle
must show no settled straddle. Until then item 3 is CONDITIONAL PASS on the geometry + box-model proof.

---

## Tester adversarial test files (append-only, commit `62851d96cea0`)
- `app-mobile/src/components/__tests__/meta-orch-1233-item1-valueprop-scroll-sync.adversarial.test.tsx`
- `app-mobile/src/components/__tests__/meta-orch-1233-item2-friends-skip-continue.adversarial.test.tsx`
- `app-mobile/src/components/__tests__/meta-orch-1233-item3-spotlight-geometry.adversarial.test.tsx`
