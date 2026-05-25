# SPEC — ORCH-0956 [Stripe ops alerts → email]

**Mode:** SPEC (binding contract for implementor + tester).
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0956-[stripe-ops-alerts-email]/` on branch `ORCH-0956-stripe-ops-alerts-email` (rebased onto `main` containing merged ORCH-0953 [Stripe live-mode cutover] commit `44c643c0`).
**Severity:** S2-medium (operator visibility improvement; not a launch blocker).
**Classification:** missing-feature + quality-gap.

---

## Phase 1 — Ingest the investigation

This SPEC is built on `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md`. All six open product questions from the investigation are now answered by Seth (operator-locked 2026-05-25):

1. **Event-type scope:** `charge.dispute.created` + `charge.dispute.closed` with `status: "lost"`. NOT `charge.dispute.updated`.
2. **Subject richness:** rich — brand name + amount + evidence-due-days (created) / amount + brand name (closed-lost). Costs one DB lookup of `brands.name`.
3. **Body content depth:** `generic_notification` Resend variant with structured paragraphs + Stripe Dashboard link as CTA.
4. **Recipient fan-out:** loop POSTs (one per recipient), trim + lowercase + dedupe via `new Set`.
5. **Idempotency surface:** email-only. No `notifications` table dual-write. Idempotency key is a stable log-only identifier.
6. **Branch strategy:** wait-for-merge + rebase (executed 2026-05-25).

The investigation's "Fix strategy" direction (introduce `_shared/stripeOpsAlertEmail.ts`, keep DI seam) is adopted unchanged.

---

## Phase 2 — Scope and non-goals

### Scope (in)

1. **New shared helper** `supabase/functions/_shared/stripeOpsAlertEmail.ts` that exposes a single `sendOpsAlertEmail` function. It wraps the canonical `EMAIL_SENDERS.system` + `renderTransactionalEmail({ variant: "generic_notification" })` + direct `fetch("https://api.resend.com/emails", …)` POST pattern used by `venue-claim-submitted-email`. Loop POST per recipient. Returns a count of successful sends.
2. **Swap site #1:** `supabase/functions/_shared/stripeDisputeHandlers.ts` — modify `alertDisputeCreated` (lines 111–141) to read `STRIPE_DISPUTE_ALERT_EMAILS` (replaces `STRIPE_DISPUTE_ALERT_USERS`) and call `sendOpsAlertEmail` with the rich subject + paragraphs. Add a NEW alert call for `charge.dispute.closed` with `status: "lost"` — wired from `handleChargeDispute` line 247-ish where the AppsFlyer `dispute_lost` event already fires.
3. **Swap site #2:** `supabase/functions/stripe-webhook/index.ts` — modify `notifyWebhookSignatureFailure` (lines 33–58) to read `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` (replaces `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`) and call `sendOpsAlertEmail` with a signature-failure subject + body.
4. **Env-var rename:**
   - `STRIPE_DISPUTE_ALERT_USERS` → `STRIPE_DISPUTE_ALERT_EMAILS` (comma-separated email allowlist)
   - `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` → `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` (comma-separated email allowlist)
   - The legacy `*_USERS` names are removed from code in the same PR. Seth removes them from Supabase project secrets at his pace post-merge.
5. **DI-seam update:** `DisputeHandlerEffects` interface gains `sendOpsAlertEmail: typeof sendOpsAlertEmail` and loses `dispatchNotification: typeof dispatchNotification`. The webhook signature-failure path adopts the analogous DI shape (the existing `effect` parameter becomes `sendOpsAlertEmail`).
6. **Test fixtures:** `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` updated to mock `sendOpsAlertEmail` instead of `dispatchNotification`, assert subject + paragraphs + recipient count on `created`, assert ZERO calls on `updated`, assert exactly one call per recipient on `closed`-with-`status:"lost"`. New parallel test file for the webhook signature-failure happy path (new file or extend existing `stripe-webhook` tests — implementor picks).
7. **Brand-name lookup:** when the dispute payload resolves a `brand_id`, fetch `brands.name` via `supabase.from("brands").select("name").eq("id", brandId).maybeSingle()` and use it in the subject. If `brand_id` is null OR the lookup returns null/error, fall back to the literal string `"unknown brand"` in the subject — log a warning, do not throw.
8. **Stripe Dashboard URL:** for created/closed-lost alerts, generate `https://dashboard.stripe.com/disputes/{disputeId}` when the dispute payload's `livemode === true`, else `https://dashboard.stripe.com/test/disputes/{disputeId}`. Pass as `cta: { label: "Open in Stripe Dashboard", url }` to `renderGenericBody` (via `renderTransactionalEmail`).

### Non-goals (out of scope)

- `charge.dispute.updated` does NOT trigger an alert (noisy during evidence period — explicit operator decision).
- No Slack alerts. No SMS alerts. No per-brand notification preferences (operator alerts only).
- No new DB migration. No `stripe_disputes` schema changes. No new `notifications` table rows from these paths.
- No changes to OneSignal `dispatchNotification` callers OUTSIDE these two swap sites: `brand-stripe-detach`, `stripe-webhook-health-check`, `stripeWebhookRouter` (KYC + settlement), and `stripe-kyc-stall-reminder` are untouched.
- No new email template variant — re-use the existing `generic_notification`.
- No HTML email branding work (logos, custom typography) — `renderShell` already wraps everything in the Mingla brand shell.
- No tests for the rendered HTML output (the `generic_notification` shell renderer is already covered by ORCH-0785 tests).

### Assumptions

- The merged ORCH-0953 code in `supabase/functions/_shared/stripeDisputeHandlers.ts` and `supabase/functions/stripe-webhook/index.ts` is the authoritative pre-swap state. (Verified by `git log` post-rebase — `44c643c0` is the merge commit.)
- `RESEND_API_KEY`, `MINGLA_LOGO_URL`, `MINGLA_FOOTER_ADDRESS`, `SUPPORT_EMAIL` are already configured in production Supabase project secrets (assumed from 7 existing Resend callers).
- The `brands` table has a `name` column accessible to service-role queries (verified by existing `_shared/` consumers).
- The `livemode` boolean on Stripe dispute payloads is canonically present (Stripe API contract).
- No active live disputes exist at merge time (per ORCH-0953 Phase E memo), so the swap is non-disruptive — no in-flight alert delivery to break.

---

## Phase 2.5 — Cross-Surface Impact

| Surface | In scope? | Behavior |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | **NO** | Backend-only — no client code touched. No surface impact. |
| Consumer Android (`app-mobile/` Android) | **NO** | Same as above. |
| Buyer/anonymous Web (`mingla-business/` buyer routes) | **NO** | No buyer-facing path touched. Disputes are operator-internal. |
| Business iOS (`mingla-business/` iOS) | **NO** | No business-app code touched. Business owners do not receive Stripe ops alerts (only Mingla operator does). |
| Business Android (`mingla-business/` Android) | **NO** | Same as above. |
| Admin Web (`mingla-admin/`) — adjacent | **NO** | No admin UI touched. Admin already has a Stripe Disputes view (via ORCH-0953); this ORCH does not modify it. |
| Business Web preview (`mingla-business/` dev/web) | **NO** | Same as buyer/business surfaces. |

**Declared scope:** backend-only — no client surface. **No `[deploy]` tag at CLOSE commit** (no Vercel build target). Parity-enforcement at TEST is N/A across all 7 surfaces — tester verifies via Deno unit tests + edge-function runtime probe only.

---

## Phase 3 — Layer specifications

### Edge function layer

#### New file: `supabase/functions/_shared/stripeOpsAlertEmail.ts`

```ts
// ORCH-0956 — Shared helper for Stripe operator alerts via Resend email.
// Replaces the prior OneSignal push path for dispute + webhook-signature-failure
// alerts. See SPEC_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md.

import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "./email/index.ts";

export interface OpsAlertEmailInput {
  subject: string;          // Becomes both the email subject and the body H1.
  paragraphs: string[];     // One paragraph per array entry; rendered top-to-bottom.
  recipients: string[];     // Raw env-var-derived list; this helper normalizes.
  cta?: { label: string; url: string } | null; // Optional CTA button (e.g. Stripe Dashboard).
}

export interface OpsAlertEmailResult {
  attempted: number;        // Recipient count after normalize + dedupe.
  succeeded: number;        // Resend POSTs that returned 2xx.
  failed: number;           // Resend POSTs that returned non-2xx or threw.
}

const RESEND_API_URL = "https://api.resend.com/emails";

function normalizeRecipients(raw: string[]): string[] {
  return Array.from(
    new Set(
      raw
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.includes("@")),
    ),
  );
}

export async function sendOpsAlertEmail(
  input: OpsAlertEmailInput,
): Promise<OpsAlertEmailResult> {
  const recipients = normalizeRecipients(input.recipients);
  if (recipients.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[stripe-ops-alert] RESEND_API_KEY missing; alert not sent", {
      subject: input.subject,
      recipientCount: recipients.length,
    });
    return { attempted: recipients.length, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      const rendered = renderTransactionalEmail({
        variant: "generic_notification",
        recipient: { name: null, email: to },
        body: {
          variant: "generic_notification",
          title: input.subject,
          paragraphs: input.paragraphs,
          cta: input.cta ?? null,
        },
      });
      assertNotResendSandbox(rendered.from);
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: formatSenderHeader(rendered.from),
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      });
      if (res.ok) {
        succeeded += 1;
      } else {
        const detail = await res.text();
        console.error("[stripe-ops-alert] Resend non-2xx", {
          to,
          status: res.status,
          detail,
        });
        failed += 1;
      }
    } catch (err) {
      console.error("[stripe-ops-alert] send failed", {
        to,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }
  return { attempted: recipients.length, succeeded, failed };
}
```

Notes for implementor:
- `EMAIL_SENDERS.system` is selected implicitly via `variant: "generic_notification"` — `renderTransactionalEmail`'s switch in `_shared/email/index.ts:25-41` routes that variant to `EMAIL_SENDERS.system` (`notifications@usemingla.com`).
- The function MUST NOT throw on partial failures — return `OpsAlertEmailResult` instead. Callers log the result; the dispute upsert and webhook 400 response must not be derailed by alert failures.

#### Modified: `supabase/functions/_shared/stripeDisputeHandlers.ts`

Concrete changes (line numbers reference the post-rebase file):

1. **Line 3:** delete `import { dispatchNotification } from "./stripeEdgeAuth.ts";`. Add `import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";`.
2. **Lines 16–25 (DisputeHandlerEffects + defaultEffects):**
   - Replace `dispatchNotification: typeof dispatchNotification;` with `sendOpsAlertEmail: typeof sendOpsAlertEmail;`.
   - Replace `dispatchNotification,` in `defaultEffects` with `sendOpsAlertEmail,`.
3. **Lines 64–68 (`alertUserIdsFromEnv`):** rename to `alertEmailsFromEnv()`. Read `STRIPE_DISPUTE_ALERT_EMAILS` instead of `STRIPE_DISPUTE_ALERT_USERS`. Body becomes:
   ```ts
   function alertEmailsFromEnv(): string[] {
     const raw = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS") ?? "";
     return raw.split(",").map((s) => s.trim()).filter(Boolean);
   }
   ```
   (Dedupe + lowercase happens inside `sendOpsAlertEmail`.)
4. **Lines 111–141 (`alertDisputeCreated`):** rewrite to call `sendOpsAlertEmail`. Signature gains a `brandName: string | null` parameter (looked up by the caller — see #6 below). Body:
   ```ts
   async function alertDisputeCreated(
     input: {
       brandName: string | null;
       disputeId: string;
       amount: number;
       currency: string;
       reason: string;
       evidenceDueBy: string | null;
       livemode: boolean;
       effects: DisputeHandlerEffects;
     },
   ): Promise<void> {
     const emails = alertEmailsFromEnv();
     if (emails.length === 0) {
       console.warn(
         "[stripe-dispute] STRIPE_DISPUTE_ALERT_EMAILS missing; dispute persisted without operator notification",
       );
       return;
     }
     const amountStr = formatCurrencyAmount(input.amount, input.currency);
     const brand = input.brandName ?? "unknown brand";
     const daysUntilDue = input.evidenceDueBy
       ? Math.max(0, Math.ceil(
           (new Date(input.evidenceDueBy).getTime() - Date.now()) / 86_400_000,
         ))
       : null;
     const subject = daysUntilDue !== null
       ? `🚨 [LIVE] Chargeback dispute — ${amountStr} on ${brand}, evidence due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
       : `🚨 [LIVE] Chargeback dispute — ${amountStr} on ${brand}`;
     const paragraphs = [
       `A new Stripe chargeback dispute requires your review.`,
       `Amount: ${amountStr}`,
       `Brand: ${brand}`,
       `Reason: ${input.reason}`,
       input.evidenceDueBy
         ? `Evidence due: ${input.evidenceDueBy}`
         : `Evidence due: (not provided)`,
       `Dispute ID: ${input.disputeId}`,
     ];
     const dashboardBase = input.livemode
       ? "https://dashboard.stripe.com/disputes"
       : "https://dashboard.stripe.com/test/disputes";
     await input.effects.sendOpsAlertEmail({
       subject,
       paragraphs,
       recipients: emails,
       cta: { label: "Open in Stripe Dashboard", url: `${dashboardBase}/${input.disputeId}` },
     });
   }
   ```
5. **New function `alertDisputeLost`** (analogous shape, called from `handleChargeDispute` when `event.type === "charge.dispute.closed" && status === "lost"`):
   ```ts
   async function alertDisputeLost(
     input: {
       brandName: string | null;
       disputeId: string;
       amount: number;
       currency: string;
       livemode: boolean;
       effects: DisputeHandlerEffects;
     },
   ): Promise<void> {
     const emails = alertEmailsFromEnv();
     if (emails.length === 0) return; // Already warned at creation; stay quiet on close.
     const amountStr = formatCurrencyAmount(input.amount, input.currency);
     const brand = input.brandName ?? "unknown brand";
     const subject = `❌ [LIVE] Chargeback LOST — ${amountStr} on ${brand}`;
     const paragraphs = [
       `A Stripe chargeback was closed with status "lost".`,
       `Amount: ${amountStr}`,
       `Brand: ${brand}`,
       `Dispute ID: ${input.disputeId}`,
     ];
     const dashboardBase = input.livemode
       ? "https://dashboard.stripe.com/disputes"
       : "https://dashboard.stripe.com/test/disputes";
     await input.effects.sendOpsAlertEmail({
       subject,
       paragraphs,
       recipients: emails,
       cta: { label: "Open in Stripe Dashboard", url: `${dashboardBase}/${input.disputeId}` },
     });
   }
   ```
6. **`handleChargeDispute` (lines 188-onwards):** add a brand-name lookup right after `brandId` is resolved:
   ```ts
   const brandName = brandId ? await brandNameForBrandId(supabase, brandId) : null;
   ```
   Helper:
   ```ts
   async function brandNameForBrandId(
     supabase: SupabaseClient,
     brandId: string,
   ): Promise<string | null> {
     const { data, error } = await supabase
       .from("brands")
       .select("name")
       .eq("id", brandId)
       .maybeSingle();
     if (error) {
       console.warn("[stripe-dispute] brand name lookup failed", { brandId, error: error.message });
       return null;
     }
     return (data?.name as string | undefined) ?? null;
   }
   ```
   Then:
   - In the `event.type === "charge.dispute.created"` branch (line 232 area), call `alertDisputeCreated({ brandName, disputeId, amount, currency, reason, evidenceDueBy: evidenceDueBy(dispute), livemode: dispute.livemode === true, effects })` instead of the old form.
   - In the `event.type === "charge.dispute.closed" && status === "lost"` branch (line 247 area), ADD a call to `alertDisputeLost({ brandName, disputeId, amount, currency, livemode: dispute.livemode === true, effects })` BEFORE the existing `postDisputeAppsFlyerEvent` call.
   - **DO NOT** add any alert for `charge.dispute.updated`.
7. **Add `formatCurrencyAmount` helper** at the top of the file (or import from an existing shared place if one exists — implementor's call):
   ```ts
   function formatCurrencyAmount(amount: number, currency: string): string {
     // Stripe amounts are in the smallest unit. For most currencies that's cents (÷100).
     // Zero-decimal currencies (JPY, KRW) divide by 1. Mingla operates USD primarily;
     // a quick switch covers the bases without pulling in Intl.NumberFormat.
     const zeroDecimal = new Set(["jpy", "krw", "vnd"]);
     const lower = currency.toLowerCase();
     const major = zeroDecimal.has(lower) ? amount : amount / 100;
     return `${currency.toUpperCase()} ${major.toFixed(zeroDecimal.has(lower) ? 0 : 2)}`;
   }
   ```

#### Modified: `supabase/functions/stripe-webhook/index.ts`

1. **Line 20:** delete `import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";`. Add `import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";`.
2. **Lines 33–58 (`notifyWebhookSignatureFailure`):** rewrite to:
   ```ts
   export async function notifyWebhookSignatureFailure(
     signature: string | null,
     send: typeof sendOpsAlertEmail = sendOpsAlertEmail,
   ): Promise<number> {
     const raw = Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS") ?? "";
     const emails = raw.split(",").map((s) => s.trim()).filter(Boolean);
     if (emails.length === 0) return 0;
     const sigPrefix = signature?.slice(0, 20) ?? "missing";
     const subject = `⚠️ [LIVE] Stripe webhook signature failure detected`;
     const paragraphs = [
       `A Stripe webhook delivery failed signature verification.`,
       `This typically means the live webhook signing secret is wrong, the request is being replayed, or a third party is probing the endpoint.`,
       `Signature prefix: ${sigPrefix}`,
       `Timestamp: ${new Date().toISOString()}`,
       `Action: confirm STRIPE_WEBHOOK_SECRET_LIVE in Supabase secrets matches the active endpoint signing secret in Stripe Dashboard → Developers → Webhooks.`,
     ];
     const result = await send({
       subject,
       paragraphs,
       recipients: emails,
       cta: { label: "Open Stripe webhooks dashboard", url: "https://dashboard.stripe.com/webhooks" },
     });
     return result.succeeded;
   }
   ```
3. **Caller at lines 86–92** is unchanged in shape (still wrapped in try/catch — failure of the alert MUST NOT alter the 400 response).

### Service layer

N/A — no service-layer (mobile / business / admin) code touched.

### Hook + Component layer

N/A — no client code.

### Database layer

N/A — no migration. The pre-existing `stripe_disputes` table (created by ORCH-0953 migration `20260726000000_orch_0953_create_stripe_disputes.sql`) is read-only from this ORCH's perspective. The optional `brand_name` lookup reads from the pre-existing `brands.name` column.

### Realtime

N/A.

---

## Phase 4 — Success criteria (numbered, observable, testable)

- **SC-1** When `charge.dispute.created` fires on `stripe-webhook` and `STRIPE_DISPUTE_ALERT_EMAILS` contains one or more valid addresses, exactly one Resend POST is issued per address, the response subject begins with `🚨 [LIVE] Chargeback dispute — ${CURRENCY} ${amount}`, the body includes amount + brand name (or `"unknown brand"` if lookup fails) + reason + evidence-due timestamp + dispute ID, and a CTA button pointing to `https://dashboard.stripe.com/disputes/{disputeId}` (or `.../test/disputes/...` when `livemode === false`) renders.
- **SC-2** When `charge.dispute.closed` fires with `status: "lost"` and `STRIPE_DISPUTE_ALERT_EMAILS` is populated, exactly one Resend POST is issued per address with subject `❌ [LIVE] Chargeback LOST — ${CURRENCY} ${amount} on ${brand}` and the analogous body + CTA.
- **SC-3** When `charge.dispute.updated` fires, ZERO Resend POSTs are issued from the dispute path. (No alert for updates.)
- **SC-4** When `STRIPE_DISPUTE_ALERT_EMAILS` is unset or empty, the dispute upsert still succeeds and the AppsFlyer dispute_created event still fires. A `console.warn` is emitted with message `[stripe-dispute] STRIPE_DISPUTE_ALERT_EMAILS missing; dispute persisted without operator notification`. No exception propagates.
- **SC-5** When the Stripe-webhook signature verification fails and `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` is populated, exactly one Resend POST per address is issued with subject `⚠️ [LIVE] Stripe webhook signature failure detected`, body containing the signature prefix + timestamp + remediation guidance, and CTA to `https://dashboard.stripe.com/webhooks`. The webhook still returns HTTP 400 `{ "error": "invalid_signature", ... }` regardless of alert send outcome.
- **SC-6** When `RESEND_API_KEY` is unset on the production project but the alert function is invoked, `sendOpsAlertEmail` returns `{ attempted: N, succeeded: 0, failed: 0 }`, emits `console.warn` with message `[stripe-ops-alert] RESEND_API_KEY missing; alert not sent`, and does NOT throw.
- **SC-7** Recipient normalization: `"Seth@UseMingla.com, seth@usemingla.com, , bogus"` resolves to exactly one POST to `seth@usemingla.com`. Trailing whitespace, mixed case, empty entries, and entries without `@` are filtered.
- **SC-8** Idempotency: replaying the same `charge.dispute.created` event twice triggers TWO sets of alert POSTs (the dispute upsert is idempotent per ORCH-0953; alert dedupe is NOT in scope for ORCH-0956 — Stripe's own webhook delivery dedupe is the upstream guarantee). This is an explicit non-goal documented here so the tester does not flag it as a defect.
- **SC-9** Resend sender identity: `from` header equals `Mingla <notifications@usemingla.com>` (the `EMAIL_SENDERS.system` default) unless `RESEND_SYSTEM_FROM` is overridden in env.
- **SC-10** Sandbox guard: invariant I-PROPOSED-AE `RESEND_NO_SANDBOX_SENDER` is enforced — if `RESEND_SYSTEM_FROM` is set to anything ending in `@resend.dev`, `sendOpsAlertEmail` throws `email_sender_resend_sandbox_forbidden` (propagated from `assertNotResendSandbox`) and the alert is not sent.

---

## Phase 5 — Invariants

### Preserved (existing)

| Invariant | How preserved | Verifier |
|---|---|---|
| **I-PROPOSED-AE RESEND_NO_SANDBOX_SENDER** | `sendOpsAlertEmail` calls `assertNotResendSandbox(rendered.from)` for every recipient before POST. | Test T-08 below + existing `senders.test.ts` coverage of the assertion. |
| **I-EMAIL-BRAND-SHELL-SINGLETON** (ORCH-0785 I-PROPOSED-AD) | All ops alerts flow through `renderTransactionalEmail` → `renderShell`. No bespoke HTML body construction. | Code review + grep for `<html` outside `_shared/email/`. |
| **ORCH-0953 dispute persistence invariant** | The `stripe_disputes` upsert path is untouched; only the post-upsert alert side-effect changes. | Existing ORCH-0953 idempotency test (`Deno.test "replaying the same dispute is idempotent"`) continues to pass — `assertEquals(supabase.disputes.size, 1)`. |
| **Stripe webhook 400-on-invalid-signature contract** | `notifyWebhookSignatureFailure` is still wrapped in try/catch; its return value is unused; the 400 response shape is unchanged. | Test T-05 + existing stripe-webhook tests. |

### New

| Invariant | Description |
|---|---|
| **I-PROPOSED-STRIPE-OPS-ALERT-EMAIL-ONLY** | Stripe dispute (`created`, `closed-lost`) and webhook signature-failure alerts MUST route through `sendOpsAlertEmail` to the `STRIPE_*_EMAILS` env-var allowlist. The OneSignal `dispatchNotification` path is forbidden for these two trigger types. Other Stripe-touching notifications (KYC stall, brand detach, health check, settlement receivable) keep using `dispatchNotification` and are out of scope. |

No CI strict-grep gate is required for the new invariant (the swap is small and locally enforced by the import structure). Codify in `INVARIANT_REGISTRY.md` at CLOSE per the orchestrator's CLOSE Step 5e (decommissioning extension) since OneSignal-push is being decommissioned for the Stripe ops alert family specifically.

---

## Phase 6 — Test cases

All tests live under `supabase/functions/_shared/__tests__/`. The implementor-written happy-path tests go in `stripeDisputeHandlers.test.ts` (extending the existing file) and either a new `stripeWebhookSignatureFailure.test.ts` or `stripeOpsAlertEmail.test.ts`. Implementor picks the file structure but ALL of T-01 through T-08 must be present as `Deno.test(...)` cases.

| Test | Scenario | Input | Expected | Layer | Owner |
|------|----------|-------|----------|-------|-------|
| **T-01 (happy)** | `charge.dispute.created` triggers email alerts | `STRIPE_DISPUTE_ALERT_EMAILS="ops@example.com,ops2@example.com"`, brand lookup returns `"Acme Co"`, dispute amount 5000 USD, livemode true, evidence_details.due_by = `now + 7 days` | Exactly two `sendOpsAlertEmail` calls, OR one call with `recipients: ["ops@example.com","ops2@example.com"]` (implementor's choice — see SC-1; the helper internally loops). Subject starts with `🚨 [LIVE] Chargeback dispute — USD 50.00 on Acme Co, evidence due in 7 days`. Body contains all required fields. CTA URL = `https://dashboard.stripe.com/disputes/dp_123`. | Effects DI + helper | Implementor |
| **T-02 (happy)** | `charge.dispute.closed` with `status: "lost"` triggers email alert | Same env, dispute closed-lost | One `sendOpsAlertEmail` call with subject `❌ [LIVE] Chargeback LOST — USD 50.00 on Acme Co`. AppsFlyer `dispute_lost` event ALSO fires (unchanged from ORCH-0953). | Effects DI + helper | Implementor |
| **T-03 (negative)** | `charge.dispute.updated` does NOT trigger alert | Same env, dispute updated event | ZERO `sendOpsAlertEmail` calls. The dispute upsert succeeds. | Effects DI | Implementor |
| **T-04 (happy)** | Signature failure triggers webhook alert | `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS="ops@example.com"`, webhook receives malformed body | One `sendOpsAlertEmail` call with subject `⚠️ [LIVE] Stripe webhook signature failure detected`. Body contains signature prefix + remediation guidance. Webhook returns HTTP 400. | Webhook + helper | Implementor |
| **T-05 (adversarial — env)** | Missing `STRIPE_DISPUTE_ALERT_EMAILS` | Env var unset, dispute.created fires | Dispute upsert succeeds. ZERO `sendOpsAlertEmail` calls. `console.warn` includes `STRIPE_DISPUTE_ALERT_EMAILS missing`. No exception. | Effects DI | Tester |
| **T-06 (adversarial — payload)** | Malformed dispute payload missing `amount` | Dispute event with `amount: undefined`, env populated | `sendOpsAlertEmail` still called; subject + paragraphs use the literal string `USD NaN.00` or `USD 0.00` (implementor picks — both acceptable; the goal is graceful degradation, not crash). Test asserts NO throw. | Effects DI | Tester |
| **T-07 (adversarial — recipients)** | Recipient normalization | `STRIPE_DISPUTE_ALERT_EMAILS="Seth@UseMingla.com, seth@usemingla.com, , bogus"` | `sendOpsAlertEmail` receives a 4-element raw array; after internal normalization, exactly ONE Resend POST is attempted to `seth@usemingla.com`. | Helper | Tester |
| **T-08 (adversarial — sandbox)** | Resend sandbox sender rejection | `RESEND_SYSTEM_FROM="Test <noreply@resend.dev>"`, dispute fires | `sendOpsAlertEmail` throws `email_sender_resend_sandbox_forbidden` (propagated from `assertNotResendSandbox`). The outer `handleChargeDispute` catches via the existing effects pattern and the dispute upsert still completes. | Helper + invariant | Tester |

**Regression-test gate compliance (ORCH-0840 Step 0.5):** the implementor's happy-path tests (T-01, T-02, T-03, T-04) must each include a `fails-on-revert verified at <commit hash>` line in the implementation report — revert the swap commit, confirm each test FAILS, restore the swap, confirm each test PASSES. The tester's adversarial tests (T-05 through T-08) cover env-var, payload, normalization, and invariant boundary conditions that the implementor's happy-paths do not. Each set MUST be in append-only mode (no modification of existing ORCH-0953 tests beyond the documented `dispatchNotification` → `sendOpsAlertEmail` rename in the effects-mock construction).

**Note on test mutation of existing ORCH-0953 tests:** the implementor MUST modify the `effects` mock in lines 99–107 + 142–146 + 171–178 of `stripeDisputeHandlers.test.ts` to swap `dispatchNotification` for `sendOpsAlertEmail`. This is a NECESSARY rename, not a weakening of test semantics. The CLOSE commit body MUST include `[TEST-MOD-APPROVED ORCH-0956]` per the append-only CI gate.

---

## Phase 7 — Implementation order

1. **Create `supabase/functions/_shared/stripeOpsAlertEmail.ts`** with the body spec'd in Phase 3.
2. **Update `_shared/stripeDisputeHandlers.ts`:** swap imports, rename `alertUserIdsFromEnv` → `alertEmailsFromEnv` + change env-var name, rewrite `alertDisputeCreated` body, add `alertDisputeLost`, add `brandNameForBrandId` helper, add `formatCurrencyAmount` helper, wire `alertDisputeLost` into `handleChargeDispute` closed-lost branch, update `DisputeHandlerEffects` shape.
3. **Update `stripe-webhook/index.ts`:** swap import, rewrite `notifyWebhookSignatureFailure` body + env-var name.
4. **Update `_shared/__tests__/stripeDisputeHandlers.test.ts`:** rename effects-mock field on existing tests (the `[TEST-MOD-APPROVED ORCH-0956]` change), add T-01, T-02, T-03 as new `Deno.test(...)` cases.
5. **Create new test file** (or extend existing) covering T-04 happy-path for the webhook signature-failure path. Implementor picks file location.
6. **Run** `deno test supabase/functions/_shared/__tests__/` + the new webhook test file. All tests pass.
7. **Run** `deno fmt --check` + `deno lint` (or whatever the repo's existing edge-function gate is — implementor checks `package.json` / `Makefile` / `.github/workflows/`).
8. **Author tester-adversarial tests T-05 through T-08.** These are written BY THE TESTER after handoff — not by implementor. (Per ORCH-0840 Step 0.5 split: implementor writes happy-path; tester writes adversarial.)
9. **Commit on branch `ORCH-0956-stripe-ops-alerts-email`**, push, open PR to `main`.
10. **Orchestrator deploys edge function `stripe-webhook`** post-merge via `supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv` (the orchestrator owns this — see `feedback_orchestrator_deploys_edge_functions.md`).
11. **Seth adds the two new env vars** at the production project after deploy: `STRIPE_DISPUTE_ALERT_EMAILS=seth@usemingla.com` (or comma-separated list), `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS=seth@usemingla.com`. The legacy `*_USERS` vars can be removed from Supabase secrets at the same pace.

No database migration. No `supabase db push`. No `[deploy]` tag at CLOSE (backend-only — no Vercel surface).

---

## Phase 8 — Regression prevention

| Bug class | Structural safeguard |
|---|---|
| Future maintainer accidentally re-routes Stripe ops alerts through OneSignal | Invariant **I-PROPOSED-STRIPE-OPS-ALERT-EMAIL-ONLY** in `INVARIANT_REGISTRY.md` (added at CLOSE). |
| Future maintainer adds `charge.dispute.updated` alerts (noisy) | Test T-03 explicitly asserts ZERO alerts on `updated`; any future code change that violates this fails the test. |
| Resend sandbox sender accidentally configured in production | `assertNotResendSandbox` already enforced in every Resend caller; test T-08 covers this specifically for the new helper. |
| Recipient env-var contains uppercased/duplicate/malformed entries | Test T-07 covers normalization explicitly; the `normalizeRecipients` helper enforces the contract. |
| Resend API key rotation causing silent alert drop | Test T-06-equivalent + the `console.warn` on missing key is grep-able in logs. (Not directly enforced by CI — out of scope.) |
| Brand name lookup throws and breaks the dispute upsert | Lookup wrapped in maybeSingle + null fallback; T-01 covers the happy lookup path; T-02 covers the closed-lost path; an explicit P3 follow-up could add a test for `brandNameForBrandId` returning error.message — currently logged via `console.warn` and returns null. |
| Future change accidentally drops the try/catch around `notifyWebhookSignatureFailure` and causes a webhook signature-failure to throw instead of returning 400 | T-04 plus existing stripe-webhook tests pin the 400-response contract. |

---

## Phase 9 — Deliverables summary

**Files created:**
- `supabase/functions/_shared/stripeOpsAlertEmail.ts` (new shared helper)

**Files modified:**
- `supabase/functions/_shared/stripeDisputeHandlers.ts` (effects DI + 2 alert call sites + brand-name lookup + currency formatter)
- `supabase/functions/stripe-webhook/index.ts` (import swap + `notifyWebhookSignatureFailure` rewrite)
- `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` (`[TEST-MOD-APPROVED ORCH-0956]` effects-field rename + 3 new happy-path tests)

**Files possibly created (implementor's choice):**
- `supabase/functions/_shared/__tests__/stripeOpsAlertEmail.test.ts` (T-04 + helper-level tests) OR added to existing webhook test file.

**Files NOT modified:**
- All other `dispatchNotification` callers (`brand-stripe-detach`, `stripe-webhook-health-check`, `_shared/stripeWebhookRouter.ts`, `stripe-kyc-stall-reminder`) — untouched.
- Any client code, migrations, RLS, admin web, business web, mobile.

**Env vars (Seth adds post-merge):**
- `STRIPE_DISPUTE_ALERT_EMAILS` (comma-separated)
- `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` (comma-separated)

**Env vars (Seth removes post-merge, at his pace):**
- `STRIPE_DISPUTE_ALERT_USERS`
- `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`

**Edge functions to deploy post-merge (orchestrator-owned):**
- `stripe-webhook` (bundles `_shared/stripeDisputeHandlers.ts` + the new `_shared/stripeOpsAlertEmail.ts`)

**CLOSE tags required in commit subject:**
- `[TEST-MOD-APPROVED ORCH-0956]` — because the implementor renames the effects-mock field in 3 existing ORCH-0953 tests (necessary mechanical rename, not a weakening).
- NO `[deploy]` tag — backend-only, no Vercel surface.

**Downstream routing:**
- Implementor (Codex `implementor-mingla`) executes Phase 7 steps 1–7 + 9.
- Tester (Claude `mingla-tester`) executes Phase 7 step 8 (T-05 through T-08) + independent verification.
- Orchestrator executes Phase 7 step 10 (deploy) post-merge.
- Seth executes Phase 7 step 11 (env var add/remove).
