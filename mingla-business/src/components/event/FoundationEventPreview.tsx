/**
 * FoundationEventPreview — ORCH-1167 [event-page-canonical] thin wrapper.
 *
 * Was (ORCH-1138 Leg 2): the buyer-web + business in-app FOUNDATION render that
 * forked the event-page body in mingla-business/src (a SELECTABLE tier radiogroup
 * + route-out CTA), NOT shared with the consumer fork.
 *
 * Now (ORCH-1167): a THIN WRAPPER around the ONE shared, shell-agnostic
 * `EventOfferingBody` (@mingla/offering-rendering). This wrapper owns ONLY the
 * surface scaffold: it composes the shared `ParallaxCoverShell` (pinned parallax
 * cover + body-level fixed X·Share·Mute chrome + responsive desktop sticky shell,
 * with a raw RN ScrollView as the scroll host) AROUND the shared body, which now
 * carries the canonical 9-section structure incl. the INLINE on-page ticket box
 * (per-tier steppers + live Σ-all-in running total + in-box Proceed). The cover is
 * section 1 (the shell's pinned sibling); the inline box is section 5 (inside the
 * body); the floating Get-tickets bar (section 9) is rendered by the adapter
 * (PublicEventPage) as a pinned overlay.
 *
 * WHY this still lives in the APP layer (not the package): the shared event body is
 * a DEPENDENCY of @mingla/offering-rendering (offering-rendering imports
 * offeringSurfaceStyles/types FROM event-rendering). Composing ParallaxCoverShell
 * (offering-rendering) + the body (offering-rendering) + the brand-app Icon belongs
 * in the app layer, which imports both packages freely. The shared body itself is
 * pure (I-MOR-0827); this wrapper is the surface seam.
 *
 * Anon-tolerant: no useAuth, no fetch. The adapter (PublicEventPage) owns state +
 * cart navigation. Android: opaque glass via the foundation primitives.
 */

import React from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  type OfferingVariant,
  type PublicBrandProps,
  type PublicEventProps,
  type ResolvedTheme,
  type ThemePalette,
  boldFontFamily,
} from "@mingla/event-rendering";
import {
  EventOfferingBody,
  ParallaxCoverShell,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
import { Text, StyleSheet, View } from "react-native";

export interface FoundationEventPreviewProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  variant: OfferingVariant;
  /** I-PAID-SUPPLY gate (ORCH-1076) — false → inline box + CTA disabled. */
  bookable: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  /** Server-proxied static map URL (privacy-gated upstream). null → text card. */
  staticMapUrl?: string | null;
  stateBanner?: React.ReactNode | null;
  stickyPanel?: React.ReactNode | null;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  /** ORCH-1167 — the inline box bottom y, so the floating bar can hide on-screen. */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  contentBottomInset?: number;
  // ORCH-1167 — the inline ticket box state (LIFTED to the adapter for the cart).
  ticketQuantities: Record<string, number>;
  onChangeTicketQuantity: (ticketTypeId: string, qty: number) => void;
  onProceedToCart: () => void;
  submitting?: boolean;
  testID?: string;
}

export const FoundationEventPreview: React.FC<FoundationEventPreviewProps> = ({
  event,
  brand,
  variant,
  bookable,
  palette,
  theme,
  muted,
  onToggleMute,
  onClose,
  onShare,
  onOpenBrand,
  onOpenMaps,
  staticMapUrl = null,
  stateBanner = null,
  stickyPanel = null,
  onScroll,
  onScrollViewLayout,
  onDockLayout,
  safeAreaTop = 0,
  contentBottomInset = 0,
  ticketQuantities,
  onChangeTicketQuantity,
  onProceedToCart,
  submitting = false,
  testID,
}) => {
  const { isDesktop } = useResponsiveLayout();
  void isDesktop; // ParallaxCoverShell owns the responsive two-column shell.
  const boldFamily = boldFontFamily(theme);

  const coverType: "image" | "video" | "gif" | null =
    event.coverMediaType === "video"
      ? "video"
      : event.coverMediaType === "gif"
        ? "gif"
        : event.coverMediaUrl !== null
          ? "image"
          : null;

  // The shared body's content, wrapped so the adapter can measure its bottom y
  // (float→dock: hide the floating bar once the in-page box scrolls into view).
  const body = (
    <View onLayout={onDockLayout}>
      <EventOfferingBody
        event={event}
        brand={brand}
        variant={variant}
        bookable={bookable}
        palette={palette}
        theme={theme}
        ticketQuantities={ticketQuantities}
        onChangeTicketQuantity={onChangeTicketQuantity}
        onProceedToCart={onProceedToCart}
        onOpenBrand={onOpenBrand}
        onOpenMaps={onOpenMaps}
        staticMapUrl={staticMapUrl}
        submitting={submitting}
        testID="orch-1167-event-body"
      />
    </View>
  );

  return (
    <ParallaxCoverShell
      palette={palette}
      theme={theme}
      coverMediaUrl={event.coverMediaUrl}
      coverMediaType={coverType}
      coverHue={event.coverHue}
      entranceAnimationKey={`event:${event.id}`}
      muted={muted}
      onToggleMute={onToggleMute}
      showMute={coverType === "video"}
      onClose={onClose}
      onShare={onShare}
      // ORCH-1159 — hide the floating X on web (preserved). Native keeps it.
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
      stateBanner={stateBanner}
      stickyPanel={stickyPanel}
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      onScroll={onScroll}
      onScrollViewLayout={onScrollViewLayout}
      testID={testID}
    >
      {body}
    </ParallaxCoverShell>
  );
};

const styles = StyleSheet.create({
  heroEyebrow: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#ffffff",
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: 44,
    lineHeight: 47,
    fontWeight: "900",
    letterSpacing: -1,
    color: "#ffffff",
  },
});

export default FoundationEventPreview;
