import React from "react";

// `react-test-renderer` intentionally ships without declarations in this app's
// locked test dependency set; keep the runner import local to the render proof.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: jest.fn(),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => ({
  WizardInvitePlanError: class WizardInvitePlanError extends Error {},
  createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000000000",
  formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
}));
jest.mock("../../ui/ConfirmDialog", () => {
  const ReactModule = require("react");
  return {
    ConfirmDialog: (props: Record<string, unknown>) =>
      ReactModule.createElement("confirm-dialog", props),
  };
});
jest.mock("../../ui/Button", () => {
  const ReactModule = require("react");
  return { Button: (props: Record<string, unknown>) => ReactModule.createElement("button", props) };
});
jest.mock("../../ui/Sheet", () => {
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props) };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactModule = require("react");
  return { ScrollView: (props: Record<string, unknown>) => ReactModule.createElement("scroll-view", props) };
});

import {
  InvitePeoplePublishConfirmation,
  InvitePlanReviewSummary,
} from "../InvitePeopleStep";
import type {
  WizardInvitePlan,
  WizardInviteQuote,
} from "../../../services/offeringInvitePlanService";

const plan: WizardInvitePlan = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "event",
  selectionRevision: 4,
  selectedCount: 3,
  brandPersonIds: [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000013",
  ],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: null,
};

const quote: WizardInviteQuote = {
  selectionRevision: 4,
  selectedCount: 3,
  // Five queued channel rows belong to two unique people.
  reachableCount: 5,
  suppressedCount: 1,
  canReceiveCount: 2,
  skippedCount: 1,
  perChannelReachable: { email: 2, sms: 1, push: 2 },
  estimatedCostMinor: 25,
  currency: "CAD",
  quoteHash: "b".repeat(64),
  selectionHash: "a".repeat(64),
};

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

describe("issue #1780 invite review and confirmation render contract", () => {
  test("review reports unique reachable people rather than channel rows", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<InvitePlanReviewSummary plan={plan} quote={quote} />);
    });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("2 can receive");
    expect(text).toContain("1 skipped · 3 selected");
    expect(text).not.toContain("5 can receive");
  });

  test("publish confirmation uses can-receive count and canonical quote currency", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InvitePeoplePublishConfirmation
          visible
          eventType="event"
          plan={plan}
          quote={quote}
          publishing={false}
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const dialog = renderer.root.findByType("confirm-dialog");
    expect(dialog.props.title).toBe("Publish event and send 2 invites?");
    expect(dialog.props.confirmLabel).toBe("Publish & invite 2");
    expect(dialog.props.description).toContain("go live first");
    expect(dialog.props.description).toContain("1 selected person is skipped");
    expect(dialog.props.description).toContain("CAD 0.25");
  });

  test("zero reachable requires explicit publish-without-invites confirmation", () => {
    const zero = { ...quote, reachableCount: 0, canReceiveCount: 0, skippedCount: 3,
      perChannelReachable: { email: 0, sms: 0, push: 0 }, estimatedCostMinor: 0,
      quoteHash: "c".repeat(64) };
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InvitePeoplePublishConfirmation
          visible
          eventType="trip"
          plan={{ ...plan, eventType: "trip" }}
          quote={zero}
          publishing={false}
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const dialog = renderer.root.findByType("confirm-dialog");
    expect(dialog.props.title).toBe("Publish trip and send 0 invites?");
    expect(dialog.props.confirmLabel).toBe("Publish without invites");
    expect(dialog.props.description).toContain("No selected people can receive an invite right now");
    expect(dialog.props.description).toContain("no invitations will be sent");
  });

  test("an open confirmation closes when authoritative quote identity changes", () => {
    const onClose = jest.fn();
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <InvitePeoplePublishConfirmation visible eventType="event" plan={plan} quote={quote}
          publishing={false} onClose={onClose} onConfirm={jest.fn()} />,
      );
    });
    act(() => {
      renderer.update(
        <InvitePeoplePublishConfirmation visible eventType="event" plan={plan}
          quote={{ ...quote, quoteHash: "d".repeat(64) }} publishing={false}
          onClose={onClose} onConfirm={jest.fn()} />,
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
