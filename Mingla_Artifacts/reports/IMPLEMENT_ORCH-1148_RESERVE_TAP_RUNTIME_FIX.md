# IMPLEMENT — ORCH-1148 Reserve-tap runtime fix (consumer app)

**Date:** 2026-06-17
**Surface:** app-mobile (consumer, runtime 1.1.0)
**Branch:** `ORCH-1148-venue-reserve-runtime`
**Scope:** finish + RUNTIME-VERIFY a prior agent's dead-tap fix; clean up; add a fails-on-revert regression gate; commit. No deploy/merge.

---

## Sim runtime proof: YES

The fix was proven AT RUNTIME on an iPhone 17 Pro simulator (iOS 26.4) running the
**worktree** dev bundle (Metro served from this worktree, confirmed via the
`[ORCH-1148][TAP]` diagnostic firing and the prior agent's stale `[SHEET-GATE]`/`[PROBE-TAP]`
diagnostics being absent).

### What was driven
- Reservable venue: **Lantern & Vine** (Raleigh), `place_pool_id 8b720912-a0bf-405a-88f8-773eca6f3f33`,
  brand `53aaea42-…`, `reservations_enabled = true`. Confirmed `pg_venue_reservable_for_place`
  returns `{reservable:true, brand_id, currency:USD}`. This is the ONLY currently-reservable
  brand in the DB, so the deck GPS was set to the venue's coords to surface it.
- Expanded the card → the real **"Reserve a table"** button rendered
  (`evidence/ORCH-1148/expanded-worktree.png`).
- Tapped "Reserve a table" → diagnostic logged `[ORCH-1148][TAP] Reserve a table { isNightOut: false, … }`
  → the **3-step VenueReserveSheet OPENED** over the card (header "Reserve a table" /
  "Lantern & Vine", PARTY SIZE stepper, DATE picker) →
  `evidence/ORCH-1148/reserve-sheet-opens.png`. **THIS is the fix-proof.**
- Closed via the X → card restored to the expanded state
  (`evidence/ORCH-1148/sheet-closed-card-restored.png`).
- Re-tapped → sheet re-opened (`evidence/ORCH-1148/sheet-reopens.png`).

### Bug also reproduced live (bonus)
Before re-pointing Metro at the worktree, the running app was serving the prior agent's
temp probe bundle, which still had the **buggy** sheet gate (`isNightOut && nightOut && …`).
Tapping the (probe-forced) Reserve button there logged
`[ORCH-1148][SHEET-GATE] … gateWouldMount:false, isNightOut:false, reservable:true …` and
**no sheet appeared / the card collapsed** — the dead-tap, observed live.

---

## Confirmed root cause

In `app-mobile/src/components/ExpandedCardModal.tsx`:
- The **"Reserve a table" BUTTON** renders only in the regular-place branch (`!isNightOut`).
- The **VenueReserveSheet render gate** additionally required `isNightOut && nightOut`.

Those two conditions are **mutually exclusive**: on every card that shows the button,
`isNightOut` is false → the sheet gate is false → tapping flips `isReserveSheetOpen` true
but `<VenueReserveSheet>` never mounts → guaranteed **dead tap** on every reservable card.

## The fix (gate alignment)

The sheet gate now mirrors the button EXACTLY — `isNightOut && nightOut` removed:

```
{venueReservable?.reservable === true &&
  venueReservable.brand_id !== null && isReserveSheetOpen && (
    <VenueReserveSheet … />
  )}
```

The sheet's props (`brandId`, `venueName = card.title`, `currency`) never depend on
`nightOut`, so dropping it is correct. A descriptive comment documents the trap.

---

## Cleanup

- Removed the TEMP `console.log("[ORCH-1148][TAP] …")` at the button `onPress` — restored to
  the clean `onPress={() => setIsReserveSheetOpen(true)}`.
- No other temp diagnostics existed in the **worktree** (the `[PROBE-TAP]`/`[SHEET-GATE]`
  logs lived only in the prior agent's throwaway temp copy at `/private/tmp/orch1148-run`,
  never in this branch).
- Verified: zero `console.log` referencing ORCH-1148 remain in prod code; the only remaining
  reference is the FIX comment block (documentation).

---

## Regression gate (fails-on-revert proven)

New strict-grep gate (mirrors the existing ORCH-1148 gate family style):
`.github/scripts/strict-grep/orch-1148-reserve-sheet-gate-mirrors-button.mjs`
— invariant **I-PROPOSED-1148-RESERVE-SHEET-GATE-MIRRORS-BUTTON**.

It statically asserts (comments stripped so the FIX comment can't trip it):
1. The "Reserve a table" BUTTON render gate references the reservable condition
   (`venueReservable?.reservable === true` + `brand_id !== null`) and does NOT reference
   `isNightOut`/`nightOut`.
2. The `<VenueReserveSheet>` render gate references the SAME reservable condition and does
   NOT reference `isNightOut`/`nightOut`.

Results:
- `--self-test` → **PASS** (4/4 matcher fixtures, incl. catching both the bad SHEET gate and a bad BUTTON gate).
- Live against the fixed file → **PASS** (exit 0).
- `ORCH1148_SIMULATE_REVERT=1` (re-injects `isNightOut && nightOut` into the sheet gate) → **FAIL** (exit 1) with the exact dead-tap diagnostic. **Fails-on-revert proven.**

Registered as a CI job in `.github/workflows/strict-grep-mingla-business.yml`
(self-test step + gate step), next to `orch-1148-booking-core-engine-and-money-seam`.

---

## Gates

- **TSC** (`app-mobile`): zero errors mention `ExpandedCardModal.tsx`. (Project has 416
  pre-existing unrelated TS errors; the change adds none — it only deletes two tokens from a JSX gate.)
- **ESLint** `src/components/ExpandedCardModal.tsx`: **0 errors**, 22 warnings — all pre-existing
  (unused imports / hook-deps elsewhere in the file), none near the edit or introduced by it.
- **New gate**: self-test PASS, live PASS, fails-on-revert FAIL (as designed).
- Sample app-mobile CI regression checks (`test:orch-0836`, `test:orch-0837`) still PASS.
  (app-mobile has no jest runner; its CI = node `scripts/ci/*.mjs` + the strict-grep family,
  which is exactly the idiom this gate follows.)

a11y/tokens intact (the button's `accessibilityRole`/`accessibilityLabel` and the sheet props
are unchanged).

---

## Files changed (commit scope)

- `app-mobile/src/components/ExpandedCardModal.tsx` — the fix + temp-diag removal.
- `.github/scripts/strict-grep/orch-1148-reserve-sheet-gate-mirrors-button.mjs` — new regression gate.
- `.github/workflows/strict-grep-mingla-business.yml` — register the gate job.
- `Mingla_Artifacts/evidence/ORCH-1148/*.png` — runtime evidence (sheet opens / restores / re-opens).

No deploy. No merge.
