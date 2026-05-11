# INVESTIGATION — ORCH-0791: Public buyer repurchase after refund fails with Stripe Failed

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** INVESTIGATE only. No fix proposed.
**Operator symptom (verbatim):** "the error card declined try another payment method i got earlier, always happens after i just gave a refund."

## Symptom summary

When the operator refunds a paid ticket order on the Mingla Business app and then — as the same email + phone — attempts to repurchase the same ticket on the public event page, the iPhone checkout shows "Card declined — try another payment method." This is the same TOAST as the ORCH-0789 cancel-mis-classification symptom (because both surface through the same UX), but the underlying cause is fundamentally different: ORCH-0789 was Stripe returning `Canceled` (which we now silently swallow). This bug is Stripe returning a real `Failed`, which the post-rework code correctly displays as a dismissible decline toast. The fix is not a UX fix — it's an edge-function / RPC fix to stop reusing a terminal session.

## Phase 0 ingestion log

Read in this order:
1. `Mingla_Artifacts/specs/SPEC_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` — confirms the post-rework error-code branching at `payment.tsx:174-176` treats `Canceled` silently and `Failed` as a dismissible toast.
2. `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0789_AND_0790_*.md` — confirms wrapper now passes through `code` faithfully.
3. `Mingla_Artifacts/reports/QA_RETEST_ORCH-0789_AND_0790_*.md` — verified Canceled/Failed/Timeout discrimination works as expected.
4. ORCH-0787 refund flow: `supabase/functions/refund-order/index.ts` (lines 137-258) + `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`. Grep against the migration for `ticket_checkout_sessions` returns **zero matches** — the refund flow does NOT touch the session table.
5. `supabase/functions/ticket-checkout-create/index.ts` — the entry-point edge function.
6. `supabase/functions/_shared/ticketCheckout.ts` — `checkoutIdempotencyKey` composition.
7. `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` — `biz_ticket_checkout_create_session` RPC, specifically the existing-session lookup at lines 314-342.

## Investigation manifest

| # | File / Layer | Why |
|---|--------------|-----|
| 1 | `supabase/functions/_shared/ticketCheckout.ts:88-105` | Idempotency key composition |
| 2 | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:314-342` | RPC existing-session return path |
| 3 | `supabase/functions/ticket-checkout-create/index.ts:61-65, 92-99, 159-172` | Edge function call chain |
| 4 | `supabase/functions/refund-order/index.ts:137-258` | What refund touches |
| 5 | `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql` | Refund DB writes |
| 6 | Stripe RN PaymentSheet behavior on already-confirmed PaymentIntent | Runtime layer |

## Findings

### 🔴 RC-791-1 — Mingla idempotency key is buyer-identity-deterministic with no refund-state component

**File + lines:** `supabase/functions/_shared/ticketCheckout.ts:88-105`.

**Exact code:**
```ts
export function checkoutIdempotencyKey(input: {
  eventId: string;
  buyerEmail: string;
  buyerPhoneE164: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
}): string {
  const lineKey = input.lines
    .map((line) => `${line.ticketTypeId}:${line.quantity}`)
    .sort()
    .join("|");
  return [
    "ticket_checkout",
    input.eventId,
    input.buyerEmail.trim().toLowerCase(),
    input.buyerPhoneE164,
    lineKey,
  ].join(":");
}
```

**What it does:** generates a deterministic key from `(eventId, buyerEmail, buyerPhoneE164, sortedLines)`. Two distinct purchase attempts by the same buyer for the same ticket on the same event produce the same key. Refund state is not part of the composition.

**What it should do (direction only):** the key must change between the original purchase and any post-refund repurchase so that the RPC's existing-session lookup misses and a fresh session is created. Options include (a) appending a refund-aware nonce server-side, (b) bumping a per-buyer-per-event attempt counter when an order is refunded, (c) appending a client-supplied nonce on every fresh `Pay` tap.

**Causal chain (step 1):** buyer's first purchase creates idempotency key K. Buyer refunds. Buyer's retry composes the SAME K because all inputs are identical.

### 🔴 RC-791-2 — RPC returns existing session unconditionally on idempotency-key match, including sessions in terminal states

**File + lines:** `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:314-342`.

**Exact code:**
```sql
SELECT *
  INTO v_existing
  FROM public.ticket_checkout_sessions
 WHERE idempotency_key = p_idempotency_key;

IF FOUND THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(...)), '[]'::jsonb)
    INTO v_items
    FROM public.ticket_checkout_session_items i
   WHERE i.checkout_session_id = v_existing.id;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_existing.id,
    'eventId', v_existing.event_id,
    'brandId', v_existing.brand_id,
    'status', v_existing.status,
    'totalCents', v_existing.total_cents,
    'currency', trim(v_existing.currency),
    'stripeAccountId', v_existing.stripe_account_id,
    'orderId', v_existing.order_id,
    'items', v_items
  );
END IF;
```

**What it does:** if a row exists with this idempotency_key, returns it verbatim — including its existing `id`, `status`, and `order_id`. There is NO check on `v_existing.status` — terminal statuses (`paid_completed`, `free_completed`, `failed`, `expired`) are returned the same as in-flight statuses (`pending_free`, `requires_payment`, `processing_payment`, post-rework `awaiting_web_redirect`).

**What it should do (direction only):** when an existing session is found in a terminal state, either (a) skip the early-return and create a new session (with a discriminated idempotency_key so the UNIQUE constraint doesn't reject it), or (b) raise an exception that the edge function recognises and recovers from by retrying with a fresh key.

**Causal chain (step 2):** RPC returns `v_existing` with `status='paid_completed'`, `order_id=Y`, `stripe_payment_intent_id=PI_X`. Edge function continues into the Stripe branch with these stale fields.

### 🔴 RC-791-3 — Stripe PaymentIntent idempotency key reuses the same Mingla session id, so Stripe returns the refunded PaymentIntent

**File + lines:** `supabase/functions/ticket-checkout-create/index.ts:159-172`.

**Exact code:**
```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    automatic_payment_methods: { enabled: true },
    transfer_data: { destination: stripeAccountId },
    metadata: { ... },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**What it does:** Stripe idempotency key is `ticket_checkout:${checkoutSessionId}` where `checkoutSessionId` came from the RPC return at line 92. Because RC-791-2 returned the EXISTING session id, this Stripe idempotency key is identical to the first attempt's key. Per Stripe's documented idempotency behavior, Stripe returns the original response — the now-refunded `PaymentIntent` in `succeeded` status with a `client_secret` for an already-confirmed PI.

**What it should do (direction only):** if RC-791-1/RC-791-2 are fixed (new Mingla session id), this layer automatically resolves because `checkoutSessionId` will be a fresh UUID. No change needed at this layer.

**Causal chain (step 3):** Stripe returns the refunded PI. `clientSecret` is for a terminal PI. Edge function returns `{kind: "requires_payment", clientSecret, paymentIntentId, ...}` to the client.

### 🔴 RC-791-4 — Stripe RN PaymentSheet rejects init / present on an already-confirmed PaymentIntent with `code: "Failed"`

**File + lines:** Stripe RN SDK (verified via `node_modules/@stripe/stripe-react-native/lib/typescript/src/types/Errors.d.ts:33-37` + Stripe API docs).

**What it does:** Stripe's PaymentSheet refuses to initialize or present a confirmed PaymentIntent. The SDK surfaces this as `{error: {code: "Failed", message: "..."}}` (or `code: "Failed"` from the `PaymentSheetError` enum, message varying by SDK version — typically "PaymentIntent has already been confirmed" or "PaymentIntent is in an unexpected state").

**What it should do:** N/A — this is correct Stripe behavior. A confirmed PI cannot be re-charged. The fix belongs upstream (don't reuse the PI).

**Causal chain (step 4):** Client receives `code: "Failed"`. Post-ORCH-0789 `payment.tsx:182-184` `case "Failed":` branch sets `declineToast=true` → buyer sees "Card declined — try another payment method." The toast is dismissible per ORCH-0789, but the underlying error is a real Stripe rejection.

### 🔴 RC-791-5 — ORCH-0787 refund flow does not reset or invalidate the corresponding ticket_checkout_sessions row

**File + lines:** `supabase/functions/refund-order/index.ts:137-258` + `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`.

**Exact code (refund-order):** calls `biz_refund_order` RPC → calls Stripe Refund API → calls `biz_refund_order_commit` RPC. None of these RPCs reference `ticket_checkout_sessions`. Grep of the migration file for `ticket_checkout_sessions` returns zero matches.

**What it does:** refund flow updates the `orders` row (sets `payment_status='refunded'`, populates `refunded_amount_cents`), writes a `refunds` row with Stripe refund ID, and possibly voids tickets. The `ticket_checkout_sessions` row stays exactly as it was at `paid_completed` with its `order_id` still pointing to the now-refunded order.

**What it should do (direction only):** the refund flow has two valid responses to this — either (a) update the corresponding `ticket_checkout_sessions` row's `idempotency_key` to a tombstone value (e.g., suffix with `:refunded:` + refund_id) so a fresh repurchase generates a fresh key without collision, or (b) leave the session row alone and put the responsibility on the create-session RPC to skip terminal sessions. Option (b) is simpler because it concentrates the logic in one place and doesn't require a cross-function transaction.

**Causal chain (step 0, the precondition):** any refund leaves a `paid_completed` ghost session that collides with any future identical-buyer attempt.

## Five-layer cross-check

| Layer | Truth |
|-------|-------|
| **Docs** | No spec (ORCH-0777 or ORCH-0787) explicitly addresses what happens to a checkout session after refund. Gap. |
| **Schema** | `ticket_checkout_sessions.idempotency_key` is `UNIQUE`. `status` CHECK now includes `awaiting_web_redirect` (ORCH-0790 migration applied 2026-05-11 by operator) but no terminal-state lifecycle is enforced. No FK from `refunds` to `ticket_checkout_sessions`. |
| **Code** | RPC returns existing session unconditionally; edge function trusts the session id; Stripe idempotency reuses the same id. All three layers stack to produce the bug. |
| **Runtime** | Stripe rejects re-confirmation of a succeeded PI with `code: "Failed"`. Confirmed via the ORCH-0789 wrapper's typed passthrough. |
| **Data** | After any refund, the `ticket_checkout_sessions` table contains a `paid_completed` row whose idempotency_key blocks any future identical-buyer purchase. The longer Mingla runs, the larger this set grows. |

All five layers agree: the bug is real and structural.

## Blast radius

- **Public buyer flow (iPhone):** any buyer who has ever paid for tickets to event E with email X and phone Y cannot ever buy that same ticket-type-and-quantity for event E again without succeeding on the first try AND no refund being issued. Affects ALL refunded buyers, not just the operator's test buys.
- **Public buyer flow (web, post-ORCH-0790):** SAME bug. The web branch at `ticket-checkout-create/index.ts:158-265` is gated on the same RPC return, so it also reuses the existing session id when the RPC matches. The Stripe Checkout Session creation uses `idempotencyKey: ticket_checkout_web:${checkoutSessionId}` — same session id → same Stripe Checkout Session URL returned (possibly an expired one). Effect on web is similar but the visible failure mode may differ (might land on a stale Stripe-hosted page instead of an init error).
- **Free ticket flow:** when `totalCents === 0`, the edge function at lines 110-142 calls `biz_ticket_checkout_finalize` with the existing session id. If the existing session's `order_id` is non-null (refund case), the RPC might fail or might silently re-finalise. Not yet traced; flag for SPEC.
- **Different buyer same event:** different email/phone → different idempotency key → not affected. Unique-buyer-per-event flows still work.
- **Native vs web parity:** both surfaces affected identically at the session layer.
- **Test surfaces (operator self-testing):** worst hit, because operators iterate refund→retry→refund→retry. Production buyers hit this rarely but when they do (legitimate refund + change-of-mind repurchase), the experience is broken.

## Invariant cross-check

- **I-PUBLIC-BUYER-ANON-TOLERANT:** preserved by any fix (anon buyers can still use the same email/phone).
- **I-CHECKOUT-IDEMPOTENT:** must be preserved — idempotency-key matching must still dedupe in-flight retries. The fix must distinguish "in-flight retry" (same key, want same response) from "post-terminal retry" (same key intent, want fresh response).
- **New proposed invariant (DRAFT, register at CLOSE):** `I-PROPOSED-AW CHECKOUT-SESSION-NEVER-REUSED-POST-TERMINAL` — the `biz_ticket_checkout_create_session` RPC MUST NOT return an existing session row whose status is in the terminal set (`paid_completed`, `free_completed`, `failed`, `expired`). Enforced by RPC logic + a SQL probe + a Deno test if feasible.

## Recurring-pattern check

- **Pattern: "idempotency key too coarse, locks out legitimate retries."** Same family as ORCH-0540 SMS-resend idempotency-too-strict and the Stripe-Account orphan-PI cleanup gap (DISC-1 from ORCH-0789 investigation). Idempotency boundaries are subtle and need explicit thinking about valid retry windows. Worth a section in `references/recurring-patterns.md` after this lands.

## Confidence

| Finding | Confidence | What would raise it |
|---------|-----------|---------------------|
| RC-791-1 (idempotency composition) | **High** | Already H — code is verbatim |
| RC-791-2 (RPC returns terminal session) | **High** | Already H — SQL is verbatim, no other code path matches the key |
| RC-791-3 (Stripe reuses PI via idempotency) | **High** | Already H — Stripe's documented behavior + the code line |
| RC-791-4 (PaymentSheet rejects confirmed PI) | **High** | Already H — Stripe SDK type + documented behavior |
| RC-791-5 (refund leaves session intact) | **High** | Already H — migration grep returns zero matches |
| Web flow symptom shape on refund-then-retry | **Medium** | Operator live-fire would confirm whether web lands on a stale Checkout page or an init error |
| Free-flow behavior under same conditions | **Low** | Read `biz_ticket_checkout_finalize` re-entry semantics + test |

## Open questions for SPEC

1. **Fix layer — RPC or refund-flow?** Option A (RPC skips terminal sessions, generates new idempotency key with tombstone discriminator on the old row) keeps logic in one place but requires the create RPC to write to the old row. Option B (refund flow tombstones the old session's idempotency_key on commit) keeps create RPC pure but spreads logic across refund and create. Recommend Option A for one-owner-per-truth.
2. **Tombstone shape.** If we suffix the old row's idempotency_key with `:tombstone:` + a discriminator on terminal-session-found, what discriminator? `now()` is non-deterministic; `order_id` is null for failed/expired; `refunded_at` doesn't exist on the table. Recommend appending `':' || v_existing.id::text` (the session UUID) — guaranteed unique, deterministic, never collides.
3. **Free-ticket case.** Does `biz_ticket_checkout_finalize` re-finalise a session that already has an `order_id`? SPEC must trace this and confirm whether the free path is also affected.
4. **Web flow symptom verification.** SPEC may want to mandate a live-fire web smoke for the refund-then-retry case, separately from the native iPhone smoke, since the Stripe Checkout Session lifecycle and idempotency semantics differ.
5. **Backward compatibility / existing data.** Are there existing `paid_completed` rows on production with refunds pending? If yes, do they need a one-time tombstone migration to unblock affected buyers immediately, or is the fix forward-looking only?

## Fix-strategy direction (NOT a spec)

The cleanest fix is in the RPC `biz_ticket_checkout_create_session`. Roughly:

```sql
IF FOUND THEN
  -- ORCH-0791: terminal sessions are historical artifacts; do not reuse them.
  IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN
    -- Tombstone the old row so the UNIQUE(idempotency_key) constraint won't reject
    -- a fresh insert with the same buyer-deterministic key.
    UPDATE public.ticket_checkout_sessions
      SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
          updated_at = now()
      WHERE id = v_existing.id;
    -- Fall through to the normal create path below.
  ELSE
    -- In-flight retry — return the existing session as before.
    RETURN jsonb_build_object(... existing return ...);
  END IF;
END IF;

-- (existing INSERT path runs)
```

This keeps the I-CHECKOUT-IDEMPOTENT invariant (in-flight retries still dedupe) while resolving the post-terminal block.

The edge function and Stripe idempotency layer need no changes — once the RPC returns a fresh session UUID, the cascade resolves itself.

## Regression prevention requirements

1. **Deno test for `biz_ticket_checkout_create_session` post-terminal behavior.** Insert a `paid_completed` session with key K; call the RPC with key K; assert the RPC returns a NEW session id; assert the old row's idempotency_key has been tombstoned.
2. **SQL probe at deploy:** after migration, run `SELECT id, idempotency_key, status FROM ticket_checkout_sessions WHERE idempotency_key LIKE '%:tombstone:%';` to confirm no surprise tombstones from existing data (or confirm a one-time backfill if SPEC decides one is needed).
3. **Live-fire smoke (operator-owned):** buy → refund → repurchase same ticket as same buyer → expect successful Stripe redirect (web) or PaymentSheet present (native), not "Card declined."

## Discoveries for orchestrator

- **DISC-INV-1: ORCH-0789/0790 final CLOSE should be held until 0791 is at minimum specced, ideally fixed.** The post-ORCH-0789 code correctly classifies the Failed code — but the underlying Failed is unwarranted. The full no-fake-decline promise to buyers is not delivered until 0791 lands.
- **DISC-INV-2: The free-ticket repurchase-after-refund path is not yet traced** but is plausibly broken by the same mechanism. SPEC scope should include the free path.
- **DISC-INV-3: Web flow's stale Checkout Session URL on refund+retry** is a distinct sub-symptom worth verifying — Stripe Checkout Sessions have their own expiry rules (~24h default) and the cached URL may either work-but-redirect-to-a-completed-page or fail outright. SPEC must trace this.
- **DISC-INV-4: There is no SQL-level FK or trigger** linking `refunds` to `ticket_checkout_sessions`. The fix is the simplest "do the right thing in the RPC" move; richer schema constraints are a P3 follow-up if anyone cares.
- **DISC-INV-5: Recurring pattern observation.** Idempotency keys composed entirely of buyer identity components lock out legitimate retries after any terminal event. This is the third instance in Mingla history (SMS resend, orphan PI cleanup, now this). Worth a paragraph in `references/recurring-patterns.md` warning future implementors.
