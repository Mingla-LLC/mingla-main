// ORCH-1203 GAP-C1 — source-contract guard for the RSVP QR fail-closed backfill.
// CI has no live Postgres, so (matching the proven orch_1195/orch_1200 SQL tests)
// this pins the load-bearing SQL invariants by asserting the migration text. The
// orchestrator runs the live behavioral verification (synthesize a NULL-qr going
// RSVP → run backfill → assert qr minted + one rsvp_pass → drain → done) post-merge
// per the SPEC §"Live verification". The `// [FAILS-ON-REVERT KEY]` lines are the
// assertions proven to go RED when the change is reverted in-worktree.
//
// Run: deno test --allow-read --allow-env
import { assert } from "jsr:@std/assert@1";

const MIG =
  "supabase/migrations/20261122000000_orch_1203_rsvp_qr_backfill.sql";
const sql = await Deno.readTextFile(MIG);
const has = (n: string, why: string) =>
  assert(sql.includes(n), `must contain \`${n}\` (${why})`);
const hasNot = (n: string, why: string) =>
  assert(!sql.includes(n), `must NOT contain \`${n}\` (${why})`);

// ───────────────────────────────────────────────────────────────────────────
// I-4 — SINGLE source of truth for the QR signing expression.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("I-4 — shared biz_rsvp_mint_qr routine exists and wraps the EXACT mint", () => {
  // [FAILS-ON-REVERT KEY]
  has("FUNCTION public.biz_rsvp_mint_qr(", "the extracted shared mint routine");
  // The exact 3-line signing the inline submit path used (same entropy + helpers).
  has("encode(extensions.gen_random_bytes(16), 'hex')", "same token entropy source");
  has(
    "public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper)",
    "same token-hash helper (I-4)",
  );
  has(
    "public.biz_rsvp_qr_payload(p_entity_id, v_token_hash, p_qr_token_pepper)",
    "same mingla:v1:rsvp: payload helper (I-4)",
  );
});

Deno.test("I-4 — BOTH submit_event_rsvp AND backfill call the SHARED routine (no copy)", () => {
  // submit_event_rsvp is redefined to call the shared routine for guest + primary.
  // [FAILS-ON-REVERT KEY]
  has(
    "FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m",
    "submit guest mint goes through the shared routine",
  );
  // [FAILS-ON-REVERT KEY]
  has(
    "FROM public.biz_rsvp_mint_qr(v_existing_id, p_qr_token_pepper) m",
    "submit primary mint goes through the shared routine",
  );
  // [FAILS-ON-REVERT KEY]
  has(
    "FROM public.biz_rsvp_mint_qr(v_rec.rsvp_id, v_pepper) m",
    "backfill primary mint goes through the shared routine",
  );
  // [FAILS-ON-REVERT KEY]
  has(
    "FROM public.biz_rsvp_mint_qr(v_rec.guest_id, v_pepper) m",
    "backfill guest mint goes through the shared routine",
  );
  // The OLD inline 3-line mint must no longer appear in submit_event_rsvp's body
  // (it was replaced by the shared-routine call). The shared routine is the ONLY
  // place biz_rsvp_qr_payload is composed with a freshly hashed token now.
  hasNot(
    "v_token := encode(extensions.gen_random_bytes(16), 'hex');",
    "the old inline submit mint must be replaced by the shared routine",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// C-2 — backfill function: scope, no-op-on-missing-pepper, return-count.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("C-2 — backfill_going_rsvp_qr_codes(text) SECURITY DEFINER, pepper passed in", () => {
  // [FAILS-ON-REVERT KEY]
  has("FUNCTION public.backfill_going_rsvp_qr_codes(", "the backfill function");
  has("p_qr_token_pepper text DEFAULT NULL", "pepper is PASSED IN (no DB GUC; ORCH-0777)");
  has("SECURITY DEFINER", "runs as definer to mint + enqueue");
});

Deno.test("C-2 — no-op (return 0) when the pepper is absent, never RAISE", () => {
  has("biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper)", "assert the pepper");
  has("EXCEPTION WHEN OTHERS THEN", "swallow the assert RAISE");
  // [FAILS-ON-REVERT KEY]
  has("IF v_pepper IS NULL THEN\n    RETURN 0;", "no-op return 0 when pepper absent");
});

Deno.test("C-2 — only NULL-qr GOING rows are minted (idempotent; maybe/not_going untouched)", () => {
  // Primary scope.
  // [FAILS-ON-REVERT KEY]
  has("r.rsvp_status = 'going'\n       AND r.qr_code IS NULL", "primary: going + NULL qr only");
  // Guest scope (parent going, guest qr null).
  // [FAILS-ON-REVERT KEY]
  has("r.rsvp_status = 'going'\n       AND g.qr_code IS NULL", "guest: parent going + NULL qr only");
  has("RETURN v_minted;", "returns the count minted");
});

// ───────────────────────────────────────────────────────────────────────────
// I-3 — exactly ONE QR pass; distinct stable key; no double-send / no suppression.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("I-3 — QR pass key is `rsvp_pass_qr:<id>`, DISTINCT from inline `rsvp_pass:` key", () => {
  // [FAILS-ON-REVERT KEY]
  has("'rsvp_pass_qr:' || v_rec.rsvp_id::text", "primary QR-pass stable key");
  // [FAILS-ON-REVERT KEY]
  has("'rsvp_pass_qr:' || v_rec.guest_id::text", "guest QR-pass stable key");
  // Distinct keyspace: a prior push-only/passless attempt used `rsvp_pass:<...>`
  // (note the colon-without-qr suffix). The backfill key prefix is `rsvp_pass_qr:`
  // so ON CONFLICT can never collide with it → the QR pass is never suppressed.
  has("ON CONFLICT (idempotency_key) DO NOTHING", "re-run never double-sends (idempotent)");
});

Deno.test("I-3 / handleRsvpPass — enqueued payload carries qrCode + the full shape the consumer reads", () => {
  for (
    const key of [
      "'template_key',   'rsvp_pass'",
      "'recipientEmail'",
      "'recipientName'",
      "'qrCode'",
      "'role'",
      "'eventName'",
      "'venueLine'",
      "'brandName'",
      "'brandId'",
      "'deepLink'",
    ]
  ) {
    has(key, "payload key handleRsvpPass consumes");
  }
  // [FAILS-ON-REVERT KEY] — the QR is the load-bearing field; a backfill row with
  // a null qrCode would never email (handleRsvpPass gates email on qrCode!==null).
  has("'qrCode',         v_qr", "minted qr is written into the pass payload");
});

// ───────────────────────────────────────────────────────────────────────────
// Lock-down + cron wiring.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("security — EXECUTE revoked from anon + PUBLIC on both new functions", () => {
  // [FAILS-ON-REVERT KEY]
  has("REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM PUBLIC", "lock down backfill");
  has("REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM anon", "lock down backfill (anon)");
  has("GRANT  EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) TO service_role", "service_role only");
  has("REVOKE EXECUTE ON FUNCTION public.biz_rsvp_mint_qr(uuid, text) FROM PUBLIC", "lock down the mint routine");
});

Deno.test("cron — every-15-min job wired to the backfill edge fn", () => {
  // [FAILS-ON-REVERT KEY]
  has("'orch_1203_rsvp_qr_backfill'", "cron jobname");
  has("'*/15 * * * *'", "15-min cadence (mirrors orch_1161_notify_reminders)");
  has("/functions/v1/backfill-rsvp-qr-codes", "drives the backfill edge fn");
  has("PERFORM cron.unschedule('orch_1203_rsvp_qr_backfill')", "idempotent re-schedule");
});

// ───────────────────────────────────────────────────────────────────────────
// C-2 edge fn — pepper resolved from env + passed in; drain isolated to QR keys.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("edge — backfill-rsvp-qr-codes resolves pepper from env, passes it, drains only QR rows", async () => {
  const fn = await Deno.readTextFile(
    "supabase/functions/backfill-rsvp-qr-codes/index.ts",
  );
  const hasFn = (n: string, why: string) =>
    assert(fn.includes(n), `edge fn must contain \`${n}\` (${why})`);
  // [FAILS-ON-REVERT KEY]
  hasFn("qrTokenPepper()", "resolves pepper from env (same source as submit)");
  hasFn("p_qr_token_pepper: pepper", "passes the pepper into the RPC");
  hasFn('"backfill_going_rsvp_qr_codes"', "calls the backfill RPC");
  // ORCH-1206 (I-3) SUPERSEDES the old `rsvp_pass_qr:%` drain filter: the backfill
  // now enqueues under the SINGLE canonical `rsvp_pass:` keyspace, so the drain
  // selects ALL still-pending rsvp_pass rows (template_key + status), which the
  // status='pending' guard keeps from re-invoking already-sent passes.
  hasFn('.eq("template_key", "rsvp_pass")', "drains rsvp_pass rows (canonical keyspace, ORCH-1206)");
  hasFn('.eq("status", "pending")', "only pending (never re-invokes sent)");
  hasFn(`authHeader !== \`Bearer \${serviceKey}\``, "service-role Bearer guard");
});
