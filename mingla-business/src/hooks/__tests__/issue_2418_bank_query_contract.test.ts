import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
} from "@tanstack/react-query";

interface TestRenderer {
  unmount(): void;
  update(element: React.ReactElement): void;
}

const TestRenderer: {
  act(callback: () => void | Promise<void>): void | Promise<void>;
  create(element: React.ReactElement): TestRenderer;
} = require("react-test-renderer");

const { act, create } = TestRenderer;

import type { PaystackBankOption } from "../../services/brandPaystackService";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mockAuthReady = false;
const mockListPaystackBanks = jest.fn<Promise<PaystackBankOption[]>, []>();

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: mockAuthReady }),
}));

jest.mock("../../services/brandPaystackService", () => {
  const actual = jest.requireActual("../../services/brandPaystackService");
  return {
    ...actual,
    listPaystackBanks: () => mockListPaystackBanks(),
  };
});

import {
  brandPaystackKeys,
  shouldRetryPaystackBankList,
  useBrandBanks,
} from "../useBrandPaystack";
import { PaystackBankListError } from "../../services/brandPaystackService";

let latestResult: UseQueryResult<PaystackBankOption[], Error> | null = null;

const Probe: React.FC = () => {
  latestResult = useBrandBanks();
  return null;
};

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

async function mount(client: QueryClient): Promise<TestRenderer> {
  let renderer: TestRenderer | null = null;
  await act(async () => {
    renderer = create(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(Probe),
      ),
    );
    await Promise.resolve();
  });
  if (renderer === null) throw new Error("query probe did not mount");
  return renderer;
}

async function cleanup(
  renderer: TestRenderer,
  client: QueryClient,
): Promise<void> {
  await act(async () => {
    renderer.unmount();
    await Promise.resolve();
  });
  client.clear();
}

describe("#2418 auth-ready NG/NGN/NUBAN bank query", () => {
  beforeEach(() => {
    mockAuthReady = false;
    mockListPaystackBanks.mockReset();
    latestResult = null;
  });

  it("sends zero requests before auth readiness and exactly one after", async () => {
    mockListPaystackBanks.mockResolvedValue([
      { name: "Access Bank", code: "044" },
    ]);
    const client = makeClient();
    const renderer = await mount(client);
    expect(mockListPaystackBanks).not.toHaveBeenCalled();

    mockAuthReady = true;
    await act(async () => {
      renderer.update(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(Probe),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockListPaystackBanks).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(brandPaystackKeys.banks())).toEqual([
      { name: "Access Bank", code: "044" },
    ]);
    expect(brandPaystackKeys.banks()).toEqual([
      "brand-paystack",
      "banks",
      "NG",
      "NGN",
      "nuban",
    ]);
    await cleanup(renderer, client);
  });

  it("makes one fresh request when the user manually retries a terminal error", async () => {
    mockAuthReady = true;
    mockListPaystackBanks.mockRejectedValueOnce(
      new PaystackBankListError("app_update_required", 426),
    );
    const client = makeClient();
    const renderer = await mount(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockListPaystackBanks).toHaveBeenCalledTimes(1);
    expect(latestResult?.isError).toBe(true);

    mockListPaystackBanks.mockResolvedValueOnce([
      { name: "Access Bank", code: "044" },
    ]);
    await act(async () => {
      await latestResult?.refetch();
    });
    expect(mockListPaystackBanks).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(brandPaystackKeys.banks())).toEqual([
      { name: "Access Bank", code: "044" },
    ]);
    await cleanup(renderer, client);
  });

  it("retries a transport failure at most twice and then exposes success", async () => {
    mockAuthReady = true;
    mockListPaystackBanks
      .mockRejectedValueOnce(new Error("transport"))
      .mockRejectedValueOnce(new Error("transport"))
      .mockResolvedValueOnce([{ name: "Access Bank", code: "044" }]);
    const client = makeClient();
    const renderer = await mount(client);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    });

    expect(mockListPaystackBanks).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(brandPaystackKeys.banks())).toEqual([
      { name: "Access Bank", code: "044" },
    ]);
    await cleanup(renderer, client);
  });

  it("applies the bounded local retry classification", () => {
    for (const status of [401, 403, 426]) {
      expect(
        shouldRetryPaystackBankList(
          0,
          new PaystackBankListError("unknown", status),
        ),
      ).toBe(false);
    }
    expect(
      shouldRetryPaystackBankList(
        0,
        new PaystackBankListError("invalid_response", null),
      ),
    ).toBe(false);
    expect(shouldRetryPaystackBankList(0, new Error("transport"))).toBe(true);
    expect(shouldRetryPaystackBankList(1, new Error("transport"))).toBe(true);
    expect(shouldRetryPaystackBankList(2, new Error("transport"))).toBe(false);
  });
});
