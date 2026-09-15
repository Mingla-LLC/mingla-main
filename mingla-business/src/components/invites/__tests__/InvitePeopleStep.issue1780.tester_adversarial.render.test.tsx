import React from "react";

// The repository's locked test dependencies omit renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

const mockUseOfferingInvitePlan = jest.fn();

jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: (...args: unknown[]) => mockUseOfferingInvitePlan(...args),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => {
  function MockWizardInvitePlanError(
    code: string,
    retryable: boolean,
    currentRevision: number | null = null,
  ) {
    const error = new Error(code) as Error & {
      code: string;
      retryable: boolean;
      currentRevision: number | null;
    };
    Object.setPrototypeOf(error, MockWizardInvitePlanError.prototype);
    error.code = code;
    error.retryable = retryable;
    error.currentRevision = currentRevision;
    return error;
  }
  MockWizardInvitePlanError.prototype = Object.create(Error.prototype);
  return {
    WizardInvitePlanError: MockWizardInvitePlanError,
    createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000000990",
    formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
  };
});
jest.mock("../../ui/ConfirmDialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    ConfirmDialog: (props: Record<string, unknown>) =>
      ReactModule.createElement("confirm-dialog", props),
  };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    Button: (props: Record<string, unknown>) =>
      ReactModule.createElement("button", props),
  };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props) };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    ScrollView: (props: Record<string, unknown>) =>
      ReactModule.createElement("scroll-view", props),
  };
});

import {
  InvitePeopleStep,
  InviteSourcePicker,
} from "../InvitePeopleStep";
import { WizardInvitePlanError } from "../../../services/offeringInvitePlanService";

const EVENT_ID = "00000000-1780-4000-8000-000000000991";
const BRAND_ID = "00000000-1780-4000-8000-000000000992";
const PERSON_ID = "00000000-1780-4000-8000-000000000993";
const GROUP_ID = "00000000-1780-4000-8000-000000000994";

const plan = {
  eventId: EVENT_ID,
  eventType: "event",
  selectionRevision: 3,
  selectedCount: 1,
  brandPersonIds: [PERSON_ID],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-09-15T12:00:00.000Z",
};

const quote = {
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

const person = {
  personId: PERSON_ID,
  displayName: "Avery Tester",
  contacts: [{
    id: "00000000-1780-4000-8000-000000000995",
    channel: "email",
    value: "a***@example.test",
    isPrimary: true,
  }],
};

const model = (overrides: Record<string, unknown> = {}) => ({
  plan: { data: plan, isPending: false, isError: false, error: null },
  quote: {
    data: quote,
    isPending: false,
    isFetching: false,
    isError: false,
    failureCount: 0,
    error: null,
  },
  people: {
    data: {
      pages: [{ rows: [person], bookTotal: 2, filteredTotal: 1, nextCursor: null }],
    },
    isPending: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(async () => undefined),
    refetch: jest.fn(async () => undefined),
  },
  groups: {
    data: [{ groupId: GROUP_ID, name: "Launch circle", memberCount: 1 }],
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(async () => undefined),
  },
  replace: { isPending: false, mutateAsync: jest.fn(async () => plan) },
  clear: { isPending: false, mutateAsync: jest.fn(async () => plan) },
  refreshAuthoritative: jest.fn(async () => ({ plan, quote })),
  ...overrides,
});

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

const renderStep = (extraProps: Record<string, unknown> = {}) => {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <InvitePeopleStep
        eventId={EVENT_ID}
        brandId={BRAND_ID}
        eventType="event"
        {...(extraProps as any)}
      />,
    );
  });
  return renderer;
};

const button = (renderer: any, label: RegExp): any =>
  renderer.root.findAllByType("button").find((node: any) =>
    typeof node.props.label === "string" && label.test(node.props.label),
  );

describe("issue #1780 tester adversarial — required Invite people states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOfferingInvitePlan.mockReturnValue(model());
  });

  test.each([
    [0, false],
    [1, "mixed"],
    [2, true],
  ])("Select all exposes the %s-of-2 accessibility state", (selectedCount, checked) => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InviteSourcePicker
          bookCount={2}
          groups={[]}
          selectedCount={selectedCount as number}
          disabled={false}
          onSelectEveryone={jest.fn()}
          onSelectGroup={jest.fn()}
          onChoosePeople={jest.fn()}
        />,
      );
    });
    const selectAll = button(renderer, /^Select all$/i);
    expect(selectAll).toBeDefined();
    expect(selectAll.props.accessibilityRole).toBe("checkbox");
    expect(selectAll.props.accessibilityState).toEqual(
      expect.objectContaining({ checked }),
    );
  });

  test("saved-group loading is not represented as an empty group list", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({
      groups: { data: undefined, isPending: true, isError: false, error: null, refetch: jest.fn() },
    }));
    const renderer = renderStep();
    const text = treeText(renderer.toJSON());
    expect(text).toMatch(/loading|checking/i);
    expect(text).toMatch(/saved groups/i);
    expect(text).not.toContain("No saved manual groups yet.");
  });

  test("saved-group failure exposes a real retry and remains distinct from empty", () => {
    const refetch = jest.fn(async () => undefined);
    mockUseOfferingInvitePlan.mockReturnValue(model({
      groups: {
        data: undefined,
        isPending: false,
        isError: true,
        error: new Error("offline"),
        refetch,
      },
    }));
    const renderer = renderStep();
    const text = treeText(renderer.toJSON());
    expect(text).toMatch(/saved groups.*(?:unavailable|couldn.t load)|(?:unavailable|couldn.t load).*saved groups/i);
    expect(text).not.toContain("No saved manual groups yet.");
    const retry = button(renderer, /(?:try|retry).*(?:group)|(?:group).*(?:try|retry)/i);
    expect(retry).toBeDefined();
    act(() => retry.props.onPress());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("people fetch failure has an actionable retry control", () => {
    const refetch = jest.fn(async () => undefined);
    mockUseOfferingInvitePlan.mockReturnValue(model({
      people: {
        data: { pages: [] },
        isPending: false,
        isError: true,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: jest.fn(),
        refetch,
      },
    }));
    const renderer = renderStep();
    act(() => button(renderer, /^(?:Choose people|Edit selection)$/i).props.onPress());
    expect(treeText(renderer.toJSON())).toContain("People are unavailable");
    const retry = button(renderer, /(?:try|retry).*(?:people)|(?:people).*(?:try|retry)/i);
    expect(retry).toBeDefined();
    act(() => retry.props.onPress());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("stale mutation explains the external change and requires explicit review", async () => {
    const stale = new WizardInvitePlanError(
      "wizard_invite_revision_conflict",false,4,
    );
    const replace = jest.fn(async () => { throw stale; });
    const fresh = {
      ...plan,
      selectionRevision: 4,
      brandPersonIds: [],
      selectedCount: 0,
      selectionHash: "c".repeat(64),
    };
    mockUseOfferingInvitePlan.mockReturnValue(model({
      replace: { isPending: false, mutateAsync: replace },
      refreshAuthoritative: jest.fn(async () => ({
        plan: fresh,
        quote: { ...quote, selectionRevision: 4, selectedCount: 0,
          reachableCount: 0, canReceiveCount: 0, skippedCount: 0,
          selectionHash: fresh.selectionHash, quoteHash: "d".repeat(64) },
      })),
    }));
    const renderer = renderStep();
    await act(async () => {
      button(renderer, /^Add group$/i).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(treeText(renderer.toJSON())).toMatch(/selection.*changed.*(?:elsewhere|another)/i);
    expect(button(renderer, /review/i)).toBeDefined();
  });

  test("permission loss removes selection actions and invokes the safe-exit callback", () => {
    const onProtectedFlowExit = jest.fn();
    mockUseOfferingInvitePlan.mockReturnValue(model({
      plan: {
        data: undefined,
        isPending: false,
        isError: true,
        error: new WizardInvitePlanError("wizard_invite_forbidden",false),
      },
    }));
    const renderer = renderStep({ onProtectedFlowExit });
    expect(treeText(renderer.toJSON())).toMatch(/access.*changed|no longer have access/i);
    expect(button(renderer, /select all|add group|choose people/i)).toBeUndefined();
    const exit = button(renderer, /leave|back/i);
    expect(exit).toBeDefined();
    act(() => exit.props.onPress());
    expect(onProtectedFlowExit).toHaveBeenCalledTimes(1);
  });

  test("expired authentication invokes canonical re-auth instead of retrying the query", () => {
    const onReauthenticate = jest.fn();
    const refreshAuthoritative = jest.fn();
    mockUseOfferingInvitePlan.mockReturnValue(model({
      plan: {
        data: undefined,
        isPending: false,
        isError: true,
        error: new WizardInvitePlanError("wizard_invite_auth_required",false),
      },
      refreshAuthoritative,
    }));
    const renderer = renderStep({ onReauthenticate });
    expect(treeText(renderer.toJSON())).toMatch(/session.*expired|sign in again/i);
    const signIn = button(renderer, /sign in again/i);
    expect(signIn).toBeDefined();
    act(() => signIn.props.onPress());
    expect(onReauthenticate).toHaveBeenCalledTimes(1);
    expect(refreshAuthoritative).not.toHaveBeenCalled();
  });

  test("quote authentication expiry also routes to canonical re-auth", () => {
    const onReauthenticate = jest.fn();
    const refreshAuthoritative = jest.fn();
    mockUseOfferingInvitePlan.mockReturnValue(model({
      quote: {
        data: undefined,
        isPending: false,
        isFetching: false,
        isError: true,
        failureCount: 1,
        error: new WizardInvitePlanError("wizard_invite_auth_required",false),
      },
      refreshAuthoritative,
    }));
    const renderer = renderStep({ onReauthenticate });
    expect(treeText(renderer.toJSON())).toMatch(/session.*expired|sign in again/i);
    const signIn = button(renderer, /sign in again/i);
    expect(signIn).toBeDefined();
    act(() => signIn.props.onPress());
    expect(onReauthenticate).toHaveBeenCalledTimes(1);
    expect(refreshAuthoritative).not.toHaveBeenCalled();
  });

  test("permission loss during a mutation exits safely instead of retaining controls", async () => {
    const onProtectedFlowExit = jest.fn();
    const denied = new WizardInvitePlanError("wizard_invite_forbidden",false);
    mockUseOfferingInvitePlan.mockReturnValue(model({
      replace: { isPending: false, mutateAsync: jest.fn(async () => { throw denied; }) },
      refreshAuthoritative: jest.fn(async () => { throw denied; }),
    }));
    const renderer = renderStep({ onProtectedFlowExit });
    await act(async () => {
      button(renderer, /^Add group$/i).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(treeText(renderer.toJSON())).toMatch(/access.*changed|no longer have access/i);
    expect(button(renderer, /select all|add group|choose people/i)).toBeUndefined();
    const exit = button(renderer, /leave|back/i);
    expect(exit).toBeDefined();
    act(() => exit.props.onPress());
    expect(onProtectedFlowExit).toHaveBeenCalledTimes(1);
  });
});
