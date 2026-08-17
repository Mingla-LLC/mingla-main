#!/usr/bin/env node
/**
 * issue #2160 strict-grep gate — CAPACITY AGGREGATES PER TICKET TYPE ACROSS THE
 * WHOLE CART, NEVER A SINGLE LINE. THIS ONE PROTECTS MONEY.
 *
 * Enforces I-PROPOSED-2160-C CART-CAPACITY-AGGREGATES-PER-TICKET-TYPE.
 *
 * THE HOLE, STATED HONESTLY. The pre-#2160 capacity check inside the
 * create-session base compared `v_sold + v_reserved + v_qty`, where `v_qty` is
 * THIS LINE alone — and the current session's own items are inserted AFTER the
 * validation loop, so a second line of the SAME ticket_type in the same cart was
 * invisible to the first line's check and both passed independently.
 *
 * Scoping I am not going to overstate: under the amendment's session-level day
 * set, lines are NEVER expanded, so multi-day does not create that shape. The
 * hole is real but LATENT, exactly as it is today. This gate is hardening, not
 * the load-bearing fix an earlier draft of the spec described. It is worth
 * keeping because any future feature that sends two lines of one ticket type —
 * bundles, add-ons, per-day anything — walks straight into it, and because the
 * failure is an OVERSELL: tickets minted against a cap that has already been
 * reached, which becomes a refund and a guest turned away.
 *
 * `--self-test` proves fail-on-revert with a GOOD fixture and 2 DISTINCT BAD
 * fixtures, including the exact per-line revert.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");
const FN = "issue_1930_ticket_checkout_create_session_base";

// The aggregation sums the submitted quantity for THIS ticket type across the
// WHOLE of p_lines before comparing.
const AGGREGATES =
  /SUM\(\s*\(\s*l\s*->>\s*'quantity'\s*\)::integer\s*\)[\s\S]{0,300}?jsonb_array_elements\(\s*p_lines\s*\)[\s\S]{0,300}?ticketTypeId/;
// ...and the comparison uses the aggregate, not the bare per-line quantity.
const COMPARES_AGGREGATE =
  /v_sold\s*\+\s*v_reserved\s*\+\s*v_cart_qty_for_type\s*>\s*[A-Za-z_.]*quantity_total/;
// The FOR UPDATE row lock that serialises CONCURRENT sessions must survive: the
// aggregation fixes the same-cart case, the lock fixes the cross-session case,
// and neither replaces the other.
const ROW_LOCK = /FROM public\.ticket_types[\s\S]{0,300}?FOR UPDATE/;

export function check(body, failures, latestPath = "<latest migration>") {
  if (!AGGREGATES.test(body)) {
    failures.push(
      `${latestPath}: the create-session base no longer sums the submitted ` +
        "quantity per ticket_type across the whole cart. Two lines of one " +
        "ticket type then pass capacity INDEPENDENTLY — the session's own " +
        "items are inserted after the validation loop, so line 1's check " +
        "cannot see line 2. The result is an OVERSELL against a cap that was " +
        "already met (I-PROPOSED-2160-C).",
    );
  }
  if (!COMPARES_AGGREGATE.test(body)) {
    failures.push(
      `${latestPath}: the capacity comparison no longer USES the per-ticket-` +
        "type aggregate. Computing it and then comparing the bare per-line " +
        "quantity is the same oversell with extra steps.",
    );
  }
  if (!ROW_LOCK.test(body)) {
    failures.push(
      `${latestPath}: the ticket_types FOR UPDATE row lock did not survive the ` +
        "re-emit. The aggregation fixes the SAME-CART case; the lock is what " +
        "serialises CONCURRENT sessions. Losing it reopens oversell across " +
        "simultaneous buyers.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good = [
    `CREATE OR REPLACE FUNCTION public.${FN}(...)`,
    "  SELECT * INTO v_ticket_type FROM public.ticket_types",
    "   WHERE id = (v_line ->> 'ticketTypeId')::uuid FOR UPDATE;",
    "  SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier",
    "    INTO v_cart_qty_for_type",
    "    FROM jsonb_array_elements(p_lines) AS l",
    "   WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;",
    "  IF v_ticket_type.quantity_total IS NOT NULL",
    "     AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN",
    "    RAISE EXCEPTION 'ticket_capacity_exceeded';",
    "  END IF;",
  ].join("\n");

  let f = [];
  check(good, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 — THE EXACT REVERT: back to the per-line comparison.
  f = [];
  check(
    good
      .replace(
        "  SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier\n" +
          "    INTO v_cart_qty_for_type\n" +
          "    FROM jsonb_array_elements(p_lines) AS l\n" +
          "   WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;\n",
        "",
      )
      .replace("v_cart_qty_for_type >", "v_qty >"),
    f,
  );
  if (f.length === 0) self.push("BAD1 (reverted to per-line capacity) not flagged");

  // BAD2 — the aggregate is computed but the comparison ignores it.
  f = [];
  check(good.replace("+ v_cart_qty_for_type >", "+ v_qty >"), f);
  if (f.length === 0) self.push("BAD2 (aggregate computed but unused) not flagged");

  // BAD3 — the concurrency lock is dropped.
  f = [];
  check(good.replace("FOR UPDATE;", ";"), f);
  if (f.length === 0) self.push("BAD3 (row lock removed) not flagged");

  if (self.length) {
    console.error("issue-2160 capacity-aggregated self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-2160 capacity-aggregated self-test PASS (4/4 cases).");
  process.exit(0);
}

const failures = [];
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const matching = files.filter((f) =>
  new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${FN}`, "i").test(
    fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"),
  )
);
if (matching.length === 0) {
  failures.push(`supabase/migrations/: no migration defines ${FN}.`);
} else {
  const latest = matching[matching.length - 1];
  check(
    fs.readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8"),
    failures,
    `supabase/migrations/${latest}`,
  );
}
if (failures.length > 0) {
  console.error("issue-2160 capacity-aggregated gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("issue-2160 capacity-aggregated gate passed.");
