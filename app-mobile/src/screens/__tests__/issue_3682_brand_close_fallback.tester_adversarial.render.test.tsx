/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Issue #3682 — tester adversarial test for the brand page X.
 *
 * The implementor's test mounts the SCREEN once per case with a canned
 * `canGoBack` answer. This one attacks the parts that test cannot see:
 *
 *   1. It mounts the two real ROUTE FILES a brand link resolves to
 *      (`app/b/[slug].tsx` and `app/brand/[slug].tsx`), so a route that stopped
 *      rendering the guarded screen (or wrapped it with its own close) fails.
 *   2. The router is a small HISTORY MODEL, not canned answers: the assertion is
 *      where the person ends up. `push("/")` would leave the brand page under
 *      Home (Home's back would return to the dead page); only `replace` passes.
 *   3. ONE mounted page takes several presses: a double tap on a link-opened
 *      page must never call `back()`, and the handler must ask the router at
 *      PRESS time — an answer captured at render goes stale when history
 *      changes under the page.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs (the #1486 render step).
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

/** A history stack: the last entry is the screen the person is looking at. */
const mockNav: { stack: string[]; calls: string[] } = { stack: [], calls: [] };

const mockRouter = {
  canGoBack: (): boolean => mockNav.stack.length > 1,
  back: (): void => {
    mockNav.calls.push("back");
    // Real routers ignore back() with nothing behind: the #3682 dead tap.
    if (mockNav.stack.length > 1) mockNav.stack.pop();
  },
  replace: (href: string): void => {
    mockNav.calls.push(`replace:${href}`);
    mockNav.stack[mockNav.stack.length - 1] = href;
  },
  push: (href: string): void => {
    mockNav.calls.push(`push:${href}`);
    mockNav.stack.push(href);
  },
  navigate: (href: string): void => {
    mockNav.calls.push(`navigate:${href}`);
    mockNav.stack.push(href);
  },
  dismissAll: (): void => {
    mockNav.calls.push("dismissAll");
  },
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
  // A plain link open: a slug and no share marker.
  useLocalSearchParams: () => ({ slug: "lanternroom" }),
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
  consumerBrandEventUrl: () => "https://host.usemingla.com/e/lanternroom/x",
  useBrandBySlug: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    data: {
      brand: { id: "brand-3682-t", slug: "lanternroom", displayName: "Lantern Room" },
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

// The two real route files a brand link resolves to.
import BrandShortRoute from "../../../app/b/[slug]";
import BrandLongRoute from "../../../app/brand/[slug]";

const ROUTES: ReadonlyArray<
  [string, string, React.ComponentType<Record<string, never>>]
> = [
  ["app/b/[slug].tsx", "/b/lanternroom", BrandShortRoute],
  ["app/brand/[slug].tsx", "/brand/lanternroom", BrandLongRoute],
];

type Mounted = { pressX: () => void; unmount: () => void };

const mountRoute = (
  Route: React.ComponentType<Record<string, never>>,
): Mounted => {
  mockShell.callbacks = null;
  let tree: { unmount: () => void } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<Route />);
  });
  if (mockShell.callbacks === null) {
    throw new Error("the route never rendered the brand shell");
  }
  return {
    // Reads the CURRENT callbacks each press, as the shell's X does.
    pressX: (): void => {
      const callbacks = mockShell.callbacks as { onClose: () => void } | null;
      if (callbacks === null) throw new Error("the brand shell is gone");
      TestRenderer.act(() => {
        callbacks.onClose();
      });
    },
    unmount: (): void => {
      TestRenderer.act(() => {
        tree?.unmount();
      });
    },
  };
};

beforeEach(() => {
  mockNav.stack = [];
  mockNav.calls = [];
});

describe.each(ROUTES)(
  "issue #3682 (tester) — brand page X through %s",
  (_file, path, Route) => {
    test("link-opened: X leaves the person on Home with no brand page underneath", () => {
      mockNav.stack = [path];
      const page = mountRoute(Route);

      page.pressX();
      page.unmount();

      // Where the person is: Home, and it is the ONLY screen. A push/navigate
      // would give ["<brand>", "/"]; the pre-fix back() leaves ["<brand>"].
      expect(mockNav.stack).toEqual(["/"]);
      expect(mockNav.calls).toEqual(["replace:/"]);
    });

    test("opened from inside the app: X returns to the screen it came from", () => {
      mockNav.stack = ["/", path];
      const page = mountRoute(Route);

      page.pressX();
      page.unmount();

      expect(mockNav.stack).toEqual(["/"]);
      expect(mockNav.calls).toEqual(["back"]);
    });

    test("link-opened, X double-tapped before the page leaves: never back(), never a second screen", () => {
      mockNav.stack = [path];
      const page = mountRoute(Route);

      page.pressX();
      page.pressX();
      page.unmount();

      expect(mockNav.calls).not.toContain("back");
      expect(mockNav.calls.filter((c) => !c.startsWith("replace:"))).toEqual([]);
      expect(mockNav.stack).toEqual(["/"]);
    });

    test("history changing under one mounted page: each press asks the router again", () => {
      mockNav.stack = [path];
      const page = mountRoute(Route);

      // Press 1 — nothing behind the page: go Home.
      page.pressX();
      expect(mockNav.calls).toEqual(["replace:/"]);

      // History appears under the SAME mounted page (no re-render): go back.
      mockNav.stack = ["/", "/discover", path];
      mockNav.calls = [];
      page.pressX();
      expect(mockNav.calls).toEqual(["back"]);
      expect(mockNav.stack).toEqual(["/", "/discover"]);

      // History is gone again: Home, not a dead back().
      mockNav.stack = [path];
      mockNav.calls = [];
      page.pressX();
      expect(mockNav.calls).toEqual(["replace:/"]);
      expect(mockNav.stack).toEqual(["/"]);

      page.unmount();
    });
  },
);
