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

import { EventCoverMedia } from "./EventCoverMedia";
import { ThemeEntranceAnimation } from "./ThemeEntranceAnimation";
import { CoverGalleryRow } from "./CoverGalleryRow";
import { type ResolvedTheme } from "./designTokens";
import { type ThemePalette } from "./themePalette";
import { type OfferingGalleryImage } from "./types";

import { OfferingChrome } from "./OfferingChrome";
import { useResponsiveLayout } from "./useResponsiveLayout";

// react-native-web honors CSS position values RN's types omit. This cast is the
// single sanctioned escape hatch for the parallax pin + the sticky panel.
// issue #868 — extended with the horizontal scroll-snap CSS props RN's ViewStyle
// omits but react-native-web honors, for the web cover pager (independent axes).
type WebViewStyle = ViewStyle & {
  position?: ViewStyle["position"] | "fixed" | "sticky";
  overflowX?: "auto" | "hidden" | "scroll" | "visible";
  scrollSnapType?: string;
  scrollSnapAlign?: string;
};
const webStyle = (style: WebViewStyle): StyleProp<ViewStyle> =>
  style as StyleProp<ViewStyle>;

const SHELL_MAX_WIDTH = 1200;
const STICKY_PANEL_WIDTH = 360;
const SEAM = 28;

// Z-INDEX CONTRACT (the mockup's proven stacking, shared by web + native):
//   cover/hero (lowest) < content (middle, opaque, slides over) < chrome (highest).
// Exported so the regression test can assert the ordering without magic numbers.
export const COVER_Z = 1;
export const CONTENT_Z = 2;
export const CHROME_Z = 70;

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
  closeAccessibilityLabel,
  hideCloseOnWeb = false,
  coverAspectRatio = 4 / 5,
  galleryImages,
  coverPlaceholderLabel = null,
  testID,
}: ParallaxCoverShellProps) => {
  const { isDesktop, isWeb } = useResponsiveLayout();
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

  const coverMedia = (
    <EventCoverMedia
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
          mediaType={activeSequenceItem.type ?? "image"}
          height="100%"
          width="100%"
        />
      )}
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

  const entrance = (
    <ThemeEntranceAnimation theme={theme} sessionKey={entranceAnimationKey} />
  );

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
              {entrance}
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
            <View style={styles.desktopGrid}>
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
      </View>
    );
  }

  // ===================== WEB PHONE (<1024px) — parallax =====================
  if (isWeb) {
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
          {entrance}
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
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={onScrollViewLayout}
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
            {children}
          </View>
        </Scroll>
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
        {entrance}
      </View>

      <Scroll
        style={styles.nativeScroll}
        contentContainerStyle={[
          styles.nativeScrollContent,
          { paddingBottom: contentBottomInset },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onScrollViewLayout}
      >
        {/* issue #868 — spacer is pointerEvents "none" in gallery mode so the
            pinned pager behind the body receives horizontal swipes; default
            otherwise (byte-identical to today). */}
        <View
          style={[styles.nativeSpacer, { aspectRatio: coverAspectRatio }]}
          pointerEvents={sequenceActive ? "none" : undefined}
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

      {/* chrome — absolute box-none sibling padded by the safe-area top */}
      <View
        style={[styles.nativeChrome, { top: safeAreaTop + 12 }]}
        pointerEvents="box-none"
      >
        {chrome}
      </View>
    </View>
  );
};

const S6 = S6_PHONE;
const S6_BOUNDARY = S6_PLATE_BOUNDARY;

export interface DirectionCIdentityOverlayProps {
  title: string;
  meta?: string | null;
}

export const DirectionCIdentityOverlay = ({
  title,
  meta = null,
}: DirectionCIdentityOverlayProps): React.ReactElement => (
  <View pointerEvents="none" style={styles.directionCOverlay}>
    <Text numberOfLines={2} style={styles.directionCTitle}>{title}</Text>
    <View style={styles.directionCPlate}>
      {meta ? <Text numberOfLines={2} style={styles.directionCMeta}>{meta}</Text> : <View />}
      <Text style={styles.directionCBrand}>mingla</Text>
    </View>
  </View>
);

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
});

export default ParallaxCoverShell;
