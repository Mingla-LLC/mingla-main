/**
 * Issue #3645 — tester RETEST 3 of "a draft follows its brand's currency".
 *
 * Retest 2 failed on two P1s. Rework 3 says:
 *   A. Re-opening a draft never clears prices someone entered since: the hook
 *      acts only on what THIS visit learned, drops it when the screen closes,
 *      and this device clears its own prices only when the server row it read
 *      carries the server's "prices were cleared" note. A copy priced in
 *      another currency than a row the server did NOT clear is replaced by the
 *      server's copy and nothing is written.
 *   B. A Publish refused with `price_reentry_required` asks the server to
 *      bring that one draft in step (`biz_sync_draft_currency`) and re-reads
 *      it.
 *
 * This suite mounts the REAL pieces a draft route mounts (the draft store,
 * `useDraftFollowsBrandCurrency`, `useServerDraftAutosave`,
 * `autosaveServerDraft`) against an in-memory server, and takes angles the
 * implementor's re-open suite does not:
 *
 *   A. The retest-2 scenario, replayed: opened in pounds, closed, the brand
 *      goes to naira, the draft is re-priced elsewhere at 7000 naira, then
 *      re-opened here with a fast read and with a slow read, with an edit made
 *      while the read is still out, after a save that failed, and for an RSVP.
 *   B. What the server's copy replaces: only a copy priced in ANOTHER currency.
 *      Same currency, no currency on either side, and a draft the server never
 *      moved are saved as typed (nothing is discarded, no save writes nothing).
 *   C. The server's copy cannot be read when it is needed: the next edit still
 *      ends with the device on the server's copy; it is not left saving
 *      nothing for ever.
 *   D. The publish wrapper: the sync is asked for ONLY after
 *      `price_reentry_required`, once, and never after a success or another
 *      refusal; what each server answer becomes for the host.
 *   E. Property-style: 3 seeds x 300 turns of visits, edits, brand currency
 *      changes and prices entered ELSEWHERE between visits. A price entered
 *      elsewhere after the last currency change is never cleared or replaced
 *      by this device unless the host typed a new one here.
 *   F. Source contracts for the two publish paths this file cannot mount.
 *
 * Verified to fail against the product files of e54f72d19 (the retest-2
 * head): see the tester's report on issue #3645.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as React from "react";
import * as fs from "fs";
import * as path from "path";
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
  /** The next N reads of the WHOLE draft row fail (not the save's own small read). */
  failRowReads: number;
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
    if (table === "brands") {
      // The save's last resort for a draft with no currency anywhere.
      let brandId = "";
      const brands: Record<string, unknown> = {};
      for (const method of ["select", "is"]) brands[method] = jest.fn(() => brands);
      brands.eq = jest.fn((column: unknown, value: unknown) => {
        if (column === "id") brandId = String(value);
        return brands;
      });
      brands.maybeSingle = jest.fn(() =>
        net.offline
          ? Promise.resolve({ data: null, error: transportError() })
          : Promise.resolve({
              data: { default_currency: brandCurrency.get(brandId) ?? null },
              error: null,
            }),
      );
      return brands;
    }
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
      if (!wantsBrand) {
        if (columns !== "theme,currency" && net.failRowReads > 0) {
          net.failRowReads -= 1;
          return Promise.resolve({ data: null, error: transportError() });
        }
        return Promise.resolve({ data: serverRow(d), error: null });
      }
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
    failRowReads: 0,
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

// ─── "Elsewhere": another device, on the current build ───────────────────────
/**
 * Someone opens the draft on another device after the currency change, is
 * told the prices were cleared (that device's save resolves the note) and
 * enters a new price in the currency the draft is now in.
 */
const repricedElsewhere = (draftId: string, price: number): void => {
  const d = drafts.get(draftId);
  if (d === undefined) throw new Error("no such draft");
  const revision = Number(d.businessDraft.clientRevision ?? 0) + 2;
  const tickets = ((d.businessDraft.tickets as TicketStub[] | undefined) ?? []).map((t) =>
    t.isFree ? t : { ...t, priceGbp: price, currency: d.rowCurrency ?? undefined },
  );
  const { pricesClearedForCurrencyChange: _note, ...rest } = d.businessDraft;
  d.businessDraft = { ...rest, tickets, clientRevision: revision };
};

const chipInsElsewhere = (draftId: string, suggested: number, minimum: number): void => {
  const d = drafts.get(draftId);
  if (d === undefined) throw new Error("no such draft");
  const { pricesClearedForCurrencyChange: _note, ...rest } = d.businessDraft;
  d.businessDraft = {
    ...rest,
    rsvpContributionSuggestedCents: suggested,
    rsvpContributionMinCents: minimum,
    clientRevision: Number(d.businessDraft.clientRevision ?? 0) + 2,
  };
  d.suggestedCents = suggested;
  d.minCents = minimum;
};

const serverPrice = (draftId: string): unknown =>
  savedTicketPrice(drafts.get(draftId)?.businessDraft ?? {});
const localPrice = (m: Mounted): unknown =>
  m.draft()?.tickets.find((t) => t.id === "t_paid")?.priceGbp;

// ─── A. The retest-2 scenario ────────────────────────────────────────────────
describe("#3645 retest 3: a draft re-priced elsewhere is re-opened here", () => {
  /** Opened in pounds at 50 and closed; brand to naira; 7000 naira entered elsewhere. */
  const arrange = async (): Promise<string> => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const first = await mountRoute(id, "GBP");
    expect(first.notices).toEqual([]);
    await first.unmount();
    serverChangesBrandCurrency(BRAND_A, "NGN");
    expect(serverPrice(id)).toBeNull();
    repricedElsewhere(id, 7000);
    return id;
  };

  test("fast read: nothing is written, the device shows 7000 naira, and the host is told nothing was cleared", async () => {
    const id = await arrange();
    const again = await mountRoute(id, "GBP");
    const server = drafts.get(id);
    expect(server?.saves).toEqual([]);
    expect(server?.rowCurrency).toBe("NGN");
    expect(serverPrice(id)).toBe(7000);
    expect(again.draft()?.currency).toBe("NGN");
    expect(localPrice(again)).toBe(7000);
    expect(again.notices).toEqual([]);
    await again.unmount();
  });

  test("slow read: while the answer is out nothing is cleared or saved; when it arrives the device takes 7000 naira", async () => {
    const id = await arrange();
    net.holdBrandReads = true;
    const again = await mountRoute(id, "GBP");
    // The read is still out. The device still holds its own old copy.
    expect(drafts.get(id)?.saves).toEqual([]);
    expect(localPrice(again)).toBe(50);
    expect(again.draft()?.currency).toBe("GBP");
    net.holdBrandReads = false;
    await releaseHeld();
    await settle(40);
    expect(drafts.get(id)?.saves).toEqual([]);
    expect(serverPrice(id)).toBe(7000);
    expect(localPrice(again)).toBe(7000);
    expect(again.draft()?.currency).toBe("NGN");
    expect(again.notices).toEqual([]);
    await again.unmount();
  });

  test("slow read, and the host edits the title before it arrives: the 7000 naira is never cleared and no pound number is stored", async () => {
    const id = await arrange();
    net.holdBrandReads = true;
    const again = await mountRoute(id, "GBP");
    await act(async () => {
      again.edit({ name: "Lagos launch, take two" });
    });
    await settle(40);
    net.holdBrandReads = false;
    await releaseHeld();
    await settle(60);
    const server = drafts.get(id);
    expect(server?.rowCurrency).toBe("NGN");
    expect(serverPrice(id)).toBe(7000);
    for (const save of server?.saves ?? []) {
      expect(save.currency).toBe("NGN");
      expect(savedTicketPrice(save.businessDraft)).toBe(7000);
    }
    expect(localPrice(again)).toBe(7000);
    expect(again.draft()?.currency).toBe("NGN");
    await again.unmount();
  });

  test("three visits in a row after the re-price: no visit writes anything", async () => {
    const id = await arrange();
    for (let visit = 0; visit < 3; visit += 1) {
      const m = await mountRoute(id, visit === 0 ? "GBP" : "NGN");
      expect(m.notices).toEqual([]);
      await m.unmount();
    }
    expect(drafts.get(id)?.saves).toEqual([]);
    expect(serverPrice(id)).toBe(7000);
  });

  test("what an earlier visit was told is gone once the screen closes", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const first = await mountRoute(id, "GBP");
    expect(draftServerCurrency.getDraftServerCurrency(id)).toBe("GBP");
    await first.unmount();
    expect(draftServerCurrency.getDraftServerCurrency(id)).toBeUndefined();
  });

  test("an RSVP whose chip-in amounts were entered again elsewhere: re-opening writes nothing and keeps them", async () => {
    const id = seedRsvp(BRAND_A, "GBP");
    const first = await mountRoute(id, "GBP");
    await first.unmount();
    serverChangesBrandCurrency(BRAND_A, "NGN");
    chipInsElsewhere(id, 700000, 200000);
    const again = await mountRoute(id, "GBP");
    const server = drafts.get(id);
    expect(server?.saves).toEqual([]);
    expect(server?.suggestedCents).toBe(700000);
    expect(server?.minCents).toBe(200000);
    expect(again.draft()?.rsvpContributionSuggestedCents).toBe(700000);
    expect(again.draft()?.currency).toBe("NGN");
    expect(again.notices).toEqual([]);
    await again.unmount();
  });

  test("the server cleared the draft and nobody has re-priced it: the host IS told, once, and the old number is not kept", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const first = await mountRoute(id, "GBP");
    await first.unmount();
    serverChangesBrandCurrency(BRAND_A, "NGN");
    const again = await mountRoute(id, "GBP");
    expect(again.notices).toEqual([notice("NGN")]);
    expect(localPrice(again)).toBeNull();
    expect(again.draft()?.currency).toBe("NGN");
    expect(serverPrice(id)).toBeNull();
    for (const save of drafts.get(id)?.saves ?? []) {
      expect(save.currency).toBe("NGN");
      expect(savedTicketPrice(save.businessDraft)).toBeNull();
    }
    await again.unmount();
  });
});

// ─── B. What the server's copy replaces, and what it must not ────────────────
describe("#3645 retest 3: the server's copy replaces only a copy priced in another currency", () => {
  test("same currency: a price typed here is saved, not discarded", async () => {
    const id = seedEvent(BRAND_A, "NGN", 5000);
    const m = await mountRoute(id, "NGN");
    await act(async () => {
      m.edit({ tickets: [ticket({ priceGbp: 6500, currency: "NGN" })] });
    });
    await settle(40);
    expect(serverPrice(id)).toBe(6500);
    expect(localPrice(m)).toBe(6500);
    expect(drafts.get(id)?.saves.length).toBe(1);
    await m.unmount();
  });

  test("a brand with no currency and a draft with none: a typed price is saved and kept, with no notice", async () => {
    const id = nextDraftId();
    brandCurrency.set(BRAND_A, null);
    addDraft({ draftId: id, brandId: BRAND_A, rowCurrency: null });
    useDraftEventStore
      .getState()
      .upsertServerDraft(localDraft(BRAND_A, id, { currency: null, tickets: [], clientRevision: 3 }));
    const m = await mountRoute(id, null);
    await act(async () => {
      m.edit({ tickets: [ticket({ priceGbp: 40 })] });
    });
    await settle(40);
    expect(serverPrice(id)).toBe(40);
    expect(localPrice(m)).toBe(40);
    expect(m.notices).toEqual([]);
    await m.unmount();
  });

  test("a draft with no currency on the server, a brand with none, and a device copy that carries a placeholder currency: the typed price is saved, not lost and not stuck", async () => {
    const id = nextDraftId();
    brandCurrency.set(BRAND_A, null);
    addDraft({ draftId: id, brandId: BRAND_A, rowCurrency: null });
    useDraftEventStore.getState().upsertServerDraft(
      localDraft(BRAND_A, id, {
        currency: "GBP",
        tickets: [ticket({ priceGbp: 40, currency: "GBP" })],
        clientRevision: 3,
      }),
    );
    const m = await mountRoute(id, null);
    await act(async () => {
      m.edit({ name: "Placeholder pounds" });
    });
    await settle(40);
    const server = drafts.get(id);
    expect(server?.saves.length).toBe(1);
    expect(serverPrice(id)).toBe(40);
    expect(localPrice(m)).toBe(40);
    expect(m.notices).toEqual([]);
    await m.unmount();
  });

  test("a draft the server never moved (the web shipped before the migration): prices typed here keep saving in the draft's own currency", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const d = drafts.get(id);
    if (d !== undefined) d.notMovedByServer = true;
    serverChangesBrandCurrency(BRAND_A, "NGN");
    const m = await mountRoute(id, "NGN");
    await act(async () => {
      m.edit({ tickets: [ticket({ priceGbp: 65, currency: "GBP" })] });
    });
    await settle(40);
    expect(drafts.get(id)?.rowCurrency).toBe("GBP");
    expect(serverPrice(id)).toBe(65);
    expect(localPrice(m)).toBe(65);
    expect(m.notices).toEqual([]);
    await m.unmount();
  });

  test("a copy in another currency that holds NO price takes the server's currency and its other edits are saved", async () => {
    const id = nextDraftId();
    brandCurrency.set(BRAND_A, "NGN");
    addDraft({ draftId: id, brandId: BRAND_A, rowCurrency: "NGN" });
    useDraftEventStore
      .getState()
      .upsertServerDraft(localDraft(BRAND_A, id, { currency: "GBP", tickets: [], clientRevision: 3 }));
    const m = await mountRoute(id, "GBP");
    await act(async () => {
      m.edit({ name: "No price yet" });
    });
    await settle(40);
    const server = drafts.get(id);
    expect(server?.title).toBe("No price yet");
    expect(server?.rowCurrency).toBe("NGN");
    expect(m.draft()?.currency).toBe("NGN");
    expect(m.notices).toEqual([]);
    await m.unmount();
  });
});

// ─── C. The server's copy cannot be read when it is needed ───────────────────
describe("#3645 retest 3: the read of the server's copy fails", () => {
  test("the first read fails; the host's next edit still ends on the server's 7000 naira, and saving is not left writing nothing", async () => {
    const id = seedEvent(BRAND_A, "GBP", 50);
    const first = await mountRoute(id, "GBP");
    await first.unmount();
    serverChangesBrandCurrency(BRAND_A, "NGN");
    repricedElsewhere(id, 7000);

    net.failRowReads = 1;
    const again = await mountRoute(id, "GBP");
    expect(drafts.get(id)?.saves).toEqual([]);
    expect(serverPrice(id)).toBe(7000);

    await act(async () => {
      again.edit({ name: "After the failed read" });
    });
    await settle(60);
    expect(serverPrice(id)).toBe(7000);
    expect(localPrice(again)).toBe(7000);
    expect(again.draft()?.currency).toBe("NGN");

    // From here on an edit saves normally.
    await act(async () => {
      again.edit({ name: "Saved in naira" });
    });
    await settle(60);
    const server = drafts.get(id);
    expect(server?.title).toBe("Saved in naira");
    expect(server?.rowCurrency).toBe("NGN");
    expect(serverPrice(id)).toBe(7000);
    await again.unmount();
  });
});

// ─── D. The publish wrapper ──────────────────────────────────────────────────
describe("#3645 retest 3: the way out of a refused Publish", () => {
  interface SyncModule {
    publishWithDraftCurrencySync: <T>(
      eventId: string,
      publish: () => Promise<T>,
      onSynced: () => Promise<void> | void,
    ) => Promise<T>;
  }
  // Loaded here, not at the top: this module did not exist before rework 3 and
  // the rest of this file must still load against the older product files.
  const load = (): SyncModule =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../draftCurrencySync") as SyncModule;

  const syncCalls = (): unknown[][] =>
    mockRpc.mock.calls.filter((call) => call[0] === "biz_sync_draft_currency");

  const answerSync = (outcome: unknown, error: unknown = null): void => {
    mockRpc.mockImplementation((name: unknown) =>
      name === "biz_sync_draft_currency"
        ? Promise.resolve({ data: error === null ? { outcome } : null, error })
        : Promise.reject(new Error(`unexpected rpc ${String(name)}`)),
    );
  };

  test("a Publish that succeeds never asks for the sync", async () => {
    answerSync("moved_prices_cleared");
    const onSynced = jest.fn<() => void>();
    const result = await load().publishWithDraftCurrencySync("e1", () => Promise.resolve("live"), onSynced);
    expect(result).toBe("live");
    expect(syncCalls()).toEqual([]);
    expect(onSynced).not.toHaveBeenCalled();
  });

  test.each([
    ["stripe_charges_disabled"],
    ["organiser_terms_not_accepted"],
    ["event_currency_required"],
    ["price_reentry_required: extra"],
    ["Network request failed"],
  ])("a Publish refused with %s is passed on untouched and never asks for the sync", async (message) => {
    answerSync("moved_prices_cleared");
    const refusal = new Error(message);
    const onSynced = jest.fn<() => void>();
    await expect(
      load().publishWithDraftCurrencySync("e1", () => Promise.reject(refusal), onSynced),
    ).rejects.toBe(refusal);
    expect(syncCalls()).toEqual([]);
    expect(onSynced).not.toHaveBeenCalled();
  });

  test.each([["moved_prices_cleared"], ["moved"], ["in_step"]])(
    "refused, and the server answers %s: one sync for that draft, the draft is re-read, Publish is NOT sent again, and the host is told to enter prices",
    async (outcome) => {
      answerSync(outcome);
      const publish = jest.fn<() => Promise<string>>(() =>
        Promise.reject({ message: "price_reentry_required" }),
      );
      const order: string[] = [];
      const onSynced = jest.fn<() => void>(() => {
        order.push(`read after ${syncCalls().length} sync`);
      });
      await expect(
        load().publishWithDraftCurrencySync("event-9", publish, onSynced),
      ).rejects.toEqual({ message: "price_reentry_required" });
      expect(syncCalls()).toEqual([["biz_sync_draft_currency", { p_event_id: "event-9" }]]);
      expect(order).toEqual(["read after 1 sync"]);
      expect(publish).toHaveBeenCalledTimes(1);
    },
  );

  test.each([["checkout_in_progress"], ["sale_exists"], ["unpublished_after_sale"]])(
    "refused, and the server will not move the draft (%s): the host is told it cannot be published yet, not to enter prices",
    async (outcome) => {
      answerSync(outcome);
      const onSynced = jest.fn<() => void>();
      await expect(
        load().publishWithDraftCurrencySync(
          "event-9",
          () => Promise.reject(new Error("price_reentry_required")),
          onSynced,
        ),
      ).rejects.toThrow("draft_currency_checkout_in_progress");
      expect(syncCalls().length).toBe(1);
    },
  );

  test("the sync itself fails: the original refusal stands, and it is not swallowed", async () => {
    answerSync(null, { message: "insufficient_event_permission" });
    const refusal = new Error("price_reentry_required");
    const onSynced = jest.fn<() => void>();
    await expect(
      load().publishWithDraftCurrencySync("event-9", () => Promise.reject(refusal), onSynced),
    ).rejects.toBe(refusal);
    expect(onSynced).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("the re-read fails after a move: the refusal still reaches the host", async () => {
    answerSync("moved_prices_cleared");
    const refusal = new Error("price_reentry_required");
    await expect(
      load().publishWithDraftCurrencySync(
        "event-9",
        () => Promise.reject(refusal),
        () => Promise.reject(new Error("offline")),
      ),
    ).rejects.toBe(refusal);
  });

  test("both refusals have plain words in every publish surface's copy", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const guards = require("../../utils/paidPublishGuards") as {
      describeUnmappedPublishGuard: (raw: string) => string;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rsvp = require("../rsvpRpcFailure") as {
      rsvpRpcFailureCopy: (error: unknown, action: string) => string;
    };
    for (const code of ["price_reentry_required", "draft_currency_checkout_in_progress"]) {
      const eventCopy = guards.describeUnmappedPublishGuard(code);
      const rsvpCopy = rsvp.rsvpRpcFailureCopy(new Error(code), "publish this RSVP");
      for (const copy of [eventCopy, rsvpCopy]) {
        expect(copy).not.toContain(code);
        expect(copy).not.toMatch(/_/);
        expect(copy.length).toBeGreaterThan(20);
      }
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ─── E. Property-style ───────────────────────────────────────────────────────
describe("#3645 retest 3: 300 random turns per seed, with prices entered elsewhere between visits", () => {
  const rng = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  test.each([[11], [2026], [364533]])("seed %i", async (seed) => {
    SAVE_STORM_LIMIT = 100000;
    const random = rng(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const currencies = ["GBP", "NGN", "USD"] as const;
    const id = seedEvent(BRAND_A, "GBP", 50);
    const server = drafts.get(id);
    if (server === undefined) throw new Error("no server draft");

    let mounted: Mounted | null = await mountRoute(id, "GBP");
    // The price nobody on this device may clear: entered elsewhere, or typed
    // here, since the last currency change. Null = none.
    let protectedPrice: { price: number; currency: string } | null = { price: 50, currency: "GBP" };
    let checkedSaves = 0;
    let nextPrice = 100;

    const check = (label: string): void => {
      for (; checkedSaves < server.saves.length; checkedSaves += 1) {
        const save = server.saves[checkedSaves];
        if (save === undefined) continue;
        // A save never changes the currency of a row that has one.
        if (save.rowCurrencyBefore !== null) {
          expect(`${label}: ${save.currency}`).toBe(`${label}: ${save.rowCurrencyBefore}`);
        }
      }
      if (protectedPrice !== null) {
        expect(`${label}: ${String(serverPrice(id))} ${String(server.rowCurrency)}`).toBe(
          `${label}: ${protectedPrice.price} ${protectedPrice.currency}`,
        );
      }
    };

    for (let turn = 0; turn < 300; turn += 1) {
      const roll = random();
      const label = `seed ${seed} turn ${turn}`;
      if (roll < 0.14) {
        // The brand's currency changes (possibly to the same one).
        const to = pick(currencies);
        const before = server.rowCurrency;
        serverChangesBrandCurrency(BRAND_A, to);
        if (before !== to) protectedPrice = null;
      } else if (roll < 0.30) {
        // Someone enters a price elsewhere, in the currency the draft is in.
        nextPrice += 7;
        repricedElsewhere(id, nextPrice);
        if (server.rowCurrency !== null) {
          protectedPrice = { price: nextPrice, currency: server.rowCurrency };
        }
      } else if (roll < 0.50) {
        // The screen closes, or opens again.
        if (mounted !== null) {
          await settle(30);
          await mounted.unmount();
          mounted = null;
        } else {
          net.holdBrandReads = random() < 0.3;
          mounted = await mountRoute(id, pick(currencies), 6);
        }
      } else if (roll < 0.60) {
        net.holdBrandReads = false;
        await releaseHeld();
      } else if (mounted !== null) {
        const open = mounted;
        if (roll < 0.85) {
          await act(async () => {
            open.edit({ name: `Title ${turn}` });
          });
        } else {
          // The host types a price here. It is theirs only if the screen has
          // come to rest on the server's currency first.
          net.holdBrandReads = false;
          await releaseHeld();
          await settle(40);
          const local = open.draft();
          if (local !== null && local.currency === server.rowCurrency && local.currency !== null) {
            nextPrice += 7;
            const typed = nextPrice;
            const currency = local.currency ?? undefined;
            await act(async () => {
              open.edit({ tickets: [ticket({ priceGbp: typed, currency })] });
            });
            await settle(40);
            if (serverPrice(id) === typed) {
              protectedPrice = { price: typed, currency: String(server.rowCurrency) };
            }
          }
        }
      }
      await settle(4);
      check(label);
    }

    net.holdBrandReads = false;
    await releaseHeld();
    if (mounted === null) mounted = await mountRoute(id, "GBP");
    await settle(80);
    // A screen left open across a currency change learns of it on its next
    // save, so the host touches the title once more before the last look.
    const last = mounted;
    await act(async () => {
      last.edit({ name: "Last edit" });
    });
    await settle(80);
    check(`seed ${seed} at rest`);
    // At rest the device shows the server's currency and the server's price.
    expect(mounted.draft()?.currency).toBe(server.rowCurrency);
    expect(localPrice(mounted) ?? null).toBe((serverPrice(id) as number | null | undefined) ?? null);
    const savesAtRest = server.saves.length;
    await settle(60);
    expect(server.saves.length).toBe(savesAtRest);
    await mounted.unmount();
  }, 120000);
});

// ─── F. Source contracts ─────────────────────────────────────────────────────
describe("#3645 retest 3: source contracts", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const walk = (dir: string, out: string[]): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const productFiles = [...walk(path.join(root, "src"), []), ...walk(path.join(root, "app"), [])];

  test("the sync function has exactly one caller in the app, and it sits behind a refused Publish", () => {
    const callers = productFiles.filter((file) =>
      /rpc\(\s*["']biz_sync_draft_currency["']/.test(withoutComments(fs.readFileSync(file, "utf8"))),
    );
    expect(callers.map((file) => path.relative(root, file))).toEqual(["src/services/draftCurrencySync.ts"]);
    const users = productFiles
      .filter((file) => /\bsyncDraftCurrency\(/.test(withoutComments(fs.readFileSync(file, "utf8"))))
      .map((file) => path.relative(root, file));
    expect(users).toEqual(["src/services/draftCurrencySync.ts"]);
  });

  test("every publish call in the app goes through the wrapper", () => {
    const direct = /\b(publishBusinessEventDraft|publishRsvpDraft|publishTrip)\(/;
    const offenders: string[] = [];
    for (const file of productFiles) {
      const relative = path.relative(root, file);
      const source = withoutComments(fs.readFileSync(file, "utf8"));
      if (!direct.test(source)) continue;
      // The services that DEFINE them.
      if (/export (const|async function|function) (publishBusinessEventDraft|publishRsvpDraft|publishTrip)\b/.test(source)) {
        const calls = source.match(new RegExp(direct, "g")) ?? [];
        if (calls.length <= 1) continue;
      }
      if (!source.includes("publishWithDraftCurrencySync(")) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  test("sign-out clears what the server said about every draft, and every waiting note", () => {
    const source = withoutComments(read("src/utils/clearAllStores.ts"));
    expect(source).toMatch(/clearDraftServerCurrencies\(\)/);
    expect(source).toMatch(/clearAllPricesClearedNotes\(\)/);
    draftServerCurrency.setDraftServerCurrency("d-1", "GBP");
    (draftServerCurrency as { clearDraftServerCurrencies?: () => void }).clearDraftServerCurrencies?.();
    expect(draftServerCurrency.getDraftServerCurrency("d-1")).toBeUndefined();
  });
});
