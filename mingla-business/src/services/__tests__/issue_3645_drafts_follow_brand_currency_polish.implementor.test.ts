/**
 * Issue #3645 — implementor proof for the last small round after retest 3.
 *
 * D1  A "prices were cleared" note that arrives BESIDE prices is stale. A
 *     writer that does not resolve the note (an older app build, another
 *     caller of the RSVP draft owner, which merges the draft JSON) left it
 *     next to newly entered amounts, and a device still holding the old
 *     amounts then cleared the new ones.
 * D2  With unsaved offline edits at a higher revision, a row in another
 *     currency the server did not clear, and a failed read of the server's
 *     copy, every save wrote nothing and said nothing for the rest of the
 *     visit. It is now a visible save failure, and it recovers.
 * D3  Replacing this device's prices with the server's discarded every other
 *     unsaved field too. The host's unsaved text is kept and saved.
 * D5  A brand with no currency has its own words; a draft that is no longer a
 *     draft is simply read again. (Separate words for "already has sales" are
 *     NOT here: an existing suite pins one code and one sentence for that
 *     answer. See the report on #3645.)
 *
 * The harness follows the tester's retest files.
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
import {
  pricesClearedNoteFromTheme,
  resetPricesClearedNotesForTest,
  themeCarriesPrices,
} from "../../utils/draftPricesClearedNote";
import {
  DRAFT_CURRENCY_BRAND_HAS_NONE_COPY,
  draftCurrencySyncOutcomeCode,
} from "../../utils/draftCurrencyPublishRefusal";
import { describeUnmappedPublishGuard } from "../../utils/paidPublishGuards";
import { publishWithDraftCurrencySync } from "../draftCurrencySync";
import { rsvpRpcFailureCopy } from "../rsvpRpcFailure";
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
  return `00000000-0000-4000-8300-${String(draftSeq).padStart(12, "0")}`;
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
  /** When true, a read of the WHOLE draft (the server's copy) fails. */
  failDraftReads: boolean;
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
      const wholeDraft = columns !== "theme,currency" && !columns.includes("brand:brands");
      if (wholeDraft && server.failDraftReads) {
        return Promise.resolve({ data: null, error: new Error("Network request failed") });
      }
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
  /** The save-failed state the wizard header shows. */
  saveFailed: () => boolean;
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
  const saveState = { hasError: false };
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
    saveState.hasError = autosave.hasError;
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
    saveFailed: () => saveState.hasError,
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


const baseServer = (id: string, patch: Partial<FakeServer>): FakeServer => ({
  draftId: id,
  kind: "event",
  title: "Lagos launch",
  brandCurrency: "NGN",
  rowCurrency: "NGN",
  businessDraft: { clientRevision: 3, currency: "NGN", tickets: [] },
  suggestedCents: null,
  minCents: null,
  brandReads: 0,
  failDraftReads: false,
  saves: [],
  ...patch,
});

const STALE_NOTE = { from: "GBP", to: "NGN" };

describe("#3645 polish D1: a cleared-prices note beside prices is stale", () => {
  test("RSVP: amounts entered again elsewhere (700000 / 200000) with the note left behind are not cleared by a device holding the old pound amounts", async () => {
    const id = nextDraftId();
    server = baseServer(id, {
      kind: "rsvp",
      businessDraft: {
        clientRevision: 3,
        currency: "NGN",
        isRsvp: true,
        tickets: [],
        rsvpContributionEnabled: true,
        // Entered again by a writer that did not resolve the note.
        rsvpContributionSuggestedCents: 700000,
        rsvpContributionMinCents: 200000,
        pricesClearedForCurrencyChange: STALE_NOTE,
      },
      suggestedCents: 700000,
      minCents: 200000,
    });
    installServer();
    // This device still holds the old pound amounts.
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, {
        currency: "GBP",
        isRsvp: true,
        tickets: [],
        rsvpContributionEnabled: true,
        rsvpContributionSuggestedCents: 1500,
        rsvpContributionMinCents: 500,
        clientRevision: 3,
      }),
    );
    const route = await mountRoute(id, "GBP");
    await settle(120);

    expect(server.suggestedCents).toBe(700000);
    expect(server.minCents).toBe(200000);
    expect(server.businessDraft.rsvpContributionSuggestedCents).toBe(700000);
    expect(JSON.stringify(server.saves)).not.toContain(`"rsvpContributionSuggestedCents":null`);
    expect(JSON.stringify(server.saves)).not.toContain("1500");
    // Nothing of the host's was cleared, so nothing is said.
    expect(route.notices).toEqual([]);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.rsvpContributionSuggestedCents).toBe(700000);
    expect(route.draft()?.rsvpContributionMinCents).toBe(200000);

    // An edit afterwards saves once and the amounts are still there.
    route.edit({ name: "Edited after re-opening" });
    await settle(60);
    expect(server.suggestedCents).toBe(700000);
    expect(server.minCents).toBe(200000);
    expect(server.title).toBe("Edited after re-opening");
    route.unmount();
  });

  test("event tickets: the same rule (7000 naira beside a left-over note is not cleared)", async () => {
    const id = nextDraftId();
    server = baseServer(id, {
      businessDraft: {
        clientRevision: 3,
        currency: "NGN",
        tickets: [ticket({ priceGbp: 7000, currency: "NGN" })],
        pricesClearedForCurrencyChange: STALE_NOTE,
      },
    });
    installServer();
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50, currency: "GBP" })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    route.edit({ name: "Typed on the stale device" });
    await settle(120);
    expect((server.businessDraft.tickets as TicketStub[])[0]?.priceGbp).toBe(7000);
    expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":null`);
    expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
    expect(route.notices).toEqual([]);
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    route.unmount();
  });

  test("one definition of 'the row carries prices', and the note rule built on it", () => {
    const note = { pricesClearedForCurrencyChange: STALE_NOTE };
    const cleared = { business_draft: { ...note, tickets: [{ isFree: false, priceGbp: null }] } };
    expect(themeCarriesPrices(cleared)).toBe(false);
    expect(pricesClearedNoteFromTheme(cleared)).toEqual({ from: "GBP", to: "NGN" });

    const repriced = { business_draft: { ...note, tickets: [{ isFree: false, priceGbp: 7000 }] } };
    expect(themeCarriesPrices(repriced)).toBe(true);
    expect(pricesClearedNoteFromTheme(repriced)).toBeNull();

    const chipIns = { business_draft: { ...note, tickets: [], rsvpContributionMinCents: 200000 } };
    expect(themeCarriesPrices(chipIns)).toBe(true);
    expect(pricesClearedNoteFromTheme(chipIns)).toBeNull();

    // A free ticket, a zero and an empty amount are not prices.
    const free = {
      business_draft: {
        ...note,
        tickets: [{ isFree: true, priceGbp: null }, { isFree: false, priceGbp: 0 }],
        rsvpContributionSuggestedCents: null,
      },
    };
    expect(themeCarriesPrices(free)).toBe(false);
    expect(pricesClearedNoteFromTheme(free)).toEqual({ from: "GBP", to: "NGN" });
    expect(themeCarriesPrices(null)).toBe(false);
  });
});

/** This device holds unsaved (offline) edits at a higher revision than the server. */
const seedOfflineEdits = (id: string, name: string): void => {
  const store = useDraftEventStore.getState();
  store.upsertServerDraft(
    localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50, currency: "GBP" })], clientRevision: 3 }),
  );
  store.markDraftDirty(id, 9);
  store.updateDraft(id, { name, clientRevision: 9 });
};

describe("#3645 polish D2: a save that cannot go through is visible, and recovers", () => {
  test("four edits while the server's copy cannot be read show a failed save each time and write nothing; when the read recovers the next edit saves", async () => {
    const id = nextDraftId();
    server = baseServer(id, {
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [ticket({ priceGbp: 7000, currency: "NGN" })] },
      failDraftReads: true,
    });
    installServer();
    seedOfflineEdits(id, "Typed offline");
    const route = await mountRoute(id, "GBP");
    await settle(40);

    for (let n = 1; n <= 4; n += 1) {
      route.edit({ name: `Edit ${n} while the read fails` });
      await settle(40);
      // Nothing is written on a guess ...
      expect(server.saves).toHaveLength(0);
      expect((server.businessDraft.tickets as TicketStub[])[0]?.priceGbp).toBe(7000);
      // ... and the host can SEE that their edit is not saved.
      expect(route.saveFailed()).toBe(true);
    }
    expect(warnSpy).toHaveBeenCalled();

    // The network is back. The next edit is saved, in the row's currency, with
    // the row's price and the host's own words.
    server.failDraftReads = false;
    route.edit({ name: "Edit 5, back online" });
    await settle(120);
    expect(server.saves.length).toBeGreaterThanOrEqual(1);
    expect(server.saves.every((s) => s.currency === "NGN")).toBe(true);
    expect((server.businessDraft.tickets as TicketStub[])[0]?.priceGbp).toBe(7000);
    expect(server.title).toBe("Edit 5, back online");
    expect(route.saveFailed()).toBe(false);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    expect(route.notices).toEqual([]);

    // And saving is ordinary from here on.
    const before = server.saves.length;
    route.edit({ name: "Edit 6" });
    await settle(60);
    expect(server.saves).toHaveLength(before + 1);
    expect(server.title).toBe("Edit 6");
    route.unmount();
  });
});

describe("#3645 polish D3: the host's unsaved text survives the replace", () => {
  test("an offline title edit is kept and saved; only the currency and the price come from the server", async () => {
    const id = nextDraftId();
    server = baseServer(id, {
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [ticket({ priceGbp: 7000, currency: "NGN" })] },
    });
    installServer();
    seedOfflineEdits(id, "My offline title");
    const route = await mountRoute(id, "GBP");
    await settle(120);

    // This device: the server's currency and price, the host's own title.
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    expect(route.draft()?.name).toBe("My offline title");
    // And that title reached the server, with the price untouched.
    expect(server.title).toBe("My offline title");
    expect((server.businessDraft.tickets as TicketStub[])[0]?.priceGbp).toBe(7000);
    expect(server.rowCurrency).toBe("NGN");
    expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
    expect(JSON.stringify(server.saves)).not.toContain("GBP");
    expect(route.notices).toEqual([]);
    route.unmount();
  });

  test("a copy with nothing unsaved is replaced whole, and nothing is saved", async () => {
    const id = nextDraftId();
    server = baseServer(id, {
      title: "Renamed on the other device",
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [ticket({ priceGbp: 7000, currency: "NGN" })] },
    });
    installServer();
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50, currency: "GBP" })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    await settle(120);
    expect(route.draft()?.name).toBe("Renamed on the other device");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(7000);
    expect(server.saves).toHaveLength(0);
    route.unmount();
  });
});

describe("#3645 polish D5: what the host is told after a refused Publish", () => {
  const refusal = { message: "price_reentry_required", code: "P0001" };
  const answer = (outcome: string): void => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
  };
  const run = async (outcome: string, onSynced: () => void = () => undefined): Promise<unknown> => {
    answer(outcome);
    try {
      await publishWithDraftCurrencySync("event-1", () => Promise.reject(refusal), onSynced);
    } catch (error) {
      return error;
    }
    return null;
  };

  test("a brand with no currency: 'Choose a payout country for your brand first.'", async () => {
    const caught = await run("brand_has_no_currency");
    expect(caught).toBeInstanceOf(Error);
    const code = (caught as Error).message;
    expect(code).toBe("draft_currency_brand_has_none");
    expect(describeUnmappedPublishGuard(code)).toBe("Choose a payout country for your brand first.");
    expect(rsvpRpcFailureCopy(caught, "publish this RSVP")).toBe(DRAFT_CURRENCY_BRAND_HAS_NONE_COPY);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("no longer a draft: it is read again and nothing new is raised", async () => {
    const onSynced = jest.fn<() => void>();
    const caught = await run("not_a_draft", onSynced);
    expect(caught).toBe(refusal);
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  test("every answer the server can give maps to a code, or to none", () => {
    for (const moved of ["moved_prices_cleared", "moved", "in_step", "not_a_draft"]) {
      expect(draftCurrencySyncOutcomeCode(moved)).toBeNull();
    }
    expect(draftCurrencySyncOutcomeCode("brand_has_no_currency")).toBe("draft_currency_brand_has_none");
    for (const blocked of ["checkout_in_progress", "sale_exists", "unpublished_after_sale", "something_new"]) {
      expect(draftCurrencySyncOutcomeCode(blocked)).toBe("draft_currency_checkout_in_progress");
    }
  });
});
