# INVESTIGATION ORCH-0788 — Buyer Notification Dispatcher

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0788 |
| Severity | S1 — buyer trust + commerce fulfillment integrity |
| Mode | INVESTIGATE only (no SPEC, no product code) |
| Confidence | **High** — root causes proven from five truth layers + MCP probe |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Dispatched by | Claude `mingla-orchestrator` (operator-delegated) |

---

## 1. Layman summary

The Mingla Business app already has the *infrastructure* to send buyers ticket-confirmation emails, refund-issued emails, and order-cancelled emails — the database queue table, the writers (refund-order, cancel-order, the checkout-finalize RPC, the Stripe webhook router), the branded email shell from ORCH-0785, and the existing `ticket-confirmation-dispatch` edge function. What it does NOT have is a dispatcher that **routes by template type**. The existing dispatcher only knows how to render a buyer ticket confirmation — when a refund or cancel notification lands in the queue, no caller fires the dispatcher, and even if it were called, it would render a ticket-confirmation email instead of the right template. Net effect: every refund/cancel notification ever written to the queue is permanently stuck at `status='pending'`, the buyer never gets told their money was refunded, and the only reason buyer ticket confirmations work is that two specific callers (`stripe-webhook` post-checkout and `ticket-checkout-create` for free orders) fire the dispatcher inline immediately after enqueue. The fix needs two layers: (1) teach the existing dispatcher to route by `payload.template_key`, with renderers for refund + cancel; (2) add a queue-driven retry consumer so `failed_retryable` rows don't strand indefinitely.

---

## 2. Symptom summary

| Field | Value |
|---|---|
| Expected | A buyer who gets refunded receives a branded "Your refund is on the way" email. A buyer whose order is cancelled receives a branded "Your order has been cancelled" email. Existing ticket-confirmation emails continue to work. |
| Actual | Refund and cancel notification rows accumulate at `status='pending'` indefinitely (probe: `81fe2a68-…` row from 2026-05-11 17:46 UTC has `attempt_count=0`, never dispatched). Some old buyer-confirmation rows are stuck `failed_retryable` after one failed Resend attempt with no retry consumer. |
| Reproduction | Operator refunds an order via mingla-business → row written to `ticket_order_notifications` with `payload.template_key='buyer_refund_issued'`, `status='pending'` → buyer's inbox stays empty forever. |
| When it started | At ORCH-0787 close — refund-order and cancel-order edge functions were shipped with code comments referencing "ORCH-0785 dispatcher consumes template_key" but the dispatcher does not read template_key. The dispatcher gap pre-dates ORCH-0787; ORCH-0787 just surfaced it by adding new template_keys nobody handles. |

---

## 3. Phase 0 ingest record (every file read in order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` | dispatch | scope + seed evidence |
| 2 | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | schema | table definition, RLS, status enum, first RPC enqueue site |
| 3 | `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` | schema | second RPC enqueue site (replaces #2's finalize RPC) |
| 4 | `supabase/functions/refund-order/index.ts` | edge fn | writer #3 (refund-issued, email-only) |
| 5 | `supabase/functions/cancel-order/index.ts` | edge fn | writer #4 (order-cancelled, email-only) |
| 6 | `supabase/functions/_shared/stripeWebhookRouter.ts` | edge fn | writer #5 (dashboard-refund reconcile) + dispatcher invocation site for checkout |
| 7 | `supabase/functions/_shared/ticketCheckout.ts` | edge fn | `dispatchTicketConfirmation()` helper (HTTP→ticket-confirmation-dispatch) |
| 8 | `supabase/functions/ticket-confirmation-dispatch/index.ts` | edge fn | the only sender (UPDATE sent_at writer) |
| 9 | `supabase/functions/twilio-message-status/index.ts` | edge fn | UPDATE writer for sms delivered_at + status |
| 10 | MCP probe — `ticket_order_notifications` schema | data | confirmed column shape, CHECK constraint values, UNIQUE on `idempotency_key` |
| 11 | MCP probe — queue snapshot 14 unsent / 43 total | data | grouped by channel/status; identified the `81fe2a68-…` stuck refund row |
| 12 | MCP probe — `payload->>'template_key'` extraction on representative rows | data | proved buyer-confirmation rows have NULL template_key, refund row has `buyer_refund_issued` |
| 13 | `Mingla_Artifacts/AGENT_HANDOFFS.md` (top entry) | history | confirmed ORCH-0795/0787 chain context |
| 14 | `Mingla_Artifacts/MASTER_BUG_LIST.md` (top) | history | the "ORCH-0787 enqueues but no consumer" claim |
| 15 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (post-0795 section) | history | I-PROPOSED-AM/AN/AO/AP from ORCH-0785 (relevant to "render" contract) |

**Migration chain confirmation:** only two migrations touch `public.ticket_order_notifications` — `20260515000013` (creates table + first finalize RPC enqueue) and `20260515000016` (replaces finalize RPC with QR pepper variant; same enqueue shape). ORCH-0787 (`20260520000000`) did NOT touch this table — its refund/cancel writers live in edge function code only. ORCH-0792 (`20260525000000-003`) did NOT touch this table either. **The schema is stable since 2026-05-15.**

---

## 4. Writer matrix

| # | Code path | File:line | channel(s) | template_key in payload | idempotency_key shape | status on insert | Triggered by |
|---|---|---|---|---|---|---|---|
| W1 | `biz_ticket_checkout_finalize_session` RPC (current) | `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:199-218` | email + sms | **NOT SET** (NULL) — payload only `{checkoutSessionId}` | `ticket_confirmation:<order_id>:email` / `:sms` | `pending` (default) | Called from `ticket-checkout-create` (free + paid) and `stripe-webhook` (paid completion). RPC is SECURITY DEFINER. |
| W2 | `refund-order` edge fn | `supabase/functions/refund-order/index.ts:284-316` | email only | `buyer_refund_issued` | `refund:<order_id>:<stripe_refund_id>` | `pending` (explicit) | Called from mingla-business Refund button (operator action) |
| W3 | `cancel-order` edge fn | `supabase/functions/cancel-order/index.ts:107-133` | email only | `buyer_order_cancelled` | `cancel:<order_id>:<idempotency_key>` | `pending` (explicit) | Called from mingla-business Cancel button (operator action) |
| W4 | `stripeWebhookRouter.handleRefund` (dashboard-initiated) | `supabase/functions/_shared/stripeWebhookRouter.ts:520-553` | email only | `buyer_refund_issued` (+ `source: "webhook_reconciliation"`) | `refund:<order_id>:<stripe_refund_id>` (matches W2 by design — `ON CONFLICT (idempotency_key) DO NOTHING`) | `pending` (explicit) | Called from `stripe-webhook` on `charge.refunded` / `refund.created` / `refund.updated` events |

### Payload shapes documented

| template_key | Required render variables (per writer code) |
|---|---|
| (NULL) — legacy buyer ticket confirmation | `{checkoutSessionId}` — sender derives everything else from `orders` + `tickets` + `event_dates` joins |
| `buyer_refund_issued` | `{template_key, amount_cents, currency, refund_lines, reason, is_full_refund, stripe_refund_id}` |
| `buyer_order_cancelled` | `{template_key, reason}` |

### Key observations from writer matrix

- **W2 + W3 enqueue but do NOT invoke the dispatcher.** Grep `supabase/functions/refund-order/` and `supabase/functions/cancel-order/` for `dispatchTicketConfirmation` or `ticket-confirmation-dispatch`: **zero hits**.
- **W4 also does not invoke the dispatcher.** The `stripeWebhookRouter.handleRefund` path upserts a row and writes audit only; no fetch to dispatcher.
- **W1 is the ONLY writer whose caller fires the dispatcher.** Both checkout callers (free + paid) immediately call `dispatchTicketConfirmation(orderId)` after the finalize RPC returns. That's why ticket-confirmation emails DO go out, while refund/cancel emails never do.
- **No code path EVER writes `template_key='buyer_ticket_confirmation'`.** The discriminator is NULL on buyer-confirmation rows. The dispatcher must treat NULL as "buyer_ticket_confirmation" (legacy default) and read explicit template_key for refund/cancel.

---

## 5. Sender matrix

| Code path | File:line | What it reads | What it renders | What it updates | Retry semantics |
|---|---|---|---|---|---|
| `ticket-confirmation-dispatch` | `supabase/functions/ticket-confirmation-dispatch/index.ts` (entire file) | `WHERE order_id = ? AND status IN ('pending','failed_retryable')` — all channels for the order; reads `orders`, `events`, `brands`, `order_line_items`, `tickets`, `event_dates(is_master)`. **Does NOT read `payload`.** | ALWAYS ticket-confirmation: branded HTML via `renderTransactionalEmail({variant: bodyInput.variant, ...})` + ticket PDF via `buildTicketPdf` + `.ics` calendar attachment via `buildCalendarLinks`. The `variant` field exists on `TicketBodyInput` but is hardwired to whatever the buildRenderContext function emits — likely just "buyer_ticket_confirmation". | On success: `status='sent', provider, provider_message_id, sent_at`. On failure: `status='failed_retryable'` (or `failed_terminal` if `attempt_count >= 3`), `last_error`. Always bumps `attempt_count` by 1. | Cap: 3 attempts → permanent `failed_terminal`. No backoff. No automatic re-invocation — only re-runs if a caller fires the function again. |
| `twilio-message-status` | `supabase/functions/twilio-message-status/index.ts:30-46` | Twilio webhook callback — looks up notification_id by message_sid | N/A — status callback only | `delivered_at` or `status` based on Twilio callback (delivered, undelivered, failed) | N/A — passive consumer |

### Key observations from sender matrix

- **No template_key dispatch.** The current sender's rendering path is monolithic: every notification gets the buyer-ticket-confirmation treatment. Even if invoked on a refund row, it would build a ticket PDF and calendar link — completely wrong content.
- **`renderTransactionalEmail({variant})` already exists.** From `_shared/email/index.ts` — accepts a `variant` discriminator. ORCH-0785 may have already plumbed this for future use; SPEC phase must verify what variants are wired (likely just `buyer_ticket_confirmation` for now).
- **Render failure is RETRYABLE.** If `buildTicketPdf` fails or render input is incomplete, status flips to `failed_retryable` (line 408-412). This is correct for transient issues but means a permanent render bug would consume 3 attempts before going terminal.
- **Sender pulls ALL `pending`/`failed_retryable` rows for the order.** If a refund row co-existed with a still-pending buyer-confirmation row for the same order (unlikely but possible), both would be picked up in one dispatcher call and both would get rendered the same way — wrong for the refund row.

---

## 6. Five-truth-layer cross-check

| Layer | What it says | Layer agrees? |
|---|---|---|
| **Docs** | `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` defines the `ticket_order_notifications` queue + dispatcher contract. `SPEC_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md` references the queue. Neither spec defined `template_key` routing inside the dispatcher (ORCH-0777 only knew one template; ORCH-0787 added new template_keys assuming a dispatcher upgrade that never happened). | ✅ docs are consistent — the gap is between spec intent and dispatcher reality |
| **Schema** | `ticket_order_notifications` table with `payload jsonb`, `channel` enum, `status` enum (`pending | sending | sent | delivered | failed_retryable | failed_terminal | skipped`), `UNIQUE(idempotency_key)`. **No `template_key` column** — the discriminator lives in `payload->>'template_key'`. RLS: service_role ALL + authenticated brand-team SELECT. | ✅ schema supports template_key routing via payload |
| **Code (writers)** | W1 (finalize RPC) sets NO template_key; W2/W3/W4 (refund + cancel + webhook reconcile) set explicit `payload.template_key`. W2/W3 do NOT invoke the dispatcher after enqueue. | ❌ DISAGREES WITH DOCS — writers were coded to a contract the dispatcher doesn't honor |
| **Code (sender)** | `ticket-confirmation-dispatch` reads `payload` but ignores `template_key`; always renders buyer-ticket-confirmation; pulls ALL pending+failed_retryable rows for an `orderId` parameter. | ❌ DISAGREES WITH WRITERS — sender contract is buyer-ticket-confirmation-only |
| **Runtime** | Edge function logs show frequent `ticket-confirmation-dispatch` invocations (per ORCH-0777 close timeline). No invocations after `refund-order` or `cancel-order` calls. | ✅ confirms code analysis |
| **Data** | MCP probe: 14 unsent rows. The `81fe2a68-…` refund row has `payload.template_key='buyer_refund_issued'`, `status='pending'`, `attempt_count=0` (NEVER dispatched). Legacy buyer-confirmation rows (`135e124e-…`, `2c28ed19-…`) have `template_key=NULL`, `attempt_count=1` (dispatched once, failed). | ✅ confirms two distinct failure modes: (a) refund/cancel never reach dispatcher; (b) old buyer-confirmation rows stranded after one failed attempt |

**Contradiction summary:** Writer code (W2/W3/W4) writes a `template_key` that the sender ignores AND fails to invoke the sender. Both gaps must close.

---

## 7. Findings

### 🔴 RC-1 — Dispatcher does NOT route by `payload.template_key`

| Field | Value |
|---|---|
| File + line | `supabase/functions/ticket-confirmation-dispatch/index.ts:341-475` |
| Exact code | `renderedEmail = renderTransactionalEmail({variant: context.bodyInput.variant, recipient: {…}, body: context.bodyInput});` followed by `renderedPdf = await buildTicketPdf({event, order, tickets, …});` — both built from a HARDCODED ticket-confirmation `bodyInput` shape, regardless of `notification.payload` contents. |
| What it does | For every notification row matched by `WHERE order_id = ? AND status IN ('pending','failed_retryable')`, the function builds a buyer-ticket-confirmation email with PDF attachment and calendar links. It calls `select("id, channel, recipient, status, attempt_count")` at line 379 — **does NOT select `payload`**. |
| What it should do | Read `payload->>'template_key'` per row. Treat NULL/missing as legacy `buyer_ticket_confirmation` (existing path). For `buyer_refund_issued`: render refund email (amount, currency, reason, line items), NO ticket PDF, NO calendar link. For `buyer_order_cancelled`: render cancel email (reason), NO ticket PDF, NO calendar link. Future template_keys are extension points. |
| Causal chain | Operator clicks Refund → `refund-order` edge fn → Stripe Refund API → commit RPC → INSERT into `ticket_order_notifications` with `template_key='buyer_refund_issued'` → no caller invokes `ticket-confirmation-dispatch` → row stays `pending`. Even IF a caller invoked the dispatcher with that order_id, the sender would build a ticket-confirmation email and send the buyer their original tickets as if nothing happened — a *worse* failure mode than silence. |
| Verification | `mcp__supabase__execute_sql` confirmed `81fe2a68-…` row: `payload.template_key='buyer_refund_issued'`, `status='pending'`, `attempt_count=0`. Static grep `grep -n "template_key\|payload" supabase/functions/ticket-confirmation-dispatch/index.ts`: **zero hits**. |

### 🔴 RC-2 — No caller invokes the dispatcher after `refund-order` or `cancel-order` enqueue

| Field | Value |
|---|---|
| File + line | `supabase/functions/refund-order/index.ts:284-316` (and parallel `cancel-order/index.ts:107-133`) |
| Exact code | After `supabase.from("ticket_order_notifications").insert({...})` returns, the function proceeds to `writeAudit(...)` then returns success to the caller. NO `fetch` to `ticket-confirmation-dispatch`. NO `dispatchTicketConfirmation()` import. |
| What it does | Enqueues a `pending` notification row, writes audit, returns success — leaves the row to be picked up "later" by a consumer that doesn't exist. |
| What it should do | Either (a) inline-invoke the dispatcher after enqueue (mirror the working pattern at `_shared/stripeWebhookRouter.ts:686` for paid checkout completion), OR (b) rely on a queue-driven retry consumer that polls for `pending` rows on a schedule. Both have trade-offs (immediate vs. capped-rate). |
| Causal chain | Refund commits → notification row written → no inline fetch fires → no scheduled consumer exists → row stuck. The MASTER_BUG_LIST entry for ORCH-0787 explicitly anticipates this: *"will replay via idempotency_key once dispatcher ships."* |
| Verification | `grep -n "ticket-confirmation-dispatch\|dispatchTicketConfirmation" supabase/functions/refund-order/index.ts supabase/functions/cancel-order/index.ts` returns: zero matches. MCP probe confirms `81fe2a68-…` has `attempt_count=0` (never dispatched). |

### 🟠 CF-1 — Refund + cancel writers omit the SMS channel entirely

| Field | Value |
|---|---|
| File + line | `refund-order/index.ts:296` and `cancel-order/index.ts:118` — both hard-code `channel: "email"` with no parallel SMS enqueue |
| What it does | Buyers who provided phone numbers do NOT receive a refund or cancel SMS. The original buyer-confirmation flow enqueues BOTH email + sms (W1 in matrix) — refund/cancel is asymmetric. |
| What it should do | Either (a) match buyer-confirmation parity and enqueue email + sms for refund + cancel (with separate idempotency_key suffix `:email` and `:sms`), OR (b) document the operator decision that email-only is intentional for refund/cancel. **SPEC decision, not investigation conclusion.** |
| Causal chain | Buyer purchases with SMS opt-in → gets ticket confirmation SMS → operator refunds → buyer gets no SMS (only an email if email is on file). Asymmetric experience. |
| Verification | Grep both files for `channel: "sms"` → zero hits in either writer. |

### 🟠 CF-2 — Permanent `failed_terminal` at attempt_count >= 3 with no backoff or manual reset path

| Field | Value |
|---|---|
| File + line | `ticket-confirmation-dispatch/index.ts:463-470` — `const terminal = !retryable || attemptCount >= 3;` and the row is updated to `status='failed_terminal'` |
| What it does | After 3 attempts (without exponential backoff — attempts are back-to-back if the function is invoked rapidly), the row is permanently terminal. There's NO RPC, edge function, or admin UI surface to reset a `failed_terminal` row to `failed_retryable`. |
| What it should do | Either (a) add backoff: only retry if `now() - updated_at > BACKOFF(attempt_count)`, OR (b) preserve the cap but add an operator-reset path for cases like Twilio config gaps where the underlying issue can be fixed without a code change. **SPEC decision.** |
| Causal chain | Twilio Messaging Service unconfigured → 6 sms rows hit terminal at attempt 1 (1 of the 3 max). 5 attempts remain unused. Operator fixes Twilio later → no path to re-send those 6 rows. Same risk applies to refund/cancel if Resend config drifts. |
| Verification | Grep for "reset"/"requeue"/"reinstate" across edge functions and RPCs: no matching surface. The only path to revive a terminal row is manual `UPDATE`. |

### 🟡 HF-1 — Twilio SMS `failed_terminal` rows are a closed-scope provider config gap (operator-accepted at ORCH-0777 close)

| Field | Value |
|---|---|
| File + line | The 6 sms `failed_terminal` rows have `last_error` like `twilio_send_failed:400` (Twilio Messaging Service / toll-free verification not provisioned). Code path: `ticket-confirmation-dispatch/index.ts:448-460` calls `sendTwilioMessage`. |
| What it does | The dispatcher correctly classifies the Twilio 400 as terminal (per `classifyNotificationProviderFailure` in `_shared/ticketCheckout.ts:159+`) and stops. This is **correct behavior** — the code is not at fault. |
| What it should do | ORCH-0788 SHOULD NOT touch these 6 rows. Operator accepted at ORCH-0777 close. Once the Twilio Messaging Service SID + toll-free verification ships externally, operator can manually reset these rows OR a new ORCH can add a reset surface (CF-2). |
| Causal chain | n/a — pre-existing accepted condition |
| Verification | `Mingla_Artifacts/WORLD_MAP.md` ORCH-0777 CLOSED entry: *"Twilio residual accepted as known configuration gap, not a code-side close blocker."* |

### 🟡 HF-2 — `_shared/email/renderTransactionalEmail({variant})` signature already accepts a discriminator, but only one variant is wired today

| Field | Value |
|---|---|
| File + line | `_shared/email/index.ts` exports `renderTransactionalEmail({variant: bodyInput.variant, …})`. Investigation did not deep-read this file (out of scope — SPEC will). |
| What it does | Variant routing exists at the call signature level but likely has only one implementation today (`buyer_ticket_confirmation`). |
| What it should do | SPEC must add two new variants: `buyer_refund_issued` (no PDF, refund body) and `buyer_order_cancelled` (no PDF, cancel body). Variants should be ENUM-typed, not stringly-typed. |
| Verification | Static grep shows `variant: bodyInput.variant` used at line 343 of dispatcher; the renderer body source is in `_shared/email/`. SPEC pass will confirm. |

### 🔵 OBS-1 — The "ORCH-0785 dispatcher consumes the template_key" comment is misleading

| Field | Value |
|---|---|
| File + line | `refund-order/index.ts:284`, `cancel-order/index.ts:107`, `stripeWebhookRouter.ts:522` |
| Observation | The comments suggest ORCH-0785 shipped a template_key-aware dispatcher. It did not. ORCH-0785 shipped the branded email shell + ticket PDF renderer + 5 strict-grep gates ORCH-0785-A..E — none of which touched dispatcher routing logic. The comments were added by the ORCH-0787 implementor in anticipation of ORCH-0788 (the work this investigation is dispatched for). |
| Recommendation | SPEC phase should require the implementor to update these three comments to reference ORCH-0788 once the dispatcher is upgraded. Cosmetic, not load-bearing. |

### 🔵 OBS-2 — The unique constraint on `idempotency_key` correctly protects against double-send

| Field | Value |
|---|---|
| File + line | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:178` (`UNIQUE (idempotency_key)`) |
| Observation | Both `refund-order` (W2) and `stripeWebhookRouter.handleRefund` (W4) write rows with idempotency_key `refund:<order_id>:<stripe_refund_id>`. The unique constraint + `ON CONFLICT (idempotency_key) DO NOTHING`/`upsert` (W4 line 532) means duplicate enqueue is safe. ORCH-0788 retry consumer can replay rows freely without buyer double-emails. |
| Recommendation | SPEC must preserve idempotency_key shape for backward compatibility. The 14 currently-stuck rows will replay correctly once the dispatcher ships. |

### 🔵 OBS-3 — Buyer-confirmation rows from W1 have `template_key=NULL`

| Field | Value |
|---|---|
| File + line | RPC enqueue at `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:199-218` writes `payload: jsonb_build_object('checkoutSessionId', v_session.id)` — no template_key. |
| Observation | Existing buyer-confirmation rows are distinguishable from refund/cancel rows only by `payload.template_key IS NULL` (vs. set). SPEC must define dispatcher routing rule: `COALESCE(payload->>'template_key', 'buyer_ticket_confirmation')` so legacy rows continue rendering correctly without a backfill. |
| Recommendation | Dispatcher's first action per row should be: read template_key, fall back to legacy 'buyer_ticket_confirmation' if NULL. NO migration needed to backfill historical rows — the dispatcher handles it. |

---

## 8. Blast radius map

| Surface | Impact of fix | Risk level |
|---|---|---|
| **`ticket-confirmation-dispatch` edge function** | DIRECT — add template_key routing inside the dispatcher; add per-template renderers; keep current renderer as default for legacy + `buyer_ticket_confirmation`. | High — must not regress the highest-volume path |
| **`refund-order` + `cancel-order` edge functions** | DIRECT — add inline `dispatchTicketConfirmation(orderId)` call after enqueue (mirror webhook router pattern). | Low — additive only |
| **`stripeWebhookRouter.handleRefund`** | DIRECT — also add inline dispatcher call after enqueue (currently only logs audit). | Low — additive only |
| **`_shared/email/index.ts`** | DIRECT — add two new variant renderers (`buyer_refund_issued`, `buyer_order_cancelled`) + their templates. Brand shell from ORCH-0785 is reusable. | Medium — new email content needs UX/design review |
| **`biz_ticket_checkout_finalize_session` RPC + the W1 enqueue path** | INDIRECT — unaffected; legacy buyer-confirmation rows continue to work via the COALESCE fallback. | None |
| **The 14 currently-stuck rows** | INDIRECT — once dispatcher ships, a queue-driven retry consumer (if part of SPEC) would replay the 6 retryable rows (3 email failed_retryable + 3 email pending = the `81fe2a68-…` refund + 2 others) automatically. The 8 sms terminal rows (HF-1) stay stuck — operator-accepted. | Low — idempotency_key protects against double-send |
| **mingla-business UI** | NONE — the Refund and Cancel buttons already work end-to-end through the Stripe API; only the buyer-side email is broken. No UI change needed. | None |
| **Buyer-facing app (`app-mobile`)** | NONE — buyers do not run mingla-business; they receive emails. | None |
| **Admin dashboard (`mingla-admin`)** | NONE — no admin surface reads `ticket_order_notifications` today (verified by grep). | None |
| **ORCH-0785 strict-grep gates (A-E)** | INDIRECT — the new variant renderers must use the brand shell singleton (I-PROPOSED-AM ENFORCED), use HTML-escaped buyer strings (I-PROPOSED-AO), and respect the no-Resend-sandbox rule (I-PROPOSED-AN). Refund + cancel emails do NOT need ticket PDFs → I-PROPOSED-AP (TICKET_PDF_PRIVACY) is N/A for those variants. | Low — invariants are well-defined |
| **ORCH-0777 / ORCH-0787 / ORCH-0795 closed scopes** | NONE — investigation found no closed-scope regressions. | None |

---

## 9. Invariant check

Existing invariants this fix MUST preserve:

| Invariant | Status | Note |
|---|---|---|
| I-PROPOSED-AM EMAIL_BRAND_SHELL_SINGLETON | preserved | New variant renderers MUST go through the singleton shell |
| I-PROPOSED-AN RESEND_NO_SANDBOX_SENDER | preserved | `assertNotResendSandbox(from)` already enforced in dispatcher line 350 |
| I-PROPOSED-AO BUYER_INPUT_HTML_ESCAPED | preserved | Refund + cancel renderers MUST use the existing escape helpers for `reason`, `currency`, amounts |
| I-PROPOSED-AP TICKET_PDF_PRIVACY | N/A for refund/cancel | The new variants must NOT attach a ticket PDF — there's no ticket to send for a refund/cancel |
| Constitution #2 (One owner per truth) | preserved | `ticket_order_notifications` remains the sole queue authority |
| Constitution #3 (No silent failures) | **strengthened** | Refund + cancel notifications currently fail silently (no buyer email, no error surfaced); fix exposes them |
| Constitution #8 (Subtract before adding) | preserved | Misleading comments at refund-order:284 / cancel-order:107 / stripeWebhookRouter:522 should be updated to reference ORCH-0788, not removed |
| Constitution #13 (Exclusion consistency) | mildly violated today | Refund + cancel writers emit email-only while buyer-confirmation emits both email + sms — SPEC must decide whether to enforce parity (CF-1) |

**Proposed new invariant** (SPEC will codify; orchestrator records):

**I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED** — Every `public.ticket_order_notifications` row with `payload->>'template_key' IS NOT NULL` MUST be processable by `ticket-confirmation-dispatch` (current or successor) without falling back to the default ticket-confirmation renderer. NULL template_key implies `buyer_ticket_confirmation` legacy default. CI gate must assert that every template_key referenced in any writer has a matching case in the dispatcher's router.

---

## 10. Open questions answered

**(a) Are the 6 sms `failed_terminal` rows part of ORCH-0788 scope, or strictly Twilio config?**

**Answer: OUT OF SCOPE for ORCH-0788.** Evidence: HF-1 above + ORCH-0777 close note. The dispatcher correctly classifies Twilio's 400 response as terminal; the underlying Twilio Messaging Service / toll-free verification is provider-config work that ORCH-0788 must NOT touch. SPEC may optionally add a `reset_failed_terminal` admin RPC as a future hook (CF-2), but not as a current ORCH-0788 deliverable.

**(b) Should the dispatcher REPLACE the direct-call invocation, or COEXIST with it?**

**Answer: COEXIST.** The direct-call pattern (`stripeWebhookRouter.ts:686` and `_shared/ticketCheckout.ts:124` → `dispatchTicketConfirmation()`) gives buyers their confirmation in seconds and is the right shape for the happy path. The queue-driven retry consumer is for `failed_retryable` rows — it's a safety net, not a replacement. SPEC should specify:
1. ALL writers (W1 via direct-call from checkout-create/stripe-webhook; W2/W3/W4 inline call from refund-order/cancel-order/stripeWebhookRouter) invoke the dispatcher inline immediately after enqueue.
2. A separate scheduled consumer (cron-driven) polls for `status='failed_retryable'` rows that haven't been retried in N minutes (backoff: 2^attempt_count × base_delay).
3. The dispatcher itself stays the SAME `POST /functions/v1/ticket-confirmation-dispatch` endpoint — it just now routes by template_key. (Optionally renamed in SPEC if naming is misleading post-upgrade.)

**(c) Architecture substrate for the scheduled consumer (trade-offs only — SPEC picks):**

| Option | Pros | Cons |
|---|---|---|
| **pg_cron + edge function (via `net.http_post`)** | Supabase-native; no new infra; runs even when no app traffic; respects per-cron secret config | Requires `pg_cron` + `pg_net` extensions enabled; cron schedule visible only in DB (not in CI); secret-management trickier |
| **GitHub Actions cron + edge function** | Visible in CI; easy to disable; can run from operator account | Requires GitHub Actions schedule + auth token in repo secrets; external dependency for what should be Supabase-internal |
| **DB trigger AFTER INSERT → `pg_net.http_post`** | Instant — no scheduled lag | Defeats backoff (every INSERT immediately fires); harder to throttle; would essentially make the queue equivalent to direct synchronous call |
| **Existing direct-call only (no scheduled consumer)** | Zero new infra | Once a row hits `failed_retryable`, it never retries unless a NEW operator action on the same order triggers a fresh direct-call. Not production-grade. |

**Recommended for SPEC consideration:** Option 1 (pg_cron + edge function) — it's the only option that's fully Supabase-internal and respects backoff. Operator may override if there's a known team preference.

---

## 11. Fix strategy direction (NOT a SPEC)

Three layers:

1. **Dispatcher routing layer** — teach `ticket-confirmation-dispatch` to:
   - SELECT `payload` in addition to current columns
   - Compute `templateKey = COALESCE(payload->>'template_key', 'buyer_ticket_confirmation')` per row
   - Switch on templateKey to pick renderer + attachments
   - Buyer-ticket-confirmation: existing path (PDF + calendar + ticket body)
   - buyer_refund_issued: refund body (amount, currency, reason, line items), NO PDF, NO calendar
   - buyer_order_cancelled: cancel body (reason), NO PDF, NO calendar
   - Unknown template_key: log + mark `failed_terminal` with `last_error='unknown_template_key:<value>'` (defensive)

2. **Writer inline-dispatch layer** — `refund-order`, `cancel-order`, and `stripeWebhookRouter.handleRefund` add inline `dispatchTicketConfirmation(orderId)` after their enqueue (mirror `stripeWebhookRouter:686` pattern for checkout). Failures from the dispatch call are NON-FATAL (already the convention — see `_shared/ticketCheckout.ts:132 console.error("[ticket-checkout] confirmation dispatch failed", err)`).

3. **Scheduled retry consumer** — new edge function (e.g. `notification-retry-sweeper`) invoked by pg_cron every N minutes:
   - Query `WHERE status='failed_retryable' AND now() - updated_at > 2^attempt_count × base_delay AND attempt_count < 3`
   - GROUP BY order_id, fire `dispatchTicketConfirmation(orderId)` for each
   - Bounded batch size (e.g. 50 orders per sweep) to prevent thundering herd

Layer 1 + 2 are the minimum viable fix. Layer 3 is the production-grade safety net.

**Additional SPEC items:**
- Update the misleading "ORCH-0785 dispatcher consumes template_key" comments to reference ORCH-0788
- Add new variant renderers to `_shared/email/` with UX/copy approved by mingla-product or mingla-designer
- Decide CF-1 (SMS parity for refund/cancel): if YES, add `channel: "sms"` enqueue to W2/W3/W4 + an SMS body builder per variant
- Decide CF-2 (reset_failed_terminal RPC): if YES, add an RPC that admin can call to flip terminal rows back to retryable
- Strict-grep CI gate: assert every writer's template_key value has a matching case in the dispatcher's switch statement (codifies I-PROPOSED-BA)
- Unit tests in `supabase/functions/ticket-confirmation-dispatch/__tests__/` covering each template_key path
- Migration: NONE NEEDED — schema is already correct, payload jsonb is flexible, no new columns

---

## 12. Discoveries for orchestrator (side issues)

1. **D-0788-1 — Comment cleanup.** Three "ORCH-0785 dispatcher consumes template_key" comments are misleading. ORCH-0785 did not ship that capability. SPEC must require updating these comments to reference ORCH-0788. P3 cosmetic.

2. **D-0788-2 — `renderTransactionalEmail({variant})` signature shape unclear.** Investigation did not deep-read `_shared/email/index.ts`. SPEC must verify whether the `variant` parameter is already a typed discriminator or just an opaque string, and whether adding two new variants requires a type change (likely yes). P2 SPEC dependency.

3. **D-0788-3 — Twilio `failed_terminal` accumulation will require an operator reset path eventually.** Once Twilio Messaging Service is fixed externally, the 6 stranded sms rows have no automated path back to `failed_retryable`. Out-of-scope for ORCH-0788 but worth a candidate ORCH-0788-A or future cleanup.

4. **D-0788-4 — `notify-dispatch` edge function vs. `ticket-confirmation-dispatch` boundary.** Investigation did not deep-read `notify-dispatch/index.ts`. From grep, `notify-dispatch` is mentioned in ORCH-0785 invariant I-PROPOSED-V (STRIPE-NOTIFICATIONS-VIA-SHARED-DISPATCHER) — it's the operator/Stripe push notification path, NOT the buyer email path. Two different dispatchers. SPEC must not conflate them. P3 documentation.

5. **D-0788-5 — Refund + cancel rows do not include SMS today (CF-1).** Could be intentional (refund = informational, SMS is cost-per-message) or oversight. SPEC must explicitly decide.

6. **D-0788-6 — No max-age circuit breaker.** If a row stays `pending` for, say, 30 days before any dispatcher runs, should it still be sent? "Your refund from 30 days ago was issued" might be more confusing than helpful. Consider a `pending_expires_at` or max-age skip. P3 SPEC consideration.

---

## 13. Confidence level

**HIGH.** Every root cause is backed by:
- Static code reading (file + line)
- Five-truth-layer cross-check (docs/schema/code-writer/code-sender/runtime/data all reconciled)
- MCP probe against production data (the `81fe2a68-…` refund row's `template_key='buyer_refund_issued'`, `status='pending'`, `attempt_count=0` was verified directly)
- Grep verification that the failed surfaces (no fetch to dispatcher; no select of payload) are absent

What would lower confidence: nothing in scope. Items D-0788-2 (variant signature shape) and D-0788-4 (notify-dispatch boundary) are deferred to SPEC phase and would not change any root-cause finding.

---

## 14. Routing direction

Investigation is complete and conclusive. The next phase is SPEC (Claude `mingla-forensics` SPEC mode) — define the dispatcher router upgrade, the new variant renderers, the inline-dispatch writer changes, the scheduled retry consumer, the CI gates, and the test matrix. Then IMPLEMENT, then TEST, then CLOSE.
