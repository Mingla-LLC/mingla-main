# IMPLEMENT — ORCH-1167-R2 [event-page-canonical] — Layout polish (UI-only)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-r2-layout-polish`.
**Scope:** UI-only revisions to the canonical standard-event public page (`EventOfferingBody` + per-surface shells). NO schema / RPC / migration / pricing-engine / package-config change.
**Companion:** `SPEC_ORCH-1167_EVENT_PAGE_CANONICAL_STRUCTURE.md` (the merged Leg-1 contract).

---

## 1. Summary

Six Seth-directed UI revisions to the already-shipped ORCH-1167 standard-event page, all landing in the ONE shared shell-agnostic body (`packages/offering-rendering/EventOfferingBody.tsx`) + its three surface shells so they hit buyer-web + business iOS/Android + consumer iOS/Android at once:

1. Removed the duplicate date/time **eyebrow** above the event title (date now appears once, as the meta chip).
2. Removed the **venue/city pill** from the meta row (venue name + address stay in "Where you'll be").
3. **Compacted** the date-chip + pills band into one tight even-gapped flex-wrap strip (less vertical whitespace).
4. **Restored** the persistent floating "Get tickets" bar — it was regressing (anchored to the body top, it vanished right after the cover). It is now PERSISTENT on phone/native, reflects the live Σ all-in total, and taps through to the same cart step (i) as the in-box Proceed (both coexist). ORCH-1159 web close-X preserved.
5. **Desktop web two-column**: on web ≥ DESKTOP_BREAKPOINT the ticket box moves into the STICKY right panel (the extracted shared `EventTicketBox`) while the primary content stays in the left column. Phones + both native apps stay single-column. ONE shared shell-agnostic body, responsive via the existing offering-rendering primitives — no forked desktop component, no scroll-root added.
6. **Bottom inset**: the scroll content now reserves clearance (floating-bar height + device safe-area) so the last section fully clears the bottom on every surface.

## 2. SPEC success-criteria coverage (R2 deltas)

| Change | Status | Where | Commit |
|--------|--------|-------|--------|
| 1 — remove date eyebrow | ✓ | `EventOfferingBody` section (2) | <hash> |
| 2 — remove venue pill | ✓ | `EventOfferingBody` section (3) meta row | <hash> |
| 3 — compact pills band | ✓ | `EventOfferingBody` styles `metaRow`/`pillsRow`/`pill` | <hash> |
| 4 — persistent floating bar | ✓ | `PublicEventPage` + `ConsumerEventDetailScreen` (`floatingPillVisible = true`) | <hash> |
| 5 — desktop 2-col sticky box | ✓ | `EventOfferingBody` (`hideTicketBox` + `EventTicketBox`), `FoundationEventPreview`, `PublicEventPage` (`stickyPanel`) | <hash> |
| 6 — bottom inset clears bar | ✓ | `PublicEventPage` (`FLOATING_BAR_CLEARANCE + insets.bottom`), `ConsumerEventDetailScreen` (`reserveBarClearance = 72 + insets.bottom`) | <hash> |

Existing SC-1..SC-9 preserved: 9-section order, all-in WYSIWYP, CTA states, shell-agnostic scroll, one-read-RPC, city-level map privacy, ORCH-1159 close-X — all 5 strict-grep gates PASS + the existing totals test PASS.

## 3. Files changed

- `packages/offering-rendering/EventOfferingBody.tsx` (+371/−201 net region) — removed body eyebrow; removed city MetaChip from the meta row; compacted band styles; extracted the inline box into the new exported `EventTicketBox`; added `hideTicketBox` + `onTicketBoxLayout` props (box measures float→dock, desktop relocation).
- `packages/offering-rendering/index.ts` (+16/−2) — additive exports of `EventTicketBox` + `EventTicketBoxProps`.
- `mingla-business/src/components/event/PublicEventPage.tsx` (+/−93) — persistent floating bar; desktop sticky panel hosting `EventTicketBox`; `hideTicketBox={isDesktop}`; `contentBottomInset` clearance; retired the dead float→dock scroll/dock state.
- `mingla-business/src/components/event/FoundationEventPreview.tsx` (+/−57) — body now feeds `onTicketBoxLayout` + `hideTicketBox`; no longer wraps the whole body in the dock-measure View.
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (+/−44) — persistent floating bar; `onTicketBoxLayout` on the body (not a body-top wrapper); `reserveBarClearance` now clears the bar + safe-area; retired dead float→dock state.
- `packages/offering-rendering/__tests__/orch_1167_r2_layout_polish.test.ts` (new) — R2 regression (6 assertions).

## 4. Data-model changes applied

NONE. UI-only — no migration, no RPC, no view, no RLS change.

## 5. Edge functions touched

NONE.

## 6. Regression tests added

- `packages/offering-rendering/__tests__/orch_1167_r2_layout_polish.test.ts` — 6 source-structural assertions (one per change). Run: `cd mingla-business && npx jest --roots=../packages --testPathPattern="orch_1167_r2_layout_polish"` → 6/6 PASS.
- **fails-on-revert verified** (TRUE line deletion):
  - Change 4: replacing `const floatingPillVisible = true;` with a scroll predicate in `PublicEventPage` → "floating bar persistent" assertion FAILS; restore → PASS.
  - Change 2: re-adding the `cityCountry` MetaChip to the meta row → "no venue/city pill" assertion FAILS; restore → PASS.
- Existing `orch_1167_event_box_totals.test.ts` (4) + business `orch_1167_cart_seed.adversarial.test.ts` (10) still PASS.

## 7. Old → New receipts

### EventOfferingBody.tsx
**Before:** lead block rendered an accent date eyebrow above the title; the meta row rendered date + subline + a city/venue chip; the inline ticket box was rendered inline-only with the box math computed in the body; no desktop relocation; float→dock measured the whole body.
**Now:** lead block renders the title only; the meta row renders date + subline (no city pill); the box is the extracted shared `EventTicketBox` (inline on phone/native, relocatable to the desktop sticky panel via `hideTicketBox`); `onTicketBoxLayout` measures the box itself; the date+pills band is tightened.
**Why:** changes 1, 2, 3, 5 + the change-4 anchor fix.
**Lines:** ~+170/−170 (net region 371/201 incl. the box extraction move).

### PublicEventPage.tsx (web/business adapter)
**Before:** `floatingPillVisible` hid the bar once the body top passed; `stickyPanel = null` (box always inline); no `contentBottomInset` passed.
**Now:** floating bar persistent on phone (`!isDesktop`); desktop sticky panel hosts `EventTicketBox`; `hideTicketBox={isDesktop}`; `contentBottomInset = isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom`.
**Why:** changes 4, 5, 6.
**Lines:** ~+50/−40.

### FoundationEventPreview.tsx
**Before:** wrapped the whole `EventOfferingBody` in `<View onLayout={onDockLayout}>` (body-top measure); no `hideTicketBox`.
**Now:** forwards `onTicketBoxLayout={onDockLayout}` (box measure) + `hideTicketBox`; no body-top wrapper.
**Why:** changes 4, 5.
**Lines:** ~+25/−15.

### ConsumerEventDetailScreen.tsx
**Before:** float→dock hid the bar after the cover; body wrapped in a body-top `onLayout`; `reserveBarClearance = 8`.
**Now:** persistent floating bar; `onTicketBoxLayout` on the body; `reserveBarClearance = 72 + insets.bottom`.
**Why:** changes 4, 6.
**Lines:** ~+20/−24.

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | YES — persistent bar + bottom inset (single-column) | shared body |
| 2 | Consumer Android | YES — same | shared body |
| 3 | Buyer/anon Web | YES — desktop 2-col sticky box + persistent bar (phone web) + bottom inset | shared body |
| 4 | Business iOS | YES — persistent bar + bottom inset (single-column) | shared body |
| 5 | Business Android | YES — same | shared body |
| 6 | Admin Web | NO — no public event page | n/a |
| 7 | Business Web preview (`/event/[id]/preview`) | NO — separate `PreviewEventView` (OQ-3 deferred) | n/a |

All 5 primary surfaces get parity automatically via the one shared body; desktop two-column applies only to web (the responsive hook reports `isDesktop=false` on native).

## 9. Smoke result

No simulator/device run this turn (UI-only structural change). Verified via: all 5 ORCH-1167 strict-grep gates PASS (+ self-tests PASS), package isolation gates PASS, 10/10 package + 10/10 business ORCH-1167 jest PASS, business + consumer tsc clean on the touched app-layer files. Device/sim verification (parallax scroll on consumer gorhom sheet, desktop two-column at ≥1024px, persistent-bar clearance on a notched device) is for the tester.

## 10. Known issues / deferred

- The `EventTicketBox` desktop sticky panel shows the box only (brand "Presented by" stays in the left column, section 6) — matches the task's "ticket box / reserve panel as a sticky panel"; not a regression.
- No `[TRANSITIONAL]` code added.
- OQ-3 (`/event/[id]/preview` reconcile) remains deferred (unchanged from Leg 1).

## 11. Operator action required

- NONE for DB/edge (UI-only).
- Route to mingla-tester for the 5 primary surfaces (esp. consumer gorhom scroll + desktop ≥1024px two-column + notched-device bottom clearance). Then orchestrator REVIEW/CLOSE. Do NOT deploy/merge/OTA from this worktree.

## 12. Discoveries for Orchestrator

- 17 repo-wide strict-grep gates fail on this worktree's base (origin/main) — ALL pre-existing and UNRELATED to the touched files (verified none name `EventOfferingBody`/`PublicEventPage`/`FoundationEventPreview`/`ConsumerEventDetailScreen`); e.g. `i-proposed-tr2-safearea`, `orch-0769-app-wide-currency` (flags `app/rsvp/[id]/preview.tsx:112 currency:"GBP"`), `i-proposed-x-web-deprecation` (needs a stderr log file). Flagging for separate triage; not introduced here.
- COMMS-0040 (RSVP page standardization, WARN) + COMMS-0041 (experience page, WARN) acknowledged: my edits touch ONLY the standard-event (`event_type='event'`) path of `ConsumerEventDetailScreen` + the shared `EventOfferingBody`/offering-rendering exports — NOT `RsvpPublicBody`, NOT the RSVP branch, NOT any experience body. No conflict with the imminent `RsvpPublicBody`→`packages/` move.
