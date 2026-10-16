/**
 * Issue #3645 — tester RETEST 2 of "one owner for a draft's currency".
 *
 * Retest 1 failed the rework on one defect: with a draft wizard left open
 * while the brand's currency changed, the screen never stopped saving. The
 * second rework gives the answer "what currency is this draft in on the
 * server" one owner (utils/draftServerCurrency) and makes a wizard save follow
 * the row it just read.
 *
 * This suite attacks that owner from angles the implementor's loop suite does
 * not take. It mounts the REAL pieces a draft route mounts (the draft store,
 * `useDraftFollowsBrandCurrency`, `useServerDraftAutosave`,
 * `autosaveServerDraft`) against an in-memory server that holds SEVERAL
 * drafts of SEVERAL brands and whose answers can be held back, fail, or
 * arrive late.
 *
 *   A. The shared answer itself: keyed per draft, newest wins, listeners.
 *   B. Two drafts of two brands, open at once and one after the other: one
 *      draft's currency never reaches the other.
 *   C. A slow open-time read that returns AFTER a faster save result.
 *   D. A failed save, an offline spell, rapid typing, an unmount while the
 *      open-time read is still in flight.
 *   E. Before the migration is applied (the web ships first): the brand's
 *      currency changes and NOTHING moves the draft row. The draft stays as it
 *      is and saves normally: no notice, no loop, no price lost. The same
 *      holds for a draft the database trigger skipped.
 *   F. Property-style: 4 seeds x 500 random turns (edits, typed prices, brand
 *      currency changes, held and failed reads, failed saves, remounts). No
 *      accepted save ever changes the currency of a row that has one, no
 *      number is ever stored under a currency it was not typed in, the saves
 *      are bounded by what the host and the server did, and once everything
 *      is released the screen comes to rest in the server's currency.
 *
 * Verified to fail against the product files of 0b8b72b7d (the retest-1 head):
 * see the tester's report on issue #3645.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    authStatus: "signed_in",
    isAuthReady: true,
    session: { user: { id: "user-1" }, access_token: "t" },
    user: { id: "user-1" },
  }),
}));

jest.mock("../../utils/authReadiness", () => ({
  requireBusinessAuthReady: () => undefined,
  isBusinessAuthNotReadyError: () => false,
}));

const mockFrom = jest.fn();
const mockRpc = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();
jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  buildDraftEvent,
  useDraftById,
  useDraftEventStore,
  type DraftEvent,
  type TicketStub,
} from "../../store/draftEventStore";
import { useServerDraftAutosave } from "../../hooks/useServerDraftEvents";
import { useDraftFollowsBrandCurrency } from "../../hooks/useDraftFollowsBrandCurrency";
import { resetPricesClearedNotesForTest } from "../../utils/draftPricesClearedNote";
import * as draftServerCurrency from "../../utils/draftServerCurrency";

// react-test-renderer ships no type declarations in this package.
interface Rendered {
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const BRAND_A = "00000000-0000-4000-8000-0000000a3645";
const BRAND_B = "00000000-0000-4000-8000-0000000b3645";
let draftSeq = 0;
// A new draft id per test: the autosave hook and the shared answer are module
// state that outlives a mount.
const nextDraftId = (): string => {
  draftSeq += 1;
  return `00000000-0000-4000-8200-${String(draftSeq).padStart(12, "0")}`;
};

const ticket = (patch: Partial<TicketStub>): TicketStub =>
  ({
    id: "t_paid",
    name: "General",
    priceGbp: 50,
    capacity: 100,
    isFree: false,
    isUnlimited: false,
    visibility: "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    waitlistEnabled: false,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    allowTransfers: true,
    description: null,
    ...patch,
  }) as TicketStub;

const localDraft = (brandId: string, id: string, patch: Partial<DraftEvent>): DraftEvent => ({
  ...buildDraftEvent(brandId, id, "2026-10-01T10:00:00.000Z"),
  name: "Lagos launch",
  ...patch,
});

// ─── The in-memory server: several drafts, several brands ────────────────────
type Kind = "event" | "rsvp";

interface SaveRecord {
  rpc: string;
  /** The currency the row held when this save arrived. */
  rowCurrencyBefore: string | null;
  currency: string | null;
  businessDraft: Record<string, unknown>;
}

interface FakeDraft {
  draftId: string;
  brandId: string;
  kind: Kind;
  title: string;
  rowCurrency: string | null;
  businessDraft: Record<string, unknown>;
  suggestedCents: number | null;
  minCents: number | null;
  /** True = the brands trigger leaves this draft alone (or does not exist yet). */
  notMovedByServer: boolean;
  saves: SaveRecord[];
  refusedSaves: number;
  failedSaves: number;
}

interface Network {
  /** Every request fails. */
  offline: boolean;
  /** The next N reads that carry the brand fail. */
  failBrandReads: number;
  /** The next N saves fail with a transport error (nothing is written). */
  failSaves: number;
  /** Reads that carry the brand are answered later, with what was true WHEN ASKED. */
  holdBrandReads: boolean;
  held: (() => void)[];
  brandReads: number;
}

const brandCurrency = new Map<string, string | null>();
const drafts = new Map<string, FakeDraft>();
let net: Network;
// A circuit breaker for the tests only: a client that never stops saving would
// never let a test finish. Saves past this limit hang.
let SAVE_STORM_LIMIT = 40;

const serverRow = (d: FakeDraft): Record<string, unknown> => ({
  id: d.draftId,
  brand_id: d.brandId,
  created_by: "user-1",
  title: d.title,
  description: null,
  slug: "lagos-launch",
  event_type: d.kind,
  currency: d.rowCurrency,
  theme: { business_draft: d.businessDraft },
  rsvp_contribution_enabled: d.kind === "rsvp",
  rsvp_contribution_suggested_cents: d.suggestedCents,
  rsvp_contribution_min_cents: d.minCents,
  visibility: "draft",
  status: "draft",
  timezone: "Africa/Lagos",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  published_at: null,
  deleted_at: null,
});

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const transportError = (): Error => new Error("Network request failed");

const installServer = (): void => {
  mockFrom.mockImplementation((table: unknown) => {
    if (table !== "events") throw new Error(`unexpected table read: ${String(table)}`);
    let columns = "";
    let id = "";
    const builder: Record<string, unknown> = {};
    for (const method of ["in", "is", "order", "limit"]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.eq = jest.fn((column: unknown, value: unknown) => {
      if (column === "id") id = String(value);
      return builder;
    });
    builder.select = jest.fn((cols: unknown) => {
      columns = String(cols);
      return builder;
    });
    builder.maybeSingle = jest.fn(() => {
      const d = drafts.get(id);
      if (d === undefined) return Promise.resolve({ data: null, error: null });
      const wantsBrand = columns.includes("brand:brands");
      if (net.offline) return Promise.resolve({ data: null, error: transportError() });
      if (!wantsBrand) return Promise.resolve({ data: serverRow(d), error: null });
      net.brandReads += 1;
      if (net.failBrandReads > 0) {
        net.failBrandReads -= 1;
        return Promise.resolve({ data: null, error: transportError() });
      }
      // What the database answers is what is true when the read RUNS.
      const answer = {
        data: { ...serverRow(d), brand: { default_currency: brandCurrency.get(d.brandId) ?? null } },
        error: null,
      };
      if (!net.holdBrandReads) return Promise.resolve(answer);
      return new Promise((resolve) => {
        net.held.push(() => resolve(answer));
      });
    });
    return builder;
  });
  mockRpc.mockImplementation((name: unknown, args: unknown) => {
    const rpc = String(name);
    const { p_event_id, p_payload, p_client_revision } = args as {
      p_event_id: string;
      p_payload: {
        title?: string;
        currency: string | null;
        theme: { business_draft: Record<string, unknown> };
      };
      p_client_revision?: number;
    };
    const d = drafts.get(p_event_id);
    if (d === undefined) return Promise.reject(new Error(`unknown draft ${p_event_id}`));
    if (net.offline) return Promise.resolve({ data: null, error: transportError() });
    if (net.failSaves > 0) {
      net.failSaves -= 1;
      d.failedSaves += 1;
      return Promise.resolve({ data: null, error: transportError() });
    }
    if (d.saves.length >= SAVE_STORM_LIMIT) return new Promise(() => undefined);
    const rowCurrencyBefore = d.rowCurrency;
    if (rpc === "business_update_event_draft") {
      const stored = Number(d.businessDraft.clientRevision ?? 0);
      // business_update_event_draft: an older revision is refused.
      if (typeof p_client_revision === "number" && p_client_revision < stored) {
        d.refusedSaves += 1;
        return Promise.resolve({ data: null, error: { message: "stale_client_revision" } });
      }
      // The event draft owner REPLACES the draft JSON.
      d.businessDraft = { ...p_payload.theme.business_draft };
      if (typeof p_client_revision === "number") {
        d.businessDraft.clientRevision = p_client_revision;
      }
    } else if (rpc === "business_update_rsvp_graph") {
      // The RSVP draft owner MERGES it, and mirrors the amounts to columns.
      d.businessDraft = { ...d.businessDraft, ...p_payload.theme.business_draft };
      d.suggestedCents = numberOrNull(d.businessDraft.rsvpContributionSuggestedCents);
      d.minCents = numberOrNull(d.businessDraft.rsvpContributionMinCents);
    } else {
      return Promise.reject(new Error(`unexpected rpc: ${rpc}`));
    }
    if (typeof p_payload.title === "string") d.title = p_payload.title;
    d.rowCurrency = p_payload.currency;
    d.saves.push({
      rpc,
      rowCurrencyBefore,
      currency: d.rowCurrency,
      businessDraft: d.businessDraft,
    });
    return Promise.resolve({ data: { event: serverRow(d) }, error: null });
  });
};

/**
 * The brand's currency changes. For each of the brand's drafts with nothing
 * sold the brands trigger of migration 20270829003645 moves the row and clears
 * its paid prices; a draft marked `notMovedByServer` is left as it is.
 */
const serverChangesBrandCurrency = (brandId: string, to: string): void => {
  const before = brandCurrency.get(brandId) ?? null;
  brandCurrency.set(brandId, to);
  if (before === to) return;
  for (const d of drafts.values()) {
    if (d.brandId !== brandId || d.notMovedByServer) continue;
    const from = d.rowCurrency;
    if (from === to) continue;
    const tickets = (d.businessDraft.tickets as TicketStub[] | undefined) ?? [];
    const hadPrice =
      from !== null &&
      (tickets.some((t) => !t.isFree && t.priceGbp !== null) ||
        d.suggestedCents !== null ||
        d.minCents !== null);
    d.rowCurrency = to;
    d.businessDraft = {
      ...d.businessDraft,
      currency: to,
      ...(from === null
        ? {}
        : {
            tickets: tickets.map((t) =>
              t.isFree ? t : { ...t, priceGbp: null, currency: to },
            ),
            rsvpContributionSuggestedCents: null,
            rsvpContributionMinCents: null,
          }),
      ...(hadPrice ? { pricesClearedForCurrencyChange: { from, to } } : {}),
    };
    if (from !== null) {
      d.suggestedCents = null;
      d.minCents = null;
    }
  }
};

const addDraft = (
  patch: Partial<FakeDraft> & { draftId: string; brandId: string; rowCurrency: string | null },
): FakeDraft => {
  const d: FakeDraft = {
    kind: "event",
    title: "Lagos launch",
    businessDraft: { clientRevision: 3, currency: patch.rowCurrency, tickets: [] },
    suggestedCents: null,
    minCents: null,
    notMovedByServer: false,
    saves: [],
    refusedSaves: 0,
    failedSaves: 0,
    ...patch,
  };
  drafts.set(d.draftId, d);
  return d;
};

const savedTicketPrice = (bd: Record<string, unknown>): unknown =>
  ((bd.tickets as { id: string; priceGbp: unknown }[] | undefined) ?? []).find(
    (t) => t.id === "t_paid",
  )?.priceGbp;

// ─── The route, reduced to its real parts ────────────────────────────────────
interface Mounted {
  notices: string[];
  edit: (patch: Partial<DraftEvent>) => void;
  draft: () => DraftEvent | null;
  unmount: () => Promise<void>;
}

const settle = async (turns: number): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

const mountRoute = async (
  draftId: string,
  cachedBrandCurrency: string | null,
  settleTurns = 40,
): Promise<Mounted> => {
  const notices: string[] = [];
  let save: (d: DraftEvent) => void = () => undefined;
  const Route = (): null => {
    // Exactly what app/event/[id]/edit.tsx and app/rsvp/[id]/edit.tsx mount.
    const brandCurrencyRef = React.useRef<string | null>(null);
    const autosave = useServerDraftAutosave({ brandCurrencyRef });
    const draft = useDraftById(draftId);
    brandCurrencyRef.current = cachedBrandCurrency;
    const onNotice = React.useCallback((message: string): void => {
      notices.push(message);
    }, []);
    save = autosave.saveDraft;
    // The pre-rework hook also took the brand currency this device holds. The
    // current one ignores it. Passing it lets this file run against both.
    const followInput = {
      draft,
      brandCurrency: cachedBrandCurrency,
      onSave: autosave.saveDraft,
      onNotice,
    };
    useDraftFollowsBrandCurrency(
      followInput as Parameters<typeof useDraftFollowsBrandCurrency>[0],
    );
    return null;
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let renderer: Rendered | null = null;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Route)),
    );
  });
  await settle(settleTurns);
  return {
    notices,
    draft: () => useDraftEventStore.getState().getDraft(draftId),
    edit: (patch) => {
      const store = useDraftEventStore.getState();
      const current = store.getDraft(draftId);
      if (current === null) throw new Error("no draft to edit");
      const revision = (current.clientRevision ?? 0) + 1;
      store.markDraftDirty(draftId, revision);
      store.updateDraft(draftId, { ...patch, clientRevision: revision });
      const fresh = useDraftEventStore.getState().getDraft(draftId);
      if (fresh !== null) save(fresh);
    },
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      queryClient.clear();
    },
  };
};

const releaseHeld = async (): Promise<void> => {
  const held = net.held;
  net.held = [];
  await act(async () => {
    held.forEach((release) => release());
  });
};

const resetSharedAnswer = (): void => {
  // The shared answer did not exist before the second rework; run against the
  // older product files this suite must still load.
  (draftServerCurrency as { resetDraftServerCurrencyForTest?: () => void })
    .resetDraftServerCurrencyForTest?.();
};

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  resetPricesClearedNotesForTest();
  resetSharedAnswer();
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {}, activeDraftId: null });
  brandCurrency.clear();
  drafts.clear();
  SAVE_STORM_LIMIT = 40;
  net = {
    offline: false,
    failBrandReads: 0,
    failSaves: 0,
    holdBrandReads: false,
    held: [],
    brandReads: 0,
  };
  installServer();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const NAME: Record<string, string> = {
  NGN: "Nigerian naira",
  GBP: "British pounds",
  USD: "US dollars",
};
const notice = (currency: string): string =>
  `Your brand now sells in ${NAME[currency]}. Enter your prices again.`;

/** One priced event draft, on the server and on this device, in `currency`. */
const seedEvent = (brandId: string, currency: string, price = 50): string => {
  const id = nextDraftId();
  const priced = ticket({ priceGbp: price, currency });
  if (!brandCurrency.has(brandId)) brandCurrency.set(brandId, currency);
  addDraft({
    draftId: id,
    brandId,
    rowCurrency: currency,
    businessDraft: { clientRevision: 3, currency, tickets: [priced] },
  });
  useDraftEventStore
    .getState()
    .upsertServerDraft(localDraft(brandId, id, { currency, tickets: [priced], clientRevision: 3 }));
  return id;
};

const seedRsvp = (brandId: string, currency: string): string => {
  const id = nextDraftId();
  if (!brandCurrency.has(brandId)) brandCurrency.set(brandId, currency);
  const json = {
    isRsvp: true,
    tickets: [],
    rsvpContributionEnabled: true,
    rsvpContributionSuggestedCents: 1500,
    rsvpContributionMinCents: 500,
  };
  addDraft({
    draftId: id,
    brandId,
    kind: "rsvp",
    rowCurrency: currency,
    businessDraft: { clientRevision: 3, currency, ...json },
    suggestedCents: 1500,
    minCents: 500,
  });
  useDraftEventStore
    .getState()
    .upsertServerDraft(localDraft(brandId, id, { currency, clientRevision: 3, ...json }));
  return id;
};

// ─── A. The shared answer itself ─────────────────────────────────────────────
describe("#3645 retest 2: the one shared answer", () => {
  const {
    getDraftServerCurrency,
    nextDraftServerCurrencyStamp,
    setDraftServerCurrency,
    subscribeDraftServerCurrency,
  } = draftServerCurrency;

  test("is kept per draft: one draft's answer is never another draft's", () => {
    setDraftServerCurrency("draft-of-brand-a", "NGN", 100);
    expect(getDraftServerCurrency("draft-of-brand-a")).toBe("NGN");
    expect(getDraftServerCurrency("draft-of-brand-b")).toBeUndefined();
    setDraftServerCurrency("draft-of-brand-b", "gbp ", 101);
    expect(getDraftServerCurrency("draft-of-brand-a")).toBe("NGN");
    expect(getDraftServerCurrency("draft-of-brand-b")).toBe("GBP");
    // "No currency" is an answer of its own, not "nothing known".
    setDraftServerCurrency("draft-of-brand-b", "   ", 102);
    expect(getDraftServerCurrency("draft-of-brand-b")).toBeNull();
    expect(getDraftServerCurrency("draft-of-brand-a")).toBe("NGN");
  });

  test("an answer asked for EARLIER never replaces one received later, in any arrival order", () => {
    // A save result received at 200, then the open-time read asked at 100
    // arrives (slow network): the read is ignored.
    setDraftServerCurrency("d", "NGN", 200);
    setDraftServerCurrency("d", "GBP", 100);
    expect(getDraftServerCurrency("d")).toBe("NGN");
    // Every arrival order of five answers ends on the newest one.
    const stamps = [5, 1, 4, 2, 3];
    const orders: number[][] = [];
    const permute = (rest: number[], done: number[]): void => {
      if (rest.length === 0) {
        orders.push(done);
        return;
      }
      rest.forEach((value, index) =>
        permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...done, value]),
      );
    };
    permute(stamps, []);
    expect(orders).toHaveLength(120);
    orders.forEach((order, index) => {
      const id = `order-${index}`;
      order.forEach((at) => setDraftServerCurrency(id, at === 5 ? "USD" : `X${at}`, at));
      expect(getDraftServerCurrency(id)).toBe("USD");
    });
  });

  test("a later save outranks an earlier read when the wall clock does not tick", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const readAskedAt = nextDraftServerCurrencyStamp();
      setDraftServerCurrency("same-millisecond", "NGN");
      setDraftServerCurrency("same-millisecond", "GBP", readAskedAt);
      expect(getDraftServerCurrency("same-millisecond")).toBe("NGN");
    } finally {
      now.mockRestore();
    }
  });

  test("listeners hear a change once, not a repeat, and not after they leave", () => {
    let heard = 0;
    const leave = subscribeDraftServerCurrency(() => {
      heard += 1;
    });
    setDraftServerCurrency("l", "GBP", 1);
    setDraftServerCurrency("l", "GBP", 2); // the same answer again
    setDraftServerCurrency("l", "NGN", 1); // older: ignored
    expect(heard).toBe(1);
    setDraftServerCurrency("l", "NGN", 3);
    expect(heard).toBe(2);
    leave();
    setDraftServerCurrency("l", "USD", 4);
    expect(heard).toBe(2);
    expect(getDraftServerCurrency("l")).toBe("USD");
  });
});

// ─── B. Two drafts, two brands ───────────────────────────────────────────────
describe("#3645 retest 2: two drafts of two brands", () => {
  test("open at once: brand A changes currency; A's draft moves and settles, B's draft is not touched", async () => {
    const a = seedEvent(BRAND_A, "GBP", 50);
    brandCurrency.set(BRAND_B, "USD");
    const b = seedEvent(BRAND_B, "USD", 80);
    const routeA = await mountRoute(a, "GBP");
    const routeB = await mountRoute(b, "USD");
    expect(drafts.get(a)?.saves).toHaveLength(0);
    expect(drafts.get(b)?.saves).toHaveLength(0);

    serverChangesBrandCurrency(BRAND_A, "NGN");
    routeA.edit({ name: "A, typed after the change" });
    routeB.edit({ name: "B, typed at the same moment" });
    await settle(120);

    const serverA = drafts.get(a) as FakeDraft;
    const serverB = drafts.get(b) as FakeDraft;
    // A: moved, cleared, told once, at rest.
    expect(serverA.saves.length).toBeGreaterThanOrEqual(1);
    expect(serverA.saves.length).toBeLessThanOrEqual(3);
    expect(serverA.saves.every((s) => s.currency === "NGN")).toBe(true);
    expect(routeA.draft()?.currency).toBe("NGN");
    expect(routeA.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(routeA.notices).toEqual([notice("NGN")]);
    // B: one ordinary save, its own currency, its price intact, no notice.
    expect(serverB.saves).toHaveLength(1);
    expect(serverB.saves[0]?.currency).toBe("USD");
    expect(savedTicketPrice(serverB.businessDraft)).toBe(80);
    expect(routeB.draft()?.currency).toBe("USD");
    expect(routeB.draft()?.tickets[0]?.priceGbp).toBe(80);
    expect(routeB.notices).toEqual([]);
    expect(JSON.stringify(serverB.saves)).not.toContain("NGN");
    // The shared answer holds each draft's own currency.
    expect(draftServerCurrency.getDraftServerCurrency(a)).toBe("NGN");
    expect(draftServerCurrency.getDraftServerCurrency(b)).toBe("USD");

    const restA = serverA.saves.length;
    await settle(40);
    expect(serverA.saves).toHaveLength(restA);
    expect(serverB.saves).toHaveLength(1);
    await routeA.unmount();
    await routeB.unmount();
  });

  test("one after the other: a draft moved to naira, then another brand's pound draft is opened and edited untouched", async () => {
    const a = seedEvent(BRAND_A, "GBP", 50);
    brandCurrency.set(BRAND_B, "GBP");
    const b = seedEvent(BRAND_B, "GBP", 65);
    const routeA = await mountRoute(a, "GBP");
    serverChangesBrandCurrency(BRAND_A, "NGN");
    routeA.edit({ name: "A after the change" });
    await settle(120);
    expect(routeA.draft()?.currency).toBe("NGN");
    await routeA.unmount();

    const routeB = await mountRoute(b, "GBP");
    expect(drafts.get(b)?.saves).toHaveLength(0);
    expect(routeB.notices).toEqual([]);
    routeB.edit({ name: "B, another brand" });
    await settle(60);
    const serverB = drafts.get(b) as FakeDraft;
    expect(serverB.saves).toHaveLength(1);
    expect(serverB.rowCurrency).toBe("GBP");
    expect(savedTicketPrice(serverB.businessDraft)).toBe(65);
    expect(routeB.draft()?.tickets[0]?.priceGbp).toBe(65);
    expect(routeB.notices).toEqual([]);
    await routeB.unmount();
  });
});

// ─── C. A slow open-time read against a faster save ──────────────────────────
describe("#3645 retest 2: the open-time read returns after a save result", () => {
  for (const kind of ["event", "rsvp"] as const) {
    for (const [from, to] of [
      ["GBP", "NGN"],
      ["NGN", "GBP"],
    ] as const) {
      test(`${kind}, ${from} to ${to}: the late, older answer does not move the draft back`, async () => {
        const id = kind === "event" ? seedEvent(BRAND_A, from, 50) : seedRsvp(BRAND_A, from);
        // The read made when the draft opens is answered (with what is true
        // NOW: the old currency) but its response is slow.
        net.holdBrandReads = true;
        const route = await mountRoute(id, from);
        expect(net.held).toHaveLength(1);
        net.holdBrandReads = false;

        serverChangesBrandCurrency(BRAND_A, to);
        route.edit({ name: "Typed after coming back" });
        await settle(80);
        const server = drafts.get(id) as FakeDraft;
        const savesBeforeLateAnswer = server.saves.length;
        expect(savesBeforeLateAnswer).toBeGreaterThanOrEqual(1);
        expect(route.draft()?.currency).toBe(to);

        // Now the open-time answer arrives, saying the OLD currency.
        await releaseHeld();
        await settle(120);

        expect(route.draft()?.currency).toBe(to);
        expect(server.rowCurrency).toBe(to);
        expect(server.saves).toHaveLength(savesBeforeLateAnswer);
        expect(server.saves.every((s) => s.currency === to)).toBe(true);
        expect(draftServerCurrency.getDraftServerCurrency(id)).toBe(to);
        if (kind === "event") {
          expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
          expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
        } else {
          expect(route.draft()?.rsvpContributionSuggestedCents).toBeNull();
          expect(route.draft()?.rsvpContributionMinCents).toBeNull();
          expect(JSON.stringify(server.saves)).not.toContain("1500");
        }
        expect(route.notices).toEqual([notice(to)]);
        await route.unmount();
      });
    }
  }
});

// ─── D. Failures, bursts, unmounts ───────────────────────────────────────────
describe("#3645 retest 2: wizard open across the change, under bad conditions", () => {
  for (const kind of ["event", "rsvp"] as const) {
    for (const [from, to] of [
      ["GBP", "NGN"],
      ["NGN", "GBP"],
    ] as const) {
      test(`${kind}, ${from} to ${to}: saves counted, at rest in ${to}, prices empty, one notice`, async () => {
        const id = kind === "event" ? seedEvent(BRAND_A, from, 50) : seedRsvp(BRAND_A, from);
        const route = await mountRoute(id, from);
        const server = drafts.get(id) as FakeDraft;
        expect(server.saves).toHaveLength(0);
        serverChangesBrandCurrency(BRAND_A, to);
        route.edit({ name: "Typed after coming back" });
        await settle(200);

        // Counted: the host's edit, and at most the resolution of the note.
        expect(server.saves.length).toBeGreaterThanOrEqual(1);
        expect(server.saves.length).toBeLessThanOrEqual(3);
        // No save moved the row away from the currency it held.
        expect(server.saves.every((s) => s.currency === s.rowCurrencyBefore)).toBe(true);
        expect(server.saves.every((s) => s.businessDraft.currency === to)).toBe(true);
        expect(route.draft()?.currency).toBe(to);
        expect(route.draft()?.name).toBe("Typed after coming back");
        if (kind === "event") {
          expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
          expect(savedTicketPrice(server.businessDraft)).toBeNull();
        } else {
          expect(route.draft()?.rsvpContributionSuggestedCents).toBeNull();
          expect(server.suggestedCents).toBeNull();
          expect(server.minCents).toBeNull();
        }
        expect(route.notices).toEqual([notice(to)]);
        expect(server.businessDraft.pricesClearedForCurrencyChange ?? null).toBeNull();
        const rest = server.saves.length;
        await settle(80);
        expect(server.saves).toHaveLength(rest);
        await route.unmount();
      });
    }
  }

  test("a save that fails after the change writes nothing, clears nothing here, and the next edit settles in the new currency", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const route = await mountRoute(id, "GBP");
    const server = drafts.get(id) as FakeDraft;
    serverChangesBrandCurrency(BRAND_A, "NGN");
    net.failSaves = 1;
    route.edit({ name: "This save fails" });
    await settle(80);

    expect(server.failedSaves).toBe(1);
    expect(server.saves).toHaveLength(0);
    // Nothing was learnt, so nothing on this device was changed on a guess.
    expect(route.draft()?.currency).toBe("GBP");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(50);
    expect(route.notices).toEqual([]);
    // And it does not retry on its own without end.
    await settle(80);
    expect(server.failedSaves).toBe(1);

    route.edit({ name: "This save goes through" });
    await settle(160);
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.length).toBeLessThanOrEqual(3);
    expect(server.saves.every((s) => s.currency === "NGN")).toBe(true);
    expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(route.notices).toEqual([notice("NGN")]);
    const rest = server.saves.length;
    await settle(60);
    expect(server.saves).toHaveLength(rest);
    await route.unmount();
  });

  test("offline while the currency changes: nothing is cleared or saved on a guess; back online the draft settles", async () => {
    const id = seedEvent(BRAND_A, "NGN", 7000);
    const route = await mountRoute(id, "NGN");
    const server = drafts.get(id) as FakeDraft;
    net.offline = true;
    serverChangesBrandCurrency(BRAND_A, "GBP");
    route.edit({ name: "Typed in a tunnel" });
    route.edit({ name: "Typed in a tunnel, again" });
    await settle(120);

    expect(server.saves).toHaveLength(0);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    expect(route.draft()?.name).toBe("Typed in a tunnel, again");
    expect(route.notices).toEqual([]);

    net.offline = false;
    route.edit({ name: "Back online" });
    await settle(200);
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.length).toBeLessThanOrEqual(3);
    expect(server.saves.every((s) => s.currency === "GBP")).toBe(true);
    expect(JSON.stringify(server.saves)).not.toContain("7000");
    expect(route.draft()?.currency).toBe("GBP");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(route.draft()?.name).toBe("Back online");
    expect(route.notices).toEqual([notice("GBP")]);
    const rest = server.saves.length;
    await settle(60);
    expect(server.saves).toHaveLength(rest);
    await route.unmount();
  });

  test("twenty keystrokes fired across the change without waiting: bounded saves, none in the old currency, the last text kept", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const route = await mountRoute(id, "GBP");
    const server = drafts.get(id) as FakeDraft;
    for (let i = 0; i < 10; i += 1) route.edit({ name: `before ${i}` });
    await settle(2);
    const savesBeforeChange = server.saves.length;
    serverChangesBrandCurrency(BRAND_A, "NGN");
    for (let i = 0; i < 10; i += 1) route.edit({ name: `after ${i}` });
    await settle(240);

    const after = server.saves.slice(savesBeforeChange);
    // Never more than one save per keystroke plus the settling ones.
    expect(server.saves.length).toBeLessThanOrEqual(20 + 3);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after.every((s) => s.currency === "NGN")).toBe(true);
    expect(after.every((s) => savedTicketPrice(s.businessDraft) === null)).toBe(true);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.name).toBe("after 9");
    expect(server.title).toBe("after 9");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(route.notices).toEqual([notice("NGN")]);
    const rest = server.saves.length;
    await settle(80);
    expect(server.saves).toHaveLength(rest);
    await route.unmount();
  });

  test("the screen closes while the open-time read is in flight: the late answer changes nothing and saves nothing", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    net.holdBrandReads = true;
    const route = await mountRoute(id, "GBP");
    expect(net.held).toHaveLength(1);
    await route.unmount();
    serverChangesBrandCurrency(BRAND_A, "NGN");
    await releaseHeld();
    await settle(60);

    const server = drafts.get(id) as FakeDraft;
    expect(server.saves).toHaveLength(0);
    // The answer of a screen that is gone is not recorded.
    expect(draftServerCurrency.getDraftServerCurrency(id)).toBeUndefined();
    expect(useDraftEventStore.getState().getDraft(id)?.tickets[0]?.priceGbp).toBe(50);
    // No "state update on an unmounted component" and no unhandled rejection.
    const complaints = errorSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((message: string) => !message.includes("react-test-renderer is deprecated"));
    expect(complaints).toEqual([]);

    // Opened again, the draft is asked about afresh and moved once.
    net.holdBrandReads = false;
    const again = await mountRoute(id, "GBP");
    await settle(160);
    expect(again.draft()?.currency).toBe("NGN");
    expect(again.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(again.notices).toEqual([notice("NGN")]);
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.length).toBeLessThanOrEqual(2);
    expect(server.saves.every((s) => s.currency === "NGN")).toBe(true);
    await again.unmount();
  });
});

// ─── E. Nothing moves the row: before the migration, or a skipped draft ──────
describe("#3645 retest 2: the brand changes currency and the draft row is NOT moved (web ships before the migration; a draft the trigger skips)", () => {
  for (const [from, to] of [
    ["GBP", "NGN"],
    ["NGN", "GBP"],
  ] as const) {
    test(`${from} brand becomes ${to}, wizard open: the draft stays in ${from}, saves once per edit, keeps its price, no notice`, async () => {
      const id = seedEvent(BRAND_A, from, 50);
      (drafts.get(id) as FakeDraft).notMovedByServer = true;
      const route = await mountRoute(id, from);
      const server = drafts.get(id) as FakeDraft;
      serverChangesBrandCurrency(BRAND_A, to);
      expect(server.rowCurrency).toBe(from);

      route.edit({ name: "Edit one" });
      await settle(120);
      expect(server.saves).toHaveLength(1);
      route.edit({ name: "Edit two" });
      await settle(120);

      expect(server.saves).toHaveLength(2);
      expect(server.saves.every((s) => s.currency === from)).toBe(true);
      expect(server.saves.every((s) => savedTicketPrice(s.businessDraft) === 50)).toBe(true);
      expect(route.draft()?.currency).toBe(from);
      expect(route.draft()?.tickets[0]?.priceGbp).toBe(50);
      expect(route.notices).toEqual([]);
      await settle(80);
      expect(server.saves).toHaveLength(2);
      await route.unmount();
    });

    test(`${from} brand became ${to} before the draft is opened (even with the brand list on this device already saying ${to}): same result`, async () => {
      const id = seedEvent(BRAND_A, from, 50);
      (drafts.get(id) as FakeDraft).notMovedByServer = true;
      serverChangesBrandCurrency(BRAND_A, to);
      const route = await mountRoute(id, to);
      const server = drafts.get(id) as FakeDraft;
      await settle(80);
      // Opening it saves nothing and says nothing.
      expect(server.saves).toHaveLength(0);
      expect(route.notices).toEqual([]);

      route.edit({ name: "Edited" });
      await settle(120);
      expect(server.saves).toHaveLength(1);
      expect(server.rowCurrency).toBe(from);
      expect(savedTicketPrice(server.businessDraft)).toBe(50);
      expect(route.draft()?.currency).toBe(from);
      expect(route.draft()?.tickets[0]?.priceGbp).toBe(50);
      expect(route.notices).toEqual([]);
      await route.unmount();
    });
  }

  test("an RSVP draft with chip-in amounts, row not moved: amounts kept, one save per edit, no notice", async () => {
    const id = seedRsvp(BRAND_A, "GBP");
    (drafts.get(id) as FakeDraft).notMovedByServer = true;
    const route = await mountRoute(id, "GBP");
    const server = drafts.get(id) as FakeDraft;
    serverChangesBrandCurrency(BRAND_A, "NGN");
    route.edit({ name: "Edited RSVP" });
    await settle(120);
    expect(server.saves).toHaveLength(1);
    expect(server.rowCurrency).toBe("GBP");
    expect(server.suggestedCents).toBe(1500);
    expect(server.minCents).toBe(500);
    expect(route.draft()?.rsvpContributionSuggestedCents).toBe(1500);
    expect(route.notices).toEqual([]);
    await settle(60);
    expect(server.saves).toHaveLength(1);
    await route.unmount();
  });

  test("a draft with no currency on a brand that has one: the first save stamps the brand's currency and keeps the typed price, with no notice", async () => {
    const id = nextDraftId();
    brandCurrency.set(BRAND_A, "NGN");
    const typed = ticket({ priceGbp: 40 });
    addDraft({
      draftId: id,
      brandId: BRAND_A,
      rowCurrency: null,
      notMovedByServer: true,
      businessDraft: { clientRevision: 3, tickets: [typed] },
    });
    useDraftEventStore
      .getState()
      .upsertServerDraft(localDraft(BRAND_A, id, { currency: null, tickets: [typed], clientRevision: 3 }));
    const route = await mountRoute(id, "NGN");
    route.edit({ name: "First real save" });
    await settle(120);
    const server = drafts.get(id) as FakeDraft;
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.length).toBeLessThanOrEqual(2);
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBe(40);
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(40);
    expect(route.notices).toEqual([]);
    await route.unmount();
  });
});

// ─── F. Property-style: random interleavings ─────────────────────────────────
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe("#3645 retest 2: 500 random turns per seed", () => {
  const CURRENCIES = ["GBP", "NGN", "USD"] as const;
  const TURNS = 500;

  for (const seed of [3645, 20270829, 7, 1013]) {
    test(`seed ${seed}: no save moves a row's currency, no number crosses currencies, saves are bounded, and the screen comes to rest`, async () => {
      // Far above anything 500 turns can owe; a loop stops here instead of running on.
      SAVE_STORM_LIMIT = 3_000;
      const random = mulberry32(seed);
      const pick = <T,>(items: readonly T[]): T =>
        items[Math.floor(random() * items.length)] as T;
      // Two drafts of two brands, both open, so one can leak into the other.
      const ids = [seedEvent(BRAND_A, "GBP", 50), seedEvent(BRAND_B, "NGN", 7000)];
      const brandOf: Record<string, string> = { [ids[0] as string]: BRAND_A, [ids[1] as string]: BRAND_B };
      const routes = new Map<string, Mounted>();
      for (const id of ids) {
        routes.set(id, await mountRoute(id, brandCurrency.get(brandOf[id] as string) ?? null, 6));
      }
      // Every number the host types is unique, and remembered with the
      // currency the screen showed when it was typed.
      const typedIn = new Map<number, string | null>([
        [50, "GBP"],
        [7000, "NGN"],
      ]);
      let nextPrice = 100_000;
      const counts = { edits: 0, changes: 0, remounts: 0, failures: 0 };
      const noticesSeen = new Map<string, number>(ids.map((id) => [id, 0]));

      const checkSaves = (): void => {
        for (const id of ids) {
          const server = drafts.get(id) as FakeDraft;
          for (const save of server.saves) {
            // 1. A save never changes the currency of a row that has one.
            if (save.rowCurrencyBefore !== null && save.currency !== save.rowCurrencyBefore) {
              throw new Error(
                `seed ${seed}: a save moved draft ${id} from ${save.rowCurrencyBefore} to ${String(save.currency)}`,
              );
            }
            // 2. A number is only ever stored under the currency it was typed in.
            const price = savedTicketPrice(save.businessDraft);
            if (typeof price === "number" && typedIn.get(price) !== save.currency) {
              throw new Error(
                `seed ${seed}: ${price}, typed in ${String(typedIn.get(price))}, was saved as ${String(save.currency)} on draft ${id}`,
              );
            }
          }
        }
      };

      for (let turn = 0; turn < TURNS; turn += 1) {
        const id = pick(ids);
        const route = routes.get(id);
        const roll = random();
        if (roll < 0.34) {
          if (route !== undefined && route.draft() !== null) {
            counts.edits += 1;
            await act(async () => {
              route.edit({ name: `turn ${turn}` });
            });
          }
        } else if (roll < 0.52) {
          const current = route?.draft() ?? null;
          if (route !== undefined && current !== null) {
            counts.edits += 1;
            nextPrice += 1;
            typedIn.set(nextPrice, current.currency ?? null);
            const price = nextPrice;
            await act(async () => {
              route.edit({
                tickets: [ticket({ priceGbp: price, currency: current.currency ?? undefined })],
              });
            });
          }
        } else if (roll < 0.64) {
          counts.changes += 1;
          serverChangesBrandCurrency(brandOf[id] as string, pick(CURRENCIES));
        } else if (roll < 0.7) {
          counts.failures += 1;
          net.failBrandReads += 1;
        } else if (roll < 0.76) {
          counts.failures += 1;
          net.failSaves += 1;
        } else if (roll < 0.82) {
          net.holdBrandReads = !net.holdBrandReads;
          if (!net.holdBrandReads) await releaseHeld();
        } else if (roll < 0.88) {
          await releaseHeld();
        } else if (roll < 0.94) {
          // The host leaves the wizard and comes back to it.
          counts.remounts += 1;
          if (route !== undefined) {
            noticesSeen.set(id, (noticesSeen.get(id) ?? 0) + route.notices.length);
            await route.unmount();
          }
          routes.set(id, await mountRoute(id, pick(CURRENCIES), 1));
        }
        await settle(Math.floor(random() * 3));
        checkSaves();
      }

      // Everything is let go and the network is whole again.
      net.holdBrandReads = false;
      net.failBrandReads = 0;
      net.failSaves = 0;
      await releaseHeld();
      await settle(120);
      for (const id of ids) {
        counts.edits += 1;
        const route = routes.get(id) as Mounted;
        await act(async () => {
          route.edit({ name: "the last word" });
        });
      }
      await settle(240);
      checkSaves();

      const totalSaves = ids.reduce(
        (sum, id) => sum + (drafts.get(id) as FakeDraft).saves.length,
        0,
      );
      // 3. Bounded by what happened: one save per edit, and a small fixed
      //    number for each currency change or re-open. A loop would dwarf this.
      expect(totalSaves).toBeLessThanOrEqual(
        counts.edits + 3 * (counts.changes + counts.remounts) + 6,
      );
      // 4. At rest: nothing saves any more, and each screen shows the currency
      //    its row holds on the server.
      const atRest = ids.map((id) => (drafts.get(id) as FakeDraft).saves.length);
      await settle(120);
      ids.forEach((id, index) => {
        const server = drafts.get(id) as FakeDraft;
        expect(server.saves).toHaveLength(atRest[index] as number);
        expect(routes.get(id)?.draft()?.currency ?? null).toBe(server.rowCurrency);
        expect(server.title).toBe("the last word");
        const price = savedTicketPrice(server.businessDraft);
        if (typeof price === "number") expect(typedIn.get(price)).toBe(server.rowCurrency);
      });
      for (const route of routes.values()) await route.unmount();
    }, 120_000);
  }
});
