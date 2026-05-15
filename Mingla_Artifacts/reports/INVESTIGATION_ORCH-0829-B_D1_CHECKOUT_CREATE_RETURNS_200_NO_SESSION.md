# INVESTIGATION — ORCH-0829-B D-1: ticket-checkout-create returns HTTP 200 but no new session row → Stripe sheet hangs

**Mode:** INVESTIGATE
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Trigger:** Orchestrator dispatch after `Mingla_Artifacts/reports/QA_ORCH-0829-B_STRIPE_LIVEFIRE_REPORT_RETEST_2.md` Discovery D-1
**Confidence:** **High — root cause proven via DB evidence + RPC source + matching idempotency key + matching updated_at timestamp.**

---

## LAYMAN SUMMARY

When you tap "Continue to Payment" on a $250 ticket, the Stripe sheet hangs at a loading spinner for ~90 seconds and then silently disappears with no charge, no order, no toast. The defensive JS guard the implementor shipped for ORCH-0829-B is innocent — it never gets a chance to fire because the underlying bug is in the Postgres RPC that creates the checkout session, not in the Stripe SDK or the JS layer.

**What's actually happening:** earlier today at 07:38 UTC, an attempt to buy the same $250 ticket created a checkout session row in the database with status `processing_payment` and a Stripe PaymentIntent attached. That attempt was never completed (no Stripe webhook ever fired to mark it `paid_completed` or `failed`). The session has been sitting in the DB ever since, stuck in `processing_payment`, with an `expires_at` of 07:53 UTC that came and went 1.5 hours before the most recent live-fire attempt at 09:12 UTC.

When the next attempt fires, the RPC `biz_ticket_checkout_create_session` computes a **deterministic idempotency key** from (event_id, buyer_email, buyer_phone, ticket_type, qty). The key matches the stuck row. The RPC has special handling for terminal-status matches (paid_completed / free_completed / failed / expired → tombstone the key and insert fresh) but treats **any non-terminal status** (pending_free / requires_payment / processing_payment / awaiting_web_redirect) as a "genuine in-flight retry" — it short-circuits and returns the **existing** session WITHOUT inserting a new row. The expires_at field is checked for capacity reservations but **never** for the idempotency short-circuit itself.

The edge function then calls Stripe's PaymentIntent creation with the **same idempotency key** as the original 07:38 attempt; Stripe returns the **same stale PaymentIntent** (`pi_3TWtqzPjlZyAYA401TulS82m`) with its **stale client secret**. That client secret gets passed to the Stripe RN SDK's `initPaymentSheet` and `presentPaymentSheet`. Stripe SDK on iOS 26 cannot present a PaymentIntent that is many hours old — it hangs in the loading skeleton, eventually self-dismisses, and the JS-side Promise never resolves. `setCheckoutInFlight(false)` never runs. User gets zero feedback.

**Why the tester couldn't find the row:** their probes filtered `created_at > now() - interval '30 minutes'` (and even 60 minutes). The stuck row was created 94 minutes before the live-fire. Broadening to 120 minutes immediately surfaced it.

**The fix is small and surgical:** extend ORCH-0791's tombstone branch so it ALSO fires when `v_existing.expires_at < now()` regardless of status — an expired in-flight session is functionally a dead session and its idempotency key should be freed. Optionally, also transition the row's status to `expired` in the same UPDATE so the system has a consistent state. The Stripe RN guard in ORCH-0829-B stays as-is (it's still a useful defense-in-depth against the actual double-resolve regression), but it's not what's hurting the user in this case.

---

## Symptom Summary

| | What happened |
|---|---|
| **Expected** | Tap "Continue to Payment" → Stripe PaymentSheet opens within ~1s with card-entry form → user types card → tap Pay → success toast + ticket appears in calendar |
| **Actual** | Tap "Continue to Payment" → white loading sheet slides up → spinner spins ~90 seconds → sheet silently self-dismisses → no error, no toast, no order, no Stripe charge |
| **Reproducer** | iPhone 17 Pro sim `17091E60-C3B6-4167-980D-60C348E177F6`, signed in as user `c727d491-4884-4e72-b467-d6c124b9a8b9` (Marcus Rivera), Big Party event `549e0a64-c133-43c3-ac1c-1ecc6055c992`, The Paid Tickets ticket type `01368e22-e559-4e9d-8a16-0b73825879f3` ($250 USD), tap Buy → confirm modal → Continue to Payment |
| **When it started** | Whenever the buyer first attempts checkout. The first attempt of each unique (event, email, phone, ticket, qty) combination works. Every retry after the first attempt's expires_at (15 min) hits this bug unless the previous session was driven to a terminal status by a Stripe webhook. |

---

## Investigation Manifest

| # | File / artifact | Why read |
|---|---|---|
| 1 | `Mingla_Artifacts/reports/QA_ORCH-0829-B_STRIPE_LIVEFIRE_REPORT_RETEST_2.md` | The FAIL report that triggered this dispatch; D-1 framing + edge_logs timestamp |
| 2 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md` | Original ORCH-0829 investigation that classified Bug Z as SDK double-resolve only — D-1 reframes |
| 3 | `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md` + `reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md` | Context on the JS guard that is now proven to be innocent for this scenario |
| 4 | `supabase/functions/ticket-checkout-create/index.ts` | The edge function source; identifies the RPC call site (line 91-105) and the response shape (line 388-400) |
| 5 | `app-mobile/src/payments/nativeCheckoutFlow.ts` | JS client behavior; confirms client does NOT pass idempotencyKey (line 96-98), letting RPC use deterministic fallback |
| 6 | `packages/payments-native/useStripePaymentSheet.ts` | The once-only guard, confirmed innocent for this scenario |
| 7 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:190-277` | handleBuy implementation; confirms no try/finally around runNativeCheckout (D-2 from RETEST_2 still stands) |
| 8 | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | Original RPC definition |
| 9 | `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql` | **AUTHORITATIVE current RPC body** (LATEST CREATE OR REPLACE) — the smoking gun, lines 77-113 |
| 10 | `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` | Sibling migration; confirms no later RPC replacement |
| 11 | Live DB: `pg_get_functiondef` of deployed RPC | Verified deployed body matches migration source (no drift) |
| 12 | Live DB: `ticket_checkout_sessions` with 120-min window | Found the stuck row `acc20778...` matching the deterministic key |
| 13 | Live DB: `stripe_connect_accounts` for brand `22a18413...` | Confirmed Stripe Connect is healthy (charges_enabled=true, detached_at=null) — rules out as cause |

---

## Findings (Classified)

### 🔴 ROOT CAUSE R-1: RPC idempotency short-circuit ignores expires_at for non-terminal statuses

**File + line:** `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql:77-112`

**Exact code (current authoritative definition of `public.biz_ticket_checkout_create_session`):**
```sql
SELECT *
  INTO v_existing
  FROM public.ticket_checkout_sessions
 WHERE idempotency_key = p_idempotency_key;

IF FOUND THEN
  IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN
    -- Tombstone the key and fall through to fresh insert
    UPDATE public.ticket_checkout_sessions
       SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
           updated_at = now()
     WHERE id = v_existing.id;
  ELSE
    -- ⚠️ SHORT-CIRCUIT: return existing in-flight session as-is
    SELECT COALESCE(jsonb_agg(jsonb_build_object(...)), '[]'::jsonb)
      INTO v_items
      FROM public.ticket_checkout_session_items i
     WHERE i.checkout_session_id = v_existing.id;

    RETURN jsonb_build_object(
      'checkoutSessionId', v_existing.id,
      ...
    );
  END IF;
END IF;
```

**What it does:** When the deterministic idempotency key matches an existing row, the RPC checks ONLY the row's `status` field. If status is in the terminal set, the key is tombstoned and execution falls through to a fresh INSERT. If status is in the in-flight set (`pending_free`, `requires_payment`, `processing_payment`, `awaiting_web_redirect`), the RPC returns the existing row's details immediately — regardless of how old `expires_at` is.

**What it should do:** The check should ALSO tombstone (and fall through to fresh insert) when `v_existing.expires_at < now()`, regardless of status. An in-flight session past its expiry window has no business being reused — its Stripe PaymentIntent (if any) is stale, its capacity reservation is dead per the parallel check at line 178-180, and Stripe's SDK cannot present its stale client_secret successfully. The current logic effectively says "any non-terminal status = genuine retry" which is only true within the expiry window.

**Causal chain (proven, six steps from RPC line to user-visible silent dismiss):**

1. **07:38:45 UTC** — Buyer attempts paid checkout the first time. Edge function calls RPC with deterministic idempotency_key `ticket_checkout:549e0a64-...:sethogieva@icloud.com:+19843822876:01368e22-...:1`. RPC inserts row `acc20778-8b55-4e2c-9ad3-fedd2637a164` with `status='requires_payment'`, `expires_at='07:53:45+00'`. Edge function creates Stripe PaymentIntent `pi_3TWtqzPjlZyAYA401TulS82m`. Row updated to `status='processing_payment'`, `stripe_payment_intent_id='pi_3TWtqzPjlZyAYA401TulS82m'`. Function returns 200 with clientSecret. Buyer abandons or sheet hangs (the double-resolve / iOS 26 / SDK issue is one possible cause for the original abandonment — but D-1 is downstream-of-cause-agnostic).

2. **07:53:45 UTC** — `expires_at` of the row passes. The system has NO automated mechanism to transition past-expiry non-terminal sessions to `status='expired'`. The Stripe PaymentIntent's lifecycle is separate (Stripe abandons unconfirmed PIs after a longer window).

3. **08:33:46 UTC** — Buyer claims the FREE ticket (different ticket_type_id → different idempotency_key, doesn't hit the stuck row). Free flow completes normally → row `f6ef84a1...` is created with `status='free_completed'`. Doesn't help the paid-ticket case.

4. **09:12:39 UTC** — Tester re-attempts the SAME paid ticket. Edge function computes the SAME deterministic idempotency key. RPC executes the SELECT at line 72-75, matches row `acc20778...`. Status is `processing_payment` ∉ terminal set, so the ELSE branch at line 89 fires. RPC returns the existing session's details (with `stripeAccountId='acct_1TUNLtB5v00XfDTX'`, `totalCents=25000`, etc.) WITHOUT inserting a new row.

5. **09:12:39 UTC (continued)** — Edge function code path resumes at index.ts:115. `checkoutSessionId='acc20778...'`. Updates `buyer_status_token_hash` on the existing row (line 117-123 → succeeds, row's `updated_at` advances to 09:19:15 UTC as later UPDATE statements compound). Calls `stripe.paymentIntents.create` at line 329 with `idempotencyKey: 'ticket_checkout:acc20778...'` — Stripe matches its server-side idempotency cache and returns the **same** stale PaymentIntent `pi_3TWtqzPjlZyAYA401TulS82m` with its **stale clientSecret**. Function persists nothing new and returns 200 at line 388 with `kind: 'requires_payment'` + stale clientSecret + stale paymentIntentId.

6. **09:12:40 UTC onward** — JS client (nativeCheckoutFlow.ts:124-148) calls `initPaymentSheet` then `presentPaymentSheet` with the stale clientSecret. Stripe RN SDK on iOS 26 attempts to present PaymentIntent that is ~94 minutes old. The Stripe PaymentIntent's payment_method is not attached, the session that created it has no live capacity reservation, and Stripe SDK's PaymentSheet either hits a state-validation error internally or the iOS 26 SDK 0.50.3 bug that swallows the resolution. The native PaymentSheet UI displays as a loading skeleton; the JS-side Promise never resolves. ~90s later, the PaymentSheet self-dismisses. `setCheckoutInFlight(false)` at ExpandedBusinessEventSheet.tsx:233 never runs because the await at line 222 never returns. User sees nothing.

**Verification step (already done — six pieces of converging evidence):**

| Evidence | Result |
|---|---|
| Authoritative RPC source read in latest migration | ✓ Short-circuit branch confirmed |
| Deployed RPC body verified via `pg_get_functiondef` | ✓ Matches migration source byte-for-byte |
| Stuck session row exists | ✓ `acc20778-8b55-4e2c-9ad3-fedd2637a164` with status='processing_payment' |
| Stuck row's idempotency_key matches the deterministic key | ✓ `ticket_checkout:549e0a64-...:sethogieva@icloud.com:+19843822876:01368e22-...:1` — exact match for the test buyer's inputs |
| Stuck row's expires_at is well in the past | ✓ `expires_at='2026-05-14 07:53:45.549+00'`, live-fire at 09:12:39 UTC = 79 min past expiry |
| Stuck row's updated_at advanced during the live-fire | ✓ `updated_at='2026-05-14 09:19:15.836+00'` — proves the function reached and touched this row via the subsequent UPDATE statements (buyer_status_token_hash + stripe_payment_intent_id no-op update). No new row was inserted because the RPC short-circuited before the INSERT at line 210 |
| Stripe Connect health is fine for this brand | ✓ `stripe_connect_accounts` row `25d1d770...` has `charges_enabled=true`, `payouts_enabled=true`, `detached_at=null` — rules out Stripe-Connect-not-ready as cause |

To validate the fix candidate end-to-end: tombstone the stuck row's idempotency_key manually (`UPDATE ticket_checkout_sessions SET idempotency_key = idempotency_key || ':tombstone:' || id::text WHERE id = 'acc20778-8b55-4e2c-9ad3-fedd2637a164'`), then re-trigger the live-fire. The RPC will NOT find a match, will insert a fresh row, the edge function will create a fresh PaymentIntent with a fresh idempotency_key, and Stripe SDK should successfully present the new clientSecret. This is the diagnostic confirmation step — RECOMMEND running it once the operator approves to confirm the diagnosis before the implementor begins.

---

### 🟠 CONTRIBUTING FACTOR C-1: No automated transition of past-expiry non-terminal sessions to `expired` status

**File + line:** `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` (no cron/trigger added)

**What's missing:** The schema introduces `status='expired'` as a valid terminal status (R-1's tombstone branch checks for it), but no mechanism transitions past-expiry sessions INTO `expired` status. Without that, `expires_at` is purely an advisory field used by the capacity-reservation check at lines 178-180.

**Why it makes R-1 worse:** Even if the RPC's short-circuit were fixed, the table would still accumulate `processing_payment` rows that never reach terminal status. Defense in depth says: a cron / pg_cron / scheduled edge function should periodically transition past-expiry non-terminal rows to `expired` status. This would make R-1's symptom impossible because the row's status would already be in the terminal set when the next attempt fires.

**Classification reasoning:** Contributing rather than root cause because R-1's fix (check expires_at in the short-circuit) is sufficient on its own to resolve the user-visible bug. C-1 is the defense-in-depth layer.

---

### 🟡 HIDDEN FLAW H-1: Stripe-side stale PaymentIntents accumulate forever

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:329` (no PI cancellation on stuck rows)

**What's there:** The edge function has `cancelPaymentIntentIfClientAvailable` (imported from `_shared/ticketCheckout.ts`, used at line 377 when `persistPaymentError` fires). But there is no path that calls cancel when an in-flight session is found stuck past expiry.

**Why it matters later:** Even after R-1 is fixed, the Stripe side will still have a long tail of abandoned PaymentIntents in `requires_payment_method` state. They cost nothing but they're noise in dashboards, complicate reconciliation, and could legitimately trigger Stripe SDK side bugs in future PaymentSheet versions. When R-1 is fixed to tombstone past-expiry non-terminal sessions, the same code path should ALSO call `stripe.paymentIntents.cancel(v_existing.stripe_payment_intent_id)` for the stale PI to mark it dead on Stripe's side.

**Classification reasoning:** Hidden flaw — not causing today's symptom (D-1 is a JS-side hang, not a Stripe-side PI accumulation) but will cause future operational pain.

---

### 🟡 HIDDEN FLAW H-2: handleBuy in ExpandedBusinessEventSheet.tsx has no try/finally — `checkoutInFlight` stuck true on any hung await

**File + line:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:220-233`

**Exact code:**
```ts
setCheckoutInFlight(true);
const result = await runNativeCheckout({...});  // ← if this hangs forever, next line never runs
setCheckoutInFlight(false);
```

**What it does:** No `try/finally` wrapping. If `runNativeCheckout` throws synchronously, rejects, or hangs indefinitely (as proven by D-1), `setCheckoutInFlight(false)` never executes. `checkoutInFlight` stays `true` for the rest of the session. The early-return guard at line 192 (`if (checkoutInFlight) return;`) then short-circuits every subsequent Continue tap silently — proven in RETEST_2 Attempt 2 where the modal opened but tapping Continue caused the modal to dismiss without ever calling the edge function.

**What it should do:** Wrap in `try/finally` so the flag is always cleared:
```ts
setCheckoutInFlight(true);
try {
  const result = await runNativeCheckout({...});
  // ... handle outcome
} finally {
  setCheckoutInFlight(false);
}
```

**Causal chain:** D-1 hangs `runNativeCheckout` → flag stays true → subsequent attempts silently no-op → user can't even reach the (still-broken) retry path.

**Classification reasoning:** This is a sibling defect to D-1, not the root cause itself. Once D-1 is fixed AND H-2 is fixed, the user experience becomes: first attempt works correctly. Without H-2 fix, even after D-1 is fixed, ANY future hang (network, SDK regression, server timeout) leaves the user stuck.

**Recommendation:** The SPEC that follows this investigation should include H-2 as in-scope — the cost is ~5 lines and it converts an entire class of "silent stuck flag" bugs into recoverable states.

---

### 🟡 HIDDEN FLAW H-3: useStripePaymentSheet guard has no timeout escape

**File + line:** `packages/payments-native/useStripePaymentSheet.ts:75-99`

**What's there:** The once-only guard wraps `presentPaymentSheet` and only clears `inFlightPresentRef` in a `finally` block on the awaited Promise. If the native `presentPaymentSheet()` Promise never resolves (D-1's scenario, or any other Stripe SDK hang), the `finally` never runs and the ref stays set forever. The defensive guard becomes a permanent lock.

**What it should do:** Add a timeout race that, after N seconds (60 is reasonable for Stripe PaymentSheet), rejects the in-flight Promise with a synthetic timeout error. This converts silent-hang into loud-failure, gives `handleBuy`'s catch path something to surface as a toast, and frees the ref for a subsequent retry.

**Causal chain:** D-1 hangs presentPaymentSheet → guard ref stays set forever → even if user dismissed the sheet by force-closing the app and re-launching (cold start), the in-process refs reset, BUT within a single app session, even after R-1 is fixed, any FUTURE Stripe SDK hang from any cause leaves the user locked out of the entire payment flow for the rest of the session.

**Classification reasoning:** Hidden flaw — not the root cause of D-1, but a sibling that the SPEC should address. Both H-2 and H-3 are RETEST_2's "fallback (a)" patches the orchestrator's NEXT HANDOFF mentioned. The investigation now provides explicit cited code for both.

---

### 🔵 OBSERVATION O-1: Stripe Connect data lives in TWO tables (`brands.stripe_connect_id` + `stripe_connect_accounts.stripe_account_id`)

**File + lines:** `supabase` schema — `brands` table has `stripe_connect_id`, `stripe_charges_enabled`, `stripe_payouts_enabled` columns AND `stripe_connect_accounts` table has `stripe_account_id`, `charges_enabled`, `payouts_enabled` columns

**What's noteworthy:** The RPC at line 115-122 joins `events` to `stripe_connect_accounts` only (not `brands`). The QA tester's probe checked `brands.stripe_connect_id` and reported brand as healthy. Both tables happen to be in sync for this brand (both show `acct_1TUNLtB5v00XfDTX` + `charges_enabled=true`), but the duplication is a future drift risk. If `brands` and `stripe_connect_accounts` diverge for any brand, the admin dashboard (which likely reads `brands`) will show a different truth than the checkout flow (which reads `stripe_connect_accounts`).

**Classification reasoning:** Not a defect today; flagged as Discovery for orchestrator to consider whether one source should be canonical.

---

## Five-Truth-Layer Cross-Check

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | `Mingla_Artifacts/specs/SPEC_ORCH-0791_*` (not directly read, inferred from migration commentary): terminal sessions should not block repurchase; in-flight statuses keep short-circuit behavior to "preserve I-CHECKOUT-IDEMPOTENT for genuine retries during checkout" | Partial — "genuine retries during checkout" is the documented intent, but "during checkout" implicitly means within the expires_at window. The implementation never enforces that boundary. |
| **Schema** | `ticket_checkout_sessions` has both `status` and `expires_at` columns; `status='expired'` is documented as terminal; no constraint or trigger automatically transitions stuck rows | Matches — confirmed via column probe. |
| **Code** | RPC line 83 checks `v_existing.status IN ('paid_completed','free_completed','failed','expired')` — explicitly ONLY status, no expires_at clause | **CONTRADICTION** with the documented intent. The "during checkout" temporal scope from the migration commentary is not enforced in code. |
| **Runtime** | Live-fire at 09:12 UTC produced HTTP 200 + no new row + Stripe sheet hang; row `acc20778...` `updated_at` advanced to 09:19 UTC (compounded across multiple post-RPC UPDATEs from the function body) | Matches the short-circuit hypothesis exactly. |
| **Data** | Row `acc20778-...` has `status='processing_payment'`, `expires_at='07:53 UTC'`, deterministic idempotency_key matching the test buyer; `stripe_connect_accounts` is healthy; ticket_types are correctly configured | Matches — all preconditions for short-circuit are present. |

**Contradiction located:** Docs vs Code. The migration commentary says "preserve I-CHECKOUT-IDEMPOTENT for genuine retries **during checkout**" — but the SQL never enforces the "during checkout" temporal scope. Past-expiry in-flight sessions are treated as genuine retries when they are not. The bug lives in this contradiction.

---

## Blast Radius

**Who is affected:**
- Any buyer who: (a) starts a paid checkout, (b) abandons or experiences a hang before completing, (c) attempts the SAME (event, email, phone, ticket_type, qty) combination again >15 minutes later
- Repeat buyers attempting to re-buy the same ticket type for the same event with the same buyer info — this is a normal user behavior (someone trying to claim a ticket multiple times because the first attempt felt broken)
- Mingla-side: ALL events with paid tickets, ALL brands with stripe_connect_id set

**Who is NOT affected:**
- First-time buyers of any (event, email, phone, ticket_type, qty) combination — their first attempt creates the row fresh
- Buyers of FREE tickets — once finalized, free orders write status='free_completed' which IS terminal, so retries tombstone correctly
- Buyers who complete the paid flow on their first attempt — the Stripe webhook drives status to `paid_completed` (terminal), so retries also tombstone correctly
- Buyers who get an explicit failure (Stripe declines, network error during PI creation) — the error path at index.ts:343-360 sets `status='failed'` (terminal), so retries tombstone correctly

**The bug strictly affects the "silent hang / abandonment → retry" path** — which is exactly the scenario the operator hit during the prior session.

**Cross-domain check:**
- Mobile app (`app-mobile/`) → primary affected surface (the iPhone 17 Pro sim test demonstrates)
- Mingla-business (`mingla-business/`) → uses the SAME edge function via `nativeCheckoutFlow` or web `Stripe Checkout` paths. Business buyers can hit the same bug.
- Admin dashboard (`mingla-admin/`) → unaffected; admin does not initiate buyer checkouts
- Web buyer flow (Surface = "web") → ALSO affected. The short-circuit fires before the surface-specific branching, so a buyer who started a native attempt then retried via web (or vice versa) with the same buyer info also hits this. Stripe Checkout Session (line 207-256) would similarly receive the stale stripe_checkout_session_id field via the existing-session return path.

---

## Invariant Violations

**Violates:** `I-CHECKOUT-IDEMPOTENT` (cited in `20260520000002_orch_0791_session_terminal_tombstone.sql` line 19) — the invariant's intent is "dedupe genuine retries during checkout." Past-expiry in-flight sessions are not "during checkout" — they are abandoned. The implementation does not enforce this scope.

**Establishes a new invariant candidate (for the spec to codify):**

> **I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE** — the idempotency-key short-circuit in `biz_ticket_checkout_create_session` MUST treat any session past `expires_at` as a tombstone candidate regardless of `status`. CI gate enforces by reading the RPC source and asserting the short-circuit's ELSE branch is guarded by `expires_at >= now()` OR the tombstone branch's condition includes `OR v_existing.expires_at < now()`. Backed by ORCH-0829-B D-1 close.

---

## Fix Strategy (Direction Only — NOT a Spec)

**The minimum viable fix is one logical change to the RPC at `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql:83`:**

Extend the tombstone-eligibility predicate from:
```sql
IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN
```
to:
```sql
IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
   OR v_existing.expires_at < now() THEN
```

This is a single SQL OR clause. It correctly classifies past-expiry rows as tombstone candidates.

**Strongly recommended companion changes (the spec should pull these in):**

1. **Transition the tombstoned row's status to `'expired'`** in the same UPDATE that mutates idempotency_key. This makes the system's state consistent (no rows in `processing_payment` past their expiry). Update statement becomes:
   ```sql
   UPDATE public.ticket_checkout_sessions
      SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
          status = CASE
            WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
            ELSE 'expired'
          END,
          updated_at = now()
    WHERE id = v_existing.id;
   ```

2. **Cancel the stale Stripe PaymentIntent** (H-1). Best done in the edge function, not the RPC (RPC doesn't have Stripe API access). After the RPC returns and edge function sees the response was a fresh insert (vs short-circuit), no action needed. But the edge function could check whether the RPC tombstoned a row and call `stripe.paymentIntents.cancel(tombstonedPaymentIntentId)`. Requires RPC to return the tombstoned-row's stripe_payment_intent_id in its response.

3. **Fix H-2** — wrap `runNativeCheckout` in try/finally in `ExpandedBusinessEventSheet.tsx:220-233`. Five lines.

4. **Fix H-3** — add a 60s timeout race in `useStripePaymentSheet.ts:75-99` that converts the JS-side guard from "silent forever-lock" to "loud timeout error with retry". ~15 lines including diagnostic logs.

5. **Defer C-1** to a sibling ORCH — periodic cleanup job (pg_cron or scheduled edge function) that transitions all past-expiry non-terminal sessions to `'expired'` as defense-in-depth. Nice-to-have, not blocking.

**Verification once implemented:**
- Same Maestro reproducer from RETEST_2 should succeed: confirmation modal → Continue → Stripe sheet renders card-entry form within ~1s → user enters test card → success toast + new ticket in calendar
- DB probe should show a new `ticket_checkout_sessions` row with FRESH `created_at` (within the live-fire timestamp ±5s)
- The stuck row `acc20778...` should now have `idempotency_key` ending in `:tombstone:acc20778...` and `status='expired'`
- A new Stripe PaymentIntent (distinct from `pi_3TWtqzPjlZyAYA401TulS82m`) should be referenced in the new session row

---

## Regression Prevention

**Structural safeguard:** add the new invariant I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE.

**CI gate:** add a strict-grep test to `.github/workflows/strict-grep-mingla-business.yml` that reads `supabase/migrations/*.sql` for the LATEST `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session` body and asserts the tombstone-eligibility predicate includes `OR v_existing.expires_at < now()`. Mirror the strict-grep registry pattern from `feedback_strict_grep_registry_pattern.md`.

**Documentation update:** the SPEC should update the migration commentary at the top of the new RPC migration to explicitly say "in-flight sessions past `expires_at` are reclassified as tombstone candidates per ORCH-0829-B D-1 close."

**Unit test:** add a SQL test in `supabase/tests/biz_ticket_checkout_create_session_test.sql` (or wherever the project's SQL tests live) that: (a) inserts a session with status='processing_payment' and expires_at=now()-interval '1 hour', (b) calls the RPC with matching idempotency_key, (c) asserts the response's checkoutSessionId is DIFFERENT from the original row's id (fresh insert), (d) asserts the original row's idempotency_key now ends in ':tombstone:<id>'.

---

## Discoveries for Orchestrator

### D-1 (resolved by this investigation): Root cause identified, classification updated
The original D-1 from RETEST_2 was "ticket-checkout-create returns 200 but no session row." This investigation proves the row IS inserted (originally, at 07:38 UTC), but the SHORT-CIRCUIT branch at RPC line 89-112 returns the existing row WITHOUT a fresh insert for subsequent retries. The 200 response is the RETURN at line 388 of the edge function (`kind: "requires_payment"`) but with STALE clientSecret. This is not actually a bug "in" `ticket-checkout-create` — it's a bug in the downstream RPC `biz_ticket_checkout_create_session` whose tombstone-eligibility predicate is too narrow.

### D-2 (from RETEST_2, re-confirmed here as H-2): handleBuy stuck-flag pattern
The RETEST_2 tester's D-2 stands. The SPEC should fix it inside the same close to prevent a different class of "silent stuck" bugs.

### D-3 (from RETEST_2, downgraded to infra-only): Metro log capture gap
The RETEST_2 tester's D-3 stands as a tester-infra note but is not actionable for this investigation. Future Stripe live-fire tests would benefit from Metro being launched by the tester via run_in_background so stdout is accessible. Not in scope for D-1's fix.

### D-NEW-1: Periodic cleanup of past-expiry non-terminal sessions
A sibling ORCH should add a periodic job that transitions past-expiry rows to `status='expired'`. Defense in depth so this class of bug cannot recur via any other code path (e.g. if a future code change adds a new entry point that bypasses the RPC's tombstone fix). Suggest pg_cron with a 5-minute interval. Cost: trivial query. Operator decision required because pg_cron extension may need enabling.

### D-NEW-2: Cancel stale Stripe PaymentIntents on tombstone
The edge function should also call `stripe.paymentIntents.cancel()` when an RPC tombstones a row that had a `stripe_payment_intent_id`. This cleans up Stripe-side noise. Not blocking but worth bundling with the fix.

### D-NEW-3: Duplicate Stripe Connect data on `brands` vs `stripe_connect_accounts`
Both tables track the same fields. The RPC reads from `stripe_connect_accounts`; the admin dashboard probably reads from `brands`. If the two ever drift, the admin will show a different truth than the buyer flow. Suggest declaring one source canonical and either: dropping the columns from the other, OR adding a trigger that keeps them in sync. Future investigation, not blocking.

### D-NEW-4: The buyer email "sethogieva@icloud.com" doesn't match the test user's display
Marcus Rivera's email on the stuck row is "sethogieva@icloud.com" — i.e. the operator's email. This is correct for the test setup (operator-as-Marcus-Rivera) but worth flagging that test/dev sessions use operator-owned identities. No security concern; just contextual note.

---

## Confidence Level: **High**

Root cause is proven via:
- Code reading (RPC short-circuit branch is unambiguous)
- Live RPC body verified against migration source (no drift)
- Live DB row exists with all preconditions for short-circuit (matching key, in-flight status, past expiry)
- Live row's `updated_at` advanced during the live-fire window (proves function reached it)
- Stripe Connect health is independently verified as healthy (rules out alternative hypothesis)
- The fix candidate is testable by manually tombstoning the row and re-running the same Maestro flow (recommend operator do this as diagnostic confirmation before implementor begins)

The only piece NOT directly tested is **why the Stripe SDK hangs on a stale clientSecret** (vs returning a clean error). That mechanism is opaque to source-only reading — could be PaymentIntent state validation, could be the once-resolve bug, could be a timeout in Stripe's iOS SDK. But that mechanism is downstream of D-1's root cause and irrelevant to fixing it: if R-1 is fixed, the stale clientSecret is never sent in the first place.

---

## Working-Branch Discipline

This investigation and its report live in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) were written from this skill — they belong to the orchestrator at CLOSE. No code was written or modified. No edge function deployed. No migration applied. No destructive DB action taken.

---

NEXT HANDOFF — paste into Claude `mingla-forensics` (SPEC mode):

Spec the fix for ORCH-0829-B D-1's root cause. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Read first: the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_CHECKOUT_CREATE_RETURNS_200_NO_SESSION.md` for full root-cause + classified findings (R-1 + H-1 + H-2 + H-3 + O-1 + D-NEW-1..4) — the spec is the contract that turns those findings into an implementable bounded fix. In-scope: (1) R-1 fix — a new migration that CREATE OR REPLACE FUNCTION `biz_ticket_checkout_create_session` extending the tombstone-eligibility predicate at line 83 from `status IN (...terminal set)` to `status IN (...terminal set) OR v_existing.expires_at < now()`, AND transitioning the tombstoned row's status to `'expired'` in the same UPDATE when it isn't already terminal; (2) H-2 fix — wrap `runNativeCheckout` in `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:220-233` in `try/finally` so `setCheckoutInFlight(false)` always fires; (3) H-3 fix — add a 60s timeout race to `presentPaymentSheet` (and to `initPaymentSheet` for symmetry) in `packages/payments-native/useStripePaymentSheet.ts:75-99` so the in-flight Promise rejects with a synthetic `code: 'Timeout'` error AND clears the inFlight ref via the existing finally; (4) regression-prevention: add invariant I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE (orchestrator owns), and a strict-grep CI gate that reads the LATEST `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session` migration body and asserts the OR-clause is present (mirror the registry pattern in `feedback_strict_grep_registry_pattern.md`). Out-of-scope: H-1 Stripe PI cancellation on tombstone (defer to ORCH-0830 candidate — needs a stripe.paymentIntents.cancel call in the edge function with proper error handling, larger change), C-1 / D-NEW-1 pg_cron periodic cleanup (sibling ORCH; operator may want to enable pg_cron extension separately), D-NEW-3 brands/stripe_connect_accounts dedup (architectural, not a fix). Hard guards: SPEC only — no code, no migrations applied, no edge deploy, no DB writes; cite findings R-1/H-2/H-3 by name; success criteria must be live-fire-testable on iPhone 17 Pro sim with the exact same Maestro reproducer from RETEST_2 (Discover → Big Party → Buy ticket → confirm → Continue → Stripe sheet renders card-entry form → user enters 4242 → success toast + ticket appears in calendar within 5s); define test cases including the H-2 stuck-flag scenario (force a hang, verify subsequent attempts can still fire); name the migration `supabase/migrations/<monotonic_timestamp>_orch_0829b_d1_checkout_expiry_tombstone.sql` (monotonic prefix > `20260605000001`); the implementor must `supabase db push` the migration (operator runs that) before iOS dev rebuild. Expected output: `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md`. Downstream routing: SPEC return → orchestrator REVIEW → Codex `implementor-mingla` (or Claude `mingla-implementor` if you redirect) IMPLEMENT → tester RETEST_3 live-fire of -B end-to-end → orchestrator CLOSE of four-ORCH bundle (0824 + 0828 + 0829-A + 0829-B) together.
