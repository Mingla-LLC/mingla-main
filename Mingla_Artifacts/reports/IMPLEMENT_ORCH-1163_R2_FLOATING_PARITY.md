# IMPLEMENT — ORCH-1163-R2 [rsvp-shared-body / floating-parity]

**Branch:** `ORCH-1163-r2-rsvp-floating-parity` (off latest main `e4bb8e7ba`)
**Scope:** UI-only. Make the public RSVP page STRUCTURALLY IDENTICAL to the standard
event page. No schema / RPC / edge / migration changes. No merge/deploy/OTA.

---

## Proven root cause (from the dispatch)

The RSVP page rendered Going/Maybe/Can't via the ORCH-1157 momentum **dock**
(`RsvpOfferingDecisionDock` → `RsvpMomentumDecision`) inside a `styles.floatingDock`
wrapper that was `position:absolute; bottom:0` with **NO zIndex**. The event page
instead pins a clean `EventOfferingFloatingBar` via a `floatWrap` with **`zIndex:6`**
as a sibling of `ParallaxCoverShell`. Because the web `ParallaxCoverShell` establishes
a stacking context where the scrolling body is `position:relative; zIndex:CONTENT_Z(2)`,
an un-z-indexed absolute overlay (effective z=0) loses to the body on web (paints
UNDER) while business-native painted it ON TOP — the inconsistent layering. The inline
§5 decision and the floating dock were also separate instances, unlike the event page's
single-owner `EventTicketBox`.

---

## The three changes (event-page parity, across all 3 surfaces)

### 1. FLOATING BAR — zIndex:6 parity (fixes the layering on web + business)
- `packages/offering-rendering/RsvpOfferingBody.tsx`: added
  **`RsvpOfferingFloatingBar`** (parallel to `EventOfferingFloatingBar`) — renders the
  shared `DecisionUnit` (`showMomentum={false}`), i.e. the Going / Maybe / Can't
  controls as a floating segmented bar (all three shown together). The decision LOGIC
  stays in `RsvpMomentumDecision` (single owner — reused, not forked).
  `RsvpOfferingDecisionDock` is retained as a **back-compat alias** of the floating bar.
- `mingla-business/src/components/event/FoundationRsvpPreview.tsx`: replaced the
  old `floatingDock` (bottom:0, no zIndex, full-width panel chrome) with the
  event-identical **`floatWrap`** style: `{ position:absolute, left:16, right:16,
  bottom:24, zIndex:6 }`, rendered as a SIBLING of `ParallaxCoverShell`. This is the
  load-bearing fix on BOTH web + business.
- consumer `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`: the RSVP
  branch now pins `RsvpOfferingFloatingBar` in the SAME `styles.nativeFloatWrap`
  (`zIndex:60`, `bottom: floatBarBottom`) the standard event branch uses — removed the
  bespoke `rsvpStyles.dock` panel so the wrapper is byte-identical to the event branch.

### 2. SINGLE-OWNER INLINE BOX — `RsvpDecisionBox` (parallel to `EventTicketBox`)
- Extracted the inline §5 decision into **`RsvpDecisionBox`** (contact form +
  per-guest plus-one mini-forms + the shared `DecisionUnit` w/ momentum + error node).
  Rendered inline on phone AND in the desktop sticky panel — the SAME instance pattern
  as `EventTicketBox`. Added **`hideDecisionBox`** to the body (parallel to
  `hideTicketBox`) so the inline box collapses on desktop.
- The inline box + the floating bar read ONE lifted decision state
  (`useRsvpOfferingState`) — the dual-instance split is eliminated (mirrors how the
  event page lifts `ticketQuantities` / `onProceedToCart`).
- `FoundationRsvpPreview` now renders `RsvpDecisionBox` in the desktop sticky panel
  (in a `deskPanel`/`deskAccent`/`deskInner` frame mirroring the event page's
  `EventTicketBox` sticky panel) and passes `hideDecisionBox={isDesktop}` to the body.

### 3. IDENTICAL SHELL / SCROLL / INSET
- `mingla-business/src/components/event/PublicEventPage.tsx`: the RSVP branch's
  `contentBottomInset` is now `isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom`
  — BYTE-IDENTICAL to the standard event body (replaces the bespoke
  `insets.bottom + spacing.xxl` runway; removed the now-unused `spacing` import).
- consumer: the RSVP + event branches already share the one gorhom scroll host with
  `reserveBarClearance = 177 + insets.bottom` and the `nativeFloatWrap` z-order
  (`COVER_Z 1 < CONTENT_Z 2 < CHROME_Z 70`); the RSVP float now uses the same wrapper.
- `FoundationRsvpPreview` keeps `ParallaxCoverShell` (shell-agnostic body unchanged).

---

## Changed files
- `packages/offering-rendering/RsvpOfferingBody.tsx` — `RsvpDecisionBox` +
  `RsvpOfferingFloatingBar` exports; `hideDecisionBox` prop; dock→bar alias.
- `packages/offering-rendering/index.ts` — barrel exports the 2 new symbols
  (kept `RsvpOfferingDecisionDock` / `useRsvpOfferingState` for the gates).
- `mingla-business/src/components/event/FoundationRsvpPreview.tsx` — event-style
  `floatWrap` (zIndex:6) + desktop sticky `RsvpDecisionBox` panel.
- `mingla-business/src/components/event/PublicEventPage.tsx` — RSVP
  `contentBottomInset` parity; removed unused `spacing` import.
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` — RSVP float uses
  `RsvpOfferingFloatingBar` in `nativeFloatWrap`; removed `rsvpStyles.dock`.
- `packages/offering-rendering/__tests__/orch_1163_r2_floating_parity.test.ts` — NEW
  regression (6 tests, fails-on-revert).
- `packages/offering-rendering/__tests__/orch_1157_round2_rsvp_fixes.test.ts` — ONE
  assertion retargeted dock→floating-bar literal, tagged `[TEST-MOD-APPROVED ORCH-1163]`.

---

## Hard guards preserved
- All RSVP behavior intact: Going-confirm dialog → success popup, per-guest plus-ones,
  per-guest QR/email/push, Calendar card, `resolveRsvpCta`, `RsvpMomentumDecision`
  going-count/capacity/momentum visuals (now live INSIDE `RsvpDecisionBox` /
  floating bar). `RsvpMomentumDecision` remains the SINGLE owner of the decision logic.
- No standard-event/trip/experience changes.
- Body stays shell-agnostic (no `ParallaxCoverShell` import/render).
- Append-only tests: 1 new file ADDED; 1 existing assertion modified WITH the
  `[TEST-MOD-APPROVED ORCH-1163]` token (the consumer floating control was renamed
  dock→bar — same aliased component, no behavior change).

---

## Gate / test results

### 7 ORCH-1163 gates — ALL PASS
`one-shared-body`, `shell-agnostic`, `one-read-path`, `going-confirm`,
`plus-one-per-guest`, `going-calendar-qr`, `guest-notify-match` — all PASS.

### I-MOR-0827 + related gates — PASS
- `meta-orch-0827-package-isolation.mjs` — PASS
- `orch-1138-mor-isolation.mjs` — PASS
- `i-proposed-1137-biz-web-lucide-real.mjs` — PASS

### Deno source-contract tests
- NEW `orch_1163_r2_floating_parity.test.ts` — 6/6 PASS (fails-on-revert PROVEN:
  flipping the RSVP `floatWrap` zIndex 6→0 failed §1; restored → green).
- `orch_1163_rsvp_shared_body.test.ts` — 8/8 PASS (NO modification needed).
- RSVP/event source-contract suite (1157 round2/6/7/momentum, 1159, 1163×2) —
  61/61 PASS.

### Typecheck
- `packages/offering-rendering` (own tsconfig) — **0 errors** (clean).
- `mingla-business tsc` — the +5 "new" entries vs baseline are all spurious
  implicit-any downstream of a PRE-EXISTING `Cannot find module 'react'` reach-in
  (the business tsc resolves package sources without the package's React types; same
  artifact at a shifted line on baseline). No real type error in any changed file.

### Jest (mingla-business)
- `RsvpPublicBody.maybeCta.orch1150r2` — PASS
- `PublicEventPage.closeButton.test.tsx` — PASS
- 3 suites FAIL identically on baseline (`PublicEventPage.closeButton.adversarial`,
  `orch_1138_event_foundation`, `brand/PublicEventPage.orch_0964`) — their custom
  `customRequire` dependency mocks predate the ORCH-1163 leg-2 `FoundationRsvpPreview`
  import and throw "Unexpected dependency". PRE-EXISTING; not introduced by R2.

### Not run (build-heavy, low risk)
- `orch-1083-initial-bundle-budget.mjs` (needs a full web export). R2 adds no new
  heavy imports — the new components reuse `RsvpMomentumDecision` + RN primitives — so
  the `__common` budget is unaffected.

---

## Confirmation
- ✅ The RSVP floating bar is **zIndex:6** on web + business (`FoundationRsvpPreview`
  `floatWrap`), byte-equal to the event page's `floatWrap` — the on-top/under
  layering is fixed on BOTH surfaces.
- ✅ The inline decision box is **single-owner** (`RsvpDecisionBox`, rendered inline
  on phone AND in the desktop sticky panel; `hideDecisionBox` collapses the inline
  instance on desktop). Inline box + floating bar share ONE `useRsvpOfferingState`.
- ✅ The shell / scroll / inset match the event page: `FLOATING_BAR_CLEARANCE +
  insets.bottom` on phone, 0 on desktop; same `ParallaxCoverShell` usage; same
  `COVER_Z < CONTENT_Z < CHROME_Z` contract on all three surfaces.

**Blockers:** none.
