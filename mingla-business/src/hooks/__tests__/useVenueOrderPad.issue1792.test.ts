/* eslint-disable import/first */
/* The harness invokes the hooks directly (react-query + AuthContext + supabase
   mocked) to capture the query options and the exact request bodies; no React
   tree is rendered. This is the shipped useVenueOrders.issue1791.test.ts
   pattern. */
/**
 * Issue #1792 (#1767 Phase 3b) — the order pad's and the tabs' data layer,
 * proven on the WIRE rather than by reading the source.
 *
 * What this file is really guarding: the pad's numbers must be the SERVER's
 * numbers, and its writes must carry exactly what the server contract accepts.
 * Every assertion below is against the body that actually reached
 * `supabase.functions.invoke` or the options that actually reached react-query.
 *
 * # Fails-on-revert
 * Compute a total client-side and drop `mode: "preview"` → T-PREVIEW1 goes RED.
 * Let a price into a create body → T-CREATE2 goes RED (the P-20 boundary at the
 * network seam). Drop the per-gesture idempotency key → T-CREATE3 goes RED and a
 * double-tap at the pass sends the kitchen two tickets. Sum tabs client-side
 * instead of calling `biz_venue_tab_summaries` → T-TABS1 goes RED. Drop the tab
 * poll floor → T-TABS3 goes RED.
 *
 * New sibling file (append-only safe).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

interface CapturedQuery {
  queryKey: readonly unknown[];
  enabled: boolean;
  staleTime?: number;
  refetchInterval?: number;
  queryFn: () => Promise<unknown>;
}

interface CapturedMutation {
  mutationFn: (vars: never) => Promise<unknown>;
}

const captured: {
  queries: CapturedQuery[];
  mutations: CapturedMutation[];
  invokes: { fn: string; body: Record<string, unknown> }[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
} = { queries: [], mutations: [], invokes: [], rpcs: [] };

let authReady = true;
let invokeResult: Record<string, unknown> = {};
let rpcResult: unknown = { tabs: [] };

jest.mock("@tanstack/react-query", () => ({
  useQuery: (opts: CapturedQuery) => {
    captured.queries.push(opts);
    return { data: undefined, isLoading: false, isError: false };
  },
  useMutation: (opts: CapturedMutation) => {
    captured.mutations.push(opts);
    return { mutate: jest.fn(), mutateAsync: opts.mutationFn, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: authReady, user: { id: "user-1" } }),
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: (fn: string, opts: { body: Record<string, unknown> }) => {
        captured.invokes.push({ fn, body: opts.body });
        return Promise.resolve({ data: invokeResult, error: null });
      },
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      captured.rpcs.push({ fn, args });
      return Promise.resolve({ data: rpcResult, error: null });
    },
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import {
  useCreateStaffOrder,
  usePreviewStaffOrder,
  useSettleStaffOrder,
} from "../useVenueOrderPad";
import {
  VENUE_TABS_POLL_MS,
  VENUE_TABS_STALE_MS,
  fetchVenueTabs,
  useCloseVenueTab,
  useOpenVenueTab,
  useVenueTabs,
  venueTabKeys,
  venueTabsQueryOptions,
} from "../useVenueOrderTabs";

/** The last mutation registered — the harness returns its fn as `mutateAsync`. */
function lastMutationFn(): (vars: never) => Promise<Record<string, unknown>> {
  const last = captured.mutations[captured.mutations.length - 1];
  return last.mutationFn as (vars: never) => Promise<Record<string, unknown>>;
}

describe("issue #1792 — the pad asks the SERVER for every number", () => {
  beforeEach(() => {
    captured.queries = [];
    captured.mutations = [];
    captured.invokes = [];
    captured.rpcs = [];
    authReady = true;
    invokeResult = {};
    rpcResult = { tabs: [] };
  });

  test("T-PREVIEW1 — a running total is a real `mode: preview` round-trip", async () => {
    invokeResult = {
      kind: "staff_order_preview",
      currency: "GBP",
      subtotalCents: 2400,
      serviceChargeBps: 1250,
      serviceChargeCents: 300,
      serviceChargeLabel: "Service",
      totalCents: 2700,
      spotLabel: "Table 12",
      venueName: "The Brasserie",
      staffTabsEnabled: true,
    };
    usePreviewStaffOrder();
    const result = await lastMutationFn()({
      spotCode: "kq7m3pd2xr",
      venueId: null,
      lines: [{ menuItemId: "item-1", quantity: 2, modifierIds: [], notes: null }],
    } as never);

    expect(captured.invokes).toHaveLength(1);
    expect(captured.invokes[0].fn).toBe("venue-order-staff");
    expect(captured.invokes[0].body.action).toBe("create");
    // The preview is the SAME action as the real create, so the two cannot
    // price a cart differently. Only `mode` separates them.
    expect(captured.invokes[0].body.mode).toBe("preview");

    // Every number comes back; none is derived here. `serviceChargeLabel` in
    // particular is the VENUE's label (D-9), never one this layer invents.
    expect(result).toEqual({
      currency: "GBP",
      subtotalCents: 2400,
      serviceChargeBps: 1250,
      serviceChargeCents: 300,
      serviceChargeLabel: "Service",
      totalCents: 2700,
      spotLabel: "Table 12",
      venueName: "The Brasserie",
      staffTabsEnabled: true,
    });
  });

  test("T-CREATE1 — a staff order carries the spot code, the sitting, and the lines", async () => {
    invokeResult = {
      kind: "staff_order_created",
      orderId: "order-1",
      sessionId: "session-1",
      pickupCode: null,
      currency: "GBP",
      totalCents: 2700,
    };
    useCreateStaffOrder("brand-1");
    const created = await lastMutationFn()({
      spotCode: "kq7m3pd2xr",
      venueId: null,
      sessionId: "session-1",
      buyerName: null,
      lines: [{ menuItemId: "item-1", quantity: 2, modifierIds: [], notes: null }],
      idempotencyKey: "pad:abc",
    } as never);

    const body = captured.invokes[0].body;
    expect(body.action).toBe("create");
    expect(body.mode).toBeUndefined();
    expect(body.spotCode).toBe("kq7m3pd2xr");
    // The sitting is sent so a second round joins the first rather than
    // starting a new one the tab would never see.
    expect(body.sessionId).toBe("session-1");
    // `source` and `taken_by_user_id` are NEVER in the body: the server writes
    // them from the verified JWT. A client that could nominate who took an
    // order could nominate anyone.
    expect(body.source).toBeUndefined();
    expect(body.takenByUserId).toBeUndefined();
    expect(created).toMatchObject({ orderId: "order-1", replayed: false });
  });

  test("T-CREATE2 — no price of any kind reaches the network", async () => {
    invokeResult = { orderId: "order-1", sessionId: "s1" };
    useCreateStaffOrder("brand-1");
    await lastMutationFn()({
      spotCode: "kq7m3pd2xr",
      venueId: null,
      sessionId: null,
      buyerName: null,
      lines: [
        { menuItemId: "item-1", quantity: 2, modifierIds: ["mod-1"], notes: "no ice" },
      ],
      idempotencyKey: "pad:abc",
    } as never);
    const serialized = JSON.stringify(captured.invokes[0].body);
    for (const forbidden of ["price", "Price", "cents", "Cents", "total", "amount"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  test("T-CREATE3 — one idempotency key per gesture, and a replay is surfaced", async () => {
    invokeResult = {
      orderId: "order-1",
      sessionId: "session-9",
      currency: "GBP",
      totalCents: 2700,
      replayed: true,
    };
    useCreateStaffOrder("brand-1");
    const result = await lastMutationFn()({
      spotCode: "kq7m3pd2xr",
      venueId: null,
      sessionId: null,
      buyerName: null,
      lines: [{ menuItemId: "item-1", quantity: 1, modifierIds: [], notes: null }],
      idempotencyKey: "pad:the-one-key",
    } as never);
    expect(captured.invokes[0].body.idempotencyKey).toBe("pad:the-one-key");
    expect(result.replayed).toBe(true);
    // A replay resumes the SITTING the first attempt created, not the null the
    // caller sent — otherwise a retried first round starts a second tab.
    expect(result.sessionId).toBe("session-9");
  });

  test("T-CREATE4 — an empty response is an error, never a silent success", async () => {
    invokeResult = {};
    useCreateStaffOrder("brand-1");
    await expect(
      lastMutationFn()({
        spotCode: "kq7m3pd2xr",
        venueId: null,
        sessionId: null,
        buyerName: null,
        lines: [{ menuItemId: "item-1", quantity: 1, modifierIds: [], notes: null }],
        idempotencyKey: "pad:abc",
      } as never),
    ).rejects.toThrow();
  });

  test("T-SETTLE-WIRE — venue_collected sends NO buyer, and no money field", async () => {
    invokeResult = { kind: "settled_venue_collected" };
    useSettleStaffOrder("brand-1");
    await lastMutationFn()({
      orderId: "order-1",
      method: "venue_collected",
    } as never);
    const body = captured.invokes[0].body;
    expect(body.action).toBe("settle");
    expect(body.method).toBe("venue_collected");
    // Nothing about a fee, a provider or an amount is decided here. The row was
    // written in the venue_collected shape at create and the database refuses
    // any other (`venue_orders_money_path_shape`).
    expect(JSON.stringify(body).includes("fee")).toBe(false);
    expect(JSON.stringify(body).includes("provider")).toBe(false);
    expect(JSON.stringify(body).includes("Cents")).toBe(false);
  });
});

describe("issue #1792 — tabs", () => {
  beforeEach(() => {
    captured.queries = [];
    captured.mutations = [];
    captured.invokes = [];
    captured.rpcs = [];
    authReady = true;
    rpcResult = { tabs: [] };
  });

  test("T-TABS1 — the outstanding total is the SERVER's sum, read from the RPC", async () => {
    rpcResult = {
      tabs: [
        {
          sessionId: "session-1",
          venueId: "venue-1",
          qrSpotId: "spot-1",
          spotLabel: "Table 12",
          tabState: "open",
          currency: "GBP",
          roundCount: 3,
          outstandingSubtotalCents: 4800,
          outstandingServiceChargeCents: 600,
          outstandingTipCents: 200,
          outstandingTotalCents: 5600,
          openedAt: "2026-08-11T18:00:00.000Z",
          lastOrderAt: null,
        },
      ],
    };
    const tabs = await fetchVenueTabs("brand-1");
    expect(captured.rpcs).toEqual([
      { fn: "biz_venue_tab_summaries", args: { p_brand_id: "brand-1" } },
    ]);
    // Carried through verbatim. The client does not add the three parts up: the
    // RPC excludes a tab's own settlement row from that sum by the same
    // predicate `biz_venue_tab_close` bills with, and re-deriving it here is
    // how a tab gets counted twice.
    expect(tabs[0].outstandingTotalCents).toBe(5600);
    expect(tabs[0].outstandingTipCents).toBe(200);
    expect(tabs[0].roundCount).toBe(3);
  });

  test("T-TABS2 — an unknown tab state is read as `open`, never invented", async () => {
    rpcResult = { tabs: [{ sessionId: "s", tabState: "closed" }] };
    const tabs = await fetchVenueTabs("brand-1");
    // Only `open` and `settling` are ever returned; anything else falls to the
    // conservative reading — the tab is still live and still the waiter's.
    expect(tabs[0].tabState).toBe("open");
    rpcResult = { tabs: [{ sessionId: "s", tabState: "settling" }] };
    expect((await fetchVenueTabs("brand-1"))[0].tabState).toBe("settling");
  });

  test("T-TABS3 — tabs carry the SAME 30-second poll floor the queue does", () => {
    const opts = venueTabsQueryOptions("brand-1");
    expect(opts.refetchInterval).toBe(30_000);
    expect(VENUE_TABS_POLL_MS).toBe(30_000);
    expect(opts.staleTime).toBe(VENUE_TABS_STALE_MS);
    expect(opts.staleTime).toBeLessThan(opts.refetchInterval);
    expect(opts.queryKey).toEqual(venueTabKeys.list("brand-1"));

    useVenueTabs("brand-1");
    expect(captured.queries[0].refetchInterval).toBe(30_000);
    // ...and the disabled branch keeps it, so a mount before auth resolves does
    // not ship a no-poll tab list.
    authReady = false;
    captured.queries = [];
    useVenueTabs("brand-1");
    expect(captured.queries[0].enabled).toBe(false);
    expect(captured.queries[0].refetchInterval).toBe(30_000);
  });

  test("T-TABS4 — open and close ride venue-order-staff, not a direct write", async () => {
    invokeResult = { kind: "tab_opened", tabState: "open" };
    useOpenVenueTab("brand-1");
    await lastMutationFn()({ sessionId: "session-1" } as never);
    expect(captured.invokes[0]).toEqual({
      fn: "venue-order-staff",
      body: { action: "tab_open", sessionId: "session-1" },
    });

    captured.invokes = [];
    invokeResult = {
      kind: "requires_paystack_redirect",
      authorizationUrl: "https://pay.example/x",
      orderId: "order-9",
      totalCents: 5600,
      currency: "NGN",
    };
    useCloseVenueTab("brand-1");
    const closed = await lastMutationFn()({
      sessionId: "session-1",
      method: "bill_to_phone",
      buyer: { name: "Amara", email: "a@b.co", phone: "07700900123" },
    } as never);
    expect(captured.invokes[0].body).toEqual({
      action: "tab_close",
      sessionId: "session-1",
      settlementMethod: "bill_to_phone",
      buyer: { name: "Amara", email: "a@b.co", phone: "07700900123" },
    });
    // The bill the waiter hands over comes back from the server; the client
    // never composes a payment URL.
    expect(closed.authorizationUrl).toBe("https://pay.example/x");
    expect(closed.orderId).toBe("order-9");
  });

  test("T-TABS5 — nothing reads tabs before auth is ready", () => {
    authReady = false;
    useVenueTabs("brand-1");
    expect(captured.queries[0].enabled).toBe(false);
    expect(captured.rpcs).toHaveLength(0);
    captured.queries = [];
    authReady = true;
    useVenueTabs(null);
    expect(captured.queries[0].enabled).toBe(false);
  });
});
