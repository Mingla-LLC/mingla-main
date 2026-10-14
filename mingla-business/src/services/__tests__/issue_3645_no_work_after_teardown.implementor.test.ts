/**
 * Issue #3645 — nothing a draft screen started outlives the screen.
 *
 * Found by the `orch-0976-draft-promotion-tests` lane: the read made as a
 * draft opens was still in flight when the screen closed. It then failed (it
 * is retried for several seconds first), and the hook logged that failure
 * after its owner was gone. On a real device that is a closed screen that
 * keeps reading, and a server copy arriving late could still start a save.
 *
 * The rule proved here: once the screen has closed, its open reads are
 * stopped, and a read that comes back late changes nothing, saves nothing and
 * logs nothing. No timer is left behind either.
 *
 * The harness mounts what app/event/[id]/edit.tsx mounts: the autosave hook
 * and the follow-the-brand-currency hook, over a held in-memory server.
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
  type TicketStub,
} from "../../store/draftEventStore";
import { useServerDraftAutosave } from "../../hooks/useServerDraftEvents";
import { useDraftFollowsBrandCurrency } from "../../hooks/useDraftFollowsBrandCurrency";
import { resetPricesClearedNotesForTest } from "../../utils/draftPricesClearedNote";
import { resetDraftServerCurrencyForTest } from "../../utils/draftServerCurrency";

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

// ─── A server whose every read waits until the test answers it ───────────────
interface HeldRead {
  /** True for the small currency read (it asks for the brand). */
  asksBrand: boolean;
  signal: AbortSignal | null;
  answer: (result: { data: unknown; error: unknown }) => void;
}

let heldReads: HeldRead[] = [];
let serverCurrency = "NGN";
let serverTickets: TicketStub[] = [];
let draftId = "";

const serverRow = (): Record<string, unknown> => ({
  id: draftId,
  brand_id: BRAND_ID,
  created_by: "user-1",
  title: "Lagos launch",
  description: null,
  slug: "lagos-launch",
  event_type: "event",
  currency: serverCurrency,
  theme: {
    business_draft: { clientRevision: 3, currency: serverCurrency, tickets: serverTickets },
  },
  visibility: "draft",
  status: "draft",
  timezone: "Africa/Lagos",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  published_at: null,
  deleted_at: null,
  brand: { default_currency: serverCurrency },
});

const installServer = (): void => {
  mockFrom.mockImplementation(() => {
    let columns = "";
    let signal: AbortSignal | null = null;
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "in", "is", "order", "limit"]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.select = jest.fn((cols: unknown) => {
      columns = String(cols);
      return builder;
    });
    builder.abortSignal = jest.fn((given: unknown) => {
      signal = given as AbortSignal;
      return builder;
    });
    builder.maybeSingle = jest.fn(
      () =>
        new Promise((resolve) => {
          heldReads.push({
            asksBrand: columns.includes("brand:brands"),
            signal,
            answer: resolve,
          });
        }),
    );
    return builder;
  });
  mockRpc.mockImplementation(() =>
    Promise.resolve({ data: { event: serverRow() }, error: null }),
  );
};

const settle = async (turns: number): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

const mountRoute = async (): Promise<{ unmount: () => Promise<void> }> => {
  const Route = (): null => {
    // Exactly what app/event/[id]/edit.tsx and app/rsvp/[id]/edit.tsx mount.
    const brandCurrencyRef = React.useRef<string | null>("GBP");
    const autosave = useServerDraftAutosave({ brandCurrencyRef });
    const draft = useDraftById(draftId);
    const onNotice = React.useCallback((): void => undefined, []);
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
  await settle(20);
  return {
    unmount: async () => {
      await act(async () => {
        renderer?.unmount();
      });
      queryClient.clear();
    },
  };
};

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;
let logSpy: ReturnType<typeof jest.spyOn>;

/** Seed this device's copy: 50 pounds, with an edit the host has not saved. */
const seedLocalDraft = (): void => {
  draftId = nextDraftId();
  const store = useDraftEventStore.getState();
  store.upsertServerDraft({
    ...buildDraftEvent(BRAND_ID, draftId, "2026-10-01T10:00:00.000Z"),
    name: "Lagos launch",
    currency: "GBP",
    tickets: [ticket({ priceGbp: 50, currency: "GBP" })],
    clientRevision: 3,
  });
  store.markDraftDirty(draftId, 4);
  store.updateDraft(draftId, { name: "Typed, not saved yet", clientRevision: 4 });
};

/** Everything a closed screen could still do, in one place. */
const expectNothingHappenedAfterClose = (readsAtClose: number): void => {
  expect(mockFrom).toHaveBeenCalledTimes(readsAtClose);
  expect(mockRpc).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
  expect(logSpy).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
  mockFrom.mockReset();
  mockRpc.mockReset();
  resetPricesClearedNotesForTest();
  resetDraftServerCurrencyForTest();
  heldReads = [];
  serverCurrency = "NGN";
  serverTickets = [ticket({ priceGbp: 7000, currency: "NGN" })];
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {}, activeDraftId: null });
  installServer();
  seedLocalDraft();
  // react-test-renderer prints a deprecation line on create; the spies that
  // matter are installed by each test after the screen is up.
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  jest.useRealTimers();
});

describe("#3645: a draft screen's reads stop when the screen does", () => {
  test("closed while the open read is in flight: the read is stopped, and its late failure logs nothing, saves nothing, leaves no timer", async () => {
    const route = await mountRoute();
    expect(heldReads).toHaveLength(1);
    const openRead = heldReads[0] as HeldRead;
    expect(openRead.asksBrand).toBe(true);
    // The read can be stopped, and has not been while the screen is up.
    expect(openRead.signal).not.toBeNull();
    expect(openRead.signal?.aborted).toBe(false);

    errorSpy.mockClear();
    const readsAtClose = mockFrom.mock.calls.length;
    await route.unmount();

    // Closing the screen stops the read.
    expect(openRead.signal?.aborted).toBe(true);

    // The read now fails, as a stopped or offline read does.
    openRead.answer({ data: null, error: { message: "AbortError: This operation was aborted" } });
    await settle(10);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    await settle(10);

    expectNothingHappenedAfterClose(readsAtClose);
    // This device's copy is untouched.
    const local = useDraftEventStore.getState().getDraft(draftId);
    expect(local?.currency).toBe("GBP");
    expect(local?.tickets[0]?.priceGbp).toBe(50);
  });

  test("closed while the server's copy is being fetched: its late arrival starts no save, and its late failure logs nothing", async () => {
    for (const outcome of ["arrives", "fails"] as const) {
      heldReads = [];
      mockFrom.mockClear();
      mockRpc.mockClear();
      seedLocalDraft();
      const route = await mountRoute();
      expect(heldReads).toHaveLength(1);

      // The open read answers: the server holds a naira draft someone priced.
      await act(async () => {
        (heldReads[0] as HeldRead).answer({ data: serverRow(), error: null });
      });
      await settle(20);
      // The screen now fetches the server's whole copy to replace its own.
      expect(heldReads).toHaveLength(2);
      const copyRead = heldReads[1] as HeldRead;
      expect(copyRead.asksBrand).toBe(false);
      expect(mockRpc).not.toHaveBeenCalled();

      errorSpy.mockClear();
      warnSpy.mockClear();
      const readsAtClose = mockFrom.mock.calls.length;
      await route.unmount();

      copyRead.answer(
        outcome === "arrives"
          ? { data: serverRow(), error: null }
          : { data: null, error: new Error("Network request failed") },
      );
      await settle(10);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      await settle(10);

      expectNothingHappenedAfterClose(readsAtClose);
    }
  });

  test("a screen that stays open is not affected: the same late copy is adopted and the host's unsaved text is saved", async () => {
    const route = await mountRoute();
    await act(async () => {
      (heldReads[0] as HeldRead).answer({ data: serverRow(), error: null });
    });
    await settle(20);
    expect(heldReads).toHaveLength(2);
    expect((heldReads[0] as HeldRead).signal?.aborted).toBe(false);
    await act(async () => {
      (heldReads[1] as HeldRead).answer({ data: serverRow(), error: null });
    });
    await settle(20);
    // The save asks the server for the brand's currency first; answer it.
    for (let turn = 0; turn < 5 && mockRpc.mock.calls.length === 0; turn += 1) {
      const waiting = heldReads.slice(2);
      await act(async () => {
        waiting.forEach((read) => read.answer({ data: serverRow(), error: null }));
      });
      await settle(20);
    }
    expect(mockRpc).toHaveBeenCalled();
    const local = useDraftEventStore.getState().getDraft(draftId);
    expect(local?.currency).toBe("NGN");
    expect(local?.tickets[0]?.priceGbp).toBe(7000);
    expect(local?.name).toBe("Typed, not saved yet");
    expect(warnSpy).not.toHaveBeenCalled();
    await route.unmount();
  });
});
