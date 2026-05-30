# SPEC — META-ORCH-1002 [Android glass hardening] — Sub-C (SHARED PACKAGE + public pages)

**Mode:** SPEC (bounded, derived from the proven first-strike contract)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-c-shared-glassblur-public]/` on branch `META-ORCH-1002-sub-c-shared-glassblur-public`.
**Primary inputs (proven, NOT re-investigated):**
- `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §4.3 (shared package), §5 (leverage map)
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` §3 (canonical recipe — already shipped + on-device-proven in Sub-1)
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` (pattern + test style mirrored)

**External APIs touched:** NONE (pure React Native `Platform.OS` branch). COMMS-0003 docs-citation N/A. No backend/migration/edge/dependency change.

---

## 0. Operator decisions already locked (not re-litigated)

- **POLICY = Option 1 — solid frosted surfaces on Android by default.** On Android, glass surfaces render an OPAQUE (≥ 0.92 alpha) frosted fill instead of relying on `expo-blur`. No real `dimezisBlurView` blur on these surfaces. iOS byte-identical.
- **SCOPE = Sub-C ONLY — `packages/event-rendering/*` + `packages/brand-rendering/*`.** No `app-mobile`/`mingla-business` source (Sub-B/Sub-D, parallel worktrees).

---

## 1. Layman summary

The public event page and public brand page are built from one shared code package so both Mingla apps render them identically. Those pages stack "glass" panels that lean on a blur effect Android renders as a thin see-through film (Symptom B). This sub-track fixes the single shared blur primitive (`GlassBlur`) so that on Android it paints a solid frosted panel instead of the film — one change that fixes all ten public-page panels (1 event + 9 brand) in BOTH apps at once. iOS and web rendering are untouched.

---

## 2. Scope & non-goals

### 2.1 In scope

| # | Surface | File | Change |
|---|---------|------|--------|
| C1 | Shared blur primitive | `packages/event-rendering/GlassBlur.tsx` | Add an Android branch: opaque frosted `View` fill keyed to the BlurView `tint`, instead of the raw `BlurView`. iOS + web branches unchanged. |
| C2 | Public event page panel | `packages/event-rendering/PublicEventPage.tsx` (GlassBlur @ ~552) | Verify it reads solid on Android via C1. No per-instance patch needed (confirmed below). |
| C3 | Public brand page panels (×9) | `packages/brand-rendering/PublicBrandPage.tsx` (@ 549,629,901,980,1078,1235,1320,1392,1418) | Verify all 9 read solid via C1. No per-instance patch needed (confirmed below). |
| C4 | Shared cover cards (Symptom-A check) | `packages/event-rendering/EventCoverMedia.tsx`, `EventCover.tsx` | VERIFY `overflow:'hidden'` present (already mitigated, investigation §3.4). Do NOT change. |

### 2.2 Non-goals

- `app-mobile` chrome / `mingla-business` source — Sub-B / Sub-D, parallel worktrees. NOT touched.
- Token consolidation into `@mingla/design-tokens` (Sub-F). NOT touched.
- Real `dimezisBlurView` hero-surface validation. NOT touched.
- Symptom-A sweep beyond the shared cover-card verify. NOT touched.

### 2.3 Why no per-instance public-page patch is needed (verified against source)

Every GlassBlur usage in both public pages is a **decorative `absoluteFill` layer rendered as the FIRST child** of a parent panel, passing only `tint` + `intensity` + `style={styles.glassLayer / bodyGlassLayer}` (= `StyleSheet.absoluteFillObject`). NONE passes its own `backgroundColor`. The translucent surface lives on the PARENT panel (`backgroundColor: palette.glass / panel / page`). Therefore:

1. Routing GlassBlur's Android render to an opaque fill makes every panel read solid frosted — no instance-level edit required.
2. Every parent panel that hosts a GlassBlur (`bodyContent`, `identityCentered`, `tabsRow`, `nextTeaser`, `eventCard`, `aboutBlock`) carries **`borderRadius` + `overflow:'hidden'`**, so the opaque `absoluteFill` is clipped to the rounded corners → no Symptom-A ring is introduced by the opaque fill.
3. GlassBlur is always rendered BEHIND the panel content (first child), so the opaque fill never covers text/avatars/media.

(All three points were grep+read verified on 2026-05-29 against the worktree source.)

---

## 3. Canonical recipe applied (from first-strike SPEC §3)

**Symptom B (chrome reads solid frosted, not see-through):** route the surface to its opaque fallback on Android (no reliance on expo-blur for opacity).

Applied to `GlassBlur.tsx`:

```tsx
if (Platform.OS === "android") {
  const { intensity, tint, experimentalBlurMethod, blurReductionFactor, children, style, ...viewProps } = props;
  return (
    <View {...viewProps} style={[style, { backgroundColor: androidOpaqueFillForTint(tint) }]}>
      {children}
    </View>
  );
}
return <BlurView {...props} />;   // iOS unchanged
```

Opaque fills (≥ 0.92), tint-keyed so the panel reads as the same material it was designed for:

- **dark** (and every `system*Dark` / `default` / unrecognized tint) → `rgba(20, 22, 26, 0.92)` — the already-shipped, on-device-validated business `GlassChrome` dark fallback (kit-consistent; SPEC §4 S6 + §10).
- **light** (and every `*Light` tint) → `rgba(248, 249, 251, 0.94)` — light frosted equivalent ≥ 0.92.

Blur-only props (`intensity`/`tint`/`experimentalBlurMethod`/`blurReductionFactor`) are destructured out so the `<View>` receives only valid View props; `tint` is consumed to choose the fill (this mirrors the existing web branch, which already forwards only `style`+`children`).

> 🔒 LOCKED: Android branch returns an opaque `View` (≥ 0.92 fill), never a `BlurView`; iOS keeps `<BlurView {...props} />`; web mobile-crash branch preserved byte-for-byte. 🎨 OPEN: the exact light fill hex (`rgba(248,249,251,0.94)` proposed; a designer may nudge ±2/channel but it MUST stay ≥ 0.92).

**Symptom A (shared cover cards):** VERIFY-ONLY. `EventCoverMedia.tsx:579` + `EventCover.tsx:125` already carry `overflow:'hidden'`. No change. 🔒 LOCKED: do not touch unless a real ring exists (none does).

---

## 4. Cross-surface impact (Phase 2.5)

| Surface | Covered? | Behavior | Parity |
|---|---|---|---|
| 1. Consumer iOS (`app-mobile`) | YES (no-op) | `app-mobile` does not import these public pages; GlassBlur iOS branch unchanged regardless. | Automatic |
| 2. Consumer Android (`app-mobile`) | NO | `app-mobile` does not render the public event/brand pages. | N/A |
| 3. Buyer/anon Web (`mingla-business` web) | YES (no-op) | Web path = the mobile-web blur-skip branch + desktop BlurView; both preserved byte-for-byte. | Automatic |
| 4. Business iOS (`mingla-business`) | YES (no-op) | GlassBlur iOS branch unchanged → real BlurView on the public pages. | Automatic |
| 5. Business Android (`mingla-business`) | YES (TARGET) | All 10 public-page panels render solid frosted (opaque ≥ 0.92) instead of see-through film. | This is the target surface |
| 6. Admin Web (`mingla-admin`) | NO | Does not render these pages. | N/A |
| 7. Business Web preview | YES (no-op) | Same as #3. | Automatic |

The shared package renders natively on Android **in the business app** (`app/e/[brandSlug]/[eventSlug].tsx`, `app/b/[brandSlug]/index.tsx`) — that is the surface this fix targets. Single shared code path → parity automatic.

---

## 5. Success criteria

- **SC-C1 (Android):** `GlassBlur` on Android renders an opaque (≥ 0.92) `View` fill, NOT a `BlurView`; fill is dark (`rgba(20,22,26,0.92)`) for dark/default tints and light (`rgba(248,249,251,0.94)`) for `*Light` tints.
- **SC-C1-iOS:** `GlassBlur` on iOS renders the real `BlurView {...props}` exactly as before.
- **SC-C1-web:** the mobile-web blur-skip branch (`width < 768`) + desktop BlurView are byte-identical to before.
- **SC-C2/C3 (Android):** all 10 public-page GlassBlur panels (1 event + 9 brand) read solid frosted on Android via C1; no panel shows a corner ring (parents clip).
- **SC-C4:** `EventCoverMedia` + `EventCover` retain `overflow:'hidden'` (unchanged).
- **SC-C5 (isolation):** `GlassBlur` imports nothing from `app-mobile`/`mingla-business`; only `packages/event-rendering/*` + `packages/brand-rendering/*` are touched (plus the test + report). I-MOR-0827 preserved.

---

## 6. Invariants

**Preserved:**
- **I-MOR-0827-PACKAGE-ISOLATION:** GlassBlur stays pure-presentational; no app imports. The package `designTokens.ts` was NOT edited (the opaque fills are local consts in GlassBlur, no token-file change needed). Verified SC-C5.
- **iOS-render-frozen:** Android branch is guarded above the iOS return; iOS path byte-identical. Verified SC-C1-iOS.
- **I-7 (visible degradation, no null):** Android branch renders a visible opaque View, never null.

**Advanced (DRAFT → ACTIVE on CLOSE):**
- **I-ANDROID-GLASS-OPAQUE-FALLBACK** now extends to the shared `GlassBlur` primitive: on Android it renders an opaque ≥ 0.92 fill, never an `expo-blur` BlurView, for the public-page panels. Asserted by T-01/T-02.

---

## 7. Test cases (Step 0.5 gate)

Source-assertion node script mirroring the first-strike pattern, at `packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-check.mjs`:

| Test | Assertion |
|---|---|
| T-01 | GlassBlur has a `Platform.OS === 'android'` branch returning a `<View>` with `backgroundColor: androidOpaqueFillForTint(...)`, not a BlurView; `androidOpaqueFillForTint` keys off the tint. |
| T-02 | Both opaque fills (`ANDROID_OPAQUE_DARK_FILL`, `ANDROID_OPAQUE_LIGHT_FILL`) are ≥ 0.92 alpha. |
| T-03 | iOS still returns `<BlurView {...props} />`; mobile-web blur-skip branch preserved. |
| T-04 | `EventCoverMedia` + `EventCover` retain `overflow:'hidden'`. |
| T-05 | GlassBlur imports nothing from `app-mobile`/`mingla-business` (I-MOR-0827). |

**Where the tester's adversarial test should attack:**
- **Revert-canary:** assert the test FAILS if the Android branch is removed (proven: 4 FAIL on revert).
- **iOS-regression guard:** assert iOS still renders `BlurView` (the failure mode = implementor made it opaque on iOS too).
- **Alpha-floor guard:** assert no opaque fill drops below 0.92.
- **On-device live-fire (tester, mandatory):** render `/b/{brandSlug}` and `/e/{brand}/{event}` on Android in the business app over a busy hero; confirm every panel reads solid frosted (no see-through film), no corner ring; plus an iOS pass confirming BlurView frost unchanged.
- **Package-isolation guard:** assert only `packages/*` touched; no app source in the diff.

---

## 8. Hard guards

- Touch ONLY `packages/event-rendering/*` + `packages/brand-rendering/*` (+ test + report). No `app-mobile`/`mingla-business` source.
- I-MOR-0827: no app imports in the package. (`designTokens.ts` not edited — opaque fills are local GlassBlur consts.)
- Every change behind `Platform.OS === 'android'`; iOS + web unchanged. No new dependency. No backend.
