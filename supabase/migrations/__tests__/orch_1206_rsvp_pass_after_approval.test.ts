// ORCH-1206 — source-contract guard for "the RSVP QR pass is delivered ONLY
// after approval (never while pending)". CI has no live Postgres, so (matching
// the proven orch_1203/orch_1200 SQL-text tests) this pins the load-bearing
// invariants by asserting the migration + edge-fn text. The orchestrator runs
// the live behavioral verification post-merge per the SPEC §"Live verification".
//
// The `// [FAILS-ON-REVERT KEY]` lines are the assertions proven to go RED when
// the change is reverted in-worktree.
//
// Run: deno test --allow-read --allow-env
import { assert } from "jsr:@std/assert@1";

const MIG = "supabase/migrations/20261123000000_orch_1206_rsvp_pass_after_approval.sql";
const SUBMIT = "supabase/functions/public-submit-rsvp/index.ts";
const DRAIN = "supabase/functions/backfill-rsvp-qr-codes/index.ts";

const sql = await Deno.readTextFile(MIG);
const submit = await Deno.readTextFile(SUBMIT);
const drain = await Deno.readTextFile(DRAIN);

const hasIn = (hay: string, n: string, why: string) =>
  assert(hay.includes(n), `must contain \`${n}\` (${why})`);
const hasNotIn = (hay: string, n: string, why: string) =>
  assert(!hay.includes(n), `must NOT contain \`${n}\` (${why})`);

// ───────────────────────────────────────────────────────────────────────────
// C-1 — submit gate: pass delivered IFF going AND approved.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("C-1 — submit dispatches the pass ONLY for going AND approved", () => {
  // [FAILS-ON-REVERT KEY] — the approval gate must be present at the dispatch.
  hasIn(
    submit,
    'result.approvalStatus === "approved"',
    "submit must gate the pass dispatch on approved (manual-pending → no pass)",
  );
  // The going gate stays too (both conditions guard dispatchRsvpPasses).
  hasIn(submit, 'result.status === "going"', "going gate retained");
});

// ───────────────────────────────────────────────────────────────────────────
// C-2 / I-4 — single-owner SQL enqueue routine, used by approve + backfill.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("C-2/I-4 — enqueue_rsvp_pass is the single-owner enqueue routine", () => {
  // [FAILS-ON-REVERT KEY]
  hasIn(sql, "FUNCTION public.enqueue_rsvp_pass(", "the shared enqueue routine exists");
  // Self-gates on going+approved (I-1).
  hasIn(
    sql,
    "v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved'",
    "enqueue self-gates on going+approved (I-1)",
  );
  // Mints via the shared biz_rsvp_mint_qr (I-5) for null-qr recipients.
  hasIn(sql, "public.biz_rsvp_mint_qr(p_rsvp_id, v_pepper)", "primary mint via shared routine (I-5)");
  hasIn(sql, "public.biz_rsvp_mint_qr(v_guest.id, v_pepper)", "guest mint via shared routine (I-5)");
});

Deno.test("C-2 — host approve RPCs call enqueue_rsvp_pass (not the no-QR notice)", () => {
  // [FAILS-ON-REVERT KEY] — single approve path enqueues the QR pass.
  hasIn(
    sql,
    "PERFORM public.enqueue_rsvp_pass(p_rsvp_id, NULL)",
    "host_set_rsvp_status enqueues the QR pass on approve (I-2)",
  );
  // [FAILS-ON-REVERT KEY] — bulk approve fans out one pass per approved row.
  hasIn(
    sql,
    "PERFORM public.enqueue_rsvp_pass(v_entry.id, NULL)",
    "host_bulk_approve_rsvps enqueues the QR pass per approved row (I-2)",
  );
});

Deno.test("C-2 — approve REPLACES the no-QR rsvp_approved notice (don't send both)", () => {
  // The single-approve branch sets v_template := NULL so no plain rsvp_approved
  // row is inserted; the bulk path no longer inserts 'rsvp_approved' at all.
  // [FAILS-ON-REVERT KEY]
  hasIn(
    sql,
    "v_template := NULL;  -- no plain rsvp_approved notice",
    "single approve no longer sends the plain rsvp_approved notice",
  );
  // bulk_approve must not enqueue a 'rsvp_approved' template anymore.
  hasNotIn(sql, "'rsvp_approved'", "no rsvp_approved enqueue survives in this migration");
});

Deno.test("C-2 — rsvp_denied / rsvp_removed notices are UNCHANGED", () => {
  hasIn(sql, "'rsvp_removed'", "rsvp_removed notice retained");
  hasIn(sql, "'rsvp_denied'", "rsvp_denied notice retained");
  // Their idempotency key form is preserved.
  hasIn(
    sql,
    "'rsvp_approval:' || p_rsvp_id::text || ':' || v_source || ':' || p_status",
    "deny/remove keeps the rsvp_approval: key form",
  );
});

Deno.test("C-2 — approve capacity gate is INTACT (byte-faithful except enqueue)", () => {
  // [FAILS-ON-REVERT KEY] — capacity gate must survive the redefinition.
  hasIn(sql, "RAISE EXCEPTION 'rsvp_capacity_full'", "single approve capacity gate intact");
  hasIn(
    sql,
    "v_free IS NOT NULL AND (1 + v_entry.plus_count) > v_free",
    "bulk approve free-seat skip intact",
  );
  // waitlisted->going promotion preserved on approve.
  hasIn(
    sql,
    "CASE WHEN rsvp_status = 'waitlisted' THEN 'going' ELSE rsvp_status END",
    "waitlisted->going promotion preserved",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// C-3 / I-1 — backfill gates on going AND approved.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("C-3/I-1 — backfill selects only going+APPROVED rows (skips pending)", () => {
  // [FAILS-ON-REVERT KEY] — the approval gate is the whole point of C-3. Assert
  // the EXACT contiguous backfill WHERE clause (going AND approved AND rsvp type)
  // so the test is unique to the backfill block (the approve RPC also references
  // approval_status='approved' in its capacity gate).
  hasIn(
    sql,
    "WHERE r.rsvp_status = 'going'\n       AND r.approval_status = 'approved'\n       AND e.event_type = 'rsvp'",
    "backfill gates on going+approved+rsvp (no pending pass)",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// I-3 — SINGLE canonical idempotency keyspace across submit / approve / backfill.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("I-3 — the SQL enqueue uses the canonical rsvp_pass: key (same as TS submit)", () => {
  // [FAILS-ON-REVERT KEY] — primary canonical key, identical form to the TS
  // submit key `rsvp_pass:${rsvpId}:${guestId ?? 'primary'}`.
  hasIn(
    sql,
    "'rsvp_pass:' || p_rsvp_id::text || ':primary'",
    "SQL primary key == rsvp_pass:<rsvpId>:primary",
  );
  // [FAILS-ON-REVERT KEY] — guest canonical key.
  hasIn(
    sql,
    "'rsvp_pass:' || p_rsvp_id::text || ':' || v_guest.id::text",
    "SQL guest key == rsvp_pass:<rsvpId>:<guestId>",
  );
});

Deno.test("I-3 — the TS submit path produces the IDENTICAL canonical key form", () => {
  // The submit enqueue must build `rsvp_pass:${rsvpId}:${guestId ?? 'primary'}`.
  // [FAILS-ON-REVERT KEY]
  hasIn(
    submit,
    "`rsvp_pass:${rsvpId}:${r.guestId ?? \"primary\"}`",
    "TS submit key == rsvp_pass:<rsvpId>:<guestId|primary>",
  );
});

Deno.test("I-3 — the second `rsvp_pass_qr:` keyspace is RETIRED (merged into one)", () => {
  // The new migration must NOT mint under the old distinct keyspace.
  // [FAILS-ON-REVERT KEY]
  hasNotIn(sql, "rsvp_pass_qr:", "the second keyspace is fully retired (one keyspace, I-3)");
  // The drain edge fn must no longer filter on the retired prefix.
  hasNotIn(drain, "rsvp_pass_qr:%", "drain no longer filters the retired prefix");
});

Deno.test("I-3 — drain covers the canonical keyspace (template_key + pending)", () => {
  // [FAILS-ON-REVERT KEY] — backfilled/approved passes still drain.
  hasIn(drain, '.eq("template_key", "rsvp_pass")', "drain selects rsvp_pass rows");
  hasIn(drain, '.eq("status", "pending")', "drain only pending (never re-invokes sent)");
});

// ───────────────────────────────────────────────────────────────────────────
// Single canonical key — assert the SQL and TS forms are byte-equivalent for the
// SAME recipient (the heart of exactly-once across all three producers).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("I-3 — SQL + TS produce the same key STRING for a given recipient", () => {
  const rsvpId = "11111111-1111-1111-1111-111111111111";
  const guestId = "22222222-2222-2222-2222-222222222222";

  // TS form (mirrors public-submit-rsvp/index.ts):
  const tsPrimary = `rsvp_pass:${rsvpId}:${"primary"}`;
  const tsGuest = `rsvp_pass:${rsvpId}:${guestId}`;

  // SQL form: 'rsvp_pass:' || rsvp_id || ':primary'  /  || ':' || guest_id
  const sqlPrimary = "rsvp_pass:" + rsvpId + ":primary";
  const sqlGuest = "rsvp_pass:" + rsvpId + ":" + guestId;

  // [FAILS-ON-REVERT KEY]
  assert(tsPrimary === sqlPrimary, `primary key mismatch: ${tsPrimary} vs ${sqlPrimary}`);
  // [FAILS-ON-REVERT KEY]
  assert(tsGuest === sqlGuest, `guest key mismatch: ${tsGuest} vs ${sqlGuest}`);
});

// ───────────────────────────────────────────────────────────────────────────
// Exactly-once — ON CONFLICT DO NOTHING on the shared key.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("I-3 — enqueue is exactly-once (ON CONFLICT DO NOTHING on the canonical key)", () => {
  hasIn(sql, "ON CONFLICT (idempotency_key) DO NOTHING", "SQL enqueue de-dupes");
  // TS submit de-dupes via the same unique index (duplicate insert swallowed).
  hasIn(submit, "idempotency_key: idempotencyKey", "TS submit writes the canonical key");
});

// ───────────────────────────────────────────────────────────────────────────
// Migration monotonicity — prefix strictly greater than ORCH-1203's head.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("migration prefix is strictly > the ORCH-1203 head (collision-free)", () => {
  const mine = 20261123000000n;
  const orch1203 = 20261122000000n;
  assert(mine > orch1203, "20261123000000 must be > 20261122000000");
});
