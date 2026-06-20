/**
 * ORCH-0961 adversarial gate — callback behavior, not source shape.
 *
 * [TEST-MOD-APPROVED ORCH-1138] — ORCH-1138 Leg 2 moved the close/share chrome
 * from the adapter's own IconChrome row into the shared PublicEventPage's
 * FOUNDATION mode (ParallaxCoverShell's OfferingChrome), driven by the SAME
 * `callbacks.onClose`/`onShare`. So the close-callback drive now goes through the
 * shared page's `callbacks.onClose` (not a standalone IconChrome node), and the
 * adapter now imports `@mingla/offering-rendering` (useResponsiveLayout) + the new
 * `./EventReserveBar`. The BEHAVIORAL coverage (router.back / brand+root fallback /
 * founder public route) is UNCHANGED — only the chrome SOURCE shape moved. The
 * obsolete `hideFloatingChrome`/IconChrome assertions were dropped.
 *
 * This tester-owned adversarial test transpiles + evaluates the adapter boundary
 * with mocked deps, extracts the shared-page callback props, and invokes the
 * actual close handlers with router spies across the fallback branches.
 */

import React from "react";
import { readFileSync } from "fs";
import path from "path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type RouterMock = {
  canGoBack: ReturnType<typeof jest.fn>;
  back: ReturnType<typeof jest.fn>;
  replace: ReturnType<typeof jest.fn>;
  push: ReturnType<typeof jest.fn>;
};

type ElementNode = {
  type?: unknown;
  props?: {
    accessibilityLabel?: string;
    callbacks?: {
      onClose?: () => void;
      onShare?: () => void;
    };
    onPress?: () => void;
    viewerRole?: string;
    hideFloatingChrome?: boolean;
    palette?: unknown;
    onToggleMute?: () => void;
    onClose?: () => void;
    onShare?: () => void;
    children?: ElementNode | ElementNode[] | string | null;
  };
};

const mockStateSetters: jest.Mock[] = [];
let mockRouter: RouterMock;
let mockUser: unknown = null;
let mockUserBrands: Array<{ id: string }> = [];

jest.mock("react", () => {
  const actual = jest.requireActual<typeof React>("react");
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const setter = jest.fn();
      mockStateSetters.push(setter);
      return [typeof initial === "function" ? initial() : initial, setter];
    },
  };
});

jest.mock("react-native", () => ({
  Platform: { OS: "web", select: (o: { default?: unknown }) => o.default },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Linking: { openURL: () => Promise.resolve() },
}));

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("expo-router/head", () => "Head");

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@mingla/offering-rendering", () => ({
  PublicEventPage: "SharedPublicEventPage",
  // ORCH-1117 — the adapter pulls the shared theme + offering-CTA helpers.
  // ORCH-1138 Leg 2 — + createThemePalette + boldFontFamily for FOUNDATION mode.
  resolveTheme: () => ({ color: "#eb7825", foregroundColor: "#ffffff", fontFamilyValue: undefined }),
  resolveOfferingCta: () => ({ kind: "buy", label: "Buy ticket", price: "£25", tappable: true }),
  computeOfferingVariant: () => "published",
  createThemePalette: () => ({ page: "#0c0e12", accent: "#eb7825", accentText: "#fff", primaryText: "#fff", secondaryText: "#ccc", tertiaryText: "#999", panel: "#111", panelStrong: "#222", panelBorder: "#333", card: "#1a1a1a", cutoutBorder: "#444", glass: "#000", glassTint: "dark", accentWash: "#332211" }),
  boldFontFamily: () => undefined,
}), { virtual: true });

// ORCH-1138 Leg 2 — the adapter composes the Direction-A foundation: it pulls
// useResponsiveLayout from @mingla/offering-rendering (and, post-ORCH-1167, the
// shared EventOfferingFloatingBar + EventTicketBox from the same package).
jest.mock("@mingla/offering-rendering", () => ({
  useResponsiveLayout: () => ({ isDesktop: false, isWeb: true }),
}), { virtual: true });

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => mockUserBrands,
}));

jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "May 30",
  formatDraftDateSubline: () => "7:00 PM",
  formatDraftDatesList: () => ["May 30, 7:00 PM"],
}));

jest.mock("../../../utils/eventCoverMediaRules", () => ({
  isLegacyUnsafeEventCoverVideoUrl: () => false,
}));

jest.mock("../../../types/eventCoverProvider", () => ({
  eventCoverProviderCreditLabel: () => null,
}));

jest.mock("../../ui/ShareModal", () => ({
  ShareModal: "ShareModal",
}));

jest.mock("../../ui/Toast", () => ({
  Toast: "Toast",
}));

jest.mock("../../ui/IconChrome", () => ({
  IconChrome: "IconChrome",
}));

jest.mock("../../waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: "JoinWaitlistSheet",
}));

const makeRouter = (canGoBack: boolean): RouterMock => ({
  canGoBack: jest.fn(() => canGoBack),
  back: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
});

const eventFixture = (brandSlug: string) => ({
  id: "event-1",
  brandId: "brand-1",
  name: "Launch Night",
  description: "A public event",
  brandSlug,
  eventSlug: "launch-night",
  status: "scheduled",
  endedAt: null,
  format: "in-person",
  venueName: "Mingla Hall",
  address: "10 Test Street",
  hideAddressUntilTicket: false,
  coverHue: 210,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaCredit: null,
  currency: "GBP",
  tickets: [
    {
      id: "ticket-1",
      name: "General",
      description: null,
      priceGbp: 20,
      currency: "GBP",
      isFree: false,
      isUnlimited: true,
      capacity: null,
      visibility: "visible",
      passwordProtected: false,
      password: null,
      saleStartAt: null,
      saleEndAt: null,
      approvalRequired: false,
      waitlistEnabled: false,
      availableAt: "online",
      displayOrder: 0,
    },
  ],
});

const brandFixture = (slug: string) => ({
  id: "brand-1",
  slug,
  displayName: "Live Brand",
});

const childrenOf = (node: ElementNode): ElementNode[] => {
  const children = node.props?.children;
  if (Array.isArray(children)) return children;
  if (children !== null && typeof children === "object") return [children];
  return [];
};

const findNode = (
  node: ElementNode,
  predicate: (candidate: ElementNode) => boolean,
): ElementNode | null => {
  if (predicate(node)) return node;
  for (const child of childrenOf(node)) {
    const found = findNode(child, predicate);
    if (found !== null) return found;
  }
  return null;
};

const renderPublicEventPage = (
  event: ReturnType<typeof eventFixture>,
  brand: ReturnType<typeof brandFixture> | null,
): ElementNode => {
  const ts = require("typescript") as typeof import("typescript");
  const source = readFileSync(
    path.join(process.cwd(), "src/components/event/PublicEventPage.tsx"),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  });
  const moduleRef: { exports: Record<string, unknown> } = { exports: {} };
  const customRequire = (request: string): unknown => {
    switch (request) {
      case "react":
      case "react-native":
      case "expo-router":
      case "expo-router/head":
      case "react-native-safe-area-context":
      case "@mingla/offering-rendering":
      case "@mingla/offering-rendering":
        return require(request);
      case "./FoundationEventPreview":
        return { FoundationEventPreview: "FoundationEventPreview" };
      case "../../constants/publicUrls":
        return {
          checkoutPublicPath: (eventId: string) => `/checkout/${eventId}`,
          eventOgImageUrl: () => "https://example.test/og.png",
          eventPublicUrl: ({
            brandSlug,
            eventSlug,
          }: {
            brandSlug: string;
            eventSlug: string;
          }) => `https://business.usemingla.com/e/${brandSlug}/${eventSlug}`,
        };
      case "../../constants/designSystem":
        return { spacing: { md: 16 } };
      case "../../context/AuthContext":
        return { useAuth: () => ({ user: mockUser }) };
      case "../../store/currentBrandStore":
        return { useBrandList: () => mockUserBrands };
      case "../../utils/eventDateDisplay":
        return {
          formatDraftDateLine: () => "May 30",
          formatDraftDateSubline: () => "7:00 PM",
          formatDraftDatesList: () => ["May 30, 7:00 PM"],
        };
      case "../../utils/eventCoverMediaRules":
        return { isLegacyUnsafeEventCoverVideoUrl: () => false };
      case "../../types/eventCoverProvider":
        return { eventCoverProviderCreditLabel: () => null };
      case "../ui/ShareModal":
        return { ShareModal: "ShareModal" };
      case "../ui/Toast":
        return { Toast: "Toast" };
      case "../ui/IconChrome":
        return { IconChrome: "IconChrome" };
      case "../waitlist/JoinWaitlistSheet":
        return { JoinWaitlistSheet: "JoinWaitlistSheet" };
      // ORCH-1117 — the adapter mounts the floating Buy bar.
      case "../offering/FloatingOfferingBar":
        return { FloatingOfferingBar: "FloatingOfferingBar" };
      // ORCH-1117 — pre-existing ORCH-1083 dependency the evaluator didn't stub
      // (this adversarial test was already red on origin/main before ORCH-1117).
      case "../../theme/useThemeFont":
        return { useThemeFont: () => undefined };
      default:
        throw new Error(`Unexpected PublicEventPage dependency: ${request}`);
    }
  };
  const evaluator = new Function("require", "exports", "module", transpiled.outputText);
  evaluator(customRequire, moduleRef.exports, moduleRef);
  const PublicEventPage = moduleRef.exports.PublicEventPage as (props: {
    event: ReturnType<typeof eventFixture>;
    brand: ReturnType<typeof brandFixture> | null;
  }) => ElementNode;
  return PublicEventPage({ event, brand });
};

// ORCH-1138 Leg 2 — the published/sold-out/pre-sale/past page now renders
// FoundationEventPreview (the FOUNDATION page, app layer); cancelled/password-gate
// still render SharedPublicEventPage (legacy). The close/share/mute chrome is on
// whichever renders. The scheduled fixtures here resolve to FoundationEventPreview.
const getPageNode = (tree: ElementNode): ElementNode => {
  const node = findNode(
    tree,
    (candidate) =>
      candidate.type === "FoundationEventPreview" ||
      candidate.type === "SharedPublicEventPage",
  );
  expect(node).not.toBeNull();
  return node as ElementNode;
};
// Both nodes carry onClose/onShare: FoundationEventPreview as direct props,
// SharedPublicEventPage via callbacks. Resolve the close handler from either.
const closeHandlerOf = (node: ElementNode): (() => void) | undefined =>
  (node.props as { onClose?: () => void }).onClose ??
  node.props?.callbacks?.onClose;
const shareHandlerOf = (node: ElementNode): (() => void) | undefined =>
  (node.props as { onShare?: () => void }).onShare ??
  node.props?.callbacks?.onShare;

// ORCH-1138 Leg 2 — the close affordance now lives in the shared page's
// FOUNDATION chrome (ParallaxCoverShell OfferingChrome), driven by
// `callbacks.onClose`. The adapter no longer renders a standalone IconChrome row,
// so the close drive goes through the shared page's onClose callback.
const driveClose = (tree: ElementNode): void => {
  const onClose = closeHandlerOf(getPageNode(tree));
  expect(typeof onClose).toBe("function");
  onClose?.();
};

describe("ORCH-0961 — PublicEventPage close callback adversarial coverage", () => {
  beforeEach(() => {
    jest.resetModules();
    mockStateSetters.length = 0;
    mockUser = null;
    mockUserBrands = [];
    mockRouter = makeRouter(false);
  });

  test("deep-link close falls back to the live brand slug when brand is populated", () => {
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));

    driveClose(tree);

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/live-brand");
  });

  test("deep-link close falls back to event.brandSlug when brand is null", () => {
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), null);

    driveClose(tree);

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/frozen-brand");
  });

  test("deep-link close falls back to root when no public brand slug exists", () => {
    const tree = renderPublicEventPage(eventFixture(""), null);

    driveClose(tree);

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  test("history close uses router.back without replacing the URL", () => {
    mockRouter = makeRouter(true);
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));

    driveClose(tree);

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test("buyer-web adapter renders the FOUNDATION page with palette + chrome handlers (ORCH-1138 Leg 2)", () => {
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));
    const page = getPageNode(tree);

    // ORCH-1138 Leg 2 — a scheduled event renders FoundationEventPreview (the
    // FOUNDATION page, composed in the app layer to avoid the package cycle). The
    // adapter passes the resolved `palette` + the cover-video `onToggleMute`
    // handler + the close/share handlers, so the shell owns the single
    // X·Share·Mute chrome. Reverting the FOUNDATION render drops back to the legacy
    // stacked page with no themed chrome.
    expect(page.type).toBe("FoundationEventPreview");
    expect(page.props?.palette).toBeDefined();
    expect(typeof page.props?.onToggleMute).toBe("function");
    expect(typeof shareHandlerOf(page)).toBe("function");
  });

  test("founder public route keeps public close fallback instead of hub replacement", () => {
    mockUser = { id: "founder-1" };
    mockUserBrands = [{ id: "brand-1" }];
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));

    driveClose(tree);

    // ORCH-1138 Leg 2 — the founder-on-public-route close still uses the public
    // brand fallback (NOT the hub), regardless of which page node renders.
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/live-brand");
    expect(mockRouter.replace).not.toHaveBeenCalledWith("/(tabs)/hub/events");
  });
});
