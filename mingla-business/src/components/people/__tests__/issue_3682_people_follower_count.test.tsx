import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { Text } from "react-native";

const mockUseBrandFollowerSummary = jest.fn((brandId: string | null) => {
  void brandId;
  return { data: { total: 1_234 } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../hooks/useBrandFollowerSummary", () => ({
  useBrandFollowerSummary: (brandId: string | null) =>
    mockUseBrandFollowerSummary(brandId),
}));
jest.mock("../../../hooks/useReducedMotionNative", () => ({
  useReducedMotionNative: () => true,
}));
jest.mock("../../../features/people/peopleAnalytics", () => ({
  capturePeople: jest.fn(),
}));
jest.mock("../../ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../PeoplePrimitives", () => ({
  PeopleBlock: ({
    children,
    count,
  }: {
    children: React.ReactNode;
    count?: string;
  }) => (
    <>
      <Text>{count}</Text>
      {children}
    </>
  ),
}));

// Jest requires the dependency mocks above the module under test.
// eslint-disable-next-line import/first
import { CircleReachBlock } from "../CircleReachBlock";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    toJSON: () => unknown;
    unmount: () => void;
  };
};

const query = {
  kind: "ready",
  rows: [],
  counts: { followers: 3, extended: 2, total: 5 },
  safeAvailability: {
    followers: { state: "ready", reason: null },
    extended: { state: "ready", reason: null },
  },
  currentPage: { state: "ready" },
  hasCurrentTruth: true,
  refetch: jest.fn(),
};

describe("#3682 People follower totals", () => {
  test("shows the exact follower total beside the independently verified reachable count", () => {
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CircleReachBlock
          ring="follower"
          brandId="brand-3682"
          query={query as never}
          width={390}
          onSeeAll={jest.fn()}
        />,
      );
    });

    expect(mockUseBrandFollowerSummary).toHaveBeenCalledWith("brand-3682");
    expect(JSON.stringify(tree.toJSON())).toContain(
      "1,234 followers · 3 you can reach",
    );
    TestRenderer.act(() => tree.unmount());
  });

  test("does not issue a follower-summary read for the extended circle", () => {
    mockUseBrandFollowerSummary.mockClear();
    let tree!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <CircleReachBlock
          ring="extended"
          query={query as never}
          width={390}
          onSeeAll={jest.fn()}
        />,
      );
    });

    expect(mockUseBrandFollowerSummary).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain("2 people");
    TestRenderer.act(() => tree.unmount());
  });
});
