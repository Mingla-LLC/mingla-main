#!/usr/bin/env node
/**
 * ORCH-1153 WS2 — experience CTA verb is "Reserve" on every surface
 * (I-PROPOSED-1153-RESERVE-VERB).
 *
 * The consumer experience detail screen passed NO buyVerb/freeVerb to the shared
 * resolveOfferingCta, so it rendered the generic "Buy ticket" / "Get free
 * ticket" while buyer-web/business already say "Reserve". This gate asserts the
 * consumer call carries buyVerb:"Reserve" + freeVerb:"Reserve" so a revert that
 * drops them trips CI.
 *
 * Self-test (`--self-test`): FAILS on the reverted call (no verbs), PASSES on the
 * fixed call.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const CONSUMER =
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function check(src, label) {
  const failures = [];
  const code = stripComments(src);
  // The resolveOfferingCta(...) call for the experience CTA must carry both verbs.
  const callMatch = code.match(/resolveOfferingCta\(\{[\s\S]*?\}\)/);
  if (callMatch === null) {
    failures.push(`${label}: no resolveOfferingCta({...}) call found.`);
    return failures;
  }
  const call = callMatch[0];
  if (!/buyVerb:\s*["']Reserve["']/.test(call)) {
    failures.push(
      `${label}: resolveOfferingCta call is missing buyVerb:"Reserve" — the ` +
        'experience reserve CTA would render the generic "Buy ticket".',
    );
  }
  if (!/freeVerb:\s*["']Reserve["']/.test(call)) {
    failures.push(
      `${label}: resolveOfferingCta call is missing freeVerb:"Reserve" — a free ` +
        'experience would render "Get free ticket".',
    );
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const reverted = `resolveOfferingCta({ variant: v, bookable: true, tickets, currency: c })`;
  const fixed = `resolveOfferingCta({ variant: v, bookable: true, tickets, currency: c, buyVerb: "Reserve", freeVerb: "Reserve" })`;
  if (check(reverted, "rev").length === 0) {
    console.error("SELF-TEST FAIL: gate did not catch the missing verbs.");
    process.exit(1);
  }
  if (check(fixed, "fix").length !== 0) {
    console.error("SELF-TEST FAIL: gate wrongly flagged the fixed call.");
    process.exit(1);
  }
  console.log("ORCH-1153 reserve-verb gate self-test passed.");
  process.exit(0);
}

const path = join(root, CONSUMER);
if (!existsSync(path)) {
  console.error(`ORCH-1153 reserve-verb gate failed:\n- ${CONSUMER}: missing.`);
  process.exit(1);
}
const failures = check(readFileSync(path, "utf8"), CONSUMER);
if (failures.length > 0) {
  console.error("ORCH-1153 reserve-verb gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1153 reserve-verb gate passed.");
