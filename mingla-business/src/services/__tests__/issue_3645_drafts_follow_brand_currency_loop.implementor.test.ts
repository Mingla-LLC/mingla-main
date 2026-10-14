/**
 * Issue #3645 — implementor proof for the retest P1: saves settle after the
 * brand's currency changes under an OPEN wizard.
 *
 * BEFORE. The adopt-on-open hook asked the server once, when the draft opened,
 * and went on believing that answer. The brand then changed currency (bank
 * setup pushed over the still-mounted wizard, or a second tab) and the host
 * typed. Each save moved the draft to the new currency; the hook, still
 * holding the open-time answer, moved the local copy back; that saved again;
 * and so on without end (121 saves in 120 turns; the screen kept the old
 * currency).
 *
 * AFTER. One owner for "what currency is this draft in on the server"
 * (utils/draftServerCurrency). The open read and every save result write to
 * it, the newest answer wins, and the hook reads only that. A save that
 * cleared this device's prices leaves a note that only has to be SHOWN, so it
 * owes no further save.
 *
 * Pinned for GBP -> NGN and NGN -> GBP, for an event draft and an RSVP draft:
 * with the wizard mounted across the change, 3 saves or fewer in 120 turns,
 * this device's draft ends in the new currency with its paid prices empty,
 * exactly one notice, and nothing saves once it has settled.
 *
 * The harness (in-memory server, the route reduced to its real hooks) follows
 * the tester's retest file, Evidence 4.
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
import {
  getDraftServerCurrency,
  resetDraftServerCurrencyForTest,
  setDraftServerCurrency,
  subscribeDraftServerCurrency,
} from "../../utils/draftServerCurrency";

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
  return `00000000-0000-4000-8100-${String(draftSeq).padStart(12, "0")}`;
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
type Kind = "event" | "rsvp";

interface FakeServer {
  draftId: string;
  kind: Kind;
  title: string;
  brandCurrency: string | null;
  rowCurrency: string | null;
  businessDraft: Record<string, unknown>;
  suggestedCents: number | null;
  minCents: number | null;
  /** Reads that asked for the brand's currency. */
  brandReads: number;
  saves: { rpc: string; currency: string | null; businessDraft: Record<string, unknown> }[];
}

let server: FakeServer;
// A circuit breaker for the test only: a client that never stops saving would
// never let the test finish. Saves past this limit hang.
const SAVE_STORM_LIMIT = 25;

const serverRow = (): Record<string, unknown> => ({
  id: server.draftId,
  brand_id: BRAND_ID,
  created_by: "user-1",
  title: server.title,
  description: null,
  slug: "lagos-launch",
  event_type: server.kind,
  currency: server.rowCurrency,
  theme: { business_draft: server.businessDraft },
  rsvp_contribution_enabled: server.kind === "rsvp",
  rsvp_contribution_suggested_cents: server.suggestedCents,
  rsvp_contribution_min_cents: server.minCents,
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
      const row = serverRow();
      if (columns.includes("brand:brands")) {
        server.brandReads += 1;
        row.brand = { default_currency: server.brandCurrency };
      }
      return Promise.resolve({ data: row, error: null });
    });
    return builder;
  });
  mockRpc.mockImplementation((name: unknown, args: unknown) => {
    const rpc = String(name);
    const payload = (args as {
      p_payload: {
        title?: string;
        currency: string | null;
        theme: { business_draft: Record<string, unknown> };
      };
    }).p_payload;
    if (server.saves.length >= SAVE_STORM_LIMIT) return new Promise(() => undefined);
    if (typeof payload.title === "string") server.title = payload.title;
    if (rpc === "business_update_event_draft") {
      // The event draft owner REPLACES the draft JSON.
      server.businessDraft = { ...payload.theme.business_draft };
    } else if (rpc === "business_update_rsvp_graph") {
      // The RSVP draft owner MERGES it, and mirrors the amounts to columns.
      server.businessDraft = { ...server.businessDraft, ...payload.theme.business_draft };
      server.suggestedCents = numberOrNull(server.businessDraft.rsvpContributionSuggestedCents);
      server.minCents = numberOrNull(server.businessDraft.rsvpContributionMinCents);
    } else {
      return Promise.reject(new Error(`unexpected rpc: ${rpc}`));
    }
    server.rowCurrency = payload.currency;
    server.saves.push({
      rpc,
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
    tickets: tickets.map((t) => (t.isFree ? t : { ...t, priceGbp: null, currency: to })),
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    pricesClearedForCurrencyChange: { from, to },
  };
  server.suggestedCents = null;
  server.minCents = null;
};

// ─── The route, reduced to its real parts ────────────────────────────────────
interface Mounted {
  notices: string[];
  edit: (patch: Partial<DraftEvent>) => void;
  draft: () => DraftEvent | null;
  unmount: () => void;
}

const settle = async (turns: number): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

const mountRoute = async (draftId: string, cachedBrandCurrency: string): Promise<Mounted> => {
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
    useDraftFollowsBrandCurrency({ draft, onSave: autosave.saveDraft, onNotice });
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
  await settle(40);
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

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  resetPricesClearedNotesForTest();
  resetDraftServerCurrencyForTest();
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {}, activeDraftId: null });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const CURRENCY_NAME: Record<string, string> = {
  NGN: "Nigerian naira",
  GBP: "British pounds",
};

describe("#3645 loop fix: the wizard stays mounted while the brand's currency changes", () => {
  for (const [from, to] of [
    ["GBP", "NGN"],
    ["NGN", "GBP"],
  ] as const) {
    for (const kind of ["event", "rsvp"] as const) {
      test(`${kind} draft, ${from} to ${to}: the saves settle, this device ends in ${to} with empty prices, one notice`, async () => {
        const id = nextDraftId();
        const priced = ticket({ priceGbp: 50, currency: from });
        const local: Partial<DraftEvent> =
          kind === "event"
            ? { currency: from, tickets: [priced], clientRevision: 3 }
            : {
                currency: from,
                isRsvp: true,
                tickets: [],
                rsvpContributionEnabled: true,
                rsvpContributionSuggestedCents: 1500,
                rsvpContributionMinCents: 500,
                clientRevision: 3,
              };
        server = {
          draftId: id,
          kind,
          title: "Lagos launch",
          brandCurrency: from,
          rowCurrency: from,
          businessDraft:
            kind === "event"
              ? { clientRevision: 3, currency: from, tickets: [priced] }
              : {
                  clientRevision: 3,
                  currency: from,
                  isRsvp: true,
                  tickets: [],
                  rsvpContributionEnabled: true,
                  rsvpContributionSuggestedCents: 1500,
                  rsvpContributionMinCents: 500,
                },
          suggestedCents: kind === "rsvp" ? 1500 : null,
          minCents: kind === "rsvp" ? 500 : null,
          brandReads: 0,
          saves: [],
        };
        installServer();
        useDraftEventStore.getState().upsertServerDraft(localDraft(id, local));

        // The host opens the draft; nothing to do yet.
        const route = await mountRoute(id, from);
        expect(server.saves).toHaveLength(0);
        expect(route.notices).toEqual([]);

        // Bank setup (or another tab) changes the brand's currency while this
        // wizard stays mounted; the host comes back and types.
        serverChangesBrandCurrency(to);
        route.edit({ name: "Typed after coming back" });
        await settle(120);

        // The saves came to rest, well short of the circuit breaker.
        expect(server.saves.length).toBeGreaterThanOrEqual(1);
        expect(server.saves.length).toBeLessThanOrEqual(3);
        // No save ever carried the old currency or an old number.
        expect(server.saves.every((s) => s.currency === to)).toBe(true);
        expect(server.saves.every((s) => s.businessDraft.currency === to)).toBe(true);
        expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
        expect(JSON.stringify(server.saves)).not.toContain("1500");

        // This device ends in the new currency with its paid prices empty.
        const settled = route.draft();
        expect(settled?.currency).toBe(to);
        expect(settled?.name).toBe("Typed after coming back");
        if (kind === "event") {
          expect(settled?.tickets[0]?.priceGbp).toBeNull();
          expect(settled?.tickets[0]?.isFree).toBe(false);
        } else {
          expect(settled?.rsvpContributionSuggestedCents).toBeNull();
          expect(settled?.rsvpContributionMinCents).toBeNull();
          expect(settled?.rsvpContributionEnabled).toBe(true);
        }

        // The host is told exactly once, in plain words.
        expect(route.notices).toEqual([
          `Your brand now sells in ${CURRENCY_NAME[to]}. Enter your prices again.`,
        ]);
        // The server's note is resolved, so the next device is not told again.
        expect(server.businessDraft.pricesClearedForCurrencyChange ?? null).toBeNull();
        expect(server.rowCurrency).toBe(to);

        // And once settled, nothing saves again.
        const savesWhenSettled = server.saves.length;
        await settle(40);
        expect(server.saves).toHaveLength(savesWhenSettled);
        expect(route.notices).toHaveLength(1);

        // A later edit is one ordinary save, still in the new currency.
        route.edit({ name: "A later edit" });
        await settle(40);
        expect(server.saves).toHaveLength(savesWhenSettled + 1);
        expect(server.saves[server.saves.length - 1]?.currency).toBe(to);
        expect(route.draft()?.currency).toBe(to);
        route.unmount();
      });
    }
  }
});

describe("#3645 loop fix: inside the few seconds a brand answer is reused", () => {
  test("a save after the change follows the server ROW, not the reused answer, and the reused answer is then dropped", async () => {
    const id = nextDraftId();
    const priced = ticket({ priceGbp: 50, currency: "GBP" });
    server = {
      draftId: id,
      kind: "event",
      title: "Lagos launch",
      brandCurrency: "GBP",
      rowCurrency: "GBP",
      businessDraft: { clientRevision: 3, currency: "GBP", tickets: [priced] },
      suggestedCents: null,
      minCents: null,
      brandReads: 0,
      saves: [],
    };
    installServer();
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [priced], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");

    // A first edit: the save asks for the brand's currency (pounds) and keeps
    // the answer for a few seconds.
    route.edit({ name: "First edit" });
    await settle(40);
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0]?.currency).toBe("GBP");
    const readsBeforeChange = server.brandReads;

    // Well inside that window the brand moves to naira and the server clears
    // the row. The host types again at once.
    serverChangesBrandCurrency("NGN");
    route.edit({ name: "Second edit, a moment later" });
    await settle(120);

    // Nothing after the change was saved in pounds, and 50 never came back.
    const afterChange = server.saves.slice(1);
    expect(afterChange.length).toBeGreaterThanOrEqual(1);
    expect(afterChange.length).toBeLessThanOrEqual(3);
    expect(afterChange.every((s) => s.currency === "NGN")).toBe(true);
    expect(afterChange.every((s) => s.businessDraft.currency === "NGN")).toBe(true);
    expect(JSON.stringify(afterChange)).not.toContain(`"priceGbp":50`);
    expect(server.rowCurrency).toBe("NGN");
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(route.notices).toHaveLength(1);

    // The reused pounds answer disagreed with what the save established, so
    // it was thrown away: the very next save, still inside the window, asks
    // the server again instead of reusing it.
    const readsWhenSettled = server.brandReads;
    route.edit({ name: "Third edit" });
    await settle(40);
    expect(server.brandReads).toBe(readsWhenSettled + 1);
    expect(server.brandReads).toBeGreaterThan(readsBeforeChange);
    expect(server.saves[server.saves.length - 1]?.currency).toBe("NGN");
    route.unmount();
  });
});

describe("#3645 loop fix: one owner for a draft's server currency", () => {
  test("a newer answer replaces an older one; an older answer never replaces a newer one", () => {
    const changes: (string | null | undefined)[] = [];
    const stop = subscribeDraftServerCurrency(() => changes.push(getDraftServerCurrency("d-1")));
    expect(getDraftServerCurrency("d-1")).toBeUndefined();
    setDraftServerCurrency("d-1", "gbp", 100); // asked when the draft opened
    setDraftServerCurrency("d-1", "NGN", 200); // a save result
    // The open-time read answers late, with what it was told before the change.
    setDraftServerCurrency("d-1", "GBP", 150);
    expect(getDraftServerCurrency("d-1")).toBe("NGN");
    // The same answer again tells nobody anything.
    setDraftServerCurrency("d-1", "NGN", 300);
    expect(changes).toEqual(["GBP", "NGN"]);
    stop();
  });
});
