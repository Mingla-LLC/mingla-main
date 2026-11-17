import React from "react";

// #4420 — the Invite people step dead-ended: when the delivery estimate
// (offering-invite-dispatch wizard_preview) failed, Continue became
// "Try again" and only re-ran the same failing read, so the host could never
// reach Preview; when the saved list itself failed, Continue sat on
// "Checking…" forever (the estimate query never ran). A failed READ now shows
// inline with its own Try again while Continue moves on. An UNSAVED selection
// still holds Continue on "Try again".
//
// WHAT THIS FILE PROVES (the REAL InvitePeopleStep, rendered; navigation read
// from onPlanChange exactly as the four wizards read it)
//   IV-1 a failed estimate: phase ready, not blocked, label "Continue"; the
//        inline estimate error is an alert with its own Try again.
//   IV-2 the inline Try again re-reads plan and estimate.
//   IV-3 a failed saved-list read: phase ready, label "Continue" (never
//        "Checking…" forever), with the inline error and Try again.
//   IV-4 an unsaved selection (a failed save) still holds "Try again".
//
// FAILS-ON-REVERT: restore InvitePeopleStep's navigation from origin/main and
// IV-1 and IV-3 go red.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

const mockUseOfferingInvitePlan = jest.fn();

jest.mock("../../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCount: () => ({ data: 1, isError: false }),
}));
jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: (...args: unknown[]) => mockUseOfferingInvitePlan(...args),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => {
  function MockWizardInvitePlanError(code: string, retryable: boolean) {
    const error = new Error(code) as Error & { code: string; retryable: boolean; currentRevision: null };
    Object.setPrototypeOf(error, MockWizardInvitePlanError.prototype);
    error.code = code;
    error.retryable = retryable;
    error.currentRevision = null;
    return error;
  }
  MockWizardInvitePlanError.prototype = Object.create(Error.prototype);
  return {
    WizardInvitePlanError: MockWizardInvitePlanError,
    createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000004273",
    formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
  };
});
jest.mock("../../ui/ConfirmDialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { ConfirmDialog: (props: Record<string, unknown>) => ReactModule.createElement("confirm-dialog", props) };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { Button: (props: Record<string, unknown>) => ReactModule.createElement("button", props) };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props) };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { ScrollView: (props: Record<string, unknown>) => ReactModule.createElement("scroll-view", props) };
});

import {
  InvitePeopleStep,
  InvitePlanReviewSummary,
} from "../InvitePeopleStep";
import { WizardInvitePlanError } from "../../../services/offeringInvitePlanService";

const EVENT_ID = "00000000-4273-4000-8000-000000000001";
const BRAND_ID = "00000000-4273-4000-8000-000000000002";
const AVERY = "00000000-4273-4000-8000-000000000003";
const BLAKE = "00000000-4273-4000-8000-000000000004";
const GROUP_ID = "00000000-4273-4000-8000-000000000005";

const NO_SOURCES = {
  includeEveryone: false,
  includeFollowers: false,
  includeFriendsOfFollowers: false,
  manualGroupIds: [] as string[],
  personIds: [] as string[],
  excludedPersonIds: [] as string[],
};

const basePlan = {
  eventId: EVENT_ID,
  eventType: "rsvp",
  selectionRevision: 3,
  selectedCount: 2,
  bookSelectedCount: 1,
  accountRecipientCount: 1,
  brandPersonIds: [AVERY],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-11-04T12:00:00.000Z",
  sources: { ...NO_SOURCES, includeFollowers: true },
  deliveryChannels: ["email", "push"],
};

const quote = {
  selectionRevision: 3,
  selectedCount: 2,
  reachableCount: 2,
  suppressedCount: 0,
  canReceiveCount: 2,
  skippedCount: 0,
  perChannelReachable: { email: 1, sms: 4, push: 2 },
  estimatedCostMinor: 250,
  currency: "USD",
  quoteHash: "b".repeat(64),
  selectionHash: "a".repeat(64),
};

const person = (personId: string, displayName: string) => ({
  personId,
  displayName,
  contacts: [{ id: `${personId}-c`, channel: "email", value: "x***@example.test", isPrimary: true }],
});

const readyCircle = (followers: number, extended: number) => ({
  state: "ready",
  counts: { followers, extended, total: followers + extended },
  availability: {
    followers: { state: "ready", reason: null, refreshedAt: "2026-11-04T00:00:00Z", expiresAt: "2026-11-04T01:00:00Z" },
    extended: { state: "ready", reason: null, refreshedAt: "2026-11-04T00:00:00Z", expiresAt: "2026-11-04T01:00:00Z" },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function model(overrides: Record<string, unknown> = {}, planOverrides: Record<string, unknown> = {}): any {
  const plan = { ...basePlan, ...planOverrides };
  return {
    plan: { data: plan, isPending: false, isError: false, error: null },
    quote: { data: quote, isPending: false, isFetching: false, isError: false, failureCount: 0, error: null },
    people: {
      data: { pages: [{ rows: [person(AVERY, "Avery"), person(BLAKE, "Blake")], bookTotal: 2, filteredTotal: 2, nextCursor: null }] },
      isPending: false, isError: false, isFetchingNextPage: false, hasNextPage: false,
      fetchNextPage: jest.fn(), refetch: jest.fn(),
    },
    groups: {
      data: [{ groupId: GROUP_ID, name: "Launch circle", memberCount: 1 }],
      isPending: false, isError: false, error: null, refetch: jest.fn(),
    },
    circle: { data: readyCircle(0, 0), isPending: false, isError: false },
    replace: { isPending: false, mutateAsync: jest.fn(async () => plan) },
    clear: { isPending: false, mutateAsync: jest.fn(async () => plan) },
    refreshAuthoritative: jest.fn(async () => ({ plan, quote })),
    ...overrides,
  };
}


const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

function renderStep(onPlanChange: jest.Mock) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <InvitePeopleStep eventId={EVENT_ID} brandId={BRAND_ID} eventType="event" onPlanChange={onPlanChange} />,
    );
  });
  return renderer;
}

const lastNavigation = (onPlanChange: jest.Mock): any =>
  onPlanChange.mock.calls[onPlanChange.mock.calls.length - 1][2];

const failedQuote = {
  data: undefined, isPending: false, isFetching: false, isError: true, failureCount: 3,
  error: new Error("wizard_invite_preview_unavailable"),
};

describe("#4420 Invite people never dead-ends on a failed read", () => {
  beforeEach(() => mockUseOfferingInvitePlan.mockReset());

  test("IV-1 a failed estimate lets the host continue, with the error inline", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({ quote: failedQuote }));
    const onPlanChange = jest.fn();
    const renderer = renderStep(onPlanChange);
    const nav = lastNavigation(onPlanChange);
    expect(nav.phase).toBe("ready");
    expect(nav.blocked).toBe(false);
    expect(nav.primaryLabel).toBe("Continue");
    const card = renderer.root.findByProps({ testID: "invite-quote-unavailable" });
    const alert = card.findAll((node: any) => node.props.accessibilityRole === "alert");
    expect(alert.length).toBeGreaterThan(0);
    expect(treeText(renderer.toJSON())).toContain("Delivery estimate unavailable. You can continue");
    expect(card.findAllByType("button").map((b: any) => b.props.label)).toEqual(["Try again"]);
  });

  test("IV-2 the inline Try again re-reads the plan and estimate", async () => {
    const m = model({ quote: failedQuote });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep(jest.fn());
    const card = renderer.root.findByProps({ testID: "invite-quote-unavailable" });
    await act(async () => { card.findByType("button").props.onPress(); });
    expect(m.refreshAuthoritative).toHaveBeenCalledTimes(1);
  });

  test("IV-3 a failed saved-list read continues instead of Checking forever", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({
      plan: { data: undefined, isPending: false, isError: true, error: new Error("offline") },
      // The estimate never runs without a plan: React Query reports it pending.
      quote: { data: undefined, isPending: true, isFetching: false, isError: false, failureCount: 0, error: null },
    }));
    const onPlanChange = jest.fn();
    const renderer = renderStep(onPlanChange);
    const nav = lastNavigation(onPlanChange);
    expect(nav.phase).toBe("ready");
    expect(nav.blocked).toBe(false);
    expect(nav.primaryLabel).toBe("Continue");
    const text = treeText(renderer.toJSON());
    expect(text).toContain("We couldn’t load your invite list");
    expect(renderer.root.findAllByType("button").map((b: any) => b.props.label)).toContain("Try again");
  });

  test("IV-4 an unsaved selection still holds Continue on Try again", async () => {
    const m = model({
      replace: { isPending: false, mutateAsync: jest.fn(async () => { throw new WizardInvitePlanError("network", true); }) },
    }, { selectedCount: 0, bookSelectedCount: 0, accountRecipientCount: 0, brandPersonIds: [], sources: NO_SOURCES });
    m.quote.data = { ...m.quote.data, selectedCount: 0 };
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const onPlanChange = jest.fn();
    const renderer = renderStep(onPlanChange);
    const everyone = renderer.root.findAll((node: any) => node.props.testID === "invite-source-everyone" &&
      node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function")[0];
    await act(async () => {
      everyone.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(m.replace.mutateAsync).toHaveBeenCalledTimes(1);
    const nav = lastNavigation(onPlanChange);
    expect(nav.phase).toBe("error");
    expect(nav.primaryLabel).toBe("Try again");
  });

  test("IV-5 Preview: invited people with a failed estimate say why, with Try again", async () => {
    const onRetry = jest.fn();
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InvitePlanReviewSummary plan={{ ...basePlan, selectedCount: 2 } as never} quote={null}
          estimateFailed onRetry={onRetry} />,
      );
    });
    expect(treeText(renderer.toJSON())).toContain("We couldn't check invite delivery for 2 people");
    const retry = renderer.root.findAllByType("button");
    expect(retry.map((b: any) => b.props.label)).toEqual(["Try again"]);
    act(() => retry[0].props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
