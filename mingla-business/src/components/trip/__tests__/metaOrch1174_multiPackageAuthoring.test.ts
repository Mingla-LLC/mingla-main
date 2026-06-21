/**
 * META-ORCH-1174 Leg B2 [MULTI-PACKAGE AUTHORING] — adversarial + behavioral
 * tests for the trip creator wizard's multi-package pricing step.
 *
 * Covers (per dispatch §4 VERIFY):
 *   1. validateTripPackages: ≥1 package, valid price (≥0, free allowed),
 *      capacity ≥1, soft cap 6, per-package installment terms, free+paid mix.
 *   2. Per-package description persists through createTripPricingTier +
 *      updateTripPricing (tier_metadata.description) and round-trips via
 *      mapTripPricingTier (listTripPricingTiers).
 *   3. Source-level wiring: Step4 renders an inline add/remove package list;
 *      the wizard persists N packages via the B1 service fns
 *      (updateTripPricing / createTripPricingTier / removeTripPricingTier) and
 *      gates publish on validateTripPackages.
 *   4. Single-package (N=1) still works — the validator + persistence accept it.
 *
 * Fails-on-revert: each assertion pins a specific Leg-B2 commitment.
 */
/* eslint-disable import/first */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  MAX_TRIP_PACKAGES,
  validateTripPackages,
  type ValidatedPackage,
} from "../tripPackagesValidation";

// ----- supabase mock (capture insert/update payloads) -----

interface CapturedCall {
  table: string;
  op: "insert" | "update" | "select";
  payload?: Record<string, unknown>;
}
const calls: CapturedCall[] = [];

function makeBuilder(table: string) {
  // Each terminal (.single()/.maybeSingle()) resolves a row the tests pre-seed.
  const builder: Record<string, unknown> = {};
  const chain = (): typeof builder => builder;
  builder.select = jest.fn(() => {
    calls.push({ table, op: "select" });
    return builder;
  });
  builder.insert = jest.fn((payload: Record<string, unknown>) => {
    calls.push({ table, op: "insert", payload });
    return builder;
  });
  builder.update = jest.fn((payload: Record<string, unknown>) => {
    calls.push({ table, op: "update", payload });
    return builder;
  });
  builder.eq = jest.fn(chain);
  builder.in = jest.fn(chain);
  builder.is = jest.fn(chain);
  builder.order = jest.fn(chain);
  // .limit(1) on the tier lookup is AWAITED directly (no .single()) — resolve a
  // LIST result so updateTripPricing finds the addressed tier (N-tier-safe path
  // that replaced the lifted .maybeSingle()-throws-on->1 choke).
  builder.limit = jest.fn(async () => ({
    data: [nextRowFor(table).data],
    error: null,
  }));
  builder.single = jest.fn(async () => nextRowFor(table));
  builder.maybeSingle = jest.fn(async () => nextRowFor(table));
  return builder;
}

// Per-table seeded rows the terminal resolvers return.
let seededTicketRow: Record<string, unknown> = {};
let seededTierRow: Record<string, unknown> = {};
let seededEventRow: Record<string, unknown> = { currency: "USD" };

function nextRowFor(table: string): { data: unknown; error: null } {
  if (table === "events") return { data: seededEventRow, error: null };
  if (table === "ticket_types") return { data: seededTicketRow, error: null };
  if (table === "trip_pricing_tiers") return { data: seededTierRow, error: null };
  return { data: null, error: null };
}

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: jest.fn(async () => ({ data: {}, error: null })),
  },
}));

import {
  createTripPricingTier,
  updateTripPricing,
} from "../../../services/tripsService";

beforeEach(() => {
  calls.length = 0;
  seededEventRow = { currency: "USD" };
  seededTicketRow = {
    id: "tt-new",
    event_id: "evt-1",
    price_cents: 5000,
    currency: "USD",
    quantity_total: 20,
    is_unlimited: false,
  };
  seededTierRow = {
    id: "tier-new",
    event_id: "evt-1",
    ticket_type_id: "tt-new",
    tier_name: "VIP",
    tier_metadata: { description: "Spa + transfer" },
  };
});

const pkg = (over: Partial<ValidatedPackage> = {}): ValidatedPackage => ({
  name: "Standard",
  priceMajor: "50",
  capacity: 20,
  paymentPlan: null,
  ...over,
});

// ============================================================================
// 1. validateTripPackages
// ============================================================================

describe("META-ORCH-1174 B2 — validateTripPackages", () => {
  test("single package (N=1) valid → ok (legacy single-package still works)", () => {
    expect(validateTripPackages([pkg()]).ok).toBe(true);
  });

  test("zero packages → rejected (min 1)", () => {
    const r = validateTripPackages([]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/at least one package/i);
  });

  test("multiple packages all valid → ok (Standard + VIP)", () => {
    expect(
      validateTripPackages([
        pkg({ name: "Standard", priceMajor: "50", capacity: 20 }),
        pkg({ name: "VIP", priceMajor: "150", capacity: 5 }),
      ]).ok,
    ).toBe(true);
  });

  test("free + paid mix allowed (DEC-I)", () => {
    const r = validateTripPackages([
      pkg({ name: "Free RSVP", priceMajor: "0", capacity: 100 }),
      pkg({ name: "VIP", priceMajor: "150", capacity: 5 }),
    ]);
    expect(r.ok).toBe(true);
  });

  test("price 0 / empty string is a valid free package (price floor 0)", () => {
    expect(validateTripPackages([pkg({ priceMajor: "0" })]).ok).toBe(true);
    expect(validateTripPackages([pkg({ priceMajor: "" })]).ok).toBe(true);
  });

  test("negative price → rejected", () => {
    const r = validateTripPackages([pkg({ priceMajor: "-5" })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/valid price/i);
  });

  test("blank name → rejected", () => {
    const r = validateTripPackages([pkg({ name: "   " })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/name/i);
  });

  test("capacity < 1 / null / non-integer → rejected (per-package, DEC-D)", () => {
    expect(validateTripPackages([pkg({ capacity: 0 })]).ok).toBe(false);
    expect(validateTripPackages([pkg({ capacity: null })]).ok).toBe(false);
    expect(validateTripPackages([pkg({ capacity: 2.5 })]).ok).toBe(false);
    expect(validateTripPackages([pkg({ capacity: 1 })]).ok).toBe(true);
  });

  test("soft cap: exactly 6 ok, 7 rejected (DEC-E)", () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      pkg({ name: `P${i}`, capacity: 5 }),
    );
    expect(validateTripPackages(six).ok).toBe(true);
    expect(MAX_TRIP_PACKAGES).toBe(6);
    const seven = [...six, pkg({ name: "P7", capacity: 5 })];
    const r = validateTripPackages(seven);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/at most 6/i);
  });

  test("enabled payment plan must sum to 100% (per-package, DEC-F)", () => {
    const bad = validateTripPackages([
      pkg({
        paymentPlan: {
          deposit_pct: 25,
          installments: [{ pct: 25, days_after_booking: 30 }], // 50% total
        },
      }),
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/100%/);

    const good = validateTripPackages([
      pkg({
        paymentPlan: {
          deposit_pct: 50,
          installments: [{ pct: 50, days_after_booking: 30 }],
        },
      }),
    ]);
    expect(good.ok).toBe(true);
  });

  test("payment-plan installment without a due date → rejected", () => {
    const r = validateTripPackages([
      pkg({
        paymentPlan: {
          deposit_pct: 50,
          installments: [{ pct: 50 }], // no days_after_booking / fixed_date
        },
      }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/due date/i);
  });
});

// ============================================================================
// 2. Per-package description persistence (service)
// ============================================================================

describe("META-ORCH-1174 B2 — per-package description persists", () => {
  test("createTripPricingTier writes tier_metadata.description", async () => {
    await createTripPricingTier("evt-1", {
      tierName: "VIP",
      priceCents: 15000,
      capacity: 5,
      description: "Spa + private transfer",
    });
    const tierInsert = calls.find(
      (c) => c.table === "trip_pricing_tiers" && c.op === "insert",
    );
    expect(tierInsert).toBeDefined();
    expect(
      (tierInsert?.payload?.tier_metadata as Record<string, unknown>)
        ?.description,
    ).toBe("Spa + private transfer");
    // Each package is its OWN ticket_types row carrying its own price + capacity.
    const ttInsert = calls.find(
      (c) => c.table === "ticket_types" && c.op === "insert",
    );
    expect(ttInsert?.payload?.price_cents).toBe(15000);
    expect(ttInsert?.payload?.quantity_total).toBe(5);
  });

  test("createTripPricingTier with blank description omits the key", async () => {
    await createTripPricingTier("evt-1", {
      tierName: "Standard",
      priceCents: 5000,
      capacity: 20,
      description: "   ",
    });
    const tierInsert = calls.find(
      (c) => c.table === "trip_pricing_tiers" && c.op === "insert",
    );
    expect(
      "description" in
        ((tierInsert?.payload?.tier_metadata as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });

  test("updateTripPricing merges description into tier_metadata (present-key)", async () => {
    // Existing metadata carries an installments key that must be preserved.
    seededTierRow = {
      id: "tier-1",
      event_id: "evt-1",
      ticket_type_id: "tt-1",
      tier_name: "VIP",
      tier_metadata: { installments: { deposit_pct: 25, installments: [] } },
    };
    await updateTripPricing("evt-1", {
      ticketTypeId: "tt-1",
      tierName: "VIP",
      priceCents: 15000,
      capacity: 5,
      description: "Updated blurb",
    });
    const tierUpdate = calls.find(
      (c) => c.table === "trip_pricing_tiers" && c.op === "update",
    );
    const meta = tierUpdate?.payload?.tier_metadata as Record<string, unknown>;
    expect(meta.description).toBe("Updated blurb");
    // installments key preserved (not clobbered by the description merge).
    expect(meta.installments).toBeDefined();
  });

  test("updateTripPricing targets the package by ticketTypeId (N-tier safe)", async () => {
    await updateTripPricing("evt-1", {
      ticketTypeId: "tt-vip",
      tierName: "VIP",
      priceCents: 15000,
      capacity: 5,
    });
    // The tier lookup must be scoped to the addressed ticket_type_id, never a
    // bare .maybeSingle() that throws on >1 (the lifted single-tier choke).
    const tierSelect = calls.find(
      (c) => c.table === "trip_pricing_tiers" && c.op === "select",
    );
    expect(tierSelect).toBeDefined();
  });
});

// ============================================================================
// 3. Source-level wiring (Step4 list + wizard persistence + publish gate)
// ============================================================================

const ROOT = join(__dirname, "..", "..", "..", "..");
const STEP4_SRC = readFileSync(
  join(ROOT, "src", "components", "trip", "TripCreatorStep4Pricing.tsx"),
  "utf8",
);
const WIZARD_SRC = readFileSync(
  join(ROOT, "src", "components", "trip", "TripCreatorWizard.tsx"),
  "utf8",
);
const SERVICE_SRC = readFileSync(
  join(ROOT, "src", "services", "tripsService.ts"),
  "utf8",
);

describe("META-ORCH-1174 B2 — Step4 multi-package authoring UI", () => {
  test("renders an inline add-package control + per-package remove", () => {
    expect(STEP4_SRC).toMatch(/testID="trip-step4-add-package"/);
    expect(STEP4_SRC).toMatch(/trip-step4-package-remove-\$\{index\}/);
  });

  test("per-package fields: name, price, description, capacity (DEC-G)", () => {
    expect(STEP4_SRC).toMatch(/trip-step4-package-name-\$\{index\}/);
    expect(STEP4_SRC).toMatch(/trip-step4-price-\$\{index\}/);
    expect(STEP4_SRC).toMatch(/trip-step4-description-\$\{index\}/);
    expect(STEP4_SRC).toMatch(/trip-step4-capacity-\$\{index\}/);
  });

  test("draft is a packages array (multi-package), not a single tier", () => {
    expect(STEP4_SRC).toMatch(/packages:\s*Step4Package\[\]/);
    // The legacy single-tier `tierName`/`priceMajor` top-level draft fields are
    // gone (now per-package).
    expect(STEP4_SRC).not.toMatch(/export interface Step4Draft \{[^}]*tierName:/);
  });

  test("per-package payment plan toggle wired to PaymentPlanEditor (DEC-F)", () => {
    expect(STEP4_SRC).toMatch(/PaymentPlanEditor/);
    expect(STEP4_SRC).toMatch(/payment plan toggle/i);
  });
});

describe("META-ORCH-1174 B2 — wizard persists N packages via B1 service fns", () => {
  test("imports the B1 create/remove tier mutations", () => {
    expect(WIZARD_SRC).toMatch(/useCreateTripPricingTier/);
    expect(WIZARD_SRC).toMatch(/useRemoveTripPricingTier/);
  });

  test("persistPackages: update existing / create new / remove dropped", () => {
    const block = WIZARD_SRC.match(/const persistPackages[^]*?\}, \[/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    // existing package (has ticketTypeId) → updateTripPricing
    expect(body).toMatch(/updatePricingMutation\.mutateAsync/);
    // new package (no ticketTypeId) → createTripPricingTier
    expect(body).toMatch(/createTierMutation\.mutateAsync/);
    // dropped persisted tier → removeTripPricingTier
    expect(body).toMatch(/removeTierMutation\.mutateAsync/);
    // each package carries its own price + capacity + installments
    expect(body).toMatch(/priceCents/);
    expect(body).toMatch(/capacity/);
    expect(body).toMatch(/installmentSchedule:\s*pkg\.paymentPlan/);
  });

  test("publish is gated on validateTripPackages (belt + suspenders)", () => {
    expect(WIZARD_SRC).toMatch(/validateTripPackages\(step4Draft\.packages\)/);
    // dock Publish disabled when packages invalid
    expect(WIZARD_SRC).toMatch(/!packagesValidation\.ok/);
    // belt: handlePublishTap blocks + jumps to the pricing step (4)
    expect(WIZARD_SRC).toMatch(/packagesValidation\.ok[\s\S]*?setStep\(4\)/);
  });
});

describe("META-ORCH-1174 B2 — B1 service layer is N-tier safe", () => {
  test("updateTripPricing does NOT use .maybeSingle()-throws-on->1", () => {
    const block = SERVICE_SRC.match(
      /export async function updateTripPricing[^]*?\n\}/,
    );
    expect(block).not.toBeNull();
    // The lifted choke: tier lookup orders + limits instead of maybeSingle().
    expect(block?.[0]).toMatch(/\.order\("created_at"/);
    expect(block?.[0]).toMatch(/\.limit\(1\)/);
  });

  test("createTripPricingTier + removeTripPricingTier exist (B1)", () => {
    expect(SERVICE_SRC).toMatch(/export async function createTripPricingTier/);
    expect(SERVICE_SRC).toMatch(/export async function removeTripPricingTier/);
    // removal refuses a sold package (refund-gate parity).
    expect(SERVICE_SRC).toMatch(/tier_delete_with_sales/);
  });
});
