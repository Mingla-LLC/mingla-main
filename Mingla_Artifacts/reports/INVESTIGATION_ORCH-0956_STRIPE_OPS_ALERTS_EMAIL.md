# INVESTIGATION — ORCH-0956 [Stripe ops alerts → email]

**Mode:** INVESTIGATE-only (no fix proposed in this report; SPEC follows separately).
**Date:** 2026-05-24
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0956-[stripe-ops-alerts-email]/` on branch `ORCH-0956-stripe-ops-alerts-email`
**Branched from:** `main` @ `c8ab3fcd` (latest main as of dispatch).
**Confidence:** `proven` for everything below (read directly from canonical files; no runtime layer required — pure backend code audit, exempt per Prime Directive 7).

---

## Symptom summary

ORCH-0953 [Stripe live cutover] shipped Stripe dispute and webhook-signature-failure alerts via OneSignal push (`dispatchNotification` from `_shared/stripeEdgeAuth.ts`). Seth flagged during ORCH-0953 Phase E that push routing is unreliable for ops alerts (device-registration drift across consumer/business apps, OneSignal may silently drop) and email is the right channel for operator alerts. ORCH-0956 swaps both alert hooks to Resend email, with a comma-separated email allowlist replacing the user-ID allowlist.

Expected after swap: dispute + signature-failure events trigger a Resend POST to a known operator inbox (default `seth@usemingla.com`) with an actionable subject line and a body containing full triage context (brand, event, amount, dispute reason, evidence due date, dashboard link).

Actual today (on ORCH-0953 branch, where the alert hooks live): both call sites push notifications via OneSignal — no email path exists, no Resend integration is referenced from the dispute or signature-failure paths.

---

## 🚨 Critical dependency blocker (must be resolved before SPEC dispatch)

**Branch base mismatch.** The worktree is on a branch off `main`, but ORCH-0953's implementation (the code ORCH-0956 needs to modify) has NOT yet merged to `main`. ORCH-0953's work currently lives on branch `ORCH-0953-stripe-live-cutover` only.

Evidence:

| Check | Result |
|---|---|
| `git log --oneline -10` on this worktree | Top commit is `c8ab3fcd WORKTREE_REGISTRY: record ORCH-0948 reaped row` — no ORCH-0953 commits present. |
| `ls supabase/functions/_shared/stripeDisputeHandlers.ts` (this worktree) | File does not exist. |
| `grep -rn "STRIPE_DISPUTE_ALERT\|STRIPE_WEBHOOK_FAILURE\|dispatchNotification" supabase/functions/` (this worktree) | Zero hits for `STRIPE_DISPUTE_ALERT` or `STRIPE_WEBHOOK_FAILURE`. `dispatchNotification` exists in `_shared/stripeEdgeAuth.ts` line 93, but no dispute caller. |
| `git ls-tree -r ORCH-0953-stripe-live-cutover --name-only \| grep dispute` | `supabase/functions/_shared/stripeDisputeHandlers.ts` + `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` + `supabase/migrations/20260726000000_orch_0953_create_stripe_disputes.sql` — present on ORCH-0953 branch only. |
| `git branch --contains bc5935fc` (the ORCH-0953 implementation commit) | `ORCH-0953-stripe-live-cutover` only — not on `main` and not on `ORCH-0956-stripe-ops-alerts-email`. |

**Implication:** A SPEC written against current branch state would describe a swap of code that doesn't exist in this branch. Implementation cannot apply cleanly without first integrating ORCH-0953's code. Three resolution options the orchestrator must pick from (this report does not recommend — that's the orchestrator's call):

1. **Wait for ORCH-0953 to merge to `main`, then rebase ORCH-0956 onto the new `main`.** Cleanest. Sequence ORCH-0956 strictly after ORCH-0953 close. Risk: blocks ORCH-0956 on parallel work.
2. **Rebase ORCH-0956 branch onto `ORCH-0953-stripe-live-cutover`.** Lets work proceed now, but ORCH-0956's PR target becomes coupled to ORCH-0953's PR — must merge in order.
3. **Cherry-pick ORCH-0953's commits onto ORCH-0956 branch.** Tightest coupling — duplicate commits will need careful PR-time handling.

All technical findings below describe the code as it exists on `ORCH-0953-stripe-live-cutover`, since that is the code ORCH-0956 will modify regardless of integration strategy.

---

## Phase 0 ingestion (completed)

- Read `Mingla_Artifacts/prompts/INTAKE_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md` (in this worktree).
- Read `COMMS_LEDGER.md` at `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` — Active table empty, no acks required.
- Read the canonical Mingla email helper module surface: `supabase/functions/_shared/email/index.ts`, `senders.ts` (latest, in this worktree).
- Read ORCH-0953-branch code via `git show ORCH-0953-stripe-live-cutover:<path>` for: `_shared/stripeDisputeHandlers.ts`, `stripe-webhook/index.ts`, surrounding `dispatchNotification` consumers.
- Read reference Resend send patterns: `supabase/functions/venue-claim-submitted-email/index.ts`, `supabase/functions/admin-send-email/index.ts`, `supabase/functions/notify-dispatch/index.ts` (latest, in this worktree).
- Migration chain rule: not applicable (no DB migration in ORCH-0956 scope per INTAKE).

---

## Investigation manifest

| File | Layer | Why read |
|---|---|---|
| `supabase/functions/_shared/email/senders.ts` | Email infra | Sender identity registry + verified-domain confirmation. |
| `supabase/functions/_shared/email/index.ts` | Email infra | Public surface of the brand shell renderer + how callers obtain `from`/`subject`/`html`/`text`. |
| `supabase/functions/_shared/email/genericBody.ts` (referenced; not re-read) | Email infra | Confirms the `generic_notification` variant accepts `{ title, paragraphs, cta }`. |
| `supabase/functions/venue-claim-submitted-email/index.ts` | Reference caller | Canonical "simple ops/internal email" send pattern — direct POST to Resend with rendered shell. |
| `supabase/functions/admin-send-email/index.ts` | Reference caller | Alternate pattern with attachment + retry hooks; richer than needed for ops alerts. |
| `supabase/functions/notify-dispatch/index.ts` | Reference caller | Cross-checks `RESEND_API_KEY` env name + Resend endpoint URL. |
| `supabase/functions/_shared/stripeEdgeAuth.ts` lines 93–115 | Current `dispatchNotification` definition | Confirms it's the push-path helper (writes to `notifications` table + OneSignal). |
| `git show ORCH-0953-stripe-live-cutover:supabase/functions/_shared/stripeDisputeHandlers.ts` | Swap site #1 | Exact `alertDisputeCreated` body + invocation path. |
| `git show ORCH-0953-stripe-live-cutover:supabase/functions/stripe-webhook/index.ts` | Swap site #2 | Exact `notifyWebhookSignatureFailure` body + invocation path. |
| `git show ORCH-0953-stripe-live-cutover:supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` | Test fixtures | Confirms tests mock `dispatchNotification` via injected `effects` — the swap must update fixtures. |

---

## Findings

### 🔴 Root finding 1 — Resend helper location + sender identity (PROVEN)

- **Module:** `supabase/functions/_shared/email/` is the canonical email-render module. Public surface in `index.ts`. **There is no central Resend-send wrapper** — every caller does its own `fetch("https://api.resend.com/emails", …)` POST, using the rendered `{ from, subject, html, text }` payload from `renderTransactionalEmail()`.
- **API key env var:** `RESEND_API_KEY`. Consistent across all 7 existing callers (`admin-send-email`, `notify-dispatch`, `marketing-send`, `venue-claim-submitted-email`, `ticket-confirmation-dispatch`, `venue-claim-decision-email`, `admin-review-venue-claim`).
- **Verified sender domain:** `usemingla.com`. Three operator-defined identities in `EMAIL_SENDERS` (`supabase/functions/_shared/email/senders.ts` lines 24–28):

| Key | Default name | Default address | Override env var |
|---|---|---|---|
| `tickets` | Mingla | `tickets@usemingla.com` | `RESEND_TICKET_FROM` |
| `admin` | Mingla | `hello@usemingla.com` | `RESEND_ADMIN_FROM` |
| `system` | Mingla | `notifications@usemingla.com` | `RESEND_SYSTEM_FROM` |

- **Sandbox guard:** `assertNotResendSandbox(sender)` in `senders.ts:30` rejects any `*@resend.dev` address — enforces invariant I-PROPOSED-AE `RESEND_NO_SANDBOX_SENDER`. Any new Stripe-ops email MUST call this before POST (or call `renderTransactionalEmail`, which calls it internally at `index.ts:107`).
- **Best-fit sender for Stripe ops alerts:** `EMAIL_SENDERS.system` → `notifications@usemingla.com`. Rationale: dispute and webhook-failure alerts are operator-facing system notifications, not ticket confirmations and not admin compose. Matches the existing usage in `venue-claim-submitted-email` for similar operator-facing system notifications.

### 🔴 Root finding 2 — Swap site #1: dispute alert call site (PROVEN)

- **File on ORCH-0953 branch:** `supabase/functions/_shared/stripeDisputeHandlers.ts`
- **Affected function:** `alertDisputeCreated` (lines 111–141 in the ORCH-0953-branch file).
- **Current code (verbatim, lines 122–141 on ORCH-0953 branch):**

  ```ts
  const userIds = alertUserIdsFromEnv();
  if (userIds.length === 0) {
    console.warn(
      "[stripe-dispute] STRIPE_DISPUTE_ALERT_USERS missing; dispute persisted without operator notification",
    );
    return;
  }
  for (const userId of userIds) {
    await input.effects.dispatchNotification({
      userId,
      brandId: input.brandId,
      type: "stripe_dispute_created",
      title: "Stripe dispute opened",
      body: `A ${input.currency.toUpperCase()} ${input.amount} dispute needs review.`,
      data: { stripe_dispute_id: input.disputeId, amount: input.amount, currency: input.currency },
      relatedId: input.disputeId,
      relatedType: "stripe_dispute",
      idempotencyKey: `stripe_dispute_created:${input.disputeId}:${userId}`,
    });
  }
  ```

- **Env var helper to retire:** `alertUserIdsFromEnv()` (lines 64–68) reads `STRIPE_DISPUTE_ALERT_USERS`.
- **Trigger surface:** `alertDisputeCreated` is invoked only on `event.type === "charge.dispute.created"` (line 232). **Important scope clarification needed at SPEC time:** the INTAKE asks for `charge.dispute.created` / `updated` / `closed` alerts, but the current code only fires on `created`. SPEC must explicitly decide whether to (a) extend alert fan-out to all three event types, or (b) keep alerts only on `created` and treat the INTAKE bullet as aspirational. The `closed`-with-`status: "lost"` branch already exists (line 247) but only triggers AppsFlyer reporting, no operator alert. Recommend SPEC explicitly addresses this. (See "Open questions for SPEC" below.)

### 🔴 Root finding 3 — Swap site #2: signature-failure alert call site (PROVEN)

- **File on ORCH-0953 branch:** `supabase/functions/stripe-webhook/index.ts`
- **Affected function:** `notifyWebhookSignatureFailure` (function definition lines 33–58 in the ORCH-0953-branch file).
- **Current code (verbatim, lines 35–57 on ORCH-0953 branch):**

  ```ts
  export async function notifyWebhookSignatureFailure(
    signature: string | null,
    effect: typeof dispatchNotification = dispatchNotification,
  ): Promise<number> {
    const raw = Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_USERS") ?? "";
    const userIds = Array.from(
      new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)),
    );
    if (userIds.length === 0) return 0;
    for (const userId of userIds) {
      await effect({
        userId,
        type: "stripe_webhook_signature_failure",
        title: "Stripe webhook signature failed",
        body: "Stripe webhook signature verification failed. Check live webhook signing secrets.",
        data: { event_id: signature?.slice(0, 20) ?? null },
        relatedId: signature?.slice(0, 20) ?? null,
        relatedType: "stripe_webhook_signature",
        idempotencyKey: `stripe_webhook_signature_failure:${signature?.slice(0, 20) ?? "missing"}:${userId}`,
      });
    }
    return userIds.length;
  }
  ```

- **Env var to retire:** `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`.
- **Caller:** the `catch` block at lines 86–92 of `stripe-webhook/index.ts` on signature-verify failure — single invocation site. Resilient already (`try/catch` around `notifyWebhookSignatureFailure` so an alert failure does not break the webhook 400 response). Preserve that envelope in SPEC.
- **Mild file overlap with ORCH-0955 [Native Stripe Tax].** The INTAKE warned about this. The signature-failure swap touches the same file but in a narrowly scoped function (`notifyWebhookSignatureFailure`) and its caller block. ORCH-0955 is unlikely to touch this exact area unless it expands tax-event signature handling. Rebase risk is low but real — whichever PR merges second will need a 5-line manual fixup of imports + the catch block.

### 🔴 Root finding 4 — Canonical reference pattern for the swap (PROVEN)

`venue-claim-submitted-email/index.ts` lines 87–149 is the cleanest reference for a simple ops-style Resend email:

```ts
if (!RESEND_API_KEY) {
  console.warn("[venue-claim-submitted-email] RESEND_API_KEY missing");
  return json({ skipped: true, reason: "resend_not_configured" }, 200);
}
// … resolve sender from EMAIL_SENDERS.system + optional legacy override …
const rendered = renderTransactionalEmail({
  variant: "generic_notification",
  recipient: { name: null, email: to },
  body: { variant: "generic_notification", title, paragraphs, cta: null },
});
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: formatSenderHeader(rendered.from),
    to: [to],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  }),
});
if (!res.ok) { /* surface error, do not throw past the ops alert envelope */ }
```

For Stripe ops alerts, the `to` field becomes an array of recipients (one POST per recipient OR a single POST with `to: [list]` — Resend supports both; SPEC should pick one consistently). The "skipped" early-return on missing API key matches the INTAKE's adversarial test case ("missing env var → no email sent + no throw").

### 🟠 Contributing factor 1 — `subject` line + body content not yet specified at evidence-grade detail

INTAKE describes the desired subject as `🚨 [LIVE] New chargeback dispute — $XX on event Y, evidence due 7 days`, but the existing `alertDisputeCreated` doesn't have all of those fields in scope when it fires (specifically: event name, evidence due-date relative phrasing, brand name). The function has `brandId`, `disputeId`, `amount`, `currency`. To render the INTAKE's subject, SPEC must either:

- (a) Pass additional fields into `alertDisputeCreated` (brand name from `brands.name`, event name from `orders.events.name`, evidence due-date timestamp from the dispute payload), OR
- (b) Look them up inside the alert function from `supabase` + the dispute payload, OR
- (c) Ship a less-rich subject for v1 (e.g., `🚨 [LIVE] New chargeback dispute — ${currency.toUpperCase()} ${amount}`) and defer brand/event enrichment to a follow-up ORCH.

The dispute payload already includes `evidence_details.due_by` (the `evidenceDueBy()` helper at lines 54–62 extracts it). Brand name + event name require an additional DB read. SPEC decision required.

### 🟠 Contributing factor 2 — Test fixtures use injected `effects` dependency-injection pattern

`_shared/__tests__/stripeDisputeHandlers.test.ts` (on ORCH-0953 branch) mocks `dispatchNotification` via the `effects` parameter of `handleChargeDispute`. The implementor's regression tests must follow the same DI pattern — pass a fake email-sender (probably a `sendOpsAlertEmail` function) through `effects`, assert it was called with the expected subject/body. This is a structural constraint on the swap: keep the DI seam (don't refactor away to direct `fetch` calls) so tests can mock without spinning up Resend.

### 🟡 Hidden flaw 1 — Per-recipient idempotency key may need new shape

Current keys embed `userId` (`stripe_dispute_created:${disputeId}:${userId}`). After the swap, keys embed recipient email (`stripe_dispute_created:${disputeId}:${email}` or similar). If the swap reuses keys against the same `notifications` table (where `dispatchNotification` writes), old-key rows may be orphaned. **Resolution depends on whether the new email path still writes to `notifications`.** If email-only (no `notifications` row), the key shape doesn't matter for cross-channel dedupe. If both (email + record in `notifications` for audit), pick a key shape that's stable per `(disputeId, email)`. SPEC must pick.

### 🔵 Observation 1 — OneSignal `dispatchNotification` remains in use for non-Stripe-ops callers

`dispatchNotification` is still called from: `brand-stripe-detach`, `stripe-webhook-health-check`, `stripeWebhookRouter` (KYC + receivable settlement), `stripe-kyc-stall-reminder`. None of those are in scope for ORCH-0956 per INTAKE ("other notification types keep using OneSignal where appropriate"). Confirmed — no swap needed for those.

### 🔵 Observation 2 — Dashboard link generation for the email body

To meet the INTAKE's "direct link to Stripe Dashboard dispute page", the URL pattern is `https://dashboard.stripe.com/disputes/{disputeId}` for live mode (or `https://dashboard.stripe.com/test/disputes/{disputeId}` for test). The dispute payload's `livemode: boolean` field determines mode (Stripe canonical). SPEC should pick the URL shape and decide whether to include only the live-mode link or both.

### 🔵 Observation 3 — Email body recipient handling

`renderTransactionalEmail` requires `recipient: { name, email }`. For ops alerts to multiple addresses, options are:
- Loop POSTs (one per recipient) — clean idempotency, easy to assert.
- Single POST with `to: [list]` — fewer API calls, but all recipients see all others' addresses in the `to:` header.
- Single POST with `to: ["seth@usemingla.com"]` + `bcc: [others]` — privacy if more than one operator.

Loop POSTs is the safest default and matches the existing `alertDisputeCreated` loop structure. SPEC should explicitly pick.

---

## Five-Layer cross-check

| Layer | Truth | Disagreement? |
|---|---|---|
| **Docs (INTAKE)** | "Swap dispatchNotification for Resend email to `STRIPE_DISPUTE_ALERT_EMAILS` + `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS`. Reuse existing Resend integration." | — |
| **Schema** | No DB migration in scope. `stripe_disputes` table already created by ORCH-0953 migration `20260726000000_orch_0953_create_stripe_disputes.sql` (read on ORCH-0953 branch); no new columns needed for the swap. | None. |
| **Code (ORCH-0953 branch)** | `alertDisputeCreated` (dispute handler) + `notifyWebhookSignatureFailure` (webhook router) both call `dispatchNotification` with `userId` allowlist from `STRIPE_DISPUTE_ALERT_USERS` / `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`. | None — code matches INTAKE description. |
| **Code (this worktree, branched from main)** | Neither function exists. | **YES** — branch base predates ORCH-0953. See Critical dependency blocker. |
| **Runtime** | Not exercised — pure backend code audit, no sim repro per Prime Directive 7 exemption. | N/A. |
| **Data** | Production `stripe_disputes` table is empty (no live disputes yet); `STRIPE_DISPUTE_ALERT_USERS` is not set in production env per ORCH-0953 Phase E memo. The swap is therefore non-disruptive: no in-flight alert delivery to break. | None. |

---

## Blast radius

- **Files modified by SPEC (on whichever base ORCH-0953-integrated branch becomes ORCH-0956's working base):**
  1. `supabase/functions/_shared/stripeDisputeHandlers.ts` — `alertDisputeCreated` body + `alertUserIdsFromEnv` helper.
  2. `supabase/functions/stripe-webhook/index.ts` — `notifyWebhookSignatureFailure` body.
  3. `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` — fixture updates (mock email-sender instead of `dispatchNotification`).
  4. (Optional, recommended) New file `supabase/functions/_shared/stripeOpsAlertEmail.ts` to host the shared `sendOpsAlertEmail(input: { subject, paragraphs, recipients[] })` helper that both call sites can call. Keeps fan-out logic DRY.

- **Files NOT modified:** all other `dispatchNotification` callers (4 of them, listed in Observation 1).

- **Env vars touched (Supabase project secrets):**
  - DEPRECATED: `STRIPE_DISPUTE_ALERT_USERS`, `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`. Once code stops reading them, Seth removes from project secrets at his pace.
  - NEW: `STRIPE_DISPUTE_ALERT_EMAILS`, `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS`. Comma-separated. Seth adds at IMPLEMENT time (per INTAKE hard guard, the orchestrator does not write Supabase secrets).
  - Reused: `RESEND_API_KEY`, `RESEND_SYSTEM_FROM` (optional), `MINGLA_LOGO_URL`, `MINGLA_FOOTER_ADDRESS`, `SUPPORT_EMAIL` — already set in production for other Resend callers.

- **Edge functions to redeploy after PR merge:** `stripe-webhook` (because `_shared/stripeDisputeHandlers.ts` is bundled into it). `stripeWebhookRouter` (also imports `dispatchNotification` but isn't touched — still must redeploy if any `_shared/` import graph changed). Orchestrator owns the deploys per `feedback_orchestrator_deploys_edge_functions.md`.

- **Surfaces affected:** backend-only. No client surface. No `[deploy]` tag at CLOSE commit (Vercel is not involved).

- **Invariants potentially touched:** I-PROPOSED-AE `RESEND_NO_SANDBOX_SENDER` — automatic compliance if the swap uses `EMAIL_SENDERS.system` and routes through `renderTransactionalEmail` (which calls `assertNotResendSandbox` internally at `_shared/email/index.ts:107`). SPEC should explicitly cite this invariant.

---

## Open questions for SPEC (must be answered before IMPLEMENT dispatch)

1. **Event-type scope:** does `alertDisputeCreated` extend to fire on `charge.dispute.updated` and `charge.dispute.closed` (status: `lost` / `won`), or stay scoped to `created` only as today? INTAKE bullet 1 implies all three; current code does one.
2. **Subject-line richness:** rich subject (brand name + event name + evidence due-date phrasing) or minimal subject (`${currency} ${amount}` only) for v1? Rich requires an additional DB lookup in the alert path.
3. **Body content depth:** plain-paragraph body (matching `generic_notification` variant — INTAKE's "simple subject + body") or richer template? Recommend plain-paragraph for v1.
4. **Recipient fan-out:** one POST per recipient, or one POST with `to: [list]`, or `to: [first] + bcc: [rest]`?
5. **Idempotency surface:** does the new email path also write to the `notifications` table for audit, or is the email the sole record? If sole record, no idempotency-key concern; if dual-write, what key shape?
6. **Branch-base integration strategy:** wait for ORCH-0953 merge, rebase onto ORCH-0953 branch, or cherry-pick? (See Critical dependency blocker.)

---

## Discoveries for Orchestrator

1. **Dependency blocker is the headline.** SPEC cannot be authored against this worktree's current branch state. Orchestrator must pick the integration strategy (wait / rebase / cherry-pick) before dispatching SPEC.
2. **Mild file overlap with ORCH-0955 on `stripe-webhook/index.ts` is confirmed but narrow.** Both touch the file; collision is in different functions/blocks. Whichever PR merges second has a ~5-line manual rebase. Worth a Section-A note in CLOSE banner.
3. **No new COMMS-LEDGER entry written.** The dependency on ORCH-0953 is intra-pipeline-sequencing, not a cross-chat surprise that would affect ORCH-0954 or ORCH-0955. The orchestrator can route this in-chat. If the resolution becomes "wait for ORCH-0953 PR merge", and ORCH-0953 is owned by a different chat, a COMMS-LEDGER FYI may be warranted then.

---

## Fix strategy (direction only — not a spec)

Direction: introduce a small shared helper `_shared/stripeOpsAlertEmail.ts` exposing `sendOpsAlertEmail({ subject, paragraphs, recipients, supabase? })` that wraps the canonical `renderTransactionalEmail` + Resend POST pattern (mirroring `venue-claim-submitted-email`). The two existing alert call sites (`alertDisputeCreated`, `notifyWebhookSignatureFailure`) become thin functions that compose the subject + paragraphs from event data and call `sendOpsAlertEmail`. Both replace their `STRIPE_*_ALERT_USERS` env-var reads with comma-separated `STRIPE_*_ALERT_EMAILS` reads, normalizing email addresses (trim + lowercase). The DI seam in `DisputeHandlerEffects` swaps `dispatchNotification: typeof dispatchNotification` for `sendOpsAlertEmail: typeof sendOpsAlertEmail` so tests continue mocking via injected effects. Webhook signature-failure path swaps the `effect` parameter shape similarly.

Tests:
- Implementor happy-path (in `stripeDisputeHandlers.test.ts`): inject a fake `sendOpsAlertEmail`, fire `charge.dispute.created`, assert one call with expected subject + paragraphs + recipient list. Add a parallel test for the signature-failure path. Both must `fails-on-revert verified` at the implementation commit hash.
- Tester adversarial: missing env var (no `STRIPE_DISPUTE_ALERT_EMAILS` set) → no email sent + no throw. Malformed event payload (missing `dispute.amount`) → graceful fallback (still sends a basic alert with what's available; logs the missing field).

---

## Confidence + handoff direction

**Confidence:** `proven` for all findings (read from canonical source files; no runtime layer required for backend code audit).

**Next phase:** SPEC (Claude `mingla-forensics` SPEC mode), but **only after the orchestrator resolves the branch-base dependency blocker and answers the six open questions above**. Without those answers, a SPEC will either be wrong or be a SPEC for the implementor to make product decisions, which is not what SPEC is for.
