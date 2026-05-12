# SPEC ORCH-0788 — Buyer Notification Dispatcher

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0788 |
| Severity | S1 — buyer trust + commerce fulfillment integrity |
| Owner side | Backend (edge functions + optional pg_cron migration) |
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Confidence | High — built directly on investigation's proven root causes |

---

## 1. Plain-English summary

The Mingla buyer notification queue has three new template types written into it (refund-issued, order-cancelled, plus the legacy ticket-confirmation) but only one renderer (the ticket-confirmation renderer) and no caller that fires the dispatcher after a refund or cancel. This spec teaches the existing `ticket-confirmation-dispatch` edge function to route by `payload.template_key`, adds two adapter functions that translate refund/cancel payloads into the existing `generic_notification` email variant (no new variant union members — leverages the brand shell + generic-body renderer already proven by ORCH-0785), wires inline `dispatchTicketConfirmation(orderId)` calls inside `refund-order`, `cancel-order`, and the Stripe webhook refund handler, and adds a scheduled retry sweeper for `failed_retryable` rows. The 14 currently-stuck rows replay safely via the existing `UNIQUE (idempotency_key)` constraint once the dispatcher ships. No new columns, no schema migration for the table itself — only an optional pg_cron migration if Option A substrate is chosen.

---

## 2. Investigation receipts the spec inherits

| Root cause | Resolved by |
|---|---|
| RC-1: dispatcher ignores `payload.template_key` | §4 dispatcher router upgrade + §5 generic_notification adapters |
| RC-2: refund-order / cancel-order / stripeWebhookRouter don't invoke dispatcher | §6 inline dispatch calls in three writers |
| CF-1: refund/cancel email-only (no SMS) | §10.1 scope decision — DEFERRED to follow-up ORCH (rationale below) |
| CF-2: failed_terminal has no backoff/reset | §10.2 scope decision — partial: exponential-backoff retry sweeper YES (§7); admin reset RPC DEFERRED |
| HF-1: 6 sms failed_terminal Twilio config | OUT OF SCOPE — operator-accepted at ORCH-0777 close |
| HF-2: variant signature shape unclear | RESOLVED via Phase 1 deep-read — `EmailVariant` is an exhaustively-typed union; SPEC routes through existing `generic_notification` rather than extending the union |
| OBS-1, OBS-3 | §11 comment cleanup; §4 COALESCE legacy fallback |

---

## 3. Scope and non-goals

### In scope

1. Upgrade `supabase/functions/ticket-confirmation-dispatch/index.ts` to read `payload` and route by `payload->>'template_key'`.
2. Two new adapter functions translating `buyer_refund_issued` and `buyer_order_cancelled` payloads into the existing `GenericBodyInput` shape.
3. Inline `dispatchTicketConfirmation(orderId)` call inside three writers (`refund-order/index.ts`, `cancel-order/index.ts`, `_shared/stripeWebhookRouter.ts` refund handler).
4. New scheduled retry sweeper edge function `notification-retry-sweeper` + (optional, substrate-choice) pg_cron job.
5. New strict-grep CI gate `orch-0788-notification-template-key-dispatched` codifying I-PROPOSED-BA.
6. Update three misleading "ORCH-0785 dispatcher consumes template_key" comments to reference ORCH-0788.
7. Unit tests for each new dispatcher branch + adapter + sweeper invariants.

### Non-goals (explicit)

1. **No SMS for refund or cancel.** Today's writers emit email-only (CF-1). Adding SMS would multiply provider costs and conflict with the 6 stranded sms `failed_terminal` rows (HF-1). If product wants SMS parity later, file a new ORCH. Investigation §10 confirmed: deferred.
2. **No admin reset path for `failed_terminal` rows.** CF-2 partial: the new retry sweeper provides backoff for `failed_retryable` rows. Resetting `failed_terminal` rows (e.g. after Twilio config gap is fixed externally) is a follow-up ORCH or operator-manual `UPDATE` for now.
3. **No new columns on `ticket_order_notifications`.** The schema is correct as-is. `payload` jsonb already carries the discriminator. No `template_key` column needed at the table level.
4. **No changes to `biz_ticket_checkout_finalize_session` RPC** or the W1 buyer-ticket-confirmation enqueue path. Legacy rows (`template_key=NULL`) continue working via the COALESCE fallback.
5. **No changes to the dispatcher's HTTP contract.** `POST /functions/v1/ticket-confirmation-dispatch` with body `{orderId}` and service-role bearer remains. Callers depend on the URL.
6. **No changes to ORCH-0785 brand shell, ticket PDF renderer, or strict-grep gates ORCH-0785-A..E.** Refund + cancel emails use the existing brand shell unchanged.
7. **No new `EmailVariant` union members.** Spec uses the existing `generic_notification` variant with a custom sender override (`EMAIL_SENDERS.tickets`) and adapter functions that produce `GenericBodyInput`. Avoids type-system disruption + reuses tested renderer.
8. **No touching the 6 sms `failed_terminal` rows.** Operator-accepted residual (HF-1). Investigation answered the open question explicitly.
9. **No buyer-side app code changes.** Buyers receive emails; they don't run mingla-business.
10. **No mingla-admin changes.** No admin surface reads or manages this queue today.
11. **No mobile OTA.** This is an edge-function-only fix. Mobile bundles are untouched.

### Assumptions

A1. The 4 row UUIDs in the investigation (`81fe2a68-…`, `135e124e-…`, `2c28ed19-…`, plus the 5 other unsent rows) remain in the `ticket_order_notifications` table when the implementor begins work. If the operator manually deletes them in the interim, the sweeper still has zero rows to act on at launch — that's fine (no regression).

A2. `RESEND_API_KEY`, `MINGLA_LOGO_URL`, `MINGLA_FOOTER_ADDRESS`, `EMAIL_SENDERS.tickets`/`EMAIL_SENDERS.system` env vars and Supabase secrets configured during ORCH-0785 close remain set (ORCH-0785 launch operations).

A3. The Supabase project supports either pg_cron + pg_net (Option A substrate) or external cron (Option B). Implementor verifies and picks; SPEC accepts either.

A4. `_shared/email/index.ts` `renderTransactionalEmail({variant: "generic_notification", ...})` correctly resolves sender from `EMAIL_SENDERS.system` unless overridden via `input.sender`. The override path is established (used by admin_compose). Implementor must use sender override `EMAIL_SENDERS.tickets` for refund/cancel so buyers see the same `tickets@usemingla.com` sender they got at purchase time.

A5. `orders.buyer_email` is non-null when a notification row is enqueued (writers check `if (orderDetail?.buyer_email && orderDetail.buyer_email.length > 0)` before insert). The dispatcher can rely on `recipient` being present.

---

## 4. Database layer

### 4.1 Schema changes

**None.** `ticket_order_notifications` is already correctly shaped (see investigation §4 writer matrix). The `payload` jsonb carries `template_key` as a string field; the `UNIQUE (idempotency_key)` constraint protects against double-send; the `status` CHECK constraint already includes every state the new code needs (`pending | sending | sent | delivered | failed_retryable | failed_terminal | skipped`).

### 4.2 New migration (optional — only if Option A substrate is chosen)

**Filename:** `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql`

Required content (only if implementor picks pg_cron substrate):

```sql
-- ORCH-0788 — pg_cron schedule for the buyer notification retry sweeper.
-- Substrate Option A from SPEC §7. Implementor picks A or B; if B (external cron),
-- this migration is NOT created.

-- Probe: confirm pg_cron + pg_net extensions are available (Supabase ships them).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'ORCH-0788: pg_cron extension required but not enabled. Operator must enable via Supabase dashboard before this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'ORCH-0788: pg_net extension required but not enabled. Operator must enable via Supabase dashboard before this migration.';
  END IF;
END$$;

-- Unschedule any prior job with the same name (idempotent re-runs).
SELECT cron.unschedule('orch_0788_notification_retry_sweeper')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper');

-- Schedule every 5 minutes. Implementor confirms the exact cron expression
-- matches Supabase's pg_cron dialect (postgres-native, standard 5-field cron).
SELECT cron.schedule(
  'orch_0788_notification_retry_sweeper',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/notification-retry-sweeper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Probes confirming registration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper') THEN
    RAISE EXCEPTION 'ORCH-0788: cron job not registered after schedule call';
  END IF;
END$$;
```

**Hard guards on this migration:**
- Implementor must NOT inline `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` literals. Uses `current_setting('app.supabase_url')` + `current_setting('app.supabase_service_role_key')` — these are Supabase-managed session GUCs (or equivalent secrets table) that the operator configures.
- If the operator's Supabase project does NOT have pg_cron/pg_net enabled, implementor stops, surfaces to operator, and either operator enables them via dashboard OR implementor switches to Option B (external cron).
- Monotonic prefix: latest deployed prefix at SPEC time is `20260526000000`. Use `20260527000000`.

### 4.3 RLS impact

**None.** The dispatcher and sweeper already use service-role; existing RLS policies on `ticket_order_notifications` (service_role ALL, authenticated brand-team SELECT) remain correct and unchanged.

---

## 5. Email rendering layer

### 5.1 Adapter functions (NEW)

Two pure functions translating notification `payload` into `GenericBodyInput`. Placement: a new file `supabase/functions/_shared/email/buyerLifecycleAdapters.ts` (separate file keeps the diff scoped; mirrors the `ticketBody.ts`/`genericBody.ts` pattern).

```ts
// supabase/functions/_shared/email/buyerLifecycleAdapters.ts
import { escapeHtml } from "./escape.ts";
import { formatCents } from "./currency.ts";  // already exists per ORCH-0785
import type { GenericBodyInput } from "./types.ts";

export interface RefundIssuedPayloadShape {
  template_key: "buyer_refund_issued";
  amount_cents: number;
  currency: string;
  refund_lines?: Array<{ order_line_item_id: string; quantity: number; amount_cents: number }>;
  reason?: string;
  is_full_refund?: boolean;
  stripe_refund_id?: string;
  source?: "webhook_reconciliation" | string;
}

export interface OrderCancelledPayloadShape {
  template_key: "buyer_order_cancelled";
  reason?: string;
}

export interface BuyerContext {
  buyerName: string | null;
  eventTitle: string;
  brandName: string;
  orderShortId: string;
  publicEventUrl: string | null;  // for CTA; null = no CTA rendered
}

export function refundIssuedToGenericBody(
  payload: RefundIssuedPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  const amount = formatCents(payload.amount_cents, payload.currency);
  const isFull = payload.is_full_refund === true;
  const title = isFull
    ? `Your refund for ${context.eventTitle} is on the way`
    : `A partial refund for ${context.eventTitle} is on the way`;

  const paragraphs: string[] = [
    `Hi${context.buyerName ? " " + escapeHtml(context.buyerName) : ""},`,
    `${context.brandName} has issued ${isFull ? "a full" : "a partial"} refund of ${amount} for your order #${context.orderShortId}.`,
    `Refunds typically appear in your account within 5–10 business days.`,
  ];
  if (payload.reason && payload.reason.trim().length > 0) {
    paragraphs.push(`Reason: ${escapeHtml(payload.reason.trim())}`);
  }
  if (!isFull) {
    paragraphs.push(`The remaining tickets on this order are still valid.`);
  }
  paragraphs.push(`If you have any questions, reply to this email.`);

  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,  // No CTA — buyer doesn't need to take action
  };
}

export function orderCancelledToGenericBody(
  payload: OrderCancelledPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  const title = `Your order for ${context.eventTitle} has been cancelled`;
  const paragraphs: string[] = [
    `Hi${context.buyerName ? " " + escapeHtml(context.buyerName) : ""},`,
    `${context.brandName} has cancelled your order #${context.orderShortId} for ${context.eventTitle}.`,
    `Your tickets are no longer valid.`,
  ];
  if (payload.reason && payload.reason.trim().length > 0) {
    paragraphs.push(`Reason: ${escapeHtml(payload.reason.trim())}`);
  }
  paragraphs.push(`If you paid for this order, a refund will be processed separately. If you have any questions, reply to this email.`);

  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,
  };
}
```

### 5.2 Sender override

Both refund and cancel emails should appear from `EMAIL_SENDERS.tickets` (the same sender as the original purchase confirmation) so buyers recognize the thread. Achieve this by passing `sender: EMAIL_SENDERS.tickets` to `renderTransactionalEmail` (admin_compose path proves the override works). The variant remains `generic_notification` for type-system purposes.

### 5.3 No PDF, no calendar

Refund and cancel emails do NOT attach a ticket PDF and do NOT include calendar links. This is intentional: a refund email containing the original tickets would mislead buyers, and an `.ics` for a cancelled event is incorrect data.

### 5.4 No new EmailVariant union members

Spec deliberately does NOT extend `EmailVariant` with `buyer_refund_issued` / `buyer_order_cancelled`. Rationale:
- The exhaustively-typed `_exhaustive: never` switch in `_shared/email/index.ts:36-39, 92-95` makes adding new union members invasive (touches resolver + body-renderer switches + tests).
- Refund and cancel emails have the SAME visual shape as `generic_notification` (header logo + title + paragraphs + footer) — no ticket grid, no PDF, no calendar.
- The brand-shell singleton invariant (I-PROPOSED-AM) is satisfied by routing through the same `renderShell()` regardless of variant.
- If future product asks for refund/cancel-specific visual treatment (e.g., a refund-issued banner), a follow-up ORCH can extend the union then.

---

## 6. Writer inline-dispatch layer

Three writers gain ONE new line each: an inline `dispatchTicketConfirmation(orderId)` call after their enqueue, mirroring the working `_shared/stripeWebhookRouter.ts:686` pattern. The helper is already exported from `_shared/ticketCheckout.ts:119`.

### 6.1 `refund-order/index.ts`

After line 316 (current location of the close-of-enqueue-block + audit), BEFORE the audit `writeAudit(...)` call:

```ts
  // ORCH-0788: inline-dispatch so the buyer email goes out immediately.
  // The dispatch failure is NON-FATAL — the retry sweeper (pg_cron) will
  // pick up any failed_retryable rows. Pattern mirrors stripe-webhook
  // post-checkout path.
  if (orderDetail?.buyer_email) {
    await dispatchTicketConfirmation(orderId);
  }
```

Import: `import { dispatchTicketConfirmation } from "../_shared/ticketCheckout.ts";` (helper already exists; only the import + call site needs to be added).

### 6.2 `cancel-order/index.ts`

Symmetric change after line 133:

```ts
  if (orderDetail?.buyer_email) {
    await dispatchTicketConfirmation(orderId);
  }
```

### 6.3 `_shared/stripeWebhookRouter.ts` refund handler

After the upsert at line 553, BEFORE the `writeAudit(...)` at line 555:

```ts
  if (orderDetail?.buyer_email) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      try {
        await fetch(`${url}/functions/v1/ticket-confirmation-dispatch`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ orderId }),
        });
      } catch (err) {
        console.error("[stripe-webhook] refund dispatch failed", err);
      }
    }
  }
```

(Inlined rather than calling `dispatchTicketConfirmation()` because `stripeWebhookRouter.ts` is in `_shared/` and would create a circular import. Same shape, same failure semantics.)

### 6.4 Comment cleanup (OBS-1 from investigation)

Three places — update text only:

- `refund-order/index.ts:284` change `"ORCH-0785 dispatcher consumes the template_key"` to `"ORCH-0788 dispatcher routes by template_key"`.
- `cancel-order/index.ts:107` change `"ORCH-0785 dispatcher consumes template_key"` to `"ORCH-0788 dispatcher routes by template_key"`.
- `_shared/stripeWebhookRouter.ts:522` similar update.

---

## 7. Dispatcher router upgrade

### 7.1 Selection query change

`supabase/functions/ticket-confirmation-dispatch/index.ts:377-381`:

```ts
// BEFORE:
.select("id, channel, recipient, status, attempt_count")

// AFTER:
.select("id, channel, recipient, status, attempt_count, payload")
```

### 7.2 Per-row template_key dispatch

Replace the single-monolith render block (lines 341-475) with per-row dispatch. New shape (illustrative — implementor structures the code as cleanest):

```ts
for (const notification of notifications ?? []) {
  // 1. Status guard: skip rows already terminal (defensive — selection already
  //    filters but the sweeper might re-invoke during a race).
  if (notification.status === "sent" || notification.status === "failed_terminal") {
    continue;
  }

  // 2. Bump status to 'sending' + increment attempt_count (existing pattern).
  await supabase.from("ticket_order_notifications").update({
    status: "sending",
    attempt_count: Number(notification.attempt_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", notification.id);

  // 3. Read template_key with legacy fallback.
  const payload = (notification.payload ?? {}) as Record<string, unknown>;
  const templateKey = typeof payload.template_key === "string"
    ? payload.template_key
    : "buyer_ticket_confirmation";

  try {
    // 4. Build render-input per template.
    let renderedEmail: ReturnType<typeof renderTransactionalEmail>;
    let attachments: Array<{ filename: string; content: string }> = [];

    switch (templateKey) {
      case "buyer_ticket_confirmation": {
        // Existing path: ticket body + PDF + ICS calendar.
        // (Implementor preserves the existing buildRenderContext call
        //  + renderTransactionalEmail + buildTicketPdf + buildCalendarLinks
        //  exactly — moves them into this case branch.)
        // ... existing code from lines 341-432, just scoped to this case.
        break;
      }
      case "buyer_refund_issued": {
        if (notification.channel !== "email") {
          // No SMS path for refund in this ORCH (per SPEC §10.1).
          await markSkipped(notification.id, "channel_not_supported_for_template");
          continue;
        }
        const refundBody = refundIssuedToGenericBody(
          payload as RefundIssuedPayloadShape,
          buildBuyerContext(order),
        );
        renderedEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: refundBody,
          sender: EMAIL_SENDERS.tickets,  // override per §5.2
        });
        attachments = [];  // No PDF, no .ics per §5.3
        break;
      }
      case "buyer_order_cancelled": {
        if (notification.channel !== "email") {
          await markSkipped(notification.id, "channel_not_supported_for_template");
          continue;
        }
        const cancelBody = orderCancelledToGenericBody(
          payload as OrderCancelledPayloadShape,
          buildBuyerContext(order),
        );
        renderedEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: cancelBody,
          sender: EMAIL_SENDERS.tickets,
        });
        attachments = [];
        break;
      }
      default: {
        // Unknown template_key — defensive failed_terminal.
        await supabase.from("ticket_order_notifications").update({
          status: "failed_terminal",
          last_error: `unknown_template_key:${templateKey}`,
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        continue;
      }
    }

    // 5. Send (existing pattern preserved).
    if (notification.channel === "email") {
      assertNotResendSandbox(renderedEmail.from);
      const sent = await sendResendEmailWithAttachment({
        from: formatSenderHeader(renderedEmail.from),
        to: notification.recipient,
        subject: renderedEmail.subject,
        html: renderedEmail.html,
        text: renderedEmail.text,
        attachments,
      });
      await supabase.from("ticket_order_notifications").update({
        status: "sent",
        provider: "resend",
        provider_message_id: sent.id,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", notification.id);
    } else {
      // SMS path — only buyer_ticket_confirmation reaches here (refund/cancel
      // are filtered above via the channel guard).
      // Existing twilio send path preserved.
      const sent = await sendTwilioMessage({ to: notification.recipient, body: smsBody });
      await supabase.from("ticket_order_notifications").update({
        status: "sent",
        provider: "twilio",
        provider_message_id: sent.sid,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", notification.id);
    }
  } catch (err) {
    // Existing retry/terminal logic preserved.
    const attemptCount = Number(notification.attempt_count ?? 0) + 1;
    const retryable = err instanceof ProviderSendError ? err.retryable : true;
    const terminal = !retryable || attemptCount >= 3;
    await supabase.from("ticket_order_notifications").update({
      status: terminal ? "failed_terminal" : "failed_retryable",
      last_error: err instanceof Error ? err.message : String(err),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
  }
}
```

### 7.3 Failure-mode preservation

- **Render failure on buyer_ticket_confirmation** remains `failed_retryable` (existing behavior at lines 408-412).
- **Render failure on refund/cancel** (e.g. unexpected payload shape) is `failed_retryable` for the first 2 attempts, then `failed_terminal` at attempt 3 (existing logic at lines 462-470).
- **Unknown `template_key`** is IMMEDIATELY `failed_terminal` with `last_error='unknown_template_key:<value>'` — defensive, prevents the queue from spinning on garbage payloads.
- **`channel_not_supported_for_template`** (e.g. refund row written with `channel='sms'` somehow) is `status='skipped'` (existing enum value) with `last_error='channel_not_supported_for_template'`. NOT `failed_terminal` — preserves the ability to re-route via a future writer fix.

### 7.4 Selection scope unchanged

The query still selects `WHERE order_id = ? AND status IN ('pending', 'failed_retryable')`. The dispatcher remains per-order. The new retry sweeper (§8) is what polls the queue.

---

## 8. Scheduled retry sweeper

### 8.1 New edge function

**Path:** `supabase/functions/notification-retry-sweeper/index.ts`

**Method:** POST. **Body:** `{}` (no parameters). **Auth:** Service-role bearer only (same gate pattern as `ticket-confirmation-dispatch:248-251`).

**Behavior:**

```ts
// Pseudocode — implementor structures cleanly.
serve(async (req) => {
  // Auth gate: service-role bearer required.
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const supabase = serviceClient();
  const now = new Date();

  // Eligible rows: failed_retryable, attempt_count < 3, AND backoff window elapsed.
  // Backoff: 2^attempt_count * 60 seconds (i.e. 2 min, 4 min, 8 min) before next retry.
  // updated_at carries the timestamp of the most recent attempt.
  const { data: rows, error: queryError } = await supabase
    .from("ticket_order_notifications")
    .select("id, order_id, attempt_count, updated_at")
    .eq("status", "failed_retryable")
    .lt("attempt_count", 3)
    .limit(50);  // BOUNDED BATCH — prevent thundering herd.

  if (queryError) return jsonResponse({ error: "query_failed", detail: queryError.message }, 500);

  const eligible = (rows ?? []).filter((row) => {
    const backoffMs = Math.pow(2, Number(row.attempt_count ?? 0)) * 60_000;
    const elapsed = now.getTime() - new Date(row.updated_at).getTime();
    return elapsed >= backoffMs;
  });

  // Group by order_id (dispatcher pulls all unsent for an order in one call).
  const uniqueOrderIds = [...new Set(eligible.map((r) => r.order_id))];

  // Fire dispatcher per order. Failures are logged but DO NOT abort the sweep.
  const results: Array<{ orderId: string; status: "dispatched" | "failed"; error?: string }> = [];
  for (const orderId of uniqueOrderIds) {
    try {
      await dispatchTicketConfirmation(orderId);
      results.push({ orderId, status: "dispatched" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[notification-retry-sweeper] dispatch failed for ${orderId}`, message);
      results.push({ orderId, status: "failed", error: message });
    }
  }

  return jsonResponse({
    scanned: rows?.length ?? 0,
    eligible: eligible.length,
    unique_orders: uniqueOrderIds.length,
    results,
  });
});
```

### 8.2 Substrate (implementor picks)

**Option A — pg_cron + pg_net (preferred):** the migration in §4.2 schedules the sweeper to run every 5 minutes. Requires `pg_cron` + `pg_net` extensions enabled on the Supabase project. Operator confirms extension availability before migration apply.

**Option B — GitHub Actions cron (fallback):** A new `.github/workflows/notification-retry-sweeper.yml` with a `schedule: '*/5 * * * *'` trigger that does `curl -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" $SUPABASE_URL/functions/v1/notification-retry-sweeper`. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` GitHub repo secrets.

Implementor MUST pick one and justify in the implementation report. SPEC accepts either.

### 8.3 Backoff schedule

- attempt_count = 0: dispatched immediately by inline call from writer (no sweeper involvement)
- attempt_count = 1 (first failure): retry after 2 min (2^1 × 60s)
- attempt_count = 2 (second failure): retry after 4 min (2^2 × 60s)
- attempt_count = 3 (third failure): `failed_terminal` — no retry by sweeper

Max retry latency before terminal: ~6 minutes after first failure. Acceptable for buyer-trust path (refund typically takes 5–10 business days anyway).

### 8.4 Batch size + thundering-herd protection

Sweeper limits each run to 50 distinct `failed_retryable` rows (50 dispatcher invocations max per 5-min tick). At Mingla's current scale this is wildly over-provisioned; SPEC sets it as a defensive cap.

### 8.5 Idempotency

The dispatcher already guards per-row status (`status='sending'` flip happens before send) and `UNIQUE (idempotency_key)` protects against duplicate enqueue. The sweeper firing twice for the same order in rapid succession would race on the `status='sending'` UPDATE — the second invocation sees `status='sending'` and the existing `WHERE status IN ('pending','failed_retryable')` filter excludes it. Safe.

---

## 9. CI gate — I-PROPOSED-BA

### 9.1 Strict-grep script (NEW)

**Path:** `.github/scripts/strict-grep/orch-0788-notification-template-key-dispatched.mjs`

Six checks:

1. `_shared/email/buyerLifecycleAdapters.ts` exists and exports `refundIssuedToGenericBody` + `orderCancelledToGenericBody`.
2. `ticket-confirmation-dispatch/index.ts` SELECTs `payload` (regex `select\([^)]*payload`).
3. `ticket-confirmation-dispatch/index.ts` references `"buyer_refund_issued"` and `"buyer_order_cancelled"` literals (matching `template_key` values).
4. `refund-order/index.ts` imports `dispatchTicketConfirmation` AND calls it (literal match).
5. `cancel-order/index.ts` imports `dispatchTicketConfirmation` AND calls it.
6. `_shared/stripeWebhookRouter.ts` refund handler region (lines around upsert) contains `fetch.*ticket-confirmation-dispatch` call.

Optional 7th check (only if Option A substrate is chosen): migration `*orch_0788_notification_retry_cron.sql` exists and references `cron.schedule.*orch_0788_notification_retry_sweeper`.

### 9.2 Workflow registration

Add ONE new job to existing `.github/workflows/strict-grep-mingla-business.yml`:

```yaml
  orch-0788-notification-template-key-dispatched:
    name: "ORCH-0788: notification template_key dispatched (I-PROPOSED-BA)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run ORCH-0788 gate
        run: node .github/scripts/strict-grep/orch-0788-notification-template-key-dispatched.mjs
```

Per CLAUDE memory `feedback_strict_grep_registry_pattern.md`: one new script + one new job, no parallel workflow file.

### 9.3 Add ORCH-0788 to registry comment block

In `.github/workflows/strict-grep-mingla-business.yml` registry comment (line 60-ish region, after the ORCH-0795 entry from yesterday):

```
#   - ORCH-0788 (orch-0788-notification-template-key-dispatched.mjs) — buyer notification dispatcher routes by template_key (I-PROPOSED-BA)
```

---

## 10. Open scope decisions (resolved here)

### 10.1 CF-1: SMS for refund + cancel — DEFERRED

**Decision:** OUT OF SCOPE for ORCH-0788. Reasons:

1. The 6 stranded sms `failed_terminal` rows (HF-1) indicate Twilio Messaging Service is currently mis-configured. Adding SMS for refund/cancel before Twilio is fixed would multiply failure rows.
2. SMS provider cost-per-message is non-trivial; product should decide whether refund/cancel warrant SMS as an explicit feature ask.
3. The dispatcher router already supports it — adding `channel='sms'` for refund/cancel in a future ORCH only requires (a) writers enqueueing the row + (b) an SMS body template in the per-template switch. Low marginal cost when product asks.

**Follow-up ORCH candidate:** ORCH-0788-A "Refund + cancel SMS parity" — gated on Twilio config being fixed externally.

### 10.2 CF-2: Admin reset for `failed_terminal` — PARTIAL

**Decision:** 
- **YES**: exponential-backoff retry sweeper for `failed_retryable` rows (§8). This catches Resend transient failures + non-Twilio transient sms failures.
- **NO**: admin RPC to flip `failed_terminal` → `failed_retryable`. Operator can manual-UPDATE if needed; building an admin surface for it before there's a product decision on Twilio config + admin permissions is premature.

**Follow-up ORCH candidate:** ORCH-0788-B "Admin notification reset" — gated on a product decision about who's allowed to retry stuck notifications.

### 10.3 Substrate choice (sweeper hosting) — IMPLEMENTOR PICKS

Per §8.2. Implementor verifies `pg_cron`/`pg_net` availability and picks Option A or B. SPEC accepts either; both satisfy the contract.

---

## 11. Success criteria

| # | Criterion | How to verify |
|---|---|---|
| SC-1 | The pending `81fe2a68-…` refund row gets sent (sent_at non-null, status='sent', provider_message_id non-null) after the implementor deploys + the operator triggers a refund OR the retry sweeper fires for the first time | MCP probe post-deploy: `SELECT id, status, sent_at, provider_message_id FROM ticket_order_notifications WHERE id = '81fe2a68-1c28-4147-ac03-fda9d76d19fe'` returns status='sent' |
| SC-2 | A newly-issued refund (operator clicks Refund in mingla-business) results in: (a) Stripe refund processed, (b) `ticket_order_notifications` row inserted, (c) dispatcher fires inline, (d) buyer email sent within 10 seconds of refund | Manual smoke: operator refunds a test order, verify buyer inbox contains the new refund email + DB row shows status='sent' |
| SC-3 | A newly-cancelled order results in same end-state as SC-2 with the cancel template | Manual smoke: operator cancels a test free order, verify buyer email + DB row |
| SC-4 | A buyer ticket confirmation continues to send (no regression in the legacy path) | Manual smoke: complete a test paid checkout, verify buyer receives the existing ticket-confirmation email with PDF + .ics |
| SC-5 | A failed_retryable row gets retried by the sweeper within 5 minutes (Option A) or 10 minutes (Option B) of becoming retryable | Inject a failure (e.g. temporarily wrong Resend key), trigger refund, observe row goes failed_retryable, restore key, observe sweeper retries within next tick |
| SC-6 | An unknown `template_key='garbage'` payload immediately goes failed_terminal with `last_error='unknown_template_key:garbage'` | Unit test: insert a notification row with unknown template_key, dispatch, assert status + last_error |
| SC-7 | A refund row with `channel='sms'` is set to `status='skipped'` with `last_error='channel_not_supported_for_template'`, NOT failed_terminal | Unit test: synthesize a notification row, dispatch, assert |
| SC-8 | The 6 sms failed_terminal rows are NOT touched by the sweeper or dispatcher | MCP probe pre/post-deploy: `SELECT count(*) FROM ticket_order_notifications WHERE status='failed_terminal' AND channel='sms'` returns 6 in both runs |
| SC-9 | Strict-grep CI gate passes 6/6 (or 7/7 if Option A substrate is chosen) | `node .github/scripts/strict-grep/orch-0788-notification-template-key-dispatched.mjs` exits 0 |
| SC-10 | Deno tests pass for ticket-confirmation-dispatch + buyerLifecycleAdapters + notification-retry-sweeper | `deno test supabase/functions/ticket-confirmation-dispatch/__tests__/ supabase/functions/_shared/email/__tests__/ supabase/functions/notification-retry-sweeper/__tests__/` exits 0 |
| SC-11 | No regression in ORCH-0785 invariants AM/AN/AO | Existing strict-grep gates ORCH-0785-A..E continue to PASS in CI |
| SC-12 | Idempotency: replaying the existing 14 unsent rows (after deploy) does NOT cause duplicate buyer emails | Verify via Resend dashboard (operator-checked) — only one email per `idempotency_key` |

---

## 12. Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Refund-issued email renders | `{template_key:'buyer_refund_issued', amount_cents:5000, currency:'USD', reason:'Customer request', is_full_refund:true}` + buyer context | Generic body with title `"Your refund for <event> is on the way"`, paragraphs include amount + reason, NO PDF, NO calendar; sender=tickets@usemingla.com | Deno test on `buyerLifecycleAdapters.refundIssuedToGenericBody` |
| T-02 | Partial refund email | Same as T-01 with `is_full_refund:false` | Title "A partial refund..."; paragraph "The remaining tickets on this order are still valid." present | Deno test |
| T-03 | Refund without reason | T-01 payload minus `reason` | Reason paragraph absent; rest unchanged | Deno test |
| T-04 | Cancel email renders | `{template_key:'buyer_order_cancelled', reason:'Event postponed'}` + buyer context | Title `"Your order ... has been cancelled"`, paragraphs include reason + "tickets no longer valid" | Deno test |
| T-05 | Cancel without reason | Cancel payload minus reason | Reason paragraph absent | Deno test |
| T-06 | Dispatcher routes refund row | Insert notification row with refund payload, invoke dispatcher with that order's ID | Row goes pending → sending → sent with provider='resend', provider_message_id non-null | Deno + Supabase test client |
| T-07 | Dispatcher routes cancel row | Same as T-06 with cancel payload | Same end-state | Deno + Supabase test client |
| T-08 | Dispatcher preserves ticket-confirmation | Insert legacy row (payload `{checkoutSessionId:...}` no template_key) + matching order, dispatch | Buyer ticket confirmation email sent with PDF + .ics attachments (full legacy path preserved) | Deno + Supabase test client |
| T-09 | Unknown template_key → failed_terminal | Insert row with `payload.template_key='nope'` | Status flips to failed_terminal, last_error='unknown_template_key:nope', no email sent | Deno test |
| T-10 | Refund with channel=sms → skipped | Insert refund row with `channel='sms'` (synthetic) | Status='skipped', last_error='channel_not_supported_for_template' | Deno test |
| T-11 | refund-order inline-dispatches | Mock dispatcher fetch in test, call refund-order edge fn end-to-end | One dispatcher fetch call observed per refund | Deno test on refund-order/index.test.ts |
| T-12 | cancel-order inline-dispatches | Same as T-11 for cancel-order | One dispatcher fetch call observed per cancel | Deno test |
| T-13 | stripeWebhookRouter refund inline-dispatches | Mock dispatcher fetch, fire a charge.refunded webhook | One dispatcher fetch call observed | Deno test on stripeWebhookRouter.test.ts |
| T-14 | Sweeper picks up retryable rows past backoff | Insert row status='failed_retryable', attempt_count=1, updated_at=now()-5min, invoke sweeper | Row's order_id appears in `results[].dispatched` list; row re-dispatches | Deno + Supabase test |
| T-15 | Sweeper skips rows inside backoff window | Insert row status='failed_retryable', attempt_count=2, updated_at=now()-30sec | Row NOT in dispatched list (4 min backoff not elapsed) | Deno test |
| T-16 | Sweeper hits attempt cap | Insert row status='failed_retryable', attempt_count=3 | Row excluded by `.lt('attempt_count', 3)` filter | Deno test |
| T-17 | Sweeper batch cap | Insert 60 retryable rows past backoff | Only 50 dispatched in single tick; remaining 10 picked up next tick | Deno + Supabase test |
| T-18 | Sweeper ignores failed_terminal rows | The 6 sms failed_terminal rows in production | Untouched by any sweeper invocation | MCP probe pre/post run |
| T-19 | Replay safety on existing 14 stuck rows | After deploy, invoke dispatcher for each affected order_id | Each row goes to sent (success) OR failed_retryable→…→failed_terminal; NO duplicate emails per idempotency_key | Manual smoke + MCP probe |
| T-20 | Idempotency under concurrent invocation | Invoke dispatcher twice in parallel for same order_id | Status='sending' flip serializes; second invocation finds rows already sending; no double-send | Race test (best-effort; lightweight check) |
| T-21 | EmailVariant union not modified | Diff `_shared/email/types.ts` and `_shared/email/index.ts` | No new union members; `_exhaustive: never` sentinels unchanged | git diff verification |
| T-22 | Brand shell invariant I-PROPOSED-AM preserved | Strict-grep ORCH-0785-D continues to pass | Existing gate green | CI |
| T-23 | Resend no-sandbox invariant I-PROPOSED-AN preserved | Strict-grep ORCH-0785-B continues to pass | Existing gate green | CI |
| T-24 | Buyer string HTML-escaping invariant I-PROPOSED-AO preserved | All adapter functions use `escapeHtml` for user-supplied strings (reason, buyerName) | Code review + grep | Static analysis |
| T-25 | Migration probes fail loudly on missing extensions (Option A only) | Apply migration on a project without pg_cron | RAISE EXCEPTION fires; migration aborts | Operator-confirmed |
| T-26 | iOS / Android / Web parity | Operator triggers refund from mingla-business iPhone, Android, and web buyer-facing checkout | Buyer email arrives in all three cases | Operator smoke |

---

## 13. Implementation order

1. **Adapters first** — create `supabase/functions/_shared/email/buyerLifecycleAdapters.ts` with the two functions + types. Add Deno tests covering T-01 through T-05.
2. **Dispatcher upgrade** — modify `ticket-confirmation-dispatch/index.ts` per §7. Move existing ticket-confirmation render block into the `buyer_ticket_confirmation` case. Add the new switch + unknown-template handling. Add SELECT payload. Add Deno tests covering T-06 through T-10.
3. **Writer inline-dispatch** — add inline dispatch calls + import to `refund-order/index.ts`, `cancel-order/index.ts`, `_shared/stripeWebhookRouter.ts`. Update misleading comments. Add Deno tests T-11 through T-13.
4. **Sweeper edge function** — create `supabase/functions/notification-retry-sweeper/index.ts`. Add Deno tests T-14 through T-18.
5. **Substrate choice** — implementor picks Option A or B. If A: create migration `20260527000000_orch_0788_notification_retry_cron.sql` per §4.2. If B: create workflow `.github/workflows/notification-retry-sweeper.yml`.
6. **Strict-grep gate** — create `.github/scripts/strict-grep/orch-0788-notification-template-key-dispatched.mjs` per §9. Register as new job in existing workflow.
7. **Local gates** — `deno check` clean on all 4 modified/new functions; `deno test` clean on all new test files; `npx tsc --noEmit` clean for mingla-business (should be no-op since this is edge-side only); `node .github/scripts/strict-grep/orch-0788-*.mjs` PASS.
8. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` with old→new receipts per file changed, substrate-choice rationale, all 26 test results, pre-flight probe of current queue state (re-verify the 14 unsent rows are still there or document if operator cleaned), and DIAG marker reap.
9. **Return to operator** — operator runs `supabase db push --linked` (only if substrate Option A — single new migration). Then orchestrator deploys the 4 touched edge functions (`ticket-confirmation-dispatch`, `refund-order`, `cancel-order`, `notification-retry-sweeper`) + redeploys `stripe-webhook` (since stripeWebhookRouter is in `_shared/`).

DIAG markers `[ORCH-0788-DIAG]` are permitted during dev+test but MUST be reaped before CLOSE.

---

## 14. Invariants

### New invariant (DRAFT → ACTIVE on CLOSE)

**I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED**

**Statement:** Every `public.ticket_order_notifications` row with `payload->>'template_key' IS NOT NULL` MUST be processable by `ticket-confirmation-dispatch` without falling back to the legacy `buyer_ticket_confirmation` renderer. Every template_key value referenced by ANY writer (current writers: `buyer_refund_issued`, `buyer_order_cancelled`; future: any new key) MUST have a matching case in the dispatcher's switch statement. Unknown template_keys MUST flip the row to `failed_terminal` with `last_error='unknown_template_key:<value>'` rather than rendering the wrong template silently. NULL `template_key` implies `buyer_ticket_confirmation` legacy default (backward compat for rows written by `biz_ticket_checkout_finalize_session` RPC).

**Rationale:** ORCH-0788 RC-1 — pre-fix, the dispatcher ignored `payload.template_key` entirely; refund/cancel rows would have been rendered as ticket-confirmation emails (silently wrong) or stuck pending (silently invisible). Both failure modes violate Constitution #3 (No silent failures).

**Enforcement mechanism:**
- Strict-grep CI gate `orch-0788-notification-template-key-dispatched` (§9) — asserts dispatcher SELECTs payload, references each known template_key value, and writers import + call `dispatchTicketConfirmation`.
- Deno unit tests T-06 through T-10 — exercise each switch branch including the unknown-template-key defensive path.
- The exhaustive `default: { ... failed_terminal with last_error='unknown_template_key:<value>' }` in the dispatcher itself.

**Test that catches regression:** strict-grep gate + Deno tests. A future writer adding a new `template_key='buyer_event_postponed'` without adding a matching dispatcher case would (a) fail the strict-grep gate at PR time AND (b) flip rows to `failed_terminal` at runtime — surfaces visibly via the existing brand-team SELECT RLS policy.

**Status:** DRAFT — flips to ACTIVE on ORCH-0788 CLOSE.

### Invariants preserved

| Invariant | Status | Note |
|---|---|---|
| I-PROPOSED-AM EMAIL_BRAND_SHELL_SINGLETON | preserved | All new emails go through `renderTransactionalEmail` → `renderShell` |
| I-PROPOSED-AN RESEND_NO_SANDBOX_SENDER | preserved | `assertNotResendSandbox` still gates sender (already in dispatcher line 350; preserved in upgrade) |
| I-PROPOSED-AO BUYER_INPUT_HTML_ESCAPED | preserved | Adapter functions use `escapeHtml` for buyerName + reason (the only user-supplied strings) |
| I-PROPOSED-AP TICKET_PDF_PRIVACY | N/A for refund/cancel | No PDF attached on refund/cancel paths |
| I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER | preserved | Untouched layer |
| Constitution #2 (One owner per truth) | preserved | `ticket_order_notifications` remains sole queue authority |
| Constitution #3 (No silent failures) | **strengthened** | Pre-fix: 14 rows silently stranded. Post-fix: every failure mode surfaces (sent/failed_retryable/failed_terminal/skipped with last_error) |
| Constitution #8 (Subtract before adding) | preserved | Comment updates replace misleading text; no dead code added |
| Constitution #13 (Exclusion consistency) | partially deferred | CF-1 (SMS for refund/cancel) explicitly deferred per §10.1 |

---

## 15. Regression prevention

- **Class of bug:** writer code coded to a sender contract the sender doesn't honor (RC-1 + RC-2).
- **Structural safeguard:** I-PROPOSED-BA + the strict-grep gate. Any new template_key in a writer MUST be matched in the dispatcher, OR CI fails.
- **Protective comment:** the dispatcher's switch statement gets a comment block at the top documenting I-PROPOSED-BA and pointing to this SPEC.
- **Long-term:** the exhaustive `default: { failed_terminal with last_error='unknown_template_key:<value>' }` in code means even if the CI gate is bypassed, runtime rows surface visibly via brand-team SELECT instead of silently rendering the wrong template.

---

## 16. Rollback plan

### DB rollback (Option A substrate only — sweeper cron)
```sql
SELECT cron.unschedule('orch_0788_notification_retry_sweeper')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper');
```
Re-run the operator's previous-known-good migration apply. The migration itself is purely additive; no data destruction.

### Edge function rollback
Deploy previous version of `ticket-confirmation-dispatch`, `refund-order`, `cancel-order`, `stripe-webhook` from `main` pre-PR. Delete `notification-retry-sweeper` function via Supabase dashboard (or `supabase functions delete notification-retry-sweeper --project-ref gqnoajqerqhnvulmnyvv`).

### Data rollback
None needed. The 14 currently-stuck rows remain stuck (same as before the fix). New rows enqueued during the broken window stay `pending`; idempotency_key uniqueness protects against future replay corruption.

### Forward-fix preferred
If any P0 surfaces post-deploy, prefer forward-fix (hot-patch the dispatcher) over rollback. The change is additive — rolling back loses the refund/cancel flow that just became functional.

---

## 17. References

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md`
- Dispatch prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md`
- Shared email module: `supabase/functions/_shared/email/` (index.ts, types.ts, shell.ts, ticketBody.ts, genericBody.ts, senders.ts, escape.ts, calendar.ts, currency.ts, dateLine.ts, copy.ts)
- Existing dispatcher: `supabase/functions/ticket-confirmation-dispatch/index.ts`
- Existing writers: `supabase/functions/refund-order/index.ts`, `cancel-order/index.ts`, `_shared/stripeWebhookRouter.ts`
- Existing helper: `supabase/functions/_shared/ticketCheckout.ts:119-135` (`dispatchTicketConfirmation`)
- Schema: `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:153-194` (table) + `20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:199-218` (finalize RPC enqueue)
- ORCH-0785 invariants registry: `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-PROPOSED-AM/AN/AO/AP)
- CLAUDE memory: `feedback_strict_grep_registry_pattern.md`, `feedback_orchestrator_deploys_edge_functions.md`
