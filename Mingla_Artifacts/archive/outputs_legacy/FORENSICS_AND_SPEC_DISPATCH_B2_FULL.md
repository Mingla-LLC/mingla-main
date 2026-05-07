# Forensics + SPEC dispatch — Cycle B2a Path C V3 (FULL battle-tested scope)

**Skill to invoke:** `/mingla-forensics` in **INVESTIGATE-THEN-SPEC (IA) mode**
**Mode:** dual-output — produces both investigation report AND SPEC v3
**Estimated effort:** 8-14 hours (investigation 4-6h; SPEC authoring 4-8h)
**Branch under examination:** `Seth` (current) — Phase 0 committed (`cf3969bf` + `cfb121e8`); Phase 0' + 0'' + 1-9 not yet implemented
**Reference branch:** `feat/b2-stripe-connect` worktree at `/tmp/mingla-b2-comparison/tao-b2/` HEAD `1039a1c3` (read-only)
**Operator goal (verbatim):** *"I want one battle tested spec so we can implement"* — covering Stripe Connect onboarding through payouts through dispute-prep, with multi-country expansion (UK + EU + North America + South America + everywhere Stripe supports), production-grade UX, security best practices, GDPR compliance, and operational monitoring.

**Output files:**
1. `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md`
2. `outputs/SPEC_B2_PATH_C_V3.md` — supersedes [outputs/SPEC_B2_PATH_C_V2.md](SPEC_B2_PATH_C_V2.md)

**Status post-dispatch:** SPEC v3 lock unblocks IMPL dispatch v3 → operator runs `/mingla-implementor` against new SPEC.

---

## §0 — Why this dispatch exists

Tonight's pipeline produced 4 artifacts in sequence:
1. SPEC v1 (orchestrator-authored; brittle — multiple SPEC contradictions)
2. Forensics audit V1 (caught DEC-numbering + I-PROPOSED-J letter collisions; surfaced trigger gap + webhook replay bug + reactivation gap)
3. SPEC v2 (orchestrator-authored; addresses V1 forensics findings)
4. Stripe best-practices audit (surfaces 8 additional gaps + 8 amendments — RAKs, IP allowlist, external_account events, etc.)

Operator instruction: roll **everything** — V1 forensics findings + V2 amendments + best-practices audit gaps + 12 previously-deferred follow-ups + multi-country expansion + new GDPR/monitoring/notification scope — into ONE airtight investigation + SPEC v3.

**The operator wants no follow-up cycles.** SPEC v3 should cover the production-grade marketplace platform end-to-end. Future cycles (B3 Checkout, B4 Scanner) will then build ON TOP of a complete B2 foundation, not retrofit gaps.

**Phase 0 commits stay.** Foundation work is sound. SPEC v3 builds Phase 0' + 0'' + revised 1-9.

---

## §1 — Mission (INVESTIGATE deliverables)

Produce `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md` answering:

### 1.1 — Multi-country expansion research

**Operator's biggest ask.** Cite Stripe documentation for every claim.

For each of the following country categories, enumerate exactly which Stripe Connect supports for our controller-property setup (`losses.payments=application`, `fees.payer=application`, `stripe_dashboard.type=express`, `requirement_collection=stripe`):

- **UK + EU (EEA)** — UK + 27 EU member states + Iceland + Norway + Liechtenstein + Switzerland
- **North America** — US + Canada + Mexico
- **South America** — Brazil + Argentina + Chile + Colombia + Peru + others Stripe supports

For each country list:
- Supported (Y/N) for our controller setup
- Default currency / accepted currencies
- Express dashboard available (Y/N)
- KYC requirements form (which fields collected)
- Tax form Stripe handles (1099-K US, P11D UK, etc.)
- Bank account format (IBAN, ABA routing, sort code, BSB, etc.) + validation regex
- Business types supported (sole proprietor, LLC, corporation, etc.)
- Onboarding language support
- Localization gotchas (e.g., Brazil's CPF/CNPJ requirement; Mexico's RFC; etc.)
- Stripe-side limitations (e.g., balance transfers between certain currencies require specific configurations)

**Source-of-truth reference:**
- https://stripe.com/global (country list)
- https://docs.stripe.com/connect/cross-border-payouts (cross-border)
- https://docs.stripe.com/connect/required-verification-information (KYC per country)
- https://docs.stripe.com/connect/identity-verification-api (verification)

### 1.2 — KYC remediation UI deep dive

For every value of `requirements.disabled_reason` and `requirements.currently_due[]` Stripe documents, produce a mapping:

| Stripe field/value | What it means | What the brand admin must do | UI copy (plain English) | Stripe API call to resolve |
|---|---|---|---|---|

Include all 30+ documented `disabled_reason` codes (from https://docs.stripe.com/api/accounts/object#account_object-requirements-disabled_reason) and the major `currently_due` field names (e.g., `individual.verification.document.front`, `business_profile.url`, `external_account`, etc.).

### 1.3 — Deadline warning system research

Stripe's `requirements.current_deadline` field contains a Unix timestamp by which `currently_due` items must be resolved or the account flips to restricted.

Investigate:
- Webhook event when `current_deadline` is set/changed
- Polling cadence to check deadline (already 30s via refresh-status)
- Notification windows (7 days, 3 days, 1 day, 1 hour before deadline?)
- Multi-channel delivery (email via Resend; push via OneSignal; in-app)
- Timezone handling (deadline is UTC; brand admin's timezone; per-country business hours)

Source-of-truth: https://docs.stripe.com/connect/handle-onboarding-failure

### 1.4 — Bank verification status surface

`account.external_accounts[]` returns connected bank accounts. Each has:
- `status` field (`verified`, `verification_failed`, `errored`, etc.)
- `last4` / `routing_number` / `iban` / `account_holder_name`
- Country-specific validation status

Investigate:
- Webhook events on external_account state changes (`account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`)
- UI states needed: verified, verification-pending, verification-failed, deleted
- "Re-verify your bank account" CTA flow
- Stripe API to add/remove/replace external accounts (do we expose this in Mingla, or rely on Stripe-hosted onboarding?)

### 1.5 — Detached refund reconciliation

When a brand detaches but has in-flight refunds, those refunds continue to process Stripe-side but Mingla loses visibility.

Investigate:
- `charge.refund.updated` webhook event behavior on detached accounts
- Whether Stripe still fires webhooks for detached accounts (likely YES until account is also deleted Stripe-side)
- UI "Orphaned refunds — historical record" section design
- Audit log retention for detached account history

### 1.6 — Webhook delivery monitoring

Investigate:
- Stripe Dashboard's webhook delivery view (manual operator check)
- Programmatic monitoring: heartbeat / synthetic event approach
- "No webhook in N hours" alerting threshold (1h? 6h? 24h?)
- Multi-channel alert delivery (Resend email to ops; OneSignal push; Slack via webhook)
- Self-monitoring: cron job that queries `payment_webhook_events` for recency

### 1.7 — Webhook secret rotation procedure

Stripe supports having multiple active webhook signing secrets during rotation windows. Investigate:
- Stripe API/Dashboard procedure for rotating webhook secrets
- Code support for accepting EITHER current OR previous secret during rotation window (both signatures verify)
- Runbook with exact step-by-step
- Rotation cadence (quarterly? annually? on personnel change?)

Source-of-truth: https://docs.stripe.com/webhooks/signatures (signature rotation)

### 1.8 — Audit log retention + GDPR

Mingla's `audit_log` table grows unbounded today. Investigate:
- Required retention for financial records (typically 7 years US; 6 years UK)
- GDPR right-to-be-forgotten flow when a brand admin departs
  - What data must be deleted vs anonymized vs retained
  - How to nullify `user_id` references in audit_log without breaking integrity
- Data subject access requests (DSARs) — how brand admin requests their data
- Audit log archival strategy (S3 cold storage + monthly export?)

### 1.9 — Payout failure brand notifications

When `payout.failed` fires, the brand must know. Investigate:
- Failure reason codes from Stripe (`failure_code` field on Payout object)
- Mapping to user-friendly remediation messaging
- Multi-channel delivery (email + push + in-app)
- Retry vs manual-fix decision tree (some failures are auto-retried by Stripe; some require brand intervention)

Source-of-truth: https://docs.stripe.com/payouts (failure handling)

### 1.10 — RAK (Restricted API Key) migration

Currently Mingla uses ONE full secret key for all 6 edge functions. Per Stripe's #1 security recommendation, migrate to RAKs with least-privilege per function.

Investigate:
- Required scopes per edge function (cite Stripe API permission docs):
  - `brand-stripe-onboard`: `accounts:write`, `account_sessions:write`
  - `stripe-webhook`: (no API calls in current scope; signature verification only)
  - `brand-stripe-refresh-status`: `accounts:read`
  - `brand-stripe-detach`: `accounts:write`
  - `brand-stripe-balances`: `balance:read`
  - `stripe-kyc-stall-reminder`: `accounts:read`
- RAK creation procedure (Stripe Dashboard → Developers → Restricted Keys)
- Migration sequence: create RAKs in test mode → verify → create live RAKs → swap env vars → rotate full key out
- Rollback plan if a RAK has insufficient scope

### 1.11 — Webhook IP allowlist

Stripe publishes webhook IP ranges. Investigate:
- Current Stripe IP range list (https://docs.stripe.com/ips)
- Refresh cadence (Stripe rotates IPs over time)
- Implementation: middleware in `stripe-webhook/index.ts` post-signature verification
- Fallback if Stripe IP list refresh fails (allow OR deny by default?)

### 1.12 — Multi-channel notification system (cross-cutting)

Several of the above (1.3, 1.4, 1.6, 1.9) need brand-admin notifications. Investigate as a unified subsystem:
- Existing Resend integration in Mingla
- OneSignal push notification (mobile + web push)
- In-app notification persistence (a `notifications` table or similar)
- Notification preferences per brand admin (opt-in/out per channel)
- Quiet-hours respect

### 1.13 — Connect Platform Agreement T&Cs

Per Stripe Connect Platform Agreement, Mingla as platform must surface specific disclosures to connected accounts (brand admins). Investigate:
- Required disclosure language per Stripe legal
- Where Mingla currently surfaces T&Cs (signup flow? onboarding flow?)
- Whether disclosures must be acknowledged at every onboarding (or once-per-brand-admin)
- Multi-language T&Cs for international brands

Source-of-truth: https://stripe.com/legal/connect-account

### 1.14 — Idempotency-Key sub-millisecond collision

Forensics V2 CF-2: theoretical sub-ms collision risk. Investigate:
- Real-world frequency (low, but quantify)
- Fix options: nanosecond precision; UUID suffix; hash of request body
- Trade-off with debuggability (random suffix is harder to trace than epoch)

### 1.15 — Schema column rename: `account_type`

Forensics audit C18: `stripe_connect_accounts.account_type` column stores "express" as if Stripe legacy account type. Per Stripe docs, terminology drift. Investigate:
- Migration to rename column (e.g., `controller_dashboard_type` or simply remove since derivable from controller config)
- Backfill strategy
- Code references to update

### 1.16 — Re-verify ALL findings from prior audits

Forensics V2 (5 root causes + 8 contributing + 10 hidden + 6 obs) and Stripe best-practices audit (8 amendments + 8 additional gaps) should be re-verified against current code state (post Phase 0 commits). Anything that was caught and fixed in Phase 0 should be marked CLOSED; anything still open should be re-classified.

### 1.17 — Constitutional compliance scorecard (re-run)

All 14 Mingla Constitutional principles, both branches, with verdicts. Should be more thorough than V1 audit (which had some N/A and UNVERIFIED).

### 1.18 — Production go-live checklist alignment

Run our SPEC v3 plan against Stripe's published Go Live Checklist (https://docs.stripe.com/get-started/checklist/go-live). Gaps become SPEC items.

---

## §2 — Mission (SPEC v3 deliverables)

Produce `outputs/SPEC_B2_PATH_C_V3.md` per the spec template at `references/spec-template.md`. SPEC v3 must be **airtight, battle-tested, and implementor-ready**.

### 2.1 — Required sections (all mandatory)

1. **Why V3 exists** — supersedes V2; cite forensics findings
2. **Locked decisions** — all V2 decisions PLUS new V3 decisions for:
   - Multi-country country list (which subset of Stripe's supported countries we onboard)
   - KYC remediation messaging library (canonical mapping table)
   - Deadline warning thresholds (which days before deadline; which channels)
   - Bank verification UI states + flow
   - Detached refund reconciliation policy (retain forever? archive after N years?)
   - Webhook delivery monitoring threshold (1h? 6h?)
   - Webhook secret rotation cadence (quarterly?)
   - Audit log retention policy (7 years for financial records)
   - Notification subsystem (Resend + OneSignal + in-app `notifications` table)
   - Payout failure messaging library
   - RAK scoping per edge function
   - IP allowlist enforcement (signature-then-IP order)
   - T&Cs surfacing pattern
   - Idempotency-Key collision fix (nanosecond OR UUID suffix)
   - `account_type` column rename or removal
3. **Scope** — comprehensive in-scope list; explicit out-of-scope (B3 Checkout, B4 Scanner, etc.)
4. **File manifest** — KEEP (current Seth files), ADD (new files), MODIFY (existing files), DROP (anything to remove)
5. **Invariants** — existing 5 (O/P/Q/R/S) + any new ones needed (e.g., I-PROPOSED-T multi-country country code allowlist; I-PROPOSED-U mandatory T&Cs acknowledgment)
6. **Behavioral contracts per file** — every new edge function, every new component, every new migration, with full success/error contracts
7. **Implementation phasing** — Phase 0 (committed) / Phase 0' (trigger fix + revoke anon) / Phase 0'' (RAKs migration) / Phase 0''' (multi-country migration) / Phase 1-N (new functions and components) / Phase N+1 (operator smoke) / Phase N+2 (tester) / Phase N+3 (CLOSE)
8. **Migration ordering** — every new migration in chronological order with conflict analysis
9. **Test plan summary** — total SCs revised; unit + integration + E2E coverage; new test files
10. **Discoveries to disposition at CLOSE**
11. **Risk register** — every risk with mitigation
12. **Confidence statement** — per-section H/M/L

### 2.2 — Multi-country requirements (binding)

For every country chosen, SPEC v3 must define:

- Country code (ISO 3166-1 alpha-2)
- Supported currencies (ISO 4217)
- Default currency for new brands in that country
- Mingla onboarding language (English only OR localized per country)
- Bank account format expected (with regex validation if applicable)
- Business types Stripe supports
- Tax form Stripe handles
- KYC requirement variants (some countries have additional fields)

The frontend component `BrandOnboardView` must:
- Show country picker on first onboarding (default = brand's billing country if available)
- Validate country selection against supported list
- Display per-country currency hint
- Surface country-specific KYC requirements messaging

The backend `brand-stripe-onboard` edge fn must:
- Accept `country` param in addition to existing fields
- Validate against allowlist (I-PROPOSED-T)
- Pass `country` + `default_currency` to Stripe `accounts.create`

The schema migration must:
- Add `stripe_connect_accounts.country` column (ISO 3166-1 alpha-2)
- Add `stripe_connect_accounts.default_currency` column (ISO 4217)
- Backfill existing rows (currently UK-only) with `country='GB'`, `default_currency='GBP'`
- Add CHECK constraint enforcing country allowlist

### 2.3 — Notification subsystem (binding)

SPEC v3 must define:

- A `notifications` table schema (id, user_id, brand_id, channel, type, title, body, deep_link, read_at, created_at)
- A `notification_preferences` table (per user × per channel × per type opt-in/out)
- Edge function `dispatch-notification` that fans out via Resend + OneSignal + in-app row insert
- Templates for all notification types (deadline warning, bank verification fail, payout fail, deauthorize)
- Quiet-hours logic (per brand admin's timezone)
- Unsubscribe flow

This is a non-trivial subsystem. SPEC v3 must decide if it's part of B2 cycle OR a prerequisite cycle.

### 2.4 — Webhook event coverage (binding)

V3 webhook router must handle:

| Event | Source-of-truth scope | Comment |
|---|---|---|
| `account.updated` | V2 | Existing — already specified |
| `account.application.deauthorized` | V2 | Existing |
| `account.external_account.created` | V3 NEW | Bank account added |
| `account.external_account.updated` | V3 NEW | Bank verification status change |
| `account.external_account.deleted` | V3 NEW | Bank account removed |
| `payout.created` | V2 | Existing |
| `payout.paid` | V2 | Existing |
| `payout.failed` | V2 | Existing — but V3 wires brand notification |
| `payout.canceled` | V2 | Existing |
| `capability.updated` | V2 | Existing |
| `charge.refund.updated` | V3 NEW | Detached refund reconciliation |
| `account.requirements.updated` | V3 NEW | Surface new currently_due to UI |
| (B3 scope, flag only) `charge.dispute.*` | DEFERRED to B3 | Out of B2 scope; flag |

### 2.5 — Test plan coverage (binding)

V3 must specify:
- Unit tests per new function (~40+ jest tests total estimated)
- Deno tests per webhook handler (12 event types × ~3 cases each = ~36 cases)
- Integration tests for multi-country onboarding (1 per supported country)
- E2E smoke for critical paths (UK happy path; US happy path; deadline warning; bank verification fail; payout fail; reactivation; detach + reconnect)
- Constitutional compliance test suite

---

## §3 — Mandatory reads (no exceptions)

Read every file listed before forming any conclusion.

### Code under audit (Seth's branch — current state)

[List from forensics V1 dispatch §3 — same files; re-verify post-Phase-0]

### New code surfaces to investigate (don't yet exist; design for them)

- A `notifications/` table + `dispatch-notification` edge fn pattern
- A `country_allowlist` schema constraint
- A `payment_webhook_events.last_event_at` view or aggregate query for monitoring
- A `webhook_secret_rotation_window` config table (current + previous secret + rotation_started_at)
- An `audit_log` archival strategy (procedure or scheduled migration)

### Stripe documentation (read deeply)

- Connect Accounts v2: https://docs.stripe.com/connect/accounts-v2
- Country support: https://stripe.com/global
- Connect cross-border: https://docs.stripe.com/connect/cross-border-payouts
- Required verification per country: https://docs.stripe.com/connect/required-verification-information
- Identity verification API: https://docs.stripe.com/connect/identity-verification-api
- Account requirements + disabled reasons: https://docs.stripe.com/api/accounts/object
- Onboarding failure handling: https://docs.stripe.com/connect/handle-onboarding-failure
- External accounts: https://docs.stripe.com/api/external_accounts
- Bank account verification: https://docs.stripe.com/connect/payouts-bank-accounts
- Webhooks: https://docs.stripe.com/webhooks
- Webhook signatures + rotation: https://docs.stripe.com/webhooks/signatures
- Webhook IP ranges: https://docs.stripe.com/ips
- Restricted API keys: https://docs.stripe.com/keys/restricted-api-keys
- API key best practices: https://docs.stripe.com/keys-best-practices
- Connect Platform Agreement: https://stripe.com/legal/connect-account
- Tax reporting: https://docs.stripe.com/connect/tax-reporting
- Payouts: https://docs.stripe.com/payouts
- Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Go Live Checklist: https://docs.stripe.com/get-started/checklist/go-live

---

## §4 — Investigation threads (extends V2 audit's 16; adds 12 new)

From V2 forensics audit, threads 1-16. Re-verify against current codebase + extend.

### V3 NEW threads:

**Thread 17 — Multi-country expansion deep dive (per §1.1)**

**Thread 18 — KYC remediation messaging mapping (per §1.2)**

**Thread 19 — Deadline warning system design (per §1.3)**

**Thread 20 — Bank verification + external_account events (per §1.4)**

**Thread 21 — Detached refund reconciliation (per §1.5)**

**Thread 22 — Webhook delivery monitoring design (per §1.6)**

**Thread 23 — Webhook secret rotation procedure (per §1.7)**

**Thread 24 — Audit log retention + GDPR (per §1.8)**

**Thread 25 — Payout failure brand notifications (per §1.9)**

**Thread 26 — RAK migration design (per §1.10)**

**Thread 27 — IP allowlist implementation (per §1.11)**

**Thread 28 — Multi-channel notification subsystem (per §1.12)**

**Thread 29 — T&Cs disclosure pattern (per §1.13)**

**Thread 30 — Production go-live checklist alignment (per §1.18)**

For each thread: produce findings, cite Stripe documentation, flag gaps in current implementation, surface decisions for SPEC v3 author.

---

## §5 — Five-truth-layer (extended for V3 surfaces)

Apply the 5-layer matrix (Docs / Schema / Code / Runtime / Data) to every new V3 surface:

- Multi-country onboarding
- KYC remediation UI
- Deadline warnings
- Bank verification surface
- Detached refund reconciliation
- Webhook monitoring
- Secret rotation
- Audit log retention
- Payout failure notifications
- RAK security posture
- IP allowlist
- Notification subsystem
- T&Cs disclosure

For each: identify contradictions between layers; surface them in the investigation report.

---

## §6 — Hidden-flaw checklist (apply per surface)

For every new file SPEC v3 will introduce (estimated ~25-30 new files), pre-evaluate the 16-item hidden-flaw checklist as part of the SPEC's behavioral contracts. If a hidden flaw is structurally hard to avoid, it must be addressed by an invariant + CI gate.

---

## §7 — Country support research plan (binding output for SPEC v3)

Produce a comprehensive table:

| Country (ISO 3166-1) | Stripe Connect support | Express dashboard | Default currency | Other accepted currencies | Tax form | Bank format | Business types | Onboarding lang | Special notes |
|---|---|---|---|---|---|---|---|---|---|

**Minimum target:** UK + 27 EU + Iceland + Norway + Switzerland + US + Canada + Mexico + Brazil + Argentina + Chile + Colombia (35+ countries).

**Decision deliverable for SPEC v3:** which subset of Stripe-supported countries Mingla onboards in V3 vs deferred to B2c. Operator preference: as many as possible.

---

## §8 — Output structure (the actual deliverables)

### Investigation report — `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md`

Structure (mandatory sections):

1. Header (cycle, mode, branches, dates, commits)
2. Executive verdict (≤10 lines)
3. Five-truth-layer contradiction matrix (extended)
4. Constitutional compliance scorecard (re-run; both branches)
5. Invariant compliance scorecard
6. Hidden-flaw checklist results per surface
7. Threads 1-30 findings (with H/M/L confidence + citations)
8. Country support research table (per §7)
9. KYC remediation messaging mapping (per §1.2)
10. Stripe events comprehensive map (per §2.4)
11. Notification subsystem design (per §2.3)
12. Audit log retention + GDPR strategy (per §1.8)
13. Webhook secret rotation runbook (per §1.7)
14. RAK scoping per edge function (per §1.10)
15. T&Cs disclosure compliance gaps (per §1.13)
16. Production go-live checklist alignment (per §1.18)
17. Architectural verdict on V3 scope
18. Decisions surfaced for SPEC v3 author (estimated 30+ decisions)
19. Prior-work corrections (V1 + V2 forensics + best-practices audit; mark CLOSED items)
20. Discoveries for orchestrator
21. Confidence statement (per-section H/M/L)

### SPEC v3 — `outputs/SPEC_B2_PATH_C_V3.md`

Structure (mandatory sections per §2.1).

Bound to investigation findings — every claim cited.

### SUPERSEDED notice on prior artifacts

Update headers of `outputs/SPEC_B2_PATH_C_AMENDMENT.md` (V1) + `outputs/SPEC_B2_PATH_C_V2.md` (V2) with: `**SUPERSEDED by outputs/SPEC_B2_PATH_C_V3.md as of <date>**`.

---

## §9 — Constraints (non-negotiable)

1. **Read every file in §3 + every Stripe doc URL listed.** No skimming. No assumptions about country support; verify each.
2. **Cite Stripe documentation for every claim.** Format: `[claim text](https://docs.stripe.com/...)`. No uncited claims.
3. **Produce both deliverables (investigation + SPEC).** This is IA mode; both are required.
4. **No code changes.** Even "while you're at it" cleanups are forbidden. SPEC v3 is the contract; implementor executes.
5. **No new agent dispatches.** This is your work; don't delegate to other skills.
6. **Skepticism toward prior partial artifacts.** Re-verify every load-bearing claim from V1 forensics + V2 SPEC + best-practices audit. Where you find a claim wrong, flag it under "Prior-work corrections."
7. **Preserve Phase 0 commits.** SPEC v3 builds on `cf3969bf` + `cfb121e8` foundation; doesn't unwind them.
8. **Operator-overridable defaults.** Every V3 decision should have a default + 1-2 alternatives + reasoning. Operator may override at SPEC v3 review.
9. **Battle-tested SPEC.** No phantom files, no untested invariants, no ambiguous behavioral contracts. The implementor must be able to execute SPEC v3 without asking clarifying questions.
10. **No SPEC v4 anticipated.** Work done in V3 should be exhaustive enough that the only later cycles are B2c (RN native SDK upgrade) + B3 (Checkout) + B4 (Scanner) — not B2 follow-ups.
11. **Acknowledge runtime probes deferred.** Code-rigorous + Stripe-docs-rigorous audit is sufficient at this stage; runtime probes happen at tester dispatch.
12. **No new memory files.** Surface insights under "Discoveries for orchestrator." Orchestrator owns memory updates at CLOSE.

---

## §10 — Cross-references

- V1 forensics audit: [`Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_AUDIT.md`](../../reports/INVESTIGATION_B2_PATH_C_AUDIT.md)
- V1 SPEC: [`outputs/SPEC_B2_PATH_C_AMENDMENT.md`](SPEC_B2_PATH_C_AMENDMENT.md) — to be marked SUPERSEDED
- V2 SPEC: [`outputs/SPEC_B2_PATH_C_V2.md`](SPEC_B2_PATH_C_V2.md) — to be marked SUPERSEDED
- Stripe best-practices audit: [`Mingla_Artifacts/reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md`](../../reports/STRIPE_BEST_PRACTICES_AUDIT_B2_PATH_C_V2.md)
- Phase 0 IMPL report: [`Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md`](../../reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md)
- B2 baseline forensics: [`Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md`](../../reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md)
- D-B2-23 SDK spike: [`Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md`](../../reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md)
- ORCH-0742 SPEC (cross-cycle context): [`Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](../../specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md)
- INVARIANT_REGISTRY: [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../../INVARIANT_REGISTRY.md)
- Stripe best-practices skill: `~/.claude/skills/stripe-best-practices/`
- Stripe Connect docs (top-level): https://docs.stripe.com/connect
- Reference worktree (Tao's branch): `/tmp/mingla-b2-comparison/tao-b2/`

---

## §11 — Estimated SPEC v3 size

Based on scope expansion vs V2:

| V2 scope | V3 expansion |
|---|---|
| 33 SCs | 70-90 SCs (estimated; doubles minimum) |
| 5 invariants | 7-9 invariants (V2 + I-PROPOSED-T multi-country + I-PROPOSED-U T&Cs + maybe I-PROPOSED-V notification preferences) |
| 12 phases | 18-22 phases (V2 + Phase 0''' multi-country + Phase 0'''' RAKs + Phase 0''''' notifications subsystem + new functions + new tests) |
| ~30 file additions | ~60-80 file additions |
| ~3 migrations | ~8-10 migrations |

**Estimated SPEC v3 length:** 2,000-3,000 lines of binding contract. **Estimated investigation report:** 800-1,200 lines of evidence.

This is not a small spec. **The operator wants it battle-tested. The cost is length.**

---

## §12 — Recommended pipeline post-SPEC-v3

1. **Forensics agent runs IA mode** → produces investigation + SPEC v3
2. **Operator dispatches** `/mingla-forensics` — copy this dispatch verbatim
3. **Forensics returns** — orchestrator reviews per 10-point checklist
4. **Operator + orchestrator review SPEC v3** — operator may override default decisions
5. **Orchestrator authors implementor dispatch v3** — `outputs/IMPL_DISPATCH_B2_PATH_C_V3.md`
6. **Operator dispatches** `/mingla-implementor` — implementor executes phases
7. **Phases 1-N** (likely 18-22 phases; could be split across multiple implementor sessions)
8. **Operator-side smoke** — multi-country happy paths (UK, US, EU, etc.)
9. **Tester dispatch** — `/mingla-tester` against IMPL report
10. **CLOSE protocol** — DEC lock + invariant ratifications + 7-artifact SYNC + EAS OTA

---

**End of dispatch.**

When operator dispatches this prompt, agent's outputs go to:
1. `Mingla_Artifacts/reports/INVESTIGATION_B2_PATH_C_V3_FULL_AUDIT.md`
2. `outputs/SPEC_B2_PATH_C_V3.md`

After both are produced, orchestrator REVIEWs and signals next pipeline step.

**Phase 0 commits stay.** SPEC v3 supersedes V1 + V2 SPECs but builds on Phase 0 foundation.

**B2c + B3 + B4 are explicitly OUT OF SCOPE for V3.** SPEC v3 closes the B2 cycle comprehensively so future cycles build on a complete foundation.
