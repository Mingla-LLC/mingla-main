# SPEC — ORCH-1163-R3 [rsvp-shared-body] · floating decision = fully self-sufficient + bar clearance

**Leg of:** META-ORCH-1166 (offering-page standardization), RSVP leg.
**Builds on:** ORCH-1163 (shared body) + R2 (floating-parity / z-layering).
**Surfaces:** consumer iOS/Android (`app-mobile`), business iOS/Android + buyer/anon web (`mingla-business`). Backend: none. Migration: none.

## Problem (Seth, 2026-06-20, on the R2 dev build)

1. **Scroll doesn't clear the floating bar.** The last section (§8 Where-you'll-be) scrolls *under* the floating Going/Maybe/Can't bar — the bottom content is occluded.
2. **The floating Going/Maybe/Can't buttons are dormant.** They do nothing (Going + Maybe are rendered *disabled* whenever `contactReady` is false; the contact form + per-guest +1 forms that would satisfy `contactReady` live ONLY in the inline §5 box, so from the floating bar there is no path forward).
3. **The floating bar must collect details itself.** Tapping a floating button must prompt the guest for their name/email/phone AND the +1s' name/email/phone — exactly like the inline §5 box — then proceed (Going → confirm dialog → success; Maybe/Can't → record). One decision owner, two entry points (inline box + floating bar), identical flow.

## Root cause (verified on origin/main R2)

- `RsvpMomentumDecision.tsx` `goingDisabled`/`maybeDisabled` include `!contactReady`. The floating bar (`RsvpOfferingFloatingBar`) passes the real `contactReady`, so for anon/web users (and any not-yet-filled state) Going+Maybe paint disabled. Only "Can't go" (not gated on contactReady) is live.
- The contact + +1 mini-forms are produced by `useRsvpOfferingState` as `contactForm`/`guestForms` and rendered ONLY inside `RsvpDecisionBox` (the inline §5 box / desktop sticky panel). The floating bar has no form host.
- Clearances were tuned for the event page's ~56px single button: consumer `reserveBarClearance = 177 + insets.bottom` (`ConsumerEventDetailScreen.tsx`), business/web `FLOATING_BAR_CLEARANCE = 96` (`PublicEventPage.tsx`). The RSVP bar is taller (3 glyph+label buttons ≈69px + a wrapping micro subcopy ≈24px ≈ **~93px**, variable) → under-reserved → occlusion.

## The fix — shell-agnostic, single owner (`packages/offering-rendering/RsvpOfferingBody.tsx`)

### A. Floating bar becomes self-sufficient via a details modal

Extend `useRsvpOfferingState`:

1. Add modal state: `detailsOpen: boolean`, `pendingDecision: "going" | "maybe" | "not_going" | null`.
2. Add **floating-entry handlers** (distinct from the inline `onGoingTap`/`onMaybe`/`onNotGoing`):
   - `onFloatingGoing()`: if `contactReady` → existing `onGoingTap()` (opens confirm dialog). Else → set `pendingDecision="going"`, `detailsOpen=true`.
   - `onFloatingMaybe()`: if `contactReady` → `submitDirect("maybe")`. Else → set `pendingDecision="maybe"`, `detailsOpen=true`.
   - `onFloatingNotGoing()`: if `isLoggedIn || contactReady` → `submitDirect("not_going")`. Else → set `pendingDecision="not_going"`, `detailsOpen=true`.
3. Build a `detailsModal` node (a portal `<Modal>` like `confirmDialog`/`successPopup`, gorhom-safe). Contents:
   - Title: "Add your details" / sub "We'll only use this to update you about this event."
   - Reuse the EXACT SAME `contactForm` node (already built — shares state, so values sync with the inline box).
   - Reuse `guestForms` ONLY when `pendingDecision !== "not_going"` (Can't-go needs no +1s).
   - `errorNode`.
   - A primary "Continue" button, disabled until `contactReady`. On press: close the modal, then dispatch the pending decision — `"going"` → open the confirm dialog (`setConfirmOpen(true)`); `"maybe"` → `submitDirect("maybe")`; `"not_going"` → `submitDirect("not_going")`. Clear `pendingDecision`.
   - A "Cancel"/close affordance that clears `detailsOpen` + `pendingDecision` (does NOT clear typed values).
4. Expose on `RsvpOfferingState`: `onFloatingGoing`, `onFloatingMaybe`, `onFloatingNotGoing`, `detailsModal`.
5. Render `{state.detailsModal}` in `RsvpOfferingBody` next to `{state.confirmDialog}{state.successPopup}` (body is always mounted, even when `hideDecisionBox` on desktop).

### B. Floating bar renders ENABLED buttons routed through the floating handlers

In `RsvpOfferingFloatingBar`, the `DecisionUnit` must:
- pass `contactReady={true}` (so Going/Maybe are NOT disabled into a dead end — readiness is enforced by the floating handlers, which open the details modal instead),
- wire `onGoing={state.onFloatingGoing}`, `onMaybe={state.onFloatingMaybe}`, `onNotGoing={state.onFloatingNotGoing}`.

Do this WITHOUT disturbing the inline `RsvpDecisionBox`, which keeps the real `contactReady` + the inline handlers (`onGoingTap`/`onMaybe`/`onNotGoing`) so the inline box behaves exactly as today. `DecisionUnit` needs an optional `contactReadyOverride?: boolean` + explicit `onGoing/onMaybe/onNotGoing` props, OR the floating bar passes a derived state object — keep the change minimal and typed; the resolved-state disabling (going/pending/waitlisted/maybe) MUST remain intact (those depend on `guestStatus`, not `contactReady`).

Guard: do NOT regress the inline box. The `orch-1163-rsvp-inline-box` + `orch-1157-rsvp-floating-dock` testID anchors stay.

### C. Clear the floating bar (per surface — measure, don't guess)

- **`FoundationRsvpPreview.tsx`** (business/web): add `onLayout` to the `floatWrap` → store measured bar height `h`. Compute the shell's `contentBottomInset = Math.max(props.contentBottomInset, h + 24 /*floatWrap bottom*/ + 16 /*gap*/ + safeAreaBottom)`. (Take the max so the adapter's value is a floor.)
- **`PublicEventPage.tsx`**: the RSVP branch may keep passing `FLOATING_BAR_CLEARANCE + insets.bottom` as the floor — the measured override in FoundationRsvpPreview does the real work. (If simpler, bump the RSVP-path floor to a dedicated `RSVP_FLOATING_BAR_CLEARANCE = 150`.)
- **`ConsumerEventDetailScreen.tsx`**: for the RSVP branch, measure the `nativeFloatWrap` height (the wrap already has `onLayout={handleDockLayout}` — extend it to store the RSVP bar height) and set the `BottomSheetScrollView` `contentContainerStyle.paddingBottom = floatBarBottom + measuredBarHeight + FLOAT_GAP` for `isRsvp`. Keep the event-branch `reserveBarClearance=177` path unchanged.

## Acceptance

- Anon web + business preview + logged-in consumer: tapping the floating **Going** with no details → details modal asks name/email/phone (+ +1 forms) → Continue → confirm dialog → success popup. **Maybe** → details modal → Continue → recorded as Maybe. **Can't go** → records (logged-in/ready) or details modal (anon) → recorded.
- When details ARE already filled (inline box or a prior modal), the floating buttons skip the modal and go straight to confirm/submit.
- No section is occluded by the floating bar at full scroll on any of the 5 surfaces (phone bar measured; desktop uses the sticky panel, no floating bar).
- Inline §5 box behavior unchanged. No second decision flow, no divergence (one state machine).
- Typecheck clean (`packages/offering-rendering`, `app-mobile`, `mingla-business`). All strict-grep gates green (esp. the RSVP canonical-order + no-checkout-affordance gates).

## Out of scope

Backend/RPC, QR/notify, the two carried follow-ups (web/business RPC read; consumer doors line). No new invariants beyond what R3 needs.
