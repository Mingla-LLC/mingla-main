# Stripe Best Practices Audit — B2a Path C V2

**Auditor:** stripe-best-practices skill (Claude Code)
**Date:** 2026-05-06
**Subject:** [outputs/SPEC_B2_PATH_C_V2.md](../../outputs/SPEC_B2_PATH_C_V2.md) + Phase 0 commits `cf3969bf` + `cfb121e8`
**Reference:** Stripe-published documentation (cited inline; full URL list §5)
**Scope:** Connect platform configuration, API selection, webhooks, idempotency, security, marketplace concerns, deprecation paths, blind-spot scan

---

## §1 — Executive verdict (≤5 lines)

**SPEC v2 is broadly aligned with Stripe Connect platform best practices.** No deal-breakers. **Two real gaps require attention before live launch:** (a) we use a full secret key (`sk_*`) instead of restricted API keys (`rk_*`) per edge function — Stripe explicitly recommends RAKs with least-privilege scoping; (b) we don't IP-allowlist webhook endpoints — Stripe recommends defense-in-depth on top of signature verification. **Three terminology drifts from Stripe's current Connect guidance** (Express as "account type" vs as `controller.stripe_dashboard.type` value; "merchant of record" used loosely; B3 will need explicit `on_behalf_of` + `transfer_data.destination` for destination charges). **Two deferred items from SPEC v2 §3 are actually higher-priority than tagged**: webhook secret rotation (C5) is referenced in Stripe's incident-response docs as standard practice; bank verification status (C7) directly affects payout reliability.

---

## §2 — Per-section verdicts

### §1 Stripe Connect platform configuration

**Sub-section 1a — Connect Embedded Components usage (Path B)**

**Verdict: COMPLIANT (with one nuance).**

We use `@stripe/connect-js` rendered on a Mingla-hosted page, opened from mobile via `expo-web-browser.openAuthSessionAsync` (system browser, not WebView). Per [Stripe's prohibition](https://docs.stripe.com/connect/get-started-connect-embedded-components):
> "You can't use Connect embedded components in embedded web views inside mobile or desktop applications."

**Mingla-hosted page → system browser is the correct alternative for mobile apps that want Embedded Components but cannot use Stripe's native React Native SDK** (which is currently in private preview per the D-B2-23 spike report).

**Nuance:** the [Stripe Connect onboarding overview](https://docs.stripe.com/connect/onboarding.md) and the security reference in this skill recommend **"Stripe-hosted onboarding rather than building a custom onboarding flow"** as the safest default. Embedded Components is more integrated but requires more platform-side maintenance. Our deviation is documented in [Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md](../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md).

**Status: DEVIATION_JUSTIFIED — embedded onboarding chosen for UX consistency; tradeoff acknowledged.**

---

**Sub-section 1b — Controller properties shape**

**Verdict: COMPLIANT.**

Our [`brand-stripe-onboard/index.ts:214-219`](../../supabase/functions/brand-stripe-onboard/index.ts#L214-L219):
```js
controller: {
  losses: { payments: "application" },
  fees: { payer: "application" },
  stripe_dashboard: { type: "express" },
  requirement_collection: "stripe",
}
```

Maps cleanly to [Stripe's controller properties documentation](https://docs.stripe.com/connect/accounts-v2.md):

| Stripe property | Our value | Stripe meaning |
|---|---|---|
| `controller.losses.payments` | `application` | Mingla liable for negative balances |
| `controller.fees.payer` | `application` | Mingla pays Stripe fees |
| `controller.stripe_dashboard.type` | `express` | Connected accounts get express dashboard access |
| `controller.requirement_collection` | `stripe` | Stripe collects onboarding requirements |

**Critical nuance from skill reference:** [Stripe explicitly says](https://docs.stripe.com/connect/accounts-v2.md):
> "Don't use the terms 'Standard', 'Express', or 'Custom' as account types. These are legacy categories that bundle together responsibility, dashboard, and requirement decisions into opaque labels. Controller properties give explicit control over each dimension."

**Our DEC-112 names "EXPRESS" as the account type.** This is Stripe's legacy terminology. The actual code uses controller properties correctly (express is just the dashboard.type value), but our documentation conflates the two. **Recommend SPEC v2 amendment to use controller-property terminology in DEC-112 + DEC-114.** See §4 amendment A1.

**Status: COMPLIANT (code) / TERMINOLOGY DRIFT (docs).**

---

**Sub-section 1c — API version pin (`2026-04-30.preview`)**

**Verdict: DEVIATION_JUSTIFIED.**

Skill SKILL.md states latest GA is `2026-04-22.dahlia`. We pin `2026-04-30.preview`. Per [Stripe's API versioning model](https://docs.stripe.com/api/versioning), `.preview` versions are dated AFTER GA and provide opt-in early access to features in development — including Accounts v2 (which is in public preview).

We REQUIRE Accounts v2 for our marketplace setup (controller properties on `accounts.create`). Per the [Connect Accounts v2 docs](https://docs.stripe.com/connect/accounts-v2.md):
> "For new Connect platforms, ALWAYS use the Accounts v2 API."

Pinning preview is the only way to access v2 today.

**Status: DEVIATION_JUSTIFIED.** Migration plan when Accounts v2 goes GA: re-pin to that GA version (likely `2026-XX-XX.<codename>`); test via tester dispatch; ship as Cycle B2c migration. SPEC v2 §11 risk register should add this — see §4 amendment A2.

---

**Sub-section 1d — SDK version (`stripe@18.0.0`)**

**Verdict: COMPLIANT.**

Stripe's [Node SDK changelog](https://github.com/stripe/stripe-node/releases) ships major versions to align with API version evolution. SDK 18.x targets `2026-04-30.preview` for Accounts v2 support. Taofeek's `17.4.0` would target `2024-11-20.acacia` (production v1) — incompatible with controller properties (forensics R-3 confirms).

**Status: COMPLIANT.**

---

### §2 API selection

**Sub-section 2a — Onboarding (`accounts.create` v2 + `accountSessions.create` v1)**

**Verdict: COMPLIANT.**

Per [Connect Embedded Components docs](https://docs.stripe.com/connect/get-started-connect-embedded-components):
- `POST /v2/core/accounts` creates the connected account with controller properties
- `POST /v1/account_sessions` creates a client_secret for embedded UI

This is the prescribed pairing. Account Links (`POST /v1/account_links`) is the alternative for **Stripe-hosted onboarding** (redirect-style), which we deliberately avoided per D-B2-23.

**Status: COMPLIANT.**

---

**Sub-section 2b — Status refresh polling (`accounts.retrieve` @ 30s)**

**Verdict: COMPLIANT.**

Webhooks are primary; polling is fallback per [Stripe webhooks best practices](https://docs.stripe.com/webhooks). 30s cadence is acceptable since webhook delivery typically completes within seconds. Polling exists to catch dropped events (Stripe occasionally fails delivery; durable queue catches signal-failures, polling catches delivery-failures).

**Status: COMPLIANT.** SPEC v2 §3 sampling note (D-V2-8) addresses operational concerns about polling frequency.

---

**Sub-section 2c — Detach (`accounts.del` best-effort + soft-delete)**

**Verdict: COMPLIANT (with operational caveat).**

Per [Stripe Accounts API delete docs](https://docs.stripe.com/api/accounts/delete):
- `DELETE /v1/accounts/{id}` only succeeds when account has no balance and no active subscriptions
- Returns errors otherwise

Our pattern: call delete, accept rejection, soft-delete locally via `detached_at = now()`. SPEC v2 D-B2-29 + D-V2-1 trigger fix correctly handles both cases.

**Operational caveat:** Stripe's docs note that even after delete, **the account ID remains visible in dashboard for record-keeping**. Brand admin should be aware they cannot fully purge their Stripe account through Mingla's UI. Surface this in the disconnect ConfirmDialog copy.

**Status: COMPLIANT.** See §4 amendment A3 for ConfirmDialog copy update.

---

**Sub-section 2d — Balances (`balance.retrieve` per connected account)**

**Verdict: COMPLIANT.**

Per [Balance API docs](https://docs.stripe.com/api/balance/balance_retrieve):
- `GET /v1/balance` returns balance for the connected account when called with `Stripe-Account` header (or via SDK's `stripeAccount` option)
- Returns arrays per currency in `available[]` and `pending[]`

Filtering to `brand.default_currency` is correct for single-currency brands. **Future B2c multi-currency needs to surface ALL currencies returned, not just default** — but per D-V2-4, multi-region is out-of-scope.

**Status: COMPLIANT for B2 MVP.**

---

### §3 Webhook handling

**Sub-section 3a — `constructEventAsync` for Deno**

**Verdict: COMPLIANT.**

Stripe's [webhook signature verification docs](https://docs.stripe.com/webhooks#verify-events) note that `constructEvent` uses HMAC-SHA256. In Node, this is sync (`crypto` module). **In Deno, only SubtleCrypto is available, which is async.** Stripe's official Node SDK ships `constructEventAsync` exactly for this Deno/Edge runtime case. Our usage at [`stripe-webhook/index.ts:85`](../../supabase/functions/stripe-webhook/index.ts#L85) is correct.

**Status: COMPLIANT.**

---

**Sub-section 3b — Event-type coverage (7 types)**

**Verdict: COMPLIANT — with one likely-missing event for our specific flow.**

Our SPEC v2 §6 covers: `account.updated`, `account.application.deauthorized`, `payout.{created,paid,failed,canceled}`, `capability.updated`. All are standard for marketplace platforms per [Connect events docs](https://docs.stripe.com/connect/webhooks).

**Likely missing:**

- **`account.external_account.created` / `account.external_account.updated`** — when a brand adds or updates a bank account, this fires. We don't handle it. Without this handler, our cache of "is bank account verified?" goes stale until next webhook OR refresh-status poll catches up. **Affects payout reliability** — Stripe may pause payouts if the external account is deauthorized but Mingla shows it as connected. Maps to forensics §9 Table C C7 (bank verification status).

**Likely not needed for B2a but worth confirming:**

- **`charge.dispute.created` / `charge.dispute.closed`** — Mingla has `controller.losses.payments=application`, meaning Mingla absorbs disputes. We need to know when one fires. **Probably B3 scope (where we accept charges)** — flag for B3.

**Status: COMPLIANT for B2 onboarding; one event type missing per §4 amendment A4.**

---

**Sub-section 3c — Durable queue + 200-always + retry**

**Verdict: COMPLIANT.**

Per [Stripe webhook best practices](https://docs.stripe.com/webhooks#retries-and-event-delivery):
- Stripe retries failed deliveries for 3 days (in test mode) / 16 days (production-archived events)
- Stripe expects 2xx within 30 seconds
- Idempotent processing is required (replays happen)

Our durable queue (insert before process; mark processed=true/false) + 200-always (don't tell Stripe to retry; we own retry via `retry_count`) is the textbook pattern for high-throughput webhook processors. SPEC v2 D-V2-3 (5-attempt retry cap) is a reasonable balance of "retry transient failures" vs "don't loop on permanent errors."

**Status: COMPLIANT.**

---

**Sub-section 3d — Event dedup by `event.id` UNIQUE**

**Verdict: COMPLIANT.**

Per [Stripe events idempotency](https://docs.stripe.com/webhooks#handle-duplicate-events):
> "Use the event ID to avoid duplicating side-effects."

Stripe's `event.id` is globally unique. UNIQUE constraint on `payment_webhook_events.stripe_event_id` is the correct dedup. **Don't need `account.id` + `event.created` as additional dedup keys** — those are useful for audit/forensics, not for dedup decision.

**Status: COMPLIANT.**

---

### §4 Idempotency

**Verdict: COMPLIANT (with minor improvement opportunity).**

Per [Stripe idempotent requests docs](https://docs.stripe.com/api/idempotent_requests):
- Idempotency-Key can be any string up to 255 chars
- Stripe remembers responses for 24 hours
- Same key returns cached response, even if request body differs slightly

Our `{brand_id}:{operation}:{epoch_ms}` format meets all requirements. Format is human-readable for debugging.

**Sub-millisecond collision concern (forensics CF-2):** practical risk is very low. Same-brand same-op same-ms calls would only happen on:
- Aggressive retry from a buggy client
- Test fixtures that race

Stripe's behavior on collision: returns the FIRST request's cached response. Even a "legitimate retry that finds an error response cached" still resolves correctly because the second call wasn't going to succeed where the first failed (same parameters, same Stripe-side state).

**Recommended improvement:** add nanosecond-precision OR random suffix to make collisions impossible:
```js
const epochNs = process.hrtime.bigint?.() ?? Date.now() * 1000000;
return `${brandId}:${operation}:${epochNs}`;
```

OR

```js
const random = crypto.randomUUID().slice(0, 8);
return `${brandId}:${operation}:${Date.now()}:${random}`;
```

**Status: COMPLIANT.** Improvement is optional/B2c.

---

### §5 Security

**Sub-section 5a — API key management (full secret key vs RAK)**

**Verdict: GAP — RECOMMENDED FIX.**

Per the skill's [security reference](https://docs.stripe.com/keys/restricted-api-keys.md):
> "Use restricted API keys (prefix `rk_`) instead of secret keys (prefix `sk_`) wherever possible. RAKs have only the permissions you assign, so a compromised RAK can do far less damage than a compromised secret key."
> "Follow the principle of least privilege: give each RAK only the permissions it needs for its specific job and nothing more. Create a separate RAK for each service or use case."

We currently use ONE `STRIPE_SECRET_KEY` for all 6 edge functions. Per least-privilege, we should use SIX RAKs:

| Edge function | Required scopes |
|---|---|
| `brand-stripe-onboard` | `accounts:write`, `account_sessions:write` |
| `stripe-webhook` | (none — signature verification only; no API calls in current scope) |
| `brand-stripe-refresh-status` | `accounts:read` |
| `brand-stripe-detach` | `accounts:write` |
| `brand-stripe-balances` | `balance:read` |
| `stripe-kyc-stall-reminder` | `accounts:read` (to query Stripe state before sending reminder) |

A compromised onboard-fn key cannot exfiltrate balance data; a compromised balance-fn key cannot create accounts. Today's all-or-nothing key is a single point of compromise.

**Status: GAP — recommended SPEC v2 amendment A5 to add RAK migration as Phase 0''.**

---

**Sub-section 5b — OAuth vs Connect Onboarding**

**Verdict: COMPLIANT (current choice correct).**

[Stripe Connect OAuth docs](https://docs.stripe.com/connect/oauth-reference) cover platforms whose connected accounts already have their own Stripe accounts that they connect via OAuth. Mingla's brand admins do NOT have pre-existing Stripe accounts — they're onboarding fresh through Mingla. Connect Onboarding (Embedded Components) is the right path.

**Status: COMPLIANT.** N/A — OAuth not relevant.

---

**Sub-section 5c — Webhook secret rotation**

**Verdict: GAP (operational, not architectural).**

[Stripe webhook security docs](https://docs.stripe.com/webhooks/signatures) note webhook signing secrets can be rotated by adding a new endpoint, transitioning traffic, then deleting the old. We have no documented procedure.

Per the SPEC v2 §3 "newly out of scope" tag (C5), this is deferred to "ops/compliance cycle." The skill's security reference explicitly mentions:
> "Rotate Stripe API keys when personnel with access to those keys depart."

The same applies to webhook secrets. Recommend codifying a runbook before live launch.

**Status: GAP — flag in SPEC v2 risk register; add operational runbook task.** See §4 amendment A6.

---

**Sub-section 5d — Webhook IP allowlist (defense in depth)**

**Verdict: GAP — RECOMMENDED FIX.**

Per the skill's security reference:
> "For defense in depth, also allowlist Stripe's IP addresses on your webhook endpoint so that it accepts connections only from Stripe's infrastructure."

Stripe publishes its [webhook IP ranges](https://docs.stripe.com/ips). Supabase Edge Functions don't natively support IP-allowlisting at platform level (Supabase doesn't expose firewall config), but you CAN add an IP check in the webhook handler code.

**Status: GAP — see §4 amendment A7. Lower priority than RAK migration since signature verification is the primary defense; this is just defense-in-depth.**

---

**Sub-section 5e — Mobile/client-side**

**Verdict: COMPLIANT.**

Our mobile app uses Stripe publishable key only (`pk_test_*`). Secret key lives server-side in Supabase Edge Functions. Per [Stripe security docs](https://docs.stripe.com/security):
> "Do not use production secret keys or RAKs in mobile apps or other client-side code. Client-side code can be extracted and keys decompiled."

**Status: COMPLIANT.**

---

### §6 Marketplace-specific concerns

**Sub-section 6a — Connect Platform Agreement clauses**

**Verdict: NEEDS LEGAL REVIEW (out of forensics scope).**

Per [Stripe Connect Platform Agreement](https://stripe.com/legal/connect-account):
- Mingla as platform with `losses.payments=application` is responsible for fraud + disputes on connected accounts
- Mingla must surface certain T&Cs to brand admins (specifics vary by region)

**Recommend:** legal team reviews the Mingla Business Terms of Service to ensure required disclosures are present. Out of forensics scope but flag for orchestrator.

**Status: COMPLIANT (technical) / LEGAL_REVIEW_NEEDED.**

---

**Sub-section 6b — 1099-K reporting**

**Verdict: COMPLIANT.**

`controller.requirement_collection: "stripe"` means Stripe collects all KYC/tax info from connected accounts. Per [Stripe 1099-K documentation](https://docs.stripe.com/connect/tax-reporting), Stripe handles 1099-K for US-based connected accounts when the platform's controller properties have `requirement_collection=stripe`.

**For B2c US expansion:** verify Stripe's tax-reporting product is enabled for our platform; configure platform branding for 1099-K mailings.

**Status: COMPLIANT for UK MVP.** Flag for B2c US expansion.

---

**Sub-section 6c — Disputes / chargebacks**

**Verdict: COMPLIANT (with operational caveat).**

`controller.losses.payments=application` means Mingla absorbs negative balance events including chargebacks. SPEC v2 audit logging captures all state transitions, providing dispute investigation evidence.

**Operational caveat for B3:** when checkout flows ship, we'll need:
- Dispute response UI for brand admins
- Webhook handlers for `charge.dispute.created` / `charge.dispute.funds_withdrawn` / `charge.dispute.closed`
- Funds escrow logic (don't pay out connected account until dispute deadline passes)

**Status: COMPLIANT for B2.** Flag for B3 dispute flow design.

---

**Sub-section 6d — `account.application.deauthorized` handling**

**Verdict: COMPLIANT.**

SPEC v2 §6 webhook router handles `account.application.deauthorized` by setting `detached_at = now()`. Per [Stripe Connect deauthorization docs](https://docs.stripe.com/connect/cleanup):
> "When a connected account deauthorizes your platform, Stripe sends an `account.application.deauthorized` webhook event. Update your records to remove your reference to the account."

Our soft-delete via `detached_at` (preserving audit history) is correct. **Don't hard-delete** — Stripe rules say maintain audit records.

**One gap:** Stripe also recommends notifying the brand admin via email when this happens (they may have intended to deauthorize, but should know we received the signal). Our SPEC has no such notification.

**Status: COMPLIANT.** §4 amendment A8 to add notification.

---

### §7 Migration paths from deprecated APIs

**Verdict: COMPLIANT (no deprecated calls).**

Reviewed our edge function code:
- `accounts.create` (v2): current; not deprecated
- `accountSessions.create` (v1): current; not deprecated
- `accounts.retrieve` (v1, but works on v2 accounts): current
- `accounts.del` (v1): current; long-stable API
- `balance.retrieve`: current
- `webhooks.constructEventAsync`: current SDK feature

**No deprecated parameters or endpoints in use.** Per the skill SKILL.md directive ("Always use the latest API version and SDK unless the user specifies otherwise"), we're aligned.

**When `2026-04-30.preview` features go GA:** SDK will likely ship a major version bump (e.g., `stripe@19.0.0`) targeting the GA version. Migration path:
1. Re-pin `_shared/stripe.ts` `STRIPE_API_VERSION` to GA version
2. Update SDK import URL to new major
3. Run all 5 strict-grep gates (I-PROPOSED-Q catches inline overrides automatically)
4. Tester dispatch covers regression

**Status: COMPLIANT.** Migration path is straightforward.

---

## §3 — Section 8: Additional gaps not yet caught (8 items beyond C1-C12)

Beyond the 12 follow-ups already in SPEC v2 §3, these are gaps a Stripe-experienced engineer would notice:

| # | Gap | Why it matters | Severity | Recommended cycle |
|---|---|---|---|---|
| **C13** | **No Restricted API Keys (RAKs) per edge function** | Single full secret key = single point of compromise. Stripe's #1 security recommendation. | S1 | B2 v2.1 (this cycle) |
| **C14** | **No webhook IP allowlist** | Defense in depth on top of signature verification | S2 | B2 v2.1 OR B2c |
| **C15** | **No `account.external_account.{created,updated}` webhook handler** | Bank account changes go undetected; payout reliability suffers | S2 | B2 v2.1 |
| **C16** | **No `dispute.*` webhook handlers** | Mingla absorbs disputes per `controller.losses.payments=application` — must know when one fires | S1 (for B3); not yet in scope for B2 | B3 (Checkout) |
| **C17** | **`controller.merchant_of_record` not set; "merchant of record" terminology is loose** | At B3 (Checkout) we'll need explicit `on_behalf_of` + `transfer_data.destination` for destination charges. Current SPEC docs use "merchant of record" loosely. | S2 | B3 (with clear B2 doc fix now) |
| **C18** | **`stripe_connect_accounts.account_type` schema column conflates Stripe legacy account-type terminology with controller-property-derived values** | Per Stripe: "Don't use 'Standard', 'Express', or 'Custom' as account types." Our column stores "express" as if it's Stripe's legacy account type, but our actual config uses controller properties. | S3 (cosmetic) | B2c rename |
| **C19** | **No notification to brand admin when `account.application.deauthorized` fires** | Stripe recommends notifying when receiving this signal | S2 | B2 v2.1 |
| **C20** | **No documented procedure for webhook secret rotation** | Standard SRE/security practice; required for compliance posture | S2 | Ops runbook (out-of-cycle) |

---

## §4 — Recommended SPEC v2 amendments

| ID | Description | Priority | Phase |
|---|---|---|---|
| **A1** | Update DEC-112 + DEC-114 wording to use controller-property terminology, not "Express" / "merchant of record" labels. Clarify: `controller.stripe_dashboard.type=express` (a dashboard access value) and `controller.losses.payments=application + controller.fees.payer=application` (a liability config), NOT "Express account type" or "merchant of record" as Stripe defines them. | S3 (clarity) | Phase 0' doc fix |
| **A2** | Add SPEC v2 §11 risk: "API version `2026-04-30.preview` GA-migration risk" with mitigation: when v2 goes GA, re-pin `STRIPE_API_VERSION` + SDK; tester dispatch validates. | S2 | Phase 0' doc append |
| **A3** | ConfirmDialog copy on Disconnect CTA must mention: "Stripe will retain a record of the connected account for 7 years per their compliance requirements." | S3 | Phase 6 frontend |
| **A4** | Add `account.external_account.created` + `account.external_account.updated` to webhook router event-type list (SPEC v2 §6 handler table). Behavior: update `stripe_connect_accounts.requirements` JSONB; log audit row; surface bank-verification-pending state in UI. | S2 | Phase 1 (webhook router) |
| **A5** | **Add new Phase 0''**: RAK migration. Create 6 restricted API keys (one per edge fn) with least-privilege scopes; update Supabase env vars; rotate full secret key out. Include rollback plan. | **S1** | New Phase 0'' (after V2 Phase 0', before Phase 1) |
| **A6** | Add SPEC v2 §11 risk: "Webhook secret rotation procedure missing." Mitigation: ops runbook (out-of-cycle); document the dual-secret transition pattern from Stripe. | S2 | SPEC v2 risk register append |
| **A7** | Add IP allowlist check to `stripe-webhook/index.ts` post-signature verification. Use Stripe's published IP ranges with periodic refresh. Alternative: implement as middleware. | S2 | Phase 1 modify |
| **A8** | Add brand-admin email notification on `account.application.deauthorized` webhook handler. Use existing Resend integration. | S2 | Phase 1 webhook router |

**Priority distribution:** 1× S1 (RAKs), 5× S2 (security defense-in-depth + bank verification + notifications + risks + webhooks), 2× S3 (documentation clarity).

**Recommended sequence:**
1. **Phase 0' (current)** — apply A1, A2, A6 (doc fixes + risk register) — minimal effort
2. **Phase 0'' (NEW)** — apply A5 (RAK migration) — high security ROI, isolated change
3. **Phase 1 (planned)** — apply A4, A7, A8 alongside webhook router authoring — same scope
4. **Phase 6 (planned)** — apply A3 (ConfirmDialog copy) — minor UI tweak

---

## §5 — Stripe documentation references

| Topic | URL |
|---|---|
| Connect Accounts v2 | https://docs.stripe.com/connect/accounts-v2 |
| Connect Embedded Components | https://docs.stripe.com/connect/get-started-connect-embedded-components |
| Connect Onboarding overview | https://docs.stripe.com/connect/onboarding |
| Connect SaaS platforms guide | https://docs.stripe.com/connect/saas-platforms-and-marketplaces |
| Connect Charge types | https://docs.stripe.com/connect/charges |
| Account Capabilities | https://docs.stripe.com/connect/account-capabilities |
| Accounts API delete | https://docs.stripe.com/api/accounts/delete |
| Account Sessions API | https://docs.stripe.com/api/account_sessions |
| Balance API | https://docs.stripe.com/api/balance/balance_retrieve |
| Webhooks overview | https://docs.stripe.com/webhooks |
| Webhook signatures | https://docs.stripe.com/webhooks/signatures |
| Webhook IP allowlist | https://docs.stripe.com/ips |
| Connect webhooks | https://docs.stripe.com/connect/webhooks |
| Connect cleanup (deauthorization) | https://docs.stripe.com/connect/cleanup |
| Idempotent requests | https://docs.stripe.com/api/idempotent_requests |
| Restricted API keys | https://docs.stripe.com/keys/restricted-api-keys |
| API key best practices | https://docs.stripe.com/keys-best-practices |
| Connect Platform Agreement | https://stripe.com/legal/connect-account |
| Connect tax reporting (1099-K) | https://docs.stripe.com/connect/tax-reporting |
| API versioning | https://docs.stripe.com/api/versioning |
| Go Live Checklist | https://docs.stripe.com/get-started/checklist/go-live |
| Security overview | https://docs.stripe.com/security |
| OAuth (for reference; not used) | https://docs.stripe.com/connect/oauth-reference |
| Compromised keys response | https://support.stripe.com/questions/protecting-against-compromised-api-keys |

---

## §6 — Confidence statement

| Section | Confidence | Why |
|---|---|---|
| Connect platform configuration | **H** | Code citations + Stripe docs verified |
| API selection | **H** | Each call traced to official endpoint docs |
| Webhook handling | **H** | Signature verification + replay-safety pattern matches Stripe's documented best practice |
| Idempotency | **H** | Format meets Stripe's published spec |
| Security | **M-H** | RAKs + IP allowlist + secret rotation are clear gaps; primary defense (signature verification) is in place |
| Marketplace concerns | **M** | Compliance/legal review required for §6a + §6b at scale |
| Deprecation paths | **H** | No deprecated calls in our code |
| Section 8 (additional gaps) | **M-H** | Items C13-C20 are interpretive — based on Stripe docs + general marketplace platform requirements |

**Aggregate audit confidence: H (technical) / M (operational/compliance — recommend legal review for §6a + B3 dispute flow design before checkout cycle).**

---

**End of audit.**

**Total findings: 8 additional gaps (C13-C20) + 8 recommended SPEC v2 amendments (A1-A8).**

**Most consequential next steps:**
1. **Add Phase 0''** (RAK migration) to SPEC v2 — S1 security improvement
2. **Phase 1 webhook router** picks up A4 (external_account events) + A7 (IP allowlist) + A8 (deauthorize notification)
3. **Doc-only fixes** (A1, A2, A3, A6) ship with Phase 0' or as a small follow-up commit
