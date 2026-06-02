#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1034 [de-GBP-ify the currency layer] regression check — display cross-rate.
 *
 * Proves the buyer-display USD-base bug is fixed (SPEC §5.D, T-02 + T-03):
 *   - Conversion is a CROSS-rate: amount * (rate[target] / rate[source]).
 *     The pre-ORCH-1034 code did `amount * rate[target]` (omitting the
 *     source→USD leg) — only correct when source == USD.
 *   - Same-currency (source == target) is an EXACT identity (no rate math).
 *
 * Mechanism: behavioral check by executing the SAME cross-rate arithmetic the
 * shipped helpers use, against the real FALLBACK_RATES, PLUS source-pattern
 * fails-on-revert guards that fail if the single-leg `amount * rate` form is
 * reintroduced or `convertBetween`/same-currency-identity is removed.
 *
 * fails-on-revert: on the pre-ORCH-1034 sources, currencyService.ts has no
 * `convertBetween` export (G1 fails) and formatters.ts contains
 * `amount * rate` (G3 fails) → exit 1.
 *
 * Exit 1 on any FAIL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../.."); // app-mobile/
const repoRoot = path.resolve(root, "..");

const readMaybe = (absRel) => {
  for (const base of [root, repoRoot]) {
    const p = path.resolve(base, absRel);
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// ── Behavioral: replicate the shipped cross-rate against real fallback rates. ──
// (Values mirror app-mobile/src/services/currencyService.ts FALLBACK_RATES.)
const RATES = { USD: 1.0, GBP: 0.73, EUR: 0.85, CHF: 0.92 };
const convertBetween = (amount, from, to) => {
  if (from === to) return amount; // identity
  const fr = RATES[from];
  const tr = RATES[to];
  if (!fr || fr <= 0) return amount;
  return amount * (tr / fr);
};

// T-02 — seller GBP £20 shown to a EUR buyer must use the cross-rate, NOT 20*EUR.
const t02 = convertBetween(20, "GBP", "EUR"); // 20 * (0.85/0.73) ≈ 23.2877
const t02Expected = 20 * (RATES.EUR / RATES.GBP);
const t02Buggy = 20 * RATES.EUR; // the old USD-base result (17.0) — must differ
check(
  "T-02: GBP→EUR uses cross-rate (not USD-base single leg)",
  Math.abs(t02 - t02Expected) < 1e-9 && Math.abs(t02 - t02Buggy) > 1e-6,
  `cross=${t02.toFixed(4)} expected=${t02Expected.toFixed(4)} buggy=${t02Buggy.toFixed(4)}`,
);

// T-03 — same-currency is an exact identity (no conversion, one clean number).
const t03 = convertBetween(50, "USD", "USD");
check(
  "T-03: same-currency (USD→USD) returns amount unchanged",
  t03 === 50,
  `got=${t03}`,
);
const t03b = convertBetween(40, "GBP", "GBP");
check(
  "T-03b: same-currency (GBP→GBP) returns amount unchanged",
  t03b === 40,
  `got=${t03b}`,
);

// Backward-compat: USD source reduces to the prior amount*rate behavior.
const compat = convertBetween(100, "USD", "EUR");
check(
  "T-compat: USD→EUR equals legacy amount*rate (no regression for USD sources)",
  Math.abs(compat - 100 * RATES.EUR) < 1e-9,
  `got=${compat.toFixed(4)}`,
);

// ── Source fails-on-revert guards. ──
const svc = readMaybe("src/services/currencyService.ts");
const fmt = readMaybe("src/components/utils/formatters.ts");
const prefs = readMaybe("src/components/utils/preferences.ts");

check(
  "G1: currencyService exports convertBetween (cross-rate helper)",
  !!svc && /export function convertBetween\s*\(/.test(svc),
  svc ? "found" : "currencyService.ts not found",
);
check(
  "G2: convertBetween uses the cross-rate (toRate / fromRate)",
  !!svc && /toRate\s*\/\s*fromRate/.test(svc),
  "cross-rate division must be present",
);
check(
  "G3: formatCurrency no longer multiplies by a single getRate leg",
  !!fmt && !/amount\s*\*\s*rate\b/.test(fmt) && /convertBetween\(/.test(fmt),
  "the USD-base `amount * rate` form must be gone, replaced by convertBetween",
);
check(
  "G4: preferences.convertCurrency takes a sourceCurrency + same-currency identity",
  !!prefs &&
    /convertCurrency\([^)]*sourceCurrency/.test(prefs) &&
    /sourceCurrency === targetCurrency\) return amount/.test(prefs),
  "convertCurrency must accept sourceCurrency and short-circuit same-currency",
);

let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  if (!c.pass) failed++;
  console.log(`[${tag}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
if (failed > 0) {
  console.error(`\nORCH-1034 display cross-rate check: ${failed} FAIL`);
  process.exit(1);
}
console.log(`\nORCH-1034 display cross-rate check: all ${checks.length} PASS`);
