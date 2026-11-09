/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 1 REWORK — TESTER ADVERSARIAL (retest of dac13d319b).
 *
 * The implementor's RW-2/RW-4 pin the rework with source regexes. This suite
 * RENDERS the pieces and attacks them from the angles the regexes cannot see:
 *
 *   C  the collab route hand-off (P1-2). CollabDeckSheet is mounted the way its
 *      ONLY real host mounts it — read from MessageInterface.tsx, not assumed —
 *      and the deck's `onExternalRoute` is fired. A route must land exactly
 *      once, on iOS (Modal onDismiss) and on Android (no onDismiss), and a
 *      double tap during the dismiss must never push twice.
 *   Z  the card-local tap zones (P3-1). `locationX/Y` are relative to the
 *      element the finger lands on, so every face layer that can be that
 *      element must be a full-card fill at 0,0; anything else must be inert
 *      (`none`), pass-through (`box-none`) or a real control. Walked over the
 *      rendered curated face and the place face.
 *   S  the 482pt scrim on the smallest card (iPhone SE, 576pt) at the largest
 *      text: the kicker keeps 4.5:1, the top chrome band keeps the badge-ring
 *      ceiling, and the text column never climbs into the top chrome.
 *
 * KNOWN DEFECTS are pinned with `test.failing` (they pass while the defect is
 * present and turn RED once fixed — then flip them to `test`):
 *   C-1 / C-1i  MessageInterface UNMOUNTS CollabDeckSheet on close
 *        (`showCollabDeckSheet && <CollabDeckSheet …/>`), so `visible` never
 *        flips false while mounted: Android's visible->false flush never runs
 *        and iOS's Modal onDismiss never fires on an unmounted component. The
 *        claimed-venue / brand route is dropped — the deck closes and nothing
 *        opens (P1, Constitution 1).
 *   Z-3  at the largest title size the tap zones still end at the 1.0x column
 *        top, so the top ~38pt of the column (title, kicker) flips a photo at the card's
 *        side edges instead of opening it (P3).
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - CollabDeckSheet without its `!visible && Platform.OS !== "ios"` effect -> C-2 fails;
 *   - CollabDeckSheet without `onDismiss={flushPendingRoute}` -> C-3 fails;
 *   - CollabDeckSheet flushing without clearing pendingRouteRef -> C-4 fails;
 *   - DeckCardPlate without pointerEvents="box-none" on the plate -> Z-1 fails;
 *   - surfaceScrimHeight back on kickerTopDepthForLines (1.0x) -> S-1 fails.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

// ── platform + Modal doubles ────────────────────────────────────────────────
// A faithful Modal: iOS reports onDismiss after a MOUNTED modal goes from
// visible to hidden; Android never calls onDismiss here; an UNMOUNTED modal
// reports nothing on either platform (its JS owner is gone).
let mockPlatformOS: "ios" | "android" = "android";
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  function FakeModal(props: { visible?: boolean; onDismiss?: () => void; children?: React.ReactNode }) {
    const wasVisible = R.useRef(props.visible === true);
    R.useEffect(() => {
      if (wasVisible.current && props.visible !== true && mockPlatformOS === "ios") props.onDismiss?.();
      wasVisible.current = props.visible === true;
    }, [props.visible]);
    return props.visible ? R.createElement(actual.View, { testID: "collab-modal" }, props.children) : null;
  }
  const Platform = Object.create(actual.Platform);
  Object.defineProperty(Platform, "OS", { get: () => mockPlatformOS });
  return new Proxy(actual, {
    get(target: Record<string, unknown>, key: string) {
      if (key === "Modal") return FakeModal;
      if (key === "Platform") return Platform;
      return target[key];
    },
  });
});

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const interpolate = (v: string, o: Record<string, unknown> = {}) =>
    String(v).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => (k in o ? String(o[k]) : `{{${k}}}`));
  const t = (key: string, o: Record<string, unknown> = {}) => {
    const leaf = key.includes(":") ? key.split(":").at(-1)! : key;
    return interpolate(cards[leaf] ?? (o.defaultValue as string | undefined) ?? key, o);
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }), initReactI18next: {} };
});
// The deck itself is not under test here: it is the thing that calls
// onExternalRoute. Capture the props CollabDeckSheet hands it.
let mockDeckProps: Record<string, any> | null = null;
jest.mock("../../SwipeableCards", () => ({
  __esModule: true,
  default: (p: Record<string, any>) => {
    mockDeckProps = p;
    return null;
  },
}));
jest.mock("../../PreferencesSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { light: jest.fn(), medium: jest.fn() } }));
jest.mock("../../../contexts/RecommendationsContext", () => ({
  RecommendationsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("expo-image", () => {
  const R = jest.requireActual("react");
  const Image = (p: Record<string, unknown>) => R.createElement("ExpoImage", p);
  Image.prefetch = jest.fn(() => Promise.resolve(true));
  return { Image };
});
jest.mock("@mingla/offering-rendering", () => {
  const R = jest.requireActual("react");
  return { EventCoverMedia: (p: Record<string, unknown>) => R.createElement("EventCoverMedia", p) };
});
jest.mock("../../../utils/breadcrumbs", () => ({ breadcrumbs: { add: jest.fn(), tap: jest.fn() } }));
jest.mock("../../../services/currencyService", () => ({ convertBetween: (a: number) => a, getServableRate: () => null }));
jest.mock("../../../services/countryCurrencyService", () => ({ currencySymbolMap: { USD: "$", NGN: "₦" } }));
jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));

const RN = require("react-native");
const { CollabDeckSheet } = require("../../connections/CollabDeckSheet");
const { CuratedExperienceSwipeCard } = require("../../CuratedExperienceSwipeCard");
const { DeckCardPlate, CardStateDiscs, platePresentation } = require("../../deckCardPlate");
const { DeckTextColumn, HostChip, PhotoPagerBars, PhotoCapsule, photoLabelTop, tapZoneBottomY } = require("../DeckCardChrome");
const { curatedDeckPhotos } = require("../deckCardModel");
const CI = require("../../../../../packages/card-identity/index.js");

type Node = import("react-test-renderer").ReactTestInstance;
const SRC = path.resolve(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");

const mounted: import("react-test-renderer").ReactTestRenderer[] = [];
function mount(el: React.ReactElement) {
  let root: import("react-test-renderer").ReactTestRenderer | null = null;
  TestRenderer.act(() => {
    root = TestRenderer.create(el);
  });
  mounted.push(root!);
  return root!;
}
afterEach(() => {
  while (mounted.length > 0) {
    const r = mounted.pop()!;
    TestRenderer.act(() => r.unmount());
  }
  mockPush.mockClear();
  mockDeckProps = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// C — the collab hand-off
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HOW THE ONE REAL HOST MOUNTS THE SHEET, read from source: either it renders
 * `{… showCollabDeckSheet && … <CollabDeckSheet visible={showCollabDeckSheet}`
 * (unmount on close) or it keeps the sheet mounted and only flips `visible`.
 */
const HOST = read("components/MessageInterface.tsx");
const hostUnmountsOnClose = /showCollabDeckSheet\s*&&[^?]*\?\s*\(\s*<CollabDeckSheet/.test(HOST);

const sheetProps = {
  sessionId: "s1",
  sessionName: "Friday crew",
  userPreferences: {},
  accountPreferences: {},
  savedCards: [],
};

let setOpen: ((v: boolean) => void) | null = null;
function RealHost({ unmountOnClose }: { unmountOnClose: boolean }) {
  const [open, setOpenState] = React.useState(true);
  setOpen = setOpenState;
  const sheet = <CollabDeckSheet {...sheetProps} visible={open} onClose={() => setOpenState(false)} />;
  return unmountOnClose ? (open ? sheet : null) : sheet;
}

function tapClaimedVenue(path: string) {
  expect(mockDeckProps?.onExternalRoute).toEqual(expect.any(Function));
  TestRenderer.act(() => mockDeckProps!.onExternalRoute(path));
}

describe("C — a route out of the collab deck lands exactly once", () => {
  test("C-0 the source read is live: the host mount shape was recognised", () => {
    expect(HOST).toMatch(/<CollabDeckSheet/);
    expect(typeof hostUnmountsOnClose).toBe("boolean");
  });

  test.failing("C-1 (P1, Android) mounted like MessageInterface, a claimed-venue tap opens the venue page", () => {
    mockPlatformOS = "android";
    mount(<RealHost unmountOnClose={hostUnmountsOnClose} />);
    tapClaimedVenue("/b/itan/v/garden");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/b/itan/v/garden");
  });

  test.failing("C-1i (P1, iOS) mounted like MessageInterface, the push waits for onDismiss and then lands", () => {
    mockPlatformOS = "ios";
    mount(<RealHost unmountOnClose={hostUnmountsOnClose} />);
    tapClaimedVenue("/b/itan/v/garden");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/b/itan/v/garden");
  });

  test("C-2 (Android, sheet kept mounted) double tap during the dismiss pushes ONCE, after the close", () => {
    mockPlatformOS = "android";
    const root = mount(<RealHost unmountOnClose={false} />);
    // Two taps inside the same frame: the modal has not re-rendered yet.
    TestRenderer.act(() => {
      mockDeckProps!.onExternalRoute("/b/itan/v/garden");
      mockDeckProps!.onExternalRoute("/b/itan/v/garden");
    });
    expect(root.root.findAll((n: Node) => n.props?.testID === "collab-modal")).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/b/itan/v/garden");
  });

  test("C-3 (iOS, sheet kept mounted) nothing is pushed while the modal is still up; onDismiss pushes once", () => {
    mockPlatformOS = "ios";
    mount(<RealHost unmountOnClose={false} />);
    // Hand the route over WITHOUT letting the close commit: no push yet.
    let pushesBeforeDismiss = -1;
    TestRenderer.act(() => {
      mockDeckProps!.onExternalRoute("/b/itan");
      pushesBeforeDismiss = mockPush.mock.calls.length;
    });
    expect(pushesBeforeDismiss).toBe(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/b/itan");
  });

  test("C-4 a plain close never replays a route, and a handed-off route is spent after one push", () => {
    for (const os of ["android", "ios"] as const) {
      mockPlatformOS = os;
      mockPush.mockClear();
      mount(<RealHost unmountOnClose={false} />);
      tapClaimedVenue("/b/itan/v/garden");
      expect(mockPush).toHaveBeenCalledTimes(1);
      // Reopen the deck, then close it with the back button: no stale route.
      TestRenderer.act(() => setOpen!(true));
      TestRenderer.act(() => setOpen!(false));
      expect(mockPush).toHaveBeenCalledTimes(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Z — every touch target on the face is card-local, inert, or a control
// ─────────────────────────────────────────────────────────────────────────────

const flat = (s: unknown): Record<string, unknown> => RN.StyleSheet.flatten(s) ?? {};

function isFullCardFill(style: Record<string, unknown>): boolean {
  const zeroInsets =
    style.position === "absolute" &&
    [style.top, style.left, style.right, style.bottom].every((v) => v === 0);
  const fullSize = style.width === "100%" && style.height === "100%" && (style.position !== "absolute" || (style.top ?? 0) === 0);
  const flexRoot = style.flex === 1 && style.position !== "absolute";
  return zeroInsets || fullSize || flexRoot;
}

/**
 * Walk the rendered face from its root. A node can be the touch target that
 * reports `locationX/Y` when its own pointerEvents is auto/box-only and no
 * ancestor is `none`/`box-only`. Every such node must be a full-card fill at
 * 0,0, or sit inside a real control (which claims the press itself).
 */
function offendingTargets(root: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node, blocked: boolean, inControl: boolean, trail: string) => {
    const p = (n.props ?? {}) as Record<string, any>;
    const pe = p.pointerEvents as string | undefined;
    const isHost = typeof n.type !== "string" && (n.type === RN.View || n.type === RN.Text || n.type === RN.Image);
    const isControl = typeof p.onPress === "function" || p.accessibilityRole === "button";
    const control = inControl || isControl;
    const childBlocked = blocked || pe === "none" || pe === "box-only";
    if (isHost && !blocked && pe !== "none" && pe !== "box-none" && !control) {
      const style = flat(p.style);
      if (!isFullCardFill(style)) out.push(`${trail} ${p.testID ?? ""} ${JSON.stringify(style).slice(0, 120)}`);
    }
    for (const c of n.children) if (typeof c !== "string") walk(c as Node, childBlocked, control, `${trail}>${(c as Node).type?.displayName ?? (c as Node).type?.name ?? "?"}`);
  };
  walk(root, false, false, "face");
  return out;
}

describe("Z — the tap path's locationX/Y is always card-local", () => {
  const stops = [
    { placeName: "Café Neo", imageUrl: "https://cdn/a.jpg", estimatedDurationMinutes: 45 },
    { placeName: "Nike Art", imageUrl: "https://cdn/b.jpg", estimatedDurationMinutes: 60 },
  ];
  const curated = {
    id: "c1",
    title: "A slow Saturday in Ikoyi",
    cardType: "curated",
    stops,
    totalPriceMin: 0,
    totalPriceMax: 0,
  };

  test("Z-0 the walker is live: a bottom-anchored plate that takes touches is reported", () => {
    const root = mount(
      <RN.View style={{ flex: 1 }}>
        <RN.View testID="stray-plate" style={{ position: "absolute", left: 14, right: 14, bottom: 16, height: 96 }} />
        <RN.View pointerEvents="none" style={{ position: "absolute", left: 14, right: 14, bottom: 16, height: 96 }} />
      </RN.View>,
    );
    const found = offendingTargets(root.root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/stray-plate/);
  });

  test("Z-1 the place face (photo, chrome, column, plate): no stray target that is not a full-card fill", () => {
    const spans = [{ kind: "fact", text: "★ 4.6" }, { kind: "fact", text: "3.4 mi" }];
    const presentation = platePresentation(spans, 1);
    const root = mount(
      <RN.View style={{ flex: 1 }}>
        <RN.View style={RN.StyleSheet.absoluteFill}>
          <RN.View testID="hero-photo" style={{ width: "100%", height: "100%" }} />
        </RN.View>
        <PhotoPagerBars count={4} index={1} top={60} />
        <CardStateDiscs saved scheduled savedLabel="Saved" scheduledLabel="Scheduled" />
        <HostChip name="Itan" top={70} label="Hosted by Itan" />
        <PhotoCapsule text="Tap a side to see more photos" top={100} align="center" />
        <RN.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
          <DeckTextColumn title="Nok by Alara" kicker="Restaurant · Ikoyi" bottom={presentation.titleBottom} smartChip={{ text: "Closed when you arrive", tone: "warn" }} />
          <DeckCardPlate
            spans={spans}
            metaLines={presentation.metaLines}
            beenHere={<RN.Pressable accessibilityRole="button" onPress={() => undefined}><RN.Text>Been here</RN.Text></RN.Pressable>}
            onSharePress={() => undefined}
            shareLabel="Share"
            onDetailsPress={() => undefined}
            detailsLabel="Details"
          />
        </RN.View>
      </RN.View>,
    );
    expect(offendingTargets(root.root)).toEqual([]);
  });

  test("Z-2 the curated face (stop stack, route, kicker, slivers, plate, From pill): same", () => {
    const root = mount(
      <CuratedExperienceSwipeCard
        card={curated}
        currencyCode="USD"
        photos={curatedDeckPhotos(stops)}
        photoIndex={0}
        onPhotoFailed={() => undefined}
        failedPhotos={new Set()}
        kicker="Curated plan · 2 stops"
        smartChip={{ text: "Stop 2 closed when you arrive", tone: "warn" }}
        photoHint="Tap a side to see more photos"
        stopLabel="Stop 1 · Café Neo"
        fromPriceLabel="From ≈ $74"
        beenHere={<RN.Pressable accessibilityRole="button" onPress={() => undefined}><RN.Text>Been here</RN.Text></RN.Pressable>}
        onSharePress={() => undefined}
        shareLabel="Share"
        onDetailsPress={() => undefined}
        detailsLabel="Details"
        isTopCard
      />,
    );
    expect(offendingTargets(root.root)).toEqual([]);
  });

  test.failing("Z-3 (P3) at the largest title size, no part of the title sits inside a flip zone", () => {
    // A two-line title at its 1.4x cap plus the kicker at 1.3x, curated with a chip.
    const S1 = CI.SURFACES.s1Single;
    const titleBottom = platePresentation([{ kind: "fact", text: "·" }], 2).titleBottom;
    const cardH = 576;
    const zoneBottom = tapZoneBottomY(cardH, titleBottom, { smartChip: true, stack: true });
    const columnAtMax =
      S1.titleLines * S1.titleLH * CI.MAX_FONT_SCALE.title +
      CI.KICKER.gap +
      CI.KICKER.lineHeight * CI.MAX_FONT_SCALE.meta +
      CI.STOP_STACK.size + CI.STOP_STACK.marginBottom +
      CI.SMART_CHIP.lineHeight * CI.MAX_FONT_SCALE.meta + 2 * CI.SMART_CHIP.paddingV + CI.SMART_CHIP.marginBottom;
    const columnTopY = cardH - titleBottom - columnAtMax;
    expect(zoneBottom).toBeLessThanOrEqual(columnTopY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S — the 482pt scrim on the smallest card, at the largest text
// ─────────────────────────────────────────────────────────────────────────────

describe("S — iPhone SE (576pt card) at 1.4x title / 1.3x kicker", () => {
  const SE_CARD = 576;
  const SE_SAFE_TOP = 20;
  const scrim = CI.surfaceScrimHeight("s1Single");
  const sRGB = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const whiteOn = (alpha: number) => {
    // White photo under a black scrim of `alpha`: the backdrop's luminance.
    const v = 1 - alpha;
    const L = sRGB(v);
    return 1.05 / (L + 0.05);
  };

  test("S-1 the kicker keeps 4.5:1 on a white photo at the largest text, on every silhouette", () => {
    expect(scrim).toBeLessThanOrEqual(SE_CARD);
    for (const lines of [0, 1, 2]) {
      const depth = CI.kickerSolveDepthForLines("s1Single", lines);
      // The kicker's TOP edge at max text is the shallowest point of its glyphs.
      const ratio = whiteOn(CI.rampAlphaAtDepth(depth, scrim));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("S-2 the bottom scrim reaches into the top chrome band only below the badge-ring ceiling", () => {
    // Chrome band bottom, card-local (deckHeroConstants: safeTop + 46 - 2).
    const chromeBottomY = SE_SAFE_TOP + 44;
    const depthFromBottom = SE_CARD - chromeBottomY;
    const bottomAlpha = CI.rampAlphaAtDepth(depthFromBottom, scrim);
    const topAlpha = CI.RAMP.top.alphas[0];
    const stacked = 1 - (1 - topAlpha) * (1 - bottomAlpha);
    expect(stacked).toBeLessThanOrEqual(CI.RAMP.top.maxPlateauAlpha);
  });

  test("S-3 the text column at the largest text never climbs into the hint / host chip row", () => {
    const S1 = CI.SURFACES.s1Single;
    const titleBottom = platePresentation([{ kind: "fact", text: "·" }], 2).titleBottom;
    const columnAtMax =
      S1.titleLines * S1.titleLH * CI.MAX_FONT_SCALE.title +
      CI.KICKER.gap + CI.KICKER.lineHeight * CI.MAX_FONT_SCALE.meta +
      CI.STOP_STACK.size + CI.STOP_STACK.marginBottom +
      CI.SMART_CHIP.lineHeight * CI.MAX_FONT_SCALE.meta + 2 * CI.SMART_CHIP.paddingV + CI.SMART_CHIP.marginBottom;
    const columnTopY = SE_CARD - titleBottom - columnAtMax;
    const label = CI.PHOTO_PAGER.label;
    const hintTop = photoLabelTop(SE_SAFE_TOP) + label.lineHeight * 2 + 4;
    const hintBottom = hintTop + label.lineHeight * CI.MAX_FONT_SCALE.meta + 2 * label.paddingV;
    expect(columnTopY).toBeGreaterThan(hintBottom);
  });
});
