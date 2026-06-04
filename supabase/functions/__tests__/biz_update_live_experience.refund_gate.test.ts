// META-ORCH-1059 [experiences-business-parity] · SUB-E · EDIT-AFTER-PUBLISH GUARDS
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_update_live_experience.refund_gate.test.ts
//
// Source-level migration regression for biz_update_live_experience (the live-
// experience refund-gate RPC). The worktree has no live SQL harness (repo
// convention — see biz_publish_experience.draft_lifecycle.test.ts), so this pins
// the SQL contract that would FAIL if the RPC is reverted or the buyer-protection
// gate is weakened.
//
// Asserts (Sub-E contract) for biz_update_live_experience(p_event_id, p_payload, p_reason):
//   1. Reason required + length-gated (missing_edit_reason / invalid_edit_reason).
//   2. Status gate — only scheduled|live (experience_not_editable_status); a draft
//      can never trip the live guards.
//   3. capacity_below_sold — capacity can't drop below the sold count.
//   4. price_change_with_sales — the ONE ticket's resolved price is locked once sold.
//   5. dates_shifted_with_sales — occurrence add/remove/shift with sales rejected.
//   6. stop_removed_with_sales — removing a sold stop rejected (edit/add allowed).
//   7. I-1 one-ticket preserved (UPDATE the single live ticket, no N tickets) + I-6
//      no Stripe/parallel money fn + same permission gate + SECURITY DEFINER.
//   8. Append-only audit: experience_edit_log inserted; no UPDATE/DELETE policy.
//
// fails-on-revert: each assertion targets a distinct shipped construct; reverting
// the RPC (or weakening any gate) flips an assertion.

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260902000000_meta_orch_1059_sub_e_update_live_experience.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.biz_update_live_experience[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "biz_update_live_experience function body is present");
  return match![1];
}

const body = functionBody(migration);

Deno.test("E-01 reason is required and length-gated (10–200)", () => {
  assert(
    /v_trimmed_reason\s*=\s*''[\s\S]*?'reason',\s*'missing_edit_reason'/i.test(body),
    "empty reason → missing_edit_reason",
  );
  assert(
    /char_length\(v_trimmed_reason\)\s*<\s*10\s*OR\s*char_length\(v_trimmed_reason\)\s*>\s*200[\s\S]*?'invalid_edit_reason'/i.test(
      body,
    ),
    "reason <10 or >200 chars → invalid_edit_reason",
  );
});

Deno.test("E-02 status gate — only scheduled|live; a draft can never trip the live guards", () => {
  assert(
    /v_existing\.status\s+NOT IN\s*\('scheduled',\s*'live'\)[\s\S]*?'experience_not_editable_status'/i.test(
      body,
    ),
    "non-scheduled/live status → experience_not_editable_status (draft never routes here)",
  );
});

Deno.test("E-03 capacity_below_sold — capacity can't drop below the sold count", () => {
  assert(
    /v_capacity\s*<\s*v_total_sold[\s\S]*?'reason',\s*'capacity_below_sold'/i.test(body),
    "capacity below sold → capacity_below_sold with affected_order_count",
  );
});

Deno.test("E-04 price_change_with_sales — the ONE ticket's resolved price is locked once sold", () => {
  assert(
    /IF v_total_sold\s*>\s*0 THEN/i.test(body),
    "price/stop/date gates fire only when sold > 0",
  );
  assert(
    /v_resolved_total\s+IS DISTINCT FROM\s+v_old_resolved[\s\S]*?'reason',\s*'price_change_with_sales'/i.test(
      body,
    ),
    "resolved price change with sales → price_change_with_sales",
  );
});

Deno.test("E-05 dates_shifted_with_sales — occurrence add/remove/shift with sales rejected", () => {
  assert(
    /v_dates_changed[\s\S]*?'reason',\s*'dates_shifted_with_sales'/i.test(body),
    "date change with sales → dates_shifted_with_sales",
  );
  // count-mismatch OR pairwise-instant-mismatch both flip v_dates_changed.
  assert(
    /array_length\(v_old_date_starts[\s\S]*?IS DISTINCT FROM[\s\S]*?array_length\(v_new_date_starts/i.test(
      body,
    ),
    "occurrence count change is detected",
  );
});

Deno.test("E-06 stop_removed_with_sales — removing a sold stop rejected (edit/add allowed)", () => {
  assert(
    /v_dropped_stops[\s\S]*?'reason',\s*'stop_removed_with_sales'/i.test(body),
    "dropped stop with sales → stop_removed_with_sales",
  );
  // Dropped = existing stop keys NOT present in the new payload keys.
  assert(
    /WHERE NOT \(k = ANY \(v_new_stop_keys\)\)/i.test(body),
    "dropped stops = existing keys absent from the new payload (adds/edits are not drops)",
  );
});

Deno.test("E-07 I-1 one-ticket preserved (UPDATE the single live ticket, no N tickets) + I-6 no Stripe", () => {
  // The live ticket is UPDATEd in place (preserves order_line_items.ticket_type_id).
  assert(
    /UPDATE\s+public\.ticket_types\s+SET[\s\S]*?price_cents\s*=\s*v_resolved_total[\s\S]*?WHERE\s+event_id\s*=\s*p_event_id/i.test(
      body,
    ),
    "the single live ticket is UPDATEd at the resolved total (I-1)",
  );
  const ticketInserts = body.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assertEquals(ticketInserts.length, 0, "no new ticket_types INSERT — the live ticket is edited in place (never N)");
  assert(
    !/payment_intent|application_fee|stripe\./i.test(body),
    "no Stripe/payment surface (I-6 / COMMS-0014/0016)",
  );
});

Deno.test("E-08 same permission gate + SECURITY DEFINER + execute grant", () => {
  assert(
    /biz_brand_effective_rank\([\s\S]*?biz_role_rank\('event_manager'::text\)/i.test(body),
    "same event_manager permission gate as biz_publish_experience",
  );
  assert(/SECURITY DEFINER/i.test(migration), "RPC is SECURITY DEFINER");
  assert(
    /GRANT EXECUTE ON FUNCTION public\.biz_update_live_experience\(uuid, jsonb, text\) TO authenticated/i.test(
      migration,
    ),
    "execute granted to authenticated",
  );
});

Deno.test("E-09 append-only audit: experience_edit_log inserted; no UPDATE/DELETE policy", () => {
  assert(
    /INSERT\s+INTO\s+public\.experience_edit_log/i.test(body),
    "every successful live edit inserts an audit row",
  );
  // Owner-read policy exists; NO insert/update/delete policy (only the SECURITY
  // DEFINER RPC writes).
  assert(
    /CREATE POLICY "experience_edit_log_owner_read"[\s\S]*?FOR SELECT/i.test(migration),
    "owner-read SELECT policy present",
  );
  assert(
    !/CREATE POLICY[\s\S]*?experience_edit_log[\s\S]*?FOR (INSERT|UPDATE|DELETE)/i.test(migration),
    "no client INSERT/UPDATE/DELETE policy on the audit log (tamper-resistant)",
  );
});

Deno.test("E-10 reason persisted with the same 10–200 CHECK as the trip audit log", () => {
  assert(
    /reason text NOT NULL CHECK \(char_length\(reason\) BETWEEN 10 AND 200\)/i.test(migration),
    "DB-level CHECK on reason length (defense in depth)",
  );
});
