jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { projectEventOrdersRead } from "../useEventOrders";

const refetch = jest.fn(async () => undefined);
const snapshot = <T,>(
  overrides: Partial<Parameters<typeof projectEventOrdersRead<T>>[0]> = {},
) => ({
  enabled: true,
  data: undefined,
  error: null,
  isError: false,
  isPending: false,
  isFetching: false,
  refetch,
  ...overrides,
});

describe("#2411 honest event-order read states", () => {
  test("keeps disabled, loading, and initial error distinct from a truthful empty result", () => {
    expect(projectEventOrdersRead(snapshot<string[]>({ enabled: false }))).toMatchObject({
      status: "disabled",
      data: null,
      error: null,
      isRefreshing: false,
    });
    expect(projectEventOrdersRead(snapshot<string[]>({ isPending: true }))).toMatchObject({
      status: "loading",
      data: null,
      error: null,
      isRefreshing: false,
    });
    const initialError = new Error("network unavailable");
    expect(
      projectEventOrdersRead(
        snapshot<string[]>({ isError: true, error: initialError }),
      ),
    ).toMatchObject({
      status: "error",
      data: null,
      error: initialError,
      isRefreshing: false,
    });
    expect(projectEventOrdersRead(snapshot<string[]>({ data: [] }))).toMatchObject({
      status: "ready",
      data: [],
      error: null,
      isRefreshing: false,
    });
  });

  test("preserves populated and refreshing ready data", () => {
    expect(
      projectEventOrdersRead(snapshot({ data: ["order_1"], isFetching: true })),
    ).toMatchObject({
      status: "ready",
      data: ["order_1"],
      error: null,
      isRefreshing: true,
    });
  });

  test("preserves stale data while surfacing a background refresh failure", () => {
    const refreshError = new Error("refresh failed");
    expect(
      projectEventOrdersRead(
        snapshot({
          data: ["order_1"],
          isError: true,
          error: refreshError,
          isFetching: false,
        }),
      ),
    ).toMatchObject({
      status: "stale-error",
      data: ["order_1"],
      error: refreshError,
      isRefreshing: false,
    });
  });
});
