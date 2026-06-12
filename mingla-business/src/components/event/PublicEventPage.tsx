/**
 * PublicEventPage — adapter for the shared @mingla/event-rendering package.
 *
 * Per META-ORCH-0827 Pass 2 (Option C). The 1,325-line predecessor was
 * superseded by a fresh pure-presentational component in
 * packages/event-rendering/. This adapter:
 *   - Fetches auth + brand list via existing mingla-business hooks
 *   - Computes viewerRole (organizer/anonymous; ticket-holder pending order data)
 *   - Maps LiveEvent + Brand types to the package's prop contract
 *   - Provides navigation callbacks (router.push for checkout, etc.)
 *   - Mounts ShareModal + Toast at the adapter level (mingla-business primitives)
 *   - Keeps web-only SEO <Head> (mingla-business-specific URLs)
 *
 * Visual fidelity is preserved — the shared package was designed to render
 * the same layout as the predecessor. Variant logic is identical.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Text, View, StyleSheet } from "react-native";
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
  resolveTheme,
  resolveOfferingCta,
  resolveOfferingSurface,
  computeOfferingVariant,
} from "@mingla/event-rendering";

import { FloatingOfferingBar } from "../offering/FloatingOfferingBar";

import {
  checkoutPublicPath,
  eventOgImageUrl,
  eventPublicUrl,
} from "../../constants/publicUrls";
import {
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
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
import { IconChrome } from "../ui/IconChrome";
import { JoinWaitlistSheet } from "../waitlist/JoinWaitlistSheet";

interface PublicEventPageAdapterProps {
  event: LiveEvent;
  brand: Brand | null;
  /**
   * ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — when false, this is a
   * PAID event whose brand cannot charge yet; the page renders the event
   * details read-only with a "Booking unavailable right now" banner and the
   * Get-tickets / claim CTA is neutralized (no dead-end checkout 409). Defaults
   * to true for back-compat with every existing caller.
   */
  bookable?: boolean;
}

const mapTicket = (t: TicketStub): PublicTicketProps => ({
  id: t.id,
  name: t.name,
  description: t.description ?? null,
  priceGbp: t.priceGbp ?? null,
  // ORCH-1006 — carry the server-computed per-tier all-in (WYSIWYP) so the
  // QuantityRow shows what the buyer pays, not the base price.
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

export const PublicEventPage: React.FC<PublicEventPageAdapterProps> = ({
  event,
  brand,
  bookable = true,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userBrands = useBrandList();

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);

  // Founder-aware viewer role. Today useBrandList returns all stub brands
  // to any signed-in user (Cycle 1 pre-B-cycle), so this resolves to
  // "isSignedIn AND owns this brand" once B-cycle real auth lands.
  const viewerRole: ViewerRole = useMemo(() => {
    if (user === null) return "anonymous";
    const owns = userBrands.some((b) => b.id === event.brandId);
    return owns ? "organizer" : "anonymous";
    // Cycle 1.2: extend with "ticket-holder" once orders are queryable
    // from the public page.
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
  // ORCH-1083: load this event's theme font on demand (no longer eager at root).
  useThemeFont(resolvedTheme.fontFamilyValue);
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

  // ORCH-1117 — floating Buy bar state. PURE projection of the shared
  // resolveOfferingCta (same machine the inline ticket rows read). The bar is
  // the always-reachable primary action; the per-ticket inline rows stay (multi
  // tier). Tapping the bar reuses the SAME navigation the row CTA uses
  // (checkoutPublicPath → the cart page that lists all tickets — LOCKED).
  const offeringCta = useMemo(
    () =>
      resolveOfferingCta({
        variant: computeOfferingVariant(publicEvent, false),
        bookable,
        tickets: publicEvent.tickets,
        currency: publicEvent.currency,
      }),
    [publicEvent, bookable],
  );
  const offeringSurface = useMemo(
    () => resolveOfferingSurface(resolvedTheme),
    [resolvedTheme],
  );
  const handleFloatingBarPress = useCallback((): void => {
    if (offeringCta.kind === "waitlist") {
      const wlTicket = publicEvent.tickets.find(
        (t) => t.visibility !== "hidden" && t.waitlistEnabled,
      );
      if (wlTicket !== undefined) setWaitlistTicketId(wlTicket.id);
      return;
    }
    // buy / free → the existing checkout/cart page (or the toast guard when the
    // brand can't charge — never a dead-end). Mirrors callbacks.onBuyTicket.
    if (!bookable) {
      showToast(
        "Booking unavailable right now — the organizer is finishing payment setup.",
      );
      return;
    }
    router.push(checkoutPublicPath(event.id) as never);
  }, [
    offeringCta.kind,
    publicEvent.tickets,
    bookable,
    router,
    event.id,
    showToast,
  ]);

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

  const callbacks: PublicEventCallbacks = useMemo(
    () => ({
      onClose: handleClose,
      onShare: handleShare,
      onBuyTicket: (_ticketId: string) => {
        // ORCH-1076 — a PAID not-ready event must not reach the checkout 409.
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        router.push(checkoutPublicPath(event.id) as never);
      },
      onClaimFreeTicket: (_ticketId: string) => {
        // Free claims are never gated (bookable is true for free offerings),
        // but guard defensively so a mixed-state row can't dead-end.
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
        // [TRANSITIONAL] Frontend stub validation against ticket.password.
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

  return (
    <View style={styles.host}>
      {/* [TRANSITIONAL] iOS native skips Head metadata — exits when
          expo-router plugin in app.json gets `origin: "<production URL>"`
          and a native rebuild lands (B-cycle). Web-only is sufficient for
          Cycle 6 because buyer traffic always arrives via web URL. */}
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

      {/* ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — graceful
          "Booking unavailable" banner for a PAID event whose brand can't charge
          yet. Details still render read-only below; the Get-tickets CTA is
          neutralized in the callbacks. Reuses the sold-out/ended visual
          register (semantic.error title + secondary body). */}
      {!bookable ? (
        <View
          style={[
            styles.unavailableBanner,
            { top: insets.top + spacing.md + 52 },
          ]}
          pointerEvents="none"
          testID="orch-1076-event-booking-unavailable"
        >
          <Text style={styles.unavailableTitle}>
            Booking unavailable right now
          </Text>
          <Text style={styles.unavailableBody}>
            This organizer is finishing their payment setup. Check back soon — or
            explore their other offerings.
          </Text>
        </View>
      ) : null}

      <SharedPublicEventPage
        event={publicEvent}
        brand={publicBrand}
        viewerRole={viewerRole}
        callbacks={callbacks}
        hideFloatingChrome
        theme={resolvedTheme}
        // ORCH-1117 — reserve clearance so the last inline ticket row scrolls
        // clear of the floating bar (bar height ≈ 96 + bottom safe area).
        contentBottomInset={96 + insets.bottom}
      />

      {/* ORCH-1117 — floating Buy bar (primary action). Non-tappable info strip
          in every unavailable state (no dead taps); the multi-tier inline rows
          coexist and route to the same /checkout/{eventId} cart. */}
      <FloatingOfferingBar
        cta={offeringCta}
        onPress={handleFloatingBarPress}
        surface={offeringSurface}
        testID="orch-1117-event-floating-bar"
      />

      <View
        style={[styles.floatingChrome, { top: insets.top + spacing.md }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="close"
          size={40}
          onPress={handleClose}
          accessibilityLabel="Close"
          testID="orch-0961-public-event-close"
        />
        <IconChrome
          icon="share"
          size={40}
          onPress={handleShare}
          accessibilityLabel="Share"
          testID="orch-0961-public-event-share"
        />
      </View>

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
  },
  // ORCH-1076 — booking-unavailable banner (graceful, non-punitive). Floats
  // under the close/share chrome row over the hero, column-width.
  unavailableBanner: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 5,
    backgroundColor: "rgba(12,14,18,0.92)",
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  unavailableTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: semantic.error,
  },
  unavailableBody: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  floatingChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 4,
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
