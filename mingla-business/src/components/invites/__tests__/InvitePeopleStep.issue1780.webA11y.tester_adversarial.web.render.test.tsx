/**
 * Issue #1780 tester-owned deployed-web accessibility proof.
 *
 * Unlike the native react-test-renderer suite, this renders the real
 * InvitePeopleStep and shared Button through react-native-web's DOM emitter.
 * A native `accessibilityState.checked` prop is not proof that the deployed
 * web element carries `aria-checked`; these assertions read the emitted HTML.
 *
 * [TEST-MOD-APPROVED #1780]
 */
import React from "react";

const renderToStaticMarkup = (
  require("react-dom/server") as {
    renderToStaticMarkup: (element: React.ReactElement) => string;
  }
).renderToStaticMarkup;

const mockUseOfferingInvitePlan = jest.fn();

jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: (...args: unknown[]) => mockUseOfferingInvitePlan(...args),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => ({
  WizardInvitePlanError: class WizardInvitePlanError extends Error {},
  createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000001780",
  formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
}));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  const { View } = require("react-native-web");
  return {
    // Render children even while closed so the server-side proof can inspect
    // the real PersonRow host output without inventing/exporting a test seam.
    Sheet: (props: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, { "data-testid": "sheet-boundary" }, props.children),
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native-web");
  return { ScrollView };
});

import { InvitePeopleStep, InviteSourcePicker } from "../InvitePeopleStep";

const EVENT_ID = "00000000-1780-4000-8000-000000000501";
const BRAND_ID = "00000000-1780-4000-8000-000000000502";
const AVERY_ID = "00000000-1780-4000-8000-000000000503";
const BLAKE_ID = "00000000-1780-4000-8000-000000000504";

const people = [
  {
    personId: AVERY_ID,
    displayName: "Avery Tester",
    contacts: [{
      id: "00000000-1780-4000-8000-000000000505",
      channel: "email",
      value: "a***@example.invalid",
      isPrimary: true,
    }],
  },
  {
    personId: BLAKE_ID,
    displayName: "Blake Tester",
    contacts: [{
      id: "00000000-1780-4000-8000-000000000506",
      channel: "email",
      value: "b***@example.invalid",
      isPrimary: true,
    }],
  },
];

const plan = {
  eventId: EVENT_ID,
  eventType: "event",
  selectionRevision: 2,
  selectedCount: 1,
  brandPersonIds: [AVERY_ID],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-09-15T12:00:00.000Z",
};

const quote = {
  selectionRevision: 2,
  selectedCount: 1,
  reachableCount: 0,
  suppressedCount: 1,
  canReceiveCount: 0,
  skippedCount: 1,
  perChannelReachable: { email: 0, sms: 0, push: 0 },
  estimatedCostMinor: 0,
  currency: "USD",
  quoteHash: "b".repeat(64),
  selectionHash: "a".repeat(64),
};

const model = {
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
    data: { pages: [{ rows: people, bookTotal: 2, filteredTotal: 2, nextCursor: null }] },
    isPending: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  },
  groups: {
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  },
  replace: { isPending: false, mutateAsync: jest.fn() },
  clear: { isPending: false, mutateAsync: jest.fn() },
  refreshAuthoritative: jest.fn(),
};

const checkboxOpeningTags = (markup: string): string[] =>
  markup.match(/<[^>]+role="checkbox"[^>]*>/g) ?? [];

describe("issue #1780 tester adversarial — deployed web checkbox semantics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOfferingInvitePlan.mockReturnValue(model);
  });

  test.each([
    [0, "false"],
    [1, "mixed"],
    [2, "true"],
  ])("Select all with %i-of-2 selected emits aria-checked=%s", (selectedCount, expected) => {
    const markup = renderToStaticMarkup(
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

    const tags = checkboxOpeningTags(markup);
    expect(tags).toHaveLength(1);
    const [selectAll] = tags;
    expect(selectAll).toContain('aria-label="Select all"');
    expect(selectAll).toContain(`aria-checked="${expected}"`);
  });

  test("selected and unselected person rows emit true and false aria-checked values", () => {
    const markup = renderToStaticMarkup(
      <InvitePeopleStep eventId={EVENT_ID} brandId={BRAND_ID} eventType="event" />,
    );

    // The product renders Select all first, followed by the people page in its
    // response order. Assert both the visible order and the exact three-host
    // checkbox topology before using that order to read each opening tag.
    expect(markup.indexOf("Select all")).toBeLessThan(markup.indexOf("Avery Tester"));
    expect(markup.indexOf("Avery Tester")).toBeLessThan(markup.indexOf("Blake Tester"));
    const tags = checkboxOpeningTags(markup);
    expect(tags).toHaveLength(3);
    expect(tags[0]).toContain('aria-label="Select all"');
    expect(tags[0]).toContain('aria-checked="mixed"');
    expect(tags[1]).toContain('aria-checked="true"');
    expect(tags[2]).toContain('aria-checked="false"');
  });
});
