/* eslint-disable import/first -- auth, AppState and the invite service must be controlled before importing the hooks. */
/**
 * #1780 [invite during creation] — implementor happy-path regression for the
 * device finding P4: on the Invite step, HOME then return fired the plan RPC
 * (biz_get_offering_invite_plan_v1) twice and the quote
 * (offering-invite-dispatch) twice, because the wizard's summary hook and the
 * Invite step's hook both refresh on foreground. Step 6 (summary only) was
 * 1 + 1.
 *
 * Contract: one plan read and one quote per event per return to the
 * foreground, whether or not the Invite step is mounted. The auth / enabled
 * gate from the foregroundGate suite stays intact. Publish's
 * refreshAuthoritative() is NOT deduped: it always makes its own fresh reads,
 * even while a foreground refresh is still in flight, so it can never publish
 * against a revision read before the latest selection change.
 *
 * Same harness as useOfferingInvitePlan.issue1780.foregroundGate.happy: the
 * real hooks, a real QueryClient, AppState listeners captured by a spy, and
 * the invite service mocked at its module boundary.
 *
 * Fails on revert (each was run; see the #1780 rework report):
 *   - delete the summary's stand-down clause  -> D-1, D-3, D-4, D-6 red (2 reads)
 *   - arm the step owner without its gate     -> D-5 red (0 reads)
 *   - let refreshAuthoritative() join a read already in flight -> D-6 red
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

import type {
  WizardInvitePlan,
  WizardInviteQuote,
} from "../../services/offeringInvitePlanService";

const mockGetPlan = jest.fn<(eventId: string) => Promise<WizardInvitePlan>>();
const mockQuote = jest.fn<
  (eventId: string, selectionRevision: number) => Promise<WizardInviteQuote>
>();

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1780" } }),
}));
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

const EVENT_A = "00000000-1780-4000-8000-000000000a01";
const EVENT_B = "00000000-1780-4000-8000-000000000b01";

const planFor = (eventId: string, selectionRevision = 3): WizardInvitePlan => ({
  eventId,
  eventType: "event",
  selectionRevision,
  selectedCount: 1,
  brandPersonIds: ["00000000-1780-4000-8000-000000000902"],
  selectionHash: String(selectionRevision).repeat(64).slice(0, 64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-09-17T12:00:00.000Z",
});
const quoteFor = (selectionRevision: number): WizardInviteQuote => ({
  selectionRevision,
  selectedCount: 1,
  reachableCount: 1,
  suppressedCount: 0,
  canReceiveCount: 1,
  skippedCount: 0,
  perChannelReachable: { email: 1, sms: 0, push: 0 },
  estimatedCostMinor: 0,
  currency: "USD",
  quoteHash: "b".repeat(64),
  selectionHash: String(selectionRevision).repeat(64).slice(0, 64),
});

type Listener = (state: AppStateStatus) => void;
type SummaryModel = ReturnType<typeof useOfferingInvitePlanSummary>;
type StepModel = ReturnType<typeof useOfferingInvitePlan>;

interface Mounted {
  /** The wizard's summary hook, one per event id listed. */
  summaries: string[];
  /** The Invite step's hook. */
  steps: { eventId: string; enabled: boolean }[];
}

let listeners: Set<Listener>;
let client: QueryClient;
let tree: { unmount: () => void; update: (node: React.ReactElement) => void } | null;
let models: { summary: Record<string, SummaryModel>; step: Record<string, StepModel> };

function SummaryProbe({ eventId }: { eventId: string }): null {
  models.summary[eventId] = useOfferingInvitePlanSummary({ eventId, enabled: true });
  return null;
}
function StepProbe({ eventId, enabled }: { eventId: string; enabled: boolean }): null {
  models.step[eventId] = useOfferingInvitePlan({ eventId, brandId: "", search: "", enabled });
  return null;
}
const element = (mounted: Mounted): React.ReactElement =>
  React.createElement(
    QueryClientProvider,
    { client },
    ...mounted.summaries.map((eventId) =>
      React.createElement(SummaryProbe, { key: `summary-${eventId}`, eventId }),
    ),
    ...mounted.steps.map((step) =>
      React.createElement(StepProbe, { key: `step-${step.eventId}`, ...step }),
    ),
  );
const flush = async (): Promise<void> => {
  await TR.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const mount = async (mounted: Mounted): Promise<void> => {
  await TR.act(() => {
    tree = TR.create(element(mounted));
  });
  await flush();
  // The mount-time queries are not the subject; clear them.
  mockGetPlan.mockClear();
  mockQuote.mockClear();
};
const remount = async (mounted: Mounted): Promise<void> => {
  await TR.act(() => {
    tree?.update(element(mounted));
  });
  await flush();
  mockGetPlan.mockClear();
  mockQuote.mockClear();
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
const planReadsFor = (eventId: string): number =>
  mockGetPlan.mock.calls.filter(([id]) => id === eventId).length;
const quotesFor = (eventId: string): number =>
  mockQuote.mock.calls.filter(([id]) => id === eventId).length;

beforeEach(() => {
  mockGetPlan.mockReset();
  mockQuote.mockReset();
  mockGetPlan.mockImplementation(async (eventId) => planFor(eventId));
  mockQuote.mockImplementation(async (_eventId, selectionRevision) => quoteFor(selectionRevision));
  listeners = new Set();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.add(listener as Listener);
    return { remove: () => listeners.delete(listener as Listener) } as never;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  tree = null;
  models = { summary: {}, step: {} };
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

describe("#1780 one invite refresh per app foreground", () => {
  test("D-1 Invite step on screen (summary + step for one event): one plan read and one quote", async () => {
    await mount({ summaries: [EVENT_A], steps: [{ eventId: EVENT_A, enabled: true }] });

    await returnToForeground();

    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);
    expect(mockQuote).toHaveBeenCalledWith(EVENT_A, 3);
  });

  test("D-2 any other step (summary only): one plan read and one quote", async () => {
    await mount({ summaries: [EVENT_A], steps: [] });

    await returnToForeground();

    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);
  });

  test("D-3 leaving the Invite step hands the refresh back to the summary, still once", async () => {
    await mount({ summaries: [EVENT_A], steps: [{ eventId: EVENT_A, enabled: true }] });
    await returnToForeground();
    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);

    await remount({ summaries: [EVENT_A], steps: [] });
    await returnToForeground();
    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);

    await remount({ summaries: [EVENT_A], steps: [{ eventId: EVENT_A, enabled: true }] });
    await returnToForeground();
    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);
  });

  test("D-4 two different events: once each, and one event's Invite step never silences the other", async () => {
    await mount({
      summaries: [EVENT_A, EVENT_B],
      steps: [{ eventId: EVENT_B, enabled: true }],
    });

    await returnToForeground();

    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);
    expect(planReadsFor(EVENT_B)).toBe(1);
    expect(quotesFor(EVENT_B)).toBe(1);
    expect(mockGetPlan).toHaveBeenCalledTimes(2);
    expect(mockQuote).toHaveBeenCalledTimes(2);
  });

  test("D-5 a disabled Invite step hook does not take the refresh away from the summary", async () => {
    await mount({ summaries: [EVENT_A], steps: [{ eventId: EVENT_A, enabled: false }] });

    await returnToForeground();

    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(1);
  });

  test("D-6 Publish's refreshAuthoritative() makes its own fresh reads while a foreground refresh is in flight", async () => {
    await mount({ summaries: [EVENT_A], steps: [{ eventId: EVENT_A, enabled: true }] });

    // The foreground read starts at revision 3 and hangs.
    let releaseForeground!: () => void;
    const foregroundRead = new Promise<WizardInvitePlan>((resolve) => {
      releaseForeground = () => resolve(planFor(EVENT_A, 3));
    });
    mockGetPlan.mockImplementationOnce(() => foregroundRead);
    await returnToForeground();
    expect(planReadsFor(EVENT_A)).toBe(1);
    expect(quotesFor(EVENT_A)).toBe(0);

    // The selection changed to revision 4; Publish's pre-check re-reads.
    // Start it but do not wait: a Publish that joined the hanging foreground
    // read would never reach the service, and would come back with revision 3.
    mockGetPlan.mockImplementationOnce(async (eventId) => planFor(eventId, 4));
    let publishRead: Promise<{ plan: WizardInvitePlan; quote: WizardInviteQuote | null }> | null = null;
    await TR.act(() => {
      publishRead = models.summary[EVENT_A].refreshAuthoritative();
    });
    await flush();
    expect(planReadsFor(EVENT_A)).toBe(2);
    expect(mockQuote).toHaveBeenCalledWith(EVENT_A, 4);

    // The Invite step's own refreshAuthoritative() (retry) is fresh too.
    mockGetPlan.mockImplementationOnce(async (eventId) => planFor(eventId, 5));
    let retryRead: Promise<{ plan: WizardInvitePlan; quote: WizardInviteQuote }> | null = null;
    await TR.act(() => {
      retryRead = models.step[EVENT_A].refreshAuthoritative();
    });
    await flush();
    expect(planReadsFor(EVENT_A)).toBe(3);

    await TR.act(async () => {
      releaseForeground();
      await foregroundRead;
    });
    await flush();

    const published = await (publishRead as unknown as Promise<{
      plan: WizardInvitePlan;
      quote: WizardInviteQuote | null;
    }>);
    expect(published.plan.selectionRevision).toBe(4);
    expect(published.quote?.selectionRevision).toBe(4);
    const retried = await (retryRead as unknown as Promise<{ plan: WizardInvitePlan }>);
    expect(retried.plan.selectionRevision).toBe(5);
  });
});
