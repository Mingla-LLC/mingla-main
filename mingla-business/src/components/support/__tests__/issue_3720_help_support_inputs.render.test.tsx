/** #3720 H3/H9: the real Support input renders without inherited letter spacing. */

import React from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { SupportTabPanel } from "../SupportTabPanel";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../hooks/useCommunity", () => ({
  useSupportIsOnline: () => ({ online: true, isLoading: false }),
}));
jest.mock("../../../hooks/useSupportTickets", () => ({
  useSupportTickets: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useCreateSupportTicket: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Pill", () => ({ Pill: () => null }));

describe("#3720 Help & Support input rendering", () => {
  it("renders the iOS subject placeholder normally and explains the disabled action", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SupportTabPanel onToast={jest.fn()} />);
    });
    const input = tree!.root.findByType(TextInput);
    expect(input.props.placeholder).toBe("What's it about? (e.g. payouts, a stuck event)");
    expect(StyleSheet.flatten(input.props.style).letterSpacing).toBe(0);
    expect(tree!.root.findAllByType(Text).some((node) => node.props.children === "Add a subject to start")).toBe(true);
  });
});
