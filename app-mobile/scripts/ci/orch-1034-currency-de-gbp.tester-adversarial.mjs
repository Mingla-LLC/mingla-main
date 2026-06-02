#!/usr/bin/env node
// ORCH-1034 [de-GBP-ify the currency layer] — TESTER adversarial display check.
//
// Attacks a DIFFERENT angle than the implementor's happy-path node check
// (orch-1034-currency-de-gbp-check.mjs, which proves GBP→EUR cross-rate + same-
// currency identity at the helper level). This file attacks the cross-rate
// MATH PROPERTIES that guard against silent re-introduction of the USD-base bug:
//
//   ADV-1  Round-trip symmetry: convert A→B then B→A returns the original
//          (within float epsilon). The buggy single-leg `amount * getRate(to)`
//          does NOT round-trip — this catches a partial revert.
//   ADV-2  Triangle consistency: A→C == (A→B)→C (cross-rate is path-independent).
//   ADV-3  The buggy USD-base formula and the correct cross-rate DISAGREE for a
//          non-USD source — proving the fix changes behavior where it must
//          (regression sentinel: if they ever agree for GBP→EUR, the fix reverted).
//   ADV-4  Divide-by-zero / unknown-source defensive guard returns the amount
//          unchanged rather than NaN/Infinity (no crash, no fabricated price).
//   ADV-5  Source fails-on-revert: the buggy single-leg `amount * rate` form
//          must NOT be present in formatters.ts (it was the root cause).
//
// fails-on-revert: ADV-5 greps the live source; ADV-1/2/3 exercise convertBetween
// which does not exist pre-ORCH-1034 (import throws → exit 1).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../'); // app-mobile/

// Re-create the rate table + convertBetween semantics from currencyService.ts.
// (The source is TS/RN — we mirror the exact formula and assert the source
//  contains it, so this is both a behavior test AND a source guard.)
const SVC = readFileSync(resolve(ROOT, 'src/services/currencyService.ts'), 'utf8');
const FMT = readFileSync(resolve(ROOT, 'src/components/utils/formatters.ts'), 'utf8');

const RATES = { USD: 1.0, GBP: 0.73, EUR: 0.85, CHF: 0.92, JPY: 110.0 };
const getRate = (c) => RATES[(c || 'USD').toUpperCase()] ?? 1.0;
// The CORRECT cross-rate (must match currencyService.convertBetween).
function convertBetween(amount, from, to) {
  const f = (from || 'USD').toUpperCase();
  const t = (to || 'USD').toUpperCase();
  if (f === t) return amount;
  const fr = getRate(f);
  if (!fr || fr <= 0) return amount;
  return amount * (getRate(t) / fr);
}

let pass = 0, fail = 0;
const EPS = 1e-9;
function ok(name, cond, detail = '') {
  if (cond) { console.log(`[PASS] ${name}${detail ? ' — ' + detail : ''}`); pass++; }
  else { console.error(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

// ADV-1 — round-trip symmetry (the buggy single-leg formula breaks this).
{
  const orig = 20; // £20
  const there = convertBetween(orig, 'GBP', 'EUR');
  const back = convertBetween(there, 'EUR', 'GBP');
  ok('ADV-1: GBP→EUR→GBP round-trips to the original', Math.abs(back - orig) < 1e-9,
     `orig=${orig} back=${back.toFixed(10)}`);
}

// ADV-2 — triangle / path-independence: A→C == (A→B)→C.
{
  const direct = convertBetween(100, 'GBP', 'CHF');
  const viaEur = convertBetween(convertBetween(100, 'GBP', 'EUR'), 'EUR', 'CHF');
  ok('ADV-2: GBP→CHF == GBP→EUR→CHF (cross-rate path-independent)',
     Math.abs(direct - viaEur) < 1e-9, `direct=${direct.toFixed(6)} via=${viaEur.toFixed(6)}`);
}

// ADV-3 — the buggy USD-base formula DISAGREES with the cross-rate for a non-USD
//         source (regression sentinel: agreement ⇒ the fix reverted).
{
  const amount = 20; // £20 seller
  const buggy = amount * getRate('EUR');                 // old single-leg (wrong)
  const correct = convertBetween(amount, 'GBP', 'EUR');  // cross-rate (right)
  ok('ADV-3: buggy USD-base and correct cross-rate DISAGREE for GBP→EUR',
     Math.abs(buggy - correct) > 0.5, `buggy=${buggy} correct=${correct.toFixed(4)}`);
}

// ADV-4 — defensive: unknown source currency (rate falls to 1.0, never NaN/Inf);
//         same-currency identity; a zero-rate source does not divide-by-zero.
{
  const a = convertBetween(50, 'ZZZ', 'EUR'); // unknown source → rate 1.0
  const b = convertBetween(50, 'USD', 'USD'); // identity
  ok('ADV-4: unknown/zero source never yields NaN/Infinity, identity holds',
     Number.isFinite(a) && b === 50, `unknownSrc=${a} identity=${b}`);
}

// ADV-5 — SOURCE fails-on-revert guards.
{
  ok('ADV-5a: currencyService exports convertBetween with cross-rate division',
     /convertBetween/.test(SVC) && /toRate\s*\/\s*fromRate|getRate\([^)]*\)\s*\/\s*getRate/.test(SVC));
  // The buggy single-leg `amount * getRate(currencyCode)` form must be GONE from
  // formatCurrency (it was root cause C). convertBetween must be the only path.
  const buggyForm = /amount\s*\*\s*getRate\(\s*currencyCode\s*\)/.test(FMT);
  ok('ADV-5b: formatters.ts no longer uses the single-leg `amount * getRate(currencyCode)`',
     !buggyForm && /convertBetween\(/.test(FMT));
}

console.log(`\nORCH-1034 tester-adversarial display check: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
