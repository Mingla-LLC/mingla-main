/**
 * FoundationRsvpPreview — ORCH-1163 [rsvp-shared-body] thin surface wrapper.
 *
 * Mirrors FoundationEventPreview (ORCH-1167) but for the public RSVP page. A THIN
 * WRAPPER around the ONE shared, shell-agnostic `RsvpOfferingBody`
 * (@mingla/offering-rendering). It owns ONLY the surface scaffold: it composes the
 * shared `ParallaxCoverShell` (pinned parallax cover + X·Share·Mute chrome + RN
 * ScrollView host) AROUND the shared body, and pins the `RsvpOfferingDecisionDock`
 * at the bottom on phone (the sticky-panel slot carries the decision on desktop).
 *
 * The decision STATE is lifted ONCE here via `useRsvpOfferingState` and passed to
 * BOTH the body (inline box §0-5) and the floating dock (§0-9) so they share one
 * state machine (no duplicate writes). Replaces the old RsvpPublicBody (which wrapped
 * ParallaxCoverShell internally — the non-shell-agnostic part dissolved by ORCH-1163).
 *
 * Anon-tolerant: no useAuth, no fetch. The adapter (PublicEventPage) owns submit +
 * doors + SEO. Android: opaque glass via the shared primitives.
 */

import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  ParallaxCoverShell,
  RsvpOfferingBody,
  RsvpOfferingDecisionDock,
  useResponsiveLayout,
  useRsvpOfferingState,
  boldFontFamily,
  type PublicBrandProps,
  type PublicEventProps,
  type ResolvedTheme,
  type RsvpOfferingConfig,
  type RsvpGuestContact,
  type RsvpSubmitResult,
  type ThemePalette,
} from "@mingla/offering-rendering";

export interface FoundationRsvpPreviewProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  staticMapUrl?: string | null;
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    plusCount: number;
    guests: RsvpGuestContact[];
  }) => Promise<RsvpSubmitResult>;
  contentBottomInset?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  safeAreaBottom?: number;
  testID?: string;
}

export const FoundationRsvpPreview: React.FC<FoundationRsvpPreviewProps> = (props) => {
  const {
    event,
    brand,
    palette,
    theme,
    config,
    isLoggedIn,
    muted,
    onToggleMute,
    onClose,
    onShare,
    onOpenBrand,
    onOpenMaps,
    staticMapUrl = null,
    onSubmit,
    contentBottomInset = 96,
    onScroll,
    onScrollViewLayout,
    safeAreaTop = 0,
    safeAreaBottom = 0,
    testID,
  } = props;

  const { isDesktop } = useResponsiveLayout();
  const boldFamily = boldFontFamily(theme);

  // Lift the ONE decision/submit/dialog state machine; share it with body + dock.
  const state = useRsvpOfferingState({
    event,
    brand,
    palette,
    theme,
    config,
    isLoggedIn,
    onSubmit,
    onOpenBrand,
    onOpenMaps,
    staticMapUrl,
  });

  const coverType: "image" | "video" | "gif" | null =
    event.coverMediaType === "video"
      ? "video"
      : event.coverMediaType === "gif"
        ? "gif"
        : event.coverMediaUrl !== null
          ? "image"
          : null;

  const dock = (
    <RsvpOfferingDecisionDock
      palette={palette}
      theme={theme}
      config={config}
      state={state}
    />
  );

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ParallaxCoverShell
        palette={palette}
        theme={theme}
        coverMediaUrl={event.coverMediaUrl}
        coverMediaType={coverType}
        coverHue={event.coverHue}
        entranceAnimationKey={`rsvp:${event.id}`}
        muted={muted}
        onToggleMute={onToggleMute}
        showMute={coverType === "video"}
        onClose={onClose}
        onShare={onShare}
        hideCloseOnWeb
        heroEyebrow={
          event.dateLine.length > 0 ? (
            <Text style={styles.heroEyebrow}>{event.dateLine}</Text>
          ) : undefined
        }
        heroTitle={
          <Text style={[styles.heroTitle, { fontFamily: boldFamily }]}>
            {event.name.length > 0 ? event.name : "Untitled event"}
          </Text>
        }
        // Desktop hosts the decision in the sticky right panel; phone uses the
        // pinned floating dock below.
        stickyPanel={isDesktop ? dock : undefined}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        onScroll={onScroll}
        onScrollViewLayout={onScrollViewLayout}
        testID={testID}
      >
        <RsvpOfferingBody
          event={event}
          brand={brand}
          palette={palette}
          theme={theme}
          config={config}
          isLoggedIn={isLoggedIn}
          onSubmit={onSubmit}
          onOpenBrand={onOpenBrand}
          onOpenMaps={onOpenMaps}
          staticMapUrl={staticMapUrl}
          state={state}
          testID="orch-1163-rsvp-body"
        />
      </ParallaxCoverShell>

      {/* (9) Phone floating decision dock — surface-pinned overlay above the safe
          area. Hidden on desktop (the sticky panel carries the decision). */}
      {!isDesktop ? (
        <View
          style={[
            styles.floatingDock,
            {
              backgroundColor: palette.page,
              borderTopColor: palette.panelBorder,
              paddingBottom: 12 + safeAreaBottom,
            },
          ]}
        >
          {dock}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
  heroEyebrow: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 8,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 34,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 10,
  },
  floatingDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export default FoundationRsvpPreview;
