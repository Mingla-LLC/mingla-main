#!/usr/bin/env node
/**
 * issue #2150 strict-grep gate — a COMPLETED ZERO-TOTAL checkout session is
 * RETURNED, not tombstoned.
 *
 * Enforces I-PROPOSED-2150-FREE-COMPLETED-SESSION-IDEMPOTENT.
 *
 * WHY THIS EXISTS ALONGSIDE orch-0791. That gate asserts the tombstone
 * mechanism SURVIVES; it says nothing about which statuses reach it, so a
 * re-emit of `biz_ticket_checkout_create_session` that silently drops the #2150
 * exemption keeps orch-0791 green while restoring the duplicate-order defect.
 * `biz_ticket_checkout_create_session` is re-emitted often — #1929, #1930,
 * #1931, #2101 all replaced it, and #2160's spec re-emits its neighbours — so
 * a silent drop is the realistic failure mode, not a hypothetical one.
 *
 * This gate does NOT weaken orch-0791. It asserts BOTH shapes in the same
 * migration, so the exemption and the tombstone can never be traded off
 * against each other.
 *
 * Locates the latest migration that defines or replaces
 * `biz_ticket_checkout_create_session` (grep across supabase/migrations/*.sql,
 * pick highest filename prefix — the same selection orch-0791 uses) and
 * asserts:
 *
 *   1. The free-completed exemption is present: a `status='free_completed'`
 *      test conjoined with a zero-total test on `total_cents`.
 *   2. The exemption is SCOPED to zero-total — the `total_cents` guard is what
 *      keeps money out of it, so its absence is a distinct failure.
 *   3. The ORCH-0791 tombstone UPDATE is still present, so the paid path was
 *      not "fixed" by deleting tombstoning altogether.
 *
 * `--self-test` proves fail-on-revert: the pure `check(body, failures)` is
 * exercised with a GOOD fixture (specificity) and 3 DISTINCT BAD fixtures
 * (sensitivity), including the exact revert this issue guards — deleting the
 * exemption block while leaving everything else intact.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");

// `free_completed` compared with `=` (the exemption), NOT the four-status
// `IN (...)` list that orch-0791 asserts. Whitespace-tolerant.
const FREE_COMPLETED_EQ = /status\s*=\s*'free_completed'/;
// The zero-total conjunct, in either the COALESCE form shipped by #2150 or a
// bare column comparison.
const ZERO_TOTAL_GUARD =
  /(COALESCE\s*\(\s*[A-Za-z_.]*total_cents\s*,\s*0\s*\)|[A-Za-z_.]*total_cents)\s*=\s*0/;
const TOMBSTONE_UPDATE =
  /idempotency_key\s*\|\|\s*':tombstone:'\s*\|\|\s*id::text/;

/**
 * Pure verdict over a single migration body. `latestPath` only annotates the
 * failure messages (defaults to a placeholder for the self-test).
 */
export function check(body, failures, latestPath = "<latest migration>") {
  // §1 — the exemption exists at all.
  if (!FREE_COMPLETED_EQ.test(body)) {
    failures.push(
      `${latestPath}: no \`status = 'free_completed'\` exemption in ` +
        "biz_ticket_checkout_create_session (issue #2150). Without it a guest " +
        "resubmitting an identical FREE reservation has their completed " +
        "session tombstoned and re-minted, producing a duplicate order, a " +
        "duplicate pass and a duplicate confirmation email + SMS.",
    );
  }

  // §2 — and it is SCOPED to the zero-total case.
  if (!ZERO_TOTAL_GUARD.test(body)) {
    failures.push(
      `${latestPath}: the #2150 exemption carries no \`total_cents = 0\` ` +
        "guard. That conjunct is the only thing keeping a session that took " +
        "money out of the idempotent-replay arm; without it the exemption is " +
        "no longer provably scoped to free checkout.",
    );
  }

  // §3 — the ORCH-0791 tombstone was not deleted to "fix" this.
  if (!TOMBSTONE_UPDATE.test(body)) {
    failures.push(
      `${latestPath}: the ORCH-0791 tombstone UPDATE ` +
        "(`idempotency_key || ':tombstone:' || id::text`) is gone. #2150 " +
        "narrows WHEN it fires; it must never remove it — a failed or " +
        "expired provider session has to stay re-creatable.",
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const goodBody = [
    "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session()",
    "RETURNS jsonb AS $$",
    "BEGIN",
    "  IF FOUND THEN",
    "    IF v_existing.status='free_completed'",
    "       AND COALESCE(v_existing.total_cents,0)=0",
    "       AND v_existing.order_id IS NOT NULL THEN",
    "      RETURN jsonb_build_object('orderId',v_existing.order_id);",
    "    END IF;",
    "    IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN",
    "      UPDATE public.ticket_checkout_sessions",
    "         SET idempotency_key = idempotency_key || ':tombstone:' || id::text",
    "       WHERE id = v_existing.id;",
    "    END IF;",
    "  END IF;",
    "  RETURN jsonb_build_object('created', true);",
    "END;",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");

  // GOOD: exemption + zero-total guard + tombstone all present.
  let f = [];
  check(goodBody, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (the exact revert this issue guards): delete the exemption block,
  // leaving the #2101 predecessor's shape. §1 and §2 fire.
  const bad1 = goodBody
    .replace("    IF v_existing.status='free_completed'\n", "")
    .replace("       AND COALESCE(v_existing.total_cents,0)=0\n", "")
    .replace("       AND v_existing.order_id IS NOT NULL THEN\n", "")
    .replace("      RETURN jsonb_build_object('orderId',v_existing.order_id);\n", "")
    .replace("    END IF;\n    IF v_existing.status IN", "    IF v_existing.status IN");
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (exemption block deleted) not flagged");

  // BAD2 (different angle — the scope is widened): the exemption survives but
  // its zero-total conjunct is dropped, so a session that took money can enter
  // the replay arm. §2 fires while §1 and §3 stay green.
  const bad2 = goodBody.replace(
    "       AND COALESCE(v_existing.total_cents,0)=0\n",
    "",
  );
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (zero-total scope guard removed) not flagged");
  if (f.length > 0 && !f[0].includes("total_cents = 0")) {
    self.push("BAD2 flagged for the wrong reason: " + f[0]);
  }

  // BAD3 (opposite failure — tombstoning deleted outright): §3 fires.
  const bad3 = goodBody.replace(
    "         SET idempotency_key = idempotency_key || ':tombstone:' || id::text\n",
    "         SET status = 'expired'\n",
  );
  f = [];
  check(bad3, f);
  if (f.length === 0) self.push("BAD3 (ORCH-0791 tombstone deleted) not flagged");

  if (self.length) {
    console.error("issue-2150 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-2150 self-test PASS (4/4 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const matchingMigrations = migrationFiles.filter((f) => {
  const body = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
  return /CREATE OR REPLACE FUNCTION\s+public\.biz_ticket_checkout_create_session/i
    .test(body);
});

if (matchingMigrations.length === 0) {
  failures.push(
    "supabase/migrations/: no migration defines biz_ticket_checkout_create_session — " +
      "the issue #2150 invariant cannot be enforced.",
  );
} else {
  const latest = matchingMigrations[matchingMigrations.length - 1];
  const latestPath = `supabase/migrations/${latest}`;
  const body = fs.readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8");
  check(body, failures, latestPath);
}

if (failures.length > 0) {
  console.error("issue-2150 strict-grep gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("issue-2150 strict-grep gate passed.");
