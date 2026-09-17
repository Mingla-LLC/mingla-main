/**
 * #3393 umbrella — reservation rule and ordering fixes from the tutorial prep.
 *
 *   #3387 — Deposit for large parties has its own switch and amount, can be
 *           switched off, can't be switched on in a state that refuses guests,
 *           warns about a rule saved that way before, and a guest who still
 *           meets one is told why instead of the generic failure.
 *   #3388 — Take orders through Mingla is disabled with a reason before the
 *           venue is live, and any refusal is shown instead of swallowed.
 *
 * The REAL VenueCapacityRulesPanel and the REAL VenueOrdersModule are mounted
 * under the stock config (bare react-test-renderer). Data hooks are stubs so
 * each assertion reads exactly what the component writes or shows.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ── shared stubs ─────────────────────────────────────────────────────────────

const mockPush = jest.fn((_href: string) => undefined);
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({ push: (href: string) => mockPush(href) }),
}));

const mockHostEl = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};

jest.mock("lucide-react-native", () => ({
  __esModule: true,
  ChevronDown: () => null,
  ChevronUp: () => null,
  LayoutGrid: () => null,
  ClipboardList: () => null,
}));
jest.mock("../../ui/BrandSwitch", () => ({ __esModule: true, BrandSwitch: mockHostEl("BrandSwitch") }));
jest.mock("../../ui/GlassCard", () => ({ __esModule: true, GlassCard: mockHostEl("GlassCard") }));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: mockHostEl("Input") }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockHostEl("Button") }));

let mockBrand: Record<string, unknown>;
jest.mock("../../../hooks/useCurrentBrand", () => ({
  __esModule: true,
  useCurrentBrand: () => mockBrand,
}));

let mockReservationSettings: { feeEnabled: boolean; feeAmountCents: number | null } | null;
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  __esModule: true,
  useVenueReservationSettings: () => ({ data: mockReservationSettings }),
}));

let mockRules: Array<Record<string, unknown>>;
const mockUpsertRule = jest.fn(
  (_input: Record<string, unknown>, _opts?: { onSuccess?: () => void }) => undefined,
);
jest.mock("../../../hooks/useVenueCapacityRules", () => ({
  __esModule: true,
  useVenueCapacityRules: () => ({ data: mockRules }),
  useUpsertCapacityRule: () => ({
    mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) =>
      mockUpsertRule(input, opts),
    isPending: false,
  }),
}));

// Orders module stubs.
let mockClaimStatus: string | undefined;
let mockOrderingEnabled: boolean;
let mockSetEnabledError: unknown;
const mockSetEnabled = jest.fn();
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  __esModule: true,
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useQrSpots", () => ({
  __esModule: true,
  useQrSpotVenues: () => ({ data: [] }),
  useQrSpots: () => ({ data: [] }),
}));
jest.mock("../../../hooks/useVenueOrders", () => ({
  __esModule: true,
  useVenueOrders: () => ({ data: [] }),
  useTransitionVenueOrder: () => ({ mutate: () => undefined, isPending: false }),
  useDecideVenueOrderRefund: () => ({ mutate: () => undefined, isPending: false }),
}));
jest.mock("../../../hooks/useVenueOrderTabs", () => ({
  __esModule: true,
  useVenueTabs: () => ({ data: [] }),
}));
jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({
    data: mockClaimStatus === undefined ? undefined : { id: "venue-3393", claimStatus: mockClaimStatus },
  }),
}));
jest.mock("../../../hooks/useVenueOrderingSettings", () => ({
  __esModule: true,
  useVenueOrderingSettings: () => ({
    data: { orderingEnabled: mockOrderingEnabled, paused: false },
  }),
  useSetVenueOrderingPaused: () => ({ mutate: () => undefined, isPending: false }),
  useSetVenueOrderingEnabled: () => ({
    mutate: (next: boolean, opts?: { onError?: (e: unknown) => void }) => {
      mockSetEnabled(next);
      if (mockSetEnabledError !== undefined) opts?.onError?.(mockSetEnabledError);
    },
    isPending: false,
  }),
}));
jest.mock("../VenueOrderCard", () => ({ __esModule: true, VenueOrderCard: () => null }));
jest.mock("../VenueOrderDetailSheet", () => ({ __esModule: true, VenueOrderDetailSheet: () => null }));
jest.mock("../orderPad/VenueOrderPadSheet", () => ({ __esModule: true, VenueOrderPadSheet: () => null }));
jest.mock("../orderPad/VenueTabsCard", () => ({ __esModule: true, VenueTabsCard: () => null }));

import {
  depositRuleBlocksGuests,
  depositThresholdFeeCents,
  validateDepositRule,
} from "../capacityRules";
import { VenueCapacityRulesPanel } from "../VenueCapacityRulesPanel";
import {
  DEPOSIT_UNCONFIGURED_COPY,
  guestReservationFailureCopy,
} from "../venueGuestReservationErrorCopy";
import { VenueOrdersModule } from "../VenueOrdersModule";
import {
  ORDERING_NOT_ALLOWED_COPY,
  ORDERING_NOT_LIVE_COPY,
  ORDERING_SWITCH_FAILED_COPY,
  ORDERING_UNAVAILABLE_COPY,
  orderingSwitchErrorCopy,
  orderingSwitchState,
} from "../venueOrderingSwitch";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Tree {
  root: TestInstance;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

const byTestId = (root: TestInstance, id: string): TestInstance[] =>
  root.findAll((n) => n.props.testID === id && typeof n.type === "string");

function one(root: TestInstance, id: string): TestInstance {
  const node = byTestId(root, id)[0];
  if (node === undefined) throw new Error(`missing ${id}`);
  return node;
}

function textOf(node: TestInstance): string {
  const walk = (v: unknown): string =>
    typeof v === "string" || typeof v === "number"
      ? String(v)
      : Array.isArray(v)
      ? v.map(walk).join("")
      : "";
  return walk(node.props.children);
}

async function press(node: TestInstance, value?: unknown): Promise<void> {
  const handler = (node.props.onValueChange ?? node.props.onPress ?? node.props.onChangeText) as
    | ((v?: unknown) => void)
    | undefined;
  if (typeof handler !== "function") throw new Error("no handler");
  await TestRenderer.act(async () => {
    handler(value);
  });
}

async function openPanel(): Promise<Tree> {
  const tree = await mount(
    <VenueCapacityRulesPanel brandId="brand-3393" venueId="venue-3393" canMutate />,
  );
  await press(one(tree.root, "venue-capacity-rules-toggle"));
  return tree;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUpsertRule.mockClear();
  mockSetEnabled.mockClear();
  mockBrand = {
    id: "brand-3393",
    defaultCurrency: "USD",
    stripeStatus: "active",
    paystackSubaccountCode: null,
  };
  mockReservationSettings = { feeEnabled: false, feeAmountCents: null };
  mockRules = [];
  mockClaimStatus = "verified";
  mockOrderingEnabled = false;
  mockSetEnabledError = undefined;
});

// ── #3387 pure contracts ─────────────────────────────────────────────────────

describe("#3387 — the deposit rule contract", () => {
  test("reads the amount the same way the booking server does", () => {
    expect(depositThresholdFeeCents({ fee_cents: 2500 })).toBe(2500);
    expect(depositThresholdFeeCents({ amount_cents: 1200 })).toBe(1200);
    expect(depositThresholdFeeCents({ fee_cents: 0 })).toBeNull();
    expect(depositThresholdFeeCents({ min_party_for_fee: 8 })).toBeNull();
    expect(depositThresholdFeeCents(null)).toBeNull();
  });

  test("an active rule with no amount and no reservation fee blocks guests", () => {
    expect(
      depositRuleBlocksGuests({ isActive: true, params: { min_party_for_fee: 8 }, reservationFeeActive: false }),
    ).toBe(true);
    expect(
      depositRuleBlocksGuests({ isActive: true, params: { min_party_for_fee: 8 }, reservationFeeActive: true }),
    ).toBe(false);
    expect(
      depositRuleBlocksGuests({ isActive: true, params: { min_party_for_fee: 8, fee_cents: 500 }, reservationFeeActive: false }),
    ).toBe(false);
    expect(
      depositRuleBlocksGuests({ isActive: false, params: { min_party_for_fee: 8 }, reservationFeeActive: false }),
    ).toBe(false);
  });

  test("validation refuses every shape the server would refuse guests for", () => {
    const base = { partySizeInput: "8", amountCents: 0, reservationFeeActive: false, payoutReady: true };
    expect(validateDepositRule(base)).toEqual({ ok: false, problem: "amount_required" });
    expect(validateDepositRule({ ...base, partySizeInput: "" })).toEqual({ ok: false, problem: "party_size_required" });
    expect(validateDepositRule({ ...base, partySizeInput: "0" })).toEqual({ ok: false, problem: "party_size_required" });
    expect(validateDepositRule({ ...base, partySizeInput: "8.5" })).toEqual({ ok: false, problem: "party_size_required" });
    expect(validateDepositRule({ ...base, partySizeInput: "101" })).toEqual({ ok: false, problem: "party_size_required" });
    expect(validateDepositRule({ ...base, amountCents: 2500, payoutReady: false })).toEqual({
      ok: false,
      problem: "payouts_not_ready",
    });
  });

  test("validation accepts an own amount, or the reservation fee standing in", () => {
    expect(
      validateDepositRule({ partySizeInput: " 8 ", amountCents: 2500, reservationFeeActive: false, payoutReady: true }),
    ).toEqual({ ok: true, params: { min_party_for_fee: 8, fee_cents: 2500 } });
    expect(
      validateDepositRule({ partySizeInput: "6", amountCents: 0, reservationFeeActive: true, payoutReady: true }),
    ).toEqual({ ok: true, params: { min_party_for_fee: 6 } });
  });
});

// ── #3387 panel ──────────────────────────────────────────────────────────────

describe("#3387 — Deposit for large parties in the Tables panel", () => {
  test("switching ON with no amount saves nothing and says why", async () => {
    const tree = await openPanel();
    const toggle = one(tree.root, "venue-rule-deposit-toggle");
    expect(toggle.props.value).toBe(false);
    expect(byTestId(tree.root, "venue-rule-deposit-input")).toHaveLength(0);
    await press(one(tree.root, "venue-rule-deposit-toggle"), true);
    expect(one(tree.root, "venue-rule-deposit-toggle").props.value).toBe(true);
    expect(textOf(one(tree.root, "venue-rule-deposit-problem"))).toMatch(/party size/);
    await press(one(tree.root, "venue-rule-deposit-input"), "8");
    await press(one(tree.root, "venue-rule-deposit-save"));
    expect(mockUpsertRule).not.toHaveBeenCalled();
    expect(textOf(one(tree.root, "venue-rule-deposit-problem"))).toMatch(/deposit amount above 0/);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a party size and an amount save an active rule the server can charge", async () => {
    const tree = await openPanel();
    await press(one(tree.root, "venue-rule-deposit-toggle"), true);
    await press(one(tree.root, "venue-rule-deposit-input"), "8");
    await press(one(tree.root, "venue-rule-deposit-amount"), "25");
    await press(one(tree.root, "venue-rule-deposit-save"));
    expect(mockUpsertRule).toHaveBeenCalledTimes(1);
    expect(mockUpsertRule.mock.calls[0][0]).toMatchObject({
      kind: "deposit_threshold",
      isActive: true,
      params: { min_party_for_fee: 8, fee_cents: 2500 },
    });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("with the reservation fee on, the amount may be left blank", async () => {
    mockReservationSettings = { feeEnabled: true, feeAmountCents: 1000 };
    const tree = await openPanel();
    await press(one(tree.root, "venue-rule-deposit-toggle"), true);
    await press(one(tree.root, "venue-rule-deposit-input"), "6");
    await press(one(tree.root, "venue-rule-deposit-save"));
    expect(mockUpsertRule.mock.calls[0][0]).toMatchObject({
      isActive: true,
      params: { min_party_for_fee: 6 },
    });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("an amount without payouts set up is refused with the payout route", async () => {
    mockBrand = { ...mockBrand, stripeStatus: "not_connected" };
    const tree = await openPanel();
    await press(one(tree.root, "venue-rule-deposit-toggle"), true);
    await press(one(tree.root, "venue-rule-deposit-input"), "8");
    await press(one(tree.root, "venue-rule-deposit-amount"), "25");
    await press(one(tree.root, "venue-rule-deposit-save"));
    expect(mockUpsertRule).not.toHaveBeenCalled();
    await press(one(tree.root, "venue-rule-deposit-payout-cta"));
    expect(mockPush).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a rule saved before this fix warns, and can be switched OFF", async () => {
    mockRules = [
      { id: "rule-1", kind: "deposit_threshold", params: { min_party_for_fee: 8 }, isActive: true },
    ];
    const tree = await openPanel();
    expect(textOf(one(tree.root, "venue-rule-deposit-blocking"))).toContain(
      "Guests booking for 8 or more can't book",
    );
    expect(one(tree.root, "venue-rule-deposit-toggle").props.value).toBe(true);
    await press(one(tree.root, "venue-rule-deposit-toggle"), false);
    expect(mockUpsertRule).toHaveBeenCalledTimes(1);
    expect(mockUpsertRule.mock.calls[0][0]).toMatchObject({
      id: "rule-1",
      kind: "deposit_threshold",
      isActive: false,
      params: { min_party_for_fee: 8 },
    });
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── #3387 guest copy ─────────────────────────────────────────────────────────

describe("#3387 — the guest is told why, not the generic failure", () => {
  test("the unconfigured-deposit refusal maps to its own sentence", async () => {
    expect(guestReservationFailureCopy("deposit_amount_unconfigured")).toBe(
      DEPOSIT_UNCONFIGURED_COPY,
    );
    expect(guestReservationFailureCopy("slot_unavailable")).toBeNull();
    await expect(
      Promise.resolve(guestReservationFailureCopy("deposit_amount_unconfigured")),
    ).resolves.toMatch(/smaller party or contact the venue/);
  });

  test("the public reservation form uses that mapping on a failed create", () => {
    const src = readFileSync(join(__dirname, "..", "GuestVenueReservation.tsx"), "utf8");
    expect(src).toContain(
      "setError(guestReservationFailureCopy(errorCode) ?? RESERVATION_FAILURE_COPY);",
    );
  });
});

// ── #3388 ────────────────────────────────────────────────────────────────────

describe("#3388 — the ordering switch explains itself", () => {
  test("state: disabled with a reason until the venue is live; OFF always allowed", () => {
    const base = { orderingEnabled: false, canDecideMoney: true, pending: false };
    expect(orderingSwitchState({ ...base, claimStatus: "verified" })).toEqual({ disabled: false, note: null });
    expect(orderingSwitchState({ ...base, claimStatus: "pending_review" })).toEqual({
      disabled: true,
      note: ORDERING_NOT_LIVE_COPY,
    });
    expect(orderingSwitchState({ ...base, claimStatus: "suspended" })).toEqual({
      disabled: true,
      note: ORDERING_UNAVAILABLE_COPY,
    });
    expect(orderingSwitchState({ ...base, claimStatus: undefined })).toEqual({ disabled: true, note: null });
    expect(
      orderingSwitchState({ ...base, orderingEnabled: true, claimStatus: "suspended" }),
    ).toEqual({ disabled: false, note: null });
    expect(orderingSwitchState({ ...base, canDecideMoney: false, claimStatus: "verified" }).disabled).toBe(true);
  });

  test("error copy reads the server code out of the function error", async () => {
    const fnError = (body: unknown) => ({
      message: "Edge Function returned a non-2xx status code",
      context: { text: async () => JSON.stringify(body) },
    });
    await expect(orderingSwitchErrorCopy(fnError({ error: "venue_not_orderable" }))).resolves.toBe(
      ORDERING_NOT_LIVE_COPY,
    );
    await expect(orderingSwitchErrorCopy(fnError({ error: "not_authorized" }))).resolves.toBe(
      ORDERING_NOT_ALLOWED_COPY,
    );
    await expect(orderingSwitchErrorCopy(fnError({ error: "internal_error" }))).resolves.toBe(
      ORDERING_SWITCH_FAILED_COPY,
    );
    await expect(orderingSwitchErrorCopy(new Error("offline"))).resolves.toBe(
      ORDERING_SWITCH_FAILED_COPY,
    );
  });

  test("a venue in review: the switch is disabled and the card says why", async () => {
    mockClaimStatus = "pending_review";
    const tree = await mount(<VenueOrdersModule brandId="brand-3393" venueId="venue-3393" />);
    expect(one(tree.root, "venue-orders-enable-switch").props.disabled).toBe(true);
    expect(textOf(one(tree.root, "venue-orders-enable-not-live"))).toBe(ORDERING_NOT_LIVE_COPY);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a live venue: the switch works, and a refusal is shown, not swallowed", async () => {
    mockClaimStatus = "verified";
    mockSetEnabledError = {
      message: "Edge Function returned a non-2xx status code",
      context: { text: async () => JSON.stringify({ error: "internal_error" }) },
    };
    const tree = await mount(<VenueOrdersModule brandId="brand-3393" venueId="venue-3393" />);
    const toggle = one(tree.root, "venue-orders-enable-switch");
    expect(toggle.props.disabled).toBe(false);
    expect(byTestId(tree.root, "venue-orders-enable-not-live")).toHaveLength(0);
    await press(toggle, true);
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    expect(textOf(one(tree.root, "venue-orders-enable-error"))).toBe(ORDERING_SWITCH_FAILED_COPY);
    await TestRenderer.act(async () => tree.unmount());
  });
});
