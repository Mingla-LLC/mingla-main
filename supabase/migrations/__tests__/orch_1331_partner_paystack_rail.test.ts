// ORCH-1331 [partner Paystack payout rail] — T-13/T-14 SQL-contract regression
// tests (implementor happy-path, DB layer).
//
// House pattern (orch_1338_social_proof_reads.test.ts): read the migration SQL
// and pin the load-bearing structure. The "migrations apply cleanly from
// baseline" CI job proves the SQL executes; THIS suite proves the CONTRACT
// survives edits:
//
//   T-13 — the brands→partner_brand_links Paystack owner-connected trigger:
//     * fires on AFTER UPDATE OF paystack_subaccount_code ON public.brands
//     * NULL→non-NULL transition guard (all three predicates)
//     * stamps owner_stripe_connected_at with COALESCE (once; second update
//       no-op) — and NEVER renames the column
//       (I-PROPOSED-1331-LINK-COLUMNS-FROZEN: migration contains no RENAME).
//
//   T-14 — status CHECK widen + the Paystack lifecycle RPCs:
//     * widened partner_splits_status_check admits 'blocked_no_paystack' and
//       every pre-existing value (widen-only)
//     * mark_partner_split_failed allowlist maps 'blocked_no_paystack'
//     * record_paystack_partner_split_attempt inserts provider='paystack',
//       transfer_currency 'ngn', key 'paystack:'||reference, ON CONFLICT DO
//       NOTHING; service_role-only grants
//     * bump increments attempt_count only on 'pending';
//       mark_paystack_partner_split_attempted stamps payout_reference +
//       transfer_code while status stays pending.
//
// FAILS-ON-REVERT: deleting the trigger block, the NULL-transition guard, the
// COALESCE, the widened CHECK entry, or the RPC allowlist entry flips the
// matching assertion red.
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1331_partner_paystack_rail.test.ts

import { assert } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql";

const migration = await Deno.readTextFile(MIGRATION_PATH);

/** Extract one function's full text (CREATE OR REPLACE … $function$;). */
function fnBody(name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  );
  const m = migration.match(re);
  assert(m !== null, `function body found for ${name}`);
  return m![0];
}

Deno.test("T-13 · paystack owner-connected trigger — event + table binding", () => {
  assert(
    /CREATE TRIGGER partner_brand_links_paystack_connected_trigger\s+AFTER UPDATE OF paystack_subaccount_code ON public\.brands/.test(
      migration,
    ),
    "trigger fires AFTER UPDATE OF paystack_subaccount_code ON public.brands",
  );
  assert(
    migration.includes(
      "DROP TRIGGER IF EXISTS partner_brand_links_paystack_connected_trigger ON public.brands",
    ),
    "idempotent DROP TRIGGER IF EXISTS precedes CREATE",
  );
});

Deno.test("T-13 · trigger guard — NULL→non-NULL transition only", () => {
  const body = fnBody("partner_brand_links_mark_paystack_connected");
  assert(
    body.includes("NEW.paystack_subaccount_code IS NOT NULL"),
    "guards NEW non-NULL",
  );
  assert(
    body.includes(
      "OLD.paystack_subaccount_code IS DISTINCT FROM NEW.paystack_subaccount_code",
    ),
    "guards actual change",
  );
  assert(
    body.includes("OLD.paystack_subaccount_code IS NULL"),
    "guards OLD was NULL (first attach only)",
  );
  assert(
    body.includes("SECURITY DEFINER"),
    "trigger fn is SECURITY DEFINER",
  );
  assert(
    /SET search_path TO 'public'\s*,\s*'pg_temp'/.test(body),
    "search_path locked",
  );
});

Deno.test("T-13 · stamp is COALESCE(owner_stripe_connected_at, now()) — once, active links only", () => {
  const body = fnBody("partner_brand_links_mark_paystack_connected");
  assert(
    body.includes(
      "SET owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())",
    ),
    "COALESCE keeps the earliest stamp (second update = no-op)",
  );
  assert(
    body.includes("cancelled_at IS NULL"),
    "only active partner_brand_links rows are stamped",
  );
});

Deno.test("T-13 · I-PROPOSED-1331-LINK-COLUMNS-FROZEN — no column RENAME anywhere", () => {
  // Comment-stripped: the migration's comments EXPLAIN the no-rename rule; the
  // executable SQL must not carry one.
  const sqlOnly = migration
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  assert(
    !/\bRENAME\b/i.test(sqlOnly),
    "migration contains no RENAME — timestamp column names are frozen (client deriveLinkStatus contract)",
  );
});

Deno.test("T-14 · widened status CHECK admits blocked_no_paystack + every pre-existing value", () => {
  const checkMatch = migration.match(
    /ADD CONSTRAINT partner_splits_status_check\s+CHECK \(status IN \(([\s\S]*?)\)\)/,
  );
  assert(checkMatch !== null, "widened partner_splits_status_check present");
  const list = checkMatch![1];
  for (
    const v of [
      "pending",
      "transferred",
      "blocked_currency_mismatch",
      "blocked_no_stripe",
      "blocked_no_paystack",
      "failed",
      "reversed",
      "reversed_pending",
    ]
  ) {
    assert(list.includes(`'${v}'`), `CHECK admits '${v}' (widen-only)`);
  }
});

Deno.test("T-14 · mark_partner_split_failed allowlist maps blocked_no_paystack", () => {
  const body = fnBody("mark_partner_split_failed");
  assert(
    body.includes("'blocked_no_paystack'"),
    "allowlist learned blocked_no_paystack",
  );
  assert(
    body.includes("'blocked_currency_mismatch'") &&
      body.includes("'blocked_no_stripe'"),
    "pre-existing reasons preserved",
  );
});

Deno.test("T-14 · record_paystack_partner_split_attempt — paystack row shape + idempotency + grants", () => {
  const body = fnBody("record_paystack_partner_split_attempt");
  assert(
    body.includes("v_key := 'paystack:' || p_reference"),
    "idempotency key is 'paystack:'||reference",
  );
  assert(body.includes("'ngn'"), "transfer_currency pinned to ngn (zero FX)");
  assert(body.includes("'paystack'"), "provider pinned to paystack");
  assert(
    body.includes("ON CONFLICT (stripe_application_fee_id) DO NOTHING"),
    "webhook-replay idempotent insert",
  );
  assert(
    /REVOKE ALL ON FUNCTION public\.record_paystack_partner_split_attempt\([\s\S]*?\) FROM PUBLIC/.test(
      migration,
    ),
    "REVOKE FROM PUBLIC present",
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.record_paystack_partner_split_attempt\([\s\S]*?\) TO service_role/.test(
      migration,
    ),
    "service_role-only EXECUTE",
  );
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.record_paystack_partner_split_attempt\([\s\S]*?\) TO authenticated/.test(
      migration,
    ),
    "NOT granted to authenticated",
  );
});

Deno.test("T-14 · bump/attempted RPCs — pending-only writes, service-role only", () => {
  const bump = fnBody("bump_paystack_partner_split_attempt");
  assert(
    bump.includes("attempt_count = attempt_count + 1"),
    "bump increments attempt_count",
  );
  assert(
    bump.includes("AND status = 'pending'"),
    "bump touches pending rows only",
  );
  const attempted = fnBody("mark_paystack_partner_split_attempted");
  assert(
    attempted.includes("payout_reference = p_payout_reference") &&
      attempted.includes("stripe_transfer_id = p_transfer_code"),
    "attempted stamps payout_reference + transfer_code",
  );
  assert(
    attempted.includes("AND status = 'pending'"),
    "attempted leaves non-pending rows untouched (status stays pending)",
  );
  for (
    const fn of [
      "bump_paystack_partner_split_attempt",
      "mark_paystack_partner_split_attempted",
    ]
  ) {
    assert(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?\\) TO service_role`,
      ).test(migration),
      `${fn} granted to service_role`,
    );
  }
});

Deno.test("T-14 · retry cron registered at */30 pointing at partner-paystack-split-retry", () => {
  assert(
    migration.includes("'orch_1331_partner_paystack_split_retry'"),
    "cron jobname present",
  );
  assert(migration.includes("'*/30 * * * *'"), "cadence */30");
  assert(
    migration.includes("/functions/v1/partner-paystack-split-retry"),
    "cron targets the sweep fn",
  );
});

Deno.test("T-14 · PII rule — table stores last4 only, never the full NUBAN", () => {
  assert(
    migration.includes("account_number_last4 text NOT NULL"),
    "last4 column present",
  );
  const tableDef = migration.match(
    /CREATE TABLE IF NOT EXISTS public\.partner_paystack_accounts \(([\s\S]*?)\);/,
  );
  assert(tableDef !== null, "table definition found");
  assert(
    !/\baccount_number\b(?!_last4)/.test(tableDef![1]),
    "no full account_number column (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED)",
  );
});
