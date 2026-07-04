// ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271/1274/1276 admin
// regression pattern) that the four audited money actions are wired end-to-end and
// preserve their hard contracts:
//   1. admin_refund_order / admin_refund_order_commit are service_role-only twins:
//      twin guard first, brand gate stripped, service_role GRANT (never authenticated),
//      and admin_refund_order carries the NEW total-amount ceiling.
//   2. admin_annotate_dispute / admin_grant_override_audited / admin_revoke_override_
//      audited are guard-first, audited, least-privilege (REVOKE anon + GRANT authenticated),
//      and only touch their intended state.
//   3. admin-refund-order edge fn: Idempotency-Key required, admin_users gate,
//      per-attempt Stripe key (admin_refund:), post-commit audit, refund_exceeds_remaining
//      → 422, and NO buyer-notification enqueue (webhook owns it).
//   4. admin-stripe-connect-action edge fn: admin gate, refresh/onboarding modes,
//      NEVER creates/replaces an account, audits.
//   5. Both edge fns are verify_jwt=true; adminMoneyActService maps each fn correctly;
//      the four money UI files route through it and take NO direct money-table write.
//   6. admin_get_order exposes order_line_item_id + refunded_quantity for the line-picker.
//
// FAILS-ON-REVERT: deleting the amount-ceiling guard line fails test (1c); removing the
// edge audit fails test (3); a direct browser write fails test (5).
//
// The tester writes a SECOND, adversarial suite (idempotency replay, cross-brand seeding).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

const MIG = read(path.join(REPO_ROOT, "supabase/migrations/20261210000000_orch_1278_money_act.sql"));
const EDGE_REFUND = read(path.join(REPO_ROOT, "supabase/functions/admin-refund-order/index.ts"));
const EDGE_CONNECT = read(path.join(REPO_ROOT, "supabase/functions/admin-stripe-connect-action/index.ts"));
const CONFIG = read(path.join(REPO_ROOT, "supabase/config.toml"));
const SERVICE = read(path.join(ADMIN_SRC, "services/adminMoneyActService.js"));
const ORDERS = read(path.join(ADMIN_SRC, "pages/BusinessOrdersPage.jsx"));
const PAYMENTS = read(path.join(ADMIN_SRC, "pages/BusinessPaymentsPage.jsx"));
const LEDGER = read(path.join(ADMIN_SRC, "pages/BusinessMoneyLedgerPage.jsx"));
const SUBCARD = read(path.join(ADMIN_SRC, "components/entity/SubscriberContextCard.jsx"));

const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSqlComments = (src) =>
  src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;

// Slice a plpgsql fn body between its $tag$ pair ($function$ / $fn$).
function fnBody(src, name) {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i").exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const tag = /\$([a-zA-Z_]*)\$/.exec(rest)?.[0];
  if (!tag) return null;
  const open = rest.indexOf(tag);
  const close = rest.indexOf(tag, open + tag.length);
  return close < 0 ? null : rest.slice(open + tag.length, close);
}

const TWINS = ["admin_refund_order", "admin_refund_order_commit"];
const DB_ACTS = ["admin_annotate_dispute", "admin_grant_override_audited", "admin_revoke_override_audited"];

describe("ORCH-1278 — refund twins are service_role-only, guard-first, brand-gate stripped", () => {
  for (const name of TWINS) {
    it(`${name}: twin guard (auth.uid()-null-safe) is the first statement`, () => {
      const body = stripSqlComments(fnBody(MIG, name) || "");
      assert.ok(body, `${name} is defined`);
      assert.match(
        body,
        /BEGIN\s+IF auth\.uid\(\) IS NOT NULL AND NOT public\.is_admin_user\(\) THEN\s+RAISE EXCEPTION 'not_authorized'/i,
        `${name} twin guard must be first`,
      );
    });
    it(`${name}: brand gate is stripped (no biz_can_manage_payments_for_brand)`, () => {
      assert.ok(!fnBody(MIG, name).includes("biz_can_manage_payments_for_brand"), `${name} must not carry the brand gate`);
    });
    it(`${name}: GRANTed to service_role, NEVER to authenticated`, () => {
      assert.match(MIG, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role`, "i"));
      assert.ok(
        !new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO [^;]*\\bauthenticated\\b`, "i").test(MIG),
        `${name} must not be granted to authenticated`,
      );
      assert.match(MIG, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC`, "i"));
    });
  }

  it("admin_refund_order enforces the NEW total-amount ceiling (fails-on-revert anchor)", () => {
    const body = fnBody(MIG, "admin_refund_order");
    assert.match(body, /v_remaining_cents := v_order\.total_cents - COALESCE\(v_order\.refunded_amount_cents, 0\)/i);
    assert.match(body, /IF v_refund_amount_cents > v_remaining_cents THEN\s+RAISE EXCEPTION 'refund_exceeds_remaining/i);
  });

  it("admin_refund_order keeps the per-line quantity bound + reason length + idempotency precheck", () => {
    const body = fnBody(MIG, "admin_refund_order");
    assert.match(body, /line_overrefund/);
    assert.match(body, /reason_invalid_length/);
    assert.match(body, /metadata->>'idempotency_key' = p_idempotency_key/);
  });

  it("the migration self-asserts the twins are NOT anon/authenticated EXECUTE-able", () => {
    assert.match(MIG, /has_function_privilege\('authenticated',\s*'public\.admin_refund_order\(/i);
    assert.match(MIG, /has_function_privilege\('service_role',\s*'public\.admin_refund_order\(/i);
  });
});

describe("ORCH-1278 — DB-only money acts are guard-first + audited + least-privilege", () => {
  for (const name of DB_ACTS) {
    it(`${name}: is_admin_user() guard is the first statement`, () => {
      const body = fnBody(MIG, name);
      assert.ok(body, `${name} is defined`);
      assert.match(body, /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/i);
    });
    it(`${name}: audits via admin_write_audit`, () => {
      assert.match(fnBody(MIG, name), /admin_write_audit\s*\(/i);
    });
    it(`${name}: least-privilege (REVOKE anon + GRANT authenticated)`, () => {
      assert.match(MIG, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon, PUBLIC`, "i"));
      assert.match(MIG, new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated`, "i"));
    });
  }

  it("admin_annotate_dispute only touches admin annotation columns (not status/amount/raw_event)", () => {
    const body = fnBody(MIG, "admin_annotate_dispute");
    assert.match(body, /admin_internal_note/);
    assert.match(body, /admin_reviewed_at/);
    for (const forbidden of ["SET status", "SET amount", "raw_event", "evidence_due_by"]) {
      assert.ok(!body.includes(forbidden), `annotate must not touch ${forbidden}`);
    }
  });

  it("the 3 nullable dispute annotation columns are added", () => {
    assert.match(MIG, /ADD COLUMN IF NOT EXISTS admin_internal_note text/);
    assert.match(MIG, /ADD COLUMN IF NOT EXISTS admin_reviewed_at\s+timestamptz/);
    assert.match(MIG, /ADD COLUMN IF NOT EXISTS admin_reviewed_by\s+uuid/);
  });

  it("the override wrappers CALL the base admin RPCs (reuse, not reimplement)", () => {
    assert.match(fnBody(MIG, "admin_grant_override_audited"), /public\.admin_grant_override\(/);
    assert.match(fnBody(MIG, "admin_revoke_override_audited"), /public\.admin_revoke_override\(/);
  });
});

describe("ORCH-1278 — admin_get_order line-item extend (line-picker inputs)", () => {
  it("exposes order_line_item_id + refunded_quantity per line", () => {
    const body = fnBody(MIG, "admin_get_order");
    assert.match(body, /'order_line_item_id', li\.id/);
    assert.match(body, /'refunded_quantity'/);
    assert.match(body, /r\.status IN \('pending', 'succeeded'\)/);
  });
});

describe("ORCH-1278 — admin-refund-order edge fn (Stripe-touching, CRITICAL)", () => {
  it("requires the Idempotency-Key header", () => {
    assert.match(EDGE_REFUND, /idempotency_key_required/);
    assert.match(EDGE_REFUND, /idempotency-key/i);
  });
  it("re-checks the admin_users active-status gate", () => {
    assert.match(EDGE_REFUND, /admin_users/);
    assert.match(EDGE_REFUND, /\.eq\("status", "active"\)/);
    assert.match(EDGE_REFUND, /403/);
  });
  it("calls the service_role twins (not the biz brand-gated RPCs)", () => {
    assert.match(EDGE_REFUND, /rpc\("admin_refund_order"/);
    assert.match(EDGE_REFUND, /rpc\("admin_refund_order_commit"/);
    assert.ok(!EDGE_REFUND.includes("biz_refund_order"), "must not call the brand-gated biz RPC");
  });
  it("uses the per-attempt Stripe idempotency key + stripeAccount header", () => {
    assert.match(EDGE_REFUND, /idempotencyKey: `admin_refund:\$\{refundId\}`/);
    assert.match(EDGE_REFUND, /stripeAccount: connectedAccountId/);
  });
  it("audits post-commit via admin_write_audit (order.refund)", () => {
    assert.match(EDGE_REFUND, /admin_write_audit/);
    assert.match(EDGE_REFUND, /order\.refund/);
  });
  it("maps refund_exceeds_remaining to 422", () => {
    assert.match(EDGE_REFUND, /refund_exceeds_remaining[\s\S]{0,60}status:\s*422/);
  });
  it("does NOT enqueue a buyer notification (webhook owns it — no double push)", () => {
    assert.ok(!EDGE_REFUND.includes("ticket_order_notifications"), "must not enqueue buyer notifications");
  });
});

describe("ORCH-1278 — admin-stripe-connect-action edge fn (no money)", () => {
  it("gates on admin_users + supports refresh & onboarding_link modes only", () => {
    assert.match(EDGE_CONNECT, /admin_users/);
    assert.match(EDGE_CONNECT, /mode !== "refresh" && mode !== "onboarding_link"/);
  });
  it("NEVER creates or replaces a Stripe account", () => {
    const code = stripJs(EDGE_CONNECT); // ignore the doc-comment that names the forbidden calls
    assert.ok(!code.includes("createRecipientAccount"), "admin must not create accounts");
    assert.ok(!code.includes("accounts.del"), "admin must not delete accounts");
    assert.match(EDGE_CONNECT, /no_connect_account/);
  });
  it("audits both actions", () => {
    assert.match(EDGE_CONNECT, /connect\.refresh/);
    assert.match(EDGE_CONNECT, /connect\.onboarding_link/);
    assert.match(EDGE_CONNECT, /admin_write_audit/);
  });
});

describe("ORCH-1278 — config + service wiring", () => {
  it("both edge fns are registered verify_jwt=true", () => {
    assert.match(CONFIG, /\[functions\.admin-refund-order\]\s*\nverify_jwt = true/);
    assert.match(CONFIG, /\[functions\.admin-stripe-connect-action\]\s*\nverify_jwt = true/);
  });
  it("adminMoneyActService maps each act to its edge fn / RPC", () => {
    assert.match(SERVICE, /invokeAdminWriteEdge\(\s*"admin-refund-order"/);
    assert.match(SERVICE, /invokeAdminWriteEdge\("admin-stripe-connect-action"/);
    assert.match(SERVICE, /callAdminWriteRpc\("admin_annotate_dispute"/);
    assert.match(SERVICE, /callAdminWriteRpc\("admin_grant_override_audited"/);
    assert.match(SERVICE, /callAdminWriteRpc\("admin_revoke_override_audited"/);
  });
  it("the refund carries a per-attempt idempotency key", () => {
    assert.match(SERVICE, /crypto\.randomUUID\(\)/);
    assert.match(SERVICE, /idempotencyKey/);
  });
});

describe("ORCH-1278 — money UI routes through the service + takes no direct write", () => {
  const files = {
    BusinessOrdersPage: ORDERS,
    BusinessPaymentsPage: PAYMENTS,
    BusinessMoneyLedgerPage: LEDGER,
    SubscriberContextCard: SUBCARD,
  };
  for (const [label, src] of Object.entries(files)) {
    it(`${label}: no direct .update/.insert/.delete`, () => {
      assert.ok(!DIRECT_WRITE_RE.test(stripJs(src)), `${label} must route money writes through adminMoneyActService`);
    });
  }
  it("Orders wires the RefundModal (HighRiskActionModal) + refetch, gated on refundable status", () => {
    assert.match(ORDERS, /HighRiskActionModal/);
    assert.match(ORDERS, /RefundModal/);
    assert.match(ORDERS, /REFUNDABLE_STATUSES\.includes\(order\.payment_status\)/);
    assert.match(ORDERS, /onRefunded=\{\(\) => loadOrder\(selectedOrderId\)\}/);
    assert.match(ORDERS, /confirmPhrase=\{confirmPhrase\}/);
  });
  it("Payments wires refresh/onboarding actions + copy-to-clipboard for the link", () => {
    assert.match(PAYMENTS, /setActionMode\("refresh"\)/);
    assert.match(PAYMENTS, /setActionMode\("onboarding_link"\)/);
    assert.match(PAYMENTS, /navigator\.clipboard\.writeText/);
  });
  it("Money ledger wires the dispute annotate modal + refetch", () => {
    assert.match(LEDGER, /annotateDispute/);
    assert.match(LEDGER, /setAnnotateOpen\(true\)/);
    assert.match(LEDGER, /loadDispute\(disputeId\)/);
  });
  it("SubscriberContextCard wires comp/extend + revoke via the active override id", () => {
    assert.match(SUBCARD, /grantOverrideAudited/);
    assert.match(SUBCARD, /revokeOverrideAudited/);
    assert.match(SUBCARD, /history\.find\(\(h\) => h\.is_active\)/);
  });
});
