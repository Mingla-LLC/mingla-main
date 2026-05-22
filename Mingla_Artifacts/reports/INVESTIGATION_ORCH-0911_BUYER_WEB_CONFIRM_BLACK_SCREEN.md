# INVESTIGATION — ORCH-0911 [Buyer-web checkout confirm screen renders black on `?cs=…` arrival]

**ORCH:** ORCH-0911
**Mode:** INVESTIGATE
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-22
**Confidence:** PROVEN (six-field evidence on both root causes; operator-witnessed live repro; DB probe confirmed event_type)
**Affected Surfaces:** buyer-anon-web only (`mingla-business/app/checkout/[eventId]/confirm.tsx` + `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` + `supabase/functions/ticket-checkout-create/index.ts`).

---

## Symptom Summary

**Expected:** buyer completes Stripe-hosted Checkout, Stripe redirects to a confirmation screen that shows order summary + QR tickets + "Back to event/trip" CTA, OR a calm "Confirming your tickets…" hero while the order finalizes server-side.

**Actual:** screen renders as a pure black box (`#0c0e12`) with NO spinner, NO hero, NO CTA, NO error message. Operator screenshot 2026-05-22 confirms full-screen black on iPhone Safari. URL: `https://business.usemingla.com/checkout/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_a1TtZ3kQ4q8FNuLIEIz6aBLdhoJIcWyzw9Tmv5qnUAefvknIaxk5J6NSk3`.

**Reproduces:** every web buyer who completes Stripe-hosted Checkout for a TRIP (event_type='trip') — always permanent black. Web event (event_type='event') buyers — black during the initial mount window (transient race), recoverable on success but not visually communicated.

---

## Investigation Manifest (files read, in order)

1. `mingla-business/app/checkout/[eventId]/confirm.tsx` — event-side confirm screen (operator's URL)
2. `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` — trip-side confirm screen (parity audit)
3. `mingla-business/app/checkout/[eventId]/_layout.tsx` — checkout route group wrapper
4. `mingla-business/app/checkout/[eventId]/payment.tsx` — where resume payload is written before Stripe redirect
5. `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — trip-side parity (same `createTicketCheckout`)
6. `mingla-business/src/components/checkout/checkoutPersistence.ts` — sessionStorage read/write helpers
7. `mingla-business/src/hooks/usePublicEvents.ts` — `usePublicEventById` query hook
8. `mingla-business/src/services/publicEventsService.ts:608-633` — `getPublicEventById` — **trip-row rejection probe found at line 620-622**
9. `supabase/functions/ticket-checkout-create/index.ts:418-449` — Stripe `success_url` construction — **hardcoded event path found at line 430-431**
10. Supabase live probe: `SELECT event_type, title FROM events WHERE id='060d0483-50db-48d1-840b-73d9fc59356a'` → `event_type='trip', title='The DC Adventure'` (PROVEN trip row, NOT event)

---

## Findings

### 🔴 RC-1 — `ticket-checkout-create` builds Stripe `success_url` against the EVENT confirm path for ALL web surfaces, with NO branching for `event_type='trip'` (PROVEN, primary)

- **File + line:** `supabase/functions/ticket-checkout-create/index.ts:430-431`
- **Exact code:**
  ```ts
  successUrl =
    `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`;
  cancelUrl = `${baseUrl}/checkout/${eventId}/payment`;
  ```
- **What it does:** Hardcodes `/checkout/{eventId}/confirm` as the Stripe `success_url` for every `surface === "web"` checkout, regardless of whether the row is an event or a trip. Same for `cancel_url`.
- **What it should do:** Branch on `tripGateRow?.event_type` (already loaded at line 138-149 for booking-deadline enforcement). When `event_type === 'trip'`, build the URL against `/checkout-trip/{eventId}/confirm` + `/checkout-trip/{eventId}/payment`. When `'event'` (or null/default), keep the current event path.
- **Causal chain:**
  1. Buyer pays for trip "The DC Adventure" (eventId `060d0483-50db-48d1-840b-73d9fc59356a`, `event_type='trip'`) via `/checkout-trip/{tripEventId}/payment` → `createTicketCheckout({surface:"web"})`.
  2. Edge function `ticket-checkout-create` builds `successUrl = https://business.usemingla.com/checkout/060d0483.../confirm?cs={CHECKOUT_SESSION_ID}` — **EVENT path**, not trip path.
  3. Stripe-hosted Checkout completes payment, redirects buyer to `/checkout/{tripEventId}/confirm?cs=cs_test_…`.
  4. `CheckoutConfirmScreen` (event confirm) mounts. Calls `usePublicEventById(eventId)`.
  5. `getPublicEventById` queries `events` table at `publicEventsService.ts:614-622`:
     ```ts
     const typeResp = await supabase.from("events").select("event_type").eq("id", eventId).maybeSingle();
     if (typeResp.data !== null && typeResp.data.event_type === "trip") {
       return null;
     }
     ```
     Returns `null` because the row IS a trip.
  6. `event = publicEventQuery.data?.event ?? null` stays `null` forever.
  7. The empty-shell fall-through at `confirm.tsx:382-384` fires: `return <View style={styles.host} />`. Renders a bare `<View>` with `{flex:1, backgroundColor:"#0c0e12"}` and no children.
  8. User sees permanent black screen. CTA never reachable. Order summary never reachable. QR never reachable. CTA cannot show because the render path that mounts it is structurally unreachable.

- **Verification step:** Live DB probe on 2026-05-22 confirmed eventId `060d0483-50db-48d1-840b-73d9fc59356a` has `event_type='trip'`, title `'The DC Adventure'`, `deleted_at=null`, `published_at=2026-05-17`. Operator's repro URL hits `/checkout/{eventId}/confirm` (event path). `getPublicEventById` at `publicEventsService.ts:620` explicitly returns null for trip rows. The render fall-through at `confirm.tsx:382` is the only branch that can fire when `event===null && result===null`. Stripe webhook + Realtime fallback do populate `result` IF the resume effect succeeds, but `event` will NEVER populate for a trip row — so even after `result` lands, the render branches at lines 359-378 (Confirming hero — requires `event !== null`) and 386+ (full success — requires `event !== null`) are both unreachable; line 382 fires forever. Defensive redirect at line 318 also stays put (sessionStorage payload is present from the pre-redirect write at `payment.tsx:280`).

### 🔴 RC-2 — Empty-shell fall-through renders pure black with no loading affordance during the initial mount window (PROVEN, secondary; affects pure events too)

- **Files + lines:** `mingla-business/app/checkout/[eventId]/confirm.tsx:382-384` + `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:333-335` (identical pattern, both screens).
- **Exact code (event side):**
  ```tsx
  // Render an empty shell while the defensive useEffect redirects (or the
  // web resume is still polling).
  if (event === null || result === null) {
    return <View style={styles.host} />;
  }
  ```
  Where `styles.host = { flex: 1, backgroundColor: "#0c0e12" }`. No children. No spinner. No text. No header.
- **What it does:** On any render where either `event` is still loading OR `result` is still null (which is EVERY first paint on `?cs=…` arrival), shows a fully opaque `#0c0e12` rectangle filling the viewport, with zero visual affordance.
- **What it should do:** Render a calm loading hero ("Confirming your tickets…" / "Confirming your reservation…") whenever `result === null` on the `?cs=…` path, INDEPENDENT of whether `event`/`trip` has loaded yet. The hero copy + checkmark badge + payment-received reassurance is already implemented at lines 359-378 (event) and 312-331 (trip), but it is gated on `event !== null` (event side) / `trip !== null` (trip side) AND `realtimePending === true`. Both gates exclude the initial mount window AND the in-flight sync-confirm window AND the case where the event/trip query is slow or errored.
- **Causal chain (event_type='event' buyer):**
  1. Buyer redirected back from Stripe with `?cs=…`.
  2. First paint: `event === null` (publicEventQuery still in flight), `result === null` (sync confirm hasn't fired yet), `realtimePending === false`.
  3. Lines 359-378 hero gate: `Platform.OS==="web" && result===null && realtimePending && event!==null` → false (realtimePending is false AND event is null) → does not render hero.
  4. Lines 386+ full render gate: `event !== null && result !== null` → false → does not render.
  5. Line 382 falls through: returns `<View style={styles.host} />` — pure black.
  6. Resume effect (lines 164-259) reads sessionStorage payload, calls `confirmTicketCheckout`. If it returns `paid`: `recordResult` fires, `result` populates, re-render. If it returns `pending` or throws: `setRealtimePending(true)`. Both paths take time (sync confirm: 300ms–2s typical; pending → webhook → Realtime push: 0–30s).
  7. During the entire window between mount and result/realtimePending populating, the user sees pure black with no indication anything is happening.
- **Verification step:** Source-trace audit of `confirm.tsx:359-384` confirms the three render branches: (a) lines 359-378 require `event !== null && realtimePending === true`, (b) line 386+ requires `event !== null && result !== null`, (c) line 382 is the unconditional fall-through. Initial mount state is `event === null && result === null && realtimePending === false` — only branch (c) can fire. Trip parity at `checkout-trip/[tripEventId]/confirm.tsx:312-335` is identical: hero requires `trip !== null && realtimePending`, fall-through at 333 is bare `<View>`.

### 🟠 CF-1 — `ticket-checkout-confirm` edge function existence not validated in the resume path (CONTRIBUTING)

- **File + line:** `mingla-business/app/checkout/[eventId]/confirm.tsx:197-251` (the resume effect's try/catch).
- **What it does:** When `confirmTicketCheckout` throws (network failure, edge function 5xx, missing function, etc.) the catch falls into `setRealtimePending(true)` with NO surfaced error to the user. The user just sits on the screen waiting for the Stripe webhook backup to land — which may or may not arrive (webhook delivery is best-effort and may be misconfigured for the test event/trip).
- **Causal chain:** Combined with RC-2's missing loading state, a sync confirm failure produces extended black-screen time with no recovery affordance, indistinguishable from RC-1's permanent black.
- **Verification:** Source-trace confirms no `setPaymentError`/toast/text surface in the catch block. The `console.warn` at line 242 is dev-only.

### 🟡 HF-1 — Resume payload write happens AFTER Stripe checkout creation but BEFORE redirect, with no fallback when sessionStorage is unavailable (HIDDEN FLAW)

- **File + line:** `mingla-business/app/checkout/[eventId]/payment.tsx:278-289`.
- **What it does:** If `globalThis.sessionStorage` is undefined (very private mode, iframe with `sandbox` restrictions, future Safari ITP tightening), `writeCheckoutResumePayload` silently no-ops (`checkoutPersistence.ts:97`). Buyer still gets redirected to Stripe and pays. On return, `readCheckoutResumePayload` returns null at `confirm.tsx:174` → resume effect bails. `realtimePending` is never set. The buyer paid, has a valid `cs=…` token, but the client has no record of the session and can never finalize. Defensive redirect at line 318 fires → bounces to `/checkout/{eventId}` (empty cart). Money charged, no tickets visible to buyer.
- **Why hidden today:** Most browsers honor sessionStorage. Operator's repro on iPhone Safari likely DID write the payload. But this is a quiet failure mode that escalates to data-loss user-experience under conditions not currently tested.
- **Recommended fix scope:** Make `confirmTicketCheckout` callable with just `cs` from the URL (without `buyerStatusToken`) — server can re-derive everything from the Stripe session ID. Even without sessionStorage, recover gracefully.

### 🟡 HF-2 — `console.warn` is the only signal when sync confirm errors in production (HIDDEN FLAW)

- **File + line:** `confirm.tsx:242-245` (event), `checkout-trip/[tripEventId]/confirm.tsx:216-219` (trip).
- **What it does:** Sync-confirm failures are swallowed with `console.warn` only. No Mixpanel event, no Sentry, no admin notification. Operators learn about it only when buyers complain in support.
- **Why hidden today:** Pipeline still functions when webhook backup lands. But when both paths fail (or webhook is misconfigured for a specific event), the failure is invisible to the team.

### 🔵 OBS-1 — `confirmTicketCheckout` service interface uses two-argument shape (`checkoutSessionId`, `buyerStatusToken`) — server could re-derive buyerStatusToken from the cs alone

- **File + line:** `mingla-business/src/services/ticketCheckoutService.ts` (confirmTicketCheckout signature). Observation only; would simplify HF-1 fix.

### 🔵 OBS-2 — Defensive redirect at `confirm.tsx:318` fires `router.replace(\`/checkout/${eventId}\`)` for trip rows too — would redirect a trip buyer to a non-existent event-cart screen for a trip eventId

- **File + line:** `confirm.tsx:301-319`. If sessionStorage IS missing for a trip checkout (HF-1 + RC-1 combination), defensive redirect goes to `/checkout/{tripEventId}` — also wrong path. Trip cart lives at `/checkout-trip/{tripEventId}`. Observation noted to ensure SPEC fix flows correct redirects too.

---

## Five-Layer Cross-Check

| Layer | Truth Found | Contradicts? |
|---|---|---|
| **Docs** | Confirm screens documented at `confirm.tsx:1-21` (event) + `checkout-trip/[tripEventId]/confirm.tsx:1-24` (trip) as separate screens for separate flows. ORCH-0876 added the trip mirror explicitly. | Yes — docs assume trip buyers reach the trip-confirm screen. Edge function never sends them there. |
| **Schema** | `events.event_type` is the discriminator (`'event' \| 'trip'`). `business_public_events_view` does not expose `event_type` (per `publicEventsService.ts:624` comment) — requires the probe at line 614-622. | Consistent. |
| **Code** | `ticket-checkout-create/index.ts:175-235` reads `tripGateRow.event_type === 'trip'` for intake-schema enforcement BUT does NOT use it for success_url branching at line 430-431. Two adjacent uses of the same field, only one applied. | Yes — inconsistent application of `event_type` within the same edge function. |
| **Runtime** | Operator screenshot 2026-05-22 confirms black screen. DB probe confirms eventId is trip row. URL hits event confirm path. `getPublicEventById` source confirms null return for trip rows. | Confirms code-layer truth. |
| **Data** | `event_type='trip'`, `title='The DC Adventure'`, `published_at=2026-05-17`, `deleted_at=null`. Trip row is published and reachable from the trip cart flow. | Consistent. |

**Verdict:** Layers disagree at Code (intent: trips have their own confirm screen) vs Edge Function (effect: all web buyers routed to event confirm). The fix lives in the edge function URL builder + the confirm-screen loading-state coverage.

---

## Blast Radius Map

- **Primary impact:** EVERY web buyer paying for an `event_type='trip'` row via Stripe-hosted Checkout sees a permanent black screen after payment. They paid. They have no ticket access. They cannot get back to the trip page. CTA is structurally unreachable.
- **Secondary impact:** EVERY web buyer paying for ANY row (`event_type='event'` OR `'trip'`) sees a transient black screen during the initial mount window (typically 300ms–2s on fast networks; can extend to 30s+ if sync confirm fails and webhook backup is slow). UX is bad even when the underlying architecture eventually recovers.
- **Native (iOS/Android Stripe PaymentSheet):** NOT affected by RC-1 — native uses `surface:"native"` which builds a `mingla-business://checkout/return` deep link (line 445-446), no web confirm screen involved. Native deep-link handler is independent. RC-2 may have parity issues on native, but the operator did not report them and the in-app PaymentSheet generally renders within the existing native screen without a full mount-from-cold.
- **Buyer-anon-web cancel path:** RC-1 also points cancel_url at `/checkout/{eventId}/payment` for trips (line 432) — would route a cancelling trip buyer to the event-payment screen instead of `/checkout-trip/{eventId}/payment`. Same fix shape resolves cancel.
- **No DB schema impact, no migrations needed.** Pure code fix in edge function + two RN-web screens.
- **No RLS change. No external API change. No Stripe API change** (`success_url` field accepts any valid HTTPS URL; Mingla controls both branches of the routing).

---

## Invariant Violations

- **Constitution #1 (No dead taps)** — "Back to event/trip" CTA is unreachable; not strictly a "tap" since it never mounts, but the spirit is violated (CTA exists in code but is structurally unmountable on the trip-buyer path).
- **Constitution #3 (No silent failures)** — sync-confirm errors swallowed to `console.warn` (HF-2); resume bail when sessionStorage missing also silent (HF-1); trip routed to event screen is a silent surface-mismatch failure (RC-1 + RC-2 in combination).
- **Constitution #9 (No fabricated data)** — Not violated (no fake data shown), but the black-screen state IS misleading (buyer doesn't know if payment succeeded).
- **NEW invariant proposed:** `I-PROPOSED-BUYER-WEB-CONFIRM-HAS-LOADING-STATE` — buyer-web confirm screens MUST render a non-black loading state from the FIRST paint until the order is finalized OR a clear error is surfaced. No window during which a buyer who just paid sees pure-color blank screen.
- **NEW invariant proposed:** `I-PROPOSED-CHECKOUT-SUCCESS-URL-MATCHES-EVENT-TYPE` — `ticket-checkout-create` `success_url` and `cancel_url` MUST route to the confirm/payment surface matching the row's `event_type`. Trip rows → `/checkout-trip/{id}/...`. Event rows → `/checkout/{id}/...`.

---

## Fix Strategy (direction only — SPEC defines exact contract)

1. **Edge function `ticket-checkout-create`:** branch the `success_url`/`cancel_url` builder on `tripGateRow.event_type` (already loaded). When `'trip'`, build against `/checkout-trip/{eventId}/...`; default (event or null) keeps current `/checkout/{eventId}/...`. Same for both `surface:"web"` and `surface:"mobile-web"` branches (mobile-web also uses web URLs — check if mobile-web is used for trip flow; if so, mirror the branch).
2. **Event-side confirm screen** (`mingla-business/app/checkout/[eventId]/confirm.tsx`): replace the empty-shell fall-through at line 382-384 with a calm "Confirming your tickets…" loading state when (a) `?cs=…` is present in the URL AND (b) `result === null`, INDEPENDENT of `event` and `realtimePending`. The existing hero copy + checkmark badge at lines 359-378 is the right visual; just widen the gate.
3. **Trip-side confirm screen** (`mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`): identical fix to event side. Widen the gate at line 312-331 to fire whenever `?cs=…` present + `result===null`.
4. **Optional defensive layer** (HF-1 mitigation): if `result === null` after a reasonable timeout (~30-45s) AND no sessionStorage payload AND `?cs=…` present, surface a recoverable copy ("Your payment is processing. Email us at help@usemingla.com if this persists.") with a "Refresh" action. Out of scope for this ORCH unless operator wants it bundled; flag for follow-up.
5. **No regression of ORCH-0852 architecture** — the sync-confirm + Realtime fallback is correct; only the visual loading-state coverage and the URL-routing per event_type need to change.

---

## Regression Prevention

- **Implementor regression test (Step 0.5 happy-path):** Deno test against `ticket-checkout-create` that asserts (a) for an `event_type='event'` row, `success_url` matches `/checkout/{id}/confirm`, and (b) for an `event_type='trip'` row, `success_url` matches `/checkout-trip/{id}/confirm`. Fails-on-revert verified by removing the new branch.
- **Tester adversarial test:** Jest/snapshot test against the two confirm screens that asserts the loading hero renders when `cs` is in the URL search AND `result===null`, regardless of `event`/`trip`/`realtimePending` state. Plus an RTL/integration probe that mounts the screen with `cs` present + sessionStorage payload present + no event data and confirms the rendered DOM contains the "Confirming…" text (not just `<View>`).
- **Strict-grep gate addition (optional):** lint that the edge function's `successUrl` literal contains the substring `event_type` (or is built via a helper named `buildConfirmSuccessUrl({event_type, eventId})`) so a future engineer cannot add a third surface without thinking about the branching. Implementor decides if worthwhile.

---

## Discoveries for Orchestrator

- **DISC-0911-A:** `ticket-checkout-create` already loads `tripGateRow.event_type` at line 138-149 for booking-deadline enforcement but does not propagate it to the URL builder — adjacent miss. Pattern check: should there be a `successUrlFor(eventType, eventId)` helper in `_shared/` so every future surface caller does the right thing?
- **DISC-0911-B:** `mobile-web` surface (line 422 condition `surface === "web" || surface === "mobile-web"`) uses the same URL builder path. Verify if mobile-web is reachable for trip flow; if so, same fix applies. If mobile-web is consumer-app-only (consumer doesn't ship trip checkout), the branch is moot but the fix should still be defensive.
- **DISC-0911-C:** `getPublicEventById` returning `null` for trip rows is correct intent (event-only view) but the failure mode (silent null → permanent empty render upstream) is hostile. Consider throwing a typed error (`TRIP_ROW_REJECTED_FROM_EVENT_VIEW`) that upstream callers can branch on — would catch RC-1's class of bug at runtime instead of paint-time. Carry forward as a defensive-coding follow-up.
- **DISC-0911-D:** No Mixpanel event fires for "buyer landed on confirm with `?cs=`" or "sync confirm errored" or "buyer reached pending-realtime state". Adding telemetry would surface RC-1 class of bugs proactively rather than reactively. Carry forward.

---

## Confidence

**PROVEN** for both RC-1 and RC-2. Six-field evidence intact for both. Live DB probe confirms the operator's eventId is a trip row. Source trace confirms the routing mismatch and the empty-shell fall-through are the only branches that can fire for the operator's specific URL. Operator-witnessed live repro screenshot 2026-05-22 confirms permanent black on the actual production deployment.

The investigation did NOT run a live web Stripe-test-mode end-to-end repro from this Claude session because that requires browser DOM access + Stripe test card entry which this skill does not have, but the source + DB evidence is sufficient to prove the cause without that step. Recommended that the implementor verifies the fix end-to-end on Vercel preview before merging.
