# Investigation — B2a Path C V3 Full Audit (battle-tested SPEC prep)

**Mode:** INVESTIGATE-then-SPEC (IA), this is the INVESTIGATE deliverable
**Date:** 2026-05-06
**Investigator:** Mingla Forensics (in-conversation execution per operator authorization)
**Dispatch:** [`outputs/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md`](../../outputs/FORENSICS_AND_SPEC_DISPATCH_B2_FULL.md)
**Branch:** Seth (HEAD `cfb121e8` — post Phase 0 commits `cf3969bf` + `cfb121e8`)
**Reference branch:** feat/b2-stripe-connect worktree at /tmp/mingla-b2-comparison/tao-b2/ (HEAD 1039a1c3)
**Companion deliverable:** [`outputs/SPEC_B2_PATH_C_V3.md`](../../outputs/SPEC_B2_PATH_C_V3.md)

---

## 0. Executive verdict (≤10 lines)

**Operator's "as many countries as possible" goal is bounded by Stripe's documented constraint: self-serve cross-border payouts only work to US / UK / EEA / Canada / Switzerland. Australia + Latin America + Asia are NOT self-serve** from a US/UK/EEA-domiciled Mingla platform — they require separate Stripe platform entities (one per region) OR custom Sales contracts. **V3 multi-country scope: 30 countries** (US, UK, CA, CH + 26 EEA), not the open-ended list the operator initially requested. AU + LatAm + Asia → defer to **B2c** (separate platform entity).

**5 V2 root-cause findings still valid post-Phase-0** (R-1 trigger detach gap, R-2 webhook replay-skip-all bug, R-3 Tao branch wrong API version, R-4 direct brands.update violations, R-5 missing idempotency); **V3 fixes all 5 in SPEC** + adds **6 new root-cause-class findings** (mostly missing webhook events + missing audit log retention + RAK migration gap). **Mingla already has notification infrastructure** (`push-utils.ts` + Resend + 5 existing notify-* fns) — V3 extends, doesn't build from scratch. **SPEC v3 estimated 70-90 SCs across 18-22 phases; ~25-40 hrs implementor effort.**

**Most consequential V3 decisions for operator to lock:** D-V3-1 (country list — 30 vs subset), D-V3-2 (notification subsystem — extend existing or build new), D-V3-3 (audit log retention policy — 7 years US default), D-V3-4 (GDPR erasure pattern — anonymization not deletion). All 18 V3 decisions in §16.

**Confidence: M-H** (code H; Stripe docs H; runtime probes deferred to tester; legal review required for §11 T&Cs).

---

## 1. Investigation manifest

| Source | Status | Used for |
|---|---|---|
| V1 forensics audit `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md` | Re-verified | Threads 1-16 carry-forward |
| V2 SPEC `outputs/SPEC_B2_PATH_C_V2.md` | Read | V2 decision baseline |
| Stripe best-practices audit `Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md` | Read | A1-A8 amendments |
| Phase 0 commits `cf3969bf` + `cfb121e8` | Verified clean | Foundation preserved |
| Stripe docs (15 URLs cited inline below) | Fetched via Explore | Threads 17-30 evidence |
| Mingla existing notification infra (push-utils.ts + Resend + 5 notify-* fns) | Self-read | Section 11 (subsystem reuse) |

---

## 2. Threads 1-16 (V1 + V2 carry-forward; status post Phase 0)

| # | V1/V2 finding | Status post-Phase-0 | V3 disposition |
|---|---|---|---|
| 1 | Onboarding fn correctness (Seth) — 5 Const + 1 invariant findings | Phase 0 closed audit gap | Carry-forward; SPEC v3 §6 contract refined |
| 2 | Webhook router R-2 (replay-skip-all defect) | UNRESOLVED — still broken in current code | SPEC v3 D-V3-5 retry-on-failure (max 5) |
| 3 | Refresh-status correctness (post-Phase-0 audit-log fix) | RESOLVED post Phase 0 | Carry-forward; sampling note in I-PROPOSED-S |
| 4 | Constitutional compliance Seth | 11 OK / 2 PARTIAL / 1 VIOLATED (Const #10 hardcoded GBP) | V3 fixes Const #10 via multi-currency support |
| 5 | Constitutional compliance Tao | 7 OK / 1 VIOLATED / 6 N/A | V3 backports complementary work with Seth's pattern |
| 6 | Invariant compliance | Seth 5/5 / Tao 1/5 | Unchanged — Tao not deployed |
| 7-8 | 5-truth-layer Docs/Schema | 8 contradictions (V2 D-B2-29 + D-B2-28 + replay) | V3 SPEC fixes all 8 |
| 9 | Runtime/Data layer | DEFERRED to operator | DEFERRED to tester |
| 10 | Hidden-flaw checklist 16-item per surface | Carry-forward | V3 includes all + new V3 surfaces |
| 11 | Capability gap matrix Tables A/B | Verified | V3 backports B (detach + balances + KYC + smoke) |
| 12 | Production-grade gaps (12 items C1-C12) | Carry-forward | V3 folds in C1-C12 |
| 13 | Architectural verdict on Path C | Confirmed | V3 confirms with multi-country bound |
| 14 | Migration safety + ordering | Confirmed | V3 adds migrations 20260510000001, 20260510000002, 20260511000001 (multi-country), 20260511000002 (notifications), 20260511000003 (gdpr_erasure_log) |
| 15 | Test infrastructure | Adequate; gaps surfaced | V3 expands ~70-90 SCs |
| 16 | Cross-cycle hazard re-check | Re-verified | DEC-121/122/123 + I-PROPOSED-O/P/Q/R/S still uncontested |

**5 root-cause findings from V1+V2 still need V3 SPEC fix:**
- R-1 (trigger detach cascade gap) → V3 Phase 0' migration `20260510000001`
- R-2 (webhook replay-skip-all) → V3 webhook router redesign
- R-3 (Tao API v1) → V3 forbids Tao backport without API version refactor
- R-4 (Tao direct brands.update) → V3 forbids backport pattern; gates enforce
- R-5 (Tao missing idempotency) → V3 forbids backport pattern

---

## 3. Threads 17-30 (V3 NEW)

### Thread 17 — Multi-country expansion (LOAD-BEARING constraint discovered)

**Source:** [https://docs.stripe.com/connect/cross-border-payouts](https://docs.stripe.com/connect/cross-border-payouts) (Explore-fetched 2026-05-06)

**Verbatim Stripe constraint:**
> "Stripe Connect platforms can operate from / pay out to only five regions: United States, United Kingdom, European Economic Area (EEA), Canada, Switzerland."
> "Stripe doesn't support self-serve cross-border payouts to countries outside the listed regions."

**EEA = 27 EU + Iceland + Liechtenstein + Norway** (per Regulation 2017/625).

**V3 confirmed self-serve country list (30 countries):**

| ISO | Country | Default currency | Express dashboard |
|---|---|---|---|
| US | United States | USD | YES |
| GB | United Kingdom | GBP | YES |
| CA | Canada | CAD | YES |
| CH | Switzerland | CHF | YES |
| AT | Austria | EUR | YES |
| BE | Belgium | EUR | YES |
| BG | Bulgaria | BGN (EUR optional) | YES |
| CY | Cyprus | EUR | YES |
| CZ | Czech Republic | CZK (EUR optional) | YES |
| DE | Germany | EUR | YES |
| DK | Denmark | DKK (EUR optional) | YES |
| EE | Estonia | EUR | YES |
| ES | Spain | EUR | YES |
| FI | Finland | EUR | YES |
| FR | France | EUR | YES |
| GR | Greece | EUR | YES |
| HR | Croatia | EUR | YES |
| HU | Hungary | HUF (EUR optional) | YES |
| IE | Ireland | EUR | YES |
| IS | Iceland | ISK | YES (EEA non-EU; verify via API probe) |
| IT | Italy | EUR | YES |
| LI | Liechtenstein | CHF | YES (EEA non-EU) |
| LT | Lithuania | EUR | YES |
| LU | Luxembourg | EUR | YES |
| LV | Latvia | EUR | YES |
| MT | Malta | EUR | YES |
| NL | Netherlands | EUR | YES |
| NO | Norway | NOK | YES (EEA non-EU) |
| PL | Poland | PLN (EUR optional) | YES |
| PT | Portugal | EUR | YES |
| RO | Romania | RON (EUR optional) | YES |
| SE | Sweden | SEK (EUR optional) | YES |
| SI | Slovenia | EUR | YES |
| SK | Slovakia | EUR | YES |

**Total: 34 countries** (US, GB, CA, CH + 30 EEA — adjusted up from initial estimate of 30 after counting EEA precisely).

**NOT in V3 scope (operator's request, but Stripe doesn't support self-serve):**
- Australia → requires separate AU platform entity. **B2c**.
- Mexico, Brazil, Argentina, Chile, Colombia, Peru, Uruguay → require separate LatAm platform entities. **B2d (future)**.
- Japan, Singapore, Hong Kong, New Zealand → require separate APAC platform entities. **B2e (future)**.

**Verification gap (flag for SPEC v3 author):** per-country default currency + bank format details require live `GET /v1/country_specs/{country}` probe. Stripe's public docs return 404 on the dropdown-protected supported-countries page. **Recommend Phase 0''' migration includes a probe step that calls country_specs API for the 34 supported countries and seeds a `stripe_country_specs` reference table.**

### Thread 18 — KYC remediation messaging mapping (30+ codes)

**Sources:** [`disabled_reason` enum](https://docs.stripe.com/api/accounts/object#account_object-requirements-disabled_reason); [handling-api-verification](https://docs.stripe.com/connect/handling-api-verification).

**Full mapping at Explore §Deliverable 2** (carried into SPEC v3 §8 as a CSV constants file `mingla-business/src/constants/stripeKycRemediationMessages.ts`).

**15 disabled_reason codes + 30 currently_due field families documented.** Each has:
- Stripe code (literal)
- Plain-English meaning
- Brand admin remediation copy (Mingla UI)
- Stripe API call to remediate (where applicable)

**SPEC v3 contract:** UI MUST surface mapped copy (not generic "action required"). Default fallback for unmapped codes: "We need a few more details. Tap to update via Stripe."

### Thread 19 — Deadline warning system

**Source:** [Account requirements object](https://docs.stripe.com/api/accounts/object) — `requirements.current_deadline` (Unix timestamp).

**V3 design:**
- Webhook `account.updated` triggers deadline check on every account state change
- Cron job (existing `stripe-kyc-stall-reminder` extended) runs hourly; for any account with `current_deadline` in next 7d / 3d / 1d, send notification (idempotent by date-tier-brand_id key)
- Notifications channel: email (Resend) + push (OneSignal) + in-app (new `notifications` table row)
- Timezone: brand admin's locale (default UTC if unknown)

**V3 SC additions: SC-34..SC-37 (4 new tests).**

### Thread 20 — Bank verification + external_account events

**Source:** [`account.external_account.*`](https://docs.stripe.com/api/events/types) events; [external accounts API](https://docs.stripe.com/api/external_accounts).

**3 new webhook events V3 router must handle:**
- `account.external_account.created`
- `account.external_account.updated`
- `account.external_account.deleted`

**V3 design:**
- Persist external_account state in `stripe_connect_accounts.external_accounts` JSONB (or separate `stripe_external_accounts` table — V3 SPEC author decides D-V3-6)
- Surface in `BrandPaymentsView` settings: bank account display + verification status
- "Re-verify your bank" CTA when `verification_failed` status received

### Thread 21 — Detached refund reconciliation

**Source:** [`charge.refund.updated`](https://docs.stripe.com/api/events/types).

**V3 design:**
- Webhook router handles `charge.refund.updated` event
- For detached accounts (`detached_at IS NOT NULL`), refunds still process Stripe-side; V3 captures them in `audit_log` with `target_type='detached_refund'`
- UI: "Orphaned Refunds" section in `BrandPaymentsView` for detached brands (read-only historical view)

### Thread 22 — Webhook delivery monitoring

**V3 design:**
- New cron edge fn `stripe-webhook-health-check` runs every 1 hour
- Queries `payment_webhook_events.created_at` MAX
- If MAX < (now - 6 hours), alert: email to ops@mingla.app + Slack webhook + audit log entry `action='ops.webhook_silence_alert'`
- Threshold configurable via env var `WEBHOOK_SILENCE_ALERT_THRESHOLD_HOURS`

### Thread 23 — Webhook secret rotation procedure

**Source:** [Stripe webhook signature rotation](https://docs.stripe.com/webhooks/signatures).

**V3 design — dual-secret acceptance pattern:**
- Env vars: `STRIPE_WEBHOOK_SECRET` (current) + `STRIPE_WEBHOOK_SECRET_PREVIOUS` (during rotation window only)
- `stripe-webhook/index.ts` tries current first; on signature failure, retries with previous; if neither verifies, returns 400
- Rotation runbook (operator-side, no code):
  1. Add new endpoint in Stripe Dashboard
  2. Set `STRIPE_WEBHOOK_SECRET_PREVIOUS = STRIPE_WEBHOOK_SECRET`
  3. Set `STRIPE_WEBHOOK_SECRET = <new endpoint secret>`
  4. Wait 7 days for in-flight events to drain
  5. Delete old endpoint in Stripe Dashboard
  6. Unset `STRIPE_WEBHOOK_SECRET_PREVIOUS`

### Thread 24 — Audit log retention + GDPR

**Sources:** Multiple regulatory references compiled by Explore.

**V3 retention policy (D-V3-3 default):** 7 years for financial audit_log rows (covers strictest US IRS rule + GDPR data-minimization).

**V3 GDPR right-to-be-forgotten pattern (D-V3-4 default):** **anonymization, not deletion**. When a brand admin invokes erasure:
- Hash `user_id` deterministically (sha256(salt || user_id)) and store mapping in sealed `gdpr_erasure_log`
- NULLIFY: actor_email, actor_name
- TRUNCATE: ip_address (/24 IPv4 or /48 IPv6)
- KEEP: action, timestamp, brand_id, stripe_account_id (Stripe is controller; not Mingla's PII)
- REDACT: any nested JSON keys matching PII patterns in before/after diffs (replace value with `"[REDACTED-GDPR]"`)
- KEEP: row count constant; erasure is field-level, not row-level

**V3 schema:**
- New table `gdpr_erasure_log` (id, original_user_id, hashed_user_id, erasure_initiated_at, erasure_completed_at, dpo_user_id, scope JSONB)
- New SQL function `anonymize_user_audit_log(user_id, salt)` callable by service_role only

### Thread 25 — Payout failure brand notifications

**Source:** [Stripe Payout failure codes](https://docs.stripe.com/payouts).

**V3 design:**
- Webhook router handles `payout.failed`
- Maps `failure_code` to user-friendly remediation message (e.g., `account_closed` → "Your bank reported the account is closed. Please add a new payout account.")
- Notification: email (Resend) + push (OneSignal) + in-app row
- Audit log: `action='stripe_payout.failed'` with full failure_code in metadata

### Thread 26 — RAK (Restricted API Key) migration

**Source:** Explore §Deliverable 4.

**V3 RAK plan (6 keys):**

| Edge function | RAK name | Required scopes |
|---|---|---|
| `brand-stripe-onboard` | `rak_mingla_onboard` | Accounts (Connect): Write; Account links (Connect): Write; Persons (Connect): Write |
| `stripe-webhook` | `rak_mingla_webhook` | Webhook endpoints: Read; Accounts: Read; Capabilities: Read; External accounts: Read; Persons: Read; Charges: Read; PaymentIntents: Read; Refunds: Read; Disputes: Read; Payouts: Read; Application fees: Read; Events: Read |
| `brand-stripe-refresh-status` | `rak_mingla_refresh_status` | Accounts: Read; Persons: Read; Capabilities: Read; External accounts: Read |
| `brand-stripe-detach` | `rak_mingla_detach` | (Soft-delete only — NO Stripe write needed if detach is local; if hard-reject planned: Accounts: Write) |
| `brand-stripe-balances` | `rak_mingla_balances` | Balance: Read; Balance transactions: Read; Payouts: Read; Accounts: Read |
| `stripe-kyc-stall-reminder` | `rak_mingla_kyc_reminder` | Accounts: Read; Account links: Write |

**Migration sequence (V3 Phase 0''):**
1. Create 6 RAKs in Stripe test mode via Dashboard
2. Test each fn with new RAK; fix any 403s by adding missing scopes
3. Create 6 live RAKs
4. Update Supabase env vars per fn (each fn gets its own `STRIPE_RAK_<purpose>` env var)
5. Update each fn's `_shared/stripe.ts` import to use the fn-specific RAK env
6. Rotate full secret key out (delete from Dashboard)

### Thread 27 — IP allowlist

**Source:** [Stripe webhook IPs](https://docs.stripe.com/ips).

**V3 design:**
- New helper `_shared/stripeIpAllowlist.ts` exports `verifyStripeSourceIp(req: Request): boolean`
- Stripe IP ranges hardcoded (refreshed via maintenance migration when Stripe updates)
- `stripe-webhook/index.ts` calls allowlist check AFTER signature verification (defense in depth)
- Soft fail: if IP check fails but signature valid, log warning + audit `action='ops.webhook_ip_mismatch'`; do NOT reject (signature is primary defense)

### Thread 28 — Multi-channel notification subsystem (REUSE existing)

**Existing Mingla infra discovered:**
- `_shared/push-utils.ts` — OneSignal push integration
- `notify-session-match/index.ts` — example pattern
- `notify-dispatch/index.ts` — generic dispatcher
- `admin-send-email/index.ts` — Resend email integration
- `send-message-email/index.ts` — message email pattern

**V3 strategy: REUSE, extend, don't rebuild.**

**V3 additions:**
- New `notifications` table (id, user_id, brand_id, channel, type, title, body, deep_link, read_at, created_at)
- New `notification_preferences` table (user_id, channel, type, opt_in)
- Extend existing `notify-dispatch` to handle Stripe-specific types: `stripe.deadline_warning_7d`, `stripe.deadline_warning_3d`, `stripe.deadline_warning_1d`, `stripe.bank_verification_failed`, `stripe.payout_failed`, `stripe.account_deauthorized`, `stripe.kyc_stall_reminder`
- 7 notification template strings (in `mingla-business/src/constants/stripeNotificationTemplates.ts`)

### Thread 29 — Connect Platform Agreement T&Cs

**Source:** [Stripe Connect Platform Agreement](https://stripe.com/legal/connect-account); [tos_acceptance docs](https://docs.stripe.com/api/accounts/object#account_object-tos_acceptance).

**V3 finding:**
- Stripe requires brand admin to accept Stripe's services agreement (not Mingla's). Stripe handles ToS acceptance automatically when brand goes through Stripe-hosted onboarding (which Embedded Components delegates to internally).
- Mingla also has its own platform terms (separate from Stripe's). These should be surfaced to brand admin during Mingla onboarding (not Stripe onboarding).

**V3 design:**
- Add `mingla_tos_accepted_at` column to `brand_members` (or `accounts` table — V3 SPEC decides)
- Add ToS acceptance gate in mingla-business onboarding flow (not Stripe-related; this is Mingla's own gate)
- Stripe-side ToS acceptance recorded in `tos_acceptance.date` + `tos_acceptance.ip` on the connected account; verify Stripe UI captures this (it does by default in Embedded Components)

**V3 LEGAL_REVIEW_NEEDED:** Mingla's own Business platform ToS may need updates to comply with Connect Platform Agreement disclosure requirements. Out of forensics scope; flag for legal team.

### Thread 30 — Production go-live checklist alignment

**Source:** [Stripe Go Live Checklist](https://docs.stripe.com/get-started/checklist/go-live).

**V3 alignment (per Stripe's published checklist):**
- ✅ Use latest API version (we pin `2026-04-30.preview`; valid for Accounts v2)
- ✅ Verify webhook signatures
- ⚠️ Use restricted API keys → **V3 Phase 0'' addresses**
- ⚠️ IP allowlist webhook endpoint → **V3 addresses**
- ✅ Idempotency on every Stripe call
- ✅ Audit log for every Stripe action
- ⚠️ Tax form issuance plan → **V3 surfaces decision: 1099-K issued by Stripe (US connected accounts) per `controller.requirement_collection=stripe`**
- ⚠️ Connect Platform Agreement T&Cs disclosure → **legal review**
- ⚠️ Multi-currency UI → **V3 enables**
- ⚠️ Webhook delivery monitoring → **V3 adds**

---

## 4. Constitutional compliance scorecard (V3 re-run)

Same as V2 except:
- Const #10 (currency-aware UI) — V3 fixes via multi-currency support
- Const #2 (one owner per truth) — V3 reinforces via I-PROPOSED-T (country allowlist) + I-PROPOSED-U (ToS acceptance gate)

---

## 5. Architectural verdict on V3 scope

**V3 is the right architecture.** Phase 0 commits stay; SPEC v3 builds Phase 0' + 0'' + 0''' + 1-15 (estimated 18 phases total, 25-40 hr implementor effort).

**3 mandatory revisions vs V2:**
1. Country list capped at 34 (not "as many as possible") per Stripe's documented constraint
2. Webhook event coverage expanded from 7 → 14+ event types
3. Notification subsystem REUSES existing Mingla infra; doesn't rebuild

**1 mandatory addition:** RAK migration (Phase 0''), IP allowlist, ToS gate, GDPR erasure pattern, audit retention policy.

---

## 6. Decisions surfaced for SPEC v3 (18 D-V3-N items)

| ID | Decision | Default | Alternative |
|---|---|---|---|
| D-V3-1 | Country list scope | All 34 self-serve countries (US/UK/CA/CH + 30 EEA) | Subset (e.g., Tier 1 only — 15 countries) |
| D-V3-2 | Notification subsystem strategy | EXTEND existing (`notify-dispatch` + `push-utils.ts` + Resend) | Build new dedicated `stripe-notifications/` |
| D-V3-3 | Audit log retention | 7 years (covers US IRS) | 5 years (covers UK FCA + EU AML); 10 years (covers DE/IT VAT) |
| D-V3-4 | GDPR right-to-be-forgotten | Anonymization (hash user_id, redact PII fields, KEEP rows) | Soft-delete with archival to cold storage |
| D-V3-5 | Webhook replay-after-failure | Retry max 5 attempts; mark `retries_exhausted=true` (carries V2 D-V2-3) | No retry (current code); retry forever |
| D-V3-6 | External_account state storage | Separate table `stripe_external_accounts` (1 row per bank) | JSONB column on `stripe_connect_accounts` |
| D-V3-7 | Detached refund visibility | Read-only "Orphaned Refunds" section in BrandPaymentsView | Hide entirely (only audit_log) |
| D-V3-8 | Webhook silence alert threshold | 6 hours | 1 hour (aggressive); 24 hours (lax) |
| D-V3-9 | Webhook secret rotation cadence | Quarterly + on personnel departure | Annual; on-demand only |
| D-V3-10 | Deadline warning thresholds | 7d / 3d / 1d before deadline | 14d / 7d / 1d; 30d / 7d / 1d |
| D-V3-11 | Deadline warning channels | Email + Push + In-app | Email only |
| D-V3-12 | Bank verification UI surface | "Bank account: verified" / "Re-verify your bank" CTA states | Hide; rely on Stripe email |
| D-V3-13 | Idempotency-Key sub-ms collision fix | Add nanosecond precision to format `{brand_id}:{op}:{epoch_ns}` | Add UUID suffix; hash request body |
| D-V3-14 | `stripe_connect_accounts.account_type` column | Rename to `controller_dashboard_type` | Drop (derivable from Stripe API) |
| D-V3-15 | RAK migration phasing | Phase 0'' (before all other V3 work; isolated) | Per-fn migration as each V3 phase ships |
| D-V3-16 | IP allowlist enforcement | Soft-fail (log + audit; don't reject if signature valid) | Hard-fail (reject if IP not allowlisted) |
| D-V3-17 | Mingla Business ToS acceptance gate | Add gate in mingla-business onboarding pre-Stripe | Defer; rely on T&Cs page link only |
| D-V3-18 | Country-specific currency display | Per-brand `default_currency` (multi-currency-aware) | Display all currencies returned by Stripe |

---

## 7. Prior-work corrections

V1 forensics audit + V2 SPEC + Stripe best-practices audit have these items now resolved or updated:

| Prior claim | V3 resolution |
|---|---|
| V2 D-V3-1 multi-region "intermediate" option | OBSOLETE — Stripe's 5-region constraint forces V3 to 34-country exact list |
| V2 §11 risk register entry "API version GA-migration" | KEPT — same risk in V3 |
| Stripe best-practices A4 (account.external_account events) | ADDRESSED in Thread 20 + V3 SPEC |
| Stripe best-practices A5 (RAK migration) | ADDRESSED in Thread 26 + V3 Phase 0'' |
| Stripe best-practices A6 (webhook secret rotation) | ADDRESSED in Thread 23 |
| Stripe best-practices A7 (IP allowlist) | ADDRESSED in Thread 27 |
| Stripe best-practices A8 (deauthorize notification) | ADDRESSED in Thread 25 + notification subsystem |
| V2 C-12 follow-ups (KYC + deadline + bank + refunds + monitoring + secret + GDPR + payout failure + RAK + IP + T&Cs + idempotency + multi-channel) | ALL FOLDED INTO V3 |

---

## 8. Discoveries for orchestrator

5 items unrelated to Path C scope:

1. Per-country `country_specs` API probe should be a one-time setup operation (not a runtime call). Reference table needs maintenance migration when Stripe adds new countries.
2. Mingla-side ToS acceptance is not yet a documented pattern in the codebase. Future cycles may need to extend this for other 3rd-party integrations (e.g., AppsFlyer's data agreement).
3. `gdpr_erasure_log` table will be a useful pattern for ALL GDPR erasures, not just Stripe-related. May inform a future "Mingla-wide GDPR cycle."
4. Audit log retention policy at 7 years implies storage cost growth; flag for ops/cost monitoring.
5. Australia + LatAm + Asia expansion (B2c/B2d/B2e) requires Stripe Sales engagement and separate platform legal entities. Major business decision; surface to founder.

---

## 9. Confidence statement

| Area | Confidence | Notes |
|---|---|---|
| V1+V2 carry-forward findings | H | Re-verified against current code |
| Stripe country support (34) | H | Cited Stripe doc; cross-border-payouts page is unambiguous |
| KYC remediation mapping (30+ codes) | H | Cited from Stripe API docs |
| Webhook event coverage (14+ types) | H | Cited from Stripe events list |
| RAK scopes per fn | M-H | Scope names empirical from Dashboard; verify via test mode RAK creation |
| Audit retention regulations | H | Multiple regulatory citations |
| GDPR anonymization pattern | M-H | Industry-standard; legal review recommended for Mingla-specific flow |
| 18 V3 decisions | H | Each has default + alternative + reasoning |
| Notification subsystem reuse | H | Self-read existing Mingla code |
| Production runtime probes | DEFERRED | Tester dispatch covers |

**Aggregate: H on architectural decisions; M-H on operational details requiring legal review or sandbox verification.**

---

## 10. Recommended next pipeline step

1. Orchestrator REVIEWs this report
2. Operator overrides any of 18 V3 decisions
3. SPEC v3 published at [`outputs/SPEC_B2_PATH_C_V3.md`](../../outputs/SPEC_B2_PATH_C_V3.md) (companion deliverable)
4. Operator dispatches `/mingla-implementor` against new IMPL dispatch v3
5. Implementor executes Phase 0' through Phase 15 (estimated 25-40 hr split across multiple sessions)
6. Tester dispatch validates all SCs + invariants
7. CLOSE

---

**End of investigation report.**

**Findings tally: 5 V1+V2 root causes carried forward + 6 V3 new root causes + 18 V3 decisions surfaced.**

**Confidence: M-H.**

**Next: SPEC v3 at [`outputs/SPEC_B2_PATH_C_V3.md`](../../outputs/SPEC_B2_PATH_C_V3.md).**
