/**
 * #4111 — useBrandEnquiries' live channel never takes the process down.
 *
 * WHAT HAPPENED. TopBar and Home mount useBrandEnquiries on every screen. It
 * opened a realtime channel on mount even when the first read had failed, and
 * dropped the promise `supabase.removeChannel` returns. On Node 20 (CI) there
 * is no WebSocket, so the socket teardown rejected with
 * "connToClose.close is not a function"; the unhandled rejection killed the
 * jest worker four times and the #3345 suite (which renders Home) "failed to
 * run" in CI while passing on Node 22 locally.
 *
 * WHAT THIS PINS:
 *   - no channel is opened until the first read succeeds;
 *   - a channel opened after a successful read is removed on unmount, and a
 *     rejecting removeChannel is caught, not left unhandled.
 *
 * FAILS ON REVERT: drop the `loaded` guard and T-1 fails (a channel opens on a
 * failed read); drop the `.catch` and T-2 records the unhandled rejection.
 */

import React from "react";
import { describe, expect, test, beforeEach, afterEach, jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockList = jest.fn<() => Promise<unknown>>();
const mockSubscribe = jest.fn();
const mockRemoveChannel = jest.fn<(channel: unknown) => Promise<unknown>>();
const mockChannel = jest.fn();

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-4111" }, isAuthReady: true }),
}));
jest.mock("../../services/brandEnquiryList", () => ({
  listBrandEnquiries: () => mockList(),
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    channel: (name: string) => {
      mockChannel(name);
      const builder = {
        on: () => builder,
        subscribe: () => {
          mockSubscribe();
          return builder;
        },
      };
      return builder;
    },
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useBrandEnquiries } = require("../useBrandEnquiries") as typeof import("../useBrandEnquiries");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
  create: (element: React.ReactElement) => { unmount: () => void };
};

function Probe(): null {
  useBrandEnquiries("open");
  return null;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function mount(): Promise<{ unmount: () => void }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: { unmount: () => void };
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await TestRenderer.act(flush);
  return tree;
}

describe("#4111 useBrandEnquiries realtime teardown", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled.length = 0;
    mockList.mockReset();
    mockSubscribe.mockReset();
    mockChannel.mockReset();
    mockRemoveChannel.mockReset();
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  test("T-1 a failed first read opens no channel", async () => {
    mockList.mockRejectedValue(new Error("network down"));
    const tree = await mount();
    expect(mockList).toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
    await TestRenderer.act(async () => {
      tree.unmount();
    });
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  test("T-2 after a successful read the channel opens, and a rejecting unsubscribe is caught", async () => {
    mockList.mockResolvedValue({
      items: [],
      counts: { new: 0, waiting: 0, replied: 0, resolved: 0, needs_reply: 0 },
    });
    mockRemoveChannel.mockImplementation(() =>
      Promise.reject(new TypeError("connToClose.close is not a function")),
    );
    const tree = await mount();
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => {
      tree.unmount();
    });
    await flush();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });
});
