import React from "react";
import { act, render } from "@testing-library/react-native";
import AnalyticsRoute from "../analytics";

const mockReplace = jest.fn();
let mockBrand: { id: string; displayName: string } | null = null;
let mockCurrentBrandId: string | null = null;
let mockHasHydrated = false;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ entry: "direct" }),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => false,
    replace: mockReplace,
  }),
}));
jest.mock("../../../src/hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => mockBrand,
}));
jest.mock("../../../src/hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 60, isLoading: false }),
}));
jest.mock("../../../src/analytics/businessAnalyticsEvents", () => ({
  sanitizeBusinessAnalyticsEntryPoint: () => "direct",
}));
jest.mock("../../../src/store/currentBrandStore", () => ({
  useCurrentBrandId: () => mockCurrentBrandId,
  useCurrentBrandHasHydrated: () => mockHasHydrated,
}));
jest.mock("../../../src/components/ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../../src/components/analytics/BrandAnalyticsScreen", () => {
  const ReactModule = require("react") as typeof React;
  const Native = require("react-native") as typeof import("react-native");
  return {
    BrandAnalyticsScreen: ({ brand }: { brand: { displayName: string } }) =>
      ReactModule.createElement(
        Native.Text,
        null,
        `Analytics for ${brand.displayName}`,
      ),
  };
});

describe("issue #874 tester adversarial direct-route hydration boundary", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockBrand = null;
    mockCurrentBrandId = null;
    mockHasHydrated = false;
  });

  it("waits through persisted selection hydration and brand resolution", async () => {
    const screen = await render(<AnalyticsRoute />);
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      mockHasHydrated = true;
      mockCurrentBrandId = "brand-874";
      screen.rerender(<AnalyticsRoute />);
    });
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      mockBrand = { id: "brand-874", displayName: "Smoke & Rhythm" };
      screen.rerender(<AnalyticsRoute />);
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Analytics for Smoke & Rhythm")).toBeTruthy();
  });

  it("redirects only after hydration confirms there is no selected brand", async () => {
    mockHasHydrated = true;
    const screen = await render(<AnalyticsRoute />);

    await act(async () => undefined);
    expect(screen.toJSON()).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
  });
});
