/* eslint-disable @typescript-eslint/no-require-imports */
// INVARIANT(issue-3720-host-push-startup): a native Host push tap is consumed
// exactly once only after auth and the initial `/` -> Home redirect settle.
import React from "react";

const mockStorage = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockStorage.set(key, value);
});
const mockGetItem = jest.fn(async (key: string) => mockStorage.get(key) ?? null);
const mockRemoveItem = jest.fn(async (key: string) => {
  mockStorage.delete(key);
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: mockSetItem,
    getItem: mockGetItem,
    removeItem: mockRemoveItem,
  },
}));

let mockClickHandler: ((data: Record<string, unknown>) => void) | null = null;
jest.mock("../../services/oneSignalService", () => ({
  onNotificationClicked: jest.fn(
    (handler: (data: Record<string, unknown>) => void) => {
      mockClickHandler = handler;
      return () => {
        if (mockClickHandler === handler) mockClickHandler = null;
      };
    },
  ),
}));

jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../services/mixpanelService", () => ({
  mixpanelService: { track: jest.fn() },
}));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-1" }) },
}));

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => {
    update: (node: React.ReactElement) => void;
    unmount: () => void;
  };
};

// The hook import must follow the hoisted native/storage mocks above.
// eslint-disable-next-line import/first
import { useBusinessPushTapRouting } from "../useBusinessPushTapRouting";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roadmapPush = {
  type: "business.community_roadmap_updated",
  deepLink: "mingla-business://community/roadmap",
};

interface HarnessProps {
  loading: boolean;
  pathname: string;
  router: { push: jest.Mock };
  userId: string | null;
}

function Harness(props: HarnessProps): null {
  useBusinessPushTapRouting(props);
  return null;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("#3720 Host cold-start push destination", () => {
  beforeEach(() => {
    mockStorage.clear();
    mockClickHandler = null;
    jest.clearAllMocks();
  });

  test("waits out the authenticated index redirect, then opens Roadmap once", async () => {
    const router = { push: jest.fn() };
    let tree!: ReturnType<typeof TestRenderer.create>;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <Harness
          loading={false}
          pathname="/"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });

    await TestRenderer.act(async () => {
      mockClickHandler?.(roadmapPush);
      await flushAsyncWork();
    });
    expect(router.push).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      tree.update(
        <Harness
          loading={false}
          pathname="/(tabs)/home"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      "/account/support?tab=community&section=roadmap",
    );

    await TestRenderer.act(async () => {
      tree.update(
        <Harness
          loading={false}
          pathname="/account/support"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });
    expect(router.push).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => tree.unmount());
  });

  test("holds a signed-out cold tap through auth and root-route startup", async () => {
    const router = { push: jest.fn() };
    let tree!: ReturnType<typeof TestRenderer.create>;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <Harness loading pathname="/" router={router} userId={null} />,
      );
      await flushAsyncWork();
    });
    await TestRenderer.act(async () => {
      mockClickHandler?.(roadmapPush);
      await flushAsyncWork();
    });

    await TestRenderer.act(async () => {
      tree.update(
        <Harness
          loading={false}
          pathname="/"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });
    expect(router.push).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      tree.update(
        <Harness
          loading={false}
          pathname="/(tabs)/home"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      "/account/support?tab=community&section=roadmap",
    );

    await TestRenderer.act(async () => tree.unmount());
  });

  test("does not strand a tap that arrives during the initial storage probe", async () => {
    const router = { push: jest.fn() };
    let releaseProbe!: (value: string | null) => void;
    mockGetItem.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => {
        releaseProbe = resolve;
      }),
    );
    let tree!: ReturnType<typeof TestRenderer.create>;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <Harness
          loading={false}
          pathname="/(tabs)/home"
          router={router}
          userId="host-1"
        />,
      );
      await flushAsyncWork();
    });

    await TestRenderer.act(async () => {
      mockClickHandler?.(roadmapPush);
      await flushAsyncWork();
      releaseProbe(null);
      await flushAsyncWork();
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      "/account/support?tab=community&section=roadmap",
    );

    await TestRenderer.act(async () => tree.unmount());
  });
});
