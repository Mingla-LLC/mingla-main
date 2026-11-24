// ParallaxCoverShell — ORCH-1138 A2.
//
// THE single structural primitive every public offering page mounts: the
// full-bleed parallax cover + the overlapping rounded body seam + body-level
// fixed chrome + the responsive desktop two-column shell with a sticky right
// panel. Matches DIRECTION_A_V2_FULL_RESPONSIVE.html exactly.
//
// Z-INDEX LAYERING (the mockup's proven stacking, do NOT regress):
//   cover/hero = 1  <  body content = 2  <  chrome = 70.
// The chrome row escapes the pinned-cover stacking context so X/Share/Mute stay
// fixed + tappable while the body slides over the cover.
//
// Per-platform:
//   • WEB phone (<1024px): cover position:fixed at z1; a flow spacer holds its
//     height; the body (opaque page bg, top-radius 28, −28 seam) slides UP over
//     it at z2; chrome is a body-level position:fixed layer at z70.
//   • WEB desktop (≥1024px): centered ≤1200 shell; contained cover (21/9);
//     CSS grid minmax(0,1fr) 360px; right column = sticky stickyPanel; chrome
//     position:absolute on the contained cover; phone floating bar hidden by the
//     caller.
//   • NATIVE (always single-column immersive): cover pinned absolute behind a
//     ScrollView; chrome is an absolute box-none sibling padded by safeAreaTop;
//     no desktop two-column.
//
// NATIVE STACKING (THE TRAP — do NOT regress): RN native has no position:fixed
// and resolves z-order by SIBLING zIndex within a shared parent + tree order —
// NOT by the document-wide stacking the web branch relies on. The three direct
// children of nativeHost are the cover (zIndex 1), the ScrollView (the content
// layer), and the chrome (zIndex 70). The ScrollView MUST carry an explicit
// zIndex ABOVE the cover (so the scrolling body slides OVER the cover instead of
// behind it) and BELOW the chrome. Setting zIndex 2 only on the inner nativeBody
// is NOT enough on native: nativeBody is nested inside the ScrollView, so its
// zIndex orders it against the spacer, not against the cover (the cover is a
// sibling of the ScrollView, one level up). The pinned absolute cover therefore
// paints over an un-z-indexed (auto=0) ScrollView. So we z-index the ScrollView
// itself: CONTENT_Z (cover 1 < CONTENT_Z 2 < chrome 70). The opaque nativeBody
// bg + the full-height spacer make the body fully occlude the cover as it slides.
//
// Pure: react-native + @mingla/offering-rendering only. Web-only `position` values
// (fixed/sticky) are applied via a typed web-style escape hatch (RN's ViewStyle
// type omits them but react-native-web honors them at runtime).

import React from "react";
import {
  flyerColumnStickyTop,
  flyerMaxHeight,
  PREMIUM_DESK_PAGE_TOP,
} from "./flyerColumnStickyTop";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  S6_PHONE,
  S6_PLATE,
  S6_PLATE_BOUNDARY,
} from "@mingla/card-identity/s6";

import { LinearGradient } from "expo-linear-gradient";

import { EventCoverMedia } from "./EventCoverMedia";
import { desktopBlur } from "./OfferingGlassBar";
import { OFFERING_PREMIUM_HEADER_ROW } from "./offeringFrameMetrics";
import {
  OfferingGlassBackdrop,
  glassBlurActive,
  glassFillAlpha,
  useOfferingGlass,
} from "./OfferingGlassContext";
import {
  OfferingCoverIdentity,
  coverTitleMayClamp,
  type OfferingCoverIdentityData,
} from "./OfferingCoverIdentity";
import { boldFontFamily, hexToRgba, paletteAccentGradient } from "./themePalette";
import { themeFontFace } from "./themeAccentStyle";
import { useReduceMotionPreference } from "./useReduceMotionPreference";
import { ThemeEntranceAnimation } from "./ThemeEntranceAnimation";
import { CoverGalleryRow } from "./CoverGalleryRow";
import { type ResolvedTheme } from "./designTokens";
import { type TextSafeZone } from "./themeMotion";
import { type ThemePalette } from "./themePalette";
import { type OfferingGalleryImage } from "./types";
import {
  buildHeroMediaAccessibleLabel,
  HeroMediaChangeAnnouncer,
} from "./heroMediaAccessibility";

import { OfferingChrome } from "./OfferingChrome";
import { useResponsiveLayout } from "./useResponsiveLayout";

// react-native-web honors CSS position values RN's types omit. This cast is the
// single sanctioned escape hatch for the parallax pin + the sticky panel.
// issue #868 — extended with the horizontal scroll-snap CSS props RN's ViewStyle
// omits but react-native-web honors, for the web cover pager (independent axes).
type WebViewStyle = Omit<ViewStyle, "position"> & {
  position?: ViewStyle["position"] | "fixed" | "sticky";
  overflowX?: "auto" | "hidden" | "scroll" | "visible";
  scrollSnapType?: string;
  scrollSnapAlign?: string;
  // issue #4420 — web-only paint props for the premium desktop frame.
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  filter?: string;
  boxShadow?: string;
};
const webStyle = (style: WebViewStyle): StyleProp<ViewStyle> =>
  style as StyleProp<ViewStyle>;

const SHELL_MAX_WIDTH = 1200;
const STICKY_PANEL_WIDTH = 360;
const SEAM = 28;
// issue #4420 — premium frame metrics (design file: public-pages-design.html).
const PREMIUM_HEADER_ROW = OFFERING_PREMIUM_HEADER_ROW;
const PREMIUM_DESKTOP_SOLID_AT = 40;
const PREMIUM_FLYER_MAX = 420;
const PREMIUM_GUTTER = 24;

// Z-INDEX CONTRACT (the mockup's proven stacking, shared by web + native):
//   cover/hero (lowest) < content (middle, opaque, slides over) < chrome (highest).
// Exported so the regression test can assert the ordering without magic numbers.
export const COVER_Z = 1;
export const CONTENT_Z = 2;
export const CHROME_Z = 70;
// issue #1023 — the full-screen theme motion: over the cover AND the details
// sheet (CONTENT_Z), but under EVERY interactive layer: the floating Buy /
// Reserve bars (z 6 — TripReserveBar, the event and RSVP float wraps), the
// chrome (CHROME_Z) and modals. It must be lower than the floating bars even
// though they are rendered by the PAGE outside this shell: React Native's
// view flattening lifts these children into the page's own child list, so the
// overlay's zIndex is compared with the bar's directly. (Desktop web uses
// DESKTOP_MOTION_Z: its chrome sits in the hero at z 5.)
export const MOTION_Z = 5;
/** The lowest zIndex any floating CTA bar uses; MOTION_Z must stay below it. */
export const FLOATING_CTA_MIN_Z = 6;
export const DESKTOP_MOTION_Z = 4;

/**
 * #4490 W3 fix 4 (W3-N34a) — where the phone header band is fully solid: its
 * usual point (the cover has scrolled away), or the end of the page when the
 * page cannot scroll that far, so the band is never left mid-fade with the
 * cover's title reading through the compact title. A page that cannot scroll
 * at all keeps the usual point (the band never shows).
 */
export function premiumSolidThreshold(args: { base: number; maxScroll: number | null }): number {
  if (args.maxScroll === null || args.maxScroll <= 0) return args.base;
  return Math.min(args.base, Math.max(1, args.maxScroll - 2));
}

export interface ParallaxCoverShellProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue?: number | null;
  entranceAnimationKey: string;
  muted: boolean;
  onToggleMute: () => void;
  showMute: boolean;
  onClose: () => void;
  onShare: () => void;
  directionCIdentity?: { title: string; meta?: string | null };
  stateBanner?: React.ReactNode | null;
  children: React.ReactNode;
  stickyPanel?: React.ReactNode | null;
  ScrollComponent?: React.ComponentType<{
    contentContainerStyle?: StyleProp<ViewStyle>;
    showsVerticalScrollIndicator?: boolean;
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    scrollEventThrottle?: number;
    onLayout?: (event: LayoutChangeEvent) => void;
  }>;
  contentBottomInset?: number;
  safeAreaTop?: number;
  /**
   * ORCH-1138 device-rework #3 — OPTIONAL scroll-awareness passthrough so a caller
   * (the public trip route) can hide its floating Reserve pill once the in-content
   * docked CTA scrolls into view. Forwarded verbatim to the phone/native Scroll;
   * absent ⇒ byte-identical to today (event/experience callers untouched).
   */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  /**
   * OPTIONAL ref to the phone / native body scroll view, so a caller can scroll
   * a field into view (the public RSVP page reveals the first unfinished
   * contact field after a blocked Going tap). Absent ⇒ byte-identical.
   */
  scrollRef?: React.Ref<ScrollView>;
  closeAccessibilityLabel?: string;
  /**
   * ORCH-1159 — forwarded verbatim to OfferingChrome. When true, the floating
   * "X" (close) button is HIDDEN on web and KEPT on native (Share + Mute
   * unaffected). The public event / trip / experience pages pass `true`; the
   * public brand page omits it (keeps its X on web). Absent ⇒ unchanged.
   */
  hideCloseOnWeb?: boolean;
  /**
   * ORCH-1153 BUG-2 — OPTIONAL phone/native cover aspect ratio (width / height).
   * The pinned cover + its flow spacer both use this. Default `4 / 5` (the
   * proven event/trip/RSVP full-bleed cover; native-stacking test asserts 4/5).
   * A page whose detail content needs a taller readable viewport as it slides
   * over the cover (the experience page — shorter body than a multi-day trip)
   * passes a WIDER ratio (e.g. `3 / 2`), which makes the cover SHORTER so more
   * of the screen is content from the first paint. Desktop is unaffected (its
   * contained hero uses a fixed 21/9). Absent ⇒ byte-identical to today.
   */
  coverAspectRatio?: number;
  /**
   * issue #868 [cover-gallery] — the ADDITIONAL image/GIF gallery items (hero
   * indices 1..N). The pinned cover becomes a swipeable pager over the sequence
   * [cover] ++ galleryImages (page 0 = the existing cover, incl. a VIDEO cover,
   * UNCHANGED), and a CoverGalleryRow is rendered as the body's first row. Absent
   * / empty ⇒ BYTE-IDENTICAL to today (single cover, no pager, no row) for BOTH
   * image and video covers.
   */
  galleryImages?: OfferingGalleryImage[];
  heroAccessibilitySubject?: string | null;
  coverMediaAlt?: string | null;
  /**
   * issue #1561 [first-screen-rebuild] — the word printed on the striped
   * placeholder when there is NO cover media. `EventCover` defaults it to
   * "Cover", which is authoring-console language: #1550 Leg C found a live
   * PUBLIC venue page printing the literal word `COVER` at full hero size,
   * which reads to a stranger as a broken page rather than a designed absence.
   * A caller that renders to the public passes something a guest can use (the
   * venue's category and city). ABSENT ⇒ `EventCoverMedia`'s own "Cover"
   * default, i.e. byte-identical to today for every existing caller.
   *
   * `null` (the default) is the ABSENT sentinel, not the empty string: it is
   * given a default so the destructure below infers a type. Every other
   * defaultless binding in this signature costs one TS7031 under
   * mingla-business's tsconfig (which cannot resolve this package's `react`),
   * and issue #1403's typecheck-delta gate fails on ANY added diagnostic
   * signature anywhere in the graph — not only inside its own targets.
   */
  coverPlaceholderLabel?: string | null;
  /**
   * issue #4420 — the premium public-page frame (Seth-approved redesign).
   * "premium": the eyebrow, title and "Presented by" sit on the cover's
   * bottom over a dark scrim and the cover drifts slower than the scroll;
   * a slim glass header fades in with the title once the cover has scrolled
   * away, and close / share / pause become plain icons in it; on desktop
   * (web >= 1024) the page is two columns, the whole portrait flyer sticky on
   * the left with `desktopFlyerActions` under it and the content on the
   * right, over a large blurred copy of the flyer that drifts slower than
   * the scroll. ABSENT ⇒ "classic": byte-identical to before (the brand and
   * venue pages keep it until wave B opts them in).
   */
  frame?: "classic" | "premium";
  /** issue #4420 — premium only: the identity printed on the cover. */
  coverIdentity?: OfferingCoverIdentityData | null;
  /** issue #4420 — premium only: the glass header title (defaults to the identity title). */
  headerTitle?: string | null;
  /** issue #4420 — premium desktop only: the actions under the flyer. */
  desktopFlyerActions?: React.ReactNode;
  testID?: string;
}

export const ParallaxCoverShell: React.FC<ParallaxCoverShellProps> = ({
  palette,
  theme,
  coverMediaUrl,
  coverMediaType,
  coverHue,
  entranceAnimationKey,
  muted,
  onToggleMute,
  showMute,
  onClose,
  onShare,
  directionCIdentity,
  stateBanner,
  children,
  stickyPanel,
  ScrollComponent,
  contentBottomInset = 0,
  safeAreaTop = 0,
  onScroll,
  onScrollViewLayout,
  scrollRef,
  closeAccessibilityLabel,
  hideCloseOnWeb = false,
  coverAspectRatio = 4 / 5,
  galleryImages,
  heroAccessibilitySubject = null,
  coverMediaAlt = null,
  coverPlaceholderLabel = null,
  frame = "classic",
  coverIdentity = null,
  headerTitle = null,
  desktopFlyerActions = null,
  testID,
}: ParallaxCoverShellProps) => {
  const { isDesktop, isWeb } = useResponsiveLayout();
  const premium = frame === "premium";
  const reduceMotion = useReduceMotionPreference();
  const Scroll = ScrollComponent ?? ScrollView;

  // issue #868 [cover-gallery] — hero sequence = [cover] ++ gallery. The pager +
  // beneath-cover row engage ONLY when there is at least one ADDITIONAL image
  // (sequence length > 1). Otherwise every path below renders BYTE-IDENTICALLY to
  // today (single cover — image OR video — no pager, no row).
  const gallery = React.useMemo(
    () =>
      (galleryImages ?? []).filter(
        (g): g is OfferingGalleryImage =>
          typeof g?.url === "string" && g.url.length > 0,
      ),
    [galleryImages],
  );
  const sequenceActive = gallery.length >= 1;
  // Single owner of the shown-item state: 0 = cover, i = gallery[i-1].
  const [activeIndex, setActiveIndex] = React.useState(0);
  // Pass 4 — DETERMINISTIC render (fixes "the cover never pages"): a horizontal
  // pagingEnabled ScrollView pinned behind the body ScrollView could not reliably
  // scrollTo its pages, so the shown image was stuck on page 0. The cover now
  // renders ONLY sequence[activeIndex]; a tap/chevron changes activeIndex → the
  // cover re-renders the new image. No scroll machinery, no flicker (no scroll
  // offset to commit), and no RISK-1 gesture arbitration.
  const activeSequenceItem =
    activeIndex <= 0 ? undefined : gallery[activeIndex - 1];
  const activeAccessibleLabel = buildHeroMediaAccessibleLabel({
    subject: heroAccessibilitySubject,
    mediaType: activeSequenceItem?.type ?? coverMediaType,
    position: activeIndex + 1,
    total: gallery.length + 1,
    description:
      activeSequenceItem === undefined ? coverMediaAlt : activeSequenceItem.alt,
  });

  // Tap a row card → set the shown index. That's all — the deterministic render
  // below picks up sequence[activeIndex].
  const selectSequenceIndex = React.useCallback((index: number): void => {
    setActiveIndex(index);
  }, []);

  const chrome = (
    <OfferingChrome
      palette={palette}
      showMute={showMute}
      muted={muted}
      onClose={onClose}
      onShare={onShare}
      onToggleMute={onToggleMute}
      closeAccessibilityLabel={closeAccessibilityLabel}
      hideCloseOnWeb={hideCloseOnWeb}
      testID={testID !== undefined ? `${testID}-chrome` : undefined}
    />
  );

  // issue #1561 — SELECT between two complete prop objects rather than passing
  // `label={undefined}`: an absent `coverPlaceholderLabel` must leave the prop
  // OFF the element entirely, so every existing caller's rendered tree is
  // byte-identical and `EventCover`'s own "Cover" default is what applies.
  const placeholderLabel: string | null = coverPlaceholderLabel ?? null;
  const coverPlaceholderLabelProps: { label?: string } =
    placeholderLabel === null || placeholderLabel === ""
      ? {}
      : { label: placeholderLabel };

  // #4420 journey — a public offering with NO cover used to print the
  // authoring placeholder ("COVER" on Mingla-orange stripes). A guest now sees
  // the host's own colour: their gradient when they chose one, else their
  // single colour. The premium frame's own scrim keeps the title readable on
  // it. A caller that names its own placeholder word (the venue page)
  // keeps it.
  const hasCoverMedia =
    typeof coverMediaUrl === "string" && coverMediaUrl.trim().length > 0;
  const accentStops = paletteAccentGradient(palette);
  const themedFallback =
    !hasCoverMedia && placeholderLabel === null ? (
      <View
        style={StyleSheet.absoluteFill}
        testID={testID !== undefined ? `${testID}-themed-cover` : "offering-themed-cover"}
      >
        <LinearGradient
          colors={
            accentStops !== null
              ? [accentStops[0], accentStops[1]]
              : [palette.accent, hexToRgba(palette.accent, 0.72)]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    ) : null;

  const coverMedia = themedFallback ?? (
    <EventCoverMedia
      accessibleLabel={activeAccessibleLabel}
      mediaUrl={coverMediaUrl}
      mediaType={coverMediaType}
      hue={coverHue ?? undefined}
      {...coverPlaceholderLabelProps}
      // ORCH-1167-R4 — a VIDEO cover AUTOPLAYS (muted, inline) and LOOPS
      // continuously on every surface that mounts this shell (buyer-web +
      // business iOS/Android, both standard-event + trip/experience). Passed
      // explicitly (not bare-boolean shorthand) so the R4 regression can pin
      // them; image/GIF covers are unaffected (EventCoverMedia ignores autoplay/
      // loop for non-video presentations). EventCoverMedia honors the existing
      // reduce-motion freeze (shouldFreezeCoverForReduceMotion): the default
      // muted-autoplay-loop cover is ambient motion and keeps playing, while a
      // sound-on / non-looping cover is still frozen to a still — that policy is
      // intact here, this only guarantees the autoplay+loop INTENT reaches it.
      autoplay={true}
      playbackActive={true}
      muted={muted}
      onMutedChange={() => onToggleMute()}
      loop={true}
      height="100%"
      width="100%"
    />
  );

  // issue #868 (Pass 4) — in gallery mode the pinned cover renders ONLY
  // sequence[activeIndex] (index 0 = the EXISTING coverMedia UNCHANGED — a video
  // cover autoplays/loops/mutes exactly as today; i = gallery[i-1]). A tap/chevron
  // changes activeIndex → the cover re-renders the new image, DETERMINISTICALLY
  // (no horizontal ScrollView pinned behind the body scroll, which could not
  // reliably scrollTo). When NOT in gallery mode, coverRender IS the single
  // coverMedia (byte-identical to today).
  const coverPager = (
    <View style={styles.coverPager}>
      {activeSequenceItem === undefined ? (
        coverMedia
      ) : (
        <EventCoverMedia
          mediaUrl={activeSequenceItem.url}
          accessibleLabel={activeAccessibleLabel}
          mediaType={activeSequenceItem.type ?? "image"}
          height="100%"
          width="100%"
        />
      )}
      <HeroMediaChangeAnnouncer
        activeIndex={activeIndex}
        accessibleLabel={activeAccessibleLabel}
        testID={testID !== undefined ? `${testID}-hero-announcement` : undefined}
      />
      {/* Pass 4 — NO on-cover chevrons: on the pinned-behind-scroll native cover
          they are unreachable (the body scroll swallows the tap, verified on the
          consumer). The beneath-cover CoverGalleryRow card-tap is the paging
          control on every surface (it lives in the scrolling body, on top). */}
    </View>
  );
  const coverRender = sequenceActive ? coverPager : coverMedia;
  const directionCOverlay = directionCIdentity ? (
    <DirectionCIdentityOverlay
      title={directionCIdentity.title}
      meta={directionCIdentity.meta}
    />
  ) : null;

  // The beneath-cover card row (card 0 = the cover). Rendered as the body's FIRST
  // row inside the scrolling body so it scrolls away over the pinned pager. Returns
  // null when there are no additional photos (single-cover behavior unchanged).
  const galleryRow = sequenceActive ? (
    <CoverGalleryRow
      cover={{ url: coverMediaUrl, type: coverMediaType }}
      gallery={gallery}
      activeIndex={activeIndex}
      onSelect={selectSequenceIndex}
      palette={palette}
      variant={isDesktop ? "desktop" : "phone"}
      testID={testID !== undefined ? `${testID}-gallery-row` : undefined}
    />
  ) : null;

  // issue #1023 — the theme motion is a FULL-SCREEN overlay (as in the
  // approved reference: pieces fall over the whole phone, not just the
  // cover). It is pinned to the viewport, ignores touches, is hidden from
  // screen readers, and sits ABOVE the cover and the details sheet but BELOW
  // the chrome (close / share / pause). Its text-safe zone is the details
  // sheet itself, followed live as the page scrolls: web measures the body
  // element's rect; native moves the bands with the sheet's top edge.
  const bodyRef = React.useRef<View>(null);
  const desktopTextRef = React.useRef<View>(null);
  const sheetTop = React.useRef(new Animated.Value(100000)).current;
  const spacerHeight = React.useRef(0);
  const scrollY = React.useRef(0);
  const syncSheetTop = React.useCallback((): void => {
    if (spacerHeight.current > 0) sheetTop.setValue(spacerHeight.current - SEAM - scrollY.current);
  }, [sheetTop]);
  const onSpacerLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      spacerHeight.current = event.nativeEvent.layout.height;
      syncSheetTop();
    },
    [syncSheetTop],
  );
  const handleScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      scrollY.current = event.nativeEvent.contentOffset.y;
      syncSheetTop();
      onScroll?.(event);
    },
    [onScroll, syncSheetTop],
  );
  // issue #4420 — premium frame: one scroll value drives the cover drift, the
  // identity fade, the header band and the desktop ambient drift. `solid`
  // flips once (state) when the cover has scrolled away, so the icons can
  // swap between frosted circles and plain ink.
  const premiumScrollY = React.useRef(new Animated.Value(0)).current;
  const [solidHeader, setSolidHeader] = React.useState(false);
  const solidRef = React.useRef(false);
  const [premiumCoverHeight, setPremiumCoverHeight] = React.useState(0);
  // #4490 N116 — the desktop flyer column sticks at 96 from the top of the
  // scroll area. The scroll area is already the window minus the Privacy & ad
  // choices strip (I-PRIVACY-BAR-NEVER-OCCLUDES: #root ends above it), so when
  // the column is taller than what is left, stick it higher so its foot (the
  // docked action bar) stays above the strip instead of being clipped by it.
  const [deskScrollHeight, setDeskScrollHeight] = React.useState(0);
  const [deskColHeight, setDeskColHeight] = React.useState(0);
  const [deskColWidth, setDeskColWidth] = React.useState(0);
  const [deskFlyerHeight, setDeskFlyerHeight] = React.useState(0);
  const flyerStickyTop = flyerColumnStickyTop(deskScrollHeight, deskColHeight);
  const flyerCap = flyerMaxHeight({
    scrollHeight: deskScrollHeight,
    columnHeight: deskColHeight,
    flyerWidth: deskColWidth,
    flyerHeight: deskFlyerHeight,
  });
  // #4490 N121 — a short window narrows the whole 4:5 flyer (same aspect, centred)
  // instead of cropping it, so whatever sits at its foot (the photo's own caption,
  // the event title block) keeps its full padding and is never cut at the edge.
  const flyerWidthCap = flyerCap !== null ? Math.round((flyerCap * 4) / 5) : null;
  const onDeskFlyerLayout = React.useCallback((event: LayoutChangeEvent): void => {
    setDeskFlyerHeight(event.nativeEvent.layout.height);
  }, []);
  const onDeskScrollLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      setDeskScrollHeight(event.nativeEvent.layout.height);
      onScrollViewLayout?.(event);
    },
    [onScrollViewLayout],
  );
  const onDeskColLayout = React.useCallback((event: LayoutChangeEvent): void => {
    setDeskColHeight(event.nativeEvent.layout.height);
    setDeskColWidth(event.nativeEvent.layout.width);
  }, []);
  const headerHeight = safeAreaTop + PREMIUM_HEADER_ROW;
  // #4490 W3 fix 4 (W3-N34a): how far the phone page can actually scroll. A
  // short page (Harbour Palms on Entry) ended BEFORE the band's fade point, so
  // the header stayed mid-fade at the bottom of the page and the cover's title
  // read through the compact title. The band now goes solid by the page's end.
  const [premiumViewportHeight, setPremiumViewportHeight] = React.useState(0);
  const [premiumContentHeight, setPremiumContentHeight] = React.useState(0);
  const onPremiumScrollLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      setPremiumViewportHeight(event.nativeEvent.layout.height);
      onScrollViewLayout?.(event);
    },
    [onScrollViewLayout],
  );
  const onPremiumContentSize = React.useCallback((_w: number, h: number): void => {
    setPremiumContentHeight(h);
  }, []);
  const solidThreshold = isDesktop
    ? PREMIUM_DESKTOP_SOLID_AT
    : premiumSolidThreshold({
        base:
          premiumCoverHeight > 0
            ? Math.max(120, premiumCoverHeight - SEAM - headerHeight)
            : 300,
        maxScroll:
          premiumViewportHeight > 0 && premiumContentHeight > 0
            ? premiumContentHeight - premiumViewportHeight
            : null,
      });
  const handlePremiumScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const y = event.nativeEvent.contentOffset.y;
      premiumScrollY.setValue(y);
      const nextSolid = y > solidThreshold;
      if (nextSolid !== solidRef.current) {
        solidRef.current = nextSolid;
        setSolidHeader(nextSolid);
      }
      handleScroll(event);
    },
    [handleScroll, premiumScrollY, solidThreshold],
  );
  const onPremiumSpacerLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      setPremiumCoverHeight(event.nativeEvent.layout.height);
      onSpacerLayout(event);
    },
    [onSpacerLayout],
  );
  const bandOpacity = premiumScrollY.interpolate({
    inputRange: [Math.max(0, solidThreshold - 60), solidThreshold],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const identityOpacity = premiumScrollY.interpolate({
    inputRange: [0, 240],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const coverDrift = premiumScrollY.interpolate({
    inputRange: [0, 1000],
    outputRange: [0, reduceMotion ? 0 : -450],
    extrapolateLeft: "clamp",
  });
  const ambientDrift = premiumScrollY.interpolate({
    inputRange: [0, 1000],
    outputRange: [0, reduceMotion ? 0 : -300],
    extrapolateLeft: "clamp",
  });
  const identityData: OfferingCoverIdentityData | null = coverIdentity;
  const premiumTitle = headerTitle ?? identityData?.title ?? null;
  const glassMaterial = useOfferingGlass();
  const headerBlurred = glassBlurActive(glassMaterial, palette.glassTint);

  const motionOverlay = (textZone: { ref?: React.RefObject<unknown>; top?: Animated.Value }) => (
    <View
      style={
        isWeb
          ? webStyle({ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: isDesktop ? DESKTOP_MOTION_Z : MOTION_Z })
          : styles.motionOverlay
      }
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID !== undefined ? `${testID}-motion-overlay` : "theme-motion-overlay"}
    >
      <ThemeEntranceAnimation
        theme={theme}
        sessionKey={entranceAnimationKey}
        pauseButton="none"
        textZoneRef={textZone.ref}
        textZoneTop={textZone.top}
      />
    </View>
  );
  // The pause control lives with the chrome (always on top, always tappable),
  // at the cover's top-right under the share button.
  const motionPause = (top: number) => (
    <View
      style={[
        styles.motionPause,
        isWeb ? webStyle({ position: isDesktop ? "absolute" : "fixed", zIndex: isDesktop ? 6 : CHROME_Z }) : null,
        { top },
      ]}
      pointerEvents="box-none"
    >
      <ThemeEntranceAnimation theme={theme} sessionKey={entranceAnimationKey} part="pauseButton" />
    </View>
  );

  // ===================== PREMIUM FRAME (issue #4420) =====================
  // The slim glass header: a frosted page-colour band that fades in once the
  // cover has scrolled away (it also stops section headings colliding with
  // the status bar), over the one chrome row. The pause control lives in the
  // row, so nothing floats over the tickets.
  const premiumHeader = (
    <View
      style={
        isWeb
          ? webStyle({ position: "fixed", top: 0, left: 0, right: 0, zIndex: CHROME_Z })
          : styles.premiumHeaderNative
      }
      pointerEvents="box-none"
      testID={testID !== undefined ? `${testID}-header` : "offering-glass-header"}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.premiumBand,
          {
            opacity: bandOpacity,
            borderBottomColor: palette.panelBorder,
            // No blur behind the band on native or mobile web, so it stays
            // near-opaque there; desktop web blurs what scrolls under it.
            // Phone web is fully opaque (issue #4420 audit): at 0.9 the
            // section heading and steppers scrolling under it ghosted through
            // beside the title (same rule as glassFillAlpha).
            // #4490 W3 fix 3 (W3-N26): native follows the one glass rule
            // (glassFillAlpha: Android always opaque, spec 06 §8; iOS opaque
            // unless a blur sits behind it). At 0.93 / 0.97 with no blur the
            // venue page's "Closed now / Opens 12:00" and price lines read
            // through the header beside the title at 375 pt.
            backgroundColor: palette.page.startsWith("#")
              ? hexToRgba(
                  palette.page,
                  // Phone web never blurs the band (desktopBlur(0) below), so it
                  // stays opaque whatever the material says; only desktop web
                  // lowers it, further when its blur is on (#4420 A-2).
                  Platform.OS === "web" ? (isDesktop ? (headerBlurred ? 0.72 : 0.78) : 1)
                    : glassFillAlpha({
                        platform: Platform.OS,
                        blurred: headerBlurred,
                        desktopWeb: false,
                      }),
                )
              : palette.page,
          },
          desktopBlur(isDesktop ? 1024 : 0),
        ]}
      >
        {/* The host app's injected blur (iOS), when it has one. */}
        <OfferingGlassBackdrop radius={0} tint={palette.glassTint} />
      </Animated.View>
      <View
        style={[
          styles.premiumHeaderRow,
          { paddingTop: (isDesktop ? 0 : safeAreaTop) + 8 },
          isDesktop ? styles.premiumHeaderRowDesktop : null,
        ]}
        pointerEvents="box-none"
      >
        <OfferingChrome
          palette={palette}
          showMute={showMute}
          muted={muted}
          onClose={onClose}
          onShare={onShare}
          onToggleMute={onToggleMute}
          closeAccessibilityLabel={closeAccessibilityLabel}
          hideCloseOnWeb={hideCloseOnWeb}
          solid={solidHeader}
          title={premiumTitle}
          titleOpacity={bandOpacity}
          titleFontFamily={boldFontFamily(theme)}
          pauseSlot={
            <ThemeEntranceAnimation
              theme={theme}
              sessionKey={entranceAnimationKey}
              part="pauseButton"
              pauseTone={solidHeader ? "plain" : "chrome"}
              pauseGlyphColor={solidHeader ? palette.primaryText : "#FFFFFF"}
            />
          }
          testID={testID !== undefined ? `${testID}-chrome` : undefined}
        />
      </View>
    </View>
  );

  // The cover's dark scrim: a little at the top (under the icons), clear
  // through the middle, deep at the bottom where the identity sits.
  const premiumScrim = (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(0,0,0,0.38)", "rgba(0,0,0,0)", "rgba(0,0,0,0)", "rgba(0,0,0,0.66)"]}
      locations={[0, 0.22, 0.45, 1]}
      style={StyleSheet.absoluteFill}
    />
  );

  const premiumIdentityOnCover =
    identityData !== null ? (
      <Animated.View
        pointerEvents="none"
        style={[styles.premiumIdentity, { opacity: identityOpacity }]}
      >
        <OfferingCoverIdentity
          {...identityData}
          palette={palette}
          theme={theme}
          variant="cover"
          testID={testID !== undefined ? `${testID}-identity` : undefined}
        />
      </Animated.View>
    ) : null;

  // issue #4420 audit — the phone cover clamps a long title to 3 lines, so
  // the sheet prints the whole title first (the header shows one line).
  const premiumFullTitle =
    identityData !== null && coverTitleMayClamp(identityData.title) ? (
      <Text
        accessibilityRole="header"
        style={[
          styles.premiumFullTitle,
          { color: palette.primaryText },
          themeFontFace(boldFontFamily(theme)),
        ]}
        testID={testID !== undefined ? `${testID}-full-title` : "offering-full-title"}
      >
        {identityData.title}
      </Text>
    ) : null;

  if (premium && isDesktop) {
    // issue #4420 audit — a flyer with no cover shows the host's gradient
    // with the identity on it (scrim, eyebrow, title, presenter), the same
    // as the phone cover, never a plain colour block.
    const flyerIdentity =
      themedFallback !== null && identityData !== null ? (
        <>
          {premiumScrim}
          <View
            pointerEvents="none"
            style={styles.premiumFlyerIdentity}
            testID={testID !== undefined ? `${testID}-flyer-identity` : "offering-flyer-identity"}
          >
            <OfferingCoverIdentity
              {...identityData}
              palette={palette}
              theme={theme}
              variant="cover"
              testID={testID !== undefined ? `${testID}-flyer-identity-block` : undefined}
            />
          </View>
        </>
      ) : null;
    const ambientUri =
      coverMediaType !== "video" && coverMediaUrl !== null && coverMediaUrl.length > 0
        ? coverMediaUrl
        : null;
    return (
      <View
        style={[styles.desktopStage, { backgroundColor: palette.page }]}
        testID={testID}
      >
        {/* the large blurred copy of the flyer, drifting slower than the page */}
        <Animated.View
          pointerEvents="none"
          style={[
            webStyle({ position: "fixed", top: 0, left: 0, right: 0, height: 1000, zIndex: 0 }),
            styles.premiumAmbient,
            { transform: [{ translateY: ambientDrift }] },
          ]}
          testID={testID !== undefined ? `${testID}-ambient` : "offering-ambient"}
        >
          {ambientUri !== null ? (
            <View
              style={webStyle({
                position: "absolute",
                top: "-10%",
                left: "-10%",
                right: "-10%",
                bottom: 0,
                backgroundImage: `url("${ambientUri.replace(/"/g, "%22")}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(80px) saturate(1.25)",
                opacity: 0.5,
                transform: [{ scale: 1.2 }],
              })}
            />
          ) : (
            <View
              style={webStyle({
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: `radial-gradient(60% 50% at 30% 20%, ${palette.accentWash}, transparent 70%)`,
              })}
            />
          )}
          <LinearGradient
            pointerEvents="none"
            colors={[
              palette.page.startsWith("#") ? hexToRgba(palette.page, 0.2) : "transparent",
              "rgba(0,0,0,0)",
              palette.page,
            ]}
            locations={[0, 0.35, 0.92]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Scroll
          style={webStyle({ position: "relative", zIndex: CONTENT_Z })}
          contentContainerStyle={styles.premiumDeskScroll}
          showsVerticalScrollIndicator={false}
          onScroll={handlePremiumScroll}
          scrollEventThrottle={16}
          onLayout={onDeskScrollLayout}
        >
          <View style={styles.premiumDeskPage}>
            <View style={styles.premiumDeskCols}>
              <View
                style={webStyle({
                  position: "sticky",
                  top: flyerStickyTop,
                  width: "40%",
                  maxWidth: PREMIUM_FLYER_MAX,
                  flexShrink: 0,
                  gap: 12,
                })}
                onLayout={onDeskColLayout}
                testID={testID !== undefined ? `${testID}-flyer-col` : undefined}
              >
                <View
                  onLayout={onDeskFlyerLayout}
                  style={[
                    styles.premiumFlyer,
                    { borderColor: palette.panelBorder },
                    flyerWidthCap !== null ? { width: flyerWidthCap, alignSelf: "center" } : null,
                    webStyle({ boxShadow: "0 34px 80px -28px rgba(0,0,0,0.85)" }),
                  ]}
                >
                  {coverRender}
                  {flyerIdentity}
                </View>
                {galleryRow}
                {desktopFlyerActions}
              </View>
              <View style={styles.premiumDeskMain} ref={desktopTextRef}>
                {identityData !== null ? (
                  <View style={styles.premiumDeskIdentity}>
                    <OfferingCoverIdentity
                      {...identityData}
                      palette={palette}
                      theme={theme}
                      variant="desktop"
                      testID={testID !== undefined ? `${testID}-identity` : undefined}
                    />
                  </View>
                ) : null}
                {stateBanner != null ? (
                  <View style={styles.phoneBannerWrap}>{stateBanner}</View>
                ) : null}
                {stickyPanel != null ? (
                  <View style={styles.phoneBannerWrap}>{stickyPanel}</View>
                ) : null}
                {children}
              </View>
            </View>
          </View>
        </Scroll>
        {motionOverlay({ ref: desktopTextRef })}
        {premiumHeader}
      </View>
    );
  }

  if (premium && isWeb) {
    const phoneChildren = React.Children.toArray(children);
    const isWebPhoneAction = (child: React.ReactNode): boolean =>
      React.isValidElement(child) &&
      String(child.key ?? "").endsWith("issue-2729-web-phone-action");
    const webPhoneActions = phoneChildren.filter(isWebPhoneAction);
    const webPhoneBody = phoneChildren.filter(
      (child: React.ReactNode) => !isWebPhoneAction(child),
    );
    return (
      <View style={[styles.webPhoneHost, { backgroundColor: palette.page }]} testID={testID}>
        <Animated.View
          style={[
            webStyle({
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              aspectRatio: coverAspectRatio,
              zIndex: COVER_Z,
              overflow: "hidden",
              backgroundColor: "#000",
            }),
            { transform: [{ translateY: coverDrift }] },
          ]}
          pointerEvents={sequenceActive ? "auto" : "none"}
        >
          {coverRender}
          {premiumScrim}
        </Animated.View>
        <Scroll
          style={webStyle({ position: "relative", zIndex: CONTENT_Z })}
          contentContainerStyle={[
            styles.webPhoneScrollContent,
            { paddingBottom: contentBottomInset },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={handlePremiumScroll}
          scrollEventThrottle={16}
          onLayout={onPremiumScrollLayout}
          onContentSizeChange={onPremiumContentSize}
          {...(scrollRef !== undefined ? { ref: scrollRef } : {})}
        >
          <View
            style={[styles.webPhoneSpacer, { aspectRatio: coverAspectRatio }]}
            pointerEvents={sequenceActive ? "none" : "box-none"}
            onLayout={onPremiumSpacerLayout}
          >
            {premiumIdentityOnCover}
          </View>
          <View
            ref={bodyRef}
            style={webStyle({
              position: "relative",
              zIndex: CONTENT_Z,
              marginTop: -SEAM,
              borderTopLeftRadius: SEAM,
              borderTopRightRadius: SEAM,
              backgroundColor: palette.page,
              paddingTop: 30,
              paddingHorizontal: PREMIUM_GUTTER,
            })}
          >
            <View style={[styles.premiumGrabber, { backgroundColor: palette.panelBorder }]} />
            {premiumFullTitle}
            {stateBanner != null ? (
              <View style={styles.phoneBannerWrap}>{stateBanner}</View>
            ) : null}
            {galleryRow}
            {webPhoneBody}
          </View>
          {webPhoneActions}
        </Scroll>
        {motionOverlay({ ref: bodyRef })}
        {premiumHeader}
      </View>
    );
  }

  if (premium) {
    return (
      <View style={[styles.nativeHost, { backgroundColor: palette.page }]} testID={testID}>
        <Animated.View
          style={[
            styles.nativeCover,
            { aspectRatio: coverAspectRatio, transform: [{ translateY: coverDrift }] },
          ]}
          pointerEvents={sequenceActive ? "auto" : "none"}
        >
          {coverRender}
          {premiumScrim}
        </Animated.View>
        <Scroll
          style={styles.nativeScroll}
          contentContainerStyle={[
            styles.nativeScrollContent,
            { paddingBottom: contentBottomInset },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={handlePremiumScroll}
          scrollEventThrottle={16}
          onLayout={onPremiumScrollLayout}
          onContentSizeChange={onPremiumContentSize}
          {...(scrollRef !== undefined ? { ref: scrollRef } : {})}
        >
          <View
            style={[styles.nativeSpacer, { aspectRatio: coverAspectRatio }]}
            pointerEvents={sequenceActive ? "none" : "box-none"}
            onLayout={onPremiumSpacerLayout}
          >
            {premiumIdentityOnCover}
          </View>
          <View
            style={[
              styles.nativeBody,
              styles.premiumNativeBody,
              { backgroundColor: palette.page },
            ]}
          >
            <View style={[styles.premiumGrabber, { backgroundColor: palette.panelBorder }]} />
            {premiumFullTitle}
            {stateBanner != null ? (
              <View style={styles.phoneBannerWrap}>{stateBanner}</View>
            ) : null}
            {galleryRow}
            {children}
          </View>
        </Scroll>
        {motionOverlay({ top: sheetTop })}
        {premiumHeader}
      </View>
    );
  }

  // ===================== DESKTOP (web ≥1024px) =====================
  if (isDesktop) {
    return (
      <View
        style={[styles.desktopStage, { backgroundColor: palette.page }]}
        testID={testID}
      >
        <Scroll
          contentContainerStyle={styles.desktopScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.desktopShell}>
            {/* contained cover (pager in gallery mode) */}
            <View style={styles.desktopHero}>
              {coverRender}
              <View style={styles.desktopHeroOverlay} pointerEvents="none" />
              {directionCOverlay}
              {motionPause(70)}
              <View
                style={webStyle({
                  position: "absolute",
                  top: 18,
                  left: 16,
                  right: 16,
                  zIndex: 5,
                })}
                pointerEvents="box-none"
              >
                {chrome}
              </View>
            </View>

            {stateBanner != null ? (
              <View style={styles.desktopBannerWrap}>{stateBanner}</View>
            ) : null}

            {/* two-column grid */}
            <View style={styles.desktopGrid} ref={desktopTextRef}>
              <View style={styles.desktopLeft}>
                {galleryRow}
                {children}
              </View>
              {stickyPanel != null ? (
                <View
                  style={webStyle({
                    width: STICKY_PANEL_WIDTH,
                    position: "sticky",
                    top: 24,
                  })}
                >
                  {stickyPanel}
                </View>
              ) : null}
            </View>
          </View>
        </Scroll>
        {motionOverlay({ ref: desktopTextRef })}
      </View>
    );
  }

  // ===================== WEB PHONE (<1024px) — parallax =====================
  if (isWeb) {
    // issue #2729 — a keyed child remains ordinary `children` to shell mocks
    // and the native/desktop branches, while the real phone-web shell lifts it
    // out of the padded content column but leaves it inside the sole Scroll.
    const phoneChildren = React.Children.toArray(children);
    const isWebPhoneAction = (child: React.ReactNode): boolean =>
      React.isValidElement(child) &&
      String(child.key ?? "").endsWith("issue-2729-web-phone-action");
    const webPhoneActions = phoneChildren.filter(isWebPhoneAction);
    const webPhoneBody = phoneChildren.filter(
      (child: React.ReactNode) => !isWebPhoneAction(child),
    );

    return (
      <View style={[styles.webPhoneHost, { backgroundColor: palette.page }]} testID={testID}>
        {/* pinned cover (lowest layer). issue #868 — pointerEvents becomes "auto"
            in gallery mode so the horizontal scroll-snap pager receives swipes
            (independent of the body's vertical scroll axis); "none" otherwise
            (byte-identical to today). */}
        <View
          style={webStyle({
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            aspectRatio: coverAspectRatio,
            zIndex: COVER_Z,
            overflow: "hidden",
            backgroundColor: "#000",
          })}
          pointerEvents={sequenceActive ? "auto" : "none"}
        >
          {coverRender}
          <View style={styles.coverScrim} pointerEvents="none" />
          {directionCOverlay}
        </View>

        {/* body-level fixed chrome (highest layer) */}
        <View
          style={webStyle({
            position: "fixed",
            top: safeAreaTop + 12,
            left: 16,
            right: 16,
            zIndex: CHROME_Z,
          })}
          pointerEvents="box-none"
        >
          {chrome}
        </View>

        <Scroll
          // WEB-PHONE STACKING FIX (ORCH-1150-R2 D-7c): the Scroll element MUST
          // carry an explicit position+zIndex so the scrolling body paints OVER
          // the `position:fixed` cover (COVER_Z) instead of behind it. Without a
          // `style` the Scroll was statically positioned + auto-z, so it sat in
          // the flow layer BENEATH every positioned child (the fixed cover at
          // COVER_Z). Mirrors how the native branch z-indexes `styles.nativeScroll`
          // to CONTENT_Z. The host (`webPhoneHost`) establishes the shared stacking
          // context (position:relative + zIndex:0) so cover(1) < Scroll(2) <
          // chrome(70) resolves deterministically. Contract: COVER_Z < CONTENT_Z
          // < CHROME_Z (shell header §Z-INDEX CONTRACT).
          style={webStyle({ position: "relative", zIndex: CONTENT_Z })}
          contentContainerStyle={[
            styles.webPhoneScrollContent,
            { paddingBottom: contentBottomInset },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onLayout={onScrollViewLayout}
          {...(scrollRef !== undefined ? { ref: scrollRef } : {})}
        >
          {/* flow spacer holding the pinned cover height (matches the cover
              aspect ratio so the body seam sits at the cover's bottom edge).
              issue #868 — pointerEvents "none" in gallery mode so horizontal
              swipes over the cover region reach the pinned pager behind the body;
              default (undefined) otherwise (byte-identical to today). */}
          <View
            style={[styles.webPhoneSpacer, { aspectRatio: coverAspectRatio }]}
            pointerEvents={sequenceActive ? "none" : undefined}
          />
          {/* body slides up over the cover (middle layer) */}
          <View
            ref={bodyRef}
            style={webStyle({
              position: "relative",
              zIndex: CONTENT_Z,
              marginTop: -SEAM,
              borderTopLeftRadius: SEAM,
              borderTopRightRadius: SEAM,
              backgroundColor: palette.page,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: palette.panelBorder,
              paddingTop: 24,
              paddingHorizontal: 20,
            })}
          >
            {stateBanner != null ? (
              <View style={styles.phoneBannerWrap}>{stateBanner}</View>
            ) : null}
            {/* issue #868 — the beneath-cover card row is the body's FIRST row. */}
            {galleryRow}
            {webPhoneBody}
          </View>
          {webPhoneActions}
        </Scroll>
        {motionOverlay({ ref: bodyRef })}
        {motionPause(safeAreaTop + 64)}
      </View>
    );
  }

  // ===================== NATIVE (single-column immersive) =====================
  return (
    <View style={[styles.nativeHost, { backgroundColor: palette.page }]} testID={testID}>
      {/* pinned cover behind the scroll. issue #868 — pointerEvents "auto" in
          gallery mode so the horizontal pager can receive swipes; "none"
          otherwise (byte-identical to today). Row-tap → scrollTo is the
          guaranteed control regardless of native gesture routing. */}
      <View
        style={[styles.nativeCover, { aspectRatio: coverAspectRatio }]}
        pointerEvents={sequenceActive ? "auto" : "none"}
      >
        {coverRender}
        <View style={styles.coverScrim} pointerEvents="none" />
        {directionCOverlay}
      </View>

      <Scroll
        style={styles.nativeScroll}
        contentContainerStyle={[
          styles.nativeScrollContent,
          { paddingBottom: contentBottomInset },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={onScrollViewLayout}
        {...(scrollRef !== undefined ? { ref: scrollRef } : {})}
      >
        {/* issue #868 — spacer is pointerEvents "none" in gallery mode so the
            pinned pager behind the body receives horizontal swipes; default
            otherwise (byte-identical to today). */}
        <View
          style={[styles.nativeSpacer, { aspectRatio: coverAspectRatio }]}
          pointerEvents={sequenceActive ? "none" : undefined}
          onLayout={onSpacerLayout}
        />
        <View
          style={[
            styles.nativeBody,
            {
              backgroundColor: palette.page,
              borderColor: palette.panelBorder,
            },
          ]}
        >
          {stateBanner != null ? (
            <View style={styles.phoneBannerWrap}>{stateBanner}</View>
          ) : null}
          {/* issue #868 — the beneath-cover card row is the body's FIRST row. */}
          {galleryRow}
          {children}
        </View>
      </Scroll>

      {motionOverlay({ top: sheetTop })}

      {/* chrome — absolute box-none sibling padded by the safe-area top */}
      <View
        style={[styles.nativeChrome, { top: safeAreaTop + 12 }]}
        pointerEvents="box-none"
      >
        {chrome}
      </View>
      {motionPause(safeAreaTop + 64)}
    </View>
  );
};

const S6 = S6_PHONE;
const S6_BOUNDARY = S6_PLATE_BOUNDARY;

export interface DirectionCIdentityOverlayProps {
  title: string;
  meta?: string | null;
  /**
   * issue #1023 — the rect covering the title and the meta plate, relative
   * to the cover (the overlay fills it), measured from the real text. The
   * entrance motion uses it as its text-safe zone.
   */
  onTextRect?: (rect: TextSafeZone) => void;
}

type Box = { x: number; y: number; width: number; height: number };

export const DirectionCIdentityOverlay = ({
  title,
  meta = null,
  onTextRect,
}: DirectionCIdentityOverlayProps): React.ReactElement => {
  const boxes = React.useRef<{ title: Box | null; plate: Box | null }>({ title: null, plate: null });
  const report = (which: "title" | "plate", box: Box): void => {
    boxes.current[which] = box;
    const t = boxes.current.title;
    const p = boxes.current.plate;
    if (onTextRect === undefined || t === null || p === null) return;
    const x = Math.min(t.x, p.x);
    const y = Math.min(t.y, p.y);
    const right = Math.max(t.x + t.width, p.x + p.width);
    const bottom = Math.max(t.y + t.height, p.y + p.height);
    onTextRect({ x, y, width: right - x, height: bottom - y });
  };
  return (
    <View pointerEvents="none" style={styles.directionCOverlay}>
      <Text
        numberOfLines={2}
        style={styles.directionCTitle}
        onLayout={onTextRect ? (e) => report("title", e.nativeEvent.layout) : undefined}
      >
        {title}
      </Text>
      <View
        style={styles.directionCPlate}
        onLayout={onTextRect ? (e) => report("plate", e.nativeEvent.layout) : undefined}
      >
        {meta ? <Text numberOfLines={2} style={styles.directionCMeta}>{meta}</Text> : <View />}
        <Text style={styles.directionCBrand}>mingla</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // ---- desktop ----
  desktopStage: {
    flex: 1,
  },
  desktopScrollContent: {
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 72,
  },
  desktopShell: {
    width: "100%",
    maxWidth: SHELL_MAX_WIDTH,
    alignSelf: "center",
  },
  desktopHero: {
    width: "100%",
    aspectRatio: 21 / 9,
    maxHeight: 520,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  desktopHeroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.20)",
  },
  desktopBannerWrap: {
    marginTop: 16,
    alignSelf: "center",
    maxWidth: 520,
    width: "100%",
  },
  desktopGrid: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 40,
    marginTop: 26,
  },
  desktopLeft: {
    flex: 1,
    minWidth: 0,
  },
  // ---- web phone ----
  webPhoneHost: {
    flex: 1,
    // WEB-PHONE STACKING FIX (ORCH-1150-R2 D-7c): establish a local stacking
    // context so the host's three children — the `position:fixed` cover
    // (COVER_Z), the `position:relative` Scroll (CONTENT_Z), and the
    // `position:fixed` chrome (CHROME_Z) — resolve their z-order against EACH
    // OTHER (cover < content < chrome) rather than independently at the root.
    // `position:relative` + an explicit `zIndex` is the minimal trigger; without
    // it the body could not reliably paint over the fixed cover.
    position: "relative",
    zIndex: 0,
  },
  webPhoneScrollContent: {
    flexGrow: 1,
  },
  webPhoneSpacer: {
    width: "100%",
    aspectRatio: 4 / 5,
  },
  // ---- native ----
  nativeHost: {
    flex: 1,
    position: "relative",
  },
  nativeCover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    aspectRatio: 4 / 5,
    // LOWEST layer — the cover is pinned behind the scrolling content.
    zIndex: COVER_Z,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  // MIDDLE layer — the ScrollView (content host) MUST z-index above the cover so
  // its body slides OVER the pinned cover. Without this, RN native paints the
  // absolute cover (zIndex 1) over an auto-z (0) ScrollView and the body
  // disappears behind the cover. This is the native fix for the parallax stack.
  nativeScroll: {
    zIndex: CONTENT_Z,
  },
  nativeScrollContent: {
    flexGrow: 1,
  },
  nativeSpacer: {
    width: "100%",
    aspectRatio: 4 / 5,
  },
  nativeBody: {
    // Belt-and-suspenders within the ScrollView; the load-bearing ordering is
    // `nativeScroll`'s zIndex (above) which orders content vs. cover/chrome.
    zIndex: CONTENT_Z,
    marginTop: -SEAM,
    borderTopLeftRadius: SEAM,
    borderTopRightRadius: SEAM,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  nativeChrome: {
    position: "absolute",
    left: 16,
    right: 16,
    // HIGHEST layer — chrome floats above both cover and content.
    zIndex: CHROME_Z,
  },
  // ---- shared ----
  // issue #868 — the cover box fills its parent (deterministic single-item render).
  coverPager: {
    width: "100%",
    height: "100%",
  },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  directionCOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
  directionCTitle: {
    position: "absolute",
    left: S6.sideInset + S6.titleInset,
    right: S6.sideInset + S6.titleInset,
    bottom: S6.bottomInset + S6.plateH + S6.gap,
    color: "#fff",
    fontSize: S6.titleSize,
    lineHeight: S6.titleLH,
    fontWeight: S6.titleWeight as any,
  },
  directionCPlate: {
    position: "absolute",
    left: S6.sideInset,
    right: S6.sideInset,
    bottom: S6.bottomInset,
    minHeight: S6.plateH,
    borderRadius: S6.plateR,
    borderWidth: S6_BOUNDARY.width,
    borderColor: S6_BOUNDARY.color,
    backgroundColor: S6_PLATE.fallbackSolid,
    paddingHorizontal: S6.titleInset,
    flexDirection: "row",
    alignItems: "center",
  },
  directionCMeta: {
    color: "#fff",
    fontSize: S6.metaSize,
    flex: 1,
    marginRight: 12,
  },
  directionCBrand: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800",
  },
  phoneBannerWrap: {
    marginBottom: 12,
  },
  // ---- issue #4420 premium frame ----
  premiumHeaderNative: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: CHROME_Z,
  },
  premiumBand: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  premiumHeaderRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: PREMIUM_HEADER_ROW,
  },
  premiumHeaderRowDesktop: {
    paddingTop: 12,
    paddingHorizontal: 24,
    width: "100%",
    maxWidth: 1240,
    alignSelf: "center",
  },
  premiumIdentity: {
    position: "absolute",
    left: PREMIUM_GUTTER,
    right: PREMIUM_GUTTER,
    bottom: SEAM + 26,
  },
  premiumNativeBody: {
    borderWidth: 0,
    paddingTop: 30,
    paddingHorizontal: PREMIUM_GUTTER,
  },
  premiumGrabber: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  premiumAmbient: {
    overflow: "hidden",
  },
  premiumDeskScroll: {
    flexGrow: 1,
  },
  premiumDeskPage: {
    width: "100%",
    maxWidth: 1160,
    alignSelf: "center",
    paddingTop: PREMIUM_DESK_PAGE_TOP,
    paddingHorizontal: 40,
    paddingBottom: 140,
  },
  premiumDeskCols: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 56,
  },
  premiumFlyer: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  premiumDeskMain: {
    flex: 1,
    minWidth: 0,
    gap: 0,
  },
  // issue #4420 audit — identity on a no-cover desktop flyer.
  premiumFlyerIdentity: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 28,
  },
  // issue #4420 audit — the whole title, when the cover clamps it.
  premiumFullTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.2,
    marginBottom: 20,
  },
  premiumDeskIdentity: {
    paddingTop: 8,
    marginBottom: 20,
  },
  // issue #1023 — the full-screen motion overlay (native): above the cover and
  // the scrolling sheet (CONTENT_Z), below the chrome (CHROME_Z).
  motionOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: MOTION_Z,
    elevation: 0,
  },
  // the motion pause control, with the chrome: on top and tappable
  motionPause: {
    position: "absolute",
    right: 12,
    zIndex: CHROME_Z,
  },
});

export default ParallaxCoverShell;
