/**
 * ORCH-0961 adversarial gate — callback behavior, not source shape.
 *
 * The implementor-owned tests pin JSX/source presence. This tester-owned
 * adversarial test mounts the adapter boundary with mocked hooks, extracts the
 * rendered callback props, and invokes the actual close handlers with router
 * spies across the fallback branches that caused the dead-end bug.
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
  Platform: { OS: "web" },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("expo-router/head", () => "Head");

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@mingla/event-rendering", () => ({
  PublicEventPage: "SharedPublicEventPage",
  // ORCH-1117 — the adapter now also pulls the shared theme + offering-CTA
  // helpers + the floating bar. Stub them so the close-callback evaluator runs.
  resolveTheme: () => ({ color: "#eb7825", foregroundColor: "#ffffff", fontFamilyValue: undefined }),
  resolveOfferingCta: () => ({ kind: "buy", label: "Buy ticket", price: "£25", tappable: true }),
  resolveOfferingSurface: () => "dark",
  computeOfferingVariant: () => "published",
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
      case "@mingla/event-rendering":
        return require(request);
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

const getSharedPage = (tree: ElementNode): ElementNode => {
  const node = findNode(tree, (candidate) => candidate.type === "SharedPublicEventPage");
  expect(node).not.toBeNull();
  return node as ElementNode;
};

const getCloseChrome = (tree: ElementNode): ElementNode => {
  const node = findNode(
    tree,
    (candidate) =>
      candidate.type === "IconChrome" &&
      candidate.props?.accessibilityLabel === "Close",
  );
  expect(node).not.toBeNull();
  return node as ElementNode;
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

    getCloseChrome(tree).props?.onPress?.();

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/live-brand");
  });

  test("deep-link close falls back to event.brandSlug when brand is null", () => {
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), null);

    getSharedPage(tree).props?.callbacks?.onClose?.();

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/frozen-brand");
  });

  test("deep-link close falls back to root when no public brand slug exists", () => {
    const tree = renderPublicEventPage(eventFixture(""), null);

    getCloseChrome(tree).props?.onPress?.();

    expect(mockRouter.canGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  test("history close uses router.back without replacing the URL", () => {
    mockRouter = makeRouter(true);
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));

    getSharedPage(tree).props?.callbacks?.onClose?.();

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test("buyer-web adapter suppresses the shared renderer's floating chrome to avoid duplicate Share/Close (ORCH-0961 rework F-1)", () => {
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));
    const sharedPage = getSharedPage(tree);

    // The shared renderer always emits its own Close+Share row unless the
    // host explicitly opts out. The buyer-web adapter must pass
    // `hideFloatingChrome={true}` so only the adapter's IconChrome row exists
    // in the DOM + accessibility tree. Reverting this prop reintroduces the
    // duplicate Share button caught by tester F-1.
    expect(sharedPage.props?.hideFloatingChrome).toBe(true);
  });

  test("founder public route keeps public close fallback instead of hub replacement", () => {
    mockUser = { id: "founder-1" };
    mockUserBrands = [{ id: "brand-1" }];
    const tree = renderPublicEventPage(eventFixture("frozen-brand"), brandFixture("live-brand"));
    const sharedPage = getSharedPage(tree);

    sharedPage.props?.callbacks?.onClose?.();

    expect(sharedPage.props?.viewerRole).toBe("organizer");
    expect(mockRouter.replace).toHaveBeenCalledWith("/b/live-brand");
    expect(mockRouter.replace).not.toHaveBeenCalledWith("/(tabs)/hub/events");
  });
});
