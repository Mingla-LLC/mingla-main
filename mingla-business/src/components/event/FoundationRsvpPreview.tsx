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
 *
 * The phone floating bar is a SHORTCUT, not a second copy of the decision: it
 * shows only while the inline Going / Maybe / Can't go row is off screen. Before
 * this, both rendered at once and the floating copy sat over the inline row, the
 * About text and the date card. This wrapper owns the scroll view, so it also
 * owns scrolling a blocked tap's first unfinished contact field into view.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
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
// Deep imports: pure modules, reachable without the mocked barrel in jest.
import {
  rsvpInlineDecisionPosition,
  rsvpRevealScrollOffset,
  shouldShowRsvpFloatingBar,
  type RsvpInlineDecisionPosition,
} from "@mingla/offering-rendering/rsvpFloatingDecision";
import type { RsvpGuestSnapshot } from "@mingla/offering-rendering/rsvpGuestSnapshot";

/** How often the inline-decision visibility is re-measured between scroll events. */
const VISIBILITY_POLL_MS = 400;
/** The floating card's padding (10 × 2) + border (1 × 2) around the decision block. */
const FLOATING_CARD_CHROME = 22;

type WindowMeasurable = {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
  scrollIntoView?: (options?: { block?: string; behavior?: string }) => void;
};

export interface FoundationRsvpPreviewProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;
  replyIdentity?: string | null;
  recoveryNotice?: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  onOpenBrand?: (brandSlug: string) => void;
  /** issue #2468 — carries the stored coordinate, not just the text label.
   *  issue #2508 — plus the map app the guest picked in the shared chooser. */
  onOpenMaps?: (
    target: import("@mingla/offering-rendering").MapsOpenTarget,
    app?: import("@mingla/offering-rendering").MapsAppId,
  ) => void;
  /** issue #2508 — copies the gated address text. Absent ⇒ no copy button. */
  onCopyAddress?: (text: string) => void | Promise<void>;
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
  /** An anonymous guest's own reply restored after the chip-in redirect. */
  restoredRsvp?: RsvpGuestSnapshot | null;
  /** Called with each reply the server accepts (the adapter keeps it for the tab). */
  onRsvpResolved?: (snapshot: RsvpGuestSnapshot) => void;
}

export const FoundationRsvpPreview: React.FC<FoundationRsvpPreviewProps> = (props) => {
  const {
    event,
    brand,
    palette,
    theme,
    config,
    isLoggedIn,
    replyIdentity,
    recoveryNotice,
    muted,
    onToggleMute,
    onClose,
    onShare,
    onOpenBrand,
    onOpenMaps,
    onCopyAddress,
    staticMapUrl = null,
    onSubmit,
    onChipIn,
    contributionState,
    renderPhoneField,
    defaultPhoneCountry,
    onDownloadPass,
    contentBottomInset = 96,
    onScroll: onScrollProp,
    onScrollViewLayout,
    safeAreaTop = 0,
    safeAreaBottom = 0,
    testID,
    stateBanner,
    onAcquisitionClosed,
    restoredRsvp = null,
    onRsvpResolved,
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
  // The runway stays reserved while the bar is hidden (its last measured height),
  // so content never jumps when the bar appears at the end of the page.
  const resolvedBottomInset = isDesktop
    ? contentBottomInset
    : Math.max(contentBottomInset, measuredBottomInset);

  // ── scroll + viewport handles (visibility gate + blocked-tap reveal) ──
  const hostRef = useRef<View | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollYRef = useRef(0);

  // Scroll a blocked tap's first unfinished contact field about a quarter of the
  // way down the screen (clear of the chrome and the software keyboard).
  const revealField = useCallback((node: unknown): void => {
    const field = node as WindowMeasurable | null;
    const host = hostRef.current as unknown as WindowMeasurable | null;
    const scroll = scrollRef.current;
    if (field === null) return;
    if (
      scroll === null ||
      typeof field.measureInWindow !== "function" ||
      host === null ||
      typeof host.measureInWindow !== "function"
    ) {
      // Desktop web has no body scroll ref: let the browser bring it into view.
      if (Platform.OS === "web" && typeof field.scrollIntoView === "function") {
        field.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }
    field.measureInWindow((_fx, fy, _fw, fh) => {
      host.measureInWindow?.((_hx, hy, _hw, hh) => {
        scroll.scrollTo({
          y: rsvpRevealScrollOffset(
            { y: fy, height: fh },
            { y: hy, height: hh },
            scrollYRef.current,
          ),
          animated: true,
        });
      });
    });
  }, []);

  // Lift the ONE decision/submit/dialog state machine; share it with body + dock.
  const state = useRsvpOfferingState({
    event,
    brand,
    palette,
    theme,
    config,
    isLoggedIn,
    replyIdentity,
    recoveryNotice,
    onSubmit,
    onChipIn,
    contributionState,
    renderPhoneField,
    defaultPhoneCountry,
    onDownloadPass,
    onOpenBrand,
    onOpenMaps,
    onCopyAddress,
    staticMapUrl,
    onAcquisitionClosed,
    onRevealField: revealField,
    restoredRsvp,
    onRsvpResolved,
  });

  // ── floating bar only once the inline decision has been scrolled past ──
  const [inlineDecisionPosition, setInlineDecisionPosition] =
    useState<RsvpInlineDecisionPosition>("unmeasured");
  // When the in-flight measurement started (0 ⇒ none). A measurement whose
  // callback never fires (node unmounted mid-flight) stops blocking after 1s.
  const measurePendingRef = useRef(0);
  const inlineDecisionRef = state.inlineDecisionRef;
  const measureInlineDecision = useCallback((): void => {
    if (measurePendingRef.current !== 0 && Date.now() - measurePendingRef.current < 1000) {
      return;
    }
    const row = inlineDecisionRef.current as unknown as WindowMeasurable | null;
    const host = hostRef.current as unknown as WindowMeasurable | null;
    if (
      row === null ||
      host === null ||
      typeof row.measureInWindow !== "function" ||
      typeof host.measureInWindow !== "function"
    ) {
      setInlineDecisionPosition("unmeasured");
      return;
    }
    measurePendingRef.current = Date.now();
    row.measureInWindow((_rx, ry, _rw, rh) => {
      host.measureInWindow?.((_hx, hy, _hw, hh) => {
        measurePendingRef.current = 0;
        // Reserve the bar's runway before it first appears: the floating card
        // is the same decision block plus its 10px padding and 1px border, so
        // the page's last section is never under the bar on its first showing.
        if (rh > 0) setFloatBarHeight((prev) => (prev > 0 ? prev : rh + FLOATING_CARD_CHROME));
        const position = rsvpInlineDecisionPosition(
          { y: ry, height: rh },
          { y: hy, height: hh },
        );
        setInlineDecisionPosition((prev) => (prev === position ? prev : position));
      });
    });
  }, [inlineDecisionRef]);
  const phoneBarEligible = !isDesktop && !acquisitionClosed;
  useEffect(() => {
    if (!phoneBarEligible) return undefined;
    measureInlineDecision();
    // Layout can move the row without a scroll (forms growing, fonts loading).
    const timer = setInterval(measureInlineDecision, VISIBILITY_POLL_MS);
    return () => clearInterval(timer);
  }, [phoneBarEligible, measureInlineDecision]);
  // Tracks the offset for field reveal + re-checks the bar, then forwards.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      scrollYRef.current = e.nativeEvent.contentOffset.y;
      measureInlineDecision();
      onScrollProp?.(e);
    },
    [measureInlineDecision, onScrollProp],
  );
  const showFloatingBar = shouldShowRsvpFloatingBar({
    isPhoneLayout: !isDesktop,
    acquisitionOpen: !acquisitionClosed,
    inlineDecisionPosition,
    decisionAttempted: state.decisionAttempted,
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
    <View style={[styles.host, { backgroundColor: palette.page }]} ref={hostRef}>
      <ParallaxCoverShell
        palette={palette}
        theme={shellTheme}
        coverMediaUrl={event.coverMediaUrl}
        coverMediaType={coverType}
        coverHue={event.coverHue}
        // issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items.
      galleryImages={event.coverGallery}
      heroAccessibilitySubject={event.name}
      coverMediaAlt={event.coverMediaAlt}
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
        scrollRef={scrollRef}
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
          onCopyAddress={onCopyAddress}
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
          Hidden on desktop (the sticky panel carries the decision), while the
          inline decision row is on screen (never two copies at once) and before
          the guest has reached it (nothing covers the date card on first load).
          Lifted by the device safe area so it clears the home indicator. */}
      {showFloatingBar ? (
        <View
          style={[styles.floatWrap, { bottom: 24 + safeAreaBottom }]}
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
