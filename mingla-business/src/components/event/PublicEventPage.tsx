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
import { Platform, View, StyleSheet } from "react-native";
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
} from "@mingla/event-rendering";

import {
  checkoutPublicPath,
  eventOgImageUrl,
  eventPublicUrl,
} from "../../constants/publicUrls";
import { spacing } from "../../constants/designSystem";
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

import { ShareModal } from "../ui/ShareModal";
import { Toast } from "../ui/Toast";
import { IconChrome } from "../ui/IconChrome";
import { JoinWaitlistSheet } from "../waitlist/JoinWaitlistSheet";

interface PublicEventPageAdapterProps {
  event: LiveEvent;
  brand: Brand | null;
}

const mapTicket = (t: TicketStub): PublicTicketProps => ({
  id: t.id,
  name: t.name,
  description: t.description ?? null,
  priceGbp: t.priceGbp ?? null,
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
    theme: brand.theme ?? null,
  };
};

const canonicalUrl = (event: LiveEvent): string =>
  eventPublicUrl({
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
  });

export const PublicEventPage: React.FC<PublicEventPageAdapterProps> = ({
  event,
  brand,
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
    () => resolveTheme(publicBrand?.theme ?? null, publicEvent.themeOverrides ?? null),
    [publicBrand?.theme, publicEvent.themeOverrides],
  );
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
        router.push(checkoutPublicPath(event.id) as never);
      },
      onClaimFreeTicket: (_ticketId: string) => {
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
      onUnlockPassword: (password: string): boolean => {
        // [TRANSITIONAL] Frontend stub validation against ticket.password.
        // B4 wires real backend verification (hashed comparison).
        const validPasswords = event.tickets
          .filter((t) => t.passwordProtected && t.password !== null)
          .map((t) => t.password as string);
        return validPasswords.includes(password);
      },
    }),
    [router, event.id, event.tickets, showToast, handleClose, handleShare],
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

      <SharedPublicEventPage
        event={publicEvent}
        brand={publicBrand}
        viewerRole={viewerRole}
        callbacks={callbacks}
        hideFloatingChrome
        theme={resolvedTheme}
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
