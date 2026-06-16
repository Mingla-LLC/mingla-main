/**
 * PublicEventPage — adapter for the shared @mingla/event-rendering package.
 *
 * ORCH-1138 Leg 2 [public event page redesign] — re-architected onto the shared
 * Direction-A foundation (@mingla/offering-rendering via the shared
 * PublicEventPage's FOUNDATION mode): immersive parallax cover, body-level fixed
 * chrome (X · Share · Mute), brand-themed palette + bold fonts, City,Country
 * venue + "Where you'll be" block, date/time facts, a SELECTABLE ticket-TIER
 * radiogroup, a desktop sticky ticket panel, and the float→dock single CTA — all
 * built around the SAME resolveOfferingCta state. Mirrors the SHIPPED trip route
 * (app/t/[brandSlug]/[tripSlug].tsx) 1:1.
 *
 * This adapter:
 *   - Fetches auth + brand list via existing mingla-business hooks
 *   - Computes viewerRole (organizer/anonymous)
 *   - Maps LiveEvent + Brand types to the package's prop contract
 *   - Resolves the brand theme → palette → bold fonts (useThemeFont pair)
 *   - Builds the desktop sticky panel + the float/dock EventReserveBar from the
 *     SAME resolveOfferingCta the page computes (one owner)
 *   - Owns share/mute/checkout navigation (checkout target UNCHANGED — N7)
 *   - Mounts ShareModal + Toast + JoinWaitlistSheet + web SEO <Head>
 *
 * Checkout is byte-identical (N7): tapping Get-tickets routes to the existing
 * checkoutPublicPath(event.id) — no address, no taxCalculationId, no change.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  PublicEventPage as SharedPublicEventPage,
  type PublicBrandProps,
  type PublicEventCallbacks,
  type PublicEventProps,
  type PublicTicketProps,
  type ViewerRole,
  type CtaState,
  type OfferingVariant,
  resolveTheme,
  resolveOfferingCta,
  computeOfferingVariant,
  createThemePalette,
  boldFontFamily,
} from "@mingla/event-rendering";
import { useResponsiveLayout } from "@mingla/offering-rendering";

import { EventReserveBar } from "./EventReserveBar";
import { FoundationEventPreview } from "./FoundationEventPreview";

import {
  checkoutPublicPath,
  eventOgImageUrl,
  eventPublicUrl,
} from "../../constants/publicUrls";
import { useAuth } from "../../context/AuthContext";
import { useBrandList, type Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
} from "../../utils/eventDateDisplay";
import { isLegacyUnsafeEventCoverVideoUrl } from "../../utils/eventCoverMediaRules";
import { eventCoverProviderCreditLabel } from "../../types/eventCoverProvider";
import { useThemeFont } from "../../theme/useThemeFont";

import { ShareModal } from "../ui/ShareModal";
import { Toast } from "../ui/Toast";
import { JoinWaitlistSheet } from "../waitlist/JoinWaitlistSheet";

interface PublicEventPageAdapterProps {
  event: LiveEvent;
  brand: Brand | null;
  /**
   * ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — when false, this is a
   * PAID event whose brand cannot charge yet; the CTA is the non-tappable
   * "Booking unavailable" strip (no dead-end checkout 409). Defaults to true.
   */
  bookable?: boolean;
}

const mapTicket = (t: TicketStub): PublicTicketProps => ({
  id: t.id,
  name: t.name,
  description: t.description ?? null,
  priceGbp: t.priceGbp ?? null,
  priceAllInGbp: t.priceAllInGbp ?? null,
  currency: t.currency ?? null,
  isFree: t.isFree,
  isUnlimited: t.isUnlimited,
  capacity: t.capacity ?? null,
  visibility:
    t.visibility === "hidden"
      ? "hidden"
      : t.visibility === "disabled"
        ? "disabled"
        : "visible",
  passwordProtected: t.passwordProtected,
  password: t.password ?? null,
  saleStartAt: t.saleStartAt ?? null,
  saleEndAt: t.saleEndAt ?? null,
  approvalRequired: t.approvalRequired,
  waitlistEnabled: t.waitlistEnabled,
  availableAt:
    t.availableAt === "door"
      ? "door"
      : t.availableAt === "both"
        ? "both"
        : "online",
  displayOrder: typeof t.displayOrder === "number" ? t.displayOrder : 0,
});

const mapLiveEventToPublicEvent = (event: LiveEvent): PublicEventProps => {
  const coverVideoUnsafe = isLegacyUnsafeEventCoverVideoUrl(
    event.coverMediaUrl,
    event.coverMediaType,
  );
  const safeCoverMediaUrl = coverVideoUnsafe ? null : event.coverMediaUrl;
  const safeCoverMediaType = coverVideoUnsafe ? null : event.coverMediaType;
  const coverCredit = eventCoverProviderCreditLabel({
    provider: coverVideoUnsafe ? null : event.coverMediaProvider,
    credit: coverVideoUnsafe ? null : event.coverMediaCredit,
  });
  return {
    id: event.id,
    name: event.name,
    brandId: event.brandId,
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
    description: event.description,
    dateLine: formatDraftDateLine(event),
    dateSubline: formatDraftDateSubline(event),
    datesList: formatDraftDatesList(event),
    status:
      event.status === "cancelled"
        ? "cancelled"
        : event.status === "ended"
          ? "ended"
          : event.status === "scheduled" || event.status === "live"
            ? "published"
            : "published",
    endedAt: event.endedAt ?? null,
    format:
      event.format === "online"
        ? "online"
        : event.format === "hybrid"
          ? "hybrid"
          : "in-person",
    venueName: event.venueName ?? null,
    address: event.address ?? null,
    hideAddressUntilTicket: Boolean(event.hideAddressUntilTicket),
    coverHue: event.coverHue,
    coverMediaUrl: safeCoverMediaUrl,
    coverMediaType:
      safeCoverMediaType === "image" ||
      safeCoverMediaType === "video" ||
      safeCoverMediaType === "gif"
        ? safeCoverMediaType
        : null,
    coverCredit,
    tickets: event.tickets.map(mapTicket),
    currency: event.currency ?? "GBP",
    themeOverrides: event.themeOverrides ?? null,
  };
};

const mapBrandToPublicBrand = (
  brand: Brand | null,
): PublicBrandProps | null => {
  if (brand === null) return null;
  return {
    id: brand.id,
    slug: brand.slug,
    displayName: brand.displayName ?? "Brand",
    photo: brand.photo,
    theme: brand.theme ?? null,
  };
};

const openMapsForQuery = (query: string): void => {
  const encoded = encodeURIComponent(query);
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const platformUrl =
    Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${encoded}`
        : googleUrl;

  void Linking.openURL(platformUrl).catch(() => {
    void Linking.openURL(googleUrl).catch(() => undefined);
  });
};

const canonicalUrl = (event: LiveEvent): string =>
  eventPublicUrl({
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
  });

function ctaUnavailableLabel(cta: CtaState): string {
  return cta.kind === "unavailable" ? cta.title : "Booking unavailable";
}

export const PublicEventPage: React.FC<PublicEventPageAdapterProps> = ({
  event,
  brand,
  bookable = true,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userBrands = useBrandList();
  const { isDesktop } = useResponsiveLayout();

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);
  // ORCH-1138 — cover-video sound state (default muted). The chrome Mute button
  // toggles EventCoverMedia's muted state via this.
  const [muted, setMuted] = useState<boolean>(true);
  // ORCH-1138 — the selected ticket-tier id (FOUNDATION radiogroup). null → none
  // chosen yet; the bar/sticky panel use the page-level resolveOfferingCta until
  // the buyer picks a tier (which then narrows the considered set).
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const viewerRole: ViewerRole = useMemo(() => {
    if (user === null) return "anonymous";
    const owns = userBrands.some((b) => b.id === event.brandId);
    return owns ? "organizer" : "anonymous";
  }, [user, userBrands, event.brandId]);

  const publicEvent = useMemo(() => mapLiveEventToPublicEvent(event), [event]);
  const publicBrand = useMemo(() => mapBrandToPublicBrand(brand), [brand]);
  const resolvedTheme = useMemo(
    () =>
      resolveTheme(
        publicBrand?.theme ?? null,
        publicEvent.themeOverrides ?? null,
      ),
    [publicBrand?.theme, publicEvent.themeOverrides],
  );
  // ORCH-1138 — palette + surface + bold fonts (mirror the trip route). The bold
  // family is required or native bold no-ops (a loaded custom font ignores
  // fontWeight); load BOTH the base + bold families on demand.
  const palette = useMemo(() => createThemePalette(resolvedTheme), [resolvedTheme]);
  const boldFamily = boldFontFamily(resolvedTheme);
  useThemeFont(resolvedTheme.fontFamilyValue);
  useThemeFont(boldFamily);

  // ORCH-1138 — float→dock CTA visibility tracking (mirror the trip route 1:1).
  const [dockTopY, setDockTopY] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState<number>(0);
  const [viewportH, setViewportH] = useState<number>(0);
  const handleDockLayout = useCallback((e: LayoutChangeEvent): void => {
    setDockTopY(e.nativeEvent.layout.y);
  }, []);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      setScrollY(e.nativeEvent.contentOffset.y);
    },
    [],
  );
  const handleScrollLayout = useCallback((e: LayoutChangeEvent): void => {
    setViewportH(e.nativeEvent.layout.height);
  }, []);
  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;

  const waitlistTicket = useMemo(
    () =>
      publicEvent.tickets.find((ticket) => ticket.id === waitlistTicketId) ??
      null,
    [publicEvent.tickets, waitlistTicketId],
  );

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // ORCH-1138 — the page-level variant (cancelled / password-gate keep the shared
  // renderer's dedicated LEGACY render; everything else gets the FOUNDATION page).
  const pageVariant: OfferingVariant = useMemo(
    () => computeOfferingVariant(publicEvent, false),
    [publicEvent],
  );

  // ORCH-1138 — the SINGLE buy-state, the page CTA owner (resolveOfferingCta). The
  // selected tier (when any) narrows the considered set; the page-level state
  // drives the bar + sticky panel + tier-row labels identically.
  const offeringCta = useMemo(() => {
    const selected = publicEvent.tickets.find(
      (t) => t.id === selectedTicketId && t.visibility !== "hidden",
    );
    const considered =
      selected !== undefined ? [selected] : publicEvent.tickets;
    return resolveOfferingCta({
      variant: computeOfferingVariant(publicEvent, false),
      bookable,
      tickets: considered,
      currency: publicEvent.currency,
    });
  }, [publicEvent, bookable, selectedTicketId]);

  const handleSelectTicket = useCallback((ticketId: string): void => {
    setSelectedTicketId((prev) => (prev === ticketId ? null : ticketId));
  }, []);

  const handleReserve = useCallback((): void => {
    if (offeringCta.kind === "waitlist") {
      const wlTicket = publicEvent.tickets.find(
        (t) => t.visibility !== "hidden" && t.waitlistEnabled,
      );
      if (wlTicket !== undefined) setWaitlistTicketId(wlTicket.id);
      return;
    }
    if (!bookable) {
      showToast(
        "Booking unavailable right now — the organizer is finishing payment setup.",
      );
      return;
    }
    // N7 — checkout target UNCHANGED (the existing /checkout/{eventId} cart page).
    router.push(checkoutPublicPath(event.id) as never);
  }, [offeringCta.kind, publicEvent.tickets, bookable, router, event.id, showToast]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brand?.slug === "string" && brand.slug.length > 0) {
      router.replace(`/b/${brand.slug}` as never);
    } else if (event.brandSlug.length > 0) {
      router.replace(`/b/${event.brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brand?.slug, event.brandSlug]);

  const handleShare = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  const handleToggleMute = useCallback((): void => {
    setMuted((m) => !m);
  }, []);

  const callbacks: PublicEventCallbacks = useMemo(
    () => ({
      onClose: handleClose,
      onShare: handleShare,
      onBuyTicket: (_ticketId: string) => {
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        router.push(checkoutPublicPath(event.id) as never);
      },
      onClaimFreeTicket: (_ticketId: string) => {
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        router.push(checkoutPublicPath(event.id) as never);
      },
      onJoinWaitlist: (ticketId: string) => {
        setWaitlistTicketId(ticketId);
      },
      onRequestApproval: (_ticketId: string) => {
        showToast("Approval flow lands Cycle 10 + B4.");
      },
      onOpenBrand: (brandSlug: string) => {
        router.push(`/b/${brandSlug}` as never);
      },
      onOpenMaps: openMapsForQuery,
      onUnlockPassword: (password: string): boolean => {
        // [TRANSITIONAL] Frontend stub validation against ticket.password —
        // B4 wires real backend verification (hashed comparison).
        const validPasswords = event.tickets
          .filter((t) => t.passwordProtected && t.password !== null)
          .map((t) => t.password as string);
        return validPasswords.includes(password);
      },
    }),
    [
      router,
      event.id,
      event.tickets,
      showToast,
      handleClose,
      handleShare,
      bookable,
    ],
  );

  // ORCH-1138 — state banner (sold-out / sales-ended / pre-sale / not-bookable),
  // rendered above the body by the shared FOUNDATION body. Driven by the same
  // offeringCta state (one owner) so the banner never disagrees with the CTA.
  const stateBanner =
    offeringCta.kind === "unavailable" ? (
      <View style={[styles.banner, { backgroundColor: palette.card }]}>
        <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
          {offeringCta.title}
        </Text>
      </View>
    ) : null;

  // ORCH-1138 — reserve kicker ("All-in, taxes included" when there's a price).
  const barKicker = offeringCta.kind === "buy" ? "All-in, taxes included" : null;

  // ORCH-1138 — DOCKED ticket CTA (phone): the LAST body child, flush. Built from
  // the SAME offeringCta the float pill + sticky panel read.
  const dockedReserve = !isDesktop ? (
    <EventReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={handleReserve}
      variant="docked"
      onDockLayout={handleDockLayout}
      testID="orch-1138-event-reserve"
    />
  ) : undefined;

  // ORCH-1138 — desktop sticky ticket panel: brand chip → "Choose your ticket"
  // tier list (rendered in the FOUNDATION body) → price block → CTA → reassurance.
  // On desktop the tier list is in the body; the panel carries the resolved CTA.
  const reserveTappable = offeringCta.tappable;
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder }]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        <Pressable
          onPress={reserveTappable ? handleReserve : undefined}
          disabled={!reserveTappable}
          accessibilityRole="button"
          accessibilityState={{ disabled: !reserveTappable }}
          accessibilityLabel={
            reserveTappable
              ? offeringCta.kind === "buy"
                ? `${offeringCta.label}, ${offeringCta.price}`
                : offeringCta.kind === "free"
                  ? offeringCta.label
                  : "Join waitlist"
              : ctaUnavailableLabel(offeringCta)
          }
          style={[
            styles.deskReserve,
            reserveTappable
              ? { backgroundColor: palette.accent }
              : { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 },
          ]}
          testID="orch-1138-event-desk-reserve"
        >
          <Text
            style={[
              styles.deskReserveText,
              { color: reserveTappable ? palette.accentText : palette.tertiaryText, fontFamily: boldFamily },
            ]}
          >
            {reserveTappable
              ? offeringCta.kind === "buy"
                ? `${offeringCta.label} · ${offeringCta.price}`
                : offeringCta.label
              : ctaUnavailableLabel(offeringCta)}
          </Text>
        </Pressable>
        <Text style={[styles.deskReassure, { color: palette.tertiaryText }]}>
          All-in price · secure checkout
        </Text>
      </View>
    </View>
  ) : null;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      {/* Web-only by design (not transitional): iOS native skips Head metadata —
          buyer traffic for public event pages arrives via web URL, so HTML
          <Head> SEO/meta tags are only meaningful on web. */}
      {Platform.OS === "web" ? (
        <Head>
          <title>
            {event.name} · {brand?.displayName ?? "Mingla"}
          </title>
          <meta
            name="description"
            content={event.description.slice(0, 160) || event.name}
          />
          <meta property="og:title" content={event.name} />
          <meta
            property="og:description"
            content={event.description.slice(0, 200) || event.name}
          />
          <meta property="og:url" content={canonicalUrl(event)} />
          <meta
            property="og:image"
            content={eventOgImageUrl({
              eventId: event.id,
              coverMediaUrl: event.coverMediaUrl,
            })}
          />
          <meta property="og:type" content="event" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={event.name} />
          <meta
            name="twitter:description"
            content={event.description.slice(0, 200) || event.name}
          />
          <meta
            name="twitter:image"
            content={eventOgImageUrl({
              eventId: event.id,
              coverMediaUrl: event.coverMediaUrl,
            })}
          />
          <link rel="canonical" href={canonicalUrl(event)} />
        </Head>
      ) : null}

      {/* ORCH-1138 Leg 2 — the cancelled / password-gate page-level states keep the
          shared renderer's dedicated LEGACY render (those variants have no
          buyable body); everything else renders the Direction-A FOUNDATION page
          (FoundationEventPreview, composed in the APP layer to avoid the
          event-rendering↔offering-rendering package cycle — sim-proven). */}
      {pageVariant === "cancelled" || pageVariant === "password-gate" ? (
        <SharedPublicEventPage
          event={publicEvent}
          brand={publicBrand}
          viewerRole={viewerRole}
          callbacks={callbacks}
          theme={resolvedTheme}
        />
      ) : (
        <FoundationEventPreview
          event={publicEvent}
          brand={publicBrand}
          variant={pageVariant as "published" | "pre-sale" | "sold-out" | "past"}
          palette={palette}
          theme={resolvedTheme}
          muted={muted}
          onToggleMute={handleToggleMute}
          onClose={handleClose}
          onShare={handleShare}
          onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
          onOpenMaps={openMapsForQuery}
          stateBanner={stateBanner}
          stickyPanel={stickyPanel}
          dockedReserve={dockedReserve}
          onScroll={handleScroll}
          onScrollViewLayout={handleScrollLayout}
          safeAreaTop={insets.top}
          selectedTicketId={selectedTicketId}
          onSelectTicket={handleSelectTicket}
          testID="orch-1138-event-foundation"
        />
      )}

      {/* ORCH-1138 — FLOATING ticket PILL (phone): JUST the button, shown ONLY
          while the in-content DOCKED CTA is off-screen. Hidden on desktop (the
          sticky panel carries the CTA) and on the cancelled/password legacy page.
          Same offeringCta + onPress as the docked bar so the copy never diverges. */}
      {pageVariant !== "cancelled" &&
      pageVariant !== "password-gate" &&
      !isDesktop &&
      floatingPillVisible ? (
        <EventReserveBar
          cta={offeringCta}
          palette={palette}
          kicker={barKicker}
          fontFamily={boldFamily}
          onPress={handleReserve}
          variant="floating"
          testID="orch-1138-event-reserve"
        />
      ) : null}

      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        title={event.name}
        description={event.description.slice(0, 200)}
      />

      <JoinWaitlistSheet
        visible={waitlistTicket !== null}
        eventId={event.id}
        ticket={waitlistTicket}
        onClose={() => setWaitlistTicketId(null)}
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={dismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    position: "relative",
  },
  banner: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  deskPanel: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  deskAccent: { height: 4 },
  deskInner: { padding: 18 },
  deskReserve: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 4,
  },
  deskReserveText: {
    fontSize: 16,
    fontWeight: "900",
  },
  deskReassure: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 24,
    paddingHorizontal: 16,
    zIndex: 5,
  },
});
