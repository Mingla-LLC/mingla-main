# SPEC — ORCH-0791: Repurchase after refund must produce a fresh checkout session

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** SPEC (contract). No implementation.
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md`.
**Implementor target:** orchestrator (delegated execution) — single-file migration plus strict-grep gate. No frontend code, no edge function code, no edge function redeploy.

---

## 1. Scope and non-goals

### In scope

1. **One new migration** that recreates `public.biz_ticket_checkout_create_session` with terminal-state-aware existing-session handling. When an existing session is found by `idempotency_key` whose `status` is in the terminal set, tombstone its `idempotency_key` (suffix with `:tombstone:` + the session UUID) and fall through to the normal insert path. In-flight retries (non-terminal statuses) still return the existing session as before, preserving the I-CHECKOUT-IDEMPOTENT invariant.

2. **One strict-grep CI gate** (`orch-0791-checkout-session-never-reused-post-terminal.mjs`) that asserts the RPC body in `supabase/migrations/` contains the terminal-status branch and the tombstone update. Mirror the registry pattern in memory `feedback_strict_grep_registry_pattern.md`.

3. **One new proposed invariant** registered in DRAFT state, flips to ACTIVE on CLOSE: `I-PROPOSED-AW CHECKOUT-SESSION-NEVER-REUSED-POST-TERMINAL`.

### Non-goals (explicitly NOT in scope)

- Edge function code changes (`ticket-checkout-create/index.ts`) — none needed. Once the RPC returns a fresh session UUID, the cascade resolves on its own. The Stripe idempotency key `ticket_checkout:${checkoutSessionId}` is downstream of the RPC and is naturally fresh.
- Frontend code changes — none needed. The buyer flow is unaware of the RPC's internal session-row management.
- One-time backfill of existing terminal `ticket_checkout_sessions` rows on production. **Decision: forward-looking fix only.** Existing terminal rows will continue to block their original buyers' repurchase attempts UNTIL each buyer makes one more attempt — at which point the new RPC tombstones the old row in-flight and proceeds normally. The bug self-heals on next contact. A bulk backfill would be a separate sub-ORCH if operator wants instantaneous remediation; for now, the natural one-attempt healing is acceptable.
- Refund flow changes — `supabase/functions/refund-order/index.ts` stays unchanged. The fix consolidates session-lifecycle logic in the create RPC (one owner per truth).
- Free-ticket flow (`biz_ticket_checkout_finalize` re-entry). Investigation §"Open questions" Q3 flagged this for trace. Decision: **out of scope for ORCH-0791.** Free flows don't involve a Stripe PaymentIntent and don't fail the same way. If a free-flow regression is later confirmed, register as a P3 sub-ORCH. Justification: ORCH-0791's reported symptom is paid-only and operator-affecting; free-ticket repurchase has no money path and a much narrower blast radius.
- Web-flow refund→retry trace (Q4). Decision: **the fix applies to both surfaces uniformly** because both surfaces hit the same RPC at the same gate. No separate web SPEC criterion is needed; the live-fire smoke will cover web too.
- Stripe-side cleanup of orphan PaymentIntents from refunded purchases. Separate P2 sub-ORCH (DISC-1 from ORCH-0789 investigation).

### Assumptions

- The `biz_ticket_checkout_create_session` function is owned by the Mingla codebase and can be recreated via `CREATE OR REPLACE FUNCTION` in a new migration with no inbound migration ordering concerns (migration timestamps are monotonic on `Seth` per `feedback_migration_filename_monotonic` / the implementor cross-skill parity rule).
- The existing UNIQUE constraint on `ticket_checkout_sessions.idempotency_key` is preserved — the fix works WITH that constraint by mutating the old row's key before the new insert.
- Operator owns `supabase db push --linked` per the standing deploy split. Implementor commits the migration file; operator applies.

---

## 2. Migration specification

### Filename

`supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql`

Monotonic check: current max prefix on `Seth` is `20260520000001` (the ORCH-0789/0790 migration). New filename uses `...02`, strictly greater. No remote-head conflict because the operator already pushed `...01`.

### Content shape (illustrative — implementor follows verbatim or operator-approved equivalent)

```sql
-- ORCH-0791: Terminal sessions must not block repurchase.
--
-- Pre-existing bug: biz_ticket_checkout_create_session looks up an
-- existing ticket_checkout_sessions row by idempotency_key and returns
-- it unconditionally on match. After a refund (which leaves the row in
-- status='paid_completed' permanently), a same-buyer-same-event retry
-- hits this lookup, returns the old session, and the edge function
-- reuses the Stripe PaymentIntent — which Stripe rejects with `Failed`
-- because the PI is in a terminal succeeded → refunded state.
--
-- Fix: when an existing session is found in a terminal status
-- (paid_completed, free_completed, failed, expired), tombstone its
-- idempotency_key so the UNIQUE constraint frees the deterministic
-- buyer key for the fresh insert below. In-flight retries (statuses
-- pending_free, requires_payment, awaiting_web_redirect,
-- processing_payment) are unchanged — they still short-circuit to the
-- existing row as before.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
BEGIN
  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- ORCH-0791: terminal sessions are historical artifacts; do not
    -- reuse them. Tombstone the old idempotency_key so the UNIQUE
    -- constraint frees the deterministic key for a fresh insert.
    -- In-flight statuses keep the existing short-circuit behaviour
    -- so genuine retries during checkout still dedupe correctly.
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             updated_at = now()
       WHERE id = v_existing.id;
      -- Fall through to the normal create path below.
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
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
  END IF;

  -- (existing event + line-item validation + INSERT path, lines 343-477
  -- of the original definition, copied verbatim without modification)
  -- [implementor: copy the unchanged remainder of the original RPC body]

END;
$$;

COMMIT;
```

**Implementor instruction:** the SQL body from the original migration line 343 onward (event lookup, line-item validation, INSERT, RETURN of the freshly-created session) is copied verbatim into the new migration. Only the FOUND branch is restructured per the diff above. The function's signature, language, security definer, and search_path are unchanged.

### What this preserves

- **Function signature:** byte-for-byte identical. No callers need updating.
- **In-flight retry behaviour:** non-terminal statuses still short-circuit, exactly as today. The I-CHECKOUT-IDEMPOTENT invariant holds.
- **Audit trail:** the old session row remains in the table (tombstoned key, original `id`, original `order_id`, original `stripe_payment_intent_id`). Refunds can still be traced through the chain.
- **UNIQUE(idempotency_key) constraint:** untouched. The tombstone suffix `:tombstone:<uuid>` guarantees uniqueness with cryptographically negligible collision probability (UUIDv4).
- **RLS policies on `ticket_checkout_sessions`:** untouched. SECURITY DEFINER continues to bypass policies for the controlled update.
- **All other CHECK constraints on `ticket_checkout_sessions`:** untouched.

### What this changes

- One conditional branch added inside the FOUND check.
- One UPDATE statement that mutates `idempotency_key` + `updated_at` on the old row when terminal.

Net behavioural delta: zero for in-flight retries, fully resolved for post-terminal retries.

---

## 3. Success criteria (testable)

| # | Criterion | Verifiable by |
|---|-----------|---------------|
| SC-01 | When `biz_ticket_checkout_create_session` is called with an `idempotency_key` that matches an existing row whose `status='paid_completed'`, the RPC returns a NEW `checkoutSessionId` (different from the old session's id) and the old row's `idempotency_key` has been suffixed with `:tombstone:<old-id>`. | SQL probe with a synthetic terminal session |
| SC-02 | Same as SC-01 but for `status='free_completed'`. | SQL probe |
| SC-03 | Same as SC-01 but for `status='failed'`. | SQL probe |
| SC-04 | Same as SC-01 but for `status='expired'`. | SQL probe |
| SC-05 | When called with an `idempotency_key` that matches an existing row whose `status='requires_payment'` (in-flight), the RPC returns the EXISTING `checkoutSessionId` (preserves in-flight dedup) and the row's `idempotency_key` is unchanged. | SQL probe |
| SC-06 | Same as SC-05 for `status='processing_payment'`. | SQL probe |
| SC-07 | Same as SC-05 for `status='awaiting_web_redirect'` (ORCH-0790's new status). | SQL probe |
| SC-08 | Same as SC-05 for `status='pending_free'`. | SQL probe |
| SC-09 | Live-fire: operator buys a ticket on Party Block as buyer X, refunds it, then repurchases the same ticket as buyer X. Both purchases succeed end-to-end (different `orders.id` rows, both with `payment_status='paid'`). | Operator iPhone smoke (Stripe test mode) |
| SC-10 | Strict-grep gate `orch-0791-checkout-session-never-reused-post-terminal` exits 0 on clean code and exits 1 with file:line on a forced violation (e.g. removing the terminal-status branch from the migration). | CI script |
| SC-11 | No regression to existing buyers: full Jest suite green, full strict-grep sweep green (modulo the pre-existing `orch-0776a` failure), `deno check` on touched modules clean. | Local gate sweep |

---

## 4. Invariants

### Must hold (existing)

- **I-PUBLIC-BUYER-ANON-TOLERANT:** preserved — no auth changes.
- **I-CHECKOUT-IDEMPOTENT:** preserved AND strengthened. In-flight retries still dedupe identically. Post-terminal retries are now distinguished, which is the correct interpretation of idempotency (same-input-same-output, but a refunded session is no longer the "same" input from the buyer's perspective).
- **I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE** + **I-PROPOSED-AV STRIPE_ERROR_CODE_DISCRIMINATED** (DRAFT from ORCH-0789): preserved — no Toast or wrapper changes.
- **I-PROPOSED-AC SETH_SINGLE_WORKING_BRANCH:** preserved — work is on `Seth`.

### New (DRAFT, flips ACTIVE on CLOSE)

- **I-PROPOSED-AW CHECKOUT-SESSION-NEVER-REUSED-POST-TERMINAL** — `biz_ticket_checkout_create_session` MUST NOT return an existing session row whose status is in the terminal set (`paid_completed`, `free_completed`, `failed`, `expired`). Such rows MUST have their `idempotency_key` tombstoned in-flight so a fresh session can be created. Enforced by strict-grep gate + the SQL probes in §3.

---

## 5. Strict-grep gate

### File

`.github/scripts/strict-grep/orch-0791-checkout-session-never-reused-post-terminal.mjs`

### Workflow job

Append to `.github/workflows/strict-grep-mingla-business.yml` after the existing `orch-0789-error-toast-dismissible` job, mirroring the job shape exactly.

### Gate logic (illustrative)

The gate reads the latest migration that touches `biz_ticket_checkout_create_session` (resolved by grepping `supabase/migrations/*.sql` for `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session` and picking the highest-prefix match) and asserts:

1. The RPC body contains the literal substring `IN ('paid_completed','free_completed','failed','expired')` (or an equivalent ANY-array form).
2. The RPC body contains `idempotency_key = idempotency_key || ':tombstone:' || id::text` (the tombstone UPDATE shape).
3. The RPC body still contains the in-flight short-circuit RETURN for non-terminal cases.

Exit 0 on pass, exit 1 with `<migration-path>:<reason>` on fail.

---

## 6. Implementation order

1. **Write the migration.** `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql`. Copy the original RPC body verbatim from `20260515000013_orch_0777_ticket_checkout_core.sql` and apply ONLY the FOUND-branch restructuring documented in §2.
2. **Write the strict-grep gate** per §5.
3. **Append the workflow job** to `.github/workflows/strict-grep-mingla-business.yml`.
4. **Register the DRAFT invariant** in `Mingla_Artifacts/INVARIANT_REGISTRY.md` mirroring the AU/AV precedent.
5. **Run local gates:** `node .github/scripts/strict-grep/orch-0791-*.mjs` (expect PASS), full strict-grep sweep (expect no new failures beyond the pre-existing `orch-0776a`), Jest full suite (expect 48/48 suites, 303/303 tests — no JS code changed).
6. **Write the implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md` with old→new receipts.
7. **Operator runs `supabase db push --linked`** to apply the migration.
8. **Live-fire smoke** (operator-owned, SC-09): buy on Party Block, refund, repurchase same ticket as same buyer. Confirm second purchase reaches confirmation screen with tickets.
9. **TEST mode verification** (orchestrator-delegated): run SQL probes for SC-01..SC-08 against the live migration; record evidence in QA report.
10. **CLOSE** the combined ORCH-0789/0790/0791 dispatch via the orchestrator's CLOSE protocol — artifact sync across all seven docs (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS), flip I-PROPOSED-AU/AV/AW DRAFT → ACTIVE, DIAG marker reap, commit message, EAS iOS OTA (`eas update --branch production --platform ios` then `--platform android`), queue advance.

---

## 7. Hard guards (implementor MUST NOT)

- Do NOT run `supabase db push` — operator-owned.
- Do NOT redeploy any edge function — `ticket-checkout-create` and `stripe-webhook` are already correct; no code change needed.
- Do NOT modify the existing ORCH-0777 migration file in place — always a fresh CREATE OR REPLACE migration.
- Do NOT widen scope into free-ticket repurchase, web-flow separate trace, or backfill of existing terminal rows (all explicitly out of scope per §1).
- Do NOT add new columns to `ticket_checkout_sessions`. The fix uses existing fields only.
- Do NOT change any frontend code. The buyer-side flow is unaware of this RPC's internal session-row management.
- Do NOT introduce a new helper function or refactor the RPC body beyond the minimal terminal-branch addition. Surgical fix only.
- Do NOT delete the tombstoned session rows — keep them for the audit trail. The old `id`, `order_id`, `stripe_payment_intent_id`, `stripe_checkout_session_id` fields remain queryable for forensic / refund-reconciliation work.

---

## 8. Regression prevention

1. **Strict-grep gate** (§5) — catches removal of the terminal-status branch or the tombstone UPDATE.
2. **SQL probes for SC-01..SC-08** — verifiable against staging or test DB. Implementor records the exact probe SQL in the implementation report; tester re-runs against live DB.
3. **Protective comment** at the new terminal-branch logic in the migration: `-- ORCH-0791: terminal sessions are historical artifacts; do not reuse them.` Already in the migration content sketch.
4. **DECISION_LOG entry** (orchestrator-owned at CLOSE) recording the trade-off: "session idempotency keys are buyer-identity-deterministic across attempts EXCEPT when the prior attempt is terminal, in which case the prior session is tombstoned to free the key." Future readers don't have to re-derive the design.

---

## 9. Output

Implementor produces:
- The migration file per §2.
- The strict-grep gate script per §5.
- The workflow YAML update per §5.
- The DRAFT invariant entry in INVARIANT_REGISTRY.md per §4.
- The implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0791_REPURCHASE_AFTER_REFUND_FAILS.md` with per-file receipts, gate-output evidence, and a list of SC-criteria mapped to verification status (most will be UNVERIFIED at impl time and verified by TEST after `supabase db push`).

No frontend code. No edge function deploys. No backend RPC calls beyond writing the SQL file.

---

## 10. Downstream routing

After implementor return: operator runs `supabase db push --linked` (gate 7), runs the live-fire smoke (gate 8), TEST mode runs SQL probes (gate 9), orchestrator CLOSE (gate 10). The ORCH-0789, ORCH-0790, and ORCH-0791 close together as a single bundle — all three were the same operator-visible bug from different mechanisms; closing them together makes the close note coherent.
