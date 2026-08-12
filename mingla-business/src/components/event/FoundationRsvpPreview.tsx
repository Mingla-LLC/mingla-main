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

import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  ParallaxCoverShell,
  RsvpOfferingBody,
  RsvpDecisionBox,
  RsvpOfferingFloatingBar,
  useResponsiveLayout,
  useRsvpOfferingState,
  type PublicBrandProps,
  type PublicEventProps,
  type ResolvedTheme,
  type RsvpOfferingConfig,
  type RsvpGuestContact,
  type RsvpSubmitResult,
  type ChipInResult,
  type RsvpPhoneFieldRenderer,
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
    guestPhoneCountryIso?: string | null;
    plusCount: number;
    guests: RsvpGuestContact[];
  }) => Promise<RsvpSubmitResult>;
  // ORCH-1291 [rsvp-chip-in] — voluntary-gift hand-off passthrough. The buyer-web
  // caller wires submitRsvpContribution (surface 'web'/'mobile-web' → hosted
  // Checkout / Paystack redirect); the business in-app preview may pass a
  // preview/no-op. Absent → the chip-in panel never renders.
  onChipIn?: (input: { amountCents: number }) => Promise<ChipInResult>;
  contributionState?: "idle" | "paid";
  // ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the buyer-web surface injects
  // a country-code-aware phone field (@mingla/phone-input). Absent → plain field.
  renderPhoneField?: RsvpPhoneFieldRenderer;
  defaultPhoneCountry?: string;
  onDownloadPass?: import("@mingla/offering-rendering").RsvpOfferingBodyProps["onDownloadPass"];
  contentBottomInset?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  safeAreaBottom?: number;
  testID?: string;
  stateBanner?: React.ReactNode;
  onAcquisitionClosed?: (kind: "ended" | "unavailable") => void;
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
    onChipIn,
    contributionState,
    renderPhoneField,
    defaultPhoneCountry,
    onDownloadPass,
    contentBottomInset = 96,
    onScroll,
    onScrollViewLayout,
    safeAreaTop = 0,
    safeAreaBottom = 0,
    testID,
    stateBanner,
    onAcquisitionClosed,
  } = props;
  const { isDesktop } = useResponsiveLayout();
  const acquisitionClosed =
    event.acquisitionState?.kind !== undefined &&
    event.acquisitionState.kind !== "current";
  const shellTheme = acquisitionClosed
    ? { ...theme, animation: "none" as const }
    : theme;

  // ORCH-1163-R3 — the RSVP floating bar is TALLER + variable (3 glyph+label
  // buttons + a wrapping micro subcopy) vs the event page's ~56px single button, so
  // a fixed clearance under-reserves and the last section scrolls UNDER the bar.
  // MEASURE the floatWrap height and make the shell's bottom inset the MAX of the
  // adapter's value (a floor) and `measured + floatWrap-bottom(24) + gap(16) +
  // safeAreaBottom`. The adapter value remains a floor for the first paint (before
  // onLayout fires) and for desktop (0).
  const [floatBarHeight, setFloatBarHeight] = useState(0);
  const onFloatWrapLayout = useCallback((e: LayoutChangeEvent): void => {
    const h = e.nativeEvent.layout.height;
    setFloatBarHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  const measuredBottomInset =
    floatBarHeight > 0 ? floatBarHeight + 24 + 16 + safeAreaBottom : 0;
  const resolvedBottomInset = isDesktop
    ? contentBottomInset
    : Math.max(contentBottomInset, measuredBottomInset);

  // Lift the ONE decision/submit/dialog state machine; share it with body + dock.
  const state = useRsvpOfferingState({
    event,
    brand,
    palette,
    theme,
    config,
    isLoggedIn,
    onSubmit,
    onChipIn,
    contributionState,
    renderPhoneField,
    defaultPhoneCountry,
    onDownloadPass,
    onOpenBrand,
    onOpenMaps,
    staticMapUrl,
    onAcquisitionClosed,
  });

  const coverType: "image" | "video" | "gif" | null =
    event.coverMediaType === "video"
      ? "video"
      : event.coverMediaType === "gif"
        ? "gif"
        : event.coverMediaUrl !== null
          ? "image"
          : null;

  // ORCH-1163-R2 [floating-parity] — desktop hosts the SINGLE-OWNER inline decision
  // box (RsvpDecisionBox) in the STICKY right panel (PARITY with the event page's
  // EventTicketBox in deskPanel). The phone keeps the inline box in the body and
  // pins the separate floating bar below.
  const stickyPanel = isDesktop && !acquisitionClosed ? (
    <View
      style={[styles.deskPanel, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
    >
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        <RsvpDecisionBox
          palette={palette}
          theme={theme}
          config={config}
          state={state}
        />
      </View>
    </View>
  ) : undefined;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ParallaxCoverShell
        palette={palette}
        theme={shellTheme}
        coverMediaUrl={event.coverMediaUrl}
        coverMediaType={coverType}
        coverHue={event.coverHue}
        // issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items.
        galleryImages={event.coverGallery}
        entranceAnimationKey={`rsvp:${event.id}`}
        muted={muted}
        onToggleMute={onToggleMute}
        showMute={coverType === "video"}
        onClose={onClose}
        onShare={onShare}
        hideCloseOnWeb
        stateBanner={stateBanner}
        stickyPanel={stickyPanel}
        contentBottomInset={resolvedBottomInset}
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
          renderPhoneField={renderPhoneField}
          defaultPhoneCountry={defaultPhoneCountry}
          // ORCH-1163-R2 — desktop relocates the inline box to the sticky panel
          // (PARITY with FoundationEventPreview's hideTicketBox).
          hideDecisionBox={isDesktop || acquisitionClosed}
          testID="orch-1163-rsvp-body"
        />
      </ParallaxCoverShell>

      {/* (9) Phone FLOATING decision bar — the shared RsvpOfferingFloatingBar pinned
          as an absolute-bottom SIBLING of ParallaxCoverShell with zIndex:6, EXACTLY
          like the event page's floatWrap (PublicEventPage). This fixes the
          business-on-top / web-under layering: a positioned overlay below the chrome
          but ABOVE the scrolling body's content stacking context on BOTH surfaces.
          Hidden on desktop (the sticky panel carries the decision). */}
      {!isDesktop && !acquisitionClosed ? (
        <View
          style={styles.floatWrap}
          pointerEvents="box-none"
          onLayout={onFloatWrapLayout}
        >
          <RsvpOfferingFloatingBar
            palette={palette}
            theme={theme}
            config={config}
            state={state}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
  // ORCH-1163-R2 [floating-parity] — the floating decision-bar wrapper, BYTE-
  // IDENTICAL to the event page's floatWrap (PublicEventPage.styles.floatWrap):
  // absolute, left/right:16, bottom:24, zIndex:6. The zIndex:6 is the load-bearing
  // fix — it pins the bar ABOVE the scrolling body's content stacking context
  // (CONTENT_Z=2) on web (where the body was painting over the old un-z-indexed
  // dock) and stays consistent on business-native, so the layering matches the
  // event page on BOTH surfaces.
  floatWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    zIndex: 6,
  },
  // ORCH-1163-R2 — the DESKTOP sticky right-panel frame hosting the single-owner
  // RsvpDecisionBox (mirrors the event page's deskPanel hosting EventTicketBox).
  deskPanel: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  deskAccent: {
    height: 4,
  },
  deskInner: {
    padding: 20,
  },
});

export default FoundationRsvpPreview;
