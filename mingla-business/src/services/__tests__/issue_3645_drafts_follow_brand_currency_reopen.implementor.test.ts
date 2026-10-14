/**
 * Issue #3645 — implementor proof for retest 2, client half.
 *
 * P1-A. A re-priced draft was wiped on re-open. This session had opened the
 * draft while the brand sold in pounds, and closed it. The brand moved to
 * naira and someone else (another tab, a teammate, Ari) re-priced the draft at
 * 7000 naira. On re-open the hook still held "pounds" from the earlier visit
 * and acted on it before this visit's own read returned: one save wrote naira
 * with NO price over the 7000, and the notice named the wrong currency.
 *
 * Now the hook acts only on what THIS visit learned, drops it when the screen
 * closes, and sign-out clears it. And one invariant: this device clears its
 * own prices ONLY when the server row it read carries the cleared state (the
 * server's note), never because two currencies differ. A copy in another
 * currency than a row the server did not clear is replaced by the server's.
 *
 * P1-B (client side). Publish refused with `price_reentry_required`: the
 * server is asked to bring that one draft in step, the draft is re-read, and
 * the host gets plain words either way.
 *
 * The harness follows the tester's retest files.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
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
  getPricesClearedNote,
  recordPricesClearedNote,
  resetPricesClearedNotesForTest,
} from "../../utils/draftPricesClearedNote";
import { clearAllStores } from "../../utils/clearAllStores";
import {
  DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY,
  PRICE_REENTRY_PUBLISH_COPY,
} from "../../utils/draftCurrencyPublishRefusal";
import { describeUnmappedPublishGuard } from "../../utils/paidPublishGuards";
import { publishWithDraftCurrencySync } from "../draftCurrencySync";
import { rsvpRpcFailureCopy } from "../rsvpRpcFailure";
import {
  draftServerCurrencySequence,
  getDraftServerCurrency,
  getDraftServerCurrencyAnswer,
  resetDraftServerCurrencyForTest,
  setDraftServerCurrency,
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
  /** When true, the read made as the draft opens waits until released. */
  holdOpenReads: boolean;
  saves: { rpc: string; currency: string | null; businessDraft: Record<string, unknown> }[];
}

let server: FakeServer;
let heldReads: (() => void)[] = [];
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
        if (server.holdOpenReads && columns.includes("theme")) {
          // Answered later, with what the server holds THEN.
          return new Promise((resolve) => {
            heldReads.push(() => {
              const late = serverRow();
              late.brand = { default_currency: server.brandCurrency };
              resolve({ data: late, error: null });
            });
          });
        }
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
  heldReads = [];
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {}, activeDraftId: null });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});


const releaseHeld = async (): Promise<void> => {
  const waiting = heldReads;
  heldReads = [];
  await act(async () => {
    waiting.forEach((release) => release());
  });
};

const OTHER_PRICE = 7000;

describe("#3645 reopen: a draft someone re-priced is never wiped when this device opens it again", () => {
  for (const [from, to] of [
    ["GBP", "NGN"],
    ["NGN", "GBP"],
  ] as const) {
    for (const openRead of ["fast", "slow"] as const) {
      test(`${from} to ${to}, ${openRead} open-time read: the ${to} price survives, nothing is cleared, no notice`, async () => {
        const id = nextDraftId();
        const priced = ticket({ priceGbp: 50, currency: from });
        server = {
          draftId: id,
          kind: "event",
          title: "Lagos launch",
          brandCurrency: from,
          rowCurrency: from,
          businessDraft: { clientRevision: 3, currency: from, tickets: [priced] },
          suggestedCents: null,
          minCents: null,
          brandReads: 0,
          holdOpenReads: false,
          saves: [],
        };
        installServer();
        useDraftEventStore.getState().upsertServerDraft(
          localDraft(id, { currency: from, tickets: [priced], clientRevision: 3 }),
        );

        // FIRST VISIT: the draft is opened while the brand sells in `from`,
        // and closed again. This session has now been told "`from`".
        const first = await mountRoute(id, from);
        expect(server.saves).toHaveLength(0);
        first.unmount();
        await settle(10);

        // The brand moves to `to`, and someone else re-prices the draft there.
        // Their copy carries the SAME revision this device holds, so nothing
        // but the rule under test stops a stale save from landing.
        const repriced = ticket({ priceGbp: OTHER_PRICE, currency: to });
        server.brandCurrency = to;
        server.rowCurrency = to;
        server.businessDraft = { clientRevision: 3, currency: to, tickets: [repriced] };

        // SECOND VISIT. This device still holds `from` and 50.
        server.holdOpenReads = openRead === "slow";
        const second = await mountRoute(id, from);
        if (openRead === "slow") {
          // The host types before this visit's read has come back.
          expect(heldReads).toHaveLength(1);
          second.edit({ name: "Typed before the read returned" });
          await settle(40);
          server.holdOpenReads = false;
          await releaseHeld();
        }
        await settle(120);

        // The re-priced draft is intact on the server: never cleared, never
        // moved, never given this device's old number.
        expect(server.rowCurrency).toBe(to);
        const stored = (server.businessDraft.tickets as TicketStub[])[0];
        expect(stored?.priceGbp).toBe(OTHER_PRICE);
        expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":null`);
        expect(JSON.stringify(server.saves)).not.toContain(`"priceGbp":50`);
        expect(server.saves.every((s) => s.currency === to)).toBe(true);
        // Nothing of the host's was cleared, so the host is told nothing; in
        // particular nothing names the currency the brand LEFT.
        expect(second.notices).toEqual([]);
        // This device now shows the server's copy.
        expect(second.draft()?.currency).toBe(to);
        expect(second.draft()?.tickets[0]?.priceGbp).toBe(OTHER_PRICE);

        // An ordinary edit afterwards saves once and keeps the price.
        const before = server.saves.length;
        second.edit({ name: "A later edit" });
        await settle(60);
        expect(server.saves).toHaveLength(before + 1);
        expect((server.businessDraft.tickets as TicketStub[])[0]?.priceGbp).toBe(OTHER_PRICE);
        expect(server.title).toBe("A later edit");
        second.unmount();
      });
    }
  }

  test("an answer from an earlier visit is not believed by a later one, and closing the screen drops it", async () => {
    const id = nextDraftId();
    // Left behind by something earlier in this session.
    setDraftServerCurrency(id, "GBP");
    const before = draftServerCurrencySequence();
    const priced = ticket({ priceGbp: OTHER_PRICE, currency: "NGN" });
    server = {
      draftId: id, kind: "event", title: "Lagos launch", brandCurrency: "NGN", rowCurrency: "NGN",
      businessDraft: { clientRevision: 3, currency: "NGN", tickets: [priced] },
      suggestedCents: null, minCents: null, brandReads: 0, holdOpenReads: true, saves: [],
    };
    installServer();
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "NGN", tickets: [priced], clientRevision: 3 }),
    );
    // While this visit's read is held, the only answer anywhere is the old
    // "GBP". Acting on it would move a correct naira draft to pounds.
    const route = await mountRoute(id, "GBP");
    await settle(40);
    expect(getDraftServerCurrencyAnswer(id)?.seq).toBeLessThanOrEqual(before);
    expect(server.saves).toHaveLength(0);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBe(OTHER_PRICE);
    expect(route.notices).toEqual([]);

    server.holdOpenReads = false;
    await releaseHeld();
    await settle(40);
    expect(getDraftServerCurrency(id)).toBe("NGN");
    expect(server.saves).toHaveLength(0);

    route.unmount();
    await settle(10);
    expect(getDraftServerCurrency(id)).toBeUndefined();
  });

  test("the server DID clear the draft: this visit reads the row's own note, clears, and tells the host once", async () => {
    const id = nextDraftId();
    server = {
      draftId: id, kind: "event", title: "Lagos launch", brandCurrency: "NGN", rowCurrency: "NGN",
      businessDraft: {
        clientRevision: 3, currency: "NGN",
        tickets: [ticket({ priceGbp: null, currency: "NGN" })],
        pricesClearedForCurrencyChange: { from: "GBP", to: "NGN" },
      },
      suggestedCents: null, minCents: null, brandReads: 0, holdOpenReads: false, saves: [],
    };
    installServer();
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(id, { currency: "GBP", tickets: [ticket({ priceGbp: 50, currency: "GBP" })], clientRevision: 3 }),
    );
    const route = await mountRoute(id, "GBP");
    await settle(120);
    expect(route.notices).toEqual(["Your brand now sells in Nigerian naira. Enter your prices again."]);
    expect(route.draft()?.currency).toBe("NGN");
    expect(route.draft()?.tickets[0]?.priceGbp).toBeNull();
    expect(server.saves.length).toBeLessThanOrEqual(2);
    expect(server.businessDraft.pricesClearedForCurrencyChange ?? null).toBeNull();
    route.unmount();
  });

  test("sign-out clears every answer and every note held for this account", () => {
    setDraftServerCurrency("draft-a", "GBP");
    setDraftServerCurrency("draft-b", "NGN");
    recordPricesClearedNote("draft-a", {
      business_draft: { pricesClearedForCurrencyChange: { from: "GBP", to: "NGN" } },
    });
    clearAllStores();
    expect(getDraftServerCurrency("draft-a")).toBeUndefined();
    expect(getDraftServerCurrency("draft-b")).toBeUndefined();
    expect(getPricesClearedNote("draft-a")).toBeNull();
  });
});

describe("#3645 reopen: Publish refused because the draft is out of step with its brand", () => {
  const refusal = { message: "price_reentry_required", code: "P0001" };

  test("the server is asked to bring the draft in step, the draft is re-read, and the refusal stands", async () => {
    mockRpc.mockResolvedValue({ data: { outcome: "moved_prices_cleared", currency: "NGN" }, error: null });
    const onSynced = jest.fn(() => Promise.resolve());
    await expect(
      publishWithDraftCurrencySync("event-1", () => Promise.reject(refusal), onSynced),
    ).rejects.toBe(refusal);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("biz_sync_draft_currency", { p_event_id: "event-1" });
    expect(onSynced).toHaveBeenCalledTimes(1);
    // The words the wizards show for that refusal.
    expect(describeUnmappedPublishGuard("price_reentry_required")).toBe(PRICE_REENTRY_PUBLISH_COPY);
    expect(rsvpRpcFailureCopy(refusal, "publish this RSVP")).toBe(PRICE_REENTRY_PUBLISH_COPY);
    expect(PRICE_REENTRY_PUBLISH_COPY).toBe(
      "Your brand's currency changed. Enter your prices again before publishing.",
    );
  });

  test.each(["checkout_in_progress", "sale_exists", "unpublished_after_sale"])(
    "the server will not move it (%s): the host is told to wait, in plain words",
    async (outcome) => {
      mockRpc.mockResolvedValue({ data: { outcome }, error: null });
      let caught: unknown = null;
      try {
        await publishWithDraftCurrencySync("event-1", () => Promise.reject(refusal), () => undefined);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const code = (caught as Error).message;
      expect(code).toBe("draft_currency_checkout_in_progress");
      expect(describeUnmappedPublishGuard(code)).toBe(DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY);
      expect(rsvpRpcFailureCopy(caught, "publish this RSVP")).toBe(DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY);
      expect(DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY).toBe(
        "This event has a checkout in progress. Try again in a few minutes, or contact support.",
      );
    },
  );

  test("any other refusal, and a publish that works, never call the server function", async () => {
    const other = { message: "stripe_charges_disabled", code: "P0001" };
    await expect(
      publishWithDraftCurrencySync("event-1", () => Promise.reject(other), () => undefined),
    ).rejects.toBe(other);
    await expect(
      publishWithDraftCurrencySync("event-1", () => Promise.resolve("published"), () => undefined),
    ).resolves.toBe("published");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("if the server cannot be asked, the original refusal stands and it is logged", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "network unavailable" } });
    await expect(
      publishWithDraftCurrencySync("event-1", () => Promise.reject(refusal), () => undefined),
    ).rejects.toBe(refusal);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("the server function has exactly one caller, and all three publish hooks go through it", () => {
    const root = path.resolve(__dirname, "../../..");
    const code = (rel: string): string =>
      fs
        .readFileSync(path.join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const files: string[] = [];
    const walk = (abs: string): void => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const next = path.join(abs, entry.name);
        if (entry.isDirectory()) walk(next);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
          files.push(path.relative(root, next));
        }
      }
    };
    walk(path.join(root, "app"));
    walk(path.join(root, "src"));
    expect(files.filter((rel) => code(rel).includes("biz_sync_draft_currency"))).toEqual([
      path.join("src", "services", "draftCurrencySync.ts"),
    ]);
    expect(
      files.filter((rel) => /publishWithDraftCurrencySync\s*\(/.test(code(rel))).sort(),
    ).toEqual([
      path.join("src", "hooks", "useBusinessEvents.ts"),
      path.join("src", "hooks", "useRsvpEvents.ts"),
      path.join("src", "hooks", "useTrips.ts"),
    ]);
    // The hook keeps its answers to the visit that learned them.
    const hook = code(path.join("src", "hooks", "useDraftFollowsBrandCurrency.ts")).replace(/\s+/g, "");
    expect(hook).toContain("sharedAnswer!==undefined&&sharedAnswer.seq>mountSequenceRef.current");
    expect(hook).toContain("forgetDraftServerCurrency(draftId);clearPricesClearedNote(draftId);");
    // And clears prices only on the server's note.
    expect(hook).toContain(
      "serverNote===null&&localCurrency!==null&&serverCurrency!==null&&localCurrency!==serverCurrency&&adoptBrandCurrencyForDraft(draft,serverCurrency).pricesCleared",
    );
  });
});
