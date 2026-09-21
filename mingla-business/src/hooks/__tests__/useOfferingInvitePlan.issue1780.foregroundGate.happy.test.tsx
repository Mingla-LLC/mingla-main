/* eslint-disable import/first -- auth, AppState and the invite service must be controlled before importing the hooks. */
/**
 * #1780 [invite during creation] — implementor happy-path regression.
 *
 * The invite plan hooks refresh plan + quote when the app returns to the
 * foreground. That refresh calls the services directly, so React Query's
 * `enabled` never applies to it. It must use the same predicate as the plan
 * query: auth ready, caller enabled, and a real event id. Otherwise a mounted
 * wizard calls the plan RPC and the offering-invite-dispatch quote before auth
 * or while the caller has invites disabled.
 *
 * Fails on revert: drop `isAuthReady && input.enabled &&` from either
 * listener (or `isAuthReady` from its effect deps) and the matching case
 * goes red.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

import type {
  WizardInvitePlan,
  WizardInviteQuote,
} from "../../services/offeringInvitePlanService";

let auth: { isAuthReady: boolean; user: { id: string } | null } = {
  isAuthReady: true,
  user: { id: "user-1780" },
};
const mockGetPlan = jest.fn<(eventId: string) => Promise<WizardInvitePlan>>();
const mockQuote = jest.fn<
  (eventId: string, selectionRevision: number) => Promise<WizardInviteQuote>
>();

jest.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
jest.mock("../../services/offeringInvitePlanService", () => ({
  getWizardInvitePlan: (eventId: string) => mockGetPlan(eventId),
  quoteWizardInvitePlan: (eventId: string, selectionRevision: number) =>
    mockQuote(eventId, selectionRevision),
  listWizardInviteBookPeople: async () => ({ rows: [], nextCursor: null }),
  listWizardInviteManualGroups: async () => [],
  replaceWizardInvitePlan: async () => {
    throw new Error("not used");
  },
  clearWizardInvitePlan: async () => {
    throw new Error("not used");
  },
}));

import {
  useOfferingInvitePlan,
  useOfferingInvitePlanSummary,
} from "../useOfferingInvitePlan";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    unmount: () => void;
    update: (node: React.ReactElement) => void;
  };
  act: (fn: () => void | Promise<void>) => void | Promise<void>;
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_ID = "00000000-1780-4000-8000-000000000901";
const plan: WizardInvitePlan = {
  eventId: EVENT_ID,
  eventType: "event",
  selectionRevision: 3,
  selectedCount: 1,
  brandPersonIds: ["00000000-1780-4000-8000-000000000902"],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-09-16T12:00:00.000Z",
};
const quote: WizardInviteQuote = {
  selectionRevision: 3,
  selectedCount: 1,
  reachableCount: 1,
  suppressedCount: 0,
  canReceiveCount: 1,
  skippedCount: 0,
  perChannelReachable: { email: 1, sms: 0, push: 0 },
  estimatedCostMinor: 0,
  currency: "USD",
  quoteHash: "b".repeat(64),
  selectionHash: "a".repeat(64),
};

type Listener = (state: AppStateStatus) => void;
let listeners: Set<Listener>;
let client: QueryClient;
let tree: { unmount: () => void; update: (node: React.ReactElement) => void } | null;

type HookKind = "plan" | "summary";
function Probe(props: { kind: HookKind; enabled: boolean }): null {
  if (props.kind === "plan") {
    useOfferingInvitePlan({ eventId: EVENT_ID, brandId: "", search: "", enabled: props.enabled });
  } else {
    useOfferingInvitePlanSummary({ eventId: EVENT_ID, enabled: props.enabled });
  }
  return null;
}
const element = (kind: HookKind, enabled: boolean): React.ReactElement =>
  React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(Probe, { kind, enabled }),
  );
const flush = async (): Promise<void> => {
  await TR.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const mount = async (kind: HookKind, enabled: boolean): Promise<void> => {
  await TR.act(() => {
    tree = TR.create(element(kind, enabled));
  });
  await flush();
};
const returnToForeground = async (): Promise<void> => {
  await TR.act(() => {
    for (const listener of [...listeners]) listener("background");
  });
  await TR.act(() => {
    for (const listener of [...listeners]) listener("active");
  });
  await flush();
};

beforeEach(() => {
  auth = { isAuthReady: true, user: { id: "user-1780" } };
  mockGetPlan.mockReset();
  mockQuote.mockReset();
  mockGetPlan.mockResolvedValue(plan);
  mockQuote.mockResolvedValue(quote);
  listeners = new Set();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.add(listener as Listener);
    return { remove: () => listeners.delete(listener as Listener) } as never;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  tree = null;
});

afterEach(async () => {
  if (tree !== null) {
    const mounted = tree;
    await TR.act(() => mounted.unmount());
  }
  tree = null;
  client.clear();
  jest.restoreAllMocks();
});

describe.each<HookKind>(["plan", "summary"])("#1780 %s hook foreground refresh gate", (kind) => {
  test("auth ready and enabled: one foreground transition refreshes plan and quote once", async () => {
    await mount(kind, true);
    // The mount-time queries are not the subject; clear them.
    mockGetPlan.mockClear();
    mockQuote.mockClear();

    await returnToForeground();

    expect(mockGetPlan).toHaveBeenCalledTimes(1);
    expect(mockGetPlan).toHaveBeenCalledWith(EVENT_ID);
    expect(mockQuote).toHaveBeenCalledTimes(1);
    expect(mockQuote).toHaveBeenCalledWith(EVENT_ID, plan.selectionRevision);
  });

  test("caller disabled: returning to the foreground calls neither service", async () => {
    await mount(kind, false);

    await returnToForeground();

    expect(mockGetPlan).not.toHaveBeenCalled();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  test("auth not ready: returning to the foreground calls neither service", async () => {
    auth = { isAuthReady: false, user: null };
    await mount(kind, true);

    await returnToForeground();

    expect(mockGetPlan).not.toHaveBeenCalled();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  test("auth that becomes ready after mount re-arms the foreground refresh", async () => {
    auth = { isAuthReady: false, user: null };
    await mount(kind, true);
    expect(mockGetPlan).not.toHaveBeenCalled();

    auth = { isAuthReady: true, user: { id: "user-1780" } };
    await TR.act(() => {
      tree?.update(element(kind, true));
    });
    await flush();
    mockGetPlan.mockClear();
    mockQuote.mockClear();

    await returnToForeground();

    expect(mockGetPlan).toHaveBeenCalledTimes(1);
    expect(mockQuote).toHaveBeenCalledTimes(1);
  });
});
