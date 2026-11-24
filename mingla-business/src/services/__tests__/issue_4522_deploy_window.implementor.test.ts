/**
 * issue #4522 — deploy window. Host web deploys before the branch's
 * migrations are applied, so the money screen's reads must work against
 * main's database: no `order_installments.kind` (42703) and no
 * `biz_trip_event_balances` (PGRST202). Against that database the rows are
 * read exactly as on main (no `kind` in the select) and no v2 balances are
 * returned, so every order keeps the pre-#4522 view. Once the schema exists
 * the v2 reads switch on by themselves. A real failure still throws.
 *
 * FAILS ON REVERT: the rows select asks for `kind` on main's database (the
 * whole money screen errors), or the balances RPC 404 becomes the error
 * state for every trip.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Result = { data: unknown; error: { code?: string; message?: string } | null };

const state: {
  kindColumn: "present" | "missing" | "broken";
  balancesRpc: "present" | "missing" | "broken";
  selects: string[];
  rpcCalls: string[];
} = { kindColumn: "missing", balancesRpc: "missing", selects: [], rpcCalls: [] };

const ROW = {
  id: "inst-1",
  order_id: "order-1",
  ordinal: 1,
  amount_cents: 30000,
  buyer_total_cents: null,
  refunded_amount_cents: 0,
  currency: "USD",
  due_at: "2026-12-19T09:00:00Z",
  status: "scheduled",
  provider: "stripe",
  collection_method: "auto_card",
  buyer_action: "none",
  buyer_action_at: null,
  stripe_payment_intent_id: null,
  stripe_charge_id: null,
  collected_at: null,
  failed_at: null,
  failure_reason: null,
  retry_count: 0,
  next_retry_at: null,
  orders: {
    buyer_name: "Buyer",
    buyer_email: "buyer@example.test",
    total_cents: 90000,
    at_risk: false,
    at_risk_since: null,
    event_id: "event-1",
    payment_card_last4: "4242",
  },
};

function selectResult(columns: string): Result {
  const asksKind = /(^|[\s,])kind(,|$|\s)/.test(columns);
  if (asksKind && state.kindColumn === "missing") {
    return { data: null, error: { code: "42703", message: "column order_installments.kind does not exist" } };
  }
  if (asksKind && state.kindColumn === "broken") {
    return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
  }
  if (columns.trim() === "kind") return { data: [], error: null };
  return {
    data: [asksKind ? { ...ROW, kind: "scheduled" } : ROW],
    error: null,
  };
}

function builder(columns: string) {
  const result = (): Result => selectResult(columns);
  const chain: Record<string, unknown> = {};
  chain.order = () => chain;
  chain.eq = () => chain;
  chain.limit = () => Promise.resolve(result());
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return chain;
}

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        state.selects.push(columns);
        return builder(columns);
      },
    }),
    rpc: (fn: string) => {
      state.rpcCalls.push(fn);
      if (fn !== "biz_trip_event_balances") {
        return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } });
      }
      if (state.balancesRpc === "missing") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function public.biz_trip_event_balances" },
        });
      }
      if (state.balancesRpc === "broken") {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "internal error" } });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const service = require("../orderInstallmentsService") as typeof import("../orderInstallmentsService");
const probe = require("@mingla/offering-rendering/planV2Schema") as typeof import("@mingla/offering-rendering/planV2Schema");
/* eslint-enable @typescript-eslint/no-require-imports */

const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

beforeEach(() => {
  probe.resetPlanV2SchemaProbeForTests();
  state.selects = [];
  state.rpcCalls = [];
  warn.mockClear();
});

describe("issue #4522 deploy window — Host money reads on main's database", () => {
  test("rows are read without `kind`, exactly as on main, and no balances are returned", async () => {
    state.kindColumn = "missing";
    state.balancesRpc = "missing";
    const rows = await service.fetchInstallmentsForBrandTrips("brand-1", {
      tripEventId: "event-1",
      planV2: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBeNull();
    const rowSelect = state.selects.find((s) => s.includes("orders!inner"));
    expect(rowSelect).toBeDefined();
    expect(rowSelect).not.toMatch(/\bkind\b/);

    await expect(service.fetchTripEventBalances("event-1")).resolves.toEqual([]);
    // The probe's "not yet" answer is remembered: the RPC is never called.
    expect(state.rpcCalls).not.toContain("biz_trip_event_balances");
    // A client never calls the service-role switch function.
    expect(state.rpcCalls).not.toContain("issue_4522_plan_v2_enabled");
  });

  test("columns applied but the balances function not yet: still the pre-#4522 view", async () => {
    state.kindColumn = "present";
    state.balancesRpc = "missing";
    await expect(service.fetchTripEventBalances("event-1")).resolves.toEqual([]);
    expect(state.rpcCalls).toContain("biz_trip_event_balances");
  });

  test("once the schema exists the v2 reads switch on by themselves", async () => {
    state.kindColumn = "present";
    state.balancesRpc = "present";
    const rows = await service.fetchInstallmentsForBrandTrips("brand-1", { planV2: true });
    expect(rows[0].kind).toBe("scheduled");
    expect(state.selects.find((s) => s.includes("orders!inner"))).toMatch(/\bkind,/);
    await expect(service.fetchTripEventBalances("event-1")).resolves.toEqual([]);
    expect(state.rpcCalls).toContain("biz_trip_event_balances");
  });

  test("a real failure is not swallowed", async () => {
    state.kindColumn = "present";
    state.balancesRpc = "broken";
    await expect(service.fetchTripEventBalances("event-1")).rejects.toThrow(
      "fetchTripEventBalances failed: internal error",
    );
    probe.resetPlanV2SchemaProbeForTests();
    state.kindColumn = "broken";
    await expect(
      service.fetchInstallmentsForBrandTrips("brand-1", { planV2: true }),
    ).rejects.toThrow(/schema probe failed/);
  });

  test("plan v2 switched off on the client: never probes, reads as on main", async () => {
    state.kindColumn = "present";
    await service.fetchInstallmentsForBrandTrips("brand-1", { planV2: false });
    expect(state.selects).toHaveLength(1);
    expect(state.selects[0]).not.toMatch(/\bkind\b/);
  });
});

/*
 * issue #4522 deploy window — trip pricing saves. Main's
 * biz_apply_trip_draft_graph refuses any settings key it does not know
 * (trip_settings_patch_invalid), so sending `share_payment_plan: false` on
 * every first-package save broke trip pricing for every host until the
 * migrations were applied.
 * FAILS ON REVERT: the key is sent for an old-plan / no-plan trip.
 */
describe("issue #4522 deploy window — share_payment_plan is sent only when it can matter", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { shouldSendSharePaymentPlan } = require("../../components/trip/tripBuilderV2Model") as typeof import("../../components/trip/tripBuilderV2Model");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const legacy = {
    deposit: { mode: "percent", pct: 25 },
    installments: [{ ordinal: 1, pct: 100, dueDaysBeforeStart: 30 }],
  } as unknown as Parameters<typeof shouldSendSharePaymentPlan>[0]["plans"][number];
  const v2 = { v: 2, deposit: { mode: "percent", pct: 25 }, count: 3, final_due_days_before_start: 30 } as unknown as Parameters<typeof shouldSendSharePaymentPlan>[0]["plans"][number];

  test("no plan or an old plan, sharing never on: not sent (main's save, unchanged)", () => {
    expect(shouldSendSharePaymentPlan({ draftShare: false, savedShare: false, plans: [null] })).toBe(false);
    expect(shouldSendSharePaymentPlan({ draftShare: undefined, savedShare: undefined, plans: [legacy, null] })).toBe(false);
  });

  test("turned on, saved on (so it can be turned off), or a v2 plan: sent", () => {
    expect(shouldSendSharePaymentPlan({ draftShare: true, savedShare: false, plans: [null] })).toBe(true);
    expect(shouldSendSharePaymentPlan({ draftShare: false, savedShare: true, plans: [null] })).toBe(true);
    expect(shouldSendSharePaymentPlan({ draftShare: false, savedShare: false, plans: [legacy, v2] })).toBe(true);
  });

  test("the wizard's first-package save is gated by it", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../components/trip/TripCreatorWizard.tsx"),
      "utf8",
    );
    expect(src).toMatch(/packageIndex === 0 &&\s*shouldSendSharePaymentPlan\(/);
    expect(src).not.toMatch(/packageIndex === 0\s*\?\s*\{ sharePaymentPlan/);
  });
});
