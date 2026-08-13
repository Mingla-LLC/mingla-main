import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { Text, View } from "react-native";

const router = { replace: jest.fn() };
let role = { isLoading: false, isError: false, accepted: true, rank: 20 };
let personQuery: Record<string, unknown>;
const person = {
  personId: "person-1",
  displayName: "Ada",
  avatarUrl: null,
  updatedAt: "now",
  contacts: [{ id: "contact-1", channel: "email", value: "ada@example.test", isPrimary: true }],
  suppressions: [],
};

jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ personId: "person-1" }),
}));
jest.mock("../../../../src/hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-a" }) }));
jest.mock("../../../../src/hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => role }));
jest.mock("../../../../src/hooks/marketing/useBrandPeople", () => ({ useBrandPerson: () => personQuery }));
jest.mock("../../../../src/components/ui/useShareNetworkState", () => ({ useShareNetworkState: () => true }), { virtual: true });
jest.mock("../../../../src/components/ui/SafeScreen", () => ({ SafeScreen: ({ children }: { children: React.ReactNode }) => <View>{children}</View> }));
jest.mock("../../../../src/components/ui/TopBar", () => ({ TopBar: ({ title }: { title: string }) => <Text>{title}</Text> }));
jest.mock("../../../../src/components/ui/Avatar", () => ({ Avatar: ({ name }: { name: string }) => <Text>{name}</Text> }));
jest.mock("../../../../src/components/ui/EmptyState", () => ({ EmptyState: ({ title, description }: { title: string; description?: string }) => <View><Text>{title}</Text>{description ? <Text>{description}</Text> : null}</View> }));
jest.mock("../../../../src/components/ui/GlassCard", () => ({ GlassCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View> }));
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/ui/Skeleton", () => ({ Skeleton: () => <Text>SKELETON</Text> }));

// Jest requires dependency mocks to be declared before loading this route.
// eslint-disable-next-line import/first
import BrandPersonDetailRoute from "../[personId]";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TR = require("react-test-renderer") as { create: (node: React.ReactElement) => any; act: (callback: () => void) => void };
const textOf = (json: any): string => typeof json === "string" ? json : Array.isArray(json) ? json.map(textOf).join(" ") : json && typeof json === "object" ? textOf(json.children ?? []) : "";

describe("#1774 rendered detail role-error boundary", () => {
  test("role lookup failure replaces cached detail with a terminal state, not an endless skeleton", () => {
    personQuery = { kind: "success", data: person, refetch: jest.fn() };
    let tree: any;
    TR.act(() => { tree = TR.create(<BrandPersonDetailRoute />); });
    expect(textOf(tree.toJSON())).toMatch(/Ada.*ada@example\.test/);

    role = { ...role, isError: true };
    personQuery = { kind: "roleLoading", data: person, refetch: jest.fn() };
    TR.act(() => { tree.update(<BrandPersonDetailRoute />); });
    const output = textOf(tree.toJSON());
    expect(output).toContain("You don’t have access to People.");
    expect(output).not.toMatch(/Ada|ada@example\.test|SKELETON/);
  });
});
