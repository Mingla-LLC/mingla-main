// Issue #4275 T-E1 / T-E2 — the empty object stops reaching Sentry at the call.
//
// A persisted error query came back as `error: {}` beside good data, and this
// section captured it: "Object captured as exception with keys: [object has no
// keys]" with nothing crashing.
//
// FAILS-ON-REVERT: put `Sentry.captureException(error)` back in
// YourCircleSection.tsx and T-E1 fails.

import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mockCaptureException = jest.fn();
const mockUseUserCircle = jest.fn();

jest.mock("@sentry/react-native", () => ({ captureException: mockCaptureException }), { virtual: true });
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }), { virtual: true });
jest.mock("../../../../hooks/useUserCircle", () => ({ useUserCircle: (...args: unknown[]) => mockUseUserCircle(...args) }));
jest.mock("../../../../store/appStore", () => ({
  useAppStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: "viewer" } }),
}));
jest.mock("../CircleGrid", () => ({ CircleGrid: () => null }));
jest.mock("../CircleSkeleton", () => ({ CircleSkeleton: () => null }));
jest.mock("../CircleEmptyState", () => ({ CircleEmptyState: () => null }));

const { YourCircleSection } = require("../YourCircleSection") as typeof import("../YourCircleSection");

function circle(error: unknown) {
  return {
    people: [{ userId: "person-1", displayName: "Person", tier: "close", hasBusinessApp: false }],
    error,
    isLoading: false,
    isFetching: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: jest.fn(),
    refetch: jest.fn(),
  };
}

function render(): void {
  TestRenderer.act(() => {
    TestRenderer.create(<YourCircleSection />);
  });
}

describe("#4275 YourCircleSection Sentry report", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    mockCaptureException.mockReset();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("T-E1 a restored `{}` error warns and is not sent to Sentry", () => {
    mockUseUserCircle.mockReturnValue(circle({}));
    render();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[yourCircle.loadMore]", expect.anything(), { peopleCount: 1 });
  });

  it("T-E2 a real Error is captured once, tagged with its scope", () => {
    const error = new Error("load more failed");
    mockUseUserCircle.mockReturnValue(circle(error));
    render();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { scope: "yourCircle.loadMore" } }),
    );
  });
});
