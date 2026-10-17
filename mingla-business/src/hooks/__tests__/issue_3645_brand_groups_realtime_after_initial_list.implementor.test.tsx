/**
 * Issue #3645 — a Host screen must not leave a Realtime socket behind when
 * its first Brand groups read never established access.
 *
 * TopBar mounts this hook. Starting Realtime before the authoritative list
 * read completed made short-lived renderers tear down a half-open Phoenix
 * connection, which crashed Jest workers and could waste device connections.
 */
import { beforeEach, expect, jest, test } from "@jest/globals";
import React from "react";

type ListResult = { groups: []; error: string | null };

const mockListBrandGroups = jest.fn<() => Promise<ListResult>>();
const mockRemoveChannel = jest.fn<(channel: unknown) => Promise<string>>(
  () => Promise.resolve("ok"),
);
const mockSubscribe = jest.fn();
const mockOn = jest.fn();
const mockChannel = jest.fn();

const mockRealtimeChannel = {
  on: mockOn,
  subscribe: mockSubscribe,
};

mockOn.mockReturnValue(mockRealtimeChannel);
mockSubscribe.mockReturnValue(mockRealtimeChannel);
mockChannel.mockReturnValue(mockRealtimeChannel);

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner-3645" } }),
}));

jest.mock("../../services/brandGroupsService", () => ({
  listBrandGroups: () => mockListBrandGroups(),
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
  },
}));

// eslint-disable-next-line import/first
import { useBrandGroups } from "../useBrandGroups";

interface RendererInstance {
  unmount(): void;
}

// react-test-renderer ships no type declarations in this package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void | Promise<void>): Promise<void>;
};
const { act } = TestRenderer;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = (): null => {
  useBrandGroups();
  return null;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOn.mockReturnValue(mockRealtimeChannel);
  mockSubscribe.mockReturnValue(mockRealtimeChannel);
  mockChannel.mockReturnValue(mockRealtimeChannel);
});

test("Realtime starts only after the initial Brand groups list succeeds", async () => {
  let resolveList!: (result: ListResult) => void;
  mockListBrandGroups.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
  );

  let renderer!: RendererInstance;
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });

  expect(mockListBrandGroups).toHaveBeenCalledTimes(1);
  expect(mockChannel).not.toHaveBeenCalled();

  await act(async () => {
    resolveList({ groups: [], error: null });
    await flush();
  });

  expect(mockChannel).toHaveBeenCalledTimes(1);
  expect(mockSubscribe).toHaveBeenCalledTimes(1);

  await act(async () => {
    renderer.unmount();
    await flush();
  });
  expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
});

test("a failed initial list never opens Realtime", async () => {
  mockListBrandGroups.mockResolvedValue({ groups: [], error: "forbidden" });

  let renderer!: RendererInstance;
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });

  expect(mockListBrandGroups).toHaveBeenCalledTimes(1);
  expect(mockChannel).not.toHaveBeenCalled();

  await act(async () => {
    renderer.unmount();
    await flush();
  });
  expect(mockRemoveChannel).not.toHaveBeenCalled();
});
