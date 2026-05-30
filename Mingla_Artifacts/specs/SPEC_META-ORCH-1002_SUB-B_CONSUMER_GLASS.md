# SPEC — META-ORCH-1002 Sub-B [Consumer app Android glass Symptom-A sweep]

**Mode:** SPEC (mechanical application of an already-proven recipe)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-b-consumer-glass-sweep]/` on branch `META-ORCH-1002-sub-b-consumer-glass-sweep`.
**Primary inputs (proven, NOT re-investigated):**
- `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §3.2 (consumer Symptom-A catalog).
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` §3 (CANONICAL recipe, on-device proven in Sub-1).
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md` (exact pattern + test style).

**External APIs touched:** NONE (pure React Native style / `Platform.select`). COMMS-0003 docs-citation N/A. No `supabase`/backend/migration/edge touch. No new dependency.

---

## 0. Policy (locked, from Sub-1)

Solid frosted (opaque ≥ 0.92) Android surfaces by default. iOS byte-identical — every change behind `Platform.select` (or `ANDROID_GLASS_USES_OPAQUE_FALLBACK`, already shipped in Sub-1). The shared gate `ANDROID_GLASS_USES_OPAQUE_FALLBACK` already exists in `app-mobile/src/constants/designSystem.ts:12` (merged on main via Sub-1).

---

## 1. Scope (Sub-B only)

Consumer **Symptom-A** inset-ring surfaces from investigation §3.2. Sub-1 already solved Symptom-B chrome (8 chrome files + shared gate), the NotificationsSheet card, and the MessageInterface chat capsule — those are NOT re-touched.

### 1.1 The canonical recipe (apply exactly, per first-strike SPEC §3.1)

For each rounded surface with `borderRadius` + (border and/or shadow/elevation) + translucent-or-same-as-parent fill, on Android satisfy ALL of:

1. **`overflow: 'hidden'`** on the rounded fill view — clips fill + border to the radius so they composite as one layer (kills the inset ring). Safe to add unconditionally: on iOS, `overflow:'hidden'` does NOT clip the drop shadow (proven by reference `board/SwipeableSessionCards.tsx:699`, which keeps `overflow:'hidden'` + `elevation:10` + iOS shadow together and renders correctly).
2. **Opaque (≥ 0.92) fill on Android** via `Platform.select`, where the fill is translucent on a light/high-contrast canvas. The opaque equivalent = the existing translucent fill composited over its real background.
3. **No Android shadow/elevation rectangle under the rounded fill** — zero the Android `elevation` via `Platform.select({ ios: N, android: 0 })` where a bare `elevation` sits under a rounded translucent pill/card.

### 1.2 Critical judgment — light vs dark canvas

Many consumer surfaces are intentional translucent-white-on-dark "glass". The ring is far milder on dark canvas. For dark-canvas surfaces: ALWAYS add `overflow:'hidden'` + ensure no Android elevation rectangle, but **KEEP the translucent fill** (preserve the glass aesthetic). Opaque-ify the fill ONLY where the ring actually shows (light canvas / high-contrast border). When unsure, prefer `overflow:'hidden'` + elevation-safety over changing the fill.

---

## 2. Catalog & per-surface treatment

Line numbers are style-block anchors as of this worktree (investigation cites drifted at file-edit time; blocks located by style name).

### 2.A LIGHT-CANVAS exemplar-grade (opaque-ify + clip + elevation-safety)

| # | Surface | File · style | Current fill | Treatment | Android opaque |
|---|---------|--------------|--------------|-----------|----------------|
| A1 | Incoming pair-request modal card | `IncomingPairRequestCard.tsx` · `card` (~274) | `rgba(255,255,255,0.95)` on dimmed `rgba(0,0,0,0.35)` backdrop, border `rgba(255,255,255,0.5)`, `...shadows.lg` (`elevation:8`) | `overflow:'hidden'` + Android `elevation:0` (shadow stays iOS) | fill already ≥0.92 (0.95) — keep; opaque-ify to `#FFFFFF` on Android for crisp corner |
| A2 | Pairing-info modal card | `PairingInfoCard.tsx` · `card` (~167) | same as A1 | same as A1 | same as A1 |
| A3 | Multi-day calendar panel | `ui/MultiDayCalendar.tsx` · `container` (~222) | `rgba(255,255,255,0.60)` frosted-white + border `rgba(255,255,255,0.40)` + `elevation:6` | `overflow:'hidden'` + Android opaque white `#FFFFFF` + Android `elevation:0` | `#FFFFFF` (frosted-white intent rendered solid) |
| A4 | Add-friend glass panel | `connections/AddFriendView.tsx` · `glassCard` (~530) | `rgba(255,255,255,0.70)` frosted-white + border + `elevation:6` | `overflow:'hidden'` + Android opaque white `#FFFFFF` + Android `elevation:0` | `#FFFFFF` |

Rationale A3/A4: white-translucent frosted panels. Per policy, Android target = the iOS frosted-white *intent* rendered as a solid opaque white panel. The `elevation:6` under a rounded translucent panel is the Android shadow-rectangle artifact → zero it on Android, keep iOS shadow (which is `shadowColor` based here, unaffected by `overflow:'hidden'`).

### 2.B MED — opaque-white-on-white + border + elevation (clip only; fill already opaque)

| # | Surface | File · style | Treatment |
|---|---------|--------------|-----------|
| B1 | Paired-people horizontal card | `PairedPeopleRow.tsx` · `card` (~157) | `overflow:'hidden'` (fill `"white"`, border `rgba(0,0,0,0.04)`, `elevation:3`) |
| B2 | Account-settings card | `profile/AccountSettings.tsx` · `card` (~1139) | `overflow:'hidden'` (fill `#ffffff`, border `#e5e7eb`, `elevation:2`) |
| B3 | Billing current-plan card | `profile/BillingSheet.tsx` · `currentPlanCard` (~504) | `overflow:'hidden'` (fill `#ffffff`, border `#eb7825`, `elevation:2`) |
| B4 | Billing tier card | `profile/BillingSheet.tsx` · second card block (~575) | `overflow:'hidden'` (fill `#ffffff`, border, `elevation:2`) |

For MED the fill is already opaque; the ring comes from border+elevation corner-misalignment, fixed by `overflow:'hidden'` alone. `overflow:'hidden'` is iOS-safe (shadow not clipped) → no `Platform.select` needed; iOS byte-identical. No elevation change (low `elevation:2/3` reads as a soft lift, not a rectangle, once the fill clips to the corner — matching the S1 notification-card decision in first-strike SPEC §4 S1 step 4).

### 2.C DARK-CANVAS (clip + elevation-safety; KEEP translucent fill)

| # | Surface | File · style | Treatment |
|---|---------|--------------|-----------|
| C1 | Onboarding secondary CTA | `onboarding/OnboardingShell.tsx` · `secondaryCta` (~384) | `overflow:'hidden'` only (no shadow/elevation; `rgba(255,255,255,0.45)` + subtle border — KEEP fill) |
| C2 | Start-swiping header pill | `connections/StartSwipingHeaderButton.tsx` · `button` (~46) | `overflow:'hidden'` only (orange glass pill `rgba(235,120,37,0.18)`, white label — dark canvas, KEEP fill) |
| C3 | Calendar empty-state chip | `activity/CalendarTab.tsx` · `emptyState` (~1180) | `overflow:'hidden'` only (orange-tint `rgba(235,120,37,0.08)` + bright cream border, no elevation — KEEP fill) |
| C4 | Calendar accordion header | `activity/CalendarTab.tsx` · `accordionHeader` (~1221) | `overflow:'hidden'` + Android `elevation:0` (`rgba(255,255,255,0.06)` + near-white border `#f0f0f0` + `elevation:1` — KEEP fill) |
| C5 | Saved empty-state chip | `activity/SavedTab.tsx` · `emptyState` (~673) | `overflow:'hidden'` only (mirror of C3 — KEEP fill) |
| C6 | Chat-list row | `connections/ChatListItem.tsx` · `container` (~513) | `overflow:'hidden'` + Android `elevation:0` (dark glass `rgba(255,255,255,0.075/0.09)` + subtle border, Android `elevation:2` — KEEP fill) |

Rationale C: these are intentional dark-canvas glass. Opaque-ifying would flatten the aesthetic. The ring (where it shows at all) is the corner-misalignment of border+fill, fixed by `overflow:'hidden'`. Where an `elevation` sits under the rounded fill (C4 `elevation:1`, C6 `elevation:2`), zero it on Android so no rectangle draws; iOS shadow (where present) untouched.

---

## 3. Cross-surface impact (Phase 2.5)

| Surface | Covered? | Behavior | Parity |
|---|---|---|---|
| 1. Consumer iOS (`app-mobile`) | YES (no-op) | Pixel-identical: every change behind `Platform.select`; `overflow:'hidden'` does not clip iOS shadow. | Automatic |
| 2. Consumer Android (`app-mobile`) | YES (target) | A1–A4 solid frosted to corners, no ring; B1–B4 clipped; C1–C6 clipped + no elevation rectangle, glass preserved. | Target |
| 3. Buyer/anon Web | NO | RN-mobile surfaces; web glass path = `GlassBlur.tsx` (deferred Sub-C). | N/A |
| 4. Business iOS | NO | `mingla-business` not touched. | N/A |
| 5. Business Android | NO | `mingla-business` not touched (Sub-1 owned S5/S6; rest deferred). | N/A |
| 6. Admin Web | NO | Renders none of these. | N/A |
| 7. Business Web preview | NO | Same as #3. | N/A |

---

## 4. Success criteria

- **SC-A (A1–A4, Android):** Each light-canvas card/panel shows a fully opaque fill reaching all four rounded corners — no ring; no Android shadow rectangle under the rounded fill.
- **SC-A-iOS:** iOS byte-identical (translucent fill + shadow exactly as today).
- **SC-B (B1–B4, Android):** Each opaque-white card clips fill+border to the radius (no corner ring). iOS unchanged.
- **SC-C (C1–C6, Android):** Each dark-glass surface clips to the radius and draws no Android elevation rectangle, while KEEPING its translucent glass fill. iOS unchanged.
- **SC-iOS-frozen (global):** No `Platform.select` loses its `ios`/`default` original value; no dark-canvas fill is opaque-ified.
- **SC-scope (global):** Only `app-mobile/` source touched. No `mingla-business`, no `packages/`, no `mingla-admin`, no backend, no new dependency, NO re-touch of the Sub-1 chrome files / NotificationsSheet / MessageInterface.

---

## 5. Tests (Step 0.5 gate)

A consumer node source-reader mirroring `app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs`:
`app-mobile/scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs`.

- **T-A:** A1–A4 style blocks contain `overflow: 'hidden'`; A3/A4 fills are `Platform.select` with Android `#FFFFFF`; A1–A4 Android elevation resolves to 0 where a bare elevation existed.
- **T-B:** B1–B4 style blocks contain `overflow: 'hidden'`.
- **T-C:** C1–C6 style blocks contain `overflow: 'hidden'`; C4/C6 Android elevation resolves to 0.
- **T-iOS:** A3/A4 fills keep the original translucent value in the `ios`/`default` branch; C-bucket fills are NOT opaque-ified (assert original translucent fills still present).
- **T-scope (revert-canary):** the test FAILS if any swept `overflow:'hidden'` is reverted.

On-device pixel verification is the tester's live-fire job.

---

## 6. Implementation order & hard guards

**Order:** A bucket (full quality) → COMMIT → B bucket → C bucket → tests → typecheck.

**Hard guards (🔒 LOCKED):**
- Touch ONLY `app-mobile/` source. No `mingla-business`, no `packages/`, no `mingla-admin`, no backend.
- Do NOT re-touch the Sub-1 files (8 chrome files, `NotificationsSheet.tsx`, `MessageInterface.tsx`, the shared gate export, `designSystem.ts` `cardUnreadBg`).
- Every change behind `Platform.select` (or `overflow:'hidden'`, which is iOS-shadow-safe). No iOS branch value changes; no dark-canvas fill flattened.
- No new dependency.

---

## 7. DONE vs REMAINING accounting

This sub-B treats the named exemplar-grade + MED + representative dark-canvas surfaces from §3.2 with full quality (14 surfaces across 11 files). The investigation's broader ~95 HIGH / ~15 MED / ~50 dark-canvas counts include many lower-visibility siblings; per the dispatch's "quality over coverage" + explicit phasing, the remaining long-tail siblings are listed REMAINING in the implementation report for a follow-up pass, with no silent skips.
