# IMPLEMENT — ORCH-1168 [event-deadcode-cleanup]

**Date:** 2026-06-19
**Branch:** `ORCH-1168-event-deadcode-cleanup` (off `origin/main` @ `48a82b1e4`)
**Scope:** UI / dead-code + stale-test cleanup ONLY. No product behavior change. Standard-event public page is byte-identical.

---

## What ORCH-1167 orphaned

ORCH-1167 (canonical standard-event public page) re-architected the business-app event
adapter `mingla-business/src/components/event/PublicEventPage.tsx` onto the SHARED
`@mingla/offering-rendering` primitives — `EventTicketBox` (desktop sticky panel + inline
box) and `EventOfferingFloatingBar` (phone float/dock CTA), both driven off the SAME
`resolveOfferingCta` (one owner). The once-local `EventReserveBar.tsx` (an ORCH-1138 Leg-2
component) was superseded and lost its only importer — pure dead code. Two ORCH-1138 tests
plus one adapter comment still referenced it.

ORCH-1167 ALSO retired the `FoundationEventPreview` tier radiogroup (`FoundationTierRow`),
the inline `dockedReserve` prop, and changed checkout routing from `checkoutPublicPath` to
the cart-seeded `checkoutPublicPathWithSeed` — which left the SAME ORCH-1138 foundation
test red at T1c / T3b / T15a on `origin/main`, independent of EventReserveBar. Those
orphaned-by-1167 assertions are repaired here so the test reflects post-1167 reality.

---

## Changes (4 files, all in `mingla-business/src/components/event/`)

1. **DELETED** `mingla-business/src/components/event/EventReserveBar.tsx` — 90-line dead
   component, zero production importers (grep-verified before delete; `tsc` confirms no
   broken `Cannot find module './EventReserveBar'` importer).

2. **`PublicEventPage.tsx`** — comment-only edits (no code change):
   - Header line ~18: "float/dock EventReserveBar" → desktop sticky panel = `EventTicketBox`
     + float/dock = `EventOfferingFloatingBar`, both from `@mingla/offering-rendering`
     (ORCH-1167), off the same `resolveOfferingCta`.
   - Header line ~24: checkout note `checkoutPublicPath(event.id)` →
     `checkoutPublicPathWithSeed(event.id, …)` (ORCH-1167 cart seed; same public target,
     N7 preserved).

3. **`__tests__/orch_1138_event_foundation.test.ts`** — `[TEST-MOD-APPROVED ORCH-1168]`:
   - Removed `reserveBarSrc` read + `reserveBar` strip (file is gone).
   - **OQ-1b block rewritten** to post-1167 truth: T-OQ1 now asserts the adapter drives
     the float/dock CTA via the shared `EventOfferingFloatingBar`; **T-OQ1c** asserts the
     adapter NO LONGER imports `./EventReserveBar`; **new T-OQ1c2** asserts the
     `EventReserveBar.tsx` file is removed (dead-code guard, fails-on-revert proven);
     T-OQ1d asserts `resolveOfferingCta` one-owner. T-OQ1b (no `TripReserveBar`) kept.
   - Repaired 3 OTHER assertions orphaned by ORCH-1167 (so the file runs green):
     - **T1c**: retired `FoundationTierRow`/`radiogroup` → now asserts the FOUNDATION body
       drives the shared selectable ticket box via `ticketQuantities` +
       `onChangeTicketQuantity`.
     - **T3b**: retired `dockedReserve=` prop → now asserts `onProceedToCart={handleProceedToCart}`.
     - **T15a**: `checkoutPublicPath(event.id)` → `checkoutPublicPathWithSeed(event.id…)`
       (same public checkout, keyed by the SAME event.id — N7 intent preserved).
   - All still-valid ORCH-1138 assertions (T1a/T1b/T1d, T17a–c, T3/T3c, T15b/T15c, T18/T18b)
     untouched.

4. **`__tests__/PublicEventPage.closeButton.adversarial.test.tsx`** —
   `[TEST-MOD-APPROVED ORCH-1168]`: removed the dead
   `case "./EventReserveBar": return { EventReserveBar: "EventReserveBar" }` mock case +
   updated its stale "the NEW EventReserveBar" comment.

---

## Grep — zero remaining CODE references to EventReserveBar

Repo-wide grep (excl. `node_modules`, `Mingla_Artifacts/` docs, and the DIFFERENT live
`ConsumerEventReserveBar`): the only remaining hits are the NEW dead-code guard assertions
in `orch_1138_event_foundation.test.ts` (which assert the file/import is GONE) and one
descriptive comment in the adversarial test. No production code imports it; no executable
path references the deleted module. `ConsumerEventReserveBar` (experience pages) NOT touched.

---

## Verification

| Check | Result |
|---|---|
| `orch_1138_event_foundation.test.ts` via node (canonical runner per its header) | **30/30 PASS** |
| Fails-on-revert: re-create `EventReserveBar.tsx` → T-OQ1c2 | **FAILS as designed**, restore → PASS |
| `orch_1167_cart_seed.adversarial.test.ts` (business jest) | **10/10 PASS** |
| I-MOR-0827 package-isolation gate | **PASS** |
| ORCH-1138 MOR isolation gate | **PASS** |
| ORCH-0978 video gates (4) | **4/4 PASS** |
| `tsc --noEmit` — errors in my 4 changed files | **NONE** (no broken EventReserveBar importer) |

### Untouched gates (my diff = 4 files, all in `mingla-business/src/components/event/`)
The 5 I-PROPOSED-1167 invariants are enforced by `packages/offering-rendering/__tests__/orch_1167_*`
tests + the `pg_public_event_by_slug` migration — **physically untouched by this diff** (zero
offering-rendering / event-rendering / migration changes), so their pass/fail state is
identical to base.

### Pre-existing conditions (NOT introduced by ORCH-1168, NOT in scope)
- `PublicEventPage.closeButton.adversarial.test.tsx` was **already red on `origin/main`**
  (its own header, lines ~290–291, documents this from before ORCH-1117). It now fails at
  the unmocked `./RsvpPublicBody` dep (added by ORCH-1150/1157/1167) — the SAME failure
  point as before my edit. Removing the dead `./EventReserveBar` mock case did not change
  the failure point and surfaced no `EventReserveBar` error. Making it green requires
  mocking ORCH-1150/1167 deps (`./RsvpPublicBody` et al.) — that is ORCH-1150/1167 cleanup,
  out of the ORCH-1168 EventReserveBar dead-code charter.
- `tsc --noEmit` has pre-existing repo errors (`@testing-library/react-native` render-config
  deps, marketing ComposerV2, IconChrome, Sheet.web, search adapters, `@mingla/payments-native`,
  DraftEvent shape) — all in files this diff never touches.

---

## Guards honored
- `ConsumerEventReserveBar`, `EventOfferingFloatingBar`, `EventOfferingBody`, all
  RSVP/trip/experience code: NOT touched.
- Standard-event behavior byte-identical (deletion of dead code + stale tests + comments only).
- 5 I-PROPOSED-1167 gates + ORCH-0978 gate + I-MOR-0827: preserved (untouched / verified PASS).
