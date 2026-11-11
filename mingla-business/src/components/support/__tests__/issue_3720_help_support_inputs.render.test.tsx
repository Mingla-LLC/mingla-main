/**
 * #3720 H3/H9, updated for #4382: the real new-request inputs render without
 * inherited letter spacing, and the disabled Send explains what is missing.
 */

import React from "react";
import { StyleSheet, Text, TextInput } from "react-native";
// @ts-expect-error -- installed only in the dedicated render-test workflow, not the Host bundle.
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
jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => [],
  useCurrentBrandId: () => null,
}));
jest.mock("../../../services/supportService", () => ({ uploadSupportImage: jest.fn() }));
jest.mock("../supportClientMeta", () => ({ hostSupportClientMeta: () => ({}) }));
jest.mock("../supportImagePicker", () => ({
  pickSupportImages: jest.fn(),
  SupportPhotoAccessError: class extends Error {},
}));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Pill", () => ({ Pill: () => null }));

describe("#3720 / #4382 Help & Support input rendering", () => {
  it("renders the summary placeholder normally and explains the disabled Send", async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SupportTabPanel onToast={jest.fn()} startNew />);
    });
    const inputs = tree!.root.findAllByType(TextInput);
    expect(inputs[0].props.placeholder).toBe("e.g. Payout balance shows 0");
    for (const input of inputs) {
      expect(StyleSheet.flatten(input.props.style).letterSpacing).toBe(0);
    }
    expect(tree!.root.findAllByType(Text).some((node: { props: { children?: React.ReactNode } }) => node.props.children === "Pick a topic")).toBe(true);
  });
});
