# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] device-rework #4: floating Reserve CTA = compact pill only

**Branch:** `ORCH-1138-trip-page-redesign`
**HEAD:** `8b90f13136ede46758f13b8aef44c1c386084edc` (was `8b8f639bd`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/`
**Status:** implemented and verified (sim-proven on iPhone 17 Pro, iOS 26.4)

---

## 1. Summary

One precise refinement to the trip-page Reserve CTA **floating** state. Seth's ask:
"just a button while floating, no background." The **docked** variant (full bar +
price block + background, flush at the end of the scroll) was already correct and is
left UNCHANGED.

Before this pass, the floating variant — though it had already dropped the full-width
opaque bar *band* in device-rework #3 — was still rendering the full priced body
(`ctaBody`): the "All-in, taxes included" kicker + the "From €500" price block, at
`width: "100%"`. So while scrolling, Seth still saw a full-width priced bar, not a
button.

Now the floating variant renders a **compact, self-width pill** with ONLY the
"Reserve my spot →" label — no kicker, no price block — centered at the bottom and
lifted above the home indicator. It reads as a floating action button, not a bar.
The disabled (bookings-closed / unavailable) state renders the same compact pill with
the unavailable title and no onPress (no dead tap). Applied identically to both
surfaces (consumer app + business/web public trip page).

---

## 2. SPEC success-criteria coverage

This is a Seth-direct device-rework iteration (not a fresh SPEC criterion). The
relevant binding constraints from the dispatch:

| Criterion | Verified | Commit |
|---|---|---|
| SC-DR4-1 floating = JUST the button (compact pill), no full-width bar | ✓ sim shot `DR4_float_pill_only.png` + tests | `8b90f13136` |
| SC-DR4-2 floating shows NO "All-in / From €500" price block | ✓ tests B7c/B7d, DR4b; sim shot | `8b90f13136` |
| SC-DR4-3 floating has NO opaque bar bg/scrim | ✓ floatWrapper has no backgroundColor (DR3b/DR3b2) | `8b90f13136` |
| SC-DR4-4 self-width pill, centered, above home indicator | ✓ alignSelf:center + wrapper alignItems:center + safe-area lift; sim shot | `8b90f13136` |
| SC-DR4-5 tappable, same onPress → checkout | ✓ handlePress unchanged → setReserveSheetVisible(true) | `8b90f13136` |
| SC-DR4-6 disabled/labeled bookings-closed state preserved | ✓ floatBody unavailable branch, no onPress, role "text" | `8b90f13136` |
| SC-DR4-7 DOCKED variant unchanged (full bar, price, bg, flush) | ✓ ctaBody untouched; sim shot `DR4_docked_full_bar.png`; test B7g/DR4d | `8b90f13136` |
| SC-DR4-8 ALL surfaces (consumer + business/web) identical | ✓ both components edited identically | `8b90f13136` |
| SC-DR4-9 float→dock swap logic intact | ✓ floatingPillVisible predicate untouched (tests B1-B4c, DR3h/DR3i) | `8b90f13136` |
| SC-DR4-10 Android opaque-glass honored | ✓ Platform.select android elevation:0/shadowOpacity:0, opaque accent fill | `8b90f13136` |

---

## 3. Files changed

| File | Surface | +/− |
|---|---|---|
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | consumer | +~80 / −~14 |
| `mingla-business/src/components/trip/TripReserveBar.tsx` | business/web | +~78 / −~13 |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_float_dock.test.ts` | test (added-on-branch) | +~55 / −~7 |
| `mingla-business/src/components/trip/__tests__/tripReserveFloatDock.orch1138.test.ts` | test (added-on-branch) | +~40 / −~2 |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts` | test (added-on-branch) | +~8 / −~8 |

Total: 5 files, 314 insertions / 48 deletions.

NO schema, NO edge function, NO checkout, NO new dependency touched.

---

## 4. Data-model changes applied

None.

## 5. Edge functions touched

None.

---

## 6. Regression tests added / updated

- **`app-mobile/src/screens/Trip/__tests__/orch_1138_reserve_float_dock.test.ts`** —
  rewrote B7 + added B7a–B7g: floating renders the compact `floatBody` (not the
  priced `ctaBody`); the floating pill shows the label but NOT `styles.rKicker` /
  `styles.rPrice`; `floatButton` is self-width (`alignSelf:"center"`, no
  `width:"100%"`); `floatWrapper` centers it; the DOCKED variant still keeps the
  priced `ctaBody` (`styles.rPrice` present). **19/19 assertions pass.**
- **`mingla-business/src/components/trip/__tests__/tripReserveFloatDock.orch1138.test.ts`**
  — added DR4a–DR4d (compact floatBody, no kicker/price, self-width, docked keeps
  price) and updated DR3b (`floatPill`→`floatButton`). **13/13 tests pass.**
- **`app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts`** —
  updated DR3b assertion `floatPill`→`floatButton`. **31/31 assertions pass.**

**fails-on-revert verified at `8b90f13136`** (via TRUE line replacement, not
comment-out): reverting both components' floating render from `{floatBody}` back to
the priced `<View style={{width:"100%"}}>{ctaBody}</View>`:
- consumer B7 → **FAIL** ("must render floatBody, not the priced ctaBody"), restored → PASS.
- business DR4a → **FAIL** ("must render floatBody"), restored → PASS.

---

## 7. Old → New receipts

### ConsumerTripReserveBar.tsx (consumer) / TripReserveBar.tsx (business) — identical change
**Before:** the floating variant rendered the shared `ctaBody` (kicker "All-in,
taxes included" + "From €500" price block + label) inside `floatPill` at
`width: "100%"` — a full-width priced bar minus only the background band.
**Now:** the floating variant renders a new compact `floatBody` — a self-width
`Pressable` (`floatButton`: `alignSelf:"center"`, `borderRadius:999`, hug padding)
containing ONLY the `{cta.label} →` label; the disabled state renders a compact
self-width strip (`floatButtonDisabled`) with the unavailable title, no onPress,
role "text". The `floatWrapper` now centers the pill (`alignItems:"center"`). The
old `floatPill` (`width:"100%"`) style is removed. The DOCKED branch still renders
the priced `ctaBody`.
**Why:** Seth — "just a button while floating, no background." The price/kicker
belong to the docked (resting) bar only.
**Lines:** ~80 each.

---

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS | ✓ | `ConsumerTripReserveBar.tsx` — floating pill. Sim-verified. |
| Consumer Android | ✓ | same shared RN component; Android opaque accent fill preserved (no shadow under rounded fill). Parity automatic. |
| Buyer/anon Web | ✓ | `TripReserveBar.tsx` via `app/t/[brandSlug]/[tripSlug].tsx` (anon-tolerant; no useAuth). Parity manual but code-identical to consumer. |
| Business iOS | ✓ | same `TripReserveBar.tsx`. |
| Business Android | ✓ | same; opaque fill preserved. |
| Admin Web | — | no trip Reserve CTA there. |
| Business Web preview | ✓ | same `TripReserveBar.tsx`. |

Parity is **manual across the two component files** (consumer-local vs
business-local, per `I-MOR-0827-PACKAGE-ISOLATION`) but the two were edited
identically.

---

## 9. Smoke result (MANDATORY sim proof)

Ran the **consumer app** on iPhone 17 Pro simulator (UDID
`17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4) — NOT `npx expo run:ios`. Isolated
Metro on **port 8090** (`TMPDIR=/tmp/orch1138-metro2`), bracket-free symlink
`/tmp/orch1138_link → ORCH-1138-[trip-page-redesign]` (worktree `node_modules` is a
real copy). Loaded the installed `com.mingla.app.v2` dev client against :8090,
opened the anon-tolerant public trip deep link
`com.mingla.app.v2:///t/travelbrand/the-dc-adventure`.

- **Mid-scroll (docked off-screen):** the FLOATING pill is a compact, self-width
  orange "Reserve my spot →" button centered at the bottom, floating over the "Day
  by day" / "What's included" content — NO full-width bar, NO price block, NO
  background band. → `Mingla_Artifacts/evidence/ORCH-1138/DR4_float_pill_only.png`
  (and `DR4_midscroll_pill_over_content.png`).
- **Scroll end (docked in view):** the floating pill is hidden; the DOCKED full-width
  bar shows "All-in, taxes included / From €500" + "Reserve my spot →" with the
  orange background, flush beneath "Choose how you pay", no black gap. →
  `Mingla_Artifacts/evidence/ORCH-1138/DR4_docked_full_bar.png`.
- a11y label on the floating pill is "Reserve my spot, From €500" (price retained for
  screen readers via accessibilityLabel only — NOT rendered as visible text),
  confirmed via Maestro hierarchy.

(Evidence folder `Mingla_Artifacts/evidence/` is gitignored — files live on disk at
the paths above, referenced not committed.)

---

## 10. Known issues / deferred

None for this change.

---

## 11. Operator action required

- No migration, no edge deploy.
- Route to REVIEW → tester. Do NOT merge/deploy/close (per dispatch).

---

## 12. Discoveries for Orchestrator

1. **Pre-existing stale test on the branch (NOT caused by this pass):**
   `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts`
   assertion **T3a** asserts `style={[styles.wrapper, { bottom: wrapperBottom }]}`,
   but device-rework #3 (commit `8b8f639bd`, prior to this pass) already renamed
   `styles.wrapper` → `styles.floatWrapper`. T3a fails on the baseline `8b8f639bd`
   (verified by stashing my changes). It is out of scope for this floating-pill
   refinement and append-only; flagging for a follow-up test-mod alignment.
2. **Pre-existing failing trip jest suites** (TripVisualParity, PaymentPlanEditor,
   EditPublishedTripScreen, etc. — 11 failed on baseline before my change): these are
   RN-component-mount / source-snapshot suites that fail under ts-jest independent of
   this change. Not introduced by this pass.
3. An untracked `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_POSTEXPERIENCECHECK_ABORTERROR.md`
   exists in the worktree (not authored by this pass) — left unstaged.
