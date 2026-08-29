import React from "react";
import { Platform } from "react-native";
import { CompetitorBriefSheet } from "../CompetitorBriefSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Renderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => Tree;
};
interface Tree {
  root: { findByProps: (props: Record<string, unknown>) => unknown };
  unmount: () => void;
}
const mockFocus = jest.fn();

jest.mock("../../../../hooks/useCompetitorIntelligence", () => ({
  useCompetitorBrief: () => ({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../../ui/Button", () => ({
  Button: require("react").forwardRef(function MockButton(
    props: Record<string, unknown>,
    ref: React.ForwardedRef<{ focus: () => void }>,
  ) {
    require("react").useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return require("react").createElement("Button", props);
  }),
}));

describe("issue 2796 tester adversarial initial-focus contract", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFocus.mockClear();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("moves initial web focus to the visible Close control instead of leaving it on the scrim", async () => {
    let tree: Tree | null = null;
    await Renderer.act(async () => {
      tree = Renderer.create(
        <CompetitorBriefSheet
          visible
          onClose={jest.fn()}
          brandId="brand-1"
          venueName="Gogi"
          row={null}
        />,
      );
    });

    await Renderer.act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(tree!.root.findByProps({ testID: "competitor-brief-close" })).toBeTruthy();

    await Renderer.act(async () => tree!.unmount());
  });
});
