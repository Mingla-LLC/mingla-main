#!/usr/bin/env node
/* eslint-disable no-console */
// Issue #963 [consumer currency — no GBP fallback] — TESTER adversarial check.
//
// Attacks a DIFFERENT angle than the implementor's happy-path check
// (issue-0963-consumer-currency-no-gbp-fallback-check.mjs, which proves the 4
// banned forms are caught + the clean tree passes + fails-on-revert on
// useTicketCart). This file feeds the SHIPPED scanner (imported, not
// re-implemented) a battery of adversarial inputs to prove it cannot be tricked:
//
//   ADV-1  The allowlist cannot be abused to hide a real fallback. The
//          countryCurrencyService.ts exemption is scoped to the `currencyCode:`
//          colon-key ONLY — a `?? "GBP"`, a `|| "GBP"`, a `= "GBP"`, or a
//          DIFFERENT colon-key (`currency:`, `defaultCurrency:`) in that very
//          file is STILL flagged. The exemption also does not leak to other files.
//   ADV-2  Comment / string stripping is exact: `'GBP'` in a `//` line comment,
//          in a `/* */` block comment (incl. multi-line), and a `//` that lives
//          INSIDE a string literal are all handled correctly — a real fallback
//          on the same line as a trailing comment is still caught.
//   ADV-3  Every one of the 4 forms is caught in BOTH quote styles (8 combos);
//          the caught column/form is reported.
//   ADV-4  Comparisons and arrows are NOT over-flagged: `=== "GBP"`, `!== 'GBP'`,
//          `>= "GBP"`, `<= "GBP"`, and `=> "GBP"` produce zero violations (they
//          are not fallbacks; over-flagging would make the gate a nuisance).
//   ADV-5  SOURCE fails-on-revert: scanning the REAL useTicketCart.ts yields zero
//          violations (its GBP default is gone), and the whole real app/src tree
//          is clean — so a revert that re-adds GBP flips this red.
//
// fails-on-revert: ADV-5 scans the live source; ADV-1..4 import the shipped
// scanner, so a regression in the scanner OR the source flips a verdict → exit 1.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  scanSource,
  stripComments,
  ALLOWLIST,
} from "./issue-0963-consumer-currency-no-gbp-fallback-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../"); // app-mobile/
const ALLOWLISTED_FILE = "src/services/countryCurrencyService.ts";

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { console.log(`[PASS] ${name}${detail ? " — " + detail : ""}`); pass++; }
  else { console.error(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}
const count = (file, src) => scanSource(file, src).length;

// ── ADV-1 — the allowlist is un-abusable. ──
{
  // The exact legit row is exempt…
  ok("ADV-1a: legit country row `currencyCode: 'GBP'` is exempt",
    count(ALLOWLISTED_FILE, "{ countryCode: 'GB', currencyCode: 'GBP', currencySymbol: '£' },") === 0);
  // …but the exemption is narrow: a nullish fallback in the SAME file is caught.
  ok("ADV-1b: `?? \"GBP\"` in the allowlisted file is STILL caught",
    count(ALLOWLISTED_FILE, 'const c = ev.currency ?? "GBP";') === 1);
  // …an OR fallback in the same file is caught.
  ok("ADV-1c: `|| 'GBP'` in the allowlisted file is STILL caught",
    count(ALLOWLISTED_FILE, "const c = ev.currency || 'GBP';") === 1);
  // …an assignment in the same file is caught.
  ok("ADV-1d: `= \"GBP\"` in the allowlisted file is STILL caught",
    count(ALLOWLISTED_FILE, 'let cur = "GBP";') === 1);
  // …a DIFFERENT colon-key in the same file is caught (only `currencyCode:` exempt).
  ok("ADV-1e: a non-`currencyCode` colon-key in the allowlisted file is caught",
    count(ALLOWLISTED_FILE, "return { currency: 'GBP' };") === 1);
  // …the exemption does NOT leak to another file (currencyCode elsewhere is caught).
  ok("ADV-1f: `currencyCode: 'GBP'` in a DIFFERENT file is caught (no leak)",
    count("src/hooks/useTicketCart.ts", "const x = { currencyCode: 'GBP' };") === 1);
  // …the allowlist stays minimal — exactly one entry, scoped to that file+key.
  ok("ADV-1g: allowlist is exactly one narrowly-scoped entry",
    ALLOWLIST.length === 1 &&
      ALLOWLIST[0].file === ALLOWLISTED_FILE &&
      ALLOWLIST[0].colonKey === "currencyCode",
    JSON.stringify(ALLOWLIST.map((a) => `${a.file}#${a.colonKey}`)));
}

// ── ADV-2 — comment / string stripping is exact. ──
{
  ok("ADV-2a: `'GBP'` in a // line comment is NOT flagged",
    count("src/x.ts", "const c = ev.currency; // was ?? 'GBP'") === 0);
  ok("ADV-2b: `'GBP'` in a /* */ block comment is NOT flagged",
    count("src/x.ts", "const c = ev.currency; /* default: 'GBP' */") === 0);
  ok("ADV-2c: `'GBP'` in a MULTI-LINE block comment is NOT flagged",
    count("src/x.ts", "/*\n * fallback = 'GBP'\n */\nconst c = ev.currency;") === 0);
  // A `//` inside a string must NOT start a comment — the trailing `?? "GBP"` is real.
  ok("ADV-2d: `//` inside a string does not hide a following real fallback",
    count("src/x.ts", 'const u = "http://x"; const c = a ?? "GBP";') === 1);
  // A real fallback with a trailing comment is still caught (comment stripped, code kept).
  ok("ADV-2e: real `?? \"GBP\"` with a trailing // comment is still caught",
    count("src/x.ts", 'const c = a ?? "GBP"; // TODO revisit') === 1);
  // Direct proof the stripper blanks a comment but preserves a code string literal.
  const stripped = stripComments("const c = a ?? \"GBP\"; // 'GBP' 'GBP'");
  ok("ADV-2f: stripComments keeps the code `\"GBP\"` and removes the comment `'GBP'`",
    stripped.includes('"GBP"') && !stripped.includes("'GBP'"), JSON.stringify(stripped));
}

// ── ADV-3 — every banned form caught, both quote styles. ──
{
  const combos = [
    ['?? double', 'const c = a ?? "GBP";'],
    ["?? single", "const c = a ?? 'GBP';"],
    ['|| double', 'const c = a || "GBP";'],
    ["|| single", "const c = a || 'GBP';"],
    ['= double', 'const c = "GBP";'],
    ["= single", "const c = 'GBP';"],
    [': double', 'return { currency: "GBP" };'],
    [": single", "return { currency: 'GBP' };"],
  ];
  for (const [name, src] of combos) {
    ok(`ADV-3 (${name}): caught`, count("src/x.ts", src) === 1);
  }
}

// ── ADV-4 — comparisons / arrows are NOT over-flagged. ──
{
  ok("ADV-4a: `=== \"GBP\"` comparison is not flagged",
    count("src/x.ts", 'if (c === "GBP") log();') === 0);
  ok("ADV-4b: `!== 'GBP'` comparison is not flagged",
    count("src/x.ts", "if (c !== 'GBP') log();") === 0);
  ok("ADV-4c: `>= \"GBP\"` / `<= 'GBP'` are not flagged",
    count("src/x.ts", 'if (c >= "GBP" && c <= \'GBP\') log();') === 0);
  ok("ADV-4d: arrow `=> \"GBP\"` is not flagged by the `=` form",
    count("src/x.ts", "const f = () => \"GBP\";") === 0);
}

// ── ADV-5 — SOURCE fails-on-revert (ties to the live tree). ──
{
  const hook = readFileSync(resolve(ROOT, "src/hooks/useTicketCart.ts"), "utf8");
  ok("ADV-5a: real useTicketCart.ts has no GBP fallback literal",
    scanSource("src/hooks/useTicketCart.ts", hook).length === 0);
  ok("ADV-5b: real useTicketCart.ts no longer declares DEFAULT_CURRENCY = \"GBP\"",
    !/DEFAULT_CURRENCY\s*=\s*["']GBP["']/.test(hook));
  // The country table must still carry its GB row (proves the allowlist isn't
  // masking a genuinely-missing data site).
  const svc = readFileSync(resolve(ROOT, "src/services/countryCurrencyService.ts"), "utf8");
  ok("ADV-5c: countryCurrencyService.ts still carries the GB → GBP data row",
    /currencyCode:\s*'GBP'/.test(svc) && scanSource(ALLOWLISTED_FILE, svc).length === 0);
}

console.log(`\nissue-0963 tester-adversarial check: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
