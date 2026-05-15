# INVESTIGATION — ORCH-0824-F (Phase 2, expanded scope) — Sheet parity with public page + native one-tap checkout + post-purchase calendar entry

**Mode:** INVESTIGATE
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Supersedes:** earlier ORCH-0824-F additive-only investigation. Operator expanded scope mid-ORCH.
**Operator-locked decisions:**
- Stripe **PaymentSheet** (Apple Pay + Google Pay + saved cards in one native overlay).
- Calendar add **after successful payment only**, silent with permission prompt on first time.
- Profile always complete (onboarding guarantees email + name + phone). Defensive check only.
- Stay on ORCH-0824-F.

---

## Headline

This is a **much smaller lift than initial scoping suggested** because Mingla's existing infrastructure already supports the entire flow. The work is integration, not greenfield:

| Piece | Status | Work needed |
|---|---|---|
| Edge function for native checkout | **DONE** — `ticket-checkout-create` already accepts `surface: "native"` and returns `clientSecret + publishableKey + paymentIntentId` for Stripe PaymentSheet | None |
| Stripe PaymentSheet wrapper hooks | **DONE in mingla-business** — `src/payments/{StripeNativeProvider,stripePaymentSheet}.{native,web}.ts` | Copy verbatim to `app-mobile/src/payments/` |
| Stripe webhook → order + tickets | **DONE** — `stripe-webhook` handles `payment_intent.succeeded`, creates orders + tickets, dispatches confirmation | None |
| Consumer profile data (name/email/phone) | **DONE** — `profiles` schema has all three columns; `useAuthSimple` provides session.user.id | New hook to read profile by id |
| Calendar utilities | **DONE in app-mobile** — `calendarReminders.ts`, `CalendarButton.tsx`, `DeviceCalendarService` already implement 5-tier reminders + permission flow | Mirror pattern for ticket calendar add |
| Sheet parity with public page | **NEW WORK** — replicate the public page's section structure (cover → title → dates → brand+party type → venue → vibes+genres → about → tickets-with-buy-CTA) inside the sheet |
| `@stripe/stripe-react-native` in app-mobile | **MISSING** | Install dep (already in mingla-business) |
| Native Buy CTA orchestration | **NEW** — sheet's Get Tickets button initializes + presents PaymentSheet; on success, fires calendar add | New code, ~150 LOC |

Net: roughly 4–5 new files, 2 modified files, 1 dep install, 1 strict-grep CI gate. No DB migrations. No new edge functions. The hard parts (Stripe Connect destination charges, application_fee, webhook order creation, currency handling, idempotency, Tax-on-web tradeoff) are already built.

---

## Phase 1 — Consumer auth + profile data

### Profile schema (verified via Management API)

```
profiles: id (uuid PK), email (text), display_name (text), username (text),
          first_name (text), last_name (text), phone (text), avatar_url (text),
          country (text), preferred_language (text), timezone (text),
          has_completed_onboarding (bool), email_verified (bool),
          + 20 other fields
```

**All four fields the checkout requires** (name, email, phone, plus userId from auth):
- `name` — compose from `first_name + last_name` (with `display_name` fallback)
- `email` — direct
- `phone` — direct (text format; we E.164-normalize via existing `normalizePhoneE164` in `_shared/ticketCheckout.ts`)
- `userId` — `session.user.id` from `useAuthSimple`

### Auth pattern in app-mobile

- `useAuthSimple` hook (`app-mobile/src/hooks/useAuthSimple.ts`) provides `session.user` with `id`, `email`.
- Profile data fetched via `supabase.from('profiles').select(...).eq('id', session.user.id).maybeSingle()`.
- Existing precedent: `useSessionVoting`, `useSessionManagement` both do this pattern.
- **No `useCurrentProfile` hook exists today** — we add one as part of this ORCH for the checkout flow (single-purpose, scoped to the buyer fields).

---

## Phase 2 — Existing checkout pipeline (the gold)

### `supabase/functions/ticket-checkout-create/index.ts` (412 lines, fully implemented)

**Request shape:**
```ts
POST /functions/v1/ticket-checkout-create
Headers: Authorization: Bearer <user_jwt>   // userIdFromAuthHeader resolves session.user.id
Body: {
  eventId: string,
  surface: "native",
  buyer: { name: string, email: string, phone: string, marketingOptIn?: boolean },
  lines: [{ ticketTypeId: string, quantity: number }],
  idempotencyKey?: string,  // server computes one from buyer+lines if absent
}
```

**Response shape (native path):**
```ts
{
  kind: "requires_payment",
  checkoutSessionId: string,
  buyerStatusToken: string,
  totalCents: number,
  currency: string,          // ISO 4217
  clientSecret: string,      // for Stripe PaymentSheet
  paymentIntentId: string,
  publishableKey: string     // for Stripe initialization (from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env)
}
```

**Free-ticket response (totalCents === 0):**
```ts
{
  kind: "free_completed",
  // ... finalize result, includes orderId
  buyerPhoneE164, buyerStatusToken
}
```
Edge fn handles free tickets entirely on the server — no PaymentSheet needed.

**Validation built in:**
- buyer.name >= 2 chars
- buyer.email regex
- buyer.phone E.164 (`normalizePhoneE164` returns null if invalid)
- lines non-empty, each `{ticketTypeId, quantity}` valid
- event has future master_date (rejects `event_no_active_dates` on past events)

**Race + idempotency:**
- `idempotencyKey` computed from `(eventId, buyerEmail, buyerPhoneE164, lines)` if not supplied
- Stripe PaymentIntent created with `idempotencyKey: "ticket_checkout:<sessionId>"`
- Re-entrant safe

**Stripe Connect destination charge:**
- `transfer_data: { destination: stripeAccountId }` — funds land on brand's connected account
- `application_fee_amount_cents: 0` (today; Mingla platform fee structure not yet flipped on)

**What it does NOT do (native path):**
- Stripe Tax (deferred to ORCH-0804-A — web path has it, native path doesn't)
- Save Stripe customer to profile (each payment is a fresh Stripe Customer via `customer_email`)

### Stripe webhook (`supabase/functions/stripe-webhook/index.ts`)

- Handles `payment_intent.succeeded` event
- Uses `metadata.mingla_checkout_session_id` to resolve back to `ticket_checkout_sessions` row
- Calls `biz_ticket_checkout_finalize` RPC → creates `orders` + `tickets` rows atomically
- Dispatches `ticket-confirmation-dispatch` (email + optional SMS)
- Already wired for the native flow; same handler covers both surfaces

### `_shared/ticketCheckout.ts` (shared helpers)

- `userIdFromAuthHeader(req)` — resolves session.user.id from JWT
- `normalizePhoneE164(value)` — accepts string, returns E.164 or null
- `randomBuyerStatusToken()` — generates token for status-polling URL
- `dispatchTicketConfirmation(orderId)` — fires email + SMS

**All the heavy lifting is already done server-side. Native checkout is a CLIENT integration problem.**

---

## Phase 3 — Existing buyer flow files (out of scope to change)

`mingla-business/app/checkout/[eventId]/`:
- `buyer.tsx` (18KB) — collects buyer info form for web/business
- `payment.tsx` (20KB) — wraps PaymentSheet for business app's own checkout
- `confirm.tsx` (21KB) — landing after Stripe redirect (web path)
- `index.tsx` (11KB) — entry router
- `_layout.tsx` — layout wrapper

These are mingla-business surfaces for the public buyer route. **The consumer app SKIPS all of them** — it talks directly to the edge function with `surface: "native"` and presents PaymentSheet inline. The buyer.tsx form is bypassed because we have the profile data already.

---

## Phase 4 — Stripe PaymentSheet wrappers (copy from mingla-business)

### Files to copy verbatim (4 files, ~80 LOC total)

| Source (mingla-business) | Destination (app-mobile) |
|---|---|
| `src/payments/StripeNativeProvider.native.tsx` | `src/payments/StripeNativeProvider.native.tsx` |
| `src/payments/stripePaymentSheet.native.ts` | `src/payments/stripePaymentSheet.native.ts` |
| `src/payments/stripePaymentSheet.web.ts` | `src/payments/stripePaymentSheet.web.ts` |
| `src/payments/stripePaymentSheet.ts` | `src/payments/stripePaymentSheet.ts` |
| `src/payments/normalizePaymentSheetResult.ts` | `src/payments/normalizePaymentSheetResult.ts` |

### Mount StripeNativeProvider in app-mobile root

In `app-mobile/app/_layout.tsx` (the route group root), wrap children:
```tsx
<StripeNativeProvider>
  {existing root tree}
</StripeNativeProvider>
```

`publishableKey` comes from `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` env var. **Operator must confirm this env var is present** in app-mobile build — likely already there for RevenueCat or other Stripe-adjacent usage. Falls back to fetching from edge function response if needed.

### Native package install

```bash
cd app-mobile
expo install @stripe/stripe-react-native
```

Same version as mingla-business (`0.50.3`) — keep parity. This is a NATIVE package; requires Expo dev client rebuild (we're already on dev client). For OTA: not OTA-deliverable on first install — needs `eas build`. **Operator gate: confirm full native rebuild for app-mobile is acceptable.**

---

## Phase 5 — Calendar integration (precedents exist)

### Files to reference / pattern-match

- `app-mobile/src/utils/calendarReminders.ts` — 5-tier alarm builder (3mo, 1mo, 1wk, 1day, day-of)
- `app-mobile/src/components/CalendarButton.tsx` — permission flow + Calendar.createEventAsync + AsyncStorage persistence
- `app-mobile/src/services/DeviceCalendarService` (referenced) — default calendar resolver + add-event wrapper
- `app-mobile/src/components/expandedCard/EventDetailLayout.tsx:13` — existing Calendar import for TM event "Add to Calendar"

### What the post-payment calendar add does

```ts
async function addEventToCalendar(event: BusinessEventCard): Promise<void> {
  // 1. Request permission (idempotent if already granted)
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") return;  // honest fail-silent

  // 2. Resolve default calendar
  const calendarId = await DeviceCalendarService.getDefaultCalendarId();
  if (!calendarId) return;

  // 3. Create event with 5-tier reminders (using existing pattern)
  const startDate = new Date(event.masterDateUtc);
  const endDate = computeEndDate(event);  // master_end_at or +3hr default
  const alarms = buildAlarmsForUpcomingEvent(startDate);

  await Calendar.createEventAsync(calendarId, {
    title: event.title,
    startDate,
    endDate,
    location: event.address ?? event.city ?? undefined,
    notes: `Brand: ${event.brandName}\nTicket via Mingla`,
    alarms,
  });

  // 4. Persist locally so we don't double-add on re-purchase
  await AsyncStorage.setItem(
    `mingla:calendar:event:${event.eventId}`,
    JSON.stringify({ addedAt: new Date().toISOString() }),
  );
}
```

### Where the call fires

In the post-payment success handler (Phase 6 below). Silent failure if permission denied or no default calendar (user can still see ticket in their orders).

### Permission UX

- First-time prompt fires via `Calendar.requestCalendarPermissionsAsync()` — standard iOS/Android dialog.
- If user denies, we don't retry on next purchase (respect their choice). Could add a "Re-enable in settings" hint on the ticket confirmation screen as a polish item — out of scope for this ORCH.

---

## Phase 6 — Sheet parity with public page

### Public page section order (target — from earlier investigation §Layer A)

```
1. Cover hero
2. Title + status badge
3. Dates list (master + multi-date expand)
4. Brand chip + Party Type chips (new this ORCH on the public page side)
5. Venue card
6. Vibes & Genres section (new this ORCH on the public page side)
7. About → description
8. Tickets list → tickets rows + per-row "Buy" Pressable
```

### Sheet target (operator: "render exactly how the public event page is")

Replicate the same section order inside the sheet (handle bar at top + scrollable + swipe-to-dismiss). The Get Tickets CTA today (pinned at bottom of sheet) is REPLACED by:
- A "Tickets" section matching the public page (list of ticket-tier rows)
- Each row has its own quantity stepper + a "Buy" button per tier (matches public page exactly)
- Tap any row's Buy → opens Stripe PaymentSheet (native flow described below)

### Component restructure

Current `ExpandedBusinessEventSheet` (340 LOC) is replaced with a new render structure that mirrors `PublishedBody` from `PublicEventPage`. We can either:

- **Option A — refactor PublishedBody into a reusable `<PublicEventBody>` component** that both surfaces consume. Pros: single source of truth, perfect parity by construction. Cons: cross-app boundary (mingla-business → app-mobile via shared package), bigger refactor.

- **Option B — replicate the layout in `ExpandedBusinessEventSheet`** by reading the `PublishedBody` JSX line-by-line and writing equivalent JSX in the sheet. Pros: no cross-app refactor. Cons: two copies that can drift; CI gate would need to enforce parity (annoying to maintain).

- **Option C — generate JSX from a shared section schema** (e.g., `EventDetailSections.ts` array of `{kind, props}` objects, rendered by a renderer in each app). Pros: structured, one schema, surface-specific renderers. Cons: overkill for one shared layout.

**Recommendation: Option B for v1**, with a CI test that snapshots both render trees and fails on divergence. Migrate to Option A if drift becomes a real problem.

### What the Tickets section looks like in the sheet

Mirror `PublicTicketRow` (lines 659+ of `PublicEventPage.tsx`):
- Tier name
- Price / "Free" / pricing breakdown
- Quantity stepper (defaults 1)
- "Buy" button (or "Sold out" / "Sale starts X" depending on tier state)

Buyer info form: **gone**. Tap Buy → presents PaymentSheet with profile data sent as buyer info.

---

## Phase 7 — Constraints + risks

### Constraints

1. **`@stripe/stripe-react-native` install requires native rebuild for app-mobile.** Cannot ship via OTA on first install. Operator must run `eas build --platform ios && eas build --platform android` and submit new TestFlight / Play Store builds. Subsequent OTAs work normally.
2. **`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` env var** — must be set in app-mobile's EAS env. Same key as mingla-business uses. (The edge function also returns it in the response as a fallback, but the StripeNativeProvider mount needs it at app startup.)
3. **Stripe Tax NOT applied to native checkout.** Pre-existing constraint (deferred to ORCH-0804-A). Brand carries tax compliance gap on native orders. Worth a one-line note in the consumer-facing confirmation copy: "Tax may apply at the brand's discretion."
4. **Apple's "subscriptions and digital content" review rules** — event tickets are PHYSICAL goods (entry to a real-world event), NOT digital content. Apple Pay is allowed; PaymentSheet acceptable; no IAP required. Pre-cleared in mingla-business; same rule applies to app-mobile.
5. **Stripe Connect onboarding state per brand** — RPC `biz_ticket_checkout_create_session` returns `stripe_account_not_ready` error if brand hasn't completed Connect onboarding. Consumer-side: surface as "This event isn't accepting tickets right now." (Same fallback the buyer.tsx form uses today.)

### Risks

| Risk | Mitigation |
|---|---|
| User has Apple Pay disabled / no cards saved | PaymentSheet still works — falls back to manual card entry. No special handling. |
| Network drops mid-payment | PaymentIntent has 24hr expiry; user can retry. Idempotency key prevents duplicate orders. |
| User force-quits app between payment + webhook fires | Webhook still completes the order server-side. User sees ticket when they reopen the app (via React Query refetch of their orders). |
| Calendar permission denied | Honest silent fail. User keeps the ticket; no calendar entry. No retry prompt. |
| Profile data corrupted (e.g., phone E.164 invalid) | Edge fn returns `buyer_phone_required` error. Surface as "Please complete your profile" toast with a settings deep-link. (Operator said impossible — defensive only.) |
| User taps Buy multiple times rapidly | Idempotency key on session creation + button disabled while PaymentSheet is open. |
| Stripe webhook delayed / fails | User stuck on "processing" UI. Status-polling via `ticket-checkout-status` (already exists) covers this. Sheet UI shows a spinner with "Confirming your ticket..." for up to 30 seconds, then falls back to "We're processing your payment — check your tickets shortly." |

---

## Phase 8 — Open SPEC questions

1. **Sheet parity option** — A (shared component), B (replicate + CI snapshot test), or C (schema-driven). Recommendation: B.
2. **Quantity stepper UX** — default to 1? Min 1? Max = tier's `maxPurchaseQty`? Recommendation: yes to all.
3. **Multi-tier purchase in one transaction** — public page lets buyers add multiple tiers to one cart; sheet could too. Recommendation: support multi-line, mirror public page exactly.
4. **Post-payment success screen / toast** — return to sheet with success banner, or auto-close sheet and show toast? Recommendation: success banner inside the sheet for 3 seconds, then auto-close, then toast "Ticket added to your calendar."
5. **Where do consumers see their tickets after purchase?** — need a "My Tickets" surface in app-mobile. Today, tickets are only accessible via the public buyer-flow confirm.tsx page in mingla-business. **THIS IS A GAP — consumer tickets are invisible to consumers today** (unless they bookmark the confirm URL). Worth flagging as a follow-up ORCH (ORCH-0824-G — "Consumer tickets surface").
6. **Confirmation email/SMS branding** — currently uses mingla-business templates. Consumer purchase should use the same templates? Recommendation: same templates (single source of truth). The notification dispatcher already routes by template_key per ORCH-0788.
7. **Apple Pay merchant ID** — `@stripe/stripe-react-native`'s `StripeProvider` requires `merchantIdentifier` for Apple Pay. mingla-business has it set; we replicate the same value for app-mobile.

---

## Phase 9 — Cross-domain impact

| Domain | Affected? | How |
|---|---|---|
| Supabase DB | No | No schema changes. |
| Edge functions | No | Existing `ticket-checkout-create` + `stripe-webhook` + `ticket-confirmation-dispatch` handle everything. |
| mingla-business | Public event page only | Already covered in Phase 1 investigation (additive party type / vibes / genres rendering). Sheet uses same content; no shared-code refactor unless Option A is chosen. |
| app-mobile | Significant | Sheet rewrite, Stripe SDK install, payment hooks, calendar add, profile read hook. |
| mingla-admin | No | N/A. |
| Existing TM card path | No | Untouched — businessEvent vs ticketmaster discriminator preserved in ExpandedCardModal. |

---

## Phase 10 — Discoveries for orchestrator

1. **Consumer-tickets surface gap (NEW ORCH candidate, ORCH-0824-G)** — consumers can buy tickets via the new flow but have no in-app surface to see them later. They'd need to dig into email confirmations or remember the URL. This is a real gap that needs its own ORCH.
2. **Stripe Tax on native checkout (existing deferred ORCH-0804-A)** — re-affirmed as still deferred. Brand carries tax compliance gap.
3. **Apple Pay merchantIdentifier** — must be configured in app-mobile native config. One-time setup, requires native rebuild anyway.
4. **`expo-calendar` in app-mobile already has 5-tier reminder pattern + permission flow built (CalendarButton.tsx + calendarReminders.ts).** Reuse, don't reinvent.
5. **`PublishedBody` and the consumer sheet should share a renderer** if drift becomes painful (Option A). For v1, replicate (Option B). Add a snapshot CI test if we go with B.
6. **Apple App Review consideration** — tickets are physical goods, not digital. Apple Pay allowed. Pre-cleared in mingla-business; same legal framework applies to app-mobile.

---

## Confidence

**High** on the architecture findings — read of `ticket-checkout-create` (412 lines), mingla-business Stripe payment integration files, profile schema (verified via Management API), existing calendar utilities. **Medium** on the size estimate — depends on whether we go Option A (cross-app refactor of `PublishedBody`) or Option B (replicate with snapshot test). Option B is the assumption for the size estimate.

---

## NEXT HANDOFF — paste into operator review (NOT yet for implementor)

Operator: please review the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`. Five open SPEC decisions need your call before I write the SPEC: (1) sheet parity approach — A shared component, B replicate-with-snapshot-test, or C schema-driven; recommendation B. (2) Multi-tier cart in sheet — yes/no; recommendation yes (mirror public page). (3) Post-purchase confirmation UX — in-sheet banner + auto-close + toast vs separate confirmation screen. (4) Consumer-tickets surface — accept the gap and register ORCH-0824-G follow-up, or expand THIS ORCH's scope. (5) Apple Pay merchantIdentifier value — same as mingla-business or new dedicated one. Also operator gate on the native rebuild: `@stripe/stripe-react-native` install requires `eas build` for app-mobile (no OTA first time); confirm this is acceptable. After your answers, I write the SPEC and dispatch to implementor. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
