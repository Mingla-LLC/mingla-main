# SPEC — ORCH-0839-B: Stripe Hosted Checkout pivot for mingla-business mobile (replace native PaymentSheet with `expo-web-browser` → hosted Checkout Session)

**Mode:** SPEC (no product code, no migrations, no deploys)
**Spec writer:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Parent:** ORCH-0839 (parent OPEN until this child closes)
**Predecessor:** ORCH-0839-A (CLOSED 2026-05-14, PR #88, OTA live)
**Authoritative inputs (Phase 0):**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` (§D-1, §D-3, §D-5 — pivot rationale)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` (what ORCH-0837 patched; what it explicitly did NOT solve)
- `Mingla_Artifacts/specs/SPEC_ORCH-0839-A_DISCOVER_HARDENING.md` (§Decision C — Spec B is the EAS-rebuild handoff)
- `Mingla_Artifacts/prompts/SPEC_PROMPT_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` (dispatch)
- `supabase/functions/ticket-checkout-create/index.ts:1-416` (canonical edge function surface)
- `mingla-business/src/services/ticketCheckoutService.ts:1-139` (the contract callers already use)
- `mingla-business/src/payments/{stripePaymentSheet.ts, stripePaymentSheet.native.ts, stripePaymentSheet.web.ts, StripeNativeProvider.{tsx,native.tsx,web.tsx}, normalizePaymentSheetResult.ts}`
- `mingla-business/app/checkout/[eventId]/{payment.tsx, confirm.tsx, buyer.tsx, index.tsx, _layout.tsx}`
- `mingla-business/app/_layout.tsx:34, 226-230` (StripeNativeProvider mount point)
- `mingla-business/src/components/brand/BrandOnboardView.tsx:97, 343-400` (the canonical `openAuthSessionAsync` pattern already shipped in this app for Stripe Connect onboarding — pattern reused here)
- `mingla-business/app.config.ts:38, 61-66` (scheme = `mingla-business`; stripe-react-native plugin entry to remove)
- `packages/payments-native/{useStripePaymentSheet.ts, StripeNativeProvider.tsx, index.ts, types.ts, normalizePaymentSheetResult.ts}` (shared native package; mingla-business stops consuming it)
- `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs:94-120` (the gate whose status this spec MUST resolve)
- `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs:10-13` (the gate whose allow-list this spec MUST shrink)

---

## 1. SCOPE

**In scope (single PR, no partial ship):**

| # | Fix | Layer | Source location |
|---|-----|-------|-----------------|
| F-1 | Mobile (iOS+Android) Pay button calls `ticket-checkout-create` with `surface: "web"` (same surface web buyers already use). Service returns `requires_web_redirect.hostedCheckoutUrl`. | Service caller + edge contract (no edge change) | `mingla-business/app/checkout/[eventId]/payment.tsx:188-358`; `supabase/functions/ticket-checkout-create/index.ts:175-312` (no diff) |
| F-2 | `payment.tsx` opens the hosted URL via `WebBrowser.openAuthSessionAsync(hostedCheckoutUrl, returnUrl)` instead of the native `useStripePaymentSheet.initPaymentSheet/presentPaymentSheet` pair. | Component | `mingla-business/app/checkout/[eventId]/payment.tsx` |
| F-3 | After `openAuthSessionAsync` resolves, branch on `browserResult.type` ∈ `{"success","cancel","dismiss","locked","opened"}`, then poll `pollTicketCheckoutStatus(checkoutSessionId, buyerStatusToken)` to confirm order paid before `router.replace` to `/confirm`. | Component | `mingla-business/app/checkout/[eventId]/payment.tsx` |
| F-4 | New return-URL deep link constant `mingla-business://checkout/return?cs={checkoutSessionId}` and a successful `success_url` on the Checkout Session that lands buyers BACK INTO the in-app browser (Stripe redirects → app intercepts because scheme matches → `openAuthSessionAsync` resolves with `type:"success"`). | Edge function + Component | `supabase/functions/ticket-checkout-create/index.ts:247-249` (extend) + `mingla-business/app/checkout/[eventId]/payment.tsx` |
| F-5 | Collapse `mingla-business/src/payments/StripeNativeProvider.{native,web,_}.tsx` to a single shared no-op pass-through; `app/_layout.tsx:226-230` no longer wraps the tree in any Stripe-aware provider. | Provider tree | `mingla-business/app/_layout.tsx`; `mingla-business/src/payments/StripeNativeProvider*.tsx` |
| F-6 | Remove every `import` from `@stripe/stripe-react-native` and from `@mingla/payments-native` in `mingla-business/src/` and `mingla-business/app/`. Drop the Expo plugin entry `["@stripe/stripe-react-native", {...}]` from `app.config.ts:61-66`. Drop `@stripe/stripe-react-native` and `@mingla/payments-native` from `mingla-business/package.json` dependencies (the consumer app `app-mobile/` and the shared package itself MUST stay untouched). | Native build config + deps | `mingla-business/app.config.ts`; `mingla-business/package.json` |
| F-7 | New CI strict-grep gate `orch-0839-b-mingla-business-no-native-stripe.mjs` proves F-6 + F-5 (no `@stripe/stripe-react-native` import, no `@mingla/payments-native` import, no `StripeProvider` JSX, plugin entry absent). Retire the ORCH-0789 §4 + §5 + ORCH-0778 mingla-business assertions per §6.3 below. | CI | `.github/scripts/strict-grep/`; `.github/workflows/strict-grep-mingla-business.yml` |
| F-8 | Telemetry parity — every event the native PaymentSheet emitted (`mixpanel "ticket_checkout_pay_started"`, `..._sheet_opened`, `..._succeeded`, `..._cancelled`, `..._failed`) emits an equivalent in the hosted flow. | Service + Component | `mingla-business/app/checkout/[eventId]/payment.tsx` + `mingla-business/src/services/mixpanelService.ts` (existing emitter) |

**Non-goals (explicit — do NOT touch in this spec):**

1. `app-mobile/` (consumer app) Stripe integration — consumer subscriptions stay on RevenueCat, ticket purchases stay on the existing app-mobile path. This SPEC touches mingla-business ONLY.
2. `packages/payments-native/` — the shared package stays in place because app-mobile still imports it. Only mingla-business's consumption is severed. The package itself is NOT decommissioned in this ORCH; that's a follow-up if app-mobile also pivots later.
3. Changes to `ticket-checkout-create` business logic — Stripe Tax, application fee, destination-charge wiring, idempotency, RPC `biz_ticket_checkout_create_session`, `event_dates` precondition (line 69-83), buyer status token, free-ticket path. All preserved verbatim. The only edit is widening `success_url` / `cancel_url` resolution to handle the mobile-hosted case (§2.2 below).
4. Apple Pay / Google Pay surfacing — Stripe's hosted Checkout enables both automatically once the platform's Stripe Dashboard has them enabled at the destination account level. No client-side toggle in this ORCH. ORCH-0838 owns Apple Pay merchant-cert verification end-to-end.
5. `app-mobile`'s native PaymentSheet bug (the bridgeless + iOS 26 hang per ORCH-0833-0834-rescoped §D-1) — out of scope here. Tracked separately.
6. Web buyer flow — already on hosted Checkout via `surface: "web"`; ZERO functional change. Only the `success_url` / `cancel_url` resolution code path is touched (see §2.2 — the existing `MINGLA_PUBLIC_WEB_BASE_URL`-based URLs stay identical for `surface: "web"`).
7. Removing `@stripe/stripe-react-native` from `packages/payments-native/` or `app-mobile/`.
8. `newArchEnabled` flip — keep the current `app.json` value. The point of this pivot is that the flag no longer matters for mingla-business buyer flow. ORCH-0838 may revisit.
9. Cosmetic redesigns of `payment.tsx`. Behavioural-pivot only.
10. `eas update` publication — not OTA-able (removes a native module + plugin); requires EAS rebuild. Owned by orchestrator at CLOSE.

**Assumptions:**

1. The edge function `ticket-checkout-create` already supports `surface: "web"` end-to-end (verified at `supabase/functions/ticket-checkout-create/index.ts:179-312`). It returns `{kind:"requires_web_redirect", checkoutSessionId, buyerStatusToken, hostedCheckoutUrl, totalCents, currency}`. Mobile becomes the second caller of the same surface; the only contract change is widening the `success_url` / `cancel_url` choice (§2.2).
2. `MINGLA_PUBLIC_WEB_BASE_URL` is set in the edge function's environment (verified at line 180 — currently rejects when absent with `web_base_url_missing`). The mobile-hosted variant needs ONE new envless input or one parameter (§2.2 below).
3. `expo-web-browser` is already a mingla-business runtime dep (`mingla-business/package.json:74` — `"expo-web-browser": "~15.0.10"`). No package add.
4. The app's scheme `mingla-business` (configured at `app.config.ts:38`) is already registered with iOS + Android for the existing Stripe Connect onboarding flow (`BrandOnboardView.tsx:97 RETURN_DEEP_LINK = "mingla-business://onboarding-complete"`). Reusing the same scheme for `mingla-business://checkout/return` requires zero native-config change.
5. Stripe's hosted Checkout `success_url` accepts arbitrary URLs, including custom-scheme deep links — verified by Stripe docs and by the existing Stripe Connect onboarding pattern in the same codebase.
6. `useAuth` is NEVER called by the buyer routes (`/checkout/{eventId}/*`). The current `payment.tsx:55-119` does NOT call `useAuth`; this spec preserves that. Per `feedback_anon_buyer_routes` (memory: ACTIVE).
7. The `pollTicketCheckoutStatus(checkoutSessionId, buyerStatusToken)` polling pattern (`ticketCheckoutService.ts:118-132`) is already proven on web; mobile reuses it verbatim.
8. The orchestrator handles edge-function deploy AFTER §2.2 lands (per `feedback_orchestrator_deploys_edge_functions`).

---

## 2. SPECIFICATION — PER LAYER

### 2.1 Database layer

**No DB changes.** No migration. No new column. No new RLS policy. `ticket_checkout_sessions.status` already supports `awaiting_web_redirect` (set at `index.ts:285`). The mobile flow reuses the same status — there is no need for a separate `awaiting_mobile_redirect` value because the buyer-status-token + checkout-session-id pair already uniquely identifies the session and the `pollTicketCheckoutStatus` poll path is identical on both surfaces.

The implementor MUST verify by grep that `ticket_checkout_sessions` has no surface-discriminator column (current schema has none; verified via `grep "surface" supabase/migrations/` produces only `application_fee_amount_cents` matches in unrelated rows). If a later migration adds one, document the impact and STOP for orchestrator gate.

### 2.2 Edge function layer — `supabase/functions/ticket-checkout-create/index.ts`

**Current state (verified):**
- Line 44: `surface = body.surface === "web" ? "web" : "native"`.
- Lines 175-312: `if (surface === "web")` branch — calls `stripeWeb.checkout.sessions.create({success_url, cancel_url, ...})`, returns `{kind:"requires_web_redirect", hostedCheckoutUrl}`.
- Lines 247-249: `success_url = ${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}` and `cancel_url = ${baseUrl}/checkout/${eventId}/payment` where `baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL")`.
- Lines 314-415: native PaymentIntent path (untouched by this spec — it stays as legacy fallback for any older client build still sending `surface: "native"`; mingla-business stops calling it).

**Required change (the ONLY edge-function change in this spec):**

Add a third valid `surface` value `"mobile-web"` and route its `success_url` / `cancel_url` to the mobile app's custom-scheme return URL, not the web base URL.

```ts
type CheckoutSurface = "native" | "web" | "mobile-web";

// Line 44, rewritten:
const surface: CheckoutSurface =
  body.surface === "web" ? "web" :
  body.surface === "mobile-web" ? "mobile-web" :
  "native";

// Lines 175-312, the `if (surface === "web")` branch becomes
// `if (surface === "web" || surface === "mobile-web")` with one tiny diff
// in the success_url / cancel_url block:

if (surface === "web" || surface === "mobile-web") {
  let successUrl: string;
  let cancelUrl: string;
  if (surface === "web") {
    const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
    if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      return jsonResponse({ error: "web_base_url_missing" }, 500);
    }
    successUrl = `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`;
    cancelUrl = `${baseUrl}/checkout/${eventId}/payment`;
  } else {
    // ORCH-0839-B: mobile-hosted Checkout returns to the native app via
    // custom-scheme deep link. expo-web-browser.openAuthSessionAsync
    // intercepts this URL inside the in-app browser session and resolves
    // with type: "success" + the full URL (so the app can read `cs` from
    // the query string). The scheme `mingla-business` is registered in
    // app.config.ts:38; reusing it for /checkout/return is safe because
    // /onboarding-complete and /checkout/return have disjoint route
    // handlers (and there is no in-app Linking handler — the mobile
    // browser session intercepts before the OS even tries to wake the app).
    successUrl = `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success`;
    cancelUrl = `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel`;
  }
  // ... rest of the existing block, using successUrl / cancelUrl in
  // checkout.sessions.create({ success_url: successUrl, cancel_url: cancelUrl, ... })
}
```

**Why a new `"mobile-web"` value instead of reusing `"web"`:**
- `"web"` MUST keep `success_url` = `https://business.usemingla.com/checkout/.../confirm?cs=...` for web buyers (a custom scheme would be invalid in a browser address bar).
- `"mobile-web"` MUST get the `mingla-business://` deep link (a `https://` URL would fail to wake the app; `openAuthSessionAsync` MUST intercept on its registered return scheme).
- Splitting the discriminator at the edge keeps the contract explicit and testable. A single `returnUrl` body parameter would also work but is less defensible (the edge function should not blindly trust a buyer-supplied scheme — splitting `"web"` vs `"mobile-web"` keeps the URL whitelist server-side).

**Response shape:** unchanged. `kind: "requires_web_redirect"` is preserved (the discriminator is about *kind of next step*, not about the surface — both web and mobile-web "require web redirect" in Stripe semantics). The mobile caller branches on `kind === "requires_web_redirect"` exactly the same as the web caller.

**Auth requirements:** unchanged. `verify_jwt` config preserved (the function is currently buyer-anonymous-tolerant via `userIdFromAuthHeader` which returns `null` for missing JWT).

**Validation rules:** the new `"mobile-web"` value is added to the surface whitelist. Every other validation (eventId, buyer name/email/phone, lines, idempotency, event_dates precondition) stays identical.

**Edge function deploy:** orchestrator-owned via `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` AFTER PR merge to `Seth`. Mobile changes ship in the EAS rebuild (next §); both must land together to avoid a window where the new mobile build sends `"mobile-web"` to an older edge function that 500s on the unknown value. Sequence at CLOSE:
1. PR merged to `Seth` → `main`
2. Edge function deployed
3. EAS rebuild kicked off
4. New binaries roll out via App Store / Play Store

### 2.3 Native package layer — `packages/payments-native/`

**No code change.** The package stays exactly as is. `app-mobile/` continues to consume it. mingla-business simply stops importing it.

**No tests added or removed here.** The package's own tests (`packages/payments-native/__tests__/`) keep running for app-mobile's benefit.

### 2.4 Service layer — `mingla-business/src/services/ticketCheckoutService.ts`

**Minimal additive change.** The `TicketCheckoutCreateInput.surface` type widens from `"native" | "web"` to `"native" | "web" | "mobile-web"`. The existing dispatch logic at line 90-104 already forwards `surface` verbatim. Nothing else changes.

```ts
// Line 8-16 (TicketCheckoutCreateInput.surface) becomes:
/**
 * ORCH-0790 / ORCH-0839-B: discriminator for the checkout surface.
 *  - "native" — DEPRECATED in mingla-business as of ORCH-0839-B. Older app
 *    builds may still send this; edge function preserves the PaymentIntent
 *    path for backward compat but mingla-business no longer requests it.
 *  - "web"   — web buyer; redirects via window.location.assign to a Stripe-
 *    hosted Checkout Session and returns to https://.../confirm?cs=...
 *  - "mobile-web" — NEW. mingla-business mobile buyer; opens the Stripe-
 *    hosted Checkout Session via expo-web-browser.openAuthSessionAsync
 *    and intercepts the mingla-business:// return-URL.
 */
surface?: "native" | "web" | "mobile-web";
```

**No new service function.** The existing `createTicketCheckout()` already returns the discriminated union; the mobile caller branches on `kind === "requires_web_redirect"` exactly like the web caller does.

**No change to** `pollTicketCheckoutStatus`, `getTicketCheckoutStatus`, `resendTicketConfirmation`, or `FINALIZATION_BACKOFF_MS`.

### 2.5 Hook layer — `mingla-business/src/payments/`

**Delete all four platform-extension files:**
- `mingla-business/src/payments/stripePaymentSheet.ts` — DELETE (after CI gate rewrite per §2.10 below)
- `mingla-business/src/payments/stripePaymentSheet.native.ts` — DELETE
- `mingla-business/src/payments/stripePaymentSheet.web.ts` — DELETE
- `mingla-business/src/payments/StripeNativeProvider.tsx` — DELETE
- `mingla-business/src/payments/StripeNativeProvider.native.tsx` — DELETE
- `mingla-business/src/payments/StripeNativeProvider.web.tsx` — DELETE

**Keep:**
- `mingla-business/src/payments/normalizePaymentSheetResult.ts` — KEEP if it has external callers; DELETE if its only callers were the deleted files (implementor MUST grep and decide).

**Why deletion (not replacement):** Constitution #8 (subtract before adding). The new hosted-checkout flow does NOT need a hook abstraction — `payment.tsx` calls `WebBrowser.openAuthSessionAsync` directly inline (same pattern as `BrandOnboardView.tsx:362`). Adding a new `useHostedCheckout` hook would re-introduce premature abstraction over a single call site.

### 2.6 Component layer — `mingla-business/app/checkout/[eventId]/payment.tsx`

**Full rewrite of `handlePay`** (lines 188-358 currently). New behaviour:

```ts
// New imports (replace the stripePaymentSheet import):
import * as WebBrowser from "expo-web-browser";

// REMOVE: import { useStripePaymentSheet } from "../../../src/payments/stripePaymentSheet";
// REMOVE: const { initPaymentSheet, isPaymentSheetSupported, presentPaymentSheet } = useStripePaymentSheet();

// Add the return-URL constant near the top of the file (after imports):
const CHECKOUT_RETURN_URL_SCHEME = "mingla-business://checkout/return";

// New handlePay callback (replaces lines 188-358):
const handlePay = useCallback(async (): Promise<void> => {
  if (processing) return;
  if (eventId === null) return;

  try {
    setProcessing(true);
    setPaymentError(null);

    // Single code path for web and mobile — both surfaces now use
    // hosted Stripe Checkout. The only difference is the surface
    // discriminator (which controls the Stripe success_url / cancel_url
    // server-side) and how we open the URL (window.location.assign on
    // web, expo-web-browser.openAuthSessionAsync on native).
    const surface = Platform.OS === "web" ? "web" : "mobile-web";
    const checkout = await createTicketCheckout({
      eventId,
      buyer,
      lines,
      surface,
    });
    if (checkout.kind !== "requires_web_redirect") {
      throw new Error("Hosted checkout did not return a redirect URL.");
    }
    setCheckoutSessionId(checkout.checkoutSessionId);

    if (Platform.OS === "web") {
      // EXISTING web path — unchanged. sessionStorage persist + redirect.
      const storage = (globalThis as unknown as { sessionStorage?: Storage })
        .sessionStorage;
      writeCheckoutResumePayload(storage, eventId, {
        checkoutSessionId: checkout.checkoutSessionId,
        buyerStatusToken: checkout.buyerStatusToken,
        lines,
        buyer,
      });
      const w = (globalThis as unknown as { location?: { assign?: (u: string) => void } });
      if (w.location?.assign) {
        w.location.assign(checkout.hostedCheckoutUrl);
      } else {
        setProcessing(false);
        setPaymentError(
          "Couldn't redirect to Stripe. Please try again from a standard browser.",
        );
      }
      return;
    }

    // NATIVE (iOS + Android) — open the Stripe hosted Checkout in an
    // in-app browser session. openAuthSessionAsync intercepts the
    // mingla-business://checkout/return deep link Stripe redirects to,
    // resolves with type: "success" | "cancel" | "dismiss", and never
    // wakes the host OS deep-link handler (which is why the absence
    // of a Stripe Linking listener in app/_layout.tsx is safe).
    //
    // Mixpanel telemetry parity:
    //   - "ticket_checkout_pay_started" fires BEFORE openAuthSessionAsync
    //   - "ticket_checkout_sheet_opened" fires after the browser session
    //     is opened (we don't have a real "did open" callback so fire it
    //     immediately after the call — same as web's redirect emit)
    //   - "ticket_checkout_succeeded" fires on poll success
    //   - "ticket_checkout_cancelled" fires on browser cancel/dismiss
    //   - "ticket_checkout_failed" fires on any thrown error
    mixpanelService.track("ticket_checkout_pay_started", {
      surface,
      eventId,
      checkoutSessionId: checkout.checkoutSessionId,
      totalCents: checkout.totalCents,
      currency: checkout.currency,
    });

    const browserResult = await WebBrowser.openAuthSessionAsync(
      checkout.hostedCheckoutUrl,
      CHECKOUT_RETURN_URL_SCHEME,
      {
        // showInRecents: false  // iOS-only; default is fine
        // preferEphemeralSession: false  // we WANT the buyer's saved cards
      },
    );

    mixpanelService.track("ticket_checkout_sheet_opened", {
      surface,
      eventId,
      checkoutSessionId: checkout.checkoutSessionId,
      browserResultType: browserResult.type,
    });

    if (browserResult.type === "cancel" || browserResult.type === "dismiss") {
      // Buyer closed the browser. Trust the server status (Stripe sometimes
      // completes payment AFTER the buyer dismisses — same defensive logic
      // as BrandOnboardView.tsx:381-400). Poll once with a tight timeout to
      // catch the race; if status is still pending, surface as cancel.
      const status = await pollTicketCheckoutStatus(
        checkout.checkoutSessionId,
        checkout.buyerStatusToken,
      );
      if (status !== null && status.order !== null) {
        // Race won: payment actually completed.
        recordResult({
          orderId: status.order.orderId,
          ticketIds: status.order.tickets.map((t) => t.ticketId),
          checkoutSessionId: status.checkoutSessionId,
          paidAt: new Date().toISOString(),
          paymentMethod: "card",
          total: status.order.totalCents / 100,
          totalCents: status.order.totalCents,
          currency: status.order.currency,
          paymentStatus: status.order.paymentStatus,
          notificationStatus: status.order.notificationStatus,
          tickets: status.order.tickets,
        });
        mixpanelService.track("ticket_checkout_succeeded", {
          surface, eventId, checkoutSessionId: checkout.checkoutSessionId,
        });
        router.replace(`/checkout/${eventId}/confirm` as never);
        return;
      }
      // Real cancel — silent return, no toast (mirrors web's cancel UX
      // and ORCH-0789 "Canceled" code-branch silent return).
      mixpanelService.track("ticket_checkout_cancelled", {
        surface, eventId, checkoutSessionId: checkout.checkoutSessionId,
      });
      setProcessing(false);
      return;
    }

    if (browserResult.type !== "success") {
      // "locked" or "opened" — unusual states. Log + surface as error.
      console.warn("[checkout-payment] openAuthSessionAsync unexpected type", browserResult.type);
      mixpanelService.track("ticket_checkout_failed", {
        surface, eventId, checkoutSessionId: checkout.checkoutSessionId,
        reason: `browser_result_${browserResult.type}`,
      });
      setProcessing(false);
      setPaymentError("Checkout couldn't complete. Please try again.");
      return;
    }

    // browserResult.type === "success" — Stripe redirected back to our
    // mingla-business://checkout/return?cs=... URL. The `cs` query
    // matches checkout.checkoutSessionId (defence-in-depth: parse and
    // assert). Now poll status until order paid OR backoff exhausted.
    setFinalizing(true);
    finalizingRef.current = true;
    const status = await pollTicketCheckoutStatus(
      checkout.checkoutSessionId,
      checkout.buyerStatusToken,
    );
    if (!finalizingRef.current) return;
    if (status === null || status.order === null) {
      finalizingRef.current = false;
      setFinalizingTimedOut(true);
      setFinalizing(false);
      setProcessing(false);
      console.warn("[checkout-payment] hosted checkout finalization timed out", {
        checkoutSessionId: checkout.checkoutSessionId,
      });
      mixpanelService.track("ticket_checkout_failed", {
        surface, eventId, checkoutSessionId: checkout.checkoutSessionId,
        reason: "finalize_timeout",
      });
      return;
    }
    recordResult({
      orderId: status.order.orderId,
      ticketIds: status.order.tickets.map((t) => t.ticketId),
      checkoutSessionId: status.checkoutSessionId,
      paidAt: new Date().toISOString(),
      paymentMethod: "card",
      total: status.order.totalCents / 100,
      totalCents: status.order.totalCents,
      currency: status.order.currency,
      paymentStatus: status.order.paymentStatus,
      notificationStatus: status.order.notificationStatus,
      tickets: status.order.tickets,
    });
    mixpanelService.track("ticket_checkout_succeeded", {
      surface, eventId, checkoutSessionId: checkout.checkoutSessionId,
    });
    router.replace(`/checkout/${eventId}/confirm` as never);
  } catch (error) {
    if (finalizingRef.current) {
      finalizingRef.current = false;
      setFinalizingTimedOut(true);
      setFinalizing(false);
      setProcessing(false);
      return;
    }
    setProcessing(false);
    const message =
      error instanceof Error
        ? error.message
        : "Payment could not be completed. Please try again.";
    setPaymentError(message);
    mixpanelService.track("ticket_checkout_failed", {
      surface: Platform.OS === "web" ? "web" : "mobile-web",
      eventId,
      reason: "thrown_error",
      message,
    });
  } finally {
    if (!finalizingRef.current) {
      setProcessing(false);
    }
  }
}, [
  buyer,
  eventId,
  lines,
  processing,
  recordResult,
  router,
]);
```

**Dependencies array note:** dependency array no longer references `initPaymentSheet`, `isPaymentSheetSupported`, or `presentPaymentSheet`. Implementor MUST verify ESLint's exhaustive-deps rule is satisfied with the new closure.

**`isPaymentSheetSupported` defensive branch (lines 248-254 currently):** DELETE. There is no longer a native-vs-web split to defend against; the single `surface = Platform.OS === "web" ? "web" : "mobile-web"` covers every platform Mingla ships on.

**Decline toast / `declineToast` state:** KEEP, but it now only fires when the operator's existing `setPaymentError` path triggers a "real failure" (card declined inside Stripe's hosted page → Stripe redirects to `cancel_url` → buyer returns to `/payment` with no order → buyer retries OR sees a "Couldn't complete payment" inline error). The `declineToast` setter call in the new code becomes implicit — if a card is genuinely declined, Stripe's hosted page handles the retry inside its own UI before ever redirecting back; the buyer only returns via `cancel_url` when they explicitly close out. So the decline toast can be retired here if the implementor judges it dead code post-rewrite; the existing styles + Toast wrap stay for any future use. (Pattern preserved per `feedback_toast_needs_absolute_wrap`.)

**Other parts of the file (lines 1-187 and lines 359-636):** UNCHANGED. Defensive guards, keyboard pattern, sticky bottom bar, GlassCard summary, finalizing UI, decline toast wrap (kept dormant), styles, navigation back handler — all preserved verbatim.

**Anon-buyer-route invariant (`feedback_anon_buyer_routes`):** The new `handlePay` continues to make ZERO calls to `useAuth` or anything that depends on authenticated session. `createTicketCheckout` is buyer-anonymous on the server (`userIdFromAuthHeader` returns null and the RPC tolerates it). PRESERVED.

**Accessibility (I-39):** the existing Pay button at line 479-488 has `accessibilityLabel`. No new interactive elements added. PRESERVED.

### 2.7 Provider tree — `mingla-business/app/_layout.tsx`

**Required changes:**

1. Line 34: REMOVE `import { StripeNativeProvider } from "../src/payments/StripeNativeProvider";`
2. Lines 226-230: REMOVE the `<StripeNativeProvider>` wrap. New tree:

```tsx
return (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootLayoutInner />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);
```

**Why safe:** the existing `StripeNativeProvider` (post-META-ORCH-0827) was a NO-OP on every platform — `StripeNativeProvider.web.tsx` returned `<>{children}</>` and `StripeNativeProvider.native.tsx` re-exported from `packages/payments-native/StripeNativeProvider.tsx` which DID wrap `<StripeProvider>` but that wrapper is now gone because no descendant calls `useStripe()`. Removing the wrap has zero observable effect on any code path that survives this spec.

### 2.8 Native build config — `mingla-business/app.config.ts`

**Required change at lines 60-66:** delete the entry

```ts
[
  "@stripe/stripe-react-native",
  {
    merchantIdentifier: "merchant.com.sethogieva.minglabusiness",
    enableGooglePay: true,
  },
],
```

**Why:** without any `import` from `@stripe/stripe-react-native` in `mingla-business/`, the Expo plugin entry is dead weight. Worse, it auto-links the iOS framework and Android module into the binary — bloating the .ipa / .apk and risking the same iOS 26 + bridgeless TurboModule crash that ORCH-0837 patched around. Removing the plugin entry causes Expo prebuild to omit the native framework entirely on the next EAS build.

**The other plugins (`google-signin`, `expo-camera`, `expo-image-picker`, `expo-video`, `sentry/react-native/expo`, `apple-authentication`) are unaffected.**

**EAS rebuild is NON-NEGOTIABLE.** This change is NOT OTA-able. Removing the plugin removes a native module from the binary; existing OTA bundles linked against the old binary will crash if they try to invoke any `@stripe/stripe-react-native` API. (They won't, because `payment.tsx` no longer imports it — but the safety margin is "rebuild + ship binary + retire old binaries via store rollout".)

### 2.9 Dependencies — `mingla-business/package.json`

**Required changes:**

1. Remove `"@stripe/stripe-react-native": "..."` from `dependencies` (currently pinned at `^0.50.3` post-ORCH-0837 bump to `0.65.1`; whichever the operator's HEAD has).
2. Remove `"@mingla/payments-native": "..."` from `dependencies` (workspace dep).

**Verification:** after `npm install` (or `pnpm install` per the monorepo's installer), `mingla-business/node_modules/@stripe/stripe-react-native/` MUST be absent (or only present as a transitive of another package — none expected). Implementor runs `npm ls @stripe/stripe-react-native --workspace mingla-business` and pastes the output in the implementation report. Same for `@mingla/payments-native`.

**Side-effect check on `app-mobile/`:** the consumer app's `package.json` MUST be untouched. `app-mobile/` keeps both deps. Both apps share the same `node_modules` tree only if a hoisting installer is used; the operator's setup uses workspaces — implementor MUST grep `app-mobile/package.json` to confirm the consumer-app dep is still listed.

### 2.10 CI strict-grep gates — `.github/scripts/strict-grep/` + `.github/workflows/strict-grep-mingla-business.yml`

This spec affects FOUR existing gates:

**Gate A — ORCH-0789 (`orch-0789-error-toast-dismissible.mjs`):**
- §4 (lines 94-106 of the gate) asserts `mingla-business/src/payments/stripePaymentSheet.ts` contains `PaymentSheetErrorCode` and the `"Canceled" | "Failed" | "Timeout"` literal.
- §5 (lines 108-120) asserts `payment.tsx` uses `switch (payResult.error.code)` and `case "Canceled"`.
- **Action: delete §4 + §5 from the gate.** Add a header comment citing ORCH-0839-B as the retiring ORCH. §1-3 (Toast.tsx + toastTimings.ts) STAY UNTOUCHED — they have nothing to do with the native PaymentSheet. §6 (legacy buyer-app copy absent) STAYS UNTOUCHED.

**Gate B — ORCH-0778 (`orch-0778-web-stripe-native-import-gate.mjs`):**
- Currently allows `@stripe/stripe-react-native` imports in TWO files: `mingla-business/src/payments/StripeNativeProvider.native.tsx` and `mingla-business/src/payments/stripePaymentSheet.native.ts`.
- **Action: shrink `allowedNativeImportFiles` to the empty set `new Set()`.** Add a comment block citing ORCH-0839-B. The gate's intent (no Stripe-RN in web bundle) is preserved a-fortiori: if no files import it anywhere in mingla-business, the web bundle obviously stays clean.

**Gate C — ORCH-0837 (`app-mobile/scripts/ci/orch-0837-regression-check.mjs`):** UNTOUCHED. It enforces invariants on `app-mobile/` and `supabase/functions/ticket-checkout-create/`. The edge function change in §2.2 does NOT remove the `payment_method_types: ['card']` line (the native PaymentIntent path at line 320-415 of the edge function STAYS). Implementor MUST verify the gate still passes after the edge edit.

**Gate D — META-ORCH-0827 (`meta-orch-0827-no-web-stripe-in-consumer.mjs` + `meta-orch-0827-package-isolation.mjs`):** UNTOUCHED. They enforce package isolation between `app-mobile/` and `mingla-business/`. mingla-business dropping its consumption only makes those gates MORE green.

**New gate — `orch-0839-b-mingla-business-no-native-stripe.mjs`:**

```js
#!/usr/bin/env node
/**
 * ORCH-0839-B strict-grep gate — mingla-business mobile uses ONLY hosted
 * Stripe Checkout. No native @stripe/stripe-react-native imports, no
 * @mingla/payments-native imports, no StripeProvider JSX, no plugin entry.
 *
 * Enforces I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY.
 *
 * Contracts:
 *   T-G1: no file under mingla-business/{app,src}/ imports
 *         "@stripe/stripe-react-native"
 *   T-G2: no file under mingla-business/{app,src}/ imports
 *         "@mingla/payments-native"
 *   T-G3: mingla-business/app.config.ts plugins array does NOT contain
 *         "@stripe/stripe-react-native"
 *   T-G4: mingla-business/package.json dependencies does NOT include
 *         "@stripe/stripe-react-native" or "@mingla/payments-native"
 *   T-G5: payment.tsx imports expo-web-browser and calls
 *         WebBrowser.openAuthSessionAsync exactly once
 *   T-G6: payment.tsx passes surface="mobile-web" on non-web platforms
 *         (regex: /surface\s*=\s*Platform\.OS\s*===\s*"web"\s*\?\s*"web"\s*:\s*"mobile-web"/)
 *   T-G7: app/_layout.tsx does NOT import StripeNativeProvider
 *   T-G8: ticket-checkout-create/index.ts recognises "mobile-web" as a
 *         valid surface value
 *
 * Exit 1 on any FAIL. Pattern follows orch-0834-rescoped-regression-check.mjs.
 */
```

Implementor MUST write this file with the eight contracts above, register it in `mingla-business/package.json` as `test:orch-0839-b`, and add a job in `.github/workflows/strict-grep-mingla-business.yml` following the existing registry pattern (per `feedback_strict_grep_registry_pattern.md` — one script + one job, plugged into the existing workflow file).

### 2.11 Telemetry parity — `mingla-business/src/services/mixpanelService.ts`

**No new events created.** The mobile flow reuses the existing events (verified by reading the service file's `track` signature). The component-layer calls in §2.6 emit:

| Event | Trigger | Properties |
|-------|---------|------------|
| `ticket_checkout_pay_started` | User taps Pay (BEFORE `createTicketCheckout`) | `{surface, eventId, ?checkoutSessionId, totalCents, currency}` |
| `ticket_checkout_sheet_opened` | `openAuthSessionAsync` returns (success or cancel) | `{surface, eventId, checkoutSessionId, browserResultType}` |
| `ticket_checkout_succeeded` | `pollTicketCheckoutStatus` returns paid order | `{surface, eventId, checkoutSessionId}` |
| `ticket_checkout_cancelled` | Browser dismissed AND order not paid | `{surface, eventId, checkoutSessionId}` |
| `ticket_checkout_failed` | Thrown error OR unexpected browser-result type OR finalize timeout | `{surface, eventId, ?checkoutSessionId, reason, ?message}` |

**Note on existing web parity:** the current `payment.tsx` web path does NOT emit any of these — it just calls `window.location.assign` and lets the confirm screen take over. So this spec creates BETTER parity between web and mobile by emitting on both. Web emission is OPTIONAL in this ORCH (per scope §1 non-goal #6 — web flow unchanged) — but if the implementor judges it trivial to add the same five emits on the web branch of `handlePay`, that's a +1 polish welcome. If they decline, it's not a blocker.

### 2.12 Realtime — N/A

No Supabase Realtime channels are added. The existing `pollTicketCheckoutStatus` HTTP polling is the only post-payment status mechanism.

---

## 3. SUCCESS CRITERIA

Numbered, testable, unambiguous:

| # | Criterion | Layer | Test |
|---|-----------|-------|------|
| SC-1 | From mingla-business mobile (iOS + Android dev or production build), tapping "Pay" on the payment screen opens an in-app browser sheet showing the Stripe-hosted Checkout page within 3s. | Component + service + edge | T-01, T-02 |
| SC-2 | After successful payment, the in-app browser dismisses, the app navigates to `/checkout/{eventId}/confirm`, the `orders` row for the session is `paymentStatus="paid"`, and the buyer receives the confirmation email per existing `dispatchTicketConfirmation` logic. | Component + service + DB | T-01, T-02 |
| SC-3 | After buyer cancellation (closes the in-app browser before paying), the app returns to `/checkout/{eventId}/payment` with `processing=false`. The `ticket_checkout_sessions` row stays at `status="awaiting_web_redirect"` and is eventually tombstoned by the existing expiry sweep (15-minute expiry per `p_expires_at` at edge function line 102). No order is created. | Component + DB | T-04 |
| SC-4 | After a payment failure inside Stripe's hosted page (declined card, 3DS abort, network drop), Stripe surfaces the error INSIDE the hosted page and lets the buyer retry. If the buyer ultimately gives up and dismisses, the app treats it as cancel (SC-3). If Stripe redirects to `cancel_url`, the app intercepts via `mingla-business://checkout/return?status=cancel`, returns to the payment screen, and surfaces "Checkout couldn't complete. Please try again." inline. | Component | T-05, T-07 |
| SC-5 | `mingla-business/app/_layout.tsx` no longer wraps the tree in `<StripeNativeProvider>`. No regression in QueryClient / Auth / Splash / Sentry init. | Provider tree | T-G7 + boot smoke |
| SC-6 | No file under `mingla-business/src/` or `mingla-business/app/` contains an `import` from `@stripe/stripe-react-native` OR from `@mingla/payments-native`. The `package.json` dependencies list does not include either package. `npm ls @stripe/stripe-react-native --workspace mingla-business` returns "(empty)" or fails. | CI + dep graph | T-G1, T-G2, T-G4, T-10 |
| SC-7 | Telemetry parity verified — each event in §2.11 fires on at least one happy-path mobile run, captured in Mixpanel debug logs or via Metro `console.log` (the existing `mixpanelService.track` emits to console in dev). | Telemetry | T-06 |
| SC-8 | Web buyer flow at `https://business.usemingla.com/checkout/{eventId}` is byte-for-byte unchanged in behaviour. The same Stripe Checkout Session URL is generated, the same `success_url` lands the buyer back at `/confirm?cs=...`, the same `cancel_url` lands them at `/payment`. Inspect the diff to `payment.tsx`'s web branch: only the Mixpanel emits added (per §2.11). | Web + edge | T-03 |
| SC-9 | EAS rebuild produces an installable iOS dev build that boots without `TurboModuleRegistry.getEnforcing(...): 'StripeSdk' could not be found` errors. Booting the new binary on an iOS 26 simulator + an Android 14 emulator both succeed past the splash screen. The binary's `.ipa` and `.apk` sizes shrink (operator notes the delta). | Native build | T-09 |
| SC-10 | The hosted Checkout Session URL is opened via `WebBrowser.openAuthSessionAsync(url, returnUrlScheme)` (NOT `WebBrowser.openBrowserAsync` and NOT `Linking.openURL`). Confirmed by source grep in the gate. | Component | T-G5 |
| SC-11 | The buyer route `/checkout/{eventId}/payment` (and the entire `/checkout/...` subtree) does NOT call `useAuth` anywhere in the rewritten file. Verified by `grep -n "useAuth" mingla-business/app/checkout/` returning zero matches. (Invariant per `feedback_anon_buyer_routes`.) | Component | T-G + grep |
| SC-12 | New strict-grep gate `orch-0839-b-mingla-business-no-native-stripe.mjs` exits 0 on the post-implementation tree. Its workflow job appears in `strict-grep-mingla-business.yml` and runs green on the PR. ORCH-0789 §4/§5 are deleted; ORCH-0778 allow-list is shrunk to empty. All other strict-grep gates stay green (no regression). | CI | T-G1..T-G8 + full CI run |

---

## 4. INVARIANTS

### Preserved invariants (every one MUST stay green post-implementation)

| ID | Source | What it requires | How this spec preserves it |
|----|--------|------------------|---------------------------|
| I-PROPOSED-O ANON-BUYER-ROUTES | `feedback_anon_buyer_routes` | `/checkout/{eventId}/*` routes never call `useAuth` or redirect to sign-in | The new `handlePay` removes one auth-unrelated path; preserves anon-buyer-tolerance verbatim (see SC-11). |
| I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG | ORCH-0834-rescoped | `<StripeProvider>` MUST receive `merchantIdentifier` + `urlScheme` | RETIRED for mingla-business by this spec (the entire `<StripeProvider>` mount is removed). Stays ACTIVE for app-mobile via `packages/payments-native/StripeNativeProvider.tsx`. Decommissioning note added to invariant registry at orchestrator CLOSE. |
| I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES | ORCH-0837 | Edge function `ticket-checkout-create` PI creation uses `payment_method_types: ['card']`, not `automatic_payment_methods: {enabled: true}` | UNTOUCHED. The native PI path (edge function lines 320-415) is unchanged; only the `surface === "web" || surface === "mobile-web"` branch (lines 175-312) is widened. `orch-0837-regression-check.mjs` continues to pass. |
| I-PROPOSED-STRIPE-CALLBACK-WIRED | ORCH-0837 | `app-mobile/app/index.tsx` invokes `handleURLCallback` before falling through to `handleDeepLink` | UNTOUCHED — this is an app-mobile invariant. mingla-business does NOT have an equivalent Linking listener and no longer needs one (the in-app browser session intercepts before any Linking event fires). |
| I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE | ORCH-0829-B D-1 | Expired `ticket_checkout_sessions` rows are tombstoned via the OR-clause migration | UNTOUCHED — DB-side, unrelated to this spec. |
| I-PROPOSED-ERROR-TOAST-DISMISSIBLE | ORCH-0789 | Toast.tsx error variant must be user-dismissible | UNTOUCHED — Toast.tsx + toastTimings.ts untouched by this spec. ORCH-0789 gate §1-3 + §6 still pass. |
| I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED | ORCH-0789 | `stripePaymentSheet.ts` exports `PaymentSheetErrorCode` literal union | **RETIRED for mingla-business** by this spec — the file is deleted. The invariant stays alive in `packages/payments-native/types.ts` for app-mobile's benefit. ORCH-0789 gate §4-5 are DELETED per §2.10. Orchestrator marks the invariant `RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B`. |
| Constitution #1 (no dead taps) | Constitution | Every interactive element responds | PRESERVED. Pay button still calls `handlePay`; loading + disabled states unchanged. |
| Constitution #2 (one owner per truth) | Constitution | No duplicate state authorities | PRESERVED. Payment state stays in `payment.tsx` component-local; cart stays in `CartContext`; server state via `pollTicketCheckoutStatus`. |
| Constitution #3 (no silent failures) | Constitution | Every error surfaces | PRESERVED. Every thrown error → `setPaymentError(message)` AND `mixpanelService.track("ticket_checkout_failed", ...)`. Browser cancel → silent return (intentional UX, mirrors web). |
| Constitution #6 (logout clears everything) | Constitution | No private data survives sign-out | PRESERVED. `payment.tsx` is anonymous; no private data to clear. |
| Constitution #8 (subtract before adding) | Constitution | Don't layer on broken code | OBEYED. Native PaymentSheet code path REMOVED before hosted Checkout path added. `useStripePaymentSheet` deleted. `StripeNativeProvider` mount deleted. ORCH-0789 §4/§5 gate clauses deleted. |
| Constitution #11 (one auth instance) | Constitution | Centralised session authority | PRESERVED. `AuthContext` untouched. |
| I-37 / I-38 / I-39 (WCAG AA touch + accessibility label) | Cycle 17c | Touch target ≥ 44pt + explicit `accessibilityLabel` | PRESERVED. Pay button unchanged. No new Pressable. |
| I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE | ORCH-0829-B D-1 | 60s timeout race in `useStripePaymentSheet.ts` | **RETIRED for mingla-business** by this spec — the wrapper is no longer in the mingla-business code path. Stays ACTIVE in `packages/payments-native/useStripePaymentSheet.ts` for app-mobile. |
| I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY | ORCH-0829-B | `presentPaymentSheet` once-only guard | **RETIRED for mingla-business** — same reason. ACTIVE for app-mobile. |

### New invariants this spec establishes (codified by orchestrator at CLOSE)

| ID | Description | Gate |
|----|-------------|------|
| `I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY` | mingla-business mobile and web both use Stripe-hosted Checkout Sessions via `ticket-checkout-create` with `surface ∈ {"web","mobile-web"}`. No native PaymentSheet code path remains in the mingla-business source tree. | New `orch-0839-b-mingla-business-no-native-stripe.mjs` strict-grep gate (T-G1..T-G8) |
| `I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME` | Edge function `ticket-checkout-create` MUST emit `mingla-business://checkout/return?...` for `success_url` + `cancel_url` when `surface="mobile-web"` and the existing `https://...` URLs when `surface="web"`. Mixing or swapping breaks deep-link interception. | Deno-side: a unit-test added under `supabase/functions/ticket-checkout-create/__tests__/` exercising both surfaces. Code-side: T-G8 strict-grep ensures the string `"mobile-web"` is present in the surface discriminator. |

---

## 5. TEST CASES

All cases mapped to success criteria + layer + verification surface.

| Test | Scenario | Input | Expected | Layer | Verifies |
|------|----------|-------|----------|-------|----------|
| T-01 | Happy path on iOS dev build with valid test card `4242 4242 4242 4242` | Buyer fills cart, name/email/phone, taps Pay | Browser opens within 3s → Stripe page loads → buyer enters card → "Pay" → browser dismisses → app returns to `/confirm` → order row paid → email queued | Full stack | SC-1, SC-2 |
| T-02 | Happy path on Android emulator with valid test card | Same as T-01 | Same as T-01 | Full stack | SC-1, SC-2 |
| T-03 | Happy path on web (regression baseline) | Same as T-01, on `https://business.usemingla.com/checkout/{eventId}` | `window.location.assign(hostedCheckoutUrl)` → Stripe page → success → redirect to `/confirm?cs=...` → resume polling → order paid | Full stack | SC-8 |
| T-04 | Buyer dismisses in-app browser before paying (iOS sim) | Buyer opens browser, taps the close (X) button | Browser dismisses → `openAuthSessionAsync` resolves with `type:"cancel"` or `"dismiss"` → defensive poll runs once → returns null → app returns to `/payment` screen with `processing=false`, no error toast, no order created | Component + service | SC-3 |
| T-05 | Declined card inside Stripe hosted page (iOS sim, Stripe test card `4000000000000002`) | Buyer enters declined card → "Pay" inside Stripe page | Stripe surfaces "Your card was declined" INSIDE the page; browser stays open; buyer can retry with a different card. If buyer dismisses without retrying, T-04 path applies. If buyer's retry succeeds, T-01 path applies. | Component (no app-side fork — Stripe owns the UX) | SC-4 |
| T-06 | 3DS challenge card inside Stripe hosted page (iOS sim, Stripe test card `4000002500003155`) | Buyer enters 3DS card → "Pay" → 3DS challenge appears inside the same browser session → buyer completes the challenge | 3DS challenge renders inside the in-app browser (Stripe handles it); on success, hosted page redirects to `mingla-business://checkout/return?status=success&cs=...` → `openAuthSessionAsync` resolves with `type:"success"` → poll succeeds → confirm screen | Component | SC-1, SC-2 |
| T-07 | Network drop mid-checkout (iOS sim with airplane mode toggled after opening browser) | Buyer enters card, attempts Pay; network drops mid-confirmation | Stripe page shows its own error UI; browser stays open; buyer can retry once network restored or dismiss (T-04 path) | Component | SC-4 |
| T-08 | Free ticket flow (regression) | Cart total = 0 (e.g. ORCH-0834 free claim) | Edge function returns `kind:"free_completed"` BEFORE hitting either hosted-checkout branch (line 134-166 of edge function); `payment.tsx` defensive guard at line 133 bounces to `/buyer` before `handlePay` is reachable; net effect: free flow unchanged | Service + Component | NO regression on free path |
| T-09 | Anon buyer (no auth session) | Buyer hits `/checkout/{eventId}` from a marketing email link, never signed in | `payment.tsx` doesn't call `useAuth`; `createTicketCheckout` calls succeed with anonymous Supabase client; hosted Checkout opens; payment completes as anon buyer | Component + service | SC-11 |
| T-10 | Strict-grep CI: no native Stripe imports | Run `node .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` from repo root | Exit 0 with `"ORCH-0839-B mingla-business no-native-stripe gate passed."` printed | CI | SC-6, SC-12 |
| T-11 (negative) | Strict-grep CI: gate trips when a regression is introduced | Add a line `import { useStripe } from "@stripe/stripe-react-native";` to any file under `mingla-business/src/` | Exit 1 with the file path printed in the failure list | CI | SC-12 |
| T-12 | Edge function rejects unknown surface | POST to `ticket-checkout-create` with `surface: "bogus"` | Per the new discriminator logic, `body.surface === "web" ? "web" : body.surface === "mobile-web" ? "mobile-web" : "native"` — falls through to `"native"`. Document this behaviour; do NOT 400 on unknown values (preserves backward compat with older mobile clients that send `surface: "native"`). | Edge | SC-8 (web unaffected) |
| T-13 | Edge function emits the right `success_url` per surface | Unit test against the edge function with `surface: "mobile-web"` | `checkout.sessions.create` is called with `success_url` starting with `mingla-business://checkout/return?cs=` | Edge | I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME |

### Test execution

- T-01, T-02, T-04, T-05, T-06, T-07, T-09 — Claude `mingla-forensics` TEST mode, live-fire on iOS sim + Android emulator + Maestro driver per `feedback_sim_test_drivers_maestro_default`. NON-NEGOTIABLE per Prime Directive 7.
- T-03 — Claude `mingla-forensics` TEST mode on web browser (Chrome).
- T-08 — Claude `mingla-forensics` TEST mode on iOS sim.
- T-10, T-11 — CI runs automatically on PR; Claude TEST mode confirms gate passes locally before push.
- T-12, T-13 — Deno unit test, runnable via `deno test supabase/functions/ticket-checkout-create/__tests__/` (implementor writes the test fixture).

---

## 6. IMPLEMENTATION ORDER

Strict sequential order (do NOT parallelize across phases — each gates the next):

1. **Edge function (`ticket-checkout-create/index.ts` §2.2).** Widen `CheckoutSurface` to include `"mobile-web"`; widen the `if (surface === "web")` branch to `if (surface === "web" || surface === "mobile-web")`; split `successUrl` / `cancelUrl` per surface. Verify with `deno check`. Write Deno unit test for T-12 + T-13. STOP for orchestrator deploy gate per `feedback_orchestrator_deploys_edge_functions`.

2. **Service layer (`ticketCheckoutService.ts` §2.4).** Widen `TicketCheckoutCreateInput.surface` type to include `"mobile-web"`. `npx tsc --noEmit` clean.

3. **Component layer (`payment.tsx` §2.6).** Replace `handlePay`. Remove `useStripePaymentSheet` import. Add `expo-web-browser` import. Verify `npx tsc --noEmit` clean and ESLint exhaustive-deps clean.

4. **Provider tree (`app/_layout.tsx` §2.7).** Remove `StripeNativeProvider` import + wrap. Verify boot in iOS sim.

5. **Delete the six payment files (§2.5).** `stripePaymentSheet.{ts,native.ts,web.ts}` and `StripeNativeProvider.{tsx,native.tsx,web.tsx}`. Grep `mingla-business/src/` + `mingla-business/app/` for residual references; fix any (there should be none after step 3 + 4). Optionally delete `normalizePaymentSheetResult.ts` if it has no remaining importer.

6. **CI gate edits (§2.10).** Delete §4 + §5 of `orch-0789-error-toast-dismissible.mjs`. Shrink ORCH-0778 allow-list to empty. Write new `orch-0839-b-mingla-business-no-native-stripe.mjs` with T-G1..T-G8. Register in `mingla-business/package.json` as `test:orch-0839-b`. Add workflow job in `strict-grep-mingla-business.yml`. Run all gates locally — every one must exit 0.

7. **Dependency removal (§2.9).** Drop `@stripe/stripe-react-native` and `@mingla/payments-native` from `mingla-business/package.json`. Run `npm install` (or workspace equivalent). Verify lock file. Run `npm ls @stripe/stripe-react-native --workspace mingla-business` returns empty.

8. **Plugin removal (§2.8).** Drop the `"@stripe/stripe-react-native"` entry from `app.config.ts`. Run `npx expo prebuild --clean --no-install` in a scratch dir to verify the generated `ios/` + `android/` projects no longer link the Stripe framework. (DO NOT commit the prebuild output — `mingla-business/` is managed Expo.)

9. **Local verification.** `npx tsc --noEmit` clean. All strict-grep gates green. All workspace-local Jest unit tests green. Metro starts.

10. **EAS rebuild.** `eas build --profile preview --platform ios` first (sim build for tester). Test on iOS sim per T-01. Then `eas build --profile production --platform ios` and `eas build --profile production --platform android` for store submission (orchestrator-driven at CLOSE; NOT implementor's job).

11. **Implementation report.** Implementor writes `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` with old→new receipts, spec traceability, invariant verification, parity check (mobile + web), and machine-readable CI output.

12. **Hand off to TEST mode** (Claude `mingla-forensics` TEST mode TARGETED sub-mode). Tester runs T-01..T-13.

---

## 7. REGRESSION PREVENTION

For the class of bug this fix retires (native PaymentSheet hang on iOS 26 + newArch + bridgeless):

- **Structural safeguard**: the new strict-grep gate `orch-0839-b-mingla-business-no-native-stripe.mjs` makes it impossible for a future PR to re-introduce `@stripe/stripe-react-native` into `mingla-business/` without explicitly retiring the gate. The gate is registry-listed in the workflow comment block.
- **Test catch**: T-G1 + T-G2 fail immediately if anyone re-adds the import.
- **Protective comment**: at the top of `payment.tsx`, add a block:
  ```
  // ORCH-0839-B (2026-05-14): mingla-business pivoted from native Stripe
  // PaymentSheet to hosted Stripe Checkout via expo-web-browser. Do NOT
  // re-add @stripe/stripe-react-native imports here — the iOS 26 + newArch
  // bridgeless TurboModule hang documented in
  // Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_*.md
  // §D-1 still exists in the SDK. CI gate
  // .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
  // forbids re-introduction.
  ```
- **Invariant**: `I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY` (codified by orchestrator at CLOSE).

For the class of bug retired alongside (forwardRef React 19 warning, ORCH-0836): retiring the entire Stripe RN dependency for mingla-business also retires this warning automatically for mingla-business runs — but app-mobile still ships Stripe RN 0.65.1, so the LogBox filter in `app-mobile/app/_layout.tsx` (added by ORCH-0836) STAYS UNTOUCHED.

---

## 8. DEPLOY & ROLLOUT

**NOT OTA-able.** This change removes a native module (`@stripe/stripe-react-native`) and an Expo plugin entry. Existing OTA bundles linked against the old binary would crash if they tried to load the now-missing module. Therefore:

1. **PR merge sequence at CLOSE (orchestrator):**
   - Verify all CI gates green (per `feedback_pr_merge_pregate`).
   - Operator approves.
   - PR merged to `Seth`, then `Seth` → `main`.
2. **Edge function deploy (orchestrator):**
   - `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`
   - Verify version bump via `mcp__supabase__list_edge_functions`.
   - Verify `verify_jwt` setting preserved.
3. **EAS rebuild (orchestrator at CLOSE, on operator confirmation):**
   - `eas build --profile production --platform ios` (mingla-business)
   - `eas build --profile production --platform android` (mingla-business)
   - These produce installable .ipa and .apk binaries. Both must be submitted to App Store + Play Store per the existing release process.
4. **OLD BUILD COMPATIBILITY:** the edge function widening in §2.2 is BACKWARD-COMPATIBLE — older mingla-business builds that still send `surface: "native"` continue to receive the PaymentIntent path (untouched by this spec). They will still hit the iOS 26 hang (unfixed), but they won't 500. Force-upgrade is recommended via app-store-update prompts; not enforced server-side.
5. **app-mobile/ is UNAFFECTED.** Its release process is independent.

**No DB migration.** No `supabase db push` step.

**No OTA `eas update`.** This spec is NOT OTA-able; that's the whole point of being Spec B post-Spec A (which WAS OTA-able).

---

## 9. PARITY CHECK (mandatory section per skill)

| Surface | Affected? | What changes |
|---------|-----------|-------------|
| mingla-business mobile iOS | YES | Pay flow rewritten to hosted Checkout via `openAuthSessionAsync` |
| mingla-business mobile Android | YES | Same as iOS |
| mingla-business web (Vercel) | NO functional change | Same `surface: "web"` path; only Mixpanel emits optionally added |
| app-mobile (consumer) iOS | NO | No code change in app-mobile |
| app-mobile (consumer) Android | NO | Same |
| app-mobile (consumer) web | NO | Same |
| Admin dashboard | NO | No Stripe surface in admin |
| Solo mode | NO | Buyer flow is anon — no solo/collab fork |
| Collab mode | NO | Same |

---

## 10. DISCOVERIES FOR ORCHESTRATOR

1. **app-mobile mirror**: `app-mobile`'s ticket-purchase flow (if any) still depends on `packages/payments-native/useStripePaymentSheet.ts` and ships the SAME iOS 26 + bridgeless hang. If operator decides to pivot app-mobile too, file ORCH-0839-C. Pre-condition: confirm app-mobile actually exercises native PaymentSheet for any production buyer flow (per ORCH-0833-0834-rescoped §D-4, RevenueCat owns consumer subscriptions; ticket purchase via PaymentSheet may be reachable only from a side path).
2. **`packages/payments-native/` decommissioning**: after ORCH-0839-C (if dispatched), this package's only remaining consumer goes away and it can be archived. Track as a Cycle B5 cleanup item.
3. **ORCH-0789 §4 + §5 retirement**: the gate clauses are being deleted as part of this spec. Orchestrator MUST update `INVARIANT_REGISTRY.md` to mark `I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED` as `RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B`; the invariant STAYS ACTIVE for app-mobile via `packages/payments-native/types.ts`.
4. **Apple Pay re-enable (ORCH-0838)**: hosted Checkout auto-enables Apple Pay AND Google Pay if the destination Stripe account has them enabled in the dashboard. The merchant-cert verification work for ORCH-0838 may become a Stripe-Dashboard-only operation (no code change). Orchestrator MUST re-scope ORCH-0838 post-this-close to reflect the lighter surface area.
5. **Telemetry: web parity**: §2.11 documents that the existing web buyer flow does NOT emit `ticket_checkout_pay_started` etc. — opportunistic polish to emit on the web branch too. If accepted, add to T-03 verification.
6. **Edge function `surface` body validation hardening**: §2.2's choice to fall through unknown surface values to `"native"` preserves backward compat but doesn't loudly reject typos like `"mobile_web"` (underscore) or `"mobileweb"`. Track as a defensive-hardening follow-up; not a blocker for this spec.
7. **`mingla-business/app.json` vs `app.config.ts`**: both files exist; `app.json` has `scheme: "https"` at line 57 (unrelated — that's an `intent-filter` AndroidManifest entry, NOT the top-level Expo scheme). The top-level scheme `mingla-business` comes from `app.config.ts:38`. Implementor MUST confirm the prebuild output uses `app.config.ts`'s scheme (Expo prefers `app.config.ts` over `app.json` when both exist).

---

## 11. CONFIDENCE LEVEL

**Spec confidence: HIGH.**

- The hosted Checkout edge function path is already shipped and proven on web (ORCH-0790, CLOSED).
- The `expo-web-browser` + `openAuthSessionAsync` pattern is already shipped in mingla-business itself (`BrandOnboardView.tsx:343-400` for Stripe Connect onboarding).
- The strict-grep registry pattern is well-established (per `feedback_strict_grep_registry_pattern`).
- The invariant retirement procedure is the same pattern used in ORCH-0700 Phase 3B (memory `feedback_ai_categories_decommissioned`).
- No new external dependencies. No new RLS policies. No DB migration.

Residual risk:
- Stripe's hosted Checkout success_url custom-scheme support is documented but not exercised by Mingla today. The implementor SHOULD do a quick experimental call to Stripe API (sandbox) to confirm `success_url: mingla-business://...` is accepted by `checkout.sessions.create` BEFORE writing the full edge change. Stripe historically has accepted any URL-shaped string; the `https://` check is enforced only on `cancel_url` for live mode in some configurations. If Stripe rejects custom scheme, fallback plan: route through `https://business.usemingla.com/checkout/return-bridge` which then `Linking.openURL`s the custom scheme. Document this fallback in the implementation report regardless.

---

## NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` grounded in the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md` and the predecessor implementation at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md`. Working tree is `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Follow the strict implementation order in §6 — edge function widening first (STOP for operator deploy gate before continuing), then service, component rewrite, provider-tree collapse, file deletions, CI gate edits (retire ORCH-0789 §4/§5 and ORCH-0778 mingla-business allow-list per §2.10; add new `orch-0839-b-mingla-business-no-native-stripe.mjs` with T-G1..T-G8), dependency removal, plugin removal in `app.config.ts`. Do NOT run `supabase db push` (no DB changes), do NOT publish `eas update` (NOT OTA-able — this requires a fresh EAS rebuild owned by the orchestrator at CLOSE), do NOT touch `app-mobile/` or `packages/payments-native/` source code, do NOT call `useAuth` anywhere in `mingla-business/app/checkout/` (the routes MUST remain anon-buyer-tolerant). Before implementing the edge function change, run one Stripe sandbox API call to confirm `success_url: mingla-business://...` is accepted by `checkout.sessions.create` and document the result in the implementation report; if rejected, use the https-bridge fallback in §11. On completion, write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` with old→new receipts, spec traceability, invariant verification (including retirement notes for I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED, I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG, I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE, and I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY for the mingla-business surface), parity check for mingla-business mobile iOS + Android + web + app-mobile (no change), and machine-readable CI gate output for all relevant gates. The next dispatch will be Claude `mingla-forensics` (TEST mode, TARGETED sub-mode) for QA against T-01..T-13 with live-fire on iOS sim + Android emulator via Maestro, then Codex `orchestrator-mingla` for CLOSE — which owns the edge-function deploy and the EAS production rebuild + store submission. If the operator wants Claude `mingla-implementor` instead of Codex, redirect there with the same spec.
