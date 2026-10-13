/**
 * Issue #3645 — tester RETEST of the rework (must-fix 3: a brand list cached on
 * the device; plus the trip pricing form, must-fix 2, at the service seam).
 *
 * The first tester suite and the implementor's rework suite call
 * `autosaveServerDraft` once and read the payload. That cannot see what the
 * host's screen does next. This suite runs the REAL pieces together, the way a
 * draft route mounts them:
 *
 *     the real draft store  +  the real `useDraftFollowsBrandCurrency`
 *     +  the real `useServerDraftAutosave`  +  the real `autosaveServerDraft`
 *
 * against a small in-memory server that behaves like the database does after
 * migration 20270829003645: one draft row, one brand currency, the
 * `stale_client_revision` rule of `business_update_event_draft`, and the wipe
 * the brands trigger performs. Every read and every save is counted.
 *
 * Proven here:
 *   - second device, stale brand list: a re-priced draft is not touched and is
 *     saved once, in the server's currency, with its price;
 *   - the device's stale copy can not overwrite a draft another device
 *     re-priced (the server refuses the older revision; the newer copy wins);
 *   - a draft opened after the change is moved once, the host is told once,
 *     and the saves stop;
 *   - a brand read that fails never clears a price, never writes the cached
 *     (older) currency over a newer row, and never drops the save;
 *   - the brand's currency is read at most once per burst of saves, and not at
 *     all per keystroke beyond that;
 *   - a published event is never asked about and never moved;
 *   - the trip pricing service refuses the old number BEFORE anything is sent,
 *     for every way a form left open can ask.
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
import { updateTripPricing } from "../tripsService";

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

const BRAND_ID = "00000000-0000-4000-8000-0000000b3645";
let draftSeq = 0;
// A new draft id per test: the autosave hook keeps the brand's currency for a
// draft for a few seconds, across mounts.
const nextDraftId = (): string => {
  draftSeq += 1;
  return `00000000-0000-4000-8000-${String(draftSeq).padStart(12, "0")}`;
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

const localDraft = (id: string, patch: Partial<DraftEvent>): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, id, "2026-10-01T10:00:00.000Z"),
  name: "Lagos launch",
  ...patch,
});

// ─── The in-memory server ────────────────────────────────────────────────────
interface FakeServer {
  draftId: string;
  status: "draft" | "live";
  brandCurrency: string | null;
  rowCurrency: string | null;
  businessDraft: Record<string, unknown>;
  /** When true the read that carries the brand fails (offline, RLS, timeout). */
  brandReadFails: boolean;
  /** When true the brand comes back empty (no right to read it). */
  brandHidden: boolean;
  brandReads: number;
  saves: { revision: number; currency: string | null; businessDraft: Record<string, unknown> }[];
  refusedSaves: number;
}

let server: FakeServer;
const SAVE_STORM_LIMIT = 25;

const serverRow = (): Record<string, unknown> => ({
  id: server.draftId,
  brand_id: BRAND_ID,
  created_by: "user-1",
  title: "Lagos launch",
  description: null,
  slug: "lagos-launch",
  event_type: "event",
  currency: server.rowCurrency,
  theme: { business_draft: server.businessDraft },
  visibility: "draft",
  status: server.status,
  timezone: "Africa/Lagos",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  published_at: null,
  deleted_at: null,
});

const installServer = (): void => {
  mockFrom.mockImplementation((table: unknown) => {
    if (table !== "events") throw new Error(`unexpected table read: ${String(table)}`);
    let columns = "";
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "in", "is", "order", "limit"]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.select = jest.fn((cols: unknown) => {
      columns = String(cols);
      return builder;
    });
    builder.maybeSingle = jest.fn(() => {
      const wantsBrand = columns.includes("brand:brands");
      if (wantsBrand) {
        server.brandReads += 1;
        if (server.brandReadFails) {
          return Promise.resolve({ data: null, error: new Error("Network request failed") });
        }
      }
      // Every draft read in the product filters on status = 'draft'.
      if (server.status !== "draft") return Promise.resolve({ data: null, error: null });
      const row = serverRow();
      if (wantsBrand) {
        row.brand = server.brandHidden ? null : { default_currency: server.brandCurrency };
      }
      return Promise.resolve({ data: row, error: null });
    });
    return builder;
  });
  mockRpc.mockImplementation((name: unknown, args: unknown) => {
    if (name !== "business_update_event_draft") {
      return Promise.reject(new Error(`unexpected rpc: ${String(name)}`));
    }
    const { p_payload, p_client_revision } = args as {
      p_payload: { currency: string | null; theme: { business_draft: Record<string, unknown> } };
      p_client_revision: number;
    };
    // A circuit breaker for the test only: a client that never stops saving
    // would otherwise never let the test finish. The 26th save hangs.
    if (server.saves.length >= SAVE_STORM_LIMIT) return new Promise(() => undefined);
    const stored = Number(server.businessDraft.clientRevision ?? 0);
    // business_update_event_draft: an older revision is refused.
    if (p_client_revision < stored) {
      server.refusedSaves += 1;
      return Promise.resolve({ data: null, error: { message: "stale_client_revision" } });
    }
    server.rowCurrency = p_payload.currency;
    server.businessDraft = {
      ...p_payload.theme.business_draft,
      clientRevision: p_client_revision,
    };
    server.saves.push({
      revision: p_client_revision,
      currency: server.rowCurrency,
      businessDraft: server.businessDraft,
    });
    return Promise.resolve({ data: { event: serverRow() }, error: null });
  });
};

/** What the brands trigger does to a draft with nothing sold (X to Y). */
const serverChangesBrandCurrency = (to: string): void => {
  const from = server.rowCurrency;
  server.brandCurrency = to;
  server.rowCurrency = to;
  const tickets = (server.businessDraft.tickets as TicketStub[] | undefined) ?? [];
  server.businessDraft = {
    ...server.businessDraft,
    currency: to,
    tickets: tickets.map((t) => (t.isFree ? t : { ...t, priceGbp: null })),
    pricesClearedForCurrencyChange: { from, to },
  };
};

const savedTicketPrice = (bd: Record<string, unknown>): unknown =>
  ((bd.tickets as { id: string; priceGbp: unknown }[] | undefined) ?? []).find(
    (t) => t.id === "t_paid",
  )?.priceGbp;

// ─── The route, reduced to its three real parts ──────────────────────────────
interface Mounted {
  notices: string[];
  /** A wizard edit: new revision, marked dirty, stored, then saved. */
  edit: (patch: Partial<DraftEvent>) => void;
  draft: () => DraftEvent | null;
  unmount: () => void;
}

const mountRoute = async (
  draftId: string,
  cachedBrandCurrency: string | null,
  isEditPublished = false,
): Promise<Mounted> => {
  const notices: string[] = [];
  let save: (d: DraftEvent) => void = () => undefined;
  const Route = (): null => {
    const brandCurrencyRef = React.useRef<string | null>(null);
    const autosave = useServerDraftAutosave({ brandCurrencyRef });
    const draft = useDraftById(draftId);
    brandCurrencyRef.current = isEditPublished ? null : cachedBrandCurrency;
    const onNotice = React.useCallback((message: string): void => {
      notices.push(message);
    }, []);
    save = autosave.saveDraft;
    // The value this device holds rides along the way the route passed it
    // before the rework. Today's hook takes no such value (it asks the server);
    // keeping it here is what lets this same file run against the pre-rework
    // hook and show the difference.
    const followInput = {
      draft: isEditPublished ? null : draft,
      brandCurrency: isEditPublished ? null : cachedBrandCurrency,
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
  await settle();
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
    unmount: () => {
      void act(() => {
        renderer?.unmount();
      });
      queryClient.clear();
    },
  };
};

/** Let every pending read, save and effect finish; many turns, so a loop shows. */
const settle = async (turns = 40): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

const startServer = (patch: Partial<FakeServer> & { draftId: string }): void => {
  server = {
    status: "draft",
    brandCurrency: "NGN",
    rowCurrency: "NGN",
    businessDraft: { clientRevision: 3, currency: "NGN", tickets: [] },
    brandReadFails: false,
    brandHidden: false,
    brandReads: 0,
    saves: [],
    refusedSaves: 0,
    ...patch,
  };
  installServer();
};

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  resetPricesClearedNotesForTest();
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {}, activeDraftId: null });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("#3645 retest: second device with a stale brand list", () => {
  test("EVIDENCE 1 — a draft re-priced in naira is saved once, in naira, with its price; the stale pounds are never used", async () => {
    const id = nextDraftId();
    const repriced = ticket({ priceGbp: 7000, currency: "NGN" });
    startServer({
      draftId: id,
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [repriced] },
    });
    // This device read the re-priced draft; its BRAND LIST still says pounds.
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "NGN", tickets: [repriced], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    expect(server.saves).toHaveLength(0); // opening it changes nothing
    expect(route.notices).toEqual([]);

    route.edit({ name: "Lagos launch (edited)" });
    await settle();

    expect(server.saves).toHaveLength(1);
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBe(7000);
    expect(JSON.stringify(server.saves)).not.toContain("GBP");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    expect(route.notices).toEqual([]);
    route.unmount();
  });

  test("EVIDENCE 2 — this device's OLD pound copy cannot overwrite the draft another device re-priced", async () => {
    const id = nextDraftId();
    const repriced = ticket({ priceGbp: 7000, currency: "NGN" });
    // The other device re-priced at revision 9. This device still holds
    // revision 3: pounds, 50.
    startServer({
      draftId: id,
      businessDraft: { clientRevision: 9, currency: "NGN", tickets: [repriced] },
    });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50 })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    await settle();

    // Whatever this device tried, the server row still holds the re-priced draft.
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBe(7000);
    expect(server.saves).toHaveLength(0);
    // And this device ends on the server's copy, not on its own cleared one.
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    route.unmount();
  });
});

describe("#3645 retest: a draft opened after the change", () => {
  test("EVIDENCE 3 — the server moved and cleared it; this device's pound copy is moved once, the host is told once, and the saves stop", async () => {
    const id = nextDraftId();
    startServer({
      draftId: id,
      brandCurrency: "GBP",
      rowCurrency: "GBP",
      businessDraft: { clientRevision: 3, currency: "GBP", tickets: [ticket({ priceGbp: 50 })] },
    });
    serverChangesBrandCurrency("NGN");
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50 })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    await settle(80);

    expect(route.notices).toEqual(["Your brand now sells in Nigerian naira. Enter your prices again."]);
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBeNull();
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(JSON.stringify(server.saves)).not.toContain(":50");
    // Bounded: the move, and at most one more to resolve the note.
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.length).toBeLessThanOrEqual(2);
    // The note is resolved on the server, so the next device is not told again.
    expect(server.businessDraft.pricesClearedForCurrencyChange ?? null).toBeNull();
    const savesAfterOpen = server.saves.length;
    await settle(40);
    expect(server.saves).toHaveLength(savesAfterOpen);
    route.unmount();
  });
});

describe("#3645 retest: the wizard stays mounted while the brand's currency changes", () => {
  // DATA HALF ONLY. In this situation the screen does not come to rest (see the
  // tester's report on issue #3645: the open-time answer and the save's fresher
  // answer disagree, and each undoes the other). The assertions that the saves
  // STOP and that this device ends on the new currency are withheld from this
  // file until that is fixed; the in-memory server stops answering after
  // SAVE_STORM_LIMIT saves so the test always finishes. What IS pinned: nothing
  // is ever saved in the old currency, and the old number never comes back.
  for (const [from, to] of [
    ["GBP", "NGN"],
    ["NGN", "GBP"],
  ] as const) {
    test(`EVIDENCE 4 (${from} to ${to}) — no save after the change carries the old currency or the old number`, async () => {
      const id = nextDraftId();
      const priced = ticket({ priceGbp: 50, currency: from });
      startServer({
        draftId: id,
        brandCurrency: from,
        rowCurrency: from,
        businessDraft: { clientRevision: 3, currency: from, tickets: [priced] },
      });
      useDraftEventStore.getState().upsertServerDraft(
        localDraft(id, { currency: from, tickets: [priced], clientRevision: 3 }),
      );
      // The host opens the draft, goes to bank setup (the wizard screen stays
      // mounted underneath, or the tab stays open), the currency changes, and
      // the host comes back and types.
      const route = await mountRoute(id, from);
      expect(server.saves).toHaveLength(0);
      serverChangesBrandCurrency(to);

      route.edit({ name: "Typed after coming back" });
      await settle(60);

      expect(server.saves.length).toBeGreaterThanOrEqual(1);
      expect(server.rowCurrency).toBe(to);
      expect(savedTicketPrice(server.businessDraft)).toBeNull();
      expect(server.saves.every((save) => save.currency === to)).toBe(true);
      expect(server.saves.every((save) => save.businessDraft.currency === to)).toBe(true);
      expect(server.saves.every((save) => savedTicketPrice(save.businessDraft) === null)).toBe(true);
      // The host is told why the price is empty, once.
      expect(route.notices).toHaveLength(1);
      route.unmount();
    });
  }
});

describe("#3645 retest: the brand read fails (offline, timeout)", () => {
  test("a re-priced draft keeps its price and its currency, and the save still goes through", async () => {
    const id = nextDraftId();
    const repriced = ticket({ priceGbp: 7000, currency: "NGN" });
    startServer({
      draftId: id,
      brandReadFails: true,
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [repriced] },
    });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "NGN", tickets: [repriced], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP"); // stale cached pounds
    route.edit({ name: "Edited while the brand read fails" });
    await settle();

    expect(server.saves).toHaveLength(1); // not dropped, not blocked
    expect(server.rowCurrency).toBe("NGN"); // the cached pounds were not written
    expect(savedTicketPrice(server.businessDraft)).toBe(7000); // nothing cleared
    expect(route.notices).toEqual([]);
    // A failed answer is not kept: the next save asks again.
    const readsAfterFirst = server.brandReads;
    route.edit({ name: "Edited again" });
    await settle();
    expect(server.brandReads).toBeGreaterThan(readsAfterFirst);
    expect(server.saves).toHaveLength(2);
    route.unmount();
  });

  test("the read made when the draft OPENED failed: the first edit still moves the draft, clears the old number, and the saves stop", async () => {
    const id = nextDraftId();
    startServer({
      draftId: id,
      brandCurrency: "GBP",
      rowCurrency: "GBP",
      businessDraft: { clientRevision: 3, currency: "GBP", tickets: [ticket({ priceGbp: 50 })] },
    });
    serverChangesBrandCurrency("NGN");
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50 })], clientRevision: 3 }),
    );
    server.brandReadFails = true; // a blip while the screen opens
    const route = await mountRoute(id, "GBP");
    expect(server.saves).toHaveLength(0); // nothing is guessed while the answer is missing
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(50); // and nothing is cleared on a guess
    server.brandReadFails = false;
    route.edit({ name: "Typed after a failed open read" });
    await settle(80);
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBeNull();
    expect(server.saves.every((save) => save.currency === "NGN")).toBe(true);
    expect(server.saves.length).toBeLessThanOrEqual(3);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(route.notices).toHaveLength(1);
    route.unmount();
  });

  test("a team member who cannot read the brand: same result, the row's currency is followed", async () => {
    const id = nextDraftId();
    const repriced = ticket({ priceGbp: 7000, currency: "NGN" });
    startServer({
      draftId: id,
      brandHidden: true,
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [repriced] },
    });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "NGN", tickets: [repriced], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    route.edit({ name: "Edited by a team member" });
    await settle();
    expect(server.saves).toHaveLength(1);
    expect(server.rowCurrency).toBe("NGN");
    expect(savedTicketPrice(server.businessDraft)).toBe(7000);
    expect(route.notices).toEqual([]);
    route.unmount();
  });
});

describe("#3645 retest: how often the server is asked", () => {
  test("ten quick edits ask for the brand's currency once (plus once when the draft opened), never once per keystroke", async () => {
    const id = nextDraftId();
    const repriced = ticket({ priceGbp: 7000, currency: "NGN" });
    startServer({
      draftId: id,
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [repriced] },
    });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "NGN", tickets: [repriced], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "NGN");
    const readsAtOpen = server.brandReads;
    expect(readsAtOpen).toBe(1);
    for (let i = 0; i < 10; i += 1) {
      route.edit({ name: `Lagos launch ${i}` });
      await settle(6);
    }
    await settle();
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.brandReads - readsAtOpen).toBe(1);
    route.unmount();
  });
});

describe("#3645 retest: a published event", () => {
  test("is never asked about and never moved, whatever the brand's currency is now", async () => {
    const id = nextDraftId();
    startServer({ draftId: id, status: "live", brandCurrency: "NGN", rowCurrency: "GBP" });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50 })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "NGN", true);
    await settle();
    expect(server.saves).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(route.notices).toEqual([]);
    expect(route.draft()?.currency).toBe("GBP");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(50);
    route.unmount();
  });
});

describe("#3645 retest: a trip pricing form left open cannot send the old number", () => {
  const MARKER = { price_cleared_for_currency_change: { from: "GBP", to: "NGN" } };
  const TIER = "tt-standard";
  const options = { operationId: "op-retest", expectedUpdatedAt: "2026-10-13T00:00:00Z" };

  const tripServer = (state: {
    tierMetadata: Record<string, unknown>;
    priceCents: number;
    ticketReadError?: Error;
  }): { sent: () => Record<string, unknown> | null } => {
    let sent: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: unknown) => {
      const rows =
        table === "trip_pricing_tiers"
          ? [{ id: "tier-1", event_id: "trip-1", ticket_type_id: TIER, tier_name: "Standard",
               tier_metadata: state.tierMetadata, created_at: "2026-10-01T00:00:00Z" }]
          : [{ id: TIER, event_id: "trip-1", price_cents: state.priceCents, currency: "NGN",
               quantity_total: 12, is_unlimited: false }];
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
        builder[method] = jest.fn(() => builder);
      }
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve(
          table === "ticket_types" && state.ticketReadError !== undefined
            ? { data: null, error: state.ticketReadError }
            : { data: rows[0], error: null },
        ),
      );
      return builder;
    });
    mockRpc.mockImplementation((_name: unknown, args: unknown) => {
      const tiers = (args as { p_patch: { tiers: Record<string, unknown>[] } }).p_patch.tiers;
      sent = tiers[0] ?? null;
      return Promise.resolve({ data: {}, error: null });
    });
    return { sent: () => sent };
  };

  test("every way an open form can ask for the old number is refused before anything is sent", async () => {
    const asks = [
      { priceCents: 45000 },
      { priceCents: 45000, priceEntered: false },
      { priceCents: 45000, installmentSchedule: null },
      { priceCents: 45000, description: "Shared room, edited" },
      { priceCents: 1 },
    ];
    for (const ask of asks) {
      const s = tripServer({ tierMetadata: { description: "Shared room", ...MARKER }, priceCents: 0 });
      await expect(
        updateTripPricing("trip-1", { ticketTypeId: TIER, tierName: "Standard", capacity: 12, ...ask }, options),
      ).rejects.toThrow("price_reentry_required");
      expect(s.sent()).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    }
  });

  test("when the package's current price cannot be read the save fails loudly; it is not sent on a guess", async () => {
    const s = tripServer({
      tierMetadata: { ...MARKER },
      priceCents: 0,
      ticketReadError: new Error("Network request failed"),
    });
    await expect(
      updateTripPricing("trip-1", { ticketTypeId: TIER, tierName: "Standard", priceCents: 45000, capacity: 12 }, options),
    ).rejects.toThrow("Network request failed");
    expect(s.sent()).toBeNull();
  });

  test("renaming a still-unpriced package (price left empty) keeps it marked: it is not quietly turned into a free one", async () => {
    const s = tripServer({ tierMetadata: { description: "Shared room", ...MARKER }, priceCents: 0 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard plus", priceCents: 0, capacity: 14, description: "Twin room" },
      options,
    );
    const sent = s.sent();
    expect(sent).not.toBeNull();
    expect(sent?.price_cents).toBe(0);
    expect(sent?.tier_metadata).toEqual({ description: "Twin room", ...MARKER });
  });

  test("a package with no marker is priced exactly as before: no extra read, no refusal", async () => {
    const s = tripServer({ tierMetadata: { description: "Shared room" }, priceCents: 45000 });
    await updateTripPricing(
      "trip-1",
      { ticketTypeId: TIER, tierName: "Standard", priceCents: 50000, capacity: 12 },
      options,
    );
    expect(s.sent()?.price_cents).toBe(50000);
    expect(s.sent()?.tier_metadata).toEqual({ description: "Shared room" });
    const ticketReadsBeforeSave = mockFrom.mock.calls
      .slice(0, 2)
      .filter(([table]) => table === "ticket_types").length;
    expect(ticketReadsBeforeSave).toBe(0);
  });
});
