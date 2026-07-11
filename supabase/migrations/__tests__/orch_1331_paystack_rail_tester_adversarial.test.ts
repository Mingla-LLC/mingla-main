// ORCH-1331 [partner Paystack payout rail] — TESTER ADVERSARIAL suite #4:
// SQL-CONTRACT attacks on migration 20261228000000 (NOT applied — the
// dispatch's verification cap forbids any apply; house "SQL wall" pattern:
// pin the load-bearing structure so edits/reverts go red).
//
// Angles (different from the implementor's T-13/T-14 suite, which pins the
// trigger guard + CHECK + RPC bodies):
//
//   RLS-1  partner_paystack_accounts is ENABLE + FORCE RLS with EXACTLY ONE
//          policy — SELECT-only, INLINE predicate `account_id = auth.uid()
//          OR public.is_admin_user()` (feedback_rls_returning_owner_gap
//          inline-EXISTS class) — and ZERO INSERT/UPDATE/DELETE/ALL policies
//          (another user can never read a partner's row; NOBODY but service
//          role can write).
//   IDEM-1 migration idempotency CLASS: every DDL statement in the file is
//          re-run-guarded (CREATE TABLE IF NOT EXISTS / DROP CONSTRAINT IF
//          EXISTS before ADD / CREATE INDEX IF NOT EXISTS / CREATE OR
//          REPLACE / DROP TRIGGER IF EXISTS / cron unschedule-if-exists /
//          backfill predicated on owner_stripe_connected_at IS NULL) — an
//          unguarded statement added later = double-apply hazard = red.
//   IDEM-2 the whole file is one BEGIN…COMMIT transaction with RAISE
//          EXCEPTION probes INSIDE it (a failed probe rolls back everything).
//   GRANT-1 all four RPCs (3 new + re-created mark_partner_split_failed) are
//          SECURITY DEFINER + search_path-pinned + REVOKE PUBLIC + GRANT
//          service_role ONLY (no authenticated/anon grant anywhere).
//   SM-1   state-machine armor in SQL: bump + attempted RPCs write ONLY on
//          status='pending' (a reversed_pending/transferred row can never
//          receive a new reference or transfer code — the DB half of the
//          double-pay defense).
//   TRG-1  trigger re-fire idempotency: the stamp is COALESCE + the guard
//          requires OLD NULL → re-firing the update can never re-stamp or
//          overwrite an existing timestamp.
//
// Append-only: NEW file. Run (repo root):
//   deno test --allow-read --no-check \
//     supabase/migrations/__tests__/orch_1331_paystack_rail_tester_adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql";
const migration = await Deno.readTextFile(MIGRATION_PATH);

// Strip SQL comments so structural scans can't be fooled by commented-out DDL.
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}
const code = stripComments(migration);

// ───────────────────────────── RLS-1 ─────────────────────────────

Deno.test("RLS-1 · partner_paystack_accounts: ENABLE + FORCE RLS, exactly ONE policy, SELECT-only, inline self-or-admin predicate, zero write policies", () => {
  assert(
    /ALTER TABLE public\.partner_paystack_accounts ENABLE ROW LEVEL SECURITY/
      .test(code),
    "RLS enabled",
  );
  assert(
    /ALTER TABLE public\.partner_paystack_accounts FORCE ROW LEVEL SECURITY/
      .test(code),
    "RLS forced (owner too)",
  );

  const policies = code.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  const onPaystackAccounts = policies.filter((p) =>
    p.includes("partner_paystack_accounts")
  );
  assertEquals(
    onPaystackAccounts.length,
    1,
    "EXACTLY one policy on partner_paystack_accounts — any additional policy widens the attack surface",
  );
  const policy = onPaystackAccounts[0];
  assert(/FOR SELECT/.test(policy), "the single policy is SELECT-only");
  assert(
    /account_id = auth\.uid\(\)\s+OR public\.is_admin_user\(\)/.test(policy),
    "inline self-or-admin predicate (no subquery-owner gap)",
  );
  // The negative case: no write-verb policy may exist for this table.
  for (const verb of ["FOR INSERT", "FOR UPDATE", "FOR DELETE", "FOR ALL"]) {
    assert(
      !onPaystackAccounts.some((p) => p.includes(verb)),
      `${verb} policy must NOT exist — writes are service-role only (edge fn mediates)`,
    );
  }
});

// ───────────────────────────── IDEM-1 ─────────────────────────────

Deno.test("IDEM-1 · every DDL statement is re-run-guarded (double-apply safe)", () => {
  // CREATE TABLE — only the IF NOT EXISTS form.
  const createTables = code.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/g) ?? [];
  assertEquals(createTables.length, 0, "no unguarded CREATE TABLE");

  // Every ADD CONSTRAINT must have a preceding DROP CONSTRAINT IF EXISTS of
  // the same name (the ORCH-1052 pattern) — except table-inline constraints.
  const added = [...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
  for (const name of added) {
    assert(
      code.includes(`DROP CONSTRAINT IF EXISTS ${name}`) ||
        new RegExp(`DROP CONSTRAINT %I|DROP CONSTRAINT ${name}`).test(code) ||
        /EXECUTE format\(\s*'ALTER TABLE public\.partner_splits DROP CONSTRAINT %I'/
          .test(code),
      `ADD CONSTRAINT ${name} must be preceded by an idempotent drop`,
    );
  }

  // CREATE INDEX — only IF NOT EXISTS.
  const createIndexes = code.match(/CREATE INDEX\s+(?!IF NOT EXISTS)/g) ?? [];
  assertEquals(createIndexes.length, 0, "no unguarded CREATE INDEX");

  // Functions — only CREATE OR REPLACE.
  const bareCreateFn = code.match(/CREATE FUNCTION/g) ?? [];
  assertEquals(bareCreateFn.length, 0, "no bare CREATE FUNCTION (must be OR REPLACE)");

  // Triggers — DROP IF EXISTS precedes CREATE TRIGGER.
  const createTriggers = [...code.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
  for (const name of createTriggers) {
    assert(
      code.includes(`DROP TRIGGER IF EXISTS ${name}`),
      `CREATE TRIGGER ${name} must be preceded by DROP TRIGGER IF EXISTS`,
    );
  }

  // Columns — only ADD COLUMN IF NOT EXISTS.
  const bareAddColumn = code.match(/ADD COLUMN\s+(?!IF NOT EXISTS)/g) ?? [];
  assertEquals(bareAddColumn.length, 0, "no unguarded ADD COLUMN");

  // Cron — unschedule-if-exists guard before schedule.
  assert(
    /IF EXISTS \(\s*SELECT 1 FROM cron\.job WHERE jobname = 'orch_1331_partner_paystack_split_retry'\s*\)\s*THEN\s*PERFORM cron\.unschedule/
      .test(code),
    "cron re-schedule is unschedule-guarded",
  );

  // Backfill — must be predicated on owner_stripe_connected_at IS NULL so a
  // re-run can never re-stamp.
  const backfill = code.match(
    /UPDATE public\.partner_brand_links pbl[\s\S]*?;/,
  );
  assert(backfill !== null, "backfill statement present");
  assert(
    backfill![0].includes("owner_stripe_connected_at IS NULL"),
    "backfill only touches never-stamped rows (re-run safe)",
  );
  assert(
    backfill![0].includes("cancelled_at IS NULL"),
    "backfill only touches active links",
  );
});

Deno.test("IDEM-2 · single transaction (BEGIN…COMMIT) with RAISE EXCEPTION probes inside it", () => {
  assert(/^\s*BEGIN;/m.test(code), "opens a transaction");
  assert(/COMMIT;\s*$/.test(code.trimEnd() + "\n"), "closes the transaction");
  const probeCount = (code.match(/RAISE EXCEPTION 'ORCH-1331 probe failed/g) ?? []).length;
  assert(
    probeCount >= 5,
    `at least 5 self-verifying probes (table, provider col, CHECK, triggers, cron) — found ${probeCount}`,
  );
  const commitIdx = code.lastIndexOf("COMMIT;");
  const lastProbeIdx = code.lastIndexOf("RAISE EXCEPTION 'ORCH-1331 probe failed");
  assert(
    lastProbeIdx < commitIdx,
    "probes run INSIDE the transaction (a failed probe rolls everything back)",
  );
});

// ───────────────────────────── GRANT-1 ─────────────────────────────

Deno.test("GRANT-1 · all four RPCs: SECURITY DEFINER + pinned search_path + REVOKE PUBLIC + GRANT service_role ONLY", () => {
  const fns = [
    "mark_partner_split_failed",
    "record_paystack_partner_split_attempt",
    "mark_paystack_partner_split_attempted",
    "bump_paystack_partner_split_attempt",
  ];
  for (const fn of fns) {
    const bodyMatch = code.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$;`,
      ),
    );
    assert(bodyMatch !== null, `${fn} defined in this migration`);
    const body = bodyMatch![0];
    assert(body.includes("SECURITY DEFINER"), `${fn} is SECURITY DEFINER`);
    assert(
      /SET search_path TO 'public', ?'pg_temp'/.test(body),
      `${fn} pins search_path`,
    );
    assert(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?\\) FROM PUBLIC`)
        .test(code),
      `${fn} revoked from PUBLIC`,
    );
    assert(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?\\) TO service_role`,
      ).test(code),
      `${fn} granted to service_role`,
    );
  }
  // The negative case: no grant to authenticated/anon anywhere in this file.
  assert(
    !/GRANT[\s\S]{0,120}TO (authenticated|anon)/.test(code),
    "NO function/table grant to authenticated or anon in this migration",
  );
});

// ───────────────────────────── SM-1 ─────────────────────────────

Deno.test("SM-1 · double-pay DB armor: bump + attempted RPCs write ONLY on status='pending'", () => {
  for (const fn of [
    "mark_paystack_partner_split_attempted",
    "bump_paystack_partner_split_attempt",
  ]) {
    const body = code.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$;`,
      ),
    )![0];
    assert(
      /AND status = 'pending'/.test(body),
      `${fn} must carry AND status='pending' — a settled/reversed row can never get a new reference or transfer code`,
    );
  }
});

// ───────────────────────────── TRG-1 ─────────────────────────────

Deno.test("TRG-1 · trigger re-fire can never re-stamp: COALESCE stamp + OLD-NULL transition guard + active-links-only", () => {
  const trg = code.match(
    /CREATE OR REPLACE FUNCTION public\.partner_brand_links_mark_paystack_connected\(\)[\s\S]*?\$function\$;/,
  );
  assert(trg !== null, "trigger fn present");
  const body = trg![0];
  assert(
    body.includes(
      "SET owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())",
    ),
    "stamp is COALESCE — an existing timestamp is never overwritten",
  );
  assert(
    body.includes("OLD.paystack_subaccount_code IS NULL"),
    "guard requires the OLD value NULL — an update from one code to another never re-fires the stamp",
  );
  assert(
    body.includes("cancelled_at IS NULL"),
    "only active links are stamped",
  );
  // Belt-and-braces: the CHECKed transition also requires DISTINCT values.
  assert(
    body.includes(
      "OLD.paystack_subaccount_code IS DISTINCT FROM NEW.paystack_subaccount_code",
    ),
    "no-op updates (same value) never stamp",
  );
});
