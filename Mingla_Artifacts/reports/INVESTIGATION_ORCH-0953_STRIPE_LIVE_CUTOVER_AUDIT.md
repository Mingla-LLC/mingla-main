# INVESTIGATION ORCH-0953 - Stripe live-mode cutover audit

Date: 2026-05-24  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]`  
Branch: `ORCH-0953-stripe-live-cutover`  
Mode: Forensic investigation only. No fixes, no code edits outside this report, no Stripe Dashboard mutations, no env writes, no live-mode Stripe API calls.

## Executive summary

- **Go/no-go: NO-GO for live cutover until SPEC closes the gaps below.** The source code is substantially RAK-oriented and direct-charge aware, but live key mode, live webhook endpoints, live RAK permissions, Apple/Google Pay production enrollment, and live Connect controller settings are not proven from read-only probes.
- **The current runtime architecture is platform-liable direct charges.** Code creates direct charges on connected accounts using `Stripe-Account` plus `application_fee_amount`; Stripe test connected accounts show `losses.payments=application`, `fees.payer=application`, `requirement_collection=stripe`, `stripe_dashboard.type=express`.
- **Webhook state is the highest-confidence blocking gap.** Test-mode Dashboard endpoints omit routed events `checkout.session.completed`, `refund.created`, and `refund.updated`; they also subscribe to events the router does not handle, including `charge.dispute.created`, `charge.failed`, and `payment_intent.processing`.
- **Secrets exist by name in Supabase, but mode and permission cannot be proven from the redacted Management API output.** `STRIPE_RAK_*`, `STRIPE_SECRET_KEY`, webhook secrets, and `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` are present, but the probe cannot verify `rk_live_` / `sk_live_` / `pk_live_` prefixes or exact restricted-key permissions.
- **Buyer payment surfaces are close but not cutover-clean.** Native PaymentSheet receives dynamic publishable key and connected-account ID from the edge function, but native Stripe Tax is explicitly deferred; mingla-business has a build-time `pk_test_` publishable fallback and a URL-scheme mismatch risk for Stripe return URLs.

## Scope and evidence protocol

Dispatch required six investigation areas and six-field evidence per finding. This report uses the fields:

| Field | Meaning |
| --- | --- |
| Finding | What is true now. |
| Evidence | Exact probe, table, code, or artifact evidence. |
| Current behavior | What Mingla currently does. |
| Cutover impact | Why it matters for test to live. |
| Confidence | High / medium / low, with limits. |
| SPEC action | What the next SPEC should require or explicitly defer. |

Source layers used: repo code, Mingla artifacts/decision log, Supabase Management API/SQL, Supabase CLI secret-name listing, Stripe CLI/MCP test-mode read probes, and client app configs. Live-mode Stripe Dashboard readback was not available as a trustworthy machine-readable source without crossing the guard against live-mode API probing or key exposure.

## Key inventory

| Key/env/setting | Current evidence | Mode proven? | Permission proven? | Current use |
| --- | --- | ---: | ---: | --- |
| `STRIPE_RAK_ONBOARD` | Present in Supabase secrets list, redacted. Used by `_shared/stripe.ts` and `_shared/stripeBlueprintClient.ts`. | No | No | Connect account create/account-link and SDK-backed onboard path. |
| `STRIPE_RAK_WEBHOOK` | Present in Supabase secrets list, redacted. | No | No | Stripe webhook signature construction client and router Stripe calls. |
| `STRIPE_RAK_REFRESH_STATUS` | Present in Supabase secrets list, redacted. | No | No | Connected account status refresh/retrieve. |
| `STRIPE_RAK_DETACH` | Present in Supabase secrets list, redacted. | No | No | Connected account deletion/detach. |
| `STRIPE_RAK_BALANCES` | Present in Supabase secrets list, redacted. | No | No | Connected account balance retrieval. |
| `STRIPE_RAK_KYC_REMINDER` | Present in Supabase secrets list, redacted. | No | No | KYC stall reminder/account reads. |
| `STRIPE_RAK_TICKET_CHECKOUT` | Present in Supabase secrets list, redacted. | No | No | Checkout Sessions, PaymentIntents, Customers, EphemeralKeys, installment charges, confirm/reconcile reads. |
| `STRIPE_RAK_TICKET_REFUND` | Present in Supabase secrets list, redacted. | No | No | In-app order refunds and trip cancellation refunds. |
| `STRIPE_RAK_TAX_DASHBOARD_LINK` | Present in Supabase secrets list, redacted. | No | No | Legacy secret. Current code does not use this factory for login links. |
| `STRIPE_SECRET_KEY` | Present in Supabase secrets list, redacted. | No | Full key by definition; exact account/mode not proven. | Required by `brand-stripe-tax-dashboard-link`; fallback in blueprint onboarding/account-link raw client. |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PLATFORM`, `STRIPE_WEBHOOK_SECRET_PREVIOUS` | Present in Supabase secrets list, redacted. | No | N/A | Multi-secret Stripe webhook signature verification. |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Present in Supabase secrets list, redacted; also exposed by edge response for native. | No | N/A | Native PaymentSheet and Connect embedded components. |
| mingla-business build fallback publishable key | `mingla-business/app.config.ts` has a literal `pk_test_...` fallback. | Yes: fallback is test-mode. | N/A | Connect embedded components if production env is missing. |

Important limitation: Supabase CLI returns secret names but not values. This proves only that a secret exists, not whether it is live, test, restricted, full, rotated, or permission-correct.

## Permission audit

| Surface | Code evidence | Intended credential | Actual code dependency | Audit result |
| --- | --- | --- | --- | --- |
| Shared Stripe SDK clients | `supabase/functions/_shared/stripe.ts:31-81` requires one env var per factory. | Function-specific RAKs. | `STRIPE_RAK_*` for most functions. | Good pattern, but Dashboard permissions and live prefixes unproven. |
| Tax dashboard login link | `supabase/functions/_shared/stripe.ts:58-73`, `brand-stripe-tax-dashboard-link/index.ts:92-102`. | Full secret key by accepted exception. | `STRIPE_SECRET_KEY`. | Deliberate full-key exception; must be in live cutover risk register and guarded by auth/audit. |
| Connect raw blueprint account create/link | `_shared/stripeBlueprintClient.ts:104-180`. | `STRIPE_RAK_ONBOARD`. | `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]` fallback. | Fallback can silently use full key if RAK absent; SPEC should fail closed or require explicit operator proof. |
| Hosted web checkout | `ticket-checkout-create/index.ts:523-581`. | Ticket checkout RAK. | Direct-charge Checkout Session with `stripeAccount`. | Permission must include Checkout Sessions, PaymentIntents, Customers as needed; live RAK permission unproven. |
| Native checkout | `ticket-checkout-create/index.ts:659-704`, `827-835`. | Ticket checkout RAK. | Connected-account Customers/EphemeralKeys and PaymentIntents. | Requires connected-account scoped customer/ephkey/PI permissions; live RAK permission unproven. |
| Refunds | `refund-order/index.ts:271-298`; `cancel-trip-booking/index.ts:462-483`. | Ticket refund RAK. | Connected-account `refunds.create`, with application fee refund. | Requires refund/application-fee permissions in live; permission unproven. |
| Installments | `_shared/installments/createInstallmentPI.ts:258-289`. | Ticket checkout RAK. | Off-session connected-account PI create with application fee. | Requires live saved-PM/off-session and direct-charge permissions; no live-fire evidence. |
| Webhook processing | `stripe-webhook/index.ts:48-167`; `_shared/stripeWebhookSignature.ts:18-49`. | Webhook RAK plus signing secrets. | Multi-secret verification and idempotent DB insert. | Code shape is solid; event subscription mismatch blocks cutover. |

## Six-field findings

### F-1 - Live mode is not proven from current probes

| Field | Evidence |
| --- | --- |
| Finding | The integration cannot be declared live-ready because the live Dashboard/key/webhook state is not machine-proven in this investigation. |
| Evidence | Stripe MCP account info and Stripe CLI reads resolve to test/sandbox account `acct_1TTnt1PjlZyAYA40` / "MINGLA LLC sandbox". Supabase secrets list is redacted and only proves presence by name. No `--live` Stripe CLI calls were run under the hard guard. |
| Current behavior | The deployed Supabase project has Stripe secret names populated, and the local Stripe CLI can read sandbox/test webhooks and connected accounts. |
| Cutover impact | Live cutover requires exact `pk_live_`, `rk_live_`, `sk_live_`, and `whsec_` pairings for the live Stripe account; the current evidence does not prove those pairings. |
| Confidence | High for "not proven"; medium for inferred likely test orientation because CLI/MCP context is sandbox. |
| SPEC action | Add an operator-owned live Dashboard readback checklist with prefix-only screenshots or redacted table: publishable key prefix, every RAK name + permission set, one full-key exception, live platform and Connect webhook endpoints, signing secret mapping. |

### F-2 - Code mostly uses function-specific RAKs, with two full-key escape hatches

| Field | Evidence |
| --- | --- |
| Finding | Most Stripe code uses function-specific RAK factories, but `STRIPE_SECRET_KEY` remains an active runtime dependency. |
| Evidence | `_shared/stripe.ts:52-81` defines RAK factories and `stripeTaxDashboardLink()` using `STRIPE_SECRET_KEY`. `_shared/stripeBlueprintClient.ts:109-110` and `166-167` allow `STRIPE_SECRET_KEY` fallback after `STRIPE_RAK_ONBOARD`. |
| Current behavior | Tax login links intentionally call `accounts.createLoginLink` with full key. Blueprint onboarding/account-link uses first non-empty key in `STRIPE_RAK_ONBOARD`, then `STRIPE_SECRET_KEY`. |
| Cutover impact | A missing/mis-scoped live onboarding RAK could be masked by full-key fallback; live least-privilege posture would be weaker than intended. |
| Confidence | High. Direct source evidence. |
| SPEC action | Keep the tax login full-key exception only if operator accepts it. Remove or fail-close the onboarding full-key fallback for production, or require Dashboard evidence that `STRIPE_RAK_ONBOARD` is live and permission-correct before activation. |

### F-3 - Connect controller state is platform-liable, not Stripe-managed risk

| Field | Evidence |
| --- | --- |
| Finding | Current Connect implementation creates platform-liable Express accounts. |
| Evidence | `_shared/stripeBlueprintClient.ts:133-139` sets `losses_collector: "application"`, `fees_collector: "application"`, `dashboard: "express"`. Stripe CLI test account list found 17 connected accounts; all unique controllers had `fees.payer=application`, `losses.payments=application`, `requirement_collection=stripe`, `stripe_dashboard.type=express`. DEC-156 in `Mingla_Artifacts/DECISION_LOG.md` accepted platform-managed risk after DEC-154 originally targeted Stripe-managed risk. |
| Current behavior | Direct charges are created on connected accounts and Mingla collects a platform fee, while Mingla is configured as the losses/fees application side in test. |
| Cutover impact | Live activation must explicitly choose this risk model. Reversing to Stripe-managed risk later may require detach/re-onboard because controller properties are sticky. |
| Confidence | High for test/code state; live controller state unproven. |
| SPEC action | Reconcile DEC-154 vs DEC-156 in the live cutover SPEC. Either lock platform-liable live with explicit risk sign-off, or design a re-onboarding campaign before live sales. |

### F-4 - Webhook endpoint subscriptions and router are mismatched

| Field | Evidence |
| --- | --- |
| Finding | Test-mode Stripe webhook endpoints do not match the router contract. |
| Evidence | Router handles event types in `_shared/stripeWebhookRouter.ts:30-61` and switch cases at `971-1036`. Stripe CLI test endpoints subscribe platform events and Connect events, but omit `checkout.session.completed`, `refund.created`, and `refund.updated`; they include `charge.succeeded`, `charge.failed`, `charge.dispute.created`, and `payment_intent.processing`, none of which have router cases. |
| Current behavior | Received unhandled event types still insert and mark processed because default only writes audit; missing subscribed events never arrive. Database shows `charge.succeeded` rows processed, consistent with "stored but not meaningfully handled." |
| Cutover impact | Web Checkout tax/session backfill, dashboard refund reconciliation, dispute monitoring, and delayed-payment state are ambiguous or blind. This is a live cutover blocker. |
| Confidence | High for test endpoint mismatch and source router mismatch; live endpoint state unproven. |
| SPEC action | Define exact live platform and Connect event sets. Add/route `charge.dispute.*` at minimum; decide whether to unsubscribe or intentionally no-op `charge.succeeded`/`charge.failed`; ensure `checkout.session.completed`, `refund.created`, and `refund.updated` are subscribed where router expects them. |

### F-5 - Webhook code verifies signatures and is anon-safe, but IP allowlist is soft-fail

| Field | Evidence |
| --- | --- |
| Finding | Webhook ingress has correct Stripe signature verification and idempotent insert behavior; IP allowlist failure is audit-only. |
| Evidence | `supabase/config.toml:63-66` disables Supabase JWT for Stripe webhook. `stripe-webhook/index.ts:48-60` verifies signatures before processing. `stripe-webhook/index.ts:66-86` logs/audits IP soft-fail, but continues. `stripe-webhook/index.ts:88-167` idempotently inserts/updates `payment_webhook_events`. |
| Current behavior | Third-party webhook can enter without Supabase JWT, but only with Stripe signature. IP mismatch does not block event processing. |
| Cutover impact | Signature verification is mandatory and present. If live cutover requires IP allowlist as a hard control, current behavior does not enforce that. |
| Confidence | High. Direct source evidence. |
| SPEC action | Decide whether Stripe source IP allowlist remains monitoring-only or becomes fail-closed in live mode; add alerting if it remains soft. |

### F-6 - Supabase and Stripe connected-account inventories drift in test

| Field | Evidence |
| --- | --- |
| Finding | Test Stripe connected-account count does not match Mingla's local `stripe_connect_accounts` table. |
| Evidence | Stripe CLI test probe found 17 connected accounts, 9 with both charges and payouts enabled. Supabase SQL found 11 active local rows, 7 with both charges and payouts enabled; all local rows have `detached_at is null`. |
| Current behavior | Some Stripe test connected accounts are not represented as active Mingla rows, or vice versa for capability status. |
| Cutover impact | For live, orphaned or mismapped accounts can cause onboarding state, payout state, refund state, and dashboard link behavior to disagree. |
| Confidence | High for test drift; live drift unproven. |
| SPEC action | Add pre-live reconciliation: live connected account list vs `stripe_connect_accounts`, by account id, brand id, dashboard type, country, charges/payouts enabled, detached status. |

### F-7 - Hosted web checkout uses direct charges and Stripe Tax, but depends on `checkout.session.completed`

| Field | Evidence |
| --- | --- |
| Finding | Web checkout is correctly shaped for direct charges and Stripe Tax, but one important webhook is missing from the observed test endpoint subscription. |
| Evidence | `ticket-checkout-create/index.ts:523-581` creates Checkout Sessions with `automatic_tax: { enabled: true }`, `application_fee_amount`, and `stripeAccount` request option. Router comment at `_shared/stripeWebhookRouter.ts:56-60` says `checkout.session.completed` records the PaymentIntent ID before `payment_intent.succeeded`. Stripe CLI test endpoints did not include `checkout.session.completed`. |
| Current behavior | Web buyers redirect to hosted Checkout, then Mingla relies on payment intent and session webhooks for finalization/tax backfill. |
| Cutover impact | Missing `checkout.session.completed` can lose tax/session metadata and increase dependence on buyer confirm or payment-intent-only finalization. |
| Confidence | High for code and test endpoint evidence. |
| SPEC action | Subscribe live Connect/platform endpoint to `checkout.session.completed` and add a live-fire web Checkout test proving order finalization and tax persistence. |

### F-8 - Native checkout does not collect Stripe Tax by design

| Field | Evidence |
| --- | --- |
| Finding | Native PaymentSheet path creates direct-charge PaymentIntents but explicitly does not enable Stripe Tax. |
| Evidence | `ticket-checkout-create/index.ts:756-762` states native PaymentIntent tax is deferred and native buyers pay without tax. Native PI create uses `stripeAccount` and `application_fee_amount` at `827-835`. |
| Current behavior | Native mobile payments work via PaymentSheet but tax is only on hosted web Checkout. |
| Cutover impact | Live launch has a tax compliance gap if native purchases are available in taxable contexts. |
| Confidence | High. Direct source evidence. |
| SPEC action | Either disable paid native flow for live taxable regions, force hosted Checkout where tax is required, or implement native tax calculation before live volume. |

### F-9 - Mobile PaymentSheet per-PI connected-account initialization is present

| Field | Evidence |
| --- | --- |
| Finding | Consumer and business native flows reinitialize Stripe per PaymentIntent with edge-returned publishable key and connected account ID. |
| Evidence | Consumer `app-mobile/src/payments/nativeCheckoutFlow.ts:155-161`; business `mingla-business/src/payments/nativeCheckoutFlow.native.ts:213-219`. Edge response includes publishable key from `ticket-checkout-create/index.ts` and connected account ID from direct-charge context. |
| Current behavior | PaymentSheet confirm should run under the connected account instead of platform context, avoiding prior 404/double-resolve regression. |
| Cutover impact | This is a positive readiness point, but it still depends on live publishable key/env correctness and wallet enrollment. |
| Confidence | High for code; live runtime unproven. |
| SPEC action | Add real-device live-mode test-matrix after operator Dashboard activation: consumer iOS, consumer Android, business iOS, business Android; success, cancel, 3DS/redirect return, wallet availability. |

### F-10 - Return URL / URL scheme registration has a business-app mismatch risk

| Field | Evidence |
| --- | --- |
| Finding | The business native Stripe return URL uses `com.sethogieva.minglabusiness`, but active Expo config declares top-level `scheme: "mingla-business"` and `app.json` has no top-level scheme. |
| Evidence | `mingla-business/src/payments/nativeCheckoutFlow.native.ts:109-110` and `230-236` use `com.sethogieva.minglabusiness://stripe-redirect`. `mingla-business/app.config.ts:33-38` sets `scheme: "mingla-business"`. `mingla-business/app.json:1-110` has no top-level `scheme`. |
| Current behavior | PaymentSheet is configured with the bundle-id-like scheme, while the Expo declared scheme is different. |
| Cutover impact | 3DS/redirect return can fail on production builds if the scheme is not actually registered. |
| Confidence | Medium-high. Source mismatch is real; generated native manifest was not inspected. |
| SPEC action | Verify generated iOS/Android URL schemes from the production EAS build. Align config and PaymentSheet return URL if mismatch is confirmed. |

### F-11 - Consumer app return URL is better aligned, but Android custom scheme is not explicit in intent filters

| Field | Evidence |
| --- | --- |
| Finding | Consumer app has top-level scheme and Stripe provider URL scheme aligned, but Android `intentFilters` only list `https` app links. |
| Evidence | `app-mobile/app.json:10` sets `scheme: "com.mingla.app.v2"`. `app-mobile/app/_layout.tsx:67-70` uses `urlScheme="com.mingla.app.v2"`. `app-mobile/app.json:44-75` Android intent filters are `https` only. |
| Current behavior | Expo may generate custom scheme handling from top-level `scheme`, but it is not visible in the explicit Android intent filter block dispatch asked to verify. |
| Cutover impact | Android 3DS/redirect return should be proven on a production-like build, not assumed from Expo config. |
| Confidence | Medium. Code alignment is good; generated Android manifest not inspected. |
| SPEC action | Add Android production-build deep-link verification for `com.mingla.app.v2://stripe-redirect`. |

### F-12 - Client-side secret exposure audit found no server secret/RAK use, but one publishable test fallback

| Field | Evidence |
| --- | --- |
| Finding | Runtime client code does not contain `sk_`, `rk_`, or webhook-secret matches in mobile/business apps, but mingla-business has a `pk_test_` fallback. |
| Evidence | `rg` over `app-mobile` and `mingla-business` for secret/RAK/webhook patterns produced no secret-key matches. `mingla-business/app.config.ts:79-87` documents and supplies a `pk_test_...` fallback. |
| Current behavior | If production build env lacks `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, mingla-business can silently build with sandbox publishable key. |
| Cutover impact | Silent test publishable fallback can make live native/connect flows fail or point at the wrong account after release. |
| Confidence | High for fallback existence and no secret matches in searched paths. |
| SPEC action | Fail closed for production builds if publishable key is absent or not `pk_live_`; preserve local/test fallback only for non-production builds. |

## Connect state

### Architecture facts

- Account creation uses raw `/v2/core/accounts` with `STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview"` in `_shared/stripeBlueprintClient.ts:10`.
- Created accounts request recipient transfer and merchant card payment capabilities in `_shared/stripeBlueprintClient.ts:113-129`.
- Defaults set Mingla/application as losses and fees collector in `_shared/stripeBlueprintClient.ts:133-137`.
- Dashboard type is `express` in `_shared/stripeBlueprintClient.ts:139` and persisted to Supabase in `brand-stripe-onboard/index.ts:404-410`.
- Existing test Stripe connected accounts all share controller: `fees.payer=application`, `losses.payments=application`, `requirement_collection=stripe`, `stripe_dashboard.type=express`.

### Supabase DB state

| State | Count |
| --- | ---: |
| Active `stripe_connect_accounts` rows | 11 |
| Active rows with `charges_enabled=true` and `payouts_enabled=true` | 7 |
| Detached rows | 0 |

Breakdown by local DB:

| Country | Currency | Dashboard | Charges | Payouts | Rows |
| --- | --- | --- | ---: | ---: | ---: |
| BE | EUR | express | true | true | 2 |
| CH | CHF | express | true | true | 1 |
| GB | GBP | express | true | true | 2 |
| GB | GBP | express | false | false | 1 |
| US | USD | express | true | true | 2 |
| US | USD | express | false | false | 3 |

### Stripe test account state

Stripe CLI test probe:

| Metric | Value |
| --- | ---: |
| Connected accounts | 17 |
| Charges+payouts enabled | 9 |
| Countries | BE 2, CH 1, GB 5, US 9 |
| Unique controller shape | Application pays fees, application covers losses, Stripe collects requirements, Express dashboard |

### Connect conclusion

Current state is compatible with a platform-liable direct-charge model, not the original Stripe-managed-risk DEC-154 target. The live cutover must not proceed until operator confirms the same risk model is intentionally accepted for live, or until SPEC changes onboarding/controller shape before live account creation.

## Webhook state

### Code router

Routed event types in code:

- Account/connect: `account.updated`, `account.application.deauthorized`, `account.external_account.*`, `capability.updated`, `person.*`.
- Payouts: `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`.
- Refunds/application fees: `charge.refund.updated`, `charge.refunded`, `refund.created`, `refund.updated`, `application_fee.created`, `application_fee.refunded`.
- Payment/checkout: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `checkout.session.completed`.

### Observed Stripe test endpoints

| Endpoint | Status | API version | Events |
| --- | --- | --- | --- |
| Platform endpoint to Supabase `stripe-webhook` | enabled | `2026-04-22.dahlia` | `application_fee.created`, `application_fee.refunded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` |
| Connect endpoint to Supabase `stripe-webhook` | enabled | `2026-04-22.dahlia` | `account.updated`, `account.application.deauthorized`, `account.external_account.*`, `payout.*`, `capability.updated`, `charge.refund.updated`, `charge.refunded`, `charge.succeeded`, `charge.failed`, `charge.dispute.created`, `person.*`, `payment_intent.*`, including `payment_intent.processing` |

### Mismatches

| Event | Router | Test endpoint | Cutover risk |
| --- | ---: | ---: | --- |
| `checkout.session.completed` | Yes | No | Web Checkout session/tax backfill missing. |
| `refund.created` | Yes | No | Modern dashboard refund reconciliation missing. |
| `refund.updated` | Yes | No | Refund lifecycle updates missing. |
| `charge.dispute.created` | No | Yes | Dispute/chargeback blind spot under platform-liable risk. |
| `charge.failed` | No | Yes | Failed-charge observability undefined. |
| `charge.succeeded` | No | Yes | Stored but no meaningful handler; noisy or misleading processed state. |
| `payment_intent.processing` | No | Yes | Delayed-payment method state unsupported. |

### DB event evidence

`payment_webhook_events` has all sampled event rows marked processed. Latest high-signal rows:

| Type | Total | Latest |
| --- | ---: | --- |
| `payment_intent.succeeded` | 44 | 2026-05-24 18:20 UTC |
| `application_fee.created` | 35 | 2026-05-24 18:20 UTC |
| `charge.succeeded` | 32 | 2026-05-24 18:20 UTC |
| `capability.updated` | 93 | 2026-05-19 20:32 UTC |
| `charge.refunded` | 5 | 2026-05-23 03:22 UTC |
| `charge.refund.updated` | 5 | 2026-05-23 03:22 UTC |

Processed does not mean business-handled for default cases; the router's default path has no domain mutation.

## Mobile and buyer-web verification

### Buyer web

- Event and trip web payment screens use `createTicketCheckout({ surface: "web" })`, persist resume payload, then redirect with `window.location.assign(hostedCheckoutUrl)`.
- Edge function creates direct-charge Checkout Sessions with `stripeAccount`, `application_fee_amount`, and `automatic_tax.enabled`.
- Web path requires `checkout.session.completed` and/or `payment_intent.succeeded` webhooks plus buyer confirmation fallback. The missing observed subscription to `checkout.session.completed` is a blocker.

### Consumer native

- `app-mobile/app.json:10` declares `scheme: "com.mingla.app.v2"`.
- `app-mobile/app/_layout.tsx:67-70` mounts `StripeNativeProvider` with merchant ID `merchant.com.mingla.app.v2` and URL scheme `com.mingla.app.v2`.
- `app-mobile/src/payments/nativeCheckoutFlow.ts:155-182` reinitializes Stripe per PaymentIntent with edge-returned publishable key and connected account ID, then uses `com.mingla.app.v2://stripe-redirect`.
- Android explicit intent filters list only `https` applinks; production manifest/deep-link test is still required.

### Business native and web

- `mingla-business/app.json:21-24` includes Apple Pay entitlement for `merchant.com.sethogieva.minglabusiness`; plugin config at `mingla-business/app.json:96-101` enables Stripe RN with that merchant ID and Google Pay.
- Native wrapper uses `merchant.com.sethogieva.minglabusiness` and `com.sethogieva.minglabusiness`.
- Native flow reinitializes Stripe per PaymentIntent with edge-returned publishable key and connected account ID.
- Risk: `app.config.ts:38` declares `scheme: "mingla-business"`, while PaymentSheet return URL uses `com.sethogieva.minglabusiness://stripe-redirect`; generated native scheme must be verified.
- Risk: `app.config.ts:79-87` has a `pk_test_` fallback publishable key for production-missing env.
- Connect onboarding page reads only publishable key and embedded-session client secret; no secret key is present client-side.

## Phase A-E gap reconciliation

The dispatch did not include a separate Phase A-E operator memo. This reconciliation maps the observed facts to the cutover phases implied by the dispatch and historical ORCH notes.

| Phase | Target state | Current state | Gap | Recommendation |
| --- | --- | --- | --- | --- |
| Phase A - Dashboard/live account activation | Live platform activated, public profile/statement descriptor/payout settings reviewed, Connect controller model locked. | Test/sandbox profile read shows "MINGLA LLC sandbox"; live Dashboard not machine-proven. Test profile statement descriptor prefix is null. | Live public profile, descriptor prefix, payout schedule, Connect activation, and risk model unverified. | Operator Dashboard readback before SPEC finalization; record prefix-only/no-secret evidence. |
| Phase B - Live keys and RAKs | Live publishable key, full-key exception, and every function RAK set with least privilege. | Supabase has all secret names; mode and permissions redacted. Code has two `STRIPE_SECRET_KEY` paths. | Cannot prove `rk_live_`/permissions; onboarding fallback can mask RAK failure. | SPEC explicit key matrix and Dashboard permission screenshots/redacted exports. |
| Phase C - Webhooks | Live platform and Connect webhook endpoints point to Supabase and subscribe exactly to routed events. | Test endpoints enabled but mismatched; live endpoints unverified. | Missing routed events and subscribed unhandled events. | Fix/verify event matrix before live sale. |
| Phase D - Buyer/mobile verification | Web Checkout, native PaymentSheet, wallets, redirects, refunds, and installments pass on live-like builds. | Code paths exist; native tax deferred; business URL-scheme mismatch risk; wallet enrollment unverified. | No production build live-mode smokes; Apple/Google Pay production state unknown. | TEST dispatch after operator Dashboard activation, with real-device matrix. |
| Phase E - Monitoring/close | Logs, alerts, dispute/refund monitoring, rollback, and close evidence are ready. | Recent Supabase logs sampled; webhook DB has processed test events. Dispute routing missing. | No live monitoring checklist and no dispute domain handling. | SPEC monitoring gates plus close checklist for first live transaction/refund/dispute simulation where possible. |

## Recommended SPEC scope

1. **Live Dashboard evidence pack.** Operator-owned, no secrets in repo: platform account identity, account mode, publishable key prefix only, RAK names and permission sets, one full-key exception, webhook endpoint IDs/URLs/events, signing secret mapping by endpoint, Apple Pay merchant IDs/certs, Google Pay mode, statement descriptor prefix, payout schedule, Connect controller model.
2. **Key fail-closed hardening.** Remove or production-disable silent full-key fallback in `_shared/stripeBlueprintClient.ts`; fail production builds if mingla-business publishable key is absent or not live; document the tax-dashboard full-key exception.
3. **Webhook matrix correction.** Add missing subscriptions for `checkout.session.completed`, `refund.created`, `refund.updated`; implement or explicitly unsubscribe/no-op `charge.succeeded`, `charge.failed`, `payment_intent.processing`; implement `charge.dispute.created` plus follow-on dispute lifecycle events or record a launch-blocking manual Dashboard gate.
4. **Risk-model decision.** Write a fresh DEC reconciling DEC-154 and DEC-156 for live: platform-liable direct charges vs re-onboard to Stripe-managed risk. Include customer/business impact, revenue risk, and support operations.
5. **Connect inventory reconciliation.** Build a one-time read-only reconciliation table comparing live Stripe connected accounts to `public.stripe_connect_accounts`; no live sales until every active account maps cleanly to one brand.
6. **Native/mobile cutover fixes or gates.** Verify generated business app URL schemes; align if needed. Verify consumer Android custom scheme. Decide how to handle native Stripe Tax gap before launch.
7. **Live-fire TEST plan.** After operator activation only: web paid checkout, native paid checkout iOS/Android, wallet availability, refund via app, dashboard refund webhook, installment deposit and scheduled/manual installment, webhook replay/idempotency, connected-account onboarding, balance/dashboard link, and monitoring/alert review.

## Numbered open questions

1. Which Stripe account is the intended live account for Mingla, and can the operator provide redacted Dashboard evidence that Supabase live secrets point to that account?
2. Is Mingla intentionally accepting platform-liable `losses.payments=application` for live sales, superseding DEC-154's original Stripe-managed-risk activation summary?
3. Should `_shared/stripeBlueprintClient.ts` be allowed to fall back to `STRIPE_SECRET_KEY` in production, or should missing/mis-scoped `STRIPE_RAK_ONBOARD` fail closed?
4. Are live platform and Connect webhook endpoints already created, and do they subscribe to `checkout.session.completed`, `refund.created`, `refund.updated`, and dispute events?
5. Should `charge.succeeded`, `charge.failed`, and `payment_intent.processing` be implemented, intentionally no-op/audited, or removed from Stripe subscriptions?
6. What is the live dispute operating model: database table, admin alert, email/Slack alert, manual Dashboard review, evidence workflow, and refund/ban policy?
7. Should native paid checkout be enabled before native Stripe Tax is implemented, and if yes which countries/events are allowed?
8. Does the production mingla-business EAS build register `com.sethogieva.minglabusiness://stripe-redirect`, or only `mingla-business://`?
9. Does the production consumer Android build resolve `com.mingla.app.v2://stripe-redirect` despite explicit intent filters being HTTPS-only?
10. Are Apple Pay merchant IDs `merchant.com.mingla.app.v2` and `merchant.com.sethogieva.minglabusiness` enrolled in the live Stripe account with production processing certificates?
11. Is Google Pay configured for production for both consumer and business Android apps, not just `testEnv: __DEV__` in the app code?
12. Should the hardcoded `pk_test_` fallback in mingla-business production config be removed or guarded behind non-production builds?
13. What live connected accounts, if any, already exist, and do they map one-to-one to Mingla brands?
14. Does live platform public profile have support email/URL and statement descriptor prefix configured for buyer trust and receipt clarity?
15. Who owns the first-live-sale runbook, monitoring window, rollback criteria, and customer support scripts?

## Final forensic verdict

Mingla has a serious, mostly coherent Stripe test-mode implementation: function-specific RAK factories, direct-charge Checkout/PaymentIntent creation, application fees, connected-account PaymentSheet initialization, webhook signature verification, idempotent webhook storage, refund paths, and installment paths. The remaining ambiguity is not cosmetic. Live cutover depends on proof of live keys, exact webhook subscriptions, accepted risk/liability model, mobile return URLs, wallet enrollment, tax posture, and connected-account inventory.

Recommended routing: **orchestrator REVIEW -> SPEC dispatch -> IMPLEMENT for code/config hardening -> operator-owned Dashboard activation/readback -> TEST live-mode smoke matrix -> CLOSE**.
