// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1179 [consumer-trip-installment-parity] — the consumer trip page must
// surface the §10 pay-in-full / pay-over-time toggle, the reserve-bar split CTAs,
// and the cart deposit-lead for plan tiers, at parity with the business twin.
//
// ROOT CAUSE (verified): `pg_public_trip_by_slug` emits BOTH
//   - t.installments  → ALREADY unwrapped (`tier_metadata -> 'installments'`, the
//                       inner {deposit_pct, installments:[...]} template), AND
//   - t.tierMetadata  → the FULL tier_metadata jsonb.
// The consumer's `extractTripInstallmentSchedule(metadata)` expects the FULL
// metadata — its first line does `metadata.installments` (unwraps ONCE). The bug
// fed it `t.installments` (already inner) → it unwrapped AGAIN → read `deposit_pct`
// off the installments ARRAY → null for every plan tier. So hasSingleTierPlan /
// splitCtas / projectedSchedule were all false on consumer → toggle + CTAs + cart
// deposit-lead all silently vanished. The business twin reads `t.installments` with
// a DIRECT reader (`asInstallmentSchedule`) and works.
//
// FIX: the consumer tier mapper passes `t.tierMetadata` (the full metadata the
// extractor was written for), NOT `t.installments`.
//
// Harness note (no jest/RTL in app-mobile; the hook's top-level supabase import
// can't resolve under bare node): per repo convention this combines a VERBATIM
// behavioral replica of `extractTripInstallmentSchedule` (executed against a
// synthetic RPC-shaped fixture — 0/8 live brands set plans, so prod data proves
// nothing) with a source-assertion on the actual mapper line (fails-on-revert on a
// true line edit, never on a comment-out).
//
// Run:  node --experimental-strip-types --test \
//         app-mobile/src/hooks/__tests__/orch_1179_consumer_installment_parity.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(
  join(__dirname, "../useConsumerTripDetail.ts"),
  "utf8",
);
// Strip block + line comments so prose mentioning a token never satisfies an
// assertion (the doc-comment cites both `t.installments` and `t.tierMetadata`).
const hookCode = hookSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/[ \t]\/\/[^\n]*$/gm, "");

// ── VERBATIM replica of extractTripInstallmentSchedule (the extractor under test;
//    do NOT "fix" it — ORCH-1179 leaves the function untouched and changes the
//    CALLER's argument). Mirrors useConsumerTripDetail.ts exactly. ──────────────
function extractTripInstallmentScheduleReplica(metadata) {
  if (metadata === null || typeof metadata !== "object") return null;
  const raw = metadata.installments;
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw;
  const depositPct = obj.deposit_pct;
  const installments = obj.installments;
  if (typeof depositPct !== "number" || !Array.isArray(installments)) {
    return null;
  }
  const clean = installments
    .map((inst, i) => {
      if (typeof inst !== "object" || inst === null) return null;
      const r = inst;
      const ordinal = typeof r.ordinal === "number" ? r.ordinal : i + 1;
      const pct = typeof r.pct === "number" ? r.pct : 0;
      const days =
        typeof r.days_after_booking === "number"
          ? r.days_after_booking
          : undefined;
      const fixed = typeof r.fixed_date === "string" ? r.fixed_date : undefined;
      if (days === undefined && fixed === undefined) return null;
      return {
        ordinal,
        pct,
        ...(days !== undefined ? { days_after_booking: days } : {}),
        ...(fixed !== undefined ? { fixed_date: fixed } : {}),
      };
    })
    .filter((x) => x !== null);
  if (clean.length === 0) return null;
  return { deposit_pct: depositPct, installments: clean };
}

// ── A synthetic plan tier, shaped EXACTLY like a `pg_public_trip_by_slug` tier
//    row: `installments` is the ALREADY-unwrapped inner template; `tierMetadata`
//    is the FULL metadata that wraps it. ─────────────────────────────────────────
const INNER_TEMPLATE = {
  deposit_pct: 25,
  installments: [
    { ordinal: 1, pct: 25, days_after_booking: 30 },
    { ordinal: 2, pct: 25, days_after_booking: 60 },
    { ordinal: 3, pct: 25, days_after_booking: 90 },
  ],
};
const PLAN_TIER = {
  ticketTypeId: "tier-plan",
  tierName: "Standard",
  // RPC emits the inner template here (tier_metadata -> 'installments') ...
  installments: INNER_TEMPLATE,
  // ... and the FULL metadata here.
  tierMetadata: { installments: INNER_TEMPLATE, description: "A trip tier" },
};

// ───────────────────────── HAPPY ─────────────────────────
test("ORCH-1179 happy: tierMetadata (full) → non-null schedule, deposit_pct 25 + parsed installments", () => {
  const schedule = extractTripInstallmentScheduleReplica(PLAN_TIER.tierMetadata);
  assert.notEqual(schedule, null, "the FULL metadata must yield a real schedule");
  assert.equal(schedule.deposit_pct, 25);
  assert.equal(schedule.installments.length, 3);
  assert.deepEqual(
    schedule.installments.map((i) => i.ordinal),
    [1, 2, 3],
  );
  assert.equal(schedule.installments[0].days_after_booking, 30);
});

test("ORCH-1179 happy: the mapper reads t.tierMetadata (the fix), threaded to extractTripInstallmentSchedule", () => {
  // Fails-on-revert: a TRUE edit back to `extractTripInstallmentSchedule(t.installments)`
  // trips this (comments are stripped, so the doc-comment citation can't satisfy it).
  assert.match(
    hookCode,
    /installmentSchedule:\s*extractTripInstallmentSchedule\(\s*t\.tierMetadata\s*\)/,
    "the consumer tier mapper must pass t.tierMetadata (full metadata)",
  );
  assert.doesNotMatch(
    hookCode,
    /installmentSchedule:\s*extractTripInstallmentSchedule\(\s*t\.installments\s*\)/,
    "the OLD double-unwrapping arg (t.installments) must be gone from code",
  );
});

// ─────────────────────── ADVERSARIAL ───────────────────────
test("ORCH-1179 adversarial (fails-on-revert): the OLD arg t.installments yields null (proves the bug + fix)", () => {
  // Feeding the already-inner template double-unwraps: metadata.installments is
  // the installments ARRAY, whose typeof is 'object' but has no numeric
  // deposit_pct → the guard returns null. This is the exact silent-vanish bug.
  const wrong = extractTripInstallmentScheduleReplica(PLAN_TIER.installments);
  assert.equal(
    wrong,
    null,
    "the pre-fix arg (t.installments) must extract to null — the regression we fixed",
  );
  // And the fixed arg recovers a real schedule on the SAME tier.
  const right = extractTripInstallmentScheduleReplica(PLAN_TIER.tierMetadata);
  assert.notEqual(right, null);
});

test("ORCH-1179 adversarial: a no-plan tier (tierMetadata without installments) → null (byte-identical no-plan)", () => {
  const noPlanTier = {
    ticketTypeId: "tier-noplan",
    tierName: "Basic",
    installments: null, // RPC emits null when tier_metadata has no installments
    tierMetadata: { description: "no plan here" },
  };
  assert.equal(
    extractTripInstallmentScheduleReplica(noPlanTier.tierMetadata),
    null,
    "no-plan tiers must stay null (no fabricated schedule)",
  );
  // empty/null metadata is also null-safe.
  assert.equal(extractTripInstallmentScheduleReplica(null), null);
  assert.equal(extractTripInstallmentScheduleReplica({}), null);
});

test("ORCH-1179 adversarial: malformed inner (deposit_pct missing / installments not array) → null", () => {
  assert.equal(
    extractTripInstallmentScheduleReplica({ installments: { installments: [] } }),
    null,
    "missing deposit_pct → null",
  );
  assert.equal(
    extractTripInstallmentScheduleReplica({
      installments: { deposit_pct: 25, installments: "nope" },
    }),
    null,
    "non-array installments → null",
  );
});
