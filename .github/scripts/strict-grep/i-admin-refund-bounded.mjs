#!/usr/bin/env node
/**
 * ORCH-1278 [Admin Money console — WAVE-2 ACT] — I-PROPOSED-1278-ADMIN-REFUND-BOUNDED.
 *
 * RULE: the admin refund path is amount-bounded, idempotent, audited, and least-
 * privileged. This gate asserts, over supabase/migrations/** + the admin-refund-order
 * edge fn + the four money-console UI files:
 *
 *   (1) admin_refund_order enforces the NEW total-amount ceiling — its body RAISEs
 *       `refund_exceeds_remaining` and reads orders.total_cents / refunded_amount_cents.
 *   (2) the admin-refund-order edge fn REQUIRES an Idempotency-Key header
 *       (`idempotency_key_required`) AND uses the per-attempt Stripe idempotency key
 *       (`admin_refund:`) AND audits post-commit (`admin_write_audit`) AND re-checks
 *       the admin gate (admin_users status active).
 *   (3) the two refund twins (admin_refund_order / admin_refund_order_commit) are
 *       GRANTed to service_role ONLY — REVOKEd from PUBLIC, and NEVER GRANTed to
 *       authenticated (least-privilege; a JWT caller cannot reach the twin).
 *   (4) the money-console UI (Orders / Payments / MoneyLedger pages + SubscriberContext
 *       card) performs NO direct browser .update(/.insert(/.delete( — every money write
 *       routes through the edge fns / audited RPCs (adminMoneyActService).
 *
 * Removing the ceiling guard, the Idempotency-Key check, the edge audit, or granting a
 * twin to `authenticated` → this gate FAILS (fails-on-revert). `--self-test` proves it.
 *
 * DRAFT until CLOSE (orchestrator flips I-PROPOSED-1278-ADMIN-REFUND-BOUNDED ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const EDGE_FN = "supabase/functions/admin-refund-order/index.ts";
const UI_FILES = [
  "mingla-admin/src/pages/BusinessOrdersPage.jsx",
  "mingla-admin/src/pages/BusinessPaymentsPage.jsx",
  "mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx",
  "mingla-admin/src/components/entity/SubscriberContextCard.jsx",
];

const TWINS = ["admin_refund_order", "admin_refund_order_commit"];
const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;

function fnBody(src, name) {
  // Match the exact fn (word-boundary on the name so admin_refund_order does not
  // greedily match admin_refund_order_commit).
  const defRe = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i");
  const m = defRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  // Body is delimited by a $tag$ ... $tag$ pair ($function$ or $fn$ etc.).
  const tagM = /\$([a-zA-Z_]*)\$/.exec(rest);
  if (!tagM) return null;
  const tag = tagM[0];
  const open = rest.indexOf(tag);
  const close = rest.indexOf(tag, open + tag.length);
  if (close < 0) return null;
  return rest.slice(open + tag.length, close);
}

function serviceGrantRe(name) {
  return new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+to\\s+service_role`, "i");
}
function authGrantRe(name) {
  return new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+to\\s+[^;]*\\bauthenticated\\b`, "i");
}
function revokePublicRe(name) {
  return new RegExp(`revoke\\s+(all|execute)\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\bpublic\\b`, "i");
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function check(migSrc, edgeSrc, ui, failures) {
  // (1) amount ceiling in admin_refund_order.
  const refundBody = fnBody(migSrc, "admin_refund_order");
  if (!refundBody) {
    failures.push("admin_refund_order is missing from migrations.");
  } else {
    if (!/refund_exceeds_remaining/i.test(refundBody)) {
      failures.push("admin_refund_order: missing the total-amount ceiling guard (refund_exceeds_remaining).");
    }
    if (!/total_cents/i.test(refundBody) || !/refunded_amount_cents/i.test(refundBody)) {
      failures.push("admin_refund_order: ceiling does not read orders.total_cents / refunded_amount_cents.");
    }
  }

  // (2) edge fn: idempotency + audit + admin gate.
  if (edgeSrc == null) {
    failures.push(`${EDGE_FN} is missing.`);
  } else {
    if (!/idempotency_key_required/i.test(edgeSrc) || !/idempotency-key/i.test(edgeSrc)) {
      failures.push("admin-refund-order edge fn: does not require the Idempotency-Key header.");
    }
    if (!/admin_refund:/i.test(edgeSrc)) {
      failures.push("admin-refund-order edge fn: missing the per-attempt Stripe idempotency key (admin_refund:).");
    }
    if (!/admin_write_audit/i.test(edgeSrc)) {
      failures.push("admin-refund-order edge fn: does not audit via admin_write_audit (I-1278-MONEY-ACT-AUDITED).");
    }
    if (!/admin_users/i.test(edgeSrc) || !/status/i.test(edgeSrc) || !/active/i.test(edgeSrc)) {
      failures.push("admin-refund-order edge fn: missing the admin_users active-status gate.");
    }
  }

  // (3) twins are service_role-only.
  for (const name of TWINS) {
    if (!serviceGrantRe(name).test(migSrc)) {
      failures.push(`${name}: missing GRANT EXECUTE ... TO service_role.`);
    }
    if (!revokePublicRe(name).test(migSrc)) {
      failures.push(`${name}: missing REVOKE ... FROM PUBLIC (least-privilege).`);
    }
    if (authGrantRe(name).test(migSrc)) {
      failures.push(`${name}: is GRANTed to authenticated — twins MUST be service_role only.`);
    }
  }

  // (4) no direct browser money-table writes in the UI.
  for (const [label, src] of Object.entries(ui)) {
    if (src == null) continue;
    if (DIRECT_WRITE_RE.test(stripJsComments(src))) {
      failures.push(`${label}: contains a direct .update(/.insert(/.delete( — money writes must route through adminMoneyActService.`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodRefund =
    "CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)\n" +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$ DECLARE v_order public.orders%ROWTYPE; v_amt int; v_rem int; BEGIN\n" +
    "  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
    "  v_rem := v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);\n" +
    "  IF v_amt > v_rem THEN RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%', v_amt, v_rem; END IF;\n" +
    "  RETURN '{}'::jsonb; END; $function$;\n" +
    "REVOKE ALL ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;\n" +
    "GRANT EXECUTE ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) TO service_role;\n";
  const goodCommit =
    "CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents integer, p_status text, p_stripe_tax_transaction_id text)\n" +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$ BEGIN\n" +
    "  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
    "  RETURN '{}'::jsonb; END; $function$;\n" +
    "REVOKE ALL ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;\n" +
    "GRANT EXECUTE ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) TO service_role;\n";
  const goodMig = goodRefund + goodCommit;
  const goodEdge =
    "if (!idempotencyKey) return json({ error: 'idempotency_key_required' }, 400);\n" +
    "req.headers.get('idempotency-key');\n" +
    "await supabase.from('admin_users').select('id').eq('status','active');\n" +
    "await stripe.refunds.create({}, { idempotencyKey: `admin_refund:${refundId}` });\n" +
    "await supabase.rpc('admin_write_audit', { p_action: 'order.refund' });\n";
  const cleanUi = { page: "const { error } = await refundOrder({ order_id, lines, reason });\n" };

  // GOOD.
  let f = [];
  check(goodMig, goodEdge, cleanUi, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: ceiling guard removed.
  f = [];
  check(goodMig.replace(/IF v_amt > v_rem THEN RAISE EXCEPTION 'refund_exceeds_remaining[^;]*; END IF;/, ""), goodEdge, cleanUi, f);
  if (f.length === 0) self.push("removed ceiling guard not flagged");

  // BAD2: edge Idempotency-Key requirement removed.
  f = [];
  check(goodMig, goodEdge.replace("idempotency_key_required", "x"), cleanUi, f);
  if (f.length === 0) self.push("removed idempotency requirement not flagged");

  // BAD3: edge audit removed.
  f = [];
  check(goodMig, goodEdge.replace("admin_write_audit", "x"), cleanUi, f);
  if (f.length === 0) self.push("removed edge audit not flagged");

  // BAD4: a twin granted to authenticated.
  f = [];
  check(goodMig + "\nGRANT EXECUTE ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) TO authenticated;\n", goodEdge, cleanUi, f);
  if (f.length === 0) self.push("twin granted to authenticated not flagged");

  // BAD5: a direct browser write in the UI.
  f = [];
  check(goodMig, goodEdge, { page: "await supabase.from('refunds').insert({ order_id });\n" }, f);
  if (f.length === 0) self.push("direct browser write not flagged");

  // BAD6: revert migration → twins absent.
  f = [];
  check("select 1;", goodEdge, cleanUi, f);
  if (f.length === 0) self.push("missing twins not flagged");

  if (self.length) {
    console.error("I-ADMIN-REFUND-BOUNDED self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ADMIN-REFUND-BOUNDED self-test PASS (7/7 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-ADMIN-REFUND-BOUNDED FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const migSrc = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");
const edgeAbs = path.join(process.cwd(), EDGE_FN);
const edgeSrc = fs.existsSync(edgeAbs) ? fs.readFileSync(edgeAbs, "utf8") : null;
const ui = {};
for (const rel of UI_FILES) {
  const abs = path.join(process.cwd(), rel);
  ui[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

const failures = [];
check(migSrc, edgeSrc, ui, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1278-ADMIN-REFUND-BOUNDED FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1278-ADMIN-REFUND-BOUNDED PASS — admin_refund_order is amount-bounded; the edge fn " +
    "requires Idempotency-Key + audits + admin-gates; both twins are service_role only; the money UI takes no direct write.",
);
