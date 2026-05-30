# SPEC — META-ORCH-1002 Sub-D — Business app Android glass sweep

**Mode:** SPEC (mechanical sweep contract — derived from a proven recipe, not a fresh investigation)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-d-business-glass-sweep]/` on branch `META-ORCH-1002-sub-d-business-glass-sweep`.
**Primary inputs (proven, not re-investigated):**
- `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §3.3 (business Symptom-A catalog) + §4.2 (business Symptom-B stragglers).
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` §3 (canonical recipe, proven on-device in Sub-1).
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` (pattern + test style).
**External APIs touched:** NONE. Pure React Native style/`Platform` change. No backend/migration/edge/dependency.

---

## 0. Policy (locked, inherited from Sub-1)

Solid frosted (opaque ≥ 0.92) Android surfaces by default; iOS byte-identical. On the **dark** business canvas (`#141113`/`#0c0e12`), the inset-ring artifact is far milder than on light canvas, so the per-surface judgment is:

- **ALWAYS** add `overflow:'hidden'` (clips fill+border to the radius → kills the corner-misalignment ring) and **ensure no Android elevation rectangle draws under a rounded fill**.
- **Keep the translucent glass fill** on dark-canvas surfaces (preserve the intended aesthetic). Make the fill opaque **only** where the ring actually shows (light canvas, or a raw unguarded BlurView leaking busy content).
- Do NOT blindly opaque-ify every surface — that would flatten the intended look.

## 1. Scope (Sub-D only — `mingla-business/` RN-mobile source)

### 1.1 Symptom-B stragglers (3 — clear bugs)

| # | File | Bug | Fix |
|---|---|---|---|
| B1 | `ui/Toast.tsx` | `const blurOk = Platform.OS !== "web" \|\| supportsBackdropFilter` is INVERTED → `true` on Android → real (thin) BlurView; opaque fallback unreachable. | Mirror `GlassChrome.shouldUseRealBlur()`: iOS `true`, Android `false`, web by backdrop-filter support. Android now takes the opaque `FALLBACK_BACKGROUND` (`rgba(20,22,26,0.92)`). |
| B2 | `ari/AiDisclosureModal.tsx` | Raw `<BlurView intensity={40}>` no guard → thin near-transparent fallback on Android (relied on 0.78 tint, < 0.92 policy). | Route Android to an opaque frosted sheet (`#1a1416`, fully opaque, warm-dark matching the iOS blur intent); iOS keeps real blur. |
| B3 | `marketing/BlastCustomersCta.tsx` | Raw L1 `<BlurView>` no guard → accent tint floor over a near-transparent base on Android. | Guard L1 → opaque `rgba(20,22,26,0.92)` on Android; the L2 accent tint floor then composites over a solid base → confident solid capsule. iOS keeps real blur. |

### 1.2 Symptom-A sweep (~205 inline instances across ~102 files)

Every rounded surface combining `borderRadius` + (border and/or translucent fill) on the dark business canvas, **lacking `overflow:'hidden'`**, gets `overflow:'hidden'`. The dark-canvas translucent fill is preserved. No Android elevation change needed because **none** of the 218 Symptom-A instances carry a shadow/elevation (machine-verified: `shadow=false` for all). The two raw `elevation:8` tab-bars and the S5/S6 list-card `host` were already fixed in Sub-1 (on main) — NOT redone here.

**Excluded by hard guard:** all `*.web.tsx` files (Next.js web-only — 4 catalog entries), instances already carrying `overflow:'hidden'` (13 catalog entries), `packages/`, `app-mobile/`, `mingla-admin/`, backend.

**Phasing:** Phase 1 = stragglers + highest-visibility creators/composer (event/trip/marketing, 118 surfaces). Phase 2 = brand/door/ari/orders/experience/ui/etc (87 surfaces). Both ship in this PR.

## 2. Mechanism (canonical recipe, reused — no new system)

- **Recipe-A (Symptom A):** add `overflow:'hidden'` to the rounded fill view. Proven references: `GlassChrome.tsx` clip-view, consumer `SwipeableSessionCards.tsx:699`. No fill change on dark-canvas surfaces (judgment rule). No elevation change (none present).
- **Recipe-B (Symptom B stragglers):** route Android to the existing opaque `FALLBACK_BACKGROUND` (`rgba(20,22,26,0.92)`, the shipped `GlassChrome` fallback) instead of a raw/inverted BlurView. iOS keeps real `UIVisualEffectView` blur.

## 3. Success criteria

- **SC-B1/B2/B3:** each straggler renders an opaque ≥0.92 frosted surface on Android; iOS renders real BlurView byte-identically; web path preserved via backdrop-filter detection.
- **SC-A (sweep):** every in-scope rounded translucent surface carries `overflow:'hidden'` so the fill reaches the rounded corner on Android; the translucent glass fill is unchanged (not flattened); no Android elevation draws under any of them.
- **SC-iOS-frozen:** every change is behind a `Platform` guard or is a `StyleSheet` `overflow` key (no platform behavior on iOS — `overflow:'hidden'` is a no-op for these correctly-compositing iOS surfaces). iOS rendering unchanged.
- **SC-scope:** zero touch to `app-mobile/`, `packages/`, `mingla-admin/`, `*.web.tsx`, backend, dependencies.

## 4. Invariants

- **I-ANDROID-ROUNDED-FILL-CLIPPED (DRAFT, scoped to business Symptom-A surfaces):** rounded translucent surfaces carry `overflow:'hidden'`. Asserted by the regression test.
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** business glass-chrome stragglers render opaque ≥0.92 on Android, never an unguarded BlurView. Asserted by the regression test.
- **iOS-render-frozen:** preserved.
- **mingla-business desktop-web 16 contracts:** preserved (no `.web.tsx` touched; desktop rail/wizard `elevation` untouched).

## 5. Test (Step 0.5 gate)

`mingla-business/src/components/__tests__/metaOrch1002SubDBusinessGlass.test.ts` — ts-jest source-reader (29 tests): the 3 stragglers (inverted-guard fix, opaque-on-Android branch, web preserved) + a representative sample of swept surfaces across event/trip/marketing/ari/brand/door/orders + a "fill PRESERVED not flattened" guard. Fails-on-revert verified. Adversarial angles noted for the tester (iOS frozen, no-over-opaque-ification, web path, Android-specific branch).

## 6. Hard guards

Touch ONLY `mingla-business/` RN-mobile source. Every straggler change behind a `Platform` guard; sweep adds only a `StyleSheet` `overflow` key. No new dependency. Respect the 16 desktop-web contracts (4 jest gates run). No backend/strict-grep file added.
