// ORCH-1188 FIX 3 [consumer calendar — booked occurrence date] — migration
// source-contract test.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1188_finalize_event_date_id.test.ts
//
// FIX 3a — add nullable orders.event_date_id (FK → event_dates, indexed).
// FIX 3b — biz_ticket_checkout_finalize copies the session's selected occurrence
//          (metadata->>'event_date_id', NULL-safe) onto the new order.
//
// The finalize re-emit is ADDITIVE-ONLY: it must preserve the signature, the
// idempotent early-return, ticket-minting, installment logic, chat + notification
// inserts, and the GRANT — adding ONLY the event_date_id column + value. These
// asserts FAIL on a TRUE LINE-DELETION of the fix, and ALSO guard that the
// re-emit didn't drop the payment-critical surface.

import { assert } from "jsr:@std/assert@1";

const ADD_COL =
  "supabase/migrations/20261117000000_orch_1188_orders_event_date_id.sql";
const FINALIZE =
  "supabase/migrations/20261117000001_orch_1188_finalize_persist_event_date_id.sql";

const addSql = await Deno.readTextFile(ADD_COL);
const finSql = await Deno.readTextFile(FINALIZE);

function has(sql: string, needle: string, why: string) {
  assert(sql.includes(needle), `must contain \`${needle}\` (${why})`);
}

// ── FIX 3a: the column migration ──────────────────────────────────────────────
Deno.test("FIX3a — orders.event_date_id is added nullable, FK'd, indexed", () => {
  has(addSql, "ADD COLUMN IF NOT EXISTS event_date_id uuid", "nullable column");
  has(addSql, "REFERENCES public.event_dates(id)", "FK to event_dates");
  has(addSql, "ON DELETE SET NULL", "stale-occurrence delete must not nuke order");
  has(addSql, "orders_event_date_id_idx", "indexed for the calendar read");
  // It must NOT be NOT NULL (every legacy order keeps NULL).
  assert(
    !/event_date_id\s+uuid\s+NOT\s+NULL/i.test(addSql),
    "event_date_id must be nullable (additive, no backfill)",
  );
});

// ── FIX 3b: finalize copies the session occurrence ────────────────────────────
Deno.test("FIX3b — finalize INSERT writes event_date_id from session metadata", () => {
  // The column is in the INSERT column list.
  has(finSql, "event_date_id", "order INSERT must write event_date_id");
  // The value reads the session's selected occurrence, NULL-safe.
  has(
    finSql,
    "NULLIF(v_session.metadata->>'event_date_id', '')::uuid",
    "must read the buyer's selected occurrence from session metadata (NULL-safe)",
  );
});

Deno.test("FIX3b — finalize re-emit preserves the payment-critical surface", () => {
  // Same 8-param signature.
  has(finSql, "p_installment_plan_root boolean DEFAULT false", "8-param signature");
  has(finSql, "SECURITY DEFINER", "security context preserved");
  has(finSql, "SET search_path = public, auth", "search_path preserved");
  // Idempotent early-return on an already-finalized session.
  has(finSql, "IF v_session.order_id IS NOT NULL THEN", "idempotent early-return");
  // Ticket minting + chat + notifications + grant intact.
  has(finSql, "INSERT INTO public.tickets", "ticket minting preserved");
  has(finSql, "public.add_buyer_to_event_chat", "buyer-chat join preserved");
  has(finSql, "INSERT INTO public.ticket_order_notifications", "notify rows preserved");
  has(
    finSql,
    "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize",
    "service_role grant preserved",
  );
  // The 1-overload self-verify guard is intact.
  has(finSql, "expected exactly 1 biz_ticket_checkout_finalize", "self-verify guard");
  // pricing_breakdown (ORCH-1006) must still be written — proves the re-emit was
  // based on the LATEST definition, not a stale pre-1006 one.
  has(finSql, "v_session.pricing_breakdown", "ORCH-1006 pricing_breakdown preserved");
});
