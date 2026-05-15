# SPEC — ORCH-0824-F (Phase 2, expanded) — Native one-tap checkout + post-purchase calendar entry + sheet/public-page parity via shared body component

**Mode:** SPEC
**Date:** 2026-05-13
**Investigation:** [`reports/INVESTIGATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`](../reports/INVESTIGATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## Operator-locked decisions (no re-litigation)

1. **Payment UI**: Stripe PaymentSheet (Apple Pay + Google Pay + saved cards + new cards in one native overlay).
2. **Calendar entry timing**: only after successful payment. Silent permission prompt on first time, fail-silent if denied.
3. **Profile data**: always present (onboarding guarantees). Defensive null-check only; no fallback UI path for missing fields.
4. **ORCH umbrella**: ORCH-0824-F (expanded scope under same ID).
5. **Sheet parity approach**: shared component used by both surfaces (mechanically: byte-equivalent triplicate enforced by CI parity gate, mirroring the existing `eventTaxonomy.ts` pattern — see §3.1).
6. **Multi-tier cart**: yes, mirror public page — buyer can purchase multiple ticket tiers in one PaymentIntent.
7. **Consumer tickets surface**: deferred to **ORCH-0824-G**. This ORCH ships purchase + calendar; viewing/managing purchased tickets in-app is the follow-up.
8. **Native rebuild**: operator approved running `eas build` for first install of `@stripe/stripe-react-native`.

---

## 1. Scope, non-goals, assumptions

### Scope

- **Install** `@stripe/stripe-react-native@0.50.3` in `app-mobile` (matches mingla-business version).
- **Mount `<StripeNativeProvider>` at the app-mobile root layout** so PaymentSheet is initialized once.
- **Harmonize design tokens** between `app-mobile/src/constants/designSystem.ts` and `mingla-business/src/constants/designSystem.ts` for the subset used by `PublicEventBody` (`accent`, `glass`, `radius`, `spacing`, `typography`, `text` — port missing ones from mingla-business → app-mobile).
- **Extract a shared `PublicEventBody` component** from `mingla-business/src/components/event/PublicEventPage.tsx` into a standalone component file with parity-locked copies in both apps. CI gate enforces byte-equivalence.
- **Replace ExpandedBusinessEventSheet contents** to render `PublicEventBody` instead of the current bespoke layout. Sheet chrome (BottomSheet wrapper, backdrop, handle bar) stays; body content becomes the shared component.
- **Add a Buy CTA in `PublicEventBody`'s Tickets section** that fires the existing `ticket-checkout-create` edge function with `surface: "native"`, then presents Stripe PaymentSheet.
- **On successful payment**: silently add a calendar entry mirroring the existing `CalendarButton.tsx` pattern.
- **Post-payment success UX**: in-sheet success banner ("Ticket purchased — added to your calendar") for 3 seconds, then auto-close the sheet. Toast on the underlying Discover screen for confirmation.
- **New service** `consumerTicketCheckoutService.ts` in app-mobile wrapping the edge function call + PaymentSheet present + calendar add.
- **New hook** `useCurrentProfileForCheckout.ts` to read `{name, email, phone}` from profiles by `session.user.id`.

### Non-goals

- **No "My Tickets" surface** in app-mobile (ORCH-0824-G follow-up). Consumers see their tickets via the email confirmation only for v1.
- **No Stripe Tax on native checkout** (pre-existing constraint, ORCH-0804-A defer).
- **No changes to mingla-business's existing buyer flow** (`/checkout/{eventId}/buyer.tsx → payment.tsx → confirm.tsx`). Web buyers continue using that.
- **No changes to the Stripe webhook** — it already handles the native PaymentIntent flow.
- **No new edge functions.** `ticket-checkout-create`, `ticket-checkout-status`, `stripe-webhook`, `ticket-confirmation-dispatch` all unchanged.
- **No DB schema changes.** No migrations.
- **No 5-tier reminder pattern for tickets** (the existing 5-tier is for far-future events like holidays; ticket reminders use 4-tier: 1 week, 1 day, day-of, 1 hour before).
- **No saved-card persistence on Mingla account** for v1 — Stripe creates a fresh Customer per purchase via `customer_email`. Saved-payment-method-on-file persistence is a future ORCH.
- **No public event page UI changes** beyond what already shipped (the page already renders the new chips per the earlier ORCH-0824-F additive work). The shared component IS the public page's body — extracting it consolidates without changing what users see.

### Assumptions

- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` exists in app-mobile's EAS env (or can be added quickly). Operator confirms or sets at implementation start.
- Apple Pay `merchantIdentifier` from mingla-business (`merchant.com.sethogieva.minglabusiness`) can be reused as-is for app-mobile, OR a new dedicated `merchant.com.sethogieva.mingla` is provisioned. Implementor confirms before native rebuild.
- Operator runs `eas build --platform ios && eas build --platform android` for app-mobile after the implementor merges. Subsequent updates go via OTA.
- The 4 ticket-reminder tiers (1 week / 1 day / day-of / 1 hour before) are acceptable UX. If operator wants different, override in SPEC §6.

---

## 2. Pre-flight: Stripe & native dependencies

### 2.1 Install in app-mobile

```bash
cd app-mobile
npx expo install @stripe/stripe-react-native@0.50.3
```

Pinned to the same version mingla-business uses to avoid SDK divergence. `expo install` writes to `package.json` with the correct prefix.

### 2.2 Native config (iOS — Info.plist + entitlements)

Apple Pay merchant identifier in `app-mobile/app.json` (or `app.config.ts`):
```json
{
  "expo": {
    "plugins": [
      [
        "@stripe/stripe-react-native",
        {
          "merchantIdentifier": "merchant.com.sethogieva.mingla",
          "enableGooglePay": true
        }
      ]
    ]
  }
}
```

If using `app.config.ts`, mirror the equivalent JS structure.

### 2.3 Native config (Android — Google Pay)

`@stripe/stripe-react-native` handles Google Pay automatically when `enableGooglePay: true` in the Expo plugin config. No manual gradle changes.

### 2.4 Env vars

- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (live or test). Must be present in app-mobile EAS env, same value as the Stripe account used by mingla-business + ticket-checkout-create.

---

## 3. Shared `PublicEventBody` component

### 3.1 Mechanical approach: parity-locked triplicate

The monorepo has no workspaces (no shared package directory). Existing precedent for cross-app shared code: `eventTaxonomy.ts` is byte-equivalent in three locations (`supabase/functions/_shared/`, `mingla-business/src/constants/`, `app-mobile/src/constants/`), enforced by `orch-0824-event-taxonomy-parity.mjs` CI gate.

Apply the same pattern to the shared event body:

| Source-of-truth file | Mirror file |
|---|---|
| `mingla-business/src/components/event/PublicEventBody.tsx` (extracted from PublicEventPage's PublishedBody) | `app-mobile/src/components/event/PublicEventBody.tsx` (byte-equivalent copy) |

CI gate `orch-0824-public-event-body-parity.mjs` enforces byte-equivalence (same script template as the taxonomy parity gate).

### 3.2 Design token harmonization (prerequisite)

The shared component uses tokens that exist in mingla-business but not in app-mobile. Specifically: `accent`, `glass`, `canvas` (full objects). To make byte-equivalent JSX possible, port these tokens from mingla-business to app-mobile.

**Implementation note for implementor:** copy the `export const accent`, `export const glass`, `export const canvas` blocks from `mingla-business/src/constants/designSystem.ts` and append to `app-mobile/src/constants/designSystem.ts`. Preserve existing app-mobile tokens (don't replace).

**Risk:** any existing app-mobile token name collisions. Implementor must check (`grep -nE "export const (accent|glass|canvas)" app-mobile/src/constants/designSystem.ts`) before pasting. If collision exists, rename the new tokens with a `mingla` prefix and update the shared component's imports — flag as spec deviation.

### 3.3 Shared component API

**File:** `<app>/src/components/event/PublicEventBody.tsx` (one in each app, byte-equivalent)

**Props:**
```ts
export interface PublicEventBodyProps {
  event: LiveEvent;
  brand: { id: string; slug: string; displayName: string } | null;
  variant: "published" | "cancelled" | "ended" | "password_gate";  // host decides
  onBuyTickets?: (lines: Array<{ ticketTypeId: string; quantity: number }>) => void | Promise<void>;
  // For surfaces that don't show ticket rows (e.g., past events), pass undefined.
  isInsideSheet?: boolean;  // sheet hosts may want tighter padding; defaults false
}
```

**Render contract (sections in order):**
1. Cover hero (image OR hue band — `coverHue`-based)
2. Title + status badge (Live / Cancelled / Ended)
3. Dates list (master + multi-date expand button if > SHOW_INITIAL_DATES)
4. Brand row (brand tile + name + Party Type chips next to it)
5. Venue card (icon + venueName + address branch, honors `hideAddressUntilTicket`)
6. Vibes & Genres section (vibe chips with emoji + music genre chips, hidden when both arrays empty)
7. About section (header + description, hidden when description empty)
8. Tickets section (header + list of `PublicTicketRow` components; each row has internal qty stepper + Buy button)
9. Empty padding / safe-area inset

**Behavior:**
- All ticket-row state (quantity selection, current selected lines for multi-tier cart) lives inside `PublicEventBody`. The component aggregates lines and calls `onBuyTickets(lines)` once when the user taps the global "Buy" button OR each tier's individual Buy button (per public-page existing behavior).
- For multi-tier cart UX, mirror exactly what `PublicEventPage.PublishedBody` does today (it already supports this — extraction preserves behavior).
- For cancelled / ended / password-gate variants, `PublicEventBody` returns the matching variant component (existing CancelledVariant, PasswordGateVariant) — extracted into the same file or kept in the host file. **Recommend keeping variants in the host file** for v1; only extract the published-variant body.

### 3.4 Host integration

#### 3.4.1 mingla-business — `PublicEventPage.tsx`

Replace the inline `PublishedBody` implementation (lines 396-650) with:
```tsx
import { PublicEventBody } from "./PublicEventBody";

// ... existing variant computation logic ...

if (variant === "published") {
  return (
    <PublicEventBody
      event={event}
      brand={brand}
      variant="published"
      onBuyTickets={async (lines) => {
        // Existing mingla-business buyer flow:
        // → router.push(`/checkout/${event.id}`)  with lines preserved in state
        // OR call the existing buyer.tsx form path
      }}
    />
  );
}
```

#### 3.4.2 app-mobile — `ExpandedBusinessEventSheet.tsx`

Replace the current bespoke layout with:
```tsx
import { PublicEventBody } from "../event/PublicEventBody";
import { useConsumerTicketCheckout } from "../../services/consumerTicketCheckoutService";

const { handleBuy, isProcessing, postPurchaseBanner } = useConsumerTicketCheckout(data.eventId);

return (
  <BottomSheet ...>
    <BottomSheetScrollView>
      <PublicEventBody
        event={businessEventCardToLiveEvent(data)}  // adapter
        brand={{ id: data.brandId, slug: data.brandSlug, displayName: data.brandName }}
        variant="published"
        isInsideSheet
        onBuyTickets={handleBuy}
      />
      {postPurchaseBanner ? <SuccessBanner message={postPurchaseBanner} /> : null}
    </BottomSheetScrollView>
  </BottomSheet>
);
```

**Adapter `businessEventCardToLiveEvent`:** maps the consumer `BusinessEventCard` type to the `LiveEvent` shape `PublicEventBody` expects. Lives in `app-mobile/src/types/businessEventCardAdapter.ts`. Pure function, ~30 LOC.

#### 3.4.3 Variant components stay in their host files

`CancelledVariant`, `PasswordGateVariant` remain in `PublicEventPage.tsx`. The consumer sheet doesn't render those variants (cancelled events are filtered out by the merged Discover edge function — they're not `status='scheduled' OR 'live'`). If the consumer DOES somehow land on a cancelled event, `PublicEventBody` with `variant="cancelled"` renders a minimal "This event has been cancelled" message inline.

---

## 4. Stripe PaymentSheet integration

### 4.1 Files to copy from mingla-business → app-mobile (verbatim)

| Source | Destination |
|---|---|
| `mingla-business/src/payments/StripeNativeProvider.native.tsx` | `app-mobile/src/payments/StripeNativeProvider.native.tsx` |
| `mingla-business/src/payments/StripeNativeProvider.web.tsx` (if exists; else create a stub) | `app-mobile/src/payments/StripeNativeProvider.web.tsx` |
| `mingla-business/src/payments/stripePaymentSheet.native.ts` | `app-mobile/src/payments/stripePaymentSheet.native.ts` |
| `mingla-business/src/payments/stripePaymentSheet.web.ts` | `app-mobile/src/payments/stripePaymentSheet.web.ts` |
| `mingla-business/src/payments/stripePaymentSheet.ts` (index re-export) | `app-mobile/src/payments/stripePaymentSheet.ts` |
| `mingla-business/src/payments/normalizePaymentSheetResult.ts` | `app-mobile/src/payments/normalizePaymentSheetResult.ts` |

CI gate `orch-0824-stripe-payment-sheet-parity.mjs` enforces byte-equivalence (same template).

### 4.2 Mount StripeNativeProvider at app-mobile root

Edit `app-mobile/app/_layout.tsx`:
```tsx
import { StripeNativeProvider } from "../src/payments/StripeNativeProvider";

// Inside the root render tree, wrap the existing children:
<StripeNativeProvider>
  {/* existing GestureHandlerRootView, QueryClientProvider, etc. */}
</StripeNativeProvider>
```

Position: **outside** the auth wrapper (so Stripe is initialized regardless of auth state) but **inside** any error boundary.

`StripeNativeProvider` reads `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `process.env`. If empty, child renders pass through with PaymentSheet calls erroring gracefully (handled in the service layer).

---

## 5. Consumer ticket checkout service

### 5.1 `app-mobile/src/services/consumerTicketCheckoutService.ts` (new, ~180 LOC)

```ts
import { supabase } from "./supabase";
import { useStripePaymentSheet } from "../payments/stripePaymentSheet";
import { useCurrentProfileForCheckout } from "../hooks/useCurrentProfileForCheckout";
import { addTicketToCalendar } from "../utils/ticketCalendar";

export interface CheckoutLine {
  ticketTypeId: string;
  quantity: number;
}

export type CheckoutResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: "free_completed"; orderId: string }
  | { ok: false; reason: "canceled" }
  | { ok: false; reason: "failed"; code: string };

export interface ConsumerCheckoutController {
  handleBuy: (lines: CheckoutLine[]) => Promise<CheckoutResult>;
  isProcessing: boolean;
  postPurchaseBanner: string | null;
  clearBanner: () => void;
}

export const useConsumerTicketCheckout = (
  eventId: string,
): ConsumerCheckoutController => {
  // useState: isProcessing, postPurchaseBanner
  // useCurrentProfileForCheckout → { name, email, phone }
  // useStripePaymentSheet → { initPaymentSheet, presentPaymentSheet }

  const handleBuy = async (lines: CheckoutLine[]): Promise<CheckoutResult> => {
    // 1. Validate lines
    // 2. Call edge fn: supabase.functions.invoke("ticket-checkout-create", {
    //      body: { eventId, surface: "native", buyer, lines }
    //    })
    // 3. If response.kind === "free_completed" → fire calendar + return {ok:true, orderId}
    // 4. Otherwise: response.kind === "requires_payment" → init+present PaymentSheet
    //    - initPaymentSheet({
    //        merchantDisplayName: "Mingla",
    //        paymentIntentClientSecret: response.clientSecret,
    //        allowsDelayedPaymentMethods: false,
    //        defaultBillingDetails: { name, email, phone },
    //        applePay: { merchantCountryCode: "US" },
    //        googlePay: { merchantCountryCode: "US", testEnv: __DEV__ },
    //      })
    //    - presentPaymentSheet()
    //    - on canceled → return {ok:false, reason:"canceled"}
    //    - on failed → return {ok:false, reason:"failed", code: error.code}
    //    - on completed → poll ticket-checkout-status until status === "completed"
    //      (or 30s timeout → optimistic success)
    // 5. Fire calendar add via addTicketToCalendar(event, ticketName)
    // 6. Set postPurchaseBanner = "Ticket purchased — added to your calendar."
    // 7. Schedule clearBanner + sheet auto-close after 3 seconds
  };

  return { handleBuy, isProcessing, postPurchaseBanner, clearBanner };
};
```

### 5.2 Error handling contract

- **Network failure on edge fn**: surface "Couldn't reach checkout. Tap to try again." toast.
- **`event_no_active_dates`**: surface "This event isn't on sale anymore." (cancelled state)
- **`stripe_account_not_ready`**: surface "This event isn't accepting tickets right now."
- **`buyer_*_required` errors**: surface "Please complete your profile to checkout." (shouldn't happen per operator; defensive).
- **PaymentSheet canceled**: silent no-op, sheet stays open for retry.
- **PaymentSheet failed**: toast with error.message.
- **Status polling timeout**: optimistic banner "We're confirming your ticket — check your tickets shortly." (doesn't block sheet close).

---

## 6. Calendar integration

### 6.1 `app-mobile/src/utils/ticketCalendar.ts` (new, ~90 LOC)

```ts
import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AddTicketToCalendarInput {
  eventId: string;
  title: string;
  brandName: string;
  startsAt: Date;
  endsAt: Date;
  venue: string | null;
  address: string | null;
  hideAddressUntilTicket: boolean;
  ticketName: string;
}

const ASYNC_KEY = (eventId: string) => `mingla:ticket-calendar:${eventId}`;

const buildTicketAlarms = (startsAt: Date): Calendar.Alarm[] => {
  // 4 tiers: 1 week, 1 day, day-of (start of day), 1 hour before
  return [
    { relativeOffset: -10080, method: Calendar.AlarmMethod.ALERT },  // 1 week (7 days)
    { relativeOffset: -1440, method: Calendar.AlarmMethod.ALERT },   // 1 day
    { relativeOffset: -60, method: Calendar.AlarmMethod.ALERT },     // 1 hour
    { relativeOffset: 0, method: Calendar.AlarmMethod.ALERT },       // day-of (event start)
  ];
};

export const addTicketToCalendar = async (
  input: AddTicketToCalendarInput,
): Promise<{ ok: boolean; calendarEventId?: string }> => {
  // 1. Check AsyncStorage — don't double-add if already there
  // 2. Request permission via Calendar.requestCalendarPermissionsAsync()
  // 3. If denied → return { ok: false }; honest fail-silent
  // 4. Resolve default calendar via DeviceCalendarService.getDefaultCalendarId()
  //    OR Calendar.getDefaultCalendarAsync() fallback
  // 5. Compose location: address available (not hidden) → venue + address; else venue only
  // 6. Call Calendar.createEventAsync(calendarId, {...})
  // 7. Persist { calendarEventId, addedAt, ticketName } to AsyncStorage
  // 8. Return { ok: true, calendarEventId }
};

export const isTicketAlreadyOnCalendar = async (eventId: string): Promise<boolean> => {
  // Read AsyncStorage, return true if entry exists.
};
```

### 6.2 Calendar entry shape

| Field | Source | Notes |
|---|---|---|
| `title` | `event.title` | e.g., "Big Party" |
| `startDate` | `event.master_start_at` | UTC ISO from event_dates master row |
| `endDate` | `event.master_end_at` OR `startDate + 3hr` if null | safe default for events without end time |
| `location` | venue + address (if `hideAddressUntilTicket = false`) else venue only else city else null | location text shown in calendar |
| `notes` | `"Brand: ${brandName}\nTicket type: ${ticketName}\nPurchased via Mingla."` | metadata for the user |
| `alarms` | 4-tier (1wk, 1d, 1h, day-of) | per §6.1 |

### 6.3 De-duplication

Check AsyncStorage before adding. If `mingla:ticket-calendar:${eventId}` exists, skip. (User who buys two tickets to the same event gets one calendar entry; this is intentional — duplicate calendar pollution is worse than missing a second alarm.)

### 6.4 Permission UX

- First-time: standard iOS/Android permission dialog fires automatically on `requestCalendarPermissionsAsync()`.
- Denied: no retry prompt. User can re-enable in OS settings. (Operator can add a "Re-enable in settings" link to a "My Tickets" surface in ORCH-0824-G.)

---

## 7. Profile read hook

### 7.1 `app-mobile/src/hooks/useCurrentProfileForCheckout.ts` (new, ~50 LOC)

```ts
import { useQuery } from "@tanstack/react-query";
import { useAuthSimple } from "./useAuthSimple";
import { supabase } from "../services/supabase";

export interface CheckoutProfile {
  name: string;
  email: string;
  phone: string;
}

export const useCurrentProfileForCheckout = () => {
  const { session } = useAuthSimple();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ["checkoutProfile", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<CheckoutProfile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name, last_name, display_name, email, phone")
        .eq("id", userId)
        .maybeSingle();
      if (error || !data) return null;
      const name =
        ((data.first_name ?? "").trim() + " " + (data.last_name ?? "").trim()).trim() ||
        (data.display_name ?? "").trim();
      const email = (data.email ?? "").trim();
      const phone = (data.phone ?? "").trim();
      if (name.length < 2 || !email || !phone) return null;
      return { name, email, phone };
    },
  });
};
```

Defensive null-return when fields missing (operator: shouldn't happen; UI surfaces "Complete your profile" toast if it does).

---

## 8. Success criteria

| # | Criterion | Surface |
|---|---|---|
| 1 | Consumer taps a business event card → ExpandedBusinessEventSheet opens rendering `PublicEventBody` | app-mobile |
| 2 | Sheet visual matches public page section-for-section (cover, title, dates, brand+party type, venue, vibes+genres, about, tickets) | app-mobile + mingla-business |
| 3 | Consumer taps "Buy" on a ticket tier → Stripe PaymentSheet presents (Apple Pay / Google Pay / saved cards visible) | app-mobile |
| 4 | Payment completes → in-sheet banner "Ticket purchased — added to your calendar" appears | app-mobile |
| 5 | Calendar entry created with title, location, 4-tier alarms | iOS sim + Android emu (manual verify) |
| 6 | Banner auto-closes after 3s, sheet auto-closes, toast on Discover | app-mobile |
| 7 | Free tickets ($0): skip PaymentSheet entirely, fire calendar add immediately | app-mobile |
| 8 | Stripe-account-not-ready error: surface "This event isn't accepting tickets right now." | app-mobile |
| 9 | Multi-tier purchase: consumer adds 2 GA + 1 VIP → one PaymentIntent → one calendar entry | app-mobile |
| 10 | Calendar permission denied: ticket still purchased, no calendar entry, no retry prompt | app-mobile |
| 11 | mingla-business public event page renders identically (no regression — same content as before extraction) | mingla-business |
| 12 | `orch-0824-public-event-body-parity.mjs` CI gate: clean | CI |
| 13 | `orch-0824-stripe-payment-sheet-parity.mjs` CI gate: clean | CI |
| 14 | TypeScript strict: no errors | both apps |

---

## 9. Test case matrix

| # | Scenario | Surface | Expected |
|---|---|---|---|
| T-01 | Open sheet for Big Party (paid event, complete profile) | Sheet | Renders full body, Buy buttons enabled |
| T-02 | Tap Buy on £10 GA tier | Sheet | PaymentSheet opens; Apple Pay row visible |
| T-03 | Complete Apple Pay payment | Sheet → PaymentSheet → confirmation | Banner appears; calendar entry created with 4 alarms |
| T-04 | Cancel out of PaymentSheet | Sheet | Sheet stays open; no error toast; ticket not purchased |
| T-05 | Network drops during edge-fn call | Sheet | Toast "Couldn't reach checkout. Tap to try again."; Buy button re-enabled |
| T-06 | Free ticket event (totalCents=0) | Sheet | Skip PaymentSheet; banner immediately; calendar entry created |
| T-07 | Multi-tier: 2 GA + 1 VIP | Sheet → PaymentSheet | One PaymentIntent for sum; one order; one calendar entry |
| T-08 | Stripe account not yet onboarded for brand | Sheet | Toast "This event isn't accepting tickets right now."; sheet stays open |
| T-09 | Calendar permission denied | Sheet | Ticket purchased; banner says "Ticket purchased" (no calendar mention); no retry |
| T-10 | Already-on-calendar event (re-purchase) | Sheet | Second ticket purchased; calendar NOT double-added (dedupe per §6.3) |
| T-11 | Profile missing phone (defensive) | Sheet | Toast "Complete your profile to checkout"; Buy disabled |
| T-12 | mingla-business public event page (regression) | Public page | Renders identically to before extraction; CI parity gate clean |
| T-13 | Public page on cancelled event | Public page | CancelledVariant renders (unchanged); no chips |
| T-14 | Webhook fires before client polls completion | Sheet | Status poll returns "completed"; banner fires |
| T-15 | Webhook delayed > 30s | Sheet | Optimistic banner "We're confirming your ticket..."; sheet closes; toast on Discover |

---

## 10. Invariants — preserved + new

### Preserved
- **Anon-buyer routes** (`feedback_anon_buyer_routes.md`): unchanged — consumer goes through edge fn directly, no `/checkout` route involved.
- **One owner per truth**: PublicEventBody is single visual source; CI parity ensures both copies match.
- **No silent failures** (Constitution #3): all error paths surface a toast or banner.
- **No fabricated data** (Constitution #9): empty arrays render no chips; missing profile fields disable Buy with explicit message.
- **Currency-aware** (Constitution #10): PaymentSheet honors `currency` from edge fn response.
- **Stripe ToS Path C invariants** (`I-PROPOSED-Q/R/S/T/U/V/W`): preserved — edge function unchanged.

### New invariants
- **`I-PROPOSED-PUBLIC-EVENT-BODY-PARITY`**: `PublicEventBody.tsx` byte-equivalent across `mingla-business` and `app-mobile`. Enforced by CI gate.
- **`I-PROPOSED-STRIPE-PAYMENT-SHEET-PARITY`**: `payments/*.{ts,tsx}` byte-equivalent across both apps. Enforced by CI gate.
- **`I-PROPOSED-TICKET-CALENDAR-DEDUPE`**: per-eventId AsyncStorage key prevents double-add on re-purchase.

---

## 11. Implementation order

1. **Design token harmonization** — port `accent`, `glass`, `canvas` blocks from `mingla-business/src/constants/designSystem.ts` to `app-mobile/src/constants/designSystem.ts`. Verify no collisions (grep before paste).
2. **Stripe SDK install** — `npx expo install @stripe/stripe-react-native@0.50.3` in app-mobile.
3. **Native config** — add `merchantIdentifier` + `enableGooglePay` to app-mobile `app.json`/`app.config.ts`.
4. **Copy payment files** — `mingla-business/src/payments/*` → `app-mobile/src/payments/*`. Verify diff is empty after copy.
5. **CI parity gate for payments** — new `.github/scripts/strict-grep/orch-0824-stripe-payment-sheet-parity.mjs` + workflow job entry.
6. **Mount `<StripeNativeProvider>`** in `app-mobile/app/_layout.tsx`.
7. **Extract `PublicEventBody`** — move PublishedBody's body from `PublicEventPage.tsx` into `mingla-business/src/components/event/PublicEventBody.tsx`. `PublicEventPage` imports it. Behavior identical.
8. **Copy `PublicEventBody.tsx`** to `app-mobile/src/components/event/PublicEventBody.tsx`. Byte-equivalent.
9. **CI parity gate for body** — new `.github/scripts/strict-grep/orch-0824-public-event-body-parity.mjs` + workflow job.
10. **Profile hook** — `app-mobile/src/hooks/useCurrentProfileForCheckout.ts` (new).
11. **Calendar utility** — `app-mobile/src/utils/ticketCalendar.ts` (new). Mirror `CalendarButton.tsx` pattern.
12. **Checkout service + hook** — `app-mobile/src/services/consumerTicketCheckoutService.ts` (new). Wires edge fn → PaymentSheet → calendar.
13. **Adapter** — `app-mobile/src/types/businessEventCardAdapter.ts` (new). Maps BusinessEventCard → LiveEvent for PublicEventBody.
14. **Replace ExpandedBusinessEventSheet contents** — render `<PublicEventBody>` instead of bespoke layout. Wire `onBuyTickets` to `useConsumerTicketCheckout.handleBuy`.
15. **mingla-business `PublicEventPage`** — replace inline PublishedBody render with `<PublicEventBody variant="published" onBuyTickets={...}>`. Wire to existing buyer flow.
16. **Run all CI gates locally** — must be clean.
17. **`eas build` for app-mobile** — operator runs, submits to TestFlight + Play Store internal track.
18. **Smoke test** — operator runs the 15 test cases on TestFlight build.

---

## 12. Regression prevention

- **Snapshot test** on `PublicEventBody` output (props in, JSX tree out) — catches regressions if extraction subtly changes behavior. Required.
- **CI parity gates** (3 total post-this-ORCH): event-taxonomy-parity, public-event-body-parity, stripe-payment-sheet-parity.
- **Status-polling client-side timeout** (30s default) prevents user being stuck on "processing" UI when webhook is delayed.
- **Idempotency key** on edge fn — already in place. Re-tapping Buy after a network blip doesn't double-charge.
- **AsyncStorage dedupe** for calendar — prevents double-add when user re-purchases same event.

---

## 13. Discoveries for orchestrator

- **ORCH-0824-G: Consumer tickets surface** — required follow-up. Consumers buy tickets but can't see them in-app. Critical for retention.
- **ORCH-0804-A: Stripe Tax on native checkout** — re-affirmed deferred. Brand carries tax compliance gap on native orders.
- **ORCH-0824-H (proposed): Save payment method to Mingla account** — currently Stripe creates fresh Customer per purchase via customer_email. Future ORCH could save Stripe customer_id on profiles + offer one-tap repeat purchases.
- **Native build cycle** — first install of `@stripe/stripe-react-native` requires `eas build`. Subsequent updates ship via OTA. Operator approved.
- **Apple Pay merchantIdentifier value** — implementor must confirm with operator before native rebuild whether to reuse `merchant.com.sethogieva.minglabusiness` or provision a new `merchant.com.sethogieva.mingla`.

---

## 14. Deploy notes

1. Operator: confirm `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in app-mobile EAS env (`eas env:list production`).
2. Operator: confirm Apple Pay merchantIdentifier value.
3. Implementor: complete all 18 steps in §11.
4. Operator: `eas build --platform ios --profile production` + submit to TestFlight.
5. Operator: `eas build --platform android --profile production` + upload to Play Store internal track.
6. Operator: run the 15-row test matrix on the TestFlight build.
7. Once smoke-clean on TestFlight: submit to App Store + promote Play Store to production.
8. Subsequent updates to ticket-buy flow go via OTA (mingla-business + app-mobile separately, per `feedback_eas_update_no_web.md`).

---

NEXT HANDOFF — paste into Codex `implementor-mingla` (or Claude `mingla-implementor`):

Implement ORCH-0824-F Phase 2 per the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`. 18-step implementation order in §11. The big rocks: harmonize design tokens between app-mobile and mingla-business; install `@stripe/stripe-react-native@0.50.3` in app-mobile (requires `eas build` — operator-gated); extract `PublicEventBody` from `PublicEventPage` as a parity-locked component (byte-equivalent in both apps; CI gate enforces); copy Stripe payment-sheet wrapper files verbatim from mingla-business to app-mobile (also parity-locked); write a new `consumerTicketCheckoutService` that calls the existing `ticket-checkout-create` edge fn with `surface: "native"`, presents PaymentSheet, then fires a calendar add (mirroring the existing `CalendarButton.tsx` pattern with 4-tier alarms). Operator-locked decisions: PaymentSheet UI, calendar add only after successful payment, profile always complete (defensive only), shared component via parity-locked triplicate, multi-tier cart, deferred "My Tickets" surface to ORCH-0824-G. Hard guards: NO DB migrations, NO new edge functions, NO changes to existing mingla-business buyer flow files (`/checkout/[eventId]/*.tsx`), NO Stripe Tax integration on native (deferred), NO retry prompt on calendar permission denial. Three new CI parity gates required (`event-taxonomy-parity` already exists, add `public-event-body-parity` and `stripe-payment-sheet-parity`). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. On completion, write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`. Downstream: native rebuild via `eas build` (operator), TestFlight smoke against the 15-row test matrix, then Claude `mingla-forensics` (TEST mode) for code-level verification, then CLOSE.
