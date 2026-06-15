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
// Pure: react-native + @mingla/event-rendering only. Web-only `position` values
// (fixed/sticky) are applied via a typed web-style escape hatch (RN's ViewStyle
// type omits them but react-native-web honors them at runtime).

import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  EventCoverMedia,
  ThemeEntranceAnimation,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/event-rendering";

import { OfferingChrome } from "./OfferingChrome";
import { useResponsiveLayout } from "./useResponsiveLayout";

// react-native-web honors CSS position values RN's types omit. This cast is the
// single sanctioned escape hatch for the parallax pin + the sticky panel.
type WebViewStyle = ViewStyle & {
  position?: ViewStyle["position"] | "fixed" | "sticky";
};
const webStyle = (style: WebViewStyle): StyleProp<ViewStyle> =>
  style as StyleProp<ViewStyle>;

const SHELL_MAX_WIDTH = 1200;
const STICKY_PANEL_WIDTH = 360;
const SEAM = 28;

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
  heroEyebrow?: React.ReactNode;
  heroTitle?: React.ReactNode;
  stateBanner?: React.ReactNode | null;
  children: React.ReactNode;
  stickyPanel?: React.ReactNode | null;
  ScrollComponent?: React.ComponentType<{
    contentContainerStyle?: StyleProp<ViewStyle>;
    showsVerticalScrollIndicator?: boolean;
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }>;
  contentBottomInset?: number;
  safeAreaTop?: number;
  closeAccessibilityLabel?: string;
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
  heroEyebrow,
  heroTitle,
  stateBanner,
  children,
  stickyPanel,
  ScrollComponent,
  contentBottomInset = 0,
  safeAreaTop = 0,
  closeAccessibilityLabel,
  testID,
}) => {
  const { isDesktop, isWeb } = useResponsiveLayout();
  const Scroll = ScrollComponent ?? ScrollView;

  const chrome = (
    <OfferingChrome
      palette={palette}
      showMute={showMute}
      muted={muted}
      onClose={onClose}
      onShare={onShare}
      onToggleMute={onToggleMute}
      closeAccessibilityLabel={closeAccessibilityLabel}
      testID={testID !== undefined ? `${testID}-chrome` : undefined}
    />
  );

  const coverMedia = (
    <EventCoverMedia
      mediaUrl={coverMediaUrl}
      mediaType={coverMediaType}
      hue={coverHue ?? undefined}
      autoplay
      playbackActive
      muted={muted}
      onMutedChange={() => onToggleMute()}
      loop
      height="100%"
      width="100%"
    />
  );

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
            {/* contained cover */}
            <View style={styles.desktopHero}>
              {coverMedia}
              <View style={styles.desktopHeroOverlay} pointerEvents="none" />
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
              {heroEyebrow !== undefined || heroTitle !== undefined ? (
                <View style={styles.desktopHeroCaption} pointerEvents="none">
                  {heroEyebrow}
                  {heroTitle}
                </View>
              ) : null}
            </View>

            {stateBanner != null ? (
              <View style={styles.desktopBannerWrap}>{stateBanner}</View>
            ) : null}

            {/* two-column grid */}
            <View style={styles.desktopGrid}>
              <View style={styles.desktopLeft}>{children}</View>
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
        {/* pinned cover (z1) */}
        <View
          style={webStyle({
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            aspectRatio: 4 / 5,
            zIndex: 1,
            overflow: "hidden",
            backgroundColor: "#000",
          })}
          pointerEvents="none"
        >
          {coverMedia}
          <View style={styles.coverScrim} pointerEvents="none" />
          {entrance}
        </View>

        {/* body-level fixed chrome (z70) */}
        <View
          style={webStyle({
            position: "fixed",
            top: safeAreaTop + 12,
            left: 16,
            right: 16,
            zIndex: 70,
          })}
          pointerEvents="box-none"
        >
          {chrome}
        </View>

        <Scroll
          contentContainerStyle={[
            styles.webPhoneScrollContent,
            { paddingBottom: contentBottomInset },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* flow spacer holding the pinned cover height */}
          <View style={styles.webPhoneSpacer} />
          {/* body slides up over the cover (z2) */}
          <View
            style={webStyle({
              position: "relative",
              zIndex: 2,
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
            {children}
          </View>
        </Scroll>
      </View>
    );
  }

  // ===================== NATIVE (single-column immersive) =====================
  return (
    <View style={[styles.nativeHost, { backgroundColor: palette.page }]} testID={testID}>
      {/* pinned cover behind the scroll */}
      <View style={styles.nativeCover} pointerEvents="none">
        {coverMedia}
        <View style={styles.coverScrim} pointerEvents="none" />
        {entrance}
      </View>

      <Scroll
        contentContainerStyle={[
          styles.nativeScrollContent,
          { paddingBottom: contentBottomInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nativeSpacer} />
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
  desktopHeroCaption: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 30,
    zIndex: 5,
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
    zIndex: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  nativeScrollContent: {
    flexGrow: 1,
  },
  nativeSpacer: {
    width: "100%",
    aspectRatio: 4 / 5,
  },
  nativeBody: {
    zIndex: 2,
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
    zIndex: 70,
  },
  // ---- shared ----
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  phoneBannerWrap: {
    marginBottom: 12,
  },
});

export default ParallaxCoverShell;
