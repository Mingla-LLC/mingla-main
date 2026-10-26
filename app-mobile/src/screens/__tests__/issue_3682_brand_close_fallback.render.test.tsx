/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Issue #3682 — the brand page X must always leave the page.
 *
 * A brand link (`/b/<slug>` or `/brand/<slug>`) can open the Explorer app
 * straight onto ConsumerBrandProfileScreen. There is then no history, so the old
 * `onClose: () => router.back()` was a silent no-op: the X did nothing.
 *
 * This MOUNTS the real screen, takes the `onClose` it hands the shared brand
 * shell, and calls it — the same thing the X does on a device:
 *
 *   - nothing to go back to  → `router.replace("/")` (Explorer home), no back()
 *   - something to go back to → `router.back()`, no replace()
 *
 * Only the screen's collaborators are stubbed (router, data hooks, the shared
 * shell, sheets, services). Runs under app-mobile/jest.issue2774.render.cjs
 * (the #1486 render step).
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type Row = Record<string, unknown>;

const mockRouter = {
  canGoBack: jest.fn<boolean, []>(),
  back: jest.fn<void, []>(),
  replace: jest.fn<void, [string]>(),
  push: jest.fn<void, [string]>(),
};

const mockShell: { callbacks: { onClose: () => void } | null } = {
  callbacks: null,
};

jest.mock("react-native", () => {
  const React = require("react");
  const host =
    (name: string) =>
    // eslint-disable-next-line react/display-name
    (props: { children?: unknown }) =>
      React.createElement(name, props, props.children ?? null);
  return {
    __esModule: true,
    ActivityIndicator: host("ActivityIndicator"),
    Text: host("Text"),
    View: host("View"),
    Alert: { alert: () => undefined },
    StyleSheet: { create: <T,>(styles: T): T => styles },
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ slug: "supper-club" }),
}));
jest.mock(
  "expo-web-browser",
  () => ({ openBrowserAsync: () => Promise.resolve() }),
  { virtual: true },
);
jest.mock(
  "@mingla/brand-rendering",
  () => ({
    PublicBrandPage: (props: { callbacks: { onClose: () => void } }) => {
      mockShell.callbacks = props.callbacks;
      return null;
    },
  }),
  { virtual: true },
);
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
}));
jest.mock("../../hooks/useBrandBySlug", () => ({
  consumerBrandEventUrl: () => "https://host.usemingla.com/e/supper-club/x",
  useBrandBySlug: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    data: {
      brand: { id: "brand-3682", slug: "supper-club", displayName: "Supper Club" },
      events: [],
      trips: [],
      experiences: [],
      upcoming: [],
      upcomingHasMore: false,
      menu: null,
      resolvedTheme: {},
    },
  }),
  usePublicBrandVenues: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../hooks/useBrandFollow", () => ({
  brandFollowKeys: {
    status: (b: string, u: string) => ["brandFollow", b, u],
    list: (u: string) => ["brandFollow", "list", u],
  },
  useBrandFollow: () => ({
    isFollowing: false,
    isMuted: false,
    isPending: false,
    mutedUntil: null,
    follow: () => Promise.resolve(),
  }),
}));
jest.mock("../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCount: () => ({ data: 1204, isError: false, isPending: false }),
}));
jest.mock("../../hooks/useBrandOfferingSections", () => ({
  useBrandHappeningNow: () => ({ data: [] }),
  useBrandPast: () => ({ rows: [], hasMore: false, loadState: "ready" }),
}));
jest.mock("../../store/appStore", () => ({
  useAppStore: (select: (s: Row) => unknown) => select({ user: null }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: () => undefined },
}));
jest.mock("../../services/contentShareAdapter", () => ({
  shareContent: () => Promise.resolve(),
}));
jest.mock("../../components/ui/Toast", () => ({
  toastManager: { show: () => undefined },
}));
// #4111 Wave D — the brand page's new "Message {Brand}" collaborator, stubbed
// like every other collaborator of this screen (brand not taking messages).
jest.mock("../../components/brandEnquiry/useExplorerBrandMessage", () => ({
  useExplorerBrandMessage: () => ({
    available: false,
    replyMinutes: null,
    open: () => undefined,
    overlays: null,
  }),
}));
jest.mock("../../components/ui/ToastContainer", () => ({
  ToastContainer: () => null,
}));
jest.mock("../../utils/hapticFeedback", () => ({
  HapticFeedback: { light: () => undefined },
}));
jest.mock("../../components/profile/BrandFollowOverflowSheet", () => ({
  BrandFollowOverflowSheet: () => null,
}));
jest.mock("../../components/profile/BrandsYouFollowManageSheet", () => ({
  BrandsYouFollowManageSheet: () => null,
}));

import ConsumerBrandProfileScreen from "../ConsumerBrandProfileScreen";

const pressClose = (): void => {
  mockShell.callbacks = null;
  let tree: { unmount: () => void } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<ConsumerBrandProfileScreen />);
  });
  const callbacks = mockShell.callbacks as { onClose: () => void } | null;
  if (callbacks === null) {
    throw new Error("the screen never rendered the brand shell");
  }
  TestRenderer.act(() => {
    callbacks.onClose();
  });
  TestRenderer.act(() => {
    tree?.unmount();
  });
};

beforeEach(() => {
  mockRouter.canGoBack.mockReset();
  mockRouter.back.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.push.mockReset();
});

describe("issue #3682 — brand page X", () => {
  test("opened by a link (nothing to go back to): X goes to the Explorer home", () => {
    mockRouter.canGoBack.mockReturnValue(false);

    pressClose();

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test("opened from inside the app (history exists): X goes back", () => {
    mockRouter.canGoBack.mockReturnValue(true);

    pressClose();

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
