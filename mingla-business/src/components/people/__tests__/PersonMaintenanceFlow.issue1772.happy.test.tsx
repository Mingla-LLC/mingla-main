import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { View } from "react-native";

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children, ...props }: any) => visible
    ? React.createElement("MockSheet", props, children)
    : null,
}));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: any) => props.visible
    ? React.createElement("MockConfirm", props)
    : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: any) => React.createElement("MockButton", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: any) => React.createElement("MockInput", props),
}));
jest.mock("../../ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: any) => <View>{children}</View>,
}));

import { PersonMaintenanceFlow, type PersonMaintenanceFlowProps } from "../PersonMaintenanceFlow";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const textOf = (json: any): string => typeof json === "string"
  ? json
  : Array.isArray(json)
  ? json.map(textOf).join(" ")
  : json && typeof json === "object"
  ? textOf(json.children ?? [])
  : "";
const identity = {
  personId: "person-a",
  displayName: "Maya Thompson",
  avatarUrl: null,
  updatedAt: "2026-08-30T12:00:00.000Z",
  alternateNames: ["Maya T."],
  contacts: [{ id: "email-a", channel: "email" as const, value: "maya@northstar.co", isPrimary: true }],
  linked: true,
  identityVersion: "version-a",
};
const other = {
  ...identity,
  personId: "person-b",
  displayName: "Maya T",
  linked: false,
  identityVersion: "version-b",
};
const preview = {
  state: "ready" as const,
  left: identity,
  right: other,
  leftVersion: "version-a",
  rightVersion: "version-b",
  hadOpenConflict: false,
  hadPriorSeparation: true,
};

function props(overrides: Partial<PersonMaintenanceFlowProps> = {}): PersonMaintenanceFlowProps {
  return {
    person: identity,
    online: true,
    mergeVisible: true,
    candidateSearch: "",
    onCandidateSearchChange: jest.fn(),
    candidateRows: [other],
    candidatesLoading: false,
    candidatesLoadingMore: false,
    candidatesError: null,
    hasNextCandidates: false,
    onLoadMoreCandidates: jest.fn(),
    onRetryCandidates: jest.fn(),
    preview,
    previewLoading: false,
    previewError: null,
    onRetryPreview: jest.fn(),
    onSelectedPersonIdChange: jest.fn(),
    onMergeReviewOpenChange: jest.fn(),
    onMerge: jest.fn(async () => ({
      operationId: "request-a",
      mergeEventId: "merge-a",
      survivorPersonId: "person-a",
      absorbedPersonId: "person-b",
      identityVersion: "version-merged",
      replayed: false,
    })),
    mergePending: false,
    onCloseMerge: jest.fn(),
    onOpenReview: jest.fn(),
    onViewMergedPerson: jest.fn(),
    splitVisible: false,
    splitPreview: undefined,
    splitLoading: false,
    splitError: null,
    onRetrySplitPreview: jest.fn(),
    splitMergeEventId: null,
    onSplit: jest.fn(async () => ({
      operationId: "request-split",
      outcome: "reversed" as const,
      restoredPersonId: "person-b",
      replayed: false,
    })),
    splitPending: false,
    onCloseSplit: jest.fn(),
    onViewPeople: jest.fn(),
    onEmailSupport: jest.fn(),
    ...overrides,
  };
}

describe("#1772 merge and Split barriers", () => {
  test("picker advances to an unselected radio review and requires confirmation", async () => {
    const flowProps = props();
    let tree: any;
    TR.act(() => { tree = TR.create(<PersonMaintenanceFlow {...flowProps} />); });
    expect(textOf(tree.toJSON())).toContain("Choose the other record. Nothing changes until you review and confirm.");
    TR.act(() => tree.root.findByProps({ testID: "merge-candidate-person-b" }).props.onPress());
    expect(textOf(tree.toJSON())).toContain("Choose the person you want to keep.");
    let review = tree.root.findAllByType("MockButton").find((node: any) => node.props.label === "Review merge");
    expect(review.props.disabled).toBe(true);
    TR.act(() => tree.root.findByProps({ testID: "keep-person-person-a" }).props.onPress());
    review = tree.root.findAllByType("MockButton").find((node: any) => node.props.label === "Review merge");
    expect(review.props.disabled).toBe(false);
    TR.act(() => review.props.onPress());
    const confirm = tree.root.findByType("MockConfirm");
    expect(confirm.props.title).toBe("Merge into Maya Thompson?");
    expect(confirm.props.description).toContain("Every email and phone stays available.");
    expect(confirm.props.description).toContain("Past orders, tickets, RSVPs, bookings, payments, and sends do not change.");
    await TR.act(async () => { await confirm.props.onConfirm(); });
    expect(flowProps.onMerge).toHaveBeenCalledTimes(1);
    expect(textOf(tree.toJSON())).toContain("Merge complete");
    expect(textOf(tree.toJSON())).toContain("Every email and phone is still here.");
  });

  test("unsafe Split shows no partition fantasy and only PII-free support actions", () => {
    const flowProps = props({
      mergeVisible: false,
      splitVisible: true,
      splitMergeEventId: "merge-a",
      splitPreview: { state: "unsafe", supportReference: "BP-ABC123" },
    });
    let tree: any;
    TR.act(() => { tree = TR.create(<PersonMaintenanceFlow {...flowProps} />); });
    const rendered = textOf(tree.toJSON()).replace(/\s+/g, " ");
    expect(rendered).toContain("We can’t split this automatically");
    expect(rendered).toContain("This contact changed after that merge, so Mingla can’t split it automatically.");
    expect(rendered).toContain("Nothing changed.");
    expect(rendered).toContain("Reference: BP-ABC123");
    expect(rendered).not.toContain("After Split");
    expect(tree.root.findAllByType("MockButton").map((node: any) => node.props.label)).toEqual([
      "Email support",
      "Done",
    ]);
  });

  test("safe Split renders both saved partitions and a second confirmation", () => {
    const flowProps = props({
      mergeVisible: false,
      splitVisible: true,
      splitMergeEventId: "merge-a",
      splitPreview: {
        state: "safe",
        mergeEventId: "merge-a",
        splitVersion: "event-version",
        left: identity,
        right: other,
      },
    });
    let tree: any;
    TR.act(() => { tree = TR.create(<PersonMaintenanceFlow {...flowProps} />); });
    expect(textOf(tree.toJSON())).toContain("After Split");
    const split = tree.root.findAllByType("MockButton").find((node: any) => node.props.label === "Split into two people");
    TR.act(() => split.props.onPress());
    expect(tree.root.findByType("MockConfirm").props.title).toBe("Split this merge?");
  });

  test("source pins responsive stacking and the named radio group", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(require.resolve("../PersonMaintenanceFlow"), "utf8")
    );
    expect(source).toContain("width < 352");
    expect(source).toContain('accessibilityRole="radiogroup"');
    expect(source).toContain('accessibilityLabel="Choose the person to keep"');
    expect(source).toContain("dismissOnScrimTap={!props.mergePending}");
  });
});
