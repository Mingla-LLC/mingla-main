# SPEC — ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert + in-app-browser stuck after payment]

**Mode:** SPEC
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec author:** Claude `mingla-forensics`
**Operator directive (2026-05-17):** "we should never have an issue like this. Lets make our engineering bullet proof so we dont have to face an issue like this" — Layer 1 (synchronous confirm via direct Stripe API) + Layer 3 (Realtime subscription safety net). Layer 2 (pre-created pending orders) dropped as overkill.

---

## Goal (one sentence)

Eliminate the architectural race between Stripe webhook delivery and buyer page-arrival by making the buyer's client own the confirmation path (synchronous direct-Stripe-API call) with a Realtime subscription as final safety net — so buyers see their tickets within ~1 second of payment, every time, regardless of webhook latency.

---

## Scope

Five bounded sub-deliverables, all shipped in a single ORCH-0852 CLOSE:

| Sub-deliverable | Surface | Files touched |
|---|---|---|
| **M-SERVER** New `ticket-checkout-confirm` edge function (direct Stripe API verify + idempotent finalize) | server | `supabase/functions/ticket-checkout-confirm/index.ts` (new), `supabase/functions/_shared/ticketCheckout.ts` (helper additions if needed) |
| **M0** Business native checkout — fire-and-forget + synchronous confirm | business iOS, business Android | `mingla-business/app/checkout/[eventId]/payment.tsx` (only) |
| **M1** Buyer-web `/confirm` — synchronous confirm + Realtime safety net | buyer-web (`mingla-business` web export) | `mingla-business/app/checkout/[eventId]/confirm.tsx`, `mingla-business/src/services/ticketCheckoutService.ts` (add `confirmTicketCheckout` invoke wrapper), new hook `mingla-business/src/hooks/useOrderRealtimeSubscription.ts` |
| **M2** QR carousel height fix on web | buyer-web, possibly business-iOS-web-preview | `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (only) |
| **M3** Hide wallet stub buttons | buyer-web, business iOS, business Android | `mingla-business/app/checkout/[eventId]/confirm.tsx`, `mingla-business/app/o/[orderId].tsx` (delete the wallet rows in both) |

## Non-goals (explicitly out of scope)

| Non-goal | Why it's out of scope |
|---|---|
| Consumer app (`app-mobile/`) | Already works correctly — must not regress. Will adopt synchronous confirm in a separate ORCH at operator's discretion. |
| Stripe webhook handler (`supabase/functions/stripe-webhook/index.ts`) | Stays as existing backup path — no change. The new `ticket-checkout-confirm` is idempotent with the webhook; whichever runs first wins, the second is a no-op. |
| `reconcile-stuck-checkouts` edge function | Stays as final cron-style safety net for orders that slip through both synchronous confirm AND webhook. No change. |
| Pre-creating pending orders at checkout-create time | Dropped as overkill per operator directive — synchronous confirm finalizes within ~1s so pre-creation gains nothing. |
| Building real Apple `.pkpass` / Google Wallet JWT issuance | Future ORCH-XXXX [Wallet pass issuance]. |
| `Session 90defa2d` cosmetic leak in `payment.tsx:510` | P3 cosmetic; register as follow-up ORCH. |
| `pollTicketCheckoutStatus` function itself | Becomes unused on the M0 + M1 paths. Leave in place for the existing legacy callers (if any); flag as deprecated in a follow-up cleanup ORCH after this lands. |

## Assumptions

- Stripe API `/v1/payment_intents/{id}` retrieval is fast (p99 <500ms) and reliable (Stripe's SLA is ~99.99%). Industry-standard pattern recommended by Stripe's own docs.
- `biz_ticket_checkout_finalize` RPC is idempotent — calling it twice (once from synchronous confirm, once from webhook) is safe. If not already idempotent, M-SERVER includes adding `ON CONFLICT DO NOTHING` / status-guard so it is.
- Supabase Realtime is enabled on `orders` table (or can be enabled via migration). If not enabled, M1's Realtime hook needs a migration to add `orders` to the `supabase_realtime` publication.
- The existing `ticket-checkout-status` edge function stays in place (used by legacy `pollTicketCheckoutStatus` and not removed in this ORCH).
- Buyer's `buyerStatusToken` is available when arriving at `/confirm?cs=…` — already persisted in sessionStorage via `writeCheckoutResumePayload` at `payment.tsx:265-270`.

---

## Phase 2.5 — Cross-Surface Impact

| Surface | Affected by | User-visible behaviour after fix | Parity |
|---|---|---|---|
| **Consumer iOS** (`app-mobile/`) | None | No change | N/A — out-of-scope |
| **Consumer Android** (`app-mobile/`) | None | No change | N/A — out-of-scope |
| **Buyer/anon Web** (`mingla-business/` web export) | M-SERVER, M1, M2, M3 | After Stripe success: lands on `/confirm`, synchronous confirm fires within ~1s and renders full order + QR. If sync confirm slow/failed: brief "Confirming your tickets…" state with Realtime listening; QR appears as soon as webhook backs the order. No retry button, no help link, no dead-end fallback. | Automatic |
| **Business iOS** (`mingla-business/` native) | M-SERVER, M0, M3 | After PaymentSheet `succeeded`: synchronous confirm fires (~1s) to guarantee order exists, then toast "Ticket secured!" + auto-navigate to event page. If sync confirm fails: toast still shown, navigation still happens, order materializes later via webhook + tickets-list refetch. Never stuck. | Automatic with Android |
| **Business Android** (`mingla-business/` native) | M-SERVER, M0, M3 | Same as iOS | Automatic with iOS |
| **Admin Web** (`mingla-admin/`) — adjacent | None | No change | N/A |
| **Business Web preview** (`mingla-business/` web dev) — adjacent | M-SERVER (server-side), M2 | Multi-ticket QR renders correctly; sync confirm uses the same edge function | Automatic with buyer-web |

---

## Per-Layer Specification

### M-SERVER — `ticket-checkout-confirm` edge function

**New file:** `supabase/functions/ticket-checkout-confirm/index.ts`

**HTTP:** `POST /functions/v1/ticket-checkout-confirm`
**Auth:** none (anon-tolerant per `I-ANON-BUYER-ROUTES`); access gated by `buyerStatusToken` matching the session.
**`verify_jwt`:** `false` (matches `ticket-checkout-status` convention).

**Request shape:**
```ts
{
  checkoutSessionId: string;  // ticket_checkout_sessions.id
  buyerStatusToken: string;   // raw token; server hashes for comparison
}
```

**Response shape — happy path:**
```ts
{
  checkoutSessionId: string;
  status: "paid" | "pending" | "failed" | "expired";
  order: {
    orderId: string;
    eventId: string;
    paymentStatus: "paid";
    totalCents: number;
    currency: string;
    taxAmountCents: number;
    tickets: Array<{
      ticketId: string;
      ticketTypeId: string;
      ticketName: string;
      qrPayload: string;
      status: string;
    }>;
    notificationStatus: "queued" | "sent";
  } | null;  // null only when Stripe says payment not yet succeeded
}
```

**Response shape — error path:** matches existing `ticket-checkout-status` error shapes (`{ error: "...", detail?: "..." }` with appropriate HTTP code).

**Logic (server-side):**

1. Parse + validate `checkoutSessionId` + `buyerStatusToken`. Reject malformed with 400.
2. Look up `ticket_checkout_sessions` row by `checkoutSessionId`. Reject 404 if missing.
3. Verify `sha256Hex(buyerStatusToken) === session.buyer_status_token_hash`. Reject 403 if mismatch.
4. **If `session.order_id` is non-null** (webhook beat us): skip Stripe API call, fetch order + tickets exactly like `ticket-checkout-status:41-86` and return them. Idempotent fast-path.
5. **If `session.order_id` is null:** call Stripe API directly:
   - `stripe.paymentIntents.retrieve(session.stripe_payment_intent_id, { stripeAccount: session.stripe_account_id })` (Connect direct-charge per ORCH-0843)
   - If `paymentIntent.status === "succeeded"`:
     - Call `biz_ticket_checkout_finalize` RPC with the session ID
     - RPC creates the orders row + tickets atomically (existing logic the webhook uses today)
     - Re-fetch the now-populated session.order_id + tickets and return them
     - **The RPC MUST be idempotent.** If `session.order_id` was populated between step 4 and step 5 by a concurrent webhook, the RPC should detect the existing order and no-op. See "RPC idempotency contract" below.
   - If `paymentIntent.status === "processing"` (rare — e.g., bank-debit methods): return `{ status: "pending", order: null }`. Client will fall through to Realtime.
   - If `paymentIntent.status` is `"canceled"` / `"failed"` / `"requires_payment_method"`: return `{ status: "failed", order: null }`. Client renders error state.
   - If Stripe API call throws (network error, Stripe outage): return 502 with `{ error: "stripe_unavailable" }`. Client falls through to Realtime + waits for webhook backup.

**RPC idempotency contract (verify or implement):**
- Read current `biz_ticket_checkout_finalize` RPC SQL definition.
- It MUST: (a) check if `ticket_checkout_sessions.order_id` is already non-null and if so, return the existing order without re-creating; (b) use `INSERT ... ON CONFLICT DO NOTHING` for the orders row; (c) use `INSERT ... ON CONFLICT DO NOTHING` for the tickets rows.
- If current implementation doesn't satisfy this, add a migration to make it idempotent. M-SERVER includes that migration if needed.

**Concurrency:** synchronous confirm and webhook can fire within milliseconds of each other. Both call the same idempotent RPC. Whichever wins commits first; the other gets the same order back from step 4's fast-path on its next read.

**Imports + structure:** mirror `supabase/functions/ticket-checkout-status/index.ts:1-7` for shared utilities; add a Stripe client import using the same pattern as `supabase/functions/ticket-checkout-create/`.

**Success criteria:**

| ID | Criterion |
|---|---|
| SC-SERVER-1 | `POST ticket-checkout-confirm` with valid session + token + already-finalized order returns the full order in <300ms (fast-path, no Stripe API call). |
| SC-SERVER-2 | `POST ticket-checkout-confirm` with valid session + token + paid-but-not-yet-finalized Stripe PI returns the full order in <2s (slow-path: Stripe API + RPC). |
| SC-SERVER-3 | Concurrent webhook + synchronous confirm against the same session never produces duplicate orders, duplicate tickets, or RPC errors. |
| SC-SERVER-4 | Invalid `buyerStatusToken` returns 403. |
| SC-SERVER-5 | Unknown `checkoutSessionId` returns 404. |
| SC-SERVER-6 | Stripe API outage returns 502 with `{ error: "stripe_unavailable" }`. Client error handling does not show a misleading "payment failed" state. |
| SC-SERVER-7 | The Stripe webhook handler (`supabase/functions/stripe-webhook/index.ts`) is byte-identical to its pre-fix state — zero diff. Strict-grep gate enforces. |
| SC-SERVER-8 | The existing `ticket-checkout-status` edge function is byte-identical — zero diff. |
| SC-SERVER-9 | `biz_ticket_checkout_finalize` RPC is verified (or made) idempotent. The verification SQL probe is captured in the implementation report. |

---

### M0 — Business native checkout

**File:** `mingla-business/app/checkout/[eventId]/payment.tsx` (only)

**What to remove (same as previous SPEC version):**
- `finalizing` / `finalizingTimedOut` state machine and all renders that depend on them
- `finalizingRef` ref + its cleanup useEffect
- `disabled={processing || finalizingTimedOut}` → `disabled={processing}`
- The `recordResult({ ... })` block at L375-387
- The `pollTicketCheckoutStatus(sessionId, "")` call at L356

**What to do instead — synchronous confirm via the new edge function, then fire-and-forget navigation:**

```ts
// AFTER outcome.outcome === "succeeded":
mixpanelService.track("ticket_checkout_succeeded", { surface, eventId, checkoutSessionId: outcome.orderId });

// Synchronous confirm — guarantees the order exists server-side before we navigate.
// New service wrapper from M1: confirmTicketCheckout(sessionId, buyerStatusToken).
let confirmedOrder: ConfirmedOrder | null = null;
try {
  const confirmResult = await confirmTicketCheckout(outcome.orderId, "");
  if (confirmResult.order) {
    confirmedOrder = confirmResult.order;
  }
} catch (err) {
  // Confirm failed — but PaymentSheet already succeeded, so payment captured.
  // Webhook backup will create the order. Log + proceed to navigation.
  console.warn("[checkout-payment] synchronous confirm failed; relying on webhook backup", err);
  mixpanelService.track("ticket_checkout_sync_confirm_failed", { surface, eventId, checkoutSessionId: outcome.orderId });
}

void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

// Toast: render <Toast> via state (Q4 default — copy the existing declineToast pattern at L559-566).
setSuccessToast(true);  // new state, toggled false after 3s via setTimeout in a useEffect

// Background invalidation — refresh any visible orders lists.
let attempts = 0;
const interval = setInterval(() => {
  attempts += 1;
  queryClient.invalidateQueries({ queryKey: ["buyerOrders"] });
  if (attempts >= 3) clearInterval(interval);
}, 1000);

// Navigate away (Q1 default — event page).
router.replace(`/e/${event.brandSlug}/${event.eventSlug}` as never);
```

**Toast wiring:** add `const [successToast, setSuccessToast] = useState<boolean>(false);` near the existing `declineToast` state. Render a new `<Toast visible={successToast} kind="success" message="Ticket secured! Check your tickets list." onDismiss={() => setSuccessToast(false)} />` inside the existing `<View style={styles.toastWrap}>` wrapper.

**Note on race:** the toast is shown BEFORE `router.replace` fires. On Expo Router native, `router.replace` unmounts the current screen; the toast (rendered inside `payment.tsx`) unmounts with it. To survive the navigation, the toast should fire from the destination route, not the source. **Two options:**
- **Option α** (recommended): pass a one-shot success flag via global state or query param, render the toast on `/e/{brandSlug}/{eventSlug}` route mount.
- **Option β** (simpler): show the toast for 1.2s BEFORE navigating (`setTimeout(() => router.replace(...), 1200)`). Brief delay so the buyer sees the confirmation.

Implementor: choose **Option β** unless it feels janky on device; document the choice.

**Success criteria:**

| ID | Criterion |
|---|---|
| SC-M0-1 | After PaymentSheet returns `succeeded`, the app calls `ticket-checkout-confirm` synchronously. |
| SC-M0-2 | On `ticket-checkout-confirm` success (with order returned): success toast shown + navigate to event page within 1.5s of PaymentSheet success. |
| SC-M0-3 | On `ticket-checkout-confirm` failure (network error, 502, etc.): success toast still shown + navigate still fires. `ticket_checkout_sync_confirm_failed` Mixpanel event fires. Webhook backup eventually finalizes the order. |
| SC-M0-4 | `finalizing` / `finalizingTimedOut` / "Payment received" / "Finalizing your tickets" code paths are deleted from `payment.tsx`. Strict-grep gate enforces zero matches. |
| SC-M0-5 | The Pay button is never seen disabled-after-payment-success. Once PaymentSheet returns `succeeded`, the screen unmounts via `router.replace` within 1.5s. |
| SC-M0-6 | If the server-side confirm takes 30+ seconds to respond (simulated): UI still navigates within 1.5s (because the await on `confirmTicketCheckout` has a client-side timeout — see implementation detail) + toast fires. Webhook backs the order; tickets-list refetch on the destination route picks it up. |
| SC-M0-7 | `app-mobile/src/payments/nativeCheckoutFlow.ts` AND `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` are byte-identical to their pre-fix state. CI gate enforces. |

**Implementation detail — client-side timeout on `confirmTicketCheckout`:** wrap the await in `Promise.race([confirmTicketCheckout(...), new Promise((_, reject) => setTimeout(() => reject(new Error("client_confirm_timeout")), 3000))])`. If the server takes >3s, we abort the await, log, and proceed to navigation. This guarantees the UI is responsive even if the server is slow — the user is NEVER blocked on the network.

---

### M1 — Buyer-web `/confirm`

**Files:**
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/services/ticketCheckoutService.ts` (add `confirmTicketCheckout` wrapper)
- `mingla-business/src/hooks/useOrderRealtimeSubscription.ts` (new)

**What to remove:**
- The entire web-resume polling block at `confirm.tsx:162-243` (calls `pollTicketCheckoutStatus`)
- The `webResumeError` state + fallback render at `confirm.tsx:309-328`
- The "Payment received" hero copy (now lives only in deleted code)

**What to add — synchronous confirm on mount, Realtime subscription as safety net:**

```ts
// On mount, if Platform.OS === "web" and ?cs= is in URL:
useEffect(() => {
  if (Platform.OS !== "web") return;
  if (eventId === null) return;
  if (result !== null) return;
  const win = (globalThis as unknown as { sessionStorage?: Storage; location?: { search?: string } });
  const search = win.location?.search ?? "";
  if (!/[?&]cs=/.test(search)) return;
  const payload = readCheckoutResumePayload(win.sessionStorage, eventId);
  if (payload === null) return;

  // Restore cart context for visual continuity (same as before).
  // ... (existing restore code at L177-192) ...

  let cancelled = false;
  (async () => {
    try {
      // Synchronous confirm — primary path. ~1s typical.
      const confirmResult = await confirmTicketCheckout(
        payload.checkoutSessionId,
        payload.buyerStatusToken,
      );
      if (cancelled) return;
      if (confirmResult.order) {
        // Happy path: order exists. Populate the screen.
        const taxCents = Number(confirmResult.order.taxAmountCents ?? 0);
        recordResult({
          orderId: confirmResult.order.orderId,
          // ... (same shape as before, lines 213-227) ...
        });
        clearCheckoutResumePayload(win.sessionStorage, eventId);
        return;
      }
      // Confirm returned status: pending — payment processing (rare; e.g., bank debit).
      // Fall through to Realtime subscription below.
    } catch (err) {
      // Confirm errored. Could be 502 (Stripe outage), network, etc.
      // Don't show an error — fall through to Realtime subscription. Webhook will back the order.
      if (cancelled) return;
      console.warn("[checkout-confirm] synchronous confirm failed, falling back to realtime", err);
      setRealtimePending(true);  // triggers the Realtime hook below
    }
  })();
  return () => { cancelled = true; };
}, [eventId, result]);

// Realtime safety net — only mounts if sync confirm couldn't return the order.
const [realtimePending, setRealtimePending] = useState<boolean>(false);
useOrderRealtimeSubscription({
  checkoutSessionId: realtimePending ? sessionIdFromPayload : null,
  onOrderReady: (order) => {
    recordResult({ ...order });  // mirror the shape recordResult expects
    setRealtimePending(false);
    clearCheckoutResumePayload(...);
  },
});
```

**Pending UI:** while `result === null AND realtimePending === true`, render a small "Confirming your tickets…" hero (replaces the deleted webResumeError fallback). NO retry button, NO help link — just a calm "Confirming your tickets…" message with a subtle spinner. The Realtime subscription resolves it the moment the webhook lands. Typical wait: 0-5 seconds. P99 wait: <30 seconds.

**Service wrapper** in `ticketCheckoutService.ts` (mirror `getTicketCheckoutStatus` at L112-119):
```ts
export interface TicketCheckoutConfirmResult {
  checkoutSessionId: string;
  status: "paid" | "pending" | "failed" | "expired";
  order: TicketCheckoutStatusResult["order"];  // reuse existing shape
}

export const confirmTicketCheckout = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<TicketCheckoutConfirmResult> =>
  invokeOrThrow<TicketCheckoutConfirmResult>("ticket-checkout-confirm", {
    checkoutSessionId,
    buyerStatusToken,
  });
```

**Realtime hook** `useOrderRealtimeSubscription.ts` (new):

```ts
import { useEffect } from "react";
import { supabase } from "../services/supabase";  // adjust path to existing client
import type { TicketCheckoutStatusResult } from "../services/ticketCheckoutService";

export interface UseOrderRealtimeSubscriptionArgs {
  checkoutSessionId: string | null;
  onOrderReady: (order: NonNullable<TicketCheckoutStatusResult["order"]>) => void;
}

export const useOrderRealtimeSubscription = ({
  checkoutSessionId,
  onOrderReady,
}: UseOrderRealtimeSubscriptionArgs): void => {
  useEffect(() => {
    if (checkoutSessionId === null) return;

    // Subscribe to changes on ticket_checkout_sessions filtered to our session.
    // When session.order_id transitions from null → non-null, the webhook has fired.
    const channel = supabase
      .channel(`checkout-session-${checkoutSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_checkout_sessions",
          filter: `id=eq.${checkoutSessionId}`,
        },
        async (payload) => {
          const newRow = payload.new as { order_id?: string | null };
          if (!newRow.order_id) return;
          // order_id is now populated — fetch the full order + tickets.
          // Reuse confirmTicketCheckout's fast-path (or call ticket-checkout-status).
          // For simplicity, use confirmTicketCheckout — it's idempotent.
          const result = await confirmTicketCheckout(checkoutSessionId, /* buyerStatusToken */ "");
          if (result.order) onOrderReady(result.order);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [checkoutSessionId, onOrderReady]);
};
```

**Realtime publication migration:** verify `ticket_checkout_sessions` is in the `supabase_realtime` publication. If not, add migration `supabase/migrations/{timestamp}_orch_0852_realtime_checkout_sessions.sql`:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_checkout_sessions;
```

**Success criteria:**

| ID | Criterion |
|---|---|
| SC-M1-1 | On `/confirm?cs=…` mount: `confirmTicketCheckout` is called synchronously within 100ms of mount. |
| SC-M1-2 | If webhook already fired before buyer arrives (fast-path on server): full order rendered in <500ms. |
| SC-M1-3 | If webhook hasn't fired but Stripe PI is succeeded (slow-path on server): full order rendered in <2s. |
| SC-M1-4 | If synchronous confirm errors (502, network, etc.): "Confirming your tickets…" calm pending state shown; Realtime subscription mounts. |
| SC-M1-5 | When webhook eventually fires (within 30s typical, days theoretical max via `reconcile-stuck-checkouts`): Realtime push triggers `confirmTicketCheckout` re-fetch; full order replaces the pending state automatically. |
| SC-M1-6 | The buyer NEVER sees: a "Payment received but tickets unavailable" dead-end screen, a "Check now" retry button, a "Help me find my order" link. These do not exist. |
| SC-M1-7 | If buyer refreshes the page during the Realtime-pending state: sync confirm fires again on mount; resolves whichever way it resolves. |
| SC-M1-8 | sessionStorage resume payload is cleared ONLY on confirmed success (preserved on pending/failure). |
| SC-M1-9 | `pollTicketCheckoutStatus` is no longer called from `confirm.tsx`. Strict-grep enforces. |
| SC-M1-10 | Existing happy-path Stripe-success-redirect to `/confirm?cs=…` still works for desktop Chrome, mobile Safari, in-app browser surfaces. |

---

### M2 — QR carousel multi-ticket height fix on web

**File:** `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (only)

**Verify first (mandatory implementor pre-step):** open `business.usemingla.com` in desktop Chrome (or run the web bundle locally), screenshot 1-ticket vs 2-ticket QR rendering before any code change. If 1-ticket is correct and 2-ticket is clipped, hypothesis confirmed. If both clip, escalate.

**Fix (apply only if verification confirms multi-ticket-only):**

1. Add `minHeight: 320` to `styles.host`.
2. Add `minHeight: 260` to `styles.page`.
3. Change `pageWidth` initial state from `Dimensions.get("window").width` to `0`; gate the multi-page render on `pageWidth > 0` (render bare `<View style={styles.host} onLayout={handleLayout} />` while waiting for first layout).
4. (Web-only safety net, add only if minHeight alone doesn't fix it during local verification): wrap multi-ticket ScrollView in `<View style={Platform.OS === "web" ? { height: 320 } : undefined}>`.

**Success criteria:**

| ID | Criterion |
|---|---|
| SC-M2-1 | Multi-ticket (2+) QR carousel renders FULL QRs at viewport widths 375px, 768px, 1280px on desktop Chrome. |
| SC-M2-2 | Single-ticket order continues to render correctly (no regression). |
| SC-M2-3 | Multi-ticket carousel renders FULL QRs on business iOS app (regression check). |
| SC-M2-4 | Multi-ticket carousel renders FULL QRs on business Android app (regression check). |
| SC-M2-5 | Swipe affordance and pagination dots continue to work. |
| SC-M2-6 | Pre-fix verification (1-ticket OK, 2-ticket clipped) documented with screenshots in implementation report. |

---

### M3 — Hide wallet stub buttons

**Files:**
1. `mingla-business/app/checkout/[eventId]/confirm.tsx` — remove wallet row at L428-460 + handler + state + unused imports.
2. `mingla-business/app/o/[orderId].tsx` — remove wallet row at L428-460 + handler + state + `showAppleWallet`/`showGoogleWallet`/`isWeb` if unused.

Clean deletion per Constitution Rule 8. Add one-line comment at deletion site: `// Wallet pass buttons removed per ORCH-0852 — future ORCH-XXXX [Wallet pass issuance] will reintroduce when .pkpass + Google Wallet JWT infrastructure ships.`

**Success criteria:**

| ID | Criterion |
|---|---|
| SC-M3-1 | "Add to Apple Wallet" and "Add to Google Wallet" buttons no longer render anywhere in `mingla-business/`. |
| SC-M3-2 | `handleWalletAdd`, `walletToast` state, and "Coming soon" `<Toast>` deleted from both files. |
| SC-M3-3 | No TS errors after removal; unused imports cleaned up. |
| SC-M3-4 | Strict-grep gate `i-wallet-stubs-removed.mjs` passes (see Regression Prevention). |

---

## Implementation Order

Sequential — implementor follows this order; no parallel work:

1. **M2 verification step** (10 min) — confirm single-vs-multi hypothesis before any code changes. Capture before-screenshots.
2. **M3** (smallest, lowest risk) — hide wallet buttons in both files. Type-check.
3. **M2** (if verification confirmed multi-ticket-only) — apply minHeight + onLayout-only pageWidth. Type-check. Browser verification.
4. **M-SERVER** (server-side, can be deployed and tested independently before clients use it) — write `ticket-checkout-confirm` edge function, verify idempotent RPC, deploy via `supabase functions deploy ticket-checkout-confirm --project-ref gqnoajqerqhnvulmnyvv`, verify with curl against a real (or seeded) test session.
5. **M1** — wire `/confirm` to new confirm function + Realtime hook. Type-check. Browser verification with real purchase.
6. **M0** — wire native `payment.tsx` to new confirm function + fire-and-forget navigation. Type-check. iOS simulator verification with real PaymentSheet.

After all six steps: full type-check + lint + tests. Then implementation report with old→new receipts.

---

## Invariants

### Preserved

| Invariant | How preserved |
|---|---|
| `I-ANON-BUYER-ROUTES` | All buyer-facing routes remain anon-tolerant; new edge function uses `buyerStatusToken` for access control. |
| Constitution Rule 1 (No dead taps) | M3 removes dead-tap wallet buttons; M0 removes disabled-Pay-after-success; M1 removes dead-end fallback. |
| Constitution Rule 3 (No silent failures) | Sync confirm failures are logged + Mixpanel-tracked; webhook backup is honest backup not silent path. |
| Constitution Rule 8 (Subtract before adding) | M3 deletes; M0 + M1 delete poll-and-fail patterns before adding new ones. |
| Constitution Rule 9 (No fabricated affordances) | M3 removes fake wallet buttons. |
| `feedback_toast_needs_absolute_wrap` | M0 reuses existing top-anchored `<View style={styles.toastWrap}>` pattern. |
| Consumer flow byte-identical | Strict-grep gate `i-consumer-payment-flow-frozen.mjs` enforces. |
| Webhook handler byte-identical | Strict-grep gate `i-stripe-webhook-handler-frozen.mjs` enforces. |
| `ticket-checkout-status` byte-identical | Same gate as webhook (both server-side legacy paths frozen). |

### New invariants established

| ID | Invariant | Scope |
|---|---|---|
| `I-CHECKOUT-OWN-CONFIRM-PATH` | Client-side checkout flows MUST own the order confirmation path via synchronous `ticket-checkout-confirm` against Stripe's API directly. Buyer-visible UI MUST NOT depend on Stripe webhook arrival timing for success-state rendering. Webhook remains as backup. | `mingla-business/app/checkout/*`, `mingla-business/app/o/*`, future `app-mobile/` checkout (when migrated) |
| `I-CHECKOUT-NO-POLL-AND-FAIL` | Buyer-facing post-payment UI MUST NOT enter a "polled-and-gave-up" dead-end state. Fallbacks must be Realtime + webhook + email — never a stranded screen. | `mingla-business/app/checkout/*`, future `app-mobile/` checkout |
| `I-WALLET-PASS-HIDDEN-UNTIL-IMPLEMENTED` | Wallet pass affordances MUST NOT render until real `.pkpass` + Google Wallet JWT infrastructure ships. | `mingla-business/app/**/*` |
| `I-FINALIZE-RPC-IDEMPOTENT` | `biz_ticket_checkout_finalize` RPC MUST be idempotent — safe to call from synchronous confirm AND webhook concurrently. Verification probe in M-SERVER implementation report. | `supabase/migrations/*` (RPC definition) |

---

## Test Cases

| Test | Sub-deliverable | Scenario | Expected | Layer |
|---|---|---|---|---|
| T-SERVER-01 | M-SERVER | Confirm fast-path | Session already finalized; confirm returns order in <300ms | Edge function unit + integration |
| T-SERVER-02 | M-SERVER | Confirm slow-path | Stripe PI succeeded, order not yet finalized; confirm calls Stripe + finalize RPC, returns order | Integration |
| T-SERVER-03 | M-SERVER | Concurrent confirm + webhook | Both fire within 100ms; exactly one order + tickets created; both calls return identical order | Integration |
| T-SERVER-04 | M-SERVER | Stripe API 500 | Confirm returns 502 `stripe_unavailable` | Integration with mocked Stripe |
| T-SERVER-05 | M-SERVER | Invalid token | Confirm returns 403 | Unit |
| T-SERVER-06 | M-SERVER | RPC idempotency | Call finalize RPC twice with same session — second call no-ops, no duplicate rows | SQL probe |
| T-SERVER-07 | M-SERVER | Webhook unchanged | git diff against `stripe-webhook/index.ts` and `ticket-checkout-status/index.ts` is empty | CI gate |
| T-M0-01 | M0 | iOS native happy path | PaymentSheet success → sync confirm <1s → toast + navigate to event page | E2E (iOS sim) |
| T-M0-02 | M0 | iOS native slow-confirm | Server confirm delayed 30s; client times out at 3s, toast + navigate still happen at 1.5s mark; order materializes via webhook | E2E (iOS sim + simulated delay) |
| T-M0-03 | M0 | iOS native canceled | PaymentSheet dismissed; no toast, no navigation | E2E (iOS sim) |
| T-M0-04 | M0 | iOS native failed | Declined card; paymentError toast, no navigation | E2E (iOS sim) |
| T-M0-05 | M0 | No `finalizing*` state | Grep `payment.tsx` for `finalizingRef`, `finalizing`, `finalizingTimedOut`, "Payment received", "Finalizing your tickets" | Static — all 5 strings absent |
| T-M0-06 | M0 | Consumer flow frozen | git diff against `app-mobile/src/payments/`, `ExpandedBusinessEventSheet.tsx` empty | CI gate |
| T-M1-01 | M1 | Web happy path | Stripe success → `/confirm?cs=…` → sync confirm <500ms → full order + QR | E2E (Chrome) |
| T-M1-02 | M1 | Web slow webhook | Stripe success, webhook delayed 30s, sync confirm calls Stripe directly → full order in <2s without webhook | E2E (Chrome + simulated webhook delay) |
| T-M1-03 | M1 | Web sync-confirm error | Sync confirm returns 502; "Confirming your tickets…" pending state shown; Realtime subscription mounts | E2E (Chrome) |
| T-M1-04 | M1 | Web Realtime resolution | Pending state shown; webhook fires; Realtime push delivers; screen transitions to full order | E2E (Chrome + DB trigger) |
| T-M1-05 | M1 | Web no retry button | Inspect DOM in any state; no "Check now" button, no "Help me find my order" link | Static + E2E |
| T-M1-06 | M1 | sessionStorage preserved on pending | Pending state visible; sessionStorage entry still present | E2E |
| T-M1-07 | M1 | No `pollTicketCheckoutStatus` in confirm.tsx | Grep | Static |
| T-M2-01 | M2 | Pre-fix 1-ticket OK | Pre-fix Chrome screenshot 1× ticket — full QR visible | Manual |
| T-M2-02 | M2 | Pre-fix 2-ticket clipped | Pre-fix Chrome screenshot 2× ticket — clipped | Manual |
| T-M2-03 | M2 | Post-fix 2-ticket OK | Post-fix screenshot full QR | Manual |
| T-M2-04 | M2 | Post-fix 1-ticket OK | No regression | Manual |
| T-M2-05 | M2 | iOS native regression | 2-ticket order on iOS sim — full QR | Manual (iOS sim) |
| T-M2-06 | M2 | Android native regression | 2-ticket order on Android emu — full QR | Manual (Android emu) |
| T-M3-01 | M3 | No wallet buttons on /confirm web | DOM inspect | Static + E2E |
| T-M3-02 | M3 | No wallet buttons on /o/{orderId} web | DOM inspect | Static + E2E |
| T-M3-03 | M3 | No wallet buttons on business iOS | Visual | Manual (iOS sim) |
| T-M3-04 | M3 | No wallet buttons on business Android | Visual | Manual (Android emu) |
| T-IMPLEMENTOR-REGRESSION-1 | All | Implementor's happy-path test | New file `mingla-business/__tests__/orch-0852-sync-confirm-happy-path.test.ts` — covers M0 + M1 + M-SERVER happy paths; fails on revert | Jest |
| T-TESTER-ADVERSARIAL-1 | All | Tester's adversarial test (different angle) | New file `mingla-business/__tests__/orch-0852-webhook-stall-bulletproof.test.ts` — simulates 60s webhook stall + Stripe API 500; verifies buyer is never stranded, Realtime resolves eventually | Jest |

---

## Regression Prevention

Five new CI gates plug into `.github/workflows/strict-grep-mingla-business.yml`:

| Gate | Purpose |
|---|---|
| `i-checkout-own-confirm-path.mjs` | `mingla-business/app/checkout/*.tsx` MUST contain a call to `confirmTicketCheckout` AND MUST NOT contain `pollTicketCheckoutStatus`. Enforces `I-CHECKOUT-OWN-CONFIRM-PATH`. |
| `i-checkout-no-poll-and-fail.mjs` | `payment.tsx`, `confirm.tsx`, `o/[orderId].tsx` MUST NOT contain `finalizing`, `finalizingTimedOut`, `webResumeError`, OR the literals `"Payment received"`, `"Finalizing your tickets"`, `"Check now"`, `"Help me find my order"`. Enforces `I-CHECKOUT-NO-POLL-AND-FAIL`. |
| `i-wallet-stubs-removed.mjs` | `mingla-business/` MUST NOT contain `"Add to Apple Wallet"` or `"Add to Google Wallet"`. Enforces `I-WALLET-PASS-HIDDEN-UNTIL-IMPLEMENTED`. |
| `i-consumer-payment-flow-frozen.mjs` | `app-mobile/src/payments/nativeCheckoutFlow.ts` + `ExpandedBusinessEventSheet.tsx` byte-identical. Removable in future ORCH via `[CONSUMER-MOD-APPROVED ORCH-NNNN]` token. |
| `i-server-side-checkout-legacy-frozen.mjs` | `supabase/functions/stripe-webhook/index.ts` + `supabase/functions/ticket-checkout-status/index.ts` byte-identical to merge-base SHA. Removable via `[LEGACY-MOD-APPROVED ORCH-NNNN]` token. |

Plus two mandatory regression tests per Step 0.5:
1. `mingla-business/__tests__/orch-0852-sync-confirm-happy-path.test.ts` (implementor)
2. `mingla-business/__tests__/orch-0852-webhook-stall-bulletproof.test.ts` (tester adversarial)

Both immutable after landing per `.github/workflows/tests-append-only.yml`.

---

## Open Questions for Operator

All previous Q1-Q4 are now answered or obsolete:

- **Q1 (where to navigate after M0 success)** → **A** event page `/e/{brandSlug}/{eventSlug}`. **Confirmed.**
- **Q2 (web help link target)** → **OBSOLETE** — bulletproof architecture removes the need for a help link.
- **Q3 (localStorage 24h fallback)** → **OBSOLETE** — bulletproof architecture removes the need for sessionStorage recovery.
- **Q4 (toast utility)** → **A** business has a comparable utility (or render `<Toast>` via state mirroring existing `declineToast`). **Confirmed.**

One new question raised by the bulletproof rewrite:

- **Q5 (consumer parity follow-up):** consumer app (`app-mobile/`) does NOT get the synchronous confirm in this ORCH (out-of-scope per "no consumer regressions"). It continues to rely on webhook only (which works fine because consumer's UX is already fire-and-forget). Do you want a follow-up ORCH-0853 registered to migrate consumer to synchronous confirm for architectural parity, or leave consumer alone indefinitely? **Default if no answer:** register ORCH-0853 [Consumer-app synchronous checkout confirm parity] as a future-low-priority queue item.

---

## Layman summary

- **What we're shipping (bulletproof version):** instead of waiting for Stripe's webhook to tell our app "the order is ready", our app now asks Stripe DIRECTLY the moment the buyer pays. Stripe responds within ~1 second with the payment status, and our server creates the order on the spot. The buyer sees their QR within 1-2 seconds, every time. If for ANY reason that fails, we have two safety nets: the webhook still fires in the background and creates the order (existing behavior), AND the buyer's page listens via Supabase Realtime so it auto-updates the moment the order materializes — no retry button, no help link, no dead screens.
- **What "bulletproof" actually means here:** the failure mode that stranded you (race between webhook and page polling) does not exist anymore. You'd have to lose THREE independent systems simultaneously (Stripe's API, Stripe's webhooks, AND Supabase Realtime) to see a stranded buyer — and even then there's a final cron-style reconciliation job that catches anything that slips through.
- **What's NOT in scope:** consumer app stays untouched (it works fine and you said no regressions). Webhook handler stays untouched. `ticket-checkout-status` stays untouched. Wallet pass build-out stays a future ORCH. The `Session 90defa2d` cosmetic leak stays a P3 follow-up.
- **What changed since the band-aid version:** the SPEC now includes a new server-side edge function `ticket-checkout-confirm` that calls Stripe's API directly, a new Realtime subscription hook for the web confirm page, and verification that the existing `biz_ticket_checkout_finalize` RPC is idempotent (so the server-side sync call and the webhook can safely both create the order — only one wins, the other no-ops). All three layers of safety.
- **Cost:** ~3-4 days of implementation work (vs ~1-2 for the band-aid). Worth it — this is the right architecture and we never see this class of bug again.
- **What you, Seth, need to do at SPEC-approval time:** answer Q5 (register a consumer parity follow-up ORCH, yes or no) or accept the default. Then reply "dispatch implementor" and I write the implementor prompt.

---

**Status:** SPEC complete (bulletproof rewrite). Ready for implementor dispatch after operator answers Q5 or accepts default.
