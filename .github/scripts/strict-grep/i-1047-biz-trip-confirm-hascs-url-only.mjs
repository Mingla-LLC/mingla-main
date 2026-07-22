#!/usr/bin/env node
/**
 * I-1047-BIZ-TRIP-CONFIRM-HASCS-URL-ONLY  (issue #1047)
 *
 * Re-homes the load-bearing anti-regression previously pinned by
 * `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.adversarial.test.tsx`
 * (ORCH-0911, buyer-web trip confirm black screen). That pin hard-coded an exact
 * `const hasCs = /…/.test` string that drifted (an `isClient &&` guard was added)
 * and is now quarantined; this additive gate keeps the real fix enforced.
 *
 * THE RULE (fixes the black-screen on the trip confirm page): the `result === null`
 * loading hero must be gated on the payment-session param read FROM THE URL, and
 * must NOT reintroduce the deleted realtime-gated hero that caused the black screen:
 *   - `hasCs` derives from a URL query test `/[?&]cs=/.test(... location … search …)`, AND
 *   - the deleted `result === null && realtimePending && trip !== null` hero block
 *     (and its Platform.OS === "web" variant) stays GONE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CONFIRM = "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx";
const raw = fs.readFileSync(path.join(REPO, CONFIRM), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];

// hasCs must be derived from the URL search string.
const hasCsLine = code.match(/const\s+hasCs\s*=\s*[^;]+/);
if (!hasCsLine) {
  violations.push("no `const hasCs = …` derivation found — the trip confirm hero payment-session gate is missing.");
} else {
  if (!/\/\[\?\&\]cs=\/\.test/.test(hasCsLine[0]) || !/location|search/.test(hasCsLine[0])) {
    violations.push(
      `hasCs no longer derives from the URL query (\`/[?&]cs=/.test(location…search)\`) — got \`${hasCsLine[0].replace(/\s+/g, " ").slice(0, 80)}…\`. ` +
        "Reading the session from anywhere but the URL reopens the black-screen bug.",
    );
  }
}

// The deleted realtime-gated hero must stay gone (both forms).
if (/result === null\s*&&\s*realtimePending\s*&&\s*trip !== null/.test(code)) {
  violations.push("the deleted `result === null && realtimePending && trip !== null` hero block was reintroduced — this caused the trip-confirm black screen.");
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-TRIP-CONFIRM-HASCS-URL-ONLY]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-TRIP-CONFIRM-HASCS-URL-ONLY]: hasCs reads the URL; the realtime-gated black-screen hero stays gone.");
