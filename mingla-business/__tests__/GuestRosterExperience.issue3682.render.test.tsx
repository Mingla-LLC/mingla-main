/**
 * #3682 closeout: the guest roster's empty state stays true when followers were
 * invited by their Mingla account. Those followers are listed in the
 * "Followers invited through Mingla" card above the roster, so the empty roster
 * must not say "No guests yet / Invited people will appear here".
 *
 * Run: npx jest --config jest.issue873.render.cjs --runInBand GuestRosterExperience.issue3682
 */
import React from "react";
interface TestInstance {
  type: unknown;
  children: Array<string | TestInstance>;
  props: Record<string, unknown> & { onPress?: () => void };
  findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
}
interface TestTree { root: TestInstance; unmount: () => void }
const testRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = testRenderer;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEmptyRoster = {
  rows: [],
  summary: { all: 0, notResponded: 0, confirmed: 0, needsAttention: 0, invited: 0, notSent: 0, sending: 0, inviteFailed: 0, watermark: 1, generatedAt: "2026-11-03T00:00:00Z" },
  nextCursor: null, staleAfter: "2026-11-03T00:00:30Z", canBulkActions: false, canExport: false,
};
const mockQuery: Record<string, unknown> = {
  data: mockEmptyRoster, isLoading: false, isError: false, isFetching: false, isRefetching: false,
  isRefetchError: false, isStaleTruth: false, isOffline: false, refetch: jest.fn(),
  refreshFromFirstPage: jest.fn(), fetchNextPage: jest.fn(), hasNextPage: false,
  isFetchingNextPage: false, isFetchNextPageError: false,
};
const mockAccountInvites: { data: unknown } = { data: undefined };

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));


// The card and the roster read the same account-invite query; each test sets
// what it returns.
jest.mock("../src/hooks/useOfferingAccountInvites", () => ({
  useOfferingAccountInvites: () => ({ data: mockAccountInvites.data }),
}));
jest.mock("../src/hooks/useGuestRoster", () => ({
  useGuestRoster: () => mockQuery,
}));
jest.mock("../src/services/guestRosterService", () => ({
  createGuestRosterRequestId: () => "87300000-0000-4000-8000-000000000099",
  previewGuestRosterAction: jest.fn(),
  executeGuestRosterAction: jest.fn(),
  setGuestRosterRsvpApproval: jest.fn(),
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
  return { EmptyState: ({ title, description }: { title: string; description?: string }) =>
    ReactLocal.createElement(ReactLocal.Fragment, null,
      ReactLocal.createElement(Text, null, title),
      description ? ReactLocal.createElement(Text, null, description) : null) };
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

const renderTexts = (): string[] => {
  let tree!: TestTree;
  act(() => {
    tree = testRenderer.create(<GuestRosterExperience eventId="event-3682" onBack={jest.fn()} onOpenOrder={jest.fn()} onExport={jest.fn()} />);
  });
  const texts = tree.root.findAll((node: TestInstance) => node.type === "Text").map(textOf);
  act(() => tree.unmount());
  return texts;
};

const accountInvites = (invited: number) => ({
  counts: { invited, reached: invited, pending: 0, notReached: 0 },
  recipients: Array.from({ length: invited }, (_, index) => ({
    userId: `user-${index}`, displayName: `Follower ${index}`, avatarUrl: null,
    reason: "follower", push: "sent", email: "skipped", updatedAt: "2026-11-03T00:00:00Z",
  })),
});

describe("#3682 closeout — roster empty state with account invites", () => {
  test("followers invited by account: the empty roster points at the card, never 'No guests yet'", () => {
    mockAccountInvites.data = accountInvites(2);
    const texts = renderTexts();
    expect(texts).toContain("Followers invited through Mingla");
    expect(texts).toContain("No other guests yet");
    expect(texts).toContain(
      "Followers invited through Mingla are listed above. RSVPs and ticket buyers will appear here as they arrive.",
    );
    expect(texts).not.toContain("No guests yet");
    expect(texts.join(" ")).not.toContain("Invited people, RSVPs, and ticket buyers will appear here");
  });

  test("no account invites: the original empty state stays", () => {
    mockAccountInvites.data = accountInvites(0);
    const texts = renderTexts();
    expect(texts).toContain("No guests yet");
    expect(texts).toContain("Invited people, RSVPs, and ticket buyers will appear here as real evidence arrives.");
    mockAccountInvites.data = undefined;
    expect(renderTexts()).toContain("No guests yet");
  });
});
