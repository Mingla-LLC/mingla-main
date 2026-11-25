/**
 * #4490 spec 08 O5 fix 2 (O5-B2): the stock shown on the Till's tiles and in the
 * Menu comes back from the server after every action that changes stock.
 *
 * The Till's catalog read and the Menu's stock read are seeded in a real query
 * cache; each action is then run through the real hooks and the reads must be
 * marked stale (so they refetch). A held round, a payment refusal that is not
 * about stock and a failed write that is not item_sold_out change nothing.
 *
 * Fails on revert: without `stockWrite` / `refreshStockReads` in useTillActions
 * (or in the Menu stock section) the reads stay fresh and the tile keeps the old
 * count ("2 LEFT" while the database says 0).
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillStockRefresh.issue4490.o5fix2
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: { bezier: () => () => 0, linear: () => 0, out: (fn: unknown) => fn, inOut: (fn: unknown) => fn, ease: () => 0, in: (fn: unknown) => fn, cubic: () => 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withRepeat: (value: unknown) => value,
    withDelay: (_d: unknown, value: unknown) => value,
  };
});
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-linear-gradient", () => {
  const RN = jest.requireActual("react-native");
  return { LinearGradient: RN.View };
});
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn(), auth: {}, channel: jest.fn(), removeChannel: jest.fn() },
}));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
const mockSale = { id: "s1", version: 3 };
jest.mock("../../../../services/venueTillService", () => {
  const actual = jest.requireActual("../../../../services/venueTillService");
  return {
    ...actual,
    sendTill: jest.fn(),
    addTillMenu: jest.fn(),
    voidTillLine: jest.fn(),
    payTill: jest.fn(),
    refundTill: jest.fn(),
    openTillCheck: jest.fn(),
  };
});
const mockSetStock = jest.fn();
jest.mock("../../../../services/venueStockService", () => {
  const actual = jest.requireActual("../../../../services/venueStockService");
  return { ...actual, setMenuItemStock: (...a: unknown[]) => mockSetStock(...a) };
});

import * as till from "../../../../services/venueTillService";
import { useTillActions, venueTillKeys } from "../../../../hooks/useVenueTill";
import { menuStockKey } from "../../../../hooks/useMenuStock";
import { MenuItemStockSection } from "../../stock/MenuItemStockSection";

const VENUE = "00000000-4490-4000-8000-0000000005b2";
const BRAND = "00000000-4490-4000-8000-0000000005b1";

type Actions = ReturnType<typeof useTillActions>;
function Harness({ sink }: { sink: { current: Actions | null } }): null {
  sink.current = useTillActions(VENUE);
  return null;
}

function seed(client: QueryClient): void {
  client.setQueryData(venueTillKeys.catalog(VENUE), { menus: [{ items: [{ id: "i1", stockLeft: 2 }] }] });
  client.setQueryData(menuStockKey(BRAND, VENUE), new Map([["i1", { stockCount: 2, warnAt: 1, outAt: null }]]));
}
const stale = (client: QueryClient, key: readonly unknown[]): boolean => client.getQueryState(key)?.isInvalidated === true;
const catalogStale = (c: QueryClient): boolean => stale(c, venueTillKeys.catalog(VENUE));
const menuStale = (c: QueryClient): boolean => stale(c, menuStockKey(BRAND, VENUE));

async function mount(): Promise<{ client: QueryClient; tree: RenderTree; actions: Actions }> {
  const sink: { current: Actions | null } = { current: null };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  seed(client);
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}><Harness sink={sink} /></QueryClientProvider>,
    );
  });
  return { client, tree: tree as unknown as RenderTree, actions: sink.current as Actions };
}

const done = async (fn: () => Promise<unknown>): Promise<void> => {
  await TestRenderer.act(async () => {
    await fn();
  });
};
const soldOut = (): Error => Object.assign(new till.TillError("item_sold_out", "Suya"), { stockLeft: 0 });

const m = <T,>(fn: unknown): jest.Mock<Promise<T>> => fn as jest.Mock<Promise<T>>;

describe("O5-B2 stock reads come back from the server after every stock change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    m(till.sendTill).mockResolvedValue(mockSale as never);
    m(till.addTillMenu).mockResolvedValue(mockSale as never);
    m(till.voidTillLine).mockResolvedValue(mockSale as never);
    m(till.refundTill).mockResolvedValue(mockSale as never);
    m(till.payTill).mockResolvedValue({ sale: mockSale, paymentId: "p1" } as never);
    mockSetStock.mockResolvedValue({});
  });

  test("a send marks the Till tiles and the Menu counts stale", async () => {
    const { client, actions } = await mount();
    expect(catalogStale(client)).toBe(false);
    await done(() => actions.send.mutateAsync({ saleId: "s1" }));
    expect(catalogStale(client)).toBe(true);
    expect(menuStale(client)).toBe(true);
  });

  test("a round added with send takes stock (stale); a held round does not", async () => {
    const held = await mount();
    await done(() => held.actions.addMenu.mutateAsync({ saleId: "s1", lines: [], send: false, idempotencyKey: "k", expectedVersion: 1 }));
    expect(catalogStale(held.client)).toBe(false);
    const sent = await mount();
    await done(() => sent.actions.addMenu.mutateAsync({ saleId: "s1", lines: [], send: true, idempotencyKey: "k", expectedVersion: 1 }));
    expect(catalogStale(sent.client)).toBe(true);
  });

  test("pay-that-sends (T8) marks the reads stale", async () => {
    const { client, actions } = await mount();
    await done(() => actions.pay.mutateAsync({
      saleId: "s1", method: "cash", amountMinor: 1, tipMinor: 0, cashGivenMinor: 1, clientRequestId: "r", expectedVersion: 1,
    }));
    expect(catalogStale(client)).toBe(true);
    expect(menuStale(client)).toBe(true);
  });

  test("a void marks the reads stale, with put back in stock on or off", async () => {
    for (const restock of [true, false]) {
      const { client, actions } = await mount();
      await done(() => actions.voidLine.mutateAsync({ saleId: "s1", lineId: "l1", orderItemId: null, reason: "x", restock, expectedVersion: 1 }));
      expect({ restock, stale: catalogStale(client) }).toEqual({ restock, stale: true });
    }
  });

  test("a refund that puts stock back marks the reads stale; one that does not, does not", async () => {
    const back = await mount();
    await done(() => back.actions.refund.mutateAsync({ paymentId: "p", amountMinor: 1, tipMinor: 0, reason: "x", restock: true, clientRequestId: "r" }));
    expect(catalogStale(back.client)).toBe(true);
    const plain = await mount();
    await done(() => plain.actions.refund.mutateAsync({ paymentId: "p", amountMinor: 1, tipMinor: 0, reason: "x", restock: false, clientRequestId: "r" }));
    expect(catalogStale(plain.client)).toBe(false);
  });

  test("a refused send (item_sold_out) means the count was stale: refetch, and the refusal still reaches the screen", async () => {
    const { client, actions } = await mount();
    m(till.sendTill).mockRejectedValue(soldOut());
    let thrown: unknown = null;
    await done(async () => {
      try {
        await actions.send.mutateAsync({ saleId: "s1" });
      } catch (err) {
        thrown = err;
      }
    });
    expect((thrown as { code?: string }).code).toBe("item_sold_out");
    expect(catalogStale(client)).toBe(true);
    expect(menuStale(client)).toBe(true);
  });

  test("a refused round and a refused payment about stock refetch too; another refusal does not", async () => {
    const a = await mount();
    m(till.addTillMenu).mockRejectedValue(soldOut());
    await done(async () => { await a.actions.addMenu.mutateAsync({ saleId: "s1", lines: [], send: true, idempotencyKey: "k", expectedVersion: 1 }).catch(() => undefined); });
    expect(catalogStale(a.client)).toBe(true);
    const b = await mount();
    m(till.payTill).mockRejectedValue(soldOut());
    await done(async () => { await b.actions.pay.mutateAsync({
      saleId: "s1", method: "cash", amountMinor: 1, tipMinor: 0, cashGivenMinor: 1, clientRequestId: "r", expectedVersion: 1 }).catch(() => undefined); });
    expect(catalogStale(b.client)).toBe(true);
    const c = await mount();
    m(till.sendTill).mockRejectedValue(new till.TillError("till_check_changed"));
    await done(async () => { await c.actions.send.mutateAsync({ saleId: "s1" }).catch(() => undefined); });
    expect(catalogStale(c.client)).toBe(false);
  });

  test("a restock saved from the Menu marks the Till tiles stale at once", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    seed(client);
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <QueryClientProvider client={client}>
          <MenuItemStockSection brandId={BRAND} venueId={VENUE} menuItemId="i1" stockCount={0} stockWarnAt={1} stockOutAt={null}
            canMutate formatTime={(iso) => iso} />
        </QueryClientProvider>,
      );
    });
    const root = (tree as unknown as RenderTree).root;
    const count = root.findAll((n) => n.props.testID === "menu-item-stock-count" && typeof n.props.onChange === "function")[0];
    await TestRenderer.act(async () => { (count.props.onChange as (n: number) => void)(5); });
    const save = root.findAll((n) => n.props.testID === "menu-item-stock-save" && typeof n.props.onPress === "function")[0];
    expect(catalogStale(client)).toBe(false);
    await TestRenderer.act(async () => { (save.props.onPress as () => void)(); });
    expect(mockSetStock).toHaveBeenCalledWith(expect.objectContaining({ venueId: VENUE, menuItemId: "i1", count: 5 }));
    expect(catalogStale(client)).toBe(true);
    expect(menuStale(client)).toBe(true);
  });
});
