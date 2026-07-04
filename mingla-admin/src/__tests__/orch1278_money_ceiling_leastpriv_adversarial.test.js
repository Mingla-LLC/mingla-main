// ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT] — TESTER ADVERSARIAL suite.
//
// DIFFERENT ANGLE than the implementor's happy-path (orch1278_money_console_act.test.js)
// and the strict-grep (i-admin-refund-bounded.mjs), both of which are PRESENCE-based.
// This suite attacks ORDERING, GUARD-FORM, IDEMPOTENCY-SCOPE, and LEAST-PRIVILEGE-
// EXACTNESS — regressions that keep the amount-ceiling string present (so the other
// gates stay green) yet silently break money safety:
//
//   1. CRASH-SAFE ORDERING — the amount-ceiling RAISE (and the order-state + reason
//      guards) must execute BEFORE the first `INSERT INTO public.refunds`. A refactor
//      that moved the ceiling below the INSERT would write a pending row for an
//      over-limit refund (the exact failure the ceiling exists to prevent) while the
//      presence-based gates stay green.
//   2. NULL-SAFE TWIN-GUARD FORM — both refund twins must use the service_role-safe
//      `auth.uid() IS NOT NULL AND NOT public.is_admin_user()` form, NOT the bare
//      `IF NOT public.is_admin_user()`. is_admin_user() returns FALSE under service_role
//      (auth.uid() IS NULL), so the bare form would make EVERY admin refund raise
//      not_authorized — a total outage the happy-path/strict-grep would NOT catch.
//   3. IDEMPOTENCY-PRECHECK SCOPE — the replay precheck must key on ALL of
//      idempotency_key + order_id + status='pending'. Dropping order_id would let a key
//      minted for order A match a pending refund on order B.
//   4. LEAST-PRIVILEGE EXACTNESS — twins REVOKE authenticated + GRANT service_role ONLY
//      (never authenticated); the DB-only RPCs GRANT authenticated but REVOKE anon; and
//      the migration carries the runtime DO-block privilege self-assert.
//
// FAILS-ON-REVERT: deleting the amount-ceiling guard block removes `refund_exceeds_remaining`
// from the executable body → suite (1) fails. Verified by true line-deletion at c6f605934.
//
// Append-only new file (CI tests-append-only gate). Reads the ACTUAL deployed source.

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

// Strip SQL line comments so every assertion tests EXECUTABLE code, never a comment
// that merely mentions the guard's name (a comment must never satisfy a safety gate).
const stripSqlComments = (src) =>
  src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const MIG_EXEC = stripSqlComments(MIG);

// Slice a plpgsql fn body between its first $$...$$ pair after the CREATE. The name
// regex ends in `\s*\(` so `admin_refund_order` does NOT match `admin_refund_order_commit`.
function fnBody(src, name) {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i").exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const tagM = /\$([a-zA-Z_]*)\$/.exec(rest);
  if (!tagM) return null;
  const tag = tagM[0];
  const open = rest.indexOf(tag);
  const close = rest.indexOf(tag, open + tag.length);
  if (close < 0) return null;
  return rest.slice(open + tag.length, close);
}

describe("ORCH-1278 ADVERSARIAL — refund crash-safe ordering", () => {
  const body = fnBody(MIG_EXEC, "admin_refund_order");

  it("admin_refund_order body is present", () => {
    assert.ok(body, "admin_refund_order must exist in the migration");
  });

  it("1a — amount-ceiling RAISE lives in EXECUTABLE code (fails-on-revert anchor)", () => {
    assert.match(
      body,
      /refund_exceeds_remaining/,
      "the total-amount ceiling (refund_exceeds_remaining) must be in the executable body",
    );
  });

  it("1b — ceiling RAISE executes BEFORE any INSERT INTO refunds (no pending row for a rejected refund)", () => {
    const ceilingIdx = body.indexOf("refund_exceeds_remaining");
    const insertIdx = body.search(/insert\s+into\s+public\.refunds/i);
    assert.ok(ceilingIdx >= 0, "ceiling guard must be present");
    assert.ok(insertIdx >= 0, "the pending-refund INSERT must be present");
    assert.ok(
      ceilingIdx < insertIdx,
      "the ceiling guard MUST precede the pending-refund INSERT — otherwise an over-limit refund writes a pending row before it is rejected",
    );
  });

  it("1c — order-state + reason guards also precede the INSERT (reject-before-write)", () => {
    const insertIdx = body.search(/insert\s+into\s+public\.refunds/i);
    const stateIdx = body.search(/order_not_refundable/i);
    const reasonIdx = body.search(/reason_invalid_length/i);
    assert.ok(stateIdx >= 0 && stateIdx < insertIdx, "order-state gate must precede the INSERT");
    assert.ok(reasonIdx >= 0 && reasonIdx < insertIdx, "reason gate must precede the INSERT");
  });

  it("1d — ceiling reads BOTH total_cents and refunded_amount_cents in executable code", () => {
    const near = body.slice(body.indexOf("refund_exceeds_remaining") - 240, body.indexOf("refund_exceeds_remaining") + 60);
    assert.match(near, /total_cents/, "ceiling must read orders.total_cents");
    assert.match(near, /refunded_amount_cents/, "ceiling must subtract already-refunded_amount_cents");
  });
});

describe("ORCH-1278 ADVERSARIAL — null-safe twin guard FORM (service_role must not be blocked)", () => {
  for (const name of ["admin_refund_order", "admin_refund_order_commit"]) {
    const body = fnBody(MIG_EXEC, name);

    it(`${name} — uses the null-safe guard form (auth.uid() IS NOT NULL AND NOT is_admin_user)`, () => {
      assert.ok(body, `${name} must exist`);
      assert.match(
        body,
        /if\s+auth\.uid\(\)\s+is\s+not\s+null\s+and\s+not\s+public\.is_admin_user\(\)\s+then/i,
        `${name} twin guard MUST be the null-safe form so service_role (auth.uid() IS NULL) is not blocked`,
      );
    });

    it(`${name} — does NOT use the bare IF NOT is_admin_user() guard (would break service_role)`, () => {
      // The bare form as the twin's gate would raise not_authorized for EVERY admin
      // refund (service_role → is_admin_user() FALSE). Assert the bare form is absent.
      assert.doesNotMatch(
        body,
        /if\s+not\s+public\.is_admin_user\(\)\s+then/i,
        `${name} must NOT use the bare is_admin_user() guard — it would block the service_role edge path`,
      );
    });

    it(`${name} — the twin guard is the FIRST executable statement (before any SELECT/INSERT/UPDATE)`, () => {
      const guardIdx = body.search(/if\s+auth\.uid\(\)\s+is\s+not\s+null/i);
      const firstStmt = body.search(/\b(select|insert|update|delete)\b/i);
      assert.ok(guardIdx >= 0, `${name} must carry the twin guard`);
      assert.ok(
        firstStmt < 0 || guardIdx < firstStmt,
        `${name} guard must precede the first data statement`,
      );
    });
  }
});

describe("ORCH-1278 ADVERSARIAL — idempotency precheck scope (per-order, per-key, pending-only)", () => {
  const body = fnBody(MIG_EXEC, "admin_refund_order");

  it("3a — precheck keys on idempotency_key AND order_id AND status='pending'", () => {
    // Isolate the precheck SELECT that resolves an existing pending refund.
    const start = body.search(/from\s+public\.refunds/i);
    const window = body.slice(start, start + 320);
    assert.match(window, /metadata->>'idempotency_key'\s*=\s*p_idempotency_key/i, "must key on the idempotency_key");
    assert.match(window, /order_id\s*=\s*p_order_id/i, "must scope the replay to the SAME order_id");
    assert.match(window, /status\s*=\s*'pending'/i, "must only replay a PENDING refund (never a succeeded one)");
  });
});

describe("ORCH-1278 ADVERSARIAL — least-privilege exactness", () => {
  const grantAuthRe = (n) =>
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${n}\\s*\\([^)]*\\)\\s+to\\s+[^;]*\\bauthenticated\\b`, "i");
  const revokeAuthRe = (n) =>
    new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${n}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\bauthenticated\\b`, "i");
  const grantSvcRe = (n) =>
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${n}\\s*\\([^)]*\\)\\s+to\\s+service_role`, "i");
  const grantAuthedDbRe = (n) =>
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${n}\\s*\\([^)]*\\)\\s+to\\s+authenticated`, "i");
  const revokeAnonRe = (n) =>
    new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${n}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\banon\\b`, "i");

  for (const twin of ["admin_refund_order", "admin_refund_order_commit"]) {
    it(`${twin} — service_role ONLY: REVOKE authenticated + GRANT service_role + NO grant to authenticated`, () => {
      assert.match(MIG_EXEC, revokeAuthRe(twin), `${twin} must REVOKE ... FROM ... authenticated`);
      assert.match(MIG_EXEC, grantSvcRe(twin), `${twin} must GRANT EXECUTE ... TO service_role`);
      assert.doesNotMatch(MIG_EXEC, grantAuthRe(twin), `${twin} must NEVER be GRANTed to authenticated`);
    });
  }

  for (const dbrpc of ["admin_annotate_dispute", "admin_grant_override_audited", "admin_revoke_override_audited"]) {
    it(`${dbrpc} — DB-only authed path: GRANT authenticated + REVOKE anon (never service_role-only, never anon)`, () => {
      assert.match(MIG_EXEC, grantAuthedDbRe(dbrpc), `${dbrpc} must GRANT EXECUTE ... TO authenticated`);
      assert.match(MIG_EXEC, revokeAnonRe(dbrpc), `${dbrpc} must REVOKE EXECUTE ... FROM anon`);
    });
  }

  it("migration carries the runtime DO-block privilege self-assert for the twins", () => {
    assert.match(
      MIG_EXEC,
      /has_function_privilege\(\s*'authenticated'\s*,\s*'public\.admin_refund_order\(/i,
      "the DO $$ block must runtime-assert authenticated CANNOT execute admin_refund_order",
    );
    assert.match(MIG_EXEC, /do\s+\$\$/i, "the privilege self-assert DO block must be present");
  });
});
