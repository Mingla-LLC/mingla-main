# IMPLEMENTATION — ORCH-1138 [event-page] consumer EVENT reserve CTA float→dock

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[event-page]/` · branch `ORCH-1138-event-page`
**New HEAD:** `2116bcc83`
**Date:** 2026-06-15
**Status:** implemented and verified (sim-proven on iPhone 17 Pro). NOT deployed/merged/closed.

---

## 1. Summary

Seth (consumer device): the new consumer EVENT detail's "Get tickets" CTA "does
not FLOAT while scrolling" — it must behave like the trip's reserve CTA (compact
floating pill while scrolling → docks flush at the end).

**Root cause is NOT missing/broken float→dock code.** The consumer event float→dock
implementation already exists in this branch and is correct: `ConsumerEventReserveBar`
has both `docked` + `floating` variants, and `ConsumerEventDetailScreen` wires the
scroll/viewport/dock-layout swap exactly 1:1 with the shipped trip
(`ConsumerTripReserveBar` / `ConsumerTripDetailScreen`). It works at runtime — proven
on the sim (float pill at the top, docked bar at the end).

The reason Seth saw no float is **shipping state**: this float→dock event detail
(`ConsumerEventReserveBar` + `ConsumerEventDetailScreen`) is brand-new in this
UNMERGED ORCH-1138 branch (commit `f879d7590`). On `origin/main` — i.e. the build on
Seth's device — the deck event tap still routes through the legacy
`ExpandedBusinessEventSheet` (ExpandedCardModal.tsx:1742 on main), which has a
static, non-floating ticket CTA. The fix is therefore already present; what was
missing per the dispatch is a **regression assertion** locking the float→dock
behavior in. That is what this turn adds.

This turn made **zero product-code changes** (the implementation was already correct)
and added **one append-only regression test** + sim evidence.

---

## 2. Root cause (file:line — why it didn't float)

- `app-mobile/src/components/ExpandedCardModal.tsx` (the LIVE modal) — on
  `origin/main` the `businessEvent` branch returns `<ExpandedBusinessEventSheet>`
  (origin/main line 1742); in THIS branch it returns `<ConsumerEventDetailScreen>`
  (worktree line 1753). `ConsumerEventReserveBar.tsx` does **not exist on
  origin/main** (`git show origin/main:.../ConsumerEventReserveBar.tsx` → absent).
- Therefore the shipped consumer build renders events with the legacy EBES static
  CTA — no floating variant, no float→dock swap → "doesn't float." The corrected
  float→dock path ships only when this branch merges.

The in-branch float→dock implementation that IS correct:
- `app-mobile/src/components/offering/ConsumerEventReserveBar.tsx:54` —
  `variant: "docked" | "floating"`; docked branch at `:169`, floating compact-pill
  branch (`floatBody`) at `:185`.
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:511-541` —
  `floatingPillVisible` predicate + `dockedReserve`/`floatingReserve`; docked mounted
  as last scroll child (`:827`), floating overlay sibling (`:846`); scroll/viewport
  tracking via `onScroll`/`onLayout`/`onDockLayout` (`:580-582`, `:201-212`).

---

## 3. The fix (matching the trip mechanism)

No code fix was required — the mechanism already mirrors the trip exactly:
- floating = compact self-width label-only pill (`floatButton`, `alignSelf:"center"`,
  no kicker/price/full-width bar), shown while the docked button is off-screen;
- docked = full-width priced bar (`ctaBody` with `rKicker`+`rPrice`+`rCta`) as the
  LAST in-flow scroll child, padding its own safe-area bottom (above the home
  indicator), reporting `onDockLayout`;
- swap = `floatingPillVisible = dockTopY === null || viewportH === 0 ? true :
  dockTopY > scrollY + viewportH - REVEAL_MARGIN` (REVEAL_MARGIN=24), identical to
  the trip; floating overlay is an absolute sibling, NOT `stickyFooter` (ORCH-1016/
  1043 scroll-freeze guard);
- single CTA (no split "Pay over time" — events have no installment plan).

The deliverable change is the **regression assertion** that locks this in.

---

## 4. Files changed

| File | Δ | Purpose |
|---|---|---|
| `app-mobile/src/screens/Event/__tests__/orch_1138_event_reserve_float_dock.test.ts` | +231 (new) | Regression: event CTA has a floating variant + float→dock swap like trip |

No product-code files changed (`git status` clean except the test; `git diff` on
`ConsumerEventReserveBar.tsx` empty after the fails-on-revert restore).

---

## 5. SPEC success-criteria coverage

| SC | Requirement | Result | Evidence |
|---|---|---|---|
| SC-1 | Event CTA floats while scrolling (compact pill) | ✓ | sim `orch-1138-event-cta-FLOATING-top.png` — "Get tickets" pill at top |
| SC-2 | Docks flush at end, above home indicator, no black gap | ✓ | sim `orch-1138-event-cta-DOCKED-bottom.png` — full-width "$700 / Buy ticket →" bar at end |
| SC-3 | Float pill hides once docked button is on-screen | ✓ | DOCKED screenshot shows NO floating pill (predicate verified, P4) |
| SC-4 | Sheet still scrolls (no ORCH-1016/1043 freeze) + swipe-dismiss | ✓ | sim scroll top→end worked; E5 asserts no stickyFooter |
| SC-5 | Single CTA, no split plan; routes to cart with selected tier | ✓ | E3c (no splitCtas); `openCart` seeds selected/first sellable tier (unchanged) |
| SC-6 | Regression assertion w/ fails-on-revert | ✓ | 26 assertions; fails-on-revert @ `2116bcc83` (true line-deletion of floatBody → E1b FAIL) |

---

## 6. Regression tests added

- Path: `app-mobile/src/screens/Event/__tests__/orch_1138_event_reserve_float_dock.test.ts`
- 26 assertions, all passing:
  `26 assertions passed (ORCH-1138 EVENT reserve float→dock).`
- **fails-on-revert verified at `2116bcc83`** by TRUE LINE-DELETION (not comment-out):
  deleted the `floatBody` const+render block (lines 185–219 of
  `ConsumerEventReserveBar.tsx`) → test FAILED at
  `E1b the reserve bar renders the FLOATING compact pill branch`; restored the block
  → 26/26 PASS again, component diff empty.
- Append-only: new file; no existing test modified/deleted. Sibling tests still green
  (event foundation 29/29; trip float-dock 19/19).

---

## 7. Old → New receipt

### app-mobile/src/screens/Event/__tests__/orch_1138_event_reserve_float_dock.test.ts (NEW)
**Before:** no regression locked the event CTA's float→dock; a revert to a
docked-only/static CTA (the pre-fix behavior Seth reported) would pass CI silently.
**Now:** node:assert source-assertions + a behavioral replica of `floatingPillVisible`
fail on a true line-deletion of the floating variant render OR the screen's swap
wiring. Mirrors the trip's `orch_1138_reserve_float_dock.test.ts`.
**Why:** dispatch HARD GUARD — "Add/extend a regression assertion (event CTA has a
floating variant + float→dock swap like trip) with fails-on-revert."
**Lines:** +231.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | Yes (when merged) | Event detail CTA float→dock (sim-proven) |
| Consumer Android | Yes (when merged) | Shared RN code; Android opaque-glass already honored in the bar (`Platform.select` elevation 0) |
| Buyer/anon Web | No | Consumer-only screen |
| Business iOS/Android | No | mingla-business untouched |
| Admin Web | No | — |
| Business Web preview | No | — |

Parity is automatic (single shared RN component + screen). This turn added only a
test — no runtime change.

---

## 9. Smoke result (iOS sim — iPhone 17 Pro, iOS 26.4)

- Built/served the consumer app (`com.mingla.app.v2`, runtime 1.1.0) via Metro on
  isolated port 8084 from a **bracket-free** worktree (`orch1138_sim`, identical
  event source to HEAD) using the prior-attempt doubled-path serverRoot workaround
  (`/private/tmp/orch1138-metroroot` with a `mingla-main` symlink); watchman disabled
  to avoid the symlink-loop crash; `Users`→`/Users` symlink in the metroroot to fix
  lazy-import (font/onesignal) resolution toasts.
- OAuth is impractical on the sim, so a **sim-only DIAG seed** (scoped
  `[ORCH-1138-DIAG]`, in the throwaway `orch1138_sim` worktree ONLY — never the
  deliverable) deep-linked `/e/leggothis/orch-0892-a-sc3-test-event` (a real
  scheduled event, 2 tickets — `publicEventTickets … dataType="Array(2)"`).
- Observed: at the TOP, the compact floating "Get tickets →" pill (label-only, no
  price block, self-width); scrolling down the docked full-width bar
  ("All-in, taxes included / $700 / Buy ticket →") emerges and the floating pill
  disappears at the end. Sheet scrolled top→end with no freeze.
- Screenshots (in `Mingla_Artifacts/evidence/ORCH-1138-event/`, gitignored):
  - `orch-1138-event-cta-FLOATING-top.png` (float)
  - `orch-1138-event-cta-DOCKED-bottom.png` (dock)
  - `orch-1138-event-cta-transition-mid.png` (transition)

---

## 10. Known issues / deferred

- The fix ships only on merge of this branch. Until then, Seth's device keeps the
  legacy EBES static CTA (expected). No OTA/merge done here (out of scope).
- The DIAG seed + sim metro.config live ONLY in the `orch1138_sim` throwaway
  worktree; the deliverable worktree has zero DIAG references (verified by grep).

---

## 11. Operator action required

- None for migrations/edge (none touched).
- To put float→dock on Seth's device: route this branch through REVIEW → tester →
  merge → OTA (orchestrator/operator-owned). No `db push`, no edge deploy.

---

## 12. Discoveries for Orchestrator

- The "bug" was a shipping-state perception: the correct float→dock event detail is
  unmerged. Recommend prioritizing the ORCH-1138 [event-page] merge so Seth's device
  picks up the consumer event redesign (currently still on legacy EBES on main).
- COMMS ledger on entry: no OPEN BLOCK rows; OPEN WARN rows (COMMS-0028 GIPHY,
  render-loop, etc.) are unrelated to the event reserve bar — read, none actioned.
