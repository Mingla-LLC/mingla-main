# Paystack Integration Reference (Mingla Africa — Nigeria + Ghana)

- **Owner:** META-ORCH-1076 [Paystack Africa]
- **Created:** 2026-06-04
- **Source:** Full ingest of https://paystack.com/docs/ across 5 capability clusters, every endpoint/param/enum/event URL-cited (satisfies COMMS-0003 external-API-docs mandate).
- **Doc-access caveat:** `paystack.com/docs/api/*` and many `/docs/payments/*` pages sit behind Cloudflare bot protection (HTTP 403 to automated fetchers). Facts below were corroborated against Paystack's GitHub docs mirror (`PaystackHQ/documentation`), the Help Center (`support.paystack.com`), official SDK mirrors, and pricing/blog pages; canonical `/docs/` URLs are cited inline. **Items flagged `[verify-in-browser]` must be confirmed against the live docs page before they are coded into a SPEC.**

---

## Part 0 — Dashboard setup: the three fields you're filling now

You're in **Test Mode**, Settings → **API Keys & Webhooks**. Here is exactly what each field takes.

| Field | Value | Notes |
|---|---|---|
| **Test Public Key** | `pk_test_c284ed349db69615503d366d97211e5dba641ae0` | Already in your tokens file — **not actually vacant**. This is the client-side key (safe to ship in the app/web). Pairs with your `sk_test_…` secret key, which is server-only and never leaves Supabase secrets. |
| **Test Webhook URL** | `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/paystack-webhook` | Our Supabase edge function. Paste it now. **It won't successfully receive events until we build + deploy that function in Phase 0/1**, and it must be deployed with `verify_jwt: false` (Paystack sends no JWT) — same as our `stripe-webhook`. Saving the URL early is fine; Paystack only POSTs on real events. |
| **Test Callback URL** | `https://business.usemingla.com/pay/callback` | Where Paystack redirects the buyer after a test payment. This dashboard value is a **default**; in code we pass a per-transaction `callback_url` on `/transaction/initialize` that overrides it. We'll build the `/pay/callback` page in Phase 1 — paste the URL now so the field isn't empty. |

**Why the callback URL barely matters and the webhook URL matters a lot:** Paystack (like Stripe) treats the buyer redirect as unreliable — a buyer can close the browser before it fires. The **webhook `charge.success` event is the source of truth** for "did they pay." So the webhook endpoint is the load-bearing one; the callback is just UX to bring the buyer back to a success screen.

---

## Part 1 — Accept Payments & Transactions

> Every endpoint, param, and enum below is doc-verified against the URLs cited inline. Base API host is `https://api.paystack.co`. All authenticated calls send `Authorization: Bearer <SECRET_KEY>` and `Content-Type: application/json`. **Never call the Paystack API from the frontend — the secret key must stay server-side** ([accept-payments](https://paystack.com/docs/payments/accept-payments/)).

### 1.1 Initialize Transaction — `POST /transaction/initialize`

Source: [Transaction API](https://paystack.com/docs/api/transaction/) · [Accept Payments](https://paystack.com/docs/payments/accept-payments/)

| Param | Type | Req | Notes |
|---|---|---|---|
| `email` | string | **required** | Customer email |
| `amount` | string/integer | **required** | Amount in **subunits** (kobo/pesewas) — see §1.5 |
| `currency` | string | optional | `"NGN"`, `"GHS"`, `"ZAR"`, `"KES"`, `"USD"`, `"XOF"`. Defaults to integration currency |
| `reference` | string | optional | Unique per integration. Allowed chars `-`, `.`, `=`, alphanumerics. Auto-generated if omitted |
| `callback_url` | string | optional | Overrides dashboard default for this transaction only |
| `channels` | array | optional | Whitelist of channels shown on Checkout (§1.6) |
| `metadata` | string (stringified JSON) | optional | Custom data / custom fields |
| `subaccount` | string | optional | Subaccount code (`ACCT_xxx`) for split/marketplace |
| `split_code` | string | optional | Split code (`SPL_xxx`) for multi-party splits |
| `transaction_charge` | integer (kobo) | optional | Flat fee to the **main (Mingla) account**, overrides subaccount `percentage_charge` |
| `bearer` | string | optional | Who bears Paystack's fee: `"account"` (default) or `"subaccount"` |

**Response** (`message: "Authorization URL created"`):
```json
{ "status": true, "message": "Authorization URL created",
  "data": { "authorization_url": "https://checkout.paystack.com/3ni8kdavz62431k",
            "access_code": "3ni8kdavz62431k", "reference": "re4lyvq3s3" } }
```
- `authorization_url` — hosted Paystack Checkout link to send/redirect the buyer to.
- `access_code` — token for Popup/Inline JS `resumeTransaction`.
- `reference` — the transaction reference.

### 1.2 Verify Transaction — `GET /transaction/verify/:reference`

Source: [Transaction API](https://paystack.com/docs/api/transaction/) · [Verify Payments](https://paystack.com/docs/payments/verify-payments/)

Authoritative confirmation of payment. Key response fields: `data.status` (`success`|`failed`|`abandoned`|`pending`), `data.amount` (subunits), `data.currency`, `data.channel`, `data.gateway_response`, `data.paid_at`, `data.fees`, `data.authorization` (incl. `authorization_code` reusable for recurring), `data.customer`.

**How to confirm success** ([Verify Payments](https://paystack.com/docs/payments/verify-payments/)):
1. `data.status === "success"` (NOT just top-level `status: true`, which only means the API call worked).
2. **Verify `data.amount` matches the expected order amount** AND `data.currency` matches — "If the amount doesn't match, don't deliver value."
3. Guard against double-fulfillment (callbacks + webhooks both fire).

### 1.3 Integration methods (which fits Mingla)

| Method | How | PCI | Fit |
|---|---|---|---|
| Popup / Inline JS | JS renders Checkout modal | Lowest (SAQ-A) | Web only |
| **Redirect via `authorization_url`** | Initialize → redirect to hosted Checkout → return to `callback_url` → verify | Lowest | **Mingla's flow** — we already open hosted checkout in an in-app browser |
| Charge API (`POST /charge`) | Submit raw card/mobile_money/bank/ussd | **Card requires full PCI-DSS application** | Use only for non-card (mobile money §5.3); never for card |

**Recommendation:** Initialize → `authorization_url` redirect in the in-app browser. Matches Mingla exactly (native card SDK was removed in ORCH-0839-B), lowest PCI tier, hosted page handles card/3DS/USSD/transfer/mobile-money/Apple Pay. Mobile-WebView pattern ([guide](https://paystack.com/docs/guides/using_the_paystack_checkout_in_a_mobile_webview/)): embed `authorization_url`, intercept the redirect to `callback_url` (and/or `https://standard.paystack.co/close`), extract reference, verify server-side, close browser.

### 1.4 `callback_url` behaviour

- Per-transaction `callback_url` **overrides** the dashboard default; if neither is set, the buyer is **not** redirected back.
- On success Paystack redirects to `callback_url?trxref=<ref>&reference=<ref>` (both params carry the same value).
- **The redirect does NOT prove success** — call Verify before delivering value. Paystack strongly recommends **webhooks (`charge.success`) as the primary "deliver value" trigger**, verify as backstop.

### 1.5 `amount` units / minor units

- **All amounts in subunits: base × 100.** `kobo` (NGN), `pesewas` (GHS), `cents` (ZAR/KES/USD). NGN 100 → `10000`.
- **XOF special case:** no subunit, but still multiply by 100.
- `transaction_charge` is in **kobo** ([Transaction API](https://paystack.com/docs/api/transaction/)).

### 1.6 Payment channels enum

Full `channels` enum: `"card"`, `"bank"`, `"apple_pay"`, `"ussd"`, `"qr"`, `"mobile_money"`, `"bank_transfer"`, `"eft"`, `"capitec_pay"`, `"payattitude"` ([Payment Channels](https://paystack.com/docs/payments/payment-channels/)).

| Channel | Nigeria | Ghana |
|---|---|---|
| `card` | Yes | Yes |
| `bank` | Yes | — |
| `ussd` | Yes (NG only) | No |
| `qr` | Yes | (scan-to-pay markets) |
| `mobile_money` | **No** | **Yes** |
| `bank_transfer` | Yes | Yes |
| `apple_pay` | Yes | Yes |

### 1.7 Test mode

Use `sk_test_*`/`pk_test_*`. Real cards are declined in test mode. Test cards (expiry = any future date):

| Scenario | Card | CVV | PIN | OTP |
|---|---|---|---|---|
| Success, reusable | `4084 0840 8408 4081` | `408` | — | — |
| Success PIN+OTP (Verve) | `5060 6666 6666 6666 666` | `123` | `1234` | `123456` |
| Declined | `4084 0800 0000 5408` | `001` | — | — |

Bank transfer test transfers always succeed; mobile-money sim via Test Payments page ([Test Payments](https://paystack.com/docs/payments/test-payments/)).

### 1.8 References & idempotency

- **Every `reference` must be unique per integration.** Reuse → "Duplicate Transaction Reference" error. Generate per-attempt references (order id + timestamp/attempt).
- **No Stripe-style `Idempotency-Key` header.** Idempotency = unique-reference constraint + your own dedupe on verify/webhook ("already fulfilled this reference?"). Webhook handlers must be idempotent.

### Mingla mapping notes (Part 1)
- `ticket-checkout-create` ↔ `POST /transaction/initialize` (return `authorization_url` instead of Stripe client_secret).
- `ticket-checkout-status` ↔ `GET /transaction/verify/:reference`; gate on `data.status==="success"` AND amount/currency match.
- `stripe-webhook` order-finalize ↔ `charge.success` webhook (primary fulfillment).
- `callback_url` ↔ Stripe `return_url`; in-app browser intercepts `?trxref=&reference=`.
- Mode switch: `sk_test_`/`sk_live_` ↔ `MINGLA_STRIPE_MODE`; build a parallel `resolvePaystackKey(country, mode)`.

---

## Part 2 — Marketplace: Subaccounts, Splits, Transfers, Settlements

> Paystack's marketplace primitive is the **Subaccount + Transaction Split**, not a full "connected account." A Subaccount is *a settlement destination* (verified bank account + commission %). Money splits at charge time; each party settles directly to its own bank. Maps onto Mingla's Stripe model: **brand = subaccount**, **Mingla's cut = main-account share** (≈ `application_fee_amount`), **brand payout = subaccount settlement**. All amounts in minor units. Base URL `https://api.paystack.co`.

### 2.1 Subaccounts — the brand's settlement identity (≈ Stripe connected account)

Docs: [Subaccount API](https://paystack.com/docs/api/subaccount/) · [Split Payments guide](https://paystack.com/docs/payments/split-payments/)

**Create Subaccount — `POST /subaccount`:**

| Param | Type | Req | Meaning |
|---|---|---|---|
| `business_name` | string | **required** | Subaccount business name |
| `settlement_bank` | string | **required** | **Bank code** (from `GET /bank`) |
| `account_number` | string | **required** | Bank account money settles into |
| `percentage_charge` | float | **required** | **% of each split txn that goes to the MAIN account (Mingla)** — i.e. Mingla's take-rate. `percentage_charge: 20` ⇒ Mingla keeps 20%, brand gets 80%. (Authoritative PaystackHQ source; some 3rd-party SDKs invert this — ignore them.) |
| `settlement_schedule` | string | optional (`auto`) | `auto` (T+1) \| `weekly` \| `monthly` \| `manual` |
| `primary_contact_email`/`name`/`phone`, `description`, `metadata` | — | optional | — |

Response returns `subaccount_code` (`ACCT_…`) — the durable handle (≈ `stripe_connect_accounts.stripe_account_id`). `is_verified` flips true after Paystack verifies the bank account; unverified can stall first payout.

Other: **List** `GET /subaccount`, **Fetch** `GET /subaccount/{id_or_code}`, **Update** `PUT /subaccount/{id_or_code}` (change `percentage_charge`, swap bank, `active` flag).

### 2.2 Validating bank + bank codes

- **Resolve Account** — `GET /bank/resolve?account_number=&bank_code=` → returns verified `account_name`. Call **before** creating the subaccount; show the name to the brand (Paystack disclaims liability for wrong accounts). ([Verification API](https://paystack.com/docs/api/verification/#resolve-account))
- **List Banks** — `GET /bank?country=nigeria|ghana&currency=NGN|GHS&type=nuban|ghipss|mobile_money` → bank objects with `code` (use as `settlement_bank`/`bank_code`). ([Miscellaneous API](https://paystack.com/docs/api/miscellaneous/#bank))

> **Mingla onboarding wiring:** `GET /bank?country=` → bank picker → account number → `GET /bank/resolve` → confirm name → `POST /subaccount`. This replaces Stripe's embedded KYB (`brand-stripe-onboard`). **Paystack has no embedded KYC component for subaccounts** — it's a plain form you own.

### 2.3 Transaction Splits — how money divides (≈ direct charge + application fee)

**Way A — Inline single-subaccount split on `transaction/initialize` (recommended default; closest to Mingla today):** pass `subaccount` (brand `ACCT_…`) + `transaction_charge` (flat kobo to Mingla, overrides `percentage_charge`) + `bearer`. This is the exact twin of Stripe direct-charge + flat `application_fee_amount`.

**Way B — Pre-created multi-split via `POST /split`** (for a reusable formula or ≥2 payees): `name`, `type` (`percentage`|`flat`), `currency`, `subaccounts: [{subaccount, share}]`, `bearer_type`, `bearer_subaccount`. Main account's share is the implicit remainder (`100 − Σshares` for percentage). Returns `split_code`; charge with `split_code` on initialize. Endpoints: list/fetch/update + `/split/{id}/subaccount/add`|`/remove`.

**Way A vs B for Mingla:** use **Way A** for "Mingla takes X% (or flat ₦Y), one brand gets the rest." Use **Way B** only for reusable formulas or a second payee (affiliate/city partner/tax pool) with `bearer_type: "all-proportional"`.

### 2.4 `bearer` / who pays Paystack's fee

- Inline: omit/`account` = Mingla pays Paystack's fee; `subaccount` = brand pays it.
- Multi-split `bearer_type`: `account` | `subaccount` (+ `bearer_subaccount`) | `all` | `all-proportional`.
- **All-in tie-in:** Paystack's fee is deducted *after* the gross charge, so the **buyer is always charged exactly `amount`** regardless of `bearer`. `bearer` only decides whose net settlement the fee comes from. To pass cost to the *buyer*, add it into `amount` pre-initialize (what the existing all-in engine already does). `bearer` = the Paystack equivalent of the "processing-as-service-fee" pass/absorb switch.

### 2.5 Transfers API (use only when Splits aren't enough)

**Settlement vs Transfer:** a settlement is Paystack auto-paying a subaccount's split share to its bank on schedule (you do nothing). A transfer is you pushing money from your Paystack balance via API. **The core Mingla marketplace flow needs NO Transfers** — Subaccount + Split + auto-settlement covers it. Reserve Transfers (`POST /transferrecipient` → `POST /transfer` → OTP `POST /transfer/finalize_transfer`) for off-cycle/manual payouts or `settlement_schedule: "manual"` brands.

### 2.6 Settlements

- Paystack auto-batches each subaccount's net balance to its bank on `settlement_schedule` (`auto` = **T+1** Nigeria). No API call, no extra charge.
- **Settlement currency is account-bound:** NGN (Nigeria accounts), GHS (Ghana accounts) — the only two settlement currencies.
- New/unverified subaccount → possible first-payout delay until bank verified.
- Read-only reconciliation: `GET /settlement?subaccount=ACCT_…`, `GET /settlement/{id}/transactions`, `settlement.success` webhook.

### Mingla mapping notes (Part 2)
- Brand `stripe_account_id` ⇒ `paystack_subaccount_code`; `brands.stripe_connect_id` gets a parallel `brands.paystack_subaccount_code`.
- `brand-stripe-onboard` (embedded KYB) ⇒ Mingla-owned form (List Banks → Resolve → Create Subaccount). No hosted/embedded component.
- `application_fee_amount` (flat cents) ⇒ inline `transaction_charge` (flat kobo); or `percentage_charge` for a % take.
- Direct-charge "no `transfer_data.destination`" posture is native to Paystack splits (destination-free by design — don't reintroduce transfers for the core flow).
- Settlement currency NGN/GHS aligns with ORCH-1034 "charge each seller in their own currency."

---

## Part 3 — Refunds & Disputes

> **Doc caveat:** several `/docs/api/*` dispute pages 403 automated fetch; refund endpoints/response/status enums verified via rendered Refund API page + support articles; dispute params via official docs + SDK mirrors. Items flagged `[verify-in-browser]` need a browser confirm.

### 3.1 Refund API

Endpoints: `POST /refund` (create), `GET /refund` (list), `GET /refund/:id` (fetch), `POST /refund/retry_with_customer_details/:id` (retry `needs-attention`). ([Refund API](https://paystack.com/docs/api/refund/))

**`POST /refund` params:** `transaction` (id or reference, **required**), `amount` (subunits — omit = full refund; cannot exceed original), `currency`, `customer_note`, `merchant_note`. ([Refunds guide](https://paystack.com/docs/payments/refunds/))

**Refund status lifecycle:** `pending` → `processing` → `processed` (terminal success) | `failed` | `needs-attention` (bank account not returned — supply customer bank details + retry). ([Understanding refund statuses](https://support.paystack.com/en/articles/2130434))

> **Vocabulary mismatch:** Paystack terminal success is **`processed`** (Stripe says `succeeded`). Mingla's `refunds.status` is Stripe vocabulary — either map `processed→succeeded` or widen the enum to `{pending, processing, processed, failed, needs-attention}`. `needs-attention` is new, no Stripe analogue.

**Split/fee behaviour on refund:** refund is debited from the merchant's payout balance (`deducted_amount`/`fully_deducted` track the clawback). **Paystack's processing fee is NOT returned on refund.** No `refund_application_fee` flag — Mingla must explicitly decide whether to reverse its own split portion. `[verify-in-browser: exact split-reversal wording at /docs/payments/refunds/]`

**Refund webhook events:** `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`. Finalize refund state via webhook, not the synchronous create call (which returns `pending`).

### 3.2 Disputes / Chargebacks API

Endpoints: `GET /dispute` (list), `GET /dispute/:id`, `GET /dispute/transaction/:id`, `PUT /dispute/:id` (update), `GET /dispute/:id/upload_url` (30-min signed URL; jpg/jpeg/pdf), `POST /dispute/:id/evidence`, `PUT /dispute/:id/resolve`, `GET /dispute/export`. ([Dispute API](https://paystack.com/docs/api/dispute/) · [Manage Disputes](https://paystack.com/docs/payments/manage-disputes/)) `[verify-in-browser: update/resolve/evidence HTTP verbs — SDK mirrors show PUT/POST, some community SDKs differ]`

**Resolve** params: `resolution` (`merchant-accepted` | `declined`), `message`, `refund_amount`, `uploaded_proof`, `evidence`. **Categories:** chargeback, fraud. **Status:** `pending`, `resolved`, `archived` (+ `awaiting-merchant-feedback`/`awaiting-bank-feedback` per SDKs `[verify-in-browser]`). Evidence-due timestamp is per-dispute on the object; `charge.dispute.remind` fires every ~4h until resolved.

**Dispute webhook events:** `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve`. **Differs from Stripe** (`created`/`updated`/`closed`/`funds_*`) — Paystack has exactly three, and note `create` (no `d`).

### Mingla mapping notes (Part 3)
- `refund-order`: replace `stripe.refunds.create({…}, {stripeAccount})` with `POST /refund {transaction, amount, currency, …}`. No per-call account header. Commit `pending` inline, let `refund.processed`/`refund.failed` webhook finalize (the existing "webhook reconciliation" comment becomes the **primary** path).
- Drop the tax-reversal block entirely (no Paystack Tax).
- `stripe_disputes` table → `paystack_disputes` (or generalize): `evidence_due_by` ← Paystack due timestamp (likely ISO, not epoch — drop the `*1000`); branch on `resolution` (`declined` = lost) instead of Stripe `status==="lost"`.
- Add a `charge.dispute.remind` escalation leg (new vs Stripe). Ops alerts (`sendOpsAlertEmail`, AppsFlyer) map cleanly; swap the dashboard CTA URL to Paystack.
- Programmatic evidence submission (upload_url → evidence → resolve) is net-new; today's Stripe integration is observe-only.

---

## Part 4 — Webhooks, Signature, Events & API Basics

### 4.1 Webhook setup
Register under Settings → **API Keys & Webhooks** (separate Test + Live URLs). Must be publicly reachable (no localhost). Paystack delivers via **HTTP POST**, expects **200 OK returned immediately** (do heavy work after acking), **30s timeout**. Retry on non-200: **live** = every 3 min ×4 then hourly to 72h; **test** = hourly for 10h. Build idempotent handlers. ([Webhooks](https://paystack.com/docs/payments/webhooks/))

### 4.2 Signature verification (security-critical)
- Header: **`x-paystack-signature`**.
- Algorithm: **HMAC SHA512**.
- Signed content: the **raw request body**.
- Signing key: your **SECRET key** (`sk_test_`/`sk_live_`) — NOT the public key, matched to mode.
- **Hash the raw body bytes** (`await req.text()` then JSON.parse) — re-serializing first can break the digest.

```javascript
const hash = crypto.createHmac('sha512', SECRET_KEY).update(rawBody).digest('hex');
if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);
res.sendStatus(200); // ack fast, then process
```

### 4.3 Webhook IP allowlist
Paystack sends **only** from: `52.31.139.75`, `52.49.173.169`, `52.214.14.220` (same for test + live). Anything off-list = counterfeit. (Distinct from the outbound API IP-whitelisting dashboard feature.) ([Webhooks](https://paystack.com/docs/payments/webhooks/))

### 4.4 Event catalogue
Envelope: `{ "event": "<name>", "data": { …resource… } }`. Route on `event`. Key events:
`charge.success`; `charge.dispute.create`|`remind`|`resolve`; `transfer.success`|`failed`|`reversed`; `refund.processed`|`pending`|`processing`|`failed`; `paymentrequest.success`|`pending`; `subscription.create`|`disable`|`not_renew`|`expiring_cards`; `invoice.create`|`update`|`payment_failed`; `customeridentification.success`|`failed`; `dedicatedaccount.assign.success`|`failed`. ([Webhooks](https://paystack.com/docs/payments/webhooks/))

### 4.5 Authentication
`Authorization: Bearer <secret_key>`. Prefixes: `sk_test_`/`sk_live_` (server-only, also the webhook-signing key); `pk_test_`/`pk_live_` (client). No-auth → 401.

### 4.6 API basics
Base `https://api.paystack.co` (no version segment). JSON. Envelope `{status, message, data}` (`status` boolean = call success). Errors: same shape `status:false` + `message` + `code`; standard HTTP codes (401/4xx/429/5xx). Rate limit 429 (batches ≤100, ~5s apart). Pagination: offset (`page`+`perPage`, `meta` has total/pageCount) or cursor (`use_cursor=true`, `meta.next`). **No dated API versioning** (no `Stripe-Version` analog).

### Mingla mapping notes (Part 4)
- New `paystackWebhookSignature` helper: `x-paystack-signature`, HMAC-SHA512, raw body, secret key — no timestamp/replay window (idempotency from payload + inbox table, not signature). Read raw body via `req.text()`.
- `paystackIpAllowlist` = the static trio above (test + live).
- Reuse `payment_webhook_events` inbox; derive a stable idempotency key (`event` + `data.reference`/`data.id`, or body hash) since Paystack has no `evt_…` id and retries aggressively.
- `paystackWebhookRouter` keyed on top-level `event` over `data`. `charge.success` ≈ `payment_intent.succeeded`; `transfer.*` ≈ payout; `refund.*` ≈ `charge.refunded`; dispute trio maps to existing dispute routing.
- Drop the `Stripe-Version` plumbing (no analog).

---

## Part 5 — Countries, Currencies, Going Live, Ghana & Mobile Money

### 5.1 Supported countries & currencies
Paystack = 5 countries: Nigeria (NGN, +USD opt-in), Ghana (GHS), South Africa (ZAR), Kenya (KES, +USD opt-in), Côte d'Ivoire (XOF). **Accounts are COUNTRY-SPECIFIC** — NGN and GHS require **separate Paystack businesses**, each with its own dashboard, API keys, webhook secret, compliance filing, and settlement bank. ([Miscellaneous API](https://paystack.com/docs/api/miscellaneous/) · NG compliance [2123970](https://support.paystack.com/en/articles/2123970) · GH compliance [2123842](https://support.paystack.com/en/articles/2123842))

> **Mingla impact:** Nigeria and Ghana = two `sk_live`/`pk_live` pairs, two webhook secrets, two settlement accounts. Config keys Paystack credentials by **country**.

### 5.2 Going live
Start in Test Mode by default; dashboard auto-flips to Live once compliance is submitted + approved (Business Reviews team, ~24h). NG live needs CAC docs + director BVN/iGree consent (+ SCUML if designated). GH live needs business registration (Form 3/3B/etc.) + TIN + GPS address. 4 keys under Settings → API Keys & Webhooks; test/live data fully isolated. ([Activate business 2125506](https://support.paystack.com/en/articles/2125506))

### 5.3 Mobile Money (Ghana) — Charge API flow
Mobile money is **Ghana/Kenya/CIV only — NOT Nigeria**. Provider enum (`mobile_money.provider`): Ghana `mtn` (MTN), `atl` (AirtelTigo), `vod` (Vodafone→Telecel, enum unchanged). Flow: `POST /charge {email, amount, currency:"GHS", mobile_money:{phone, provider}}` → `data.status`: `pay_offline` (show `display_text`, wait for `charge.success` webhook; customer authorizes via USSD/PIN on phone) | `send_otp` (`POST /charge/submit_otp {otp, reference}`) | `pending` (wait ≥10s, poll `GET /transaction/verify/{ref}`). **180s** authorization window. **Webhook `charge.success` is mandatory source of truth** (auth completes offline). ([Charge API](https://paystack.com/docs/api/charge/) · [Pay with Mobile Money 2128386](https://support.paystack.com/en/articles/2128386))

### 5.4 Apple Pay
All 5 countries (GHS/NGN/KES/USD). Nigeria uses it for international/USD card txns. Custom integrations must register + verify the domain (host file at `/.well-known/`). ([Apple Pay 2132418](https://support.paystack.com/en/articles/2132418))

### 5.5 Fees (modeling the all-in price)
| Country | Local fee | Cap / waiver | International |
|---|---|---|---|
| **Nigeria (NGN)** | **1.5% + ₦100** | capped at **₦2,000**; ₦100 waived for tx < ₦2,500 | 3.9% + ₦100 (MC/Visa/Verve); 4.5% Amex |
| **Ghana (GHS)** | **1.95%** flat (card = MoMo = transfer) | no flat add-on, no cap | 1.95% (received in GHS) |

([Transactions pricing 2130306](https://support.paystack.com/en/articles/2130306)) — NG needs the cap + waiver edge cases; GH is a clean flat multiplier.

### 5.6 Test data
Test cards as §1.7. Insufficient-balance simulated by amount > ₦500,000. Test mobile-money MSISDNs + OTP `123456` on the Test Payments page `[verify-in-browser: current GH MoMo test numbers]`.

### Mingla mapping notes (Part 5)
- **Two Paystack accounts keyed by country**; `resolvePaystackKey(country, mode)` helper.
- `(provider, country)` resolver for mobile money: `(ghana, mtn)→mtn`, `(ghana, airteltigo)→atl`, `(ghana, telecel|vodafone)→vod`.
- **Config-driven VAT** (locked decision #1): `vat_rate_by_country` — NG 7.5%; GH ~15% headline (NHIL/GETFund/COVID levies push the effective combined higher — **confirm exact effective rate with finance before launch**). Paystack does NOT compute this; Mingla owns the VAT line.
- All-in fee modeling: NG `1.5% + ₦100` capped ₦2,000 (waived < ₦2,500); GH flat `1.95%`. `bearer` ↔ pass/absorb switch.
- Channel gating: NG = `card|bank|ussd|bank_transfer|apple_pay`; GH = `card|mobile_money|bank_transfer|apple_pay`. **Never offer `mobile_money` in Nigeria.**

---

## Part 6 — The headline deltas vs Stripe (read this before any SPEC)

1. **No Stripe Tax.** Mingla computes VAT from a per-country config (decision locked). The tax calc/commit/reverse blocks drop entirely.
2. **Marketplace = subaccount + split, settling to a bank.** `application_fee_amount` ⇒ `transaction_charge` (flat) or `percentage_charge` (%). No held per-account balance; no `transfer_data.destination` (native to splits).
3. **No embedded onboarding/KYC component.** Brand onboarding is a Mingla-owned bank-details form (List Banks → Resolve → Create Subaccount).
4. **Two country-specific accounts.** NG and GH are separate Paystack businesses → credentials keyed by country, two of everything (keys, webhook secrets, settlement, compliance).
5. **Different webhook signature.** `x-paystack-signature`, HMAC-SHA512, raw body, secret key, no timestamp window. Static 3-IP allowlist.
6. **Refunds finalize via webhook, not inline.** Terminal status is `processed`; `needs-attention` is a new branch with no Stripe analog.
7. **Disputes: 3 events** (`create`/`remind`/`resolve`), programmatic evidence API, `remind` every 4h.
8. **Hosted-redirect checkout is a tailwind** — matches our post-ORCH-0839-B in-app-browser flow; lowest PCI tier; no native SDK.
9. **Mobile money (Ghana) is net-new capability** — offline authorization, webhook-as-truth, 180s window. No Stripe equivalent.
10. **No `Idempotency-Key` header, no API versioning.** Idempotency via unique `reference` + inbox dedupe.

## Part 7 — Items to confirm in-browser before SPEC (doc wall caveats)
- Exact split-reversal + fee-return wording on refunds (`/docs/payments/refunds/`).
- Dispute update/resolve/evidence HTTP verbs + full `status` enum + evidence-due field name (`/docs/api/dispute/`).
- Verbatim `charge.dispute.*` and `refund.*` webhook payload field sets (`/docs/payments/webhooks/`).
- Current Ghana mobile-money test MSISDNs (`/docs/payments/test-payments/`).
- Ghana exact effective VAT+levies rate (finance, not Paystack).
