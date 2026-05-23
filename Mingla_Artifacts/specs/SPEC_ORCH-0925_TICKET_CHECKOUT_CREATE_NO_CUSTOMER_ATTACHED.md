# SPEC — ORCH-0925 [`ticket-checkout-create` does not attach Stripe Customer to payment-plan PIs — orphaned PaymentMethods cannot be charged off-session by cron]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md` (PROVEN confidence; 5/5 truth layers; 11 Stripe CLI probes)
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`
**Severity:** S0 — entire payment-plan feature silently non-functional for off-session charging since ORCH-0869 [Tr3 Installment Payments] Stage 1B shipped (2026-05-17/18). Blocks re-ship of ORCH-0921 [paid finalize-callers pass installment-plan params].

---

## §0 — Cross-Surface Impact Declaration

| Surface | In scope? | Impact / parity |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | NO | Consumer app does not initiate ticket checkout; consumer flow is brand-discovery only. |
| Consumer Android (`app-mobile/` on Android) | NO | Same as iOS. |
| Buyer/anonymous Web (`mingla-business/` `/checkout-trip/{tripEventId}`) | **YES (R-1)** | Stripe creates a real Customer per installment-plan checkout via `customer_creation: "always"`; PI.customer becomes `cus_xxx`; saved PM is attached to that Customer. No web/UI code change required. |
| Business iOS (`mingla-business/` on iOS, native PaymentSheet via deep-link) | **YES (R-2)** | Edge function looks up or creates Customer on connected account BEFORE `paymentIntents.create` for installment plans; PI.customer populated; PM attached on confirm. No native code change required; PaymentSheet receives the same `client_secret` + `customerId` + `customerEphemeralKeySecret` shape as today. |
| Business Android (`mingla-business/` on Android) | **YES (R-2)** | Parity automatic with business iOS (shared edge function payload; same native PaymentSheet bridge). |
| Admin Web (`mingla-admin/`) — adjacent | NO | No admin-side ticket-checkout creation. |
| Business Web preview (`mingla-business/` dev/web build) — adjacent | YES (R-1 parity automatic) | Shares the same `/checkout-trip/{tripEventId}` route + same edge function payload as production buyer-anon web. |

**Parity is automatic across all in-scope surfaces.** One edge function (`ticket-checkout-create/index.ts`) serves all entry paths. The buyer-anon-web R-1 fix and the native-PaymentSheet R-2 fix are in the SAME file and ship in the SAME edit. No separate per-surface implementations to drift apart.

**TEST phase parity** still runs live-fire on:
- Vercel-preview buyer-web Stripe test payment (R-1 path)
- (Deferred to operator if simulator unavailable) native business iOS PaymentSheet smoke for R-2 — fallback acceptable if Deno test + strict-grep gate cover the contract

---

## §1 — Scope and non-goals

### In scope (R-1 — Checkout Session path)

- Add `customer_creation: "always"` to the `stripe.checkout.sessions.create()` payload at [supabase/functions/ticket-checkout-create/index.ts:513-562](supabase/functions/ticket-checkout-create/index.ts#L513-L562) — **conditional on `isInstallmentPlan === true`**. Full-pay sessions remain unchanged (`customer_creation` defaults to `"if_required"`, preserving current behavior).
- Replace the stale comment at [lines 541-546](supabase/functions/ticket-checkout-create/index.ts#L541-L546) with the corrected explanation (verbatim text in §2).
- Preserve every other field in the existing payload (currency, line_items, payment_intent_data, automatic_tax, customer_email, success_url, cancel_url, metadata, idempotencyKey, stripeAccount).
- Preserve the existing comment at [lines 461-478](supabase/functions/ticket-checkout-create/index.ts#L461-L478) describing the ORCH-0843 direct-charge contract (the misleading sub-sentence on line 469-471 about Customer creation must also be corrected per §2).

### In scope (R-2 — native PaymentIntent path)

The existing ORCH-0844 customer lookup-or-create block at [lines 755-819](supabase/functions/ticket-checkout-create/index.ts#L755-L819) is **reordered**, not replaced. It already does the right Stripe API calls (`customers.search` by email on connected account + `customers.create` with `mingla_customer:<acct>:<sha256(email)>` idempotency key + `ephemeralKeys.create`). The only structural change is WHERE it runs and HOW failures propagate for installment plans.

Specific edits:

1. **Move** the customer lookup-or-create block (currently lines 755-819) to BEFORE the `paymentIntents.create` block (currently lines 632-692). The new order is: `try { customer + ephemeralKey } -> piCreateBody (with customer) -> paymentIntents.create -> persist`.
2. **Branch the catch block** so failures behave differently by plan type:
   - For `isInstallmentPlan === true`: re-throw the error (or return HTTP 502 with structured error `installment_customer_provisioning_failed`). Off-session installment plans CANNOT proceed without a Customer attached — silent guest-mode would re-create the orphaned-PM bug.
   - For `isInstallmentPlan === false` (full-pay): preserve current non-fatal behavior (`customerId = null; customerEphemeralKeySecret = null;` + `console.warn` + continue to guest-mode PaymentSheet). No functional change for full-pay flow.
3. Add `customer: customerId` to `piCreateBody` at [lines 652-666](supabase/functions/ticket-checkout-create/index.ts#L652-L666) **conditional on `isInstallmentPlan === true && customerId !== null`**. The spread shape matches the existing `...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {})` pattern adjacent.
4. The closing response payload at [lines 821-840](supabase/functions/ticket-checkout-create/index.ts#L821-L840) is unchanged — `customerId` + `customerEphemeralKeySecret` continue to ship to the native client in the same fields.

### Non-goals (explicit)

- **No migration.** No SQL change. No `biz_ticket_checkout_finalize` change. (ORCH-0921 re-ship is a separate ORCH AFTER this lands.)
- **No new helper function.** The existing ORCH-0844 block IS the helper — we reorder + branch the catch.
- **No Customer creation for full-pay (non-installment) checkouts.** Current behavior preserved.
- **No backfill of existing orphaned-PM orders in this SPEC** (handled by §6 audit query + operator-gated workflow, NOT by IMPLEMENT).
- **No `customer_creation: "always"` for full-pay Checkout Sessions.** Keeps blast radius minimal; preserves current automatic-tax + jurisdiction behavior for one-off ticket buys.
- **No retry/recovery logic** for Stripe `customers.search` / `customers.create` failures beyond the existing pattern — for installment plans the failure surfaces as a normal edge-function error; for full-pay the existing `console.warn` + guest-mode fallback persists.
- **No new env vars. No new secret. No new dependency.**
- **No change to `ticket-checkout-confirm` or `reconcile-stuck-checkouts`** (those are the ORCH-0921 re-ship territory).
- **No telemetry / analytics events** (Stripe Dashboard + edge-fn logs are sufficient).
- **No change to the existing customer-search idempotency-key shape** — already `mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}` which correctly de-duplicates per (account, email).

### Assumptions

- Connected-account Stripe Customer creation via `{ stripeAccount }` request option is correct and tested — confirmed by ORCH-0844 PASS + 30 days production usage in full-pay mode.
- `stripe.checkout.sessions.create` accepts `customer_creation: "always" | "if_required"` for `mode: "payment"` — confirmed by Stripe API reference.
- `buyerEmail` is non-null and validated at [line 99](supabase/functions/ticket-checkout-create/index.ts#L99) (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) before reaching the Stripe paths.
- `isInstallmentPlan` boolean is correctly derived at [line 314](supabase/functions/ticket-checkout-create/index.ts#L314) and stable across both paths.
- The `automatic_tax: { enabled: true }` setting at [line 540](supabase/functions/ticket-checkout-create/index.ts#L540) continues to collect billing address on the new Customer when `customer_creation: "always"` is added — Stripe documents this as the standard flow.

---

## §2 — Exact code changes (verbatim old + new)

### Change 1 — Checkout Session payload (R-1 fix)

**File:** `supabase/functions/ticket-checkout-create/index.ts`
**Region:** lines 540-554 (inside `stripe.checkout.sessions.create({...})`)

**OLD (verbatim):**
```ts
          automatic_tax: { enabled: true },
          // ORCH-0811 — customer_update is only valid alongside an existing
          // `customer` id. Mingla creates a new Stripe Customer per buyer via
          // customer_email, so Stripe rejects customer_update with "You cannot
          // use customer_update without setting customer". Checkout auto-
          // collects billing address on new Customers when automatic_tax is
          // enabled, so removing this line preserves tax jurisdiction lookup.
          customer_email: buyerEmail,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
          },
```

**NEW (verbatim):**
```ts
          automatic_tax: { enabled: true },
          // ORCH-0925 — installment plans MUST attach a Stripe Customer so
          // the cron `process-scheduled-installments` can later charge the
          // saved PaymentMethod off-session via `customer + payment_method`.
          // Stripe's default `customer_creation: "if_required"` for
          // `mode: "payment"` does NOT create a Customer just because
          // `customer_email` is set — `setup_future_usage: "off_session"`
          // alone saves the PM but leaves it orphaned (no Customer attached),
          // which the cron cannot charge. Setting `customer_creation: "always"`
          // forces Stripe to create the Customer + attach the PM post-checkout
          // so `paymentIntent.customer` resolves to a real `cus_xxx`. Full-pay
          // checkouts are unaffected (default remains `"if_required"`).
          // ORCH-0811 customer_update note retained: customer_update would
          // require a pre-existing `customer` id (which we don't have at
          // create time), so it stays omitted; `automatic_tax.enabled: true`
          // collects billing address on the new Customer for tax jurisdiction.
          ...(isInstallmentPlan ? { customer_creation: "always" as const } : {}),
          customer_email: buyerEmail,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
          },
```

**Diff summary:**
- Replaced stale 6-line ORCH-0811 comment block with corrected 13-line ORCH-0925 explanation.
- Inserted `...(isInstallmentPlan ? { customer_creation: "always" as const } : {}),` one line above `customer_email: buyerEmail,`.
- All other fields preserved verbatim.

### Change 2 — Comment on line 469-471 (CF-1 cleanup)

**File:** `supabase/functions/ticket-checkout-create/index.ts`
**Region:** lines 469-471 (inside the broader ORCH-0804/0843 comment at lines 461-478)

**OLD (verbatim, partial — only the 3 affected lines):**
```ts
      // Checkout auto-collects the buyer's billing address on the new
      // Customer (created from customer_email) when automatic_tax is
      // enabled, so jurisdiction lookup works without a customer_update
```

**NEW (verbatim):**
```ts
      // Checkout auto-collects the buyer's billing address on the new
      // Customer (created when customer_creation: "always" is set for
      // installment plans, per ORCH-0925) when automatic_tax is enabled,
      // so jurisdiction lookup works without a customer_update
```

**Diff summary:**
- Replaced the misleading "(created from customer_email)" parenthetical with the corrected "(created when customer_creation: \"always\" is set for installment plans, per ORCH-0925)".
- Adjusts line wrap to keep 80-col line length.

### Change 3 — Reorder + branch the customer/ephemeralKey block (R-2 fix part A)

**File:** `supabase/functions/ticket-checkout-create/index.ts`
**Action:** MOVE lines 755-819 (the entire `let customerId: string | null = null;` block through the close-`}` of its catch) to immediately BEFORE the existing `let paymentIntent: ...` declaration at line 627. The block must execute BEFORE `paymentIntents.create()`.

**OLD location (lines 755-819 in current source):**
```ts
  // ORCH-0844 (2026-05-15) — Connect direct-charge mobile config.
  // [... full multi-line comment ...]
  let customerId: string | null = null;
  let customerEphemeralKeySecret: string | null = null;
  try {
    // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT.
    // [... full block lines 757-808 ...]
  } catch (customerErr) {
    // Non-fatal: log and continue with null customer fields. Mobile SDK
    // will init PaymentSheet in guest mode. This preserves the existing
    // happy path even if Connect customer-creation breaks on Stripe's side.
    console.warn(
      "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
      customerErr instanceof Error ? customerErr.message : customerErr,
    );
    customerId = null;
    customerEphemeralKeySecret = null;
  }
```

**NEW location (immediately before `let paymentIntent` at current line 627):**

Same block body, RELOCATED. The catch is **branched on `isInstallmentPlan`**:

```ts
  // ORCH-0844 (2026-05-15) + ORCH-0925 (2026-05-22) — Connect direct-charge
  // mobile config + Customer attachment for installment plans.
  //
  // For full-pay flows this is non-fatal mobile config: PaymentSheet falls
  // back to guest mode (null customer fields) on failure. For installment
  // plans (ORCH-0925) this is FATAL: off-session installment charges require
  // a real Customer with the saved PM attached, so missing customer/PM here
  // means the cron `process-scheduled-installments` cannot charge later and
  // the booking silently loses revenue. We attach `customer: customerId` to
  // the deposit PI for installment plans so `setup_future_usage: "off_session"`
  // correctly binds the PM to the Customer. Full-pay PIs do NOT receive
  // `customer` (preserves existing behavior + Stripe Tax direct-charge shape).
  //
  // Block must run BEFORE paymentIntents.create so customerId is available
  // for piCreateBody construction.
  let customerId: string | null = null;
  let customerEphemeralKeySecret: string | null = null;
  let customerProvisioningError: unknown = null;
  try {
    const stripeForCustomer = stripeTicketCheckout();
    // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT.
    // The { stripeAccount } request option scopes the search to that account.
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only search; idempotency-key on Stripe search calls is rejected by the API (search is a query, not a mutation).
    const searchResult = await stripeForCustomer.customers.search(
      {
        query: `email:'${buyerEmail.replace(/'/g, "\\'")}'`,
        limit: 1,
      },
      { stripeAccount: stripeAccountId },
    );
    let customer = searchResult.data[0] ?? null;

    if (customer === null) {
      // 3.2.3.b — Idempotent creation by email-hashed idempotency-key.
      const customerIdemKey =
        `mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`;
      customer = await stripeForCustomer.customers.create(
        {
          email: buyerEmail,
          metadata: {
            mingla_buyer_email: buyerEmail,
            mingla_origin: "ticket_checkout_create_native",
          },
        },
        {
          idempotencyKey: customerIdemKey,
          stripeAccount: stripeAccountId,
        },
      );
    }
    customerId = customer.id;

    // 3.2.3.c — EphemeralKey for the mobile SDK, scoped to the connected
    // account. apiVersion is the platform's pinned STRIPE_API_VERSION;
    // ahead-of-SDK versions are non-fatal — the sheet still loads.
    const ephemeralKeyIdemKey =
      `mingla_ephkey:${stripeAccountId}:${customerId}:${Date.now()}`;
    const ephemeralKey = await stripeForCustomer.ephemeralKeys.create(
      { customer: customerId },
      {
        apiVersion: STRIPE_API_VERSION,
        stripeAccount: stripeAccountId,
        idempotencyKey: ephemeralKeyIdemKey,
      },
    );
    customerEphemeralKeySecret = String(ephemeralKey.secret ?? "");
    if (customerEphemeralKeySecret.length === 0) {
      // defensive: empty secret — treat as failure (paired-or-absent invariant).
      customerId = null;
      customerEphemeralKeySecret = null;
    }
  } catch (customerErr) {
    customerProvisioningError = customerErr;
    customerId = null;
    customerEphemeralKeySecret = null;
  }

  // ORCH-0925 — for installment plans, customer+PM is FATAL (off-session
  // cron charge cannot proceed without it). For full-pay, fall back to
  // guest-mode PaymentSheet (preserves ORCH-0844 behavior).
  if (isInstallmentPlan && customerId === null) {
    console.error(
      "[ticket-checkout-create] installment plan customer provisioning failed",
      customerProvisioningError instanceof Error
        ? customerProvisioningError.message
        : customerProvisioningError,
    );
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: "installment_customer_provisioning_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    return jsonResponse(
      {
        error: "installment_customer_provisioning_failed",
        detail: customerProvisioningError instanceof Error
          ? customerProvisioningError.message
          : "unknown",
      },
      502,
    );
  }
  if (!isInstallmentPlan && customerProvisioningError !== null) {
    // Full-pay: log and continue in guest mode (ORCH-0844 behavior preserved).
    console.warn(
      "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
      customerProvisioningError instanceof Error
        ? customerProvisioningError.message
        : customerProvisioningError,
    );
  }
```

**Delete** the old block at lines 755-819 (everything from the `// ORCH-0844 (2026-05-15) — Connect direct-charge mobile config.` comment through the closing `}` of its catch block) so it does not appear twice. The response payload at the new lines 821-840 (now shifted up) continues to read `customerId` + `customerEphemeralKeySecret` from the same in-scope variables.

### Change 4 — Add `customer: customerId` to `piCreateBody` (R-2 fix part B)

**File:** `supabase/functions/ticket-checkout-create/index.ts`
**Region:** lines 652-666 (inside the `const piCreateBody: Record<string, unknown> = {...}` literal). After Change 3 reorder these line numbers will shift.

**OLD (verbatim):**
```ts
    const piCreateBody: Record<string, unknown> = {
      amount: totalCents,
      currency,
      // ORCH-0869 [Tr3 Installment Payments]: when deposit is installment-
      // plan-root, save PM for off-session installment charges.
      ...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {}),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_checkout_session_id: checkoutSessionId,
        mingla_event_id: eventId,
        mingla_buyer_email: buyerEmail,
        // ORCH-0869: deposit PI marker for finalize RPC discrimination.
        ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}),
      },
    };
```

**NEW (verbatim):**
```ts
    const piCreateBody: Record<string, unknown> = {
      amount: totalCents,
      currency,
      // ORCH-0869 [Tr3 Installment Payments]: when deposit is installment-
      // plan-root, save PM for off-session installment charges.
      ...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {}),
      // ORCH-0925: installment plans MUST attach a Stripe Customer so the
      // saved PM binds to the Customer (cron later charges off-session via
      // {customer, payment_method}). customerId is provisioned earlier in
      // this handler (FATAL on failure for installment plans). Full-pay PIs
      // do NOT receive a customer field (preserves ORCH-0843 direct-charge
      // shape + ORCH-0844 guest-mode fallback).
      ...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {}),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_checkout_session_id: checkoutSessionId,
        mingla_event_id: eventId,
        mingla_buyer_email: buyerEmail,
        // ORCH-0869: deposit PI marker for finalize RPC discrimination.
        ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}),
      },
    };
```

**Diff summary:**
- Inserted `...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {}),` one line below the `setup_future_usage` spread.
- The `customerId !== null` guard is belt-and-suspenders: Change 3 already returns 502 BEFORE reaching this code when `isInstallmentPlan && customerId === null`, so the guard is defensive against future refactors that might remove the early return.

---

## §3 — Layer-by-layer specification

| Layer | Touched? | Detail |
|---|---|---|
| Database (migrations / RLS) | NO | State explicitly: no migration. Existing schema (`orders.stripe_customer_id_on_connected_account`, `orders.saved_payment_method_id`, `biz_ticket_checkout_finalize` RPC, `order_installments`) is unchanged. ORCH-0921 8-param finalize signature already exists in migration `20260724000000_orch_0921_finalize_compare_and_correct.sql` — ORCH-0925 produces the inputs the finalize RPC will need once ORCH-0921 re-ships. |
| Edge function | YES (primary) | `supabase/functions/ticket-checkout-create/index.ts` only. No other edge functions touched. Deploy will bump from v80 to v81. |
| Service / hook / component | NO | Mobile clients (`mingla-business/`, `app-mobile/`) read the existing response payload shape unchanged. `customerId` + `customerEphemeralKeySecret` continue to ship as today. |
| Realtime / Cache | NO | No subscriptions, no query keys affected. |
| Analytics | NO | No new events. Existing `console.log` / `console.warn` / `console.error` lines preserved. Stripe Dashboard remains the system of record for charge/customer state. |
| External APIs | YES (Stripe) | `stripe.customers.search` + `stripe.customers.create` + `stripe.ephemeralKeys.create` (all already in use today; just reordered) + `stripe.checkout.sessions.create` (one new field `customer_creation`) + `stripe.paymentIntents.create` (one new field `customer`). |
| Auth | NO | Existing service-role auth at handler entry preserved. |

---

## §4 — Success criteria (numbered, testable)

| ID | Criterion | Verification |
|---|---|---|
| **SC-1** | A Checkout Session created for an installment-plan trip ticket has `customer_creation: "always"` in the session payload. | Stripe CLI `checkout sessions retrieve cs_test_xxx --stripe-account=acct_xxx` returns `customer_creation: "always"`. |
| **SC-2** | The PaymentIntent created from that Checkout Session has non-null `customer` (a `cus_xxx` string). | Stripe CLI `payment_intents retrieve pi_xxx --stripe-account=acct_xxx` returns `customer: "cus_xxx"`. |
| **SC-3** | The PaymentMethod saved during that Checkout Session has `customer` equal to the PI's customer. | Stripe CLI `payment_methods retrieve pm_xxx --stripe-account=acct_xxx` returns `customer: "cus_xxx"` matching SC-2. |
| **SC-4** | A native PaymentIntent created for an installment-plan trip ticket has non-null `customer` (a `cus_xxx` string). | Stripe CLI on the resulting `pi_xxx` returns `customer: "cus_xxx"`. |
| **SC-5** | Repeat installment-plan checkouts with the SAME buyer email reuse the existing Customer (no duplicate Customer rows). | Stripe CLI `customers list --email=<email> --stripe-account=acct_xxx --limit=5` returns 1 Customer (the idempotency-key + `customers.search` first-match path guarantees this within a single account). |
| **SC-6** | Full-pay (non-installment) checkouts are UNCHANGED — no `customer_creation` field set, no `customer:` on the native PI, full-pay native PaymentSheet still falls back to guest mode if customer provisioning fails (ORCH-0844 contract). | Stripe CLI on a full-pay test Checkout Session returns no `customer_creation` override; full-pay native PI has no `customer` field. |
| **SC-7** | When customer provisioning fails for an installment plan (simulated by injecting an invalid `stripeAccountId`), the edge function returns HTTP 502 with `error: "installment_customer_provisioning_failed"` and the session row is updated to `status = "failed"`. The PI is NOT created (no orphaned PaymentIntent on Stripe). | Deno test mocks Stripe `customers.search` to throw; asserts 502 response + session row update + no `paymentIntents.create` call. |
| **SC-8** | When customer provisioning fails for a full-pay plan, the edge function returns HTTP 200 with `customerId: null` + `customerEphemeralKeySecret: null` + a valid PI (guest mode preserved). | Deno test mocks Stripe `customers.search` to throw with `isInstallmentPlan = false`; asserts 200 response + null customer fields + PI was created. |
| **SC-9** | No regression in `ticket-checkout-create` HTTP 200 success rate or response time. | Post-deploy `mcp__supabase__get_logs --service edge-function --filter "ticket-checkout-create"` shows no new 500/502 from `installment_customer_provisioning_failed` outside the operator's deliberate failure test. |
| **SC-10** | Strict-grep CI gate `I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER` passes. | Local + CI run of `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` exits 0. |
| **SC-11** | Implementor happy-path Deno test passes; `fails-on-revert` verified by implementor at the pre-fix commit hash. | Implementor cites: test path + passing run output + `fails-on-revert verified at <commit-hash-before-fix>` in implementation report. |
| **SC-12** | Tester adversarial Deno test passes (attacks a distinct angle from happy-path). | Tester writes adversarial test at the path locked in §5; cites passing run + adversarial-angle description in QA report. |

---

## §5 — Regression test contract (per ORCH-0840 [Regression-test enforcement + append-only CI])

### Implementor happy-path Deno test

**Path:** `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts`

**Pattern:** Follow the established source-string assertion pattern from `orch-0843-direct-charge-shape.test.ts` — read `index.ts`, strip comments, assert presence of load-bearing strings + absence of forbidden patterns. This matches the existing edge-function test style and is consistent with how ORCH-0843, ORCH-0911, and the payment-method-allowlist tests are structured.

**Required assertions (minimum):**

1. **Test name:** `"ORCH-0925 — Checkout Session conditionally sets customer_creation: 'always' for installment plans"` — assert source contains the literal `customer_creation: "always"` inside an `isInstallmentPlan` conditional spread. Regex must match `\.\.\.\(isInstallmentPlan\s*\?\s*\{\s*customer_creation:\s*"always"`.
2. **Test name:** `"ORCH-0925 — piCreateBody conditionally attaches customer for installment plans"` — assert source contains `...(isInstallmentPlan && customerId !== null ? { customer: customerId }` (exact string, comment-stripped).
3. **Test name:** `"ORCH-0925 — customer provisioning is FATAL for installment plans"` — assert source contains the literal `"installment_customer_provisioning_failed"` AND the literal `if (isInstallmentPlan && customerId === null)`.
4. **Test name:** `"ORCH-0925 — customer provisioning block precedes paymentIntents.create"` — assert the source index of the literal `let customerId` is LESS THAN the source index of the literal `paymentIntents.create` (i.e., the reorder actually happened).
5. **Test name:** `"ORCH-0925 — customer provisioning block does NOT appear twice"` — assert the source contains exactly ONE match of `let customerId: string | null = null;` (regression guard against forgetting to delete the old location after the move).

**`fails-on-revert` verification:**
- Implementor reverts the 4 code changes (Changes 1-4 from §2) on a local branch.
- Re-runs `cd supabase && deno test --allow-read functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts`.
- Assertions 1, 2, 3 MUST FAIL. Assertion 4 MAY pass or fail depending on whether the block move was reverted. Assertion 5 MUST pass on revert (block is back in one place).
- Implementor cites this in the implementation report under "Regression Test" section: test path + passing run output + `fails-on-revert verified at <commit-hash>`.

### Tester adversarial Deno test

**Path:** `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.adversarial.test.ts`

**Distinct angle from happy-path:** Happy-path verifies the fix shape is present in source. Adversarial attacks the **scope correctness** + **failure-mode contract** — i.e., the conditional is correctly scoped to `isInstallmentPlan` (no leak to full-pay), and the FATAL/non-fatal branching is correctly differentiated.

**Required assertions (minimum):**

1. **Test name:** `"ORCH-0925 — full-pay Checkout Session does NOT receive customer_creation"` — assert the source does NOT contain any `customer_creation:` reference OUTSIDE an `isInstallmentPlan` conditional. Negative regex: `customer_creation` should appear ONLY in `...(isInstallmentPlan ?` spread context.
2. **Test name:** `"ORCH-0925 — full-pay native PI does NOT receive customer field"` — assert the `piCreateBody` literal does not contain any unconditional `customer:` key. The only `customer:` reference inside `piCreateBody` must be guarded by `isInstallmentPlan && customerId !== null`.
3. **Test name:** `"ORCH-0925 — full-pay customer provisioning failure preserves ORCH-0844 guest-mode fallback"` — assert source contains the literal `if (!isInstallmentPlan && customerProvisioningError !== null)` AND the literal `"continuing in guest mode"` (proves the full-pay non-fatal path is preserved).
4. **Test name:** `"ORCH-0925 — installment customer provisioning failure does NOT create orphaned PaymentIntent"` — assert the early-return `return jsonResponse(...502)` appears BEFORE the `paymentIntents.create` source index. Regex: source.indexOf(`"installment_customer_provisioning_failed"`) < source.indexOf(`paymentIntents.create`).
5. **Test name:** `"ORCH-0925 — Gmail-alias buyer emails resolve to a single Customer"` — assert the existing `customers.search` query escapes single quotes correctly (regex match `query: \`email:'\$\{buyerEmail\.replace\(/'/g, "\\\\'"\)\}'\``) so emails like `seth+alias@gmail.com` and `seth+other@gmail.com` are correctly matched as DIFFERENT Customers (per Stripe's per-email search semantics — Gmail aliasing is not collapsed by Stripe, this is by design).

**Both tests committed in the SAME PR** as the source fix per ORCH-0840 §3. Tester verifies via `git diff origin/main...HEAD --name-only` that both `.test.ts` paths appear.

---

## §6 — Backfill audit query (operator-gated, post-deploy)

After ORCH-0925 ships and is verified live (SC-1..SC-9), the orchestrator runs this query via Supabase Management API to surface any pre-ORCH-0925 orphaned-PM orders that need operator decision (backfill vs refund):

```sql
SELECT
  o.id AS order_id,
  o.brand_id,
  b.display_name AS brand_name,
  o.event_id,
  e.name AS event_name,
  o.buyer_email,
  o.total_cents,
  o.currency,
  o.created_at,
  o.stripe_payment_intent_id,
  o.stripe_customer_id_on_connected_account,
  o.saved_payment_method_id,
  o.installment_plan_root,
  COUNT(oi.id) AS installment_count,
  COALESCE(SUM(oi.amount_cents) FILTER (WHERE oi.status = 'scheduled'), 0) AS scheduled_cents_outstanding,
  COALESCE(SUM(oi.amount_cents) FILTER (WHERE oi.status = 'paid'), 0) AS paid_cents
FROM orders o
JOIN brands b ON b.id = o.brand_id
LEFT JOIN events e ON e.id = o.event_id
LEFT JOIN order_installments oi ON oi.order_id = o.id
WHERE o.installment_plan_root = true
  AND o.created_at < '<ORCH-0925 CLOSE timestamp ISO 8601>'
  AND (
    o.stripe_customer_id_on_connected_account IS NULL
    OR o.saved_payment_method_id IS NULL
  )
GROUP BY o.id, b.display_name, e.name
ORDER BY o.created_at ASC;
```

### Per-row decision template

For each row returned, operator decides per the table below. Orchestrator MUST verify any Stripe ID via Stripe CLI BEFORE writing to the DB (DISC-0925-C lesson):

| Path | When | Steps |
|---|---|---|
| **Backfill** (recover) | Real customer, has paid deposit, wants the booking | (1) `stripe customers create --email=<email> --name=<name> --stripe-account=<acct>` → capture `cus_xxx`; (2) `stripe payment_methods retrieve <pm_id> --stripe-account=<acct>` to confirm PM still exists; (3) `stripe payment_methods attach <pm_id> --customer=<cus_xxx> --stripe-account=<acct>`; (4) **VERIFY** `stripe customers retrieve <cus_xxx> --stripe-account=<acct>` returns non-null; (5) UPDATE `orders SET stripe_customer_id_on_connected_account = '<cus_xxx>', saved_payment_method_id = '<pm_id>' WHERE id = '<order_id>'`; (6) re-run cron for the immediate due installment. |
| **Refund** (abandon) | Test order, hallucinated data, customer wants out | (1) `stripe refunds create --payment-intent=<pi_id> --stripe-account=<acct>`; (2) UPDATE `orders SET cancelled_at = NOW(), cancellation_reason = 'orch_0925_orphaned_pm_pre_fix' WHERE id = '<order_id>'`; (3) UPDATE `ticket_checkout_sessions SET status = 'expired' WHERE id = '<session_id>'` if still `awaiting_*`. |

### Pre-backfill verification probe (DISC-0925-C codification)

Every backfill SQL MUST be preceded by:

```bash
# Probe BEFORE UPDATE — ensure the Stripe IDs actually resolve
stripe customers retrieve <cus_xxx> --stripe-account=<acct> | jq '.id, .email'
stripe payment_methods retrieve <pm_yyy> --stripe-account=<acct> | jq '.id, .customer'
# Confirm: customer.id == cus_xxx, pm.customer == cus_xxx (post-attach)
```

If ANY probe returns `null` or errors, the backfill is invalid — do NOT run the UPDATE.

---

## §7 — Strict-grep CI gate

### Script

**Path:** `.github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs`

**Pattern:** Follow `i-proposed-finalize-callers-pass-installment-params.mjs` template (single `.mjs` script, ESM, node-builtin imports only, `--scan-dir` arg for self-test).

**What it asserts:**

1. **Checkout Session rule:** Every `stripe.checkout.sessions.create(` call site under `supabase/functions/ticket-checkout-create/index.ts` (and any future caller) whose 30-line context window contains both `setup_future_usage:\s*"off_session"` AND `isInstallmentPlan` MUST also contain `customer_creation:\s*"always"` within the same context window. Failure to do so = violation.

2. **PaymentIntent rule:** Every `stripe.paymentIntents.create(` call site under `supabase/functions/ticket-checkout-create/index.ts` whose 30-line context window contains `setup_future_usage:\s*"off_session"` AND `isInstallmentPlan` MUST also contain `customer:\s*customerId` within the same context window. Failure = violation.

3. **ALLOWLIST tag:** `orch-strict-grep-allow orch-0925-installment-customer-attached` within 5 lines of the call site is an explicit opt-out (empty for v1; documented for future use).

**Scan scope:** `supabase/functions/` (recursive, excluding `__tests__/` and `node_modules/`).

**Self-test mode:** `--self-test` arg synthesizes positive + negative fixtures in a tmp dir and asserts the script flags the negative + passes the positive. Mirrors the existing pattern (e.g., `i-proposed-h-rls-returning-owner-gap.mjs --self-test`).

### Workflow plug-in

**File:** `.github/workflows/strict-grep-mingla-business.yml`

**Action:** Add one new job step at the end of the existing job's `steps:` block, plugging in per the pattern at lines 175-245 of the workflow (e.g., `i-proposed-a-brands-deleted-filter.mjs` style):

```yaml
      - name: I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER (self-test)
        run: node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs --self-test
      - name: I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER
        run: node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs
```

**Comment registry update:** Add one line to the workflow's invariant-listing comment block (around line 103):

```
#   - I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER (i-proposed-orch-0925-installment-plan-attaches-customer.mjs) — installment-plan Checkout Sessions + PIs must attach Stripe Customer (ORCH-0925)
```

**Codified invariant ID:** `I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER` — flip from `I-PROPOSED-*` to `I-*` at ORCH-0925 CLOSE per the standard registry promotion rule.

---

## §8 — Telemetry / observability

No new analytics events. The existing `console.log` / `console.warn` / `console.error` lines on the customer block are PRESERVED (the new error path adds one `console.error` for the FATAL installment-plan path).

Post-deploy verification path:
- `mcp__supabase__get_logs --service edge-function --filter "ticket-checkout-create"` — watch for `installment_customer_provisioning_failed` errors (should be ZERO outside operator's deliberate failure test).
- Stripe Dashboard → Connected Account `acct_1TY6UFPjlZjiLhFt` (The DC Adventure) → Customers → confirm new test purchases create real Customers with attached PMs.
- Stripe CLI direct probes per SC-1..SC-6.

---

## §9 — Implementation order (locked for implementor)

The implementor executes in this exact sequence. Deviation MUST be flagged.

1. **Read** `supabase/functions/ticket-checkout-create/index.ts` in full (842 lines). Identify the 4 change sites by line number (note line numbers will shift as edits land).
2. **Apply Change 1** — Checkout Session payload + comment replacement at the original lines 540-554.
3. **Apply Change 2** — comment correction at the original lines 469-471.
4. **Apply Change 3** — REORDER the customer/ephemeralKey block from original lines 755-819 to BEFORE `let paymentIntent` at original line 627. Delete the old location. Add the branched fatal/non-fatal post-block.
5. **Apply Change 4** — add `customer: customerId` conditional to `piCreateBody`. This is now adjacent to the moved customer block.
6. **Run** `cd supabase && deno check functions/ticket-checkout-create/index.ts` — must pass.
7. **Write happy-path test** at `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` per §5 (5 assertions minimum).
8. **Run** `cd supabase && deno test --allow-read functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` — must pass.
9. **Verify `fails-on-revert`** — stash all 4 changes, re-run the test, confirm assertions 1, 2, 3 FAIL. Restore changes. Re-run — must pass. Capture pre-fix commit hash.
10. **Write strict-grep gate** at `.github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` per §7. Implement self-test.
11. **Run** `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs --self-test` — must pass.
12. **Run** `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` against the live repo — must pass (the fix is now in place).
13. **Wire workflow** — add the two new steps + comment-registry line to `.github/workflows/strict-grep-mingla-business.yml` per §7.
14. **Write implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md` with:
    - Old → New receipts for the 4 changes
    - Spec traceability mapping SC-1..SC-12 to evidence
    - Regression test section: test path + passing run + `fails-on-revert verified at <commit hash>`
    - Strict-grep gate path + self-test pass evidence
    - Discoveries for Orchestrator (any side issues)
15. **Return to operator** with the implementation report path + the next-handoff to Claude `mingla-forensics` (TEST mode) for QA.

**Do NOT:**
- Deploy the edge function (orchestrator owns deploy per `feedback_orchestrator_deploys_edge_functions.md`).
- Apply any migration (none in scope).
- Touch any other file under `supabase/functions/`, `app-mobile/`, `mingla-business/`, or `mingla-admin/`.
- Modify the existing tests at `__tests__/orch-0843-direct-charge-shape.test.ts`, `payment_method_allowlist.test.ts`, etc. (append-only per ORCH-0840 CI gate).

---

## §10 — Pre-merge gate criteria (for orchestrator at CLOSE)

All of the following MUST be true before merge:

- ✅ All SC-1..SC-12 verified (SC-4 may be `unverified-runtime` if native sim unavailable; flag as CONDITIONAL PASS gated on operator acceptance)
- ✅ Implementor happy-path test + tester adversarial test BOTH present in `git diff origin/main...HEAD --name-only`
- ✅ Strict-grep gate passes locally + in CI
- ✅ Stripe CLI live-fire on Vercel preview confirms SC-1, SC-2, SC-3 (buyer-web R-1 path)
- ✅ Edge function deployed: `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` (bumps v80 → v81); orchestrator captures the version bump via `mcp__supabase__list_edge_functions`
- ✅ Deno check + Deno test BOTH green locally before push
- ✅ Operator explicit approval per pre-merge gate (Step 5 of orchestrator CLOSE protocol)
- ✅ §6 backfill audit query result reviewed by operator (decide per-row backfill vs refund; this step may queue a follow-up ORCH-0926 [Orphaned-PM pre-ORCH-0925 backfill] if rows exist)
- ✅ `[deploy]` tag NOT required in commit subject (edge-function-only ORCH per `feedback_vercel_deploy_gate.md`)

---

## §11 — Invariant tracking

### New invariant (proposed → flips to active at CLOSE)

**`I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER`** — Every Stripe Checkout Session and every raw PaymentIntent created under `supabase/functions/ticket-checkout-create/index.ts` for `isInstallmentPlan === true` MUST attach a Stripe Customer via `customer_creation: "always"` (Checkout Session) or `customer: <cus_xxx>` (raw PI). Enforced by `.github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` at CI and `orch-0925-installment-customer-attachment.test.ts` + `.adversarial.test.ts` at local `deno test`. Rationale: `setup_future_usage: "off_session"` saves the PaymentMethod but Stripe leaves it orphaned (no Customer attached) when `customer_creation` is left at the default `"if_required"` — the cron `process-scheduled-installments` then cannot charge off-session and revenue is silently lost. Establishes the contract that off-session installment charging requires both `customer` + `payment_method` per Stripe's API.

### Existing invariants this SPEC must preserve

- **I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS** (ORCH-0921): no edit to `ticket-checkout-confirm` or `reconcile-stuck-checkouts`; the rolled-back 5-param shape stays in place until ORCH-0921 re-ship. Strict-grep gate currently allowlisted via `orch-strict-grep-allow finalize-no-plan-root` comments.
- **I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST** (ORCH-0849): `payment_method_types` source unchanged (`getPaymentMethodTypes()` + `getInstallmentPaymentMethodTypes()`).
- **ORCH-0843 direct-charge invariant** (`transfer_data:` forbidden; `stripeAccount` request-option mandatory): preserved — Change 3's relocated block still passes `{ stripeAccount: stripeAccountId }` on every call.
- **ORCH-0844 paired-or-absent invariant** (`customerId` + `customerEphemeralKeySecret` both populated or both null): preserved — full-pay catch block sets both to null; installment FATAL path returns 502 before the response is built.
- **ORCH-0804 Stripe Tax invariant** (`automatic_tax.enabled: true` on Checkout Session; no `liability` block): preserved — Change 1 does NOT touch `automatic_tax`.

### Invariants this SPEC does NOT establish (deferred)

- **DISC-0925-A: `I-STRIPE-OFF-SESSION-REQUIRES-CUSTOMER-ATTACHMENT`** (global) — broader than ORCH-0925's edge-function scope; would extend to all future Stripe setup-future-usage call sites across `supabase/functions/`. Defer to a meta-orch if a second edge function ever introduces `setup_future_usage`.
- **DISC-0925-C: `I-BACKFILL-VERIFIES-STRIPE-IDS-BEFORE-WRITE`** (process invariant, not code) — codify as a feedback memory file, not a strict-grep gate.

---

## §12 — Out-of-scope follow-ups (Discoveries for Orchestrator)

| ID | Discovery | Recommended action |
|---|---|---|
| **DISC-0925-A** | Stripe `setup_future_usage: "off_session"` requires explicit Customer attachment via `customer_creation: "always"` (Checkout Session) or `customer:` (raw PI). Stripe accepts the request silently without it, but the resulting PM is orphaned and uncharge-able off-session. | Create memory file at `/Users/sethogieva/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_stripe_off_session_requires_customer.md`. Index entry under MEMORY.md → Supabase Database Access OR a new "Stripe Integration" section. |
| **DISC-0925-B** | The stale comment at original lines 541-546 of `ticket-checkout-create` actively misled both ORCH-0869 Stage 1B and ORCH-0921 implementors. Any comment asserting "X is handled by Y" without runtime verification rots. | Add a rule to `mingla-implementor` skill: when reading existing comments that assert system behavior, verify the claim via runtime probe OR rewrite the comment to reflect actual behavior. |
| **DISC-0925-C** | Yesterday's morning operator-gated backfill used a hallucinated Customer ID (`cus_1TYg94…` does not resolve in Stripe). | Codify in `feedback_orchestrator_deploys_edge_functions.md` (or a new sibling file): every backfill SQL that references a Stripe ID MUST be preceded by a Stripe CLI probe verifying the ID resolves. Mandate at orchestrator skill level. |
| **DISC-0925-D** | ORCH-0869 [Tr3 Installment Payments] SPEC and ORCH-0921 [paid finalize-callers pass installment-plan params] SPEC both ASSUMED Stripe attached a Customer when `customer_email` was set. Neither SPEC included a live-fire smoke step. | Add to `mingla-forensics` SPEC mode: any Stripe-touching SPEC MUST include a §X "Runtime probe" section requiring the implementor or tester to verify the resulting PI/Customer/PM shape via Stripe CLI matches the SPEC's assumptions. |
| **DISC-0925-E** | Existing production payment-plan orders that landed before ORCH-0925 ships are recoverable via §6 backfill workflow OR refund. Operator decides per-order. | Register follow-up ORCH-0926 [Orphaned-PM pre-ORCH-0925 backfill] AFTER ORCH-0925 CLOSE if §6 audit returns any rows. Scope: per-row Stripe Customer creation + PM attach + DB UPDATE, OR refund + cancel. |
| **DISC-0925-F** | ORCH-0921 re-ship is BLOCKED on ORCH-0925 CLOSE. Once ORCH-0925 is live and SC-1..SC-9 verified, the 8-param finalize signature in `ticket-checkout-confirm` + `reconcile-stuck-checkouts` can re-ship without HTTP 500s. | Register follow-up ORCH-0927 [ORCH-0921 re-ship after ORCH-0925] AFTER ORCH-0925 CLOSE. Scope: revert the ORCH-0924 rollback in both edge functions; re-deploy v34→v35 (confirm) + v26→v27 (reconcile). |

---

## §13 — Working-tree handoff

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. All SPEC reads + writes happen on this branch. No worktree split.

Next dispatch: Codex `implementor-mingla` per `feedback_claude_codex_full_parity.md` default routing for IMPLEMENT phase. The implementor reads this SPEC + the investigation report, executes §9 in order, and writes the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`.
