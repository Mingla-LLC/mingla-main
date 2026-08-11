/**
 * #873 rendered contract: the shared Business iOS/Android/web component shows
 * person-first status truth and never upgrades provider acceptance to delivery.
 * Append-only new test; fails if the approved labels/detail are removed.
 */
import React from "react";
interface TestInstance {
  type: unknown;
  children: Array<string | TestInstance>;
  props: Record<string, unknown> & { onPress?: () => void };
  findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
  findByProps(props: Record<string, unknown>): TestInstance;
}
interface TestTree { root: TestInstance }
const testRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestTree;
  act: (callback: () => void) => void;
};
const { act } = testRenderer;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));

const mockRoster = {
  rows: [
    {
      rosterKey: "person:casey", personId: "casey", displayName: "Casey Guest", avatarUrl: null,
      contactLabel: "casey@example.test", primaryStatus: "not_responded", invitationStatus: "invited",
      invitationLabel: null,
      attempts: [{ channel: "email", status: "sent", providerAccepted: true, retryable: false, reason: null, occurredAt: "2026-08-11T00:00:00Z" }],
      party: { size: 1, activeTickets: 0, refundedTickets: 0, transferredTickets: 0, checkedIn: 0 },
      rsvpId: null, orderIds: [], latestActivityAt: "2026-08-11T00:00:00Z", checkedIn: false,
      canRemind: true, canRetry: false, canApprove: false, canDeny: false, isExportable: true,
    },
    {
      rosterKey: "person:nia", personId: "nia", displayName: "Nia Buyer", avatarUrl: null,
      contactLabel: null, primaryStatus: "bought_ticket", invitationStatus: "invited", invitationLabel: null,
      attempts: [], party: { size: 2, activeTickets: 2, refundedTickets: 0, transferredTickets: 0, checkedIn: 1 },
      rsvpId: null, orderIds: ["order-1"], latestActivityAt: "2026-08-11T00:00:00Z", checkedIn: true,
      canRemind: false, canRetry: false, canApprove: false, canDeny: false, isExportable: true,
    },
  ],
  summary: { all: 2, notResponded: 1, confirmed: 1, needsAttention: 1, invited: 2, notSent: 0, sending: 0, inviteFailed: 0, watermark: 3, generatedAt: "2026-08-11T00:00:00Z" },
  nextCursor: null, staleAfter: "2026-08-11T00:00:30Z", canExport: true,
};

jest.mock("../src/hooks/useGuestRoster", () => ({
  useGuestRoster: () => ({ data: mockRoster, isLoading: false, isError: false, isFetching: false, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock("../src/services/guestRosterService", () => ({
  createGuestRosterRequestId: () => "87300000-0000-4000-8000-000000000099",
  previewGuestRosterAction: jest.fn(),
  executeGuestRosterAction: jest.fn(),
}));
jest.mock("../src/components/ui/GlassCard", () => {
  const ReactLocal = require("react"); const { View } = require("react-native");
  return { GlassCard: ({ children }: { children?: React.ReactNode }) => ReactLocal.createElement(View, null, children) };
});
jest.mock("../src/components/ui/Pill", () => {
  const ReactLocal = require("react"); const { Text } = require("react-native");
  return { Pill: ({ children }: { children?: React.ReactNode }) => ReactLocal.createElement(Text, null, children) };
});
jest.mock("../src/components/ui/IconChrome", () => {
  const ReactLocal = require("react"); const { Pressable, Text } = require("react-native");
  return { IconChrome: ({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) => ReactLocal.createElement(Pressable, { accessibilityRole: "button", accessibilityLabel, onPress }, ReactLocal.createElement(Text, null, accessibilityLabel)) };
});
jest.mock("../src/components/ui/Input", () => {
  const ReactLocal = require("react"); const { TextInput } = require("react-native");
  return { Input: ({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) => ReactLocal.createElement(TextInput, { value, onChangeText, placeholder }) };
});
jest.mock("../src/components/ui/EmptyState", () => {
  const ReactLocal = require("react"); const { Text } = require("react-native");
  return { EmptyState: ({ title }: { title: string }) => ReactLocal.createElement(Text, null, title) };
});
jest.mock("../src/components/ui/Button", () => {
  const ReactLocal = require("react"); const { Pressable, Text } = require("react-native");
  return { Button: ({ label, onPress }: { label: string; onPress: () => void }) => ReactLocal.createElement(Pressable, { onPress }, ReactLocal.createElement(Text, null, label)) };
});
jest.mock("../src/components/ui/Sheet", () => {
  const ReactLocal = require("react"); const { View } = require("react-native");
  return { Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) => visible ? ReactLocal.createElement(View, null, children) : null };
});

import { GuestRosterExperience } from "../src/components/guests/GuestRosterExperience";

const textOf = (node: TestInstance): string => node.children.map((child: string | TestInstance) =>
  typeof child === "string" ? child : textOf(child)).join("");

const renderRoster = (): TestTree => {
  let tree!: TestTree;
  act(() => {
    tree = testRenderer.create(<GuestRosterExperience eventId="event-873" onBack={jest.fn()} onOpenOrder={jest.fn()} onExport={jest.fn()} />);
  });
  return tree;
};

const visibleTexts = (tree: TestTree): string[] =>
  tree.root.findAll((node: TestInstance) => node.type === "Text").map(textOf);

describe("#873 GuestRosterExperience rendered status truth", () => {
  test("renders approved summary cards and one row per person", () => {
    const texts = visibleTexts(renderRoster());
    expect(texts).toContain("All guests");
    expect(texts).toContain("Not responded");
    expect(texts).toContain("Confirmed");
    expect(texts).toContain("Needs attention");
    expect(texts).toContain("Casey Guest");
    expect(texts).toContain("Nia Buyer");
    expect(texts).toContain("Bought ticket");
  });

  test("opens person detail and describes acceptance honestly", () => {
    const tree = renderRoster();
    const row = tree.root.findByProps({ accessibilityLabel: "Casey Guest, Not responded, Invited" });
    act(() => row.props.onPress?.());
    const texts = visibleTexts(tree);
    expect(texts).toContain("Sent to provider. This does not claim delivery, display, opening, or reading.");
    expect(texts).not.toContain("Delivered");
    expect(texts).not.toContain("Read");
  });
});
