// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1181 [trip-tile-installment] — the CONSUMER cart tile shows the per-package
// installment sub-line "From {deposit} today · pay over time" (parity with the
// business app + buyer web), ONLY for a trip package on a payment plan when
// pay-over-time is the active cart choice. Events / experiences / no-plan / pay-
// in-full → no note.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions + executed pure logic. Every wiring assertion FAILS on a TRUE
// line-deletion of the code it protects (fails-on-revert). The deposit math + the
// exact copy are owned by the shared package and proven by its deno suite
// (packages/offering-rendering/__tests__/orch_1181_installment_note.test.ts); here
// we (a) source-grep the consumer wiring and (b) replay the per-tier MAP GATE the
// trip detail screen builds, proving plan+installments → note, no-plan/full → none.
//
// Run with:
//   node --test --experimental-strip-types \
//     app-mobile/src/screens/Trip/__tests__/orch_1181_consumer_installment_note.test.ts

const assert = require("node:assert");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string): string =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

// ── replay of the shared deposit math + formatter (deposit_pct-of-all-in, the
// same single owner the cart-level "Due today" reads). Proven in the package
// deno suite; replicated here so the consumer MAP-gate is provable under node. ──
const depositTodayCents = (tier, quantity: number): number | null => {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const sched = tier.installmentSchedule;
  if (
    sched === null ||
    typeof sched !== "object" ||
    typeof sched.deposit_pct !== "number" ||
    !Array.isArray(sched.installments)
  ) {
    return null;
  }
  const unitAllIn =
    typeof tier.priceAllInCents === "number"
      ? tier.priceAllInCents
      : tier.priceCents;
  const lineAllIn = (tier.isFree ? 0 : unitAllIn) * Math.floor(quantity);
  if (lineAllIn <= 0) return null;
  const deposit = Math.round((lineAllIn * sched.deposit_pct) / 100);
  return deposit > 0 ? deposit : null;
};
const fmtNote = (cents: number | null): string | null => {
  if (cents === null || !Number.isFinite(cents) || cents <= 0) return null;
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
  return `From ${money} today · pay over time`;
};

// The EXACT consumer MAP-gate from ConsumerTripDetailScreen.installmentNoteByTicketId.
const buildNoteMap = (
  detail,
  tiers,
  planChoiceByTier,
  paymentPlanChoice: "full" | "installments",
  quantities,
): Record<string, string> => {
  const map: Record<string, string> = {};
  if (detail === null || !detail.hasPlan) return map;
  for (const tier of tiers) {
    const hasPlan =
      tier.installmentSchedule !== null && tier.installmentSchedule !== undefined;
    if (!hasPlan) continue;
    const choice = planChoiceByTier[tier.ticketTypeId] ?? paymentPlanChoice;
    if (choice !== "installments") continue;
    const qty = Math.max(1, quantities[tier.ticketTypeId] ?? 1);
    const note = fmtNote(depositTodayCents(tier, qty));
    if (note !== null) map[tier.ticketTypeId] = note;
  }
  return map;
};

// ── synthetic fixtures (memory ORCH-1147: 0/8 live brands set plans) ──
const planTier = {
  ticketTypeId: "tt_plan",
  priceCents: 50000,
  priceAllInCents: 53000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
  },
};
const noPlanTier = {
  ticketTypeId: "tt_std",
  priceCents: 40000,
  priceAllInCents: 42000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: null,
};
const planDetail = { hasPlan: true, currency: "USD" };
const eventLikeDetail = { hasPlan: false, currency: "USD" };

// ───────────────────────── MAP-gate (happy) ─────────────────────────
test("plan tier + cart 'installments' → tile carries the deposit note (deposit_pct of all-in)", () => {
  const map = buildNoteMap(planDetail, [planTier], {}, "installments", {
    tt_plan: 1,
  });
  // 25% of all-in 53000 = 13250 = $132.50.
  assert.strictEqual(map.tt_plan, "From $132.50 today · pay over time");
});

test("deposit scales with the selected quantity", () => {
  const map = buildNoteMap(planDetail, [planTier], {}, "installments", {
    tt_plan: 2,
  });
  // 25% of (53000 × 2) = 26500 = $265.00.
  assert.strictEqual(map.tt_plan, "From $265.00 today · pay over time");
});

// ───────────────────────── MAP-gate (adversarial — empty) ─────────────────────────
test("cart 'full' (pay-in-full) → no note on a plan tier", () => {
  const map = buildNoteMap(planDetail, [planTier], {}, "full", { tt_plan: 1 });
  assert.deepStrictEqual(map, {});
});

test("no-plan tier → no note", () => {
  const map = buildNoteMap(
    planDetail,
    [noPlanTier],
    {},
    "installments",
    { tt_std: 2 },
  );
  assert.deepStrictEqual(map, {});
});

test("event-like detail (hasPlan=false) → empty map (events untouched)", () => {
  const map = buildNoteMap(
    eventLikeDetail,
    [planTier],
    {},
    "installments",
    { tt_plan: 1 },
  );
  assert.deepStrictEqual(map, {});
});

test("per-tier override beats the cart-level toggle (one tier full, one over-time)", () => {
  const planTierB = { ...planTier, ticketTypeId: "tt_plan2" };
  const map = buildNoteMap(
    planDetail,
    [planTier, planTierB],
    { tt_plan2: "full" },
    "installments",
    { tt_plan: 1, tt_plan2: 1 },
  );
  assert.ok(map.tt_plan); // cart-level "installments" applies
  assert.strictEqual(map.tt_plan2, undefined); // per-tier "full" suppresses
});

// ───────────────────────── source-contract wiring (fails-on-revert) ─────────────────────────
test("ConsumerTripDetailScreen imports the shared deposit + formatter and builds installmentNoteByTicketId", () => {
  const src = stripComments(
    read("app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx"),
  );
  assert.ok(src.includes("tripTierDepositTodayCents"));
  assert.ok(src.includes("formatTripTierInstallmentNote"));
  assert.ok(/installmentNoteByTicketId/.test(src));
  // gated on the trip having a plan + the per-tier/cart installments choice
  assert.ok(/detail\.hasPlan/.test(src));
  assert.ok(/!==\s*"installments"|===\s*"installments"/.test(src));
  // passed to the cart sheet
  assert.ok(
    /installmentNoteByTicketId=\{installmentNoteByTicketId\}/.test(src),
  );
});

test("TicketCartSheet accepts installmentNoteByTicketId and forwards installmentNote per row", () => {
  const src = stripComments(
    read("app-mobile/src/components/expandedCard/TicketCartSheet.tsx"),
  );
  assert.ok(/installmentNoteByTicketId\??:/.test(src)); // prop declared
  assert.ok(
    /installmentNote=\{installmentNoteByTicketId\?\.\[ticket\.id\]\s*\?\?\s*null\}/.test(
      src,
    ),
  ); // forwarded to QuantityRow
});
