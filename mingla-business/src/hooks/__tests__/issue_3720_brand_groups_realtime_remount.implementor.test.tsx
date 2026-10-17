/**
 * Issue #3720 — route transitions can mount a new TopBar before Supabase has
 * removed the prior Brand-group channel. Realtime 2.103 reuses channels by
 * topic, so each hook mount needs a distinct topic before adding callbacks.
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
  useAuth: () => ({ user: { id: "host-3720" } }),
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
  mockListBrandGroups.mockResolvedValue({ groups: [], error: null });
  mockOn.mockReturnValue(mockRealtimeChannel);
  mockSubscribe.mockReturnValue(mockRealtimeChannel);
  mockChannel.mockReturnValue(mockRealtimeChannel);
});

test("rapid route remounts never reuse a subscribed Realtime topic", async () => {
  let firstRenderer!: RendererInstance;
  await act(async () => {
    firstRenderer = TestRenderer.create(<Probe />);
    await flush();
  });

  await act(async () => {
    firstRenderer.unmount();
    await flush();
  });

  let secondRenderer!: RendererInstance;
  await act(async () => {
    secondRenderer = TestRenderer.create(<Probe />);
    await flush();
  });

  expect(mockChannel).toHaveBeenCalledTimes(2);
  const firstTopic = mockChannel.mock.calls[0]?.[0];
  const secondTopic = mockChannel.mock.calls[1]?.[0];
  expect(firstTopic).toEqual(expect.stringMatching(/^brand-groups:list:host-3720:/));
  expect(secondTopic).toEqual(expect.stringMatching(/^brand-groups:list:host-3720:/));
  expect(secondTopic).not.toBe(firstTopic);

  await act(async () => {
    secondRenderer.unmount();
    await flush();
  });
});
