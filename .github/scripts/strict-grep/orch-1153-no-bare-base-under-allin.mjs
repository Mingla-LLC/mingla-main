#!/usr/bin/env node
/**
 * ORCH-1153 WS3 — no bare base price under an "all-in" caption
 * (I-PROPOSED-1153-NO-BARE-BASE-UNDER-ALLIN).
 *
 * The public experience page (/exp/[brandSlug]/[experienceSlug].tsx) and the
 * ExperienceCheckoutFlow recap MUST display the SERVER all-in (priceAllInGbp via
 * the fetchTierAllInCents → pg_public_event_tier_allin chain), never the bare
 * base ticket.priceCents, under the "All-in, taxes included" caption. ORCH-1147
 * fixed the cart; ORCH-1153 fixes the page one surface upstream (the WYSIWYP
 * breach — the buyer saw the price jump up at the cart).
 *
 * Fails if:
 *   (a) /exp/[…].tsx formats ticket.priceCents directly for the headline/CTA
 *       price (the expPrice source) without going through priceAllInGbp, OR
 *   (b) the file no longer references ticket.priceAllInGbp at all (the all-in
 *       source was removed → reverted to bare base).
 *
 * Self-test (`--self-test`): proves the gate FAILS on the reverted source and
 * PASSES on the fixed source, so a future revert trips CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const EXP_PAGE = "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx";
const CHECKOUT_FLOW =
  "mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function check(src, label) {
  const failures = [];
  const code = stripComments(src);
  // (a) the expPrice/recap price must NOT format the bare base directly.
  if (/formatExpPrice\(\s*ticket\.priceCents\b/.test(code)) {
    failures.push(
      `${label}: formats ticket.priceCents under the all-in caption (bare base). ` +
        "Display the server all-in (priceAllInGbp ×100 → cents) — never the base.",
    );
  }
  if (/formatPriceMajor\(\s*ticket\.priceCents\s*,/.test(code)) {
    failures.push(
      `${label}: the recap renders formatPriceMajor(ticket.priceCents, …) (bare base). ` +
        "Display the server all-in (priceAllInGbp ×100 → cents).",
    );
  }
  // (b) the all-in source must be present (the fix reads priceAllInGbp).
  if (!/ticket\.priceAllInGbp/.test(code)) {
    failures.push(
      `${label}: no reference to ticket.priceAllInGbp — the server all-in source ` +
        "was removed (reverted to bare base). ORCH-1147/1153 require the all-in.",
    );
  }
  return failures;
}

function runReal() {
  const failures = [];
  for (const rel of [EXP_PAGE, CHECKOUT_FLOW]) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      failures.push(`${rel}: expected file is missing.`);
      continue;
    }
    failures.push(...check(readFileSync(path, "utf8"), rel));
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const reverted = `
    const expPrice = ticket !== null && ticket.priceCents > 0
      ? formatExpPrice(ticket.priceCents, ticket.currency) : "";
  `;
  const fixed = `
    const expDisplayCents = typeof ticket.priceAllInGbp === "number" && ticket.priceAllInGbp > 0
      ? Math.round(ticket.priceAllInGbp * 100) : ticket.priceCents;
    const expPrice = formatExpPrice(expDisplayCents, ticket.currency);
  `;
  const a = check(reverted, "self-test-reverted");
  const b = check(fixed, "self-test-fixed");
  if (a.length === 0) {
    console.error("SELF-TEST FAIL: gate did not catch the reverted bare-base source.");
    process.exit(1);
  }
  if (b.length !== 0) {
    console.error("SELF-TEST FAIL: gate wrongly flagged the fixed all-in source:", b);
    process.exit(1);
  }
  console.log("ORCH-1153 no-bare-base-under-allin gate self-test passed.");
  process.exit(0);
}

const failures = runReal();
if (failures.length > 0) {
  console.error("ORCH-1153 no-bare-base-under-allin gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1153 no-bare-base-under-allin gate passed.");
