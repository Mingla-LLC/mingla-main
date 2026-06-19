#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-ALLIN-PRICE-IN-TICKET-BOX.
 *
 * The inline ticket box's running total (computeRunningTotal in
 * packages/offering-rendering/EventOfferingBody.tsx) MUST be the SERVER all-in
 * (priceAllInGbp), never the bare base (priceGbp alone) — WYSIWYP (ORCH-1147). The
 * buyer must never see a base total that jumps up at the cart.
 *
 * Fails if EventOfferingBody.tsx:
 *   (a) no longer references priceAllInGbp at all (the all-in source removed →
 *       reverted to bare base), OR
 *   (b) the unit-price helper (ticketUnitAllIn) reads priceGbp WITHOUT the
 *       priceAllInGbp ?? priceGbp fallback (i.e. a bare `ticket.priceGbp` with no
 *       priceAllInGbp coalesce in the same expression).
 *
 * Self-test (`--self-test`): a base-only total trips the gate; the all-in total
 * passes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const BODY = "packages/offering-rendering/EventOfferingBody.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function check(src, label) {
  const failures = [];
  const code = stripComments(src);
  // (a) the all-in source must be present.
  if (!/priceAllInGbp/.test(code)) {
    failures.push(
      `${label}: no reference to priceAllInGbp — the inline-box total reverted to ` +
        "bare base. ORCH-1147/1167 require the server all-in (WYSIWYP).",
    );
  }
  // (b) the unit helper must coalesce priceAllInGbp ?? priceGbp (never bare base).
  if (!/priceAllInGbp\s*\?\?\s*[\w.]*priceGbp/.test(code)) {
    failures.push(
      `${label}: the inline-box unit price must read 'priceAllInGbp ?? …priceGbp' ` +
        "(all-in, base only as the free/RPC-miss fallback) — never bare priceGbp.",
    );
  }
  return failures;
}

function runSelfTest() {
  const bad = `
    const ticketUnitAllIn = (t) => (t.isFree ? 0 : (t.priceGbp ?? 0));
    export const computeRunningTotal = () => 0;
  `;
  const good = `
    const ticketUnitAllIn = (t) => {
      const price = t.priceAllInGbp ?? t.priceGbp;
      return price ?? 0;
    };
    export const computeRunningTotal = () => 0;
  `;
  const badFails = check(bad, "synthetic-bad").length > 0;
  const goodPasses = check(good, "synthetic-good").length === 0;
  if (!badFails) {
    console.error("SELF-TEST FAIL: base-only total did not trip the gate.");
    process.exit(1);
  }
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: all-in total wrongly tripped the gate.");
    process.exit(1);
  }
  console.log("ORCH-1167 allin-price-in-ticket-box gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const path = join(root, BODY);
  if (!existsSync(path)) {
    console.error(`ORCH-1167 allin-price-in-ticket-box gate FAILED: ${BODY} missing.`);
    process.exit(1);
  }
  const failures = check(readFileSync(path, "utf8"), BODY);
  if (failures.length > 0) {
    console.error("\nORCH-1167 allin-price-in-ticket-box gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 allin-price-in-ticket-box gate PASS.");
}
