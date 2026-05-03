/**
 * PublicEventPage — the public-facing event page rendered at
 * /e/{brandSlug}/{eventSlug}.
 *
 * 7 state variants, branched per spec §3.3.1:
 *   - cancelled: status === "cancelled" — full-page cancellation notice
 *   - past: endedAt < now — greyed; "This event has ended"; buttons disabled
 *   - password-gate: any ticket passwordProtected + not unlocked yet
 *   - pre-sale: every ticket has saleStartAt > now → countdown + disabled buttons
 *   - sold-out: every (non-unlimited) ticket has capacity 0
 *   - published: default
 *
 * Order of precedence: cancelled > past > password-gate > pre-sale > sold-out > published.
 *
 * Hidden tickets (visibility="hidden") are FILTERED OUT before rendering
 * (Cycle 5 contract — direct-link only). Disabled tickets render greyed.
 *
 * Address visibility honors `event.hideAddressUntilTicket`:
 *   - true (default): venue NAME shown; address replaced with
 *     "Address shared after ticket purchase"
 *   - false: full address visible
 *
 * Buyer-flow stubs per spec Q-5 — TRANSITIONAL toasts pointing at
 * Cycles 8/10 + B3/B4/B5.
 *
 * Platform notes:
 *   SEO `<Head>` is web-only — iOS native skips Apple Spotlight handoff
 *   metadata because no origin URL is registered yet (DEC-071 frontend-
 *   first; awaits B-cycle backend + real domain). Re-enable iOS Head
 *   when origin lands in `app.json` `expo-router` plugin config and
 *   a native rebuild ships. Buyers always arrive via web URL, so iOS
 *   native loses nothing user-visible.
 *
 *   Close IconChrome is founder-aware — visible only when the signed-in
 *   user is a member of `event.brandId` (the brand that published this
 *   event). Buyers arriving via shared URL see only Share. Mingla
 *   customers from other brands see only Share (no "close to dashboard"
 *   affordance for events they don't own). Works identically on iOS,
 *   Android, and Web. Floating chrome is rendered at page-level so all
 *   7 variants (published / past / pre-sale / sold-out / password-gate /
 *   approval-required / cancelled) share the same affordance.
 *
 * Per Cycle 6 spec §3.3.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Head from "expo-router/head";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useBrandList, type Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import { formatGbpRound } from "../../utils/currency";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
} from "../../utils/eventDateDisplay";
import {
  formatTicketBadges,
  formatTicketButtonLabel,
  formatTicketSubline,
  sortTicketsByDisplayOrder,
} from "../../utils/ticketDisplay";

import { EventCover } from "../ui/EventCover";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Pill } from "../ui/Pill";
import { ShareModal } from "../ui/ShareModal";
import { Toast } from "../ui/Toast";

interface PublicEventPageProps {
  event: LiveEvent;
  brand: Brand | null;
}

const SHOW_INITIAL_DATES = 10;

type Variant =
  | "published"
  | "sold-out"
  | "pre-sale"
  | "past"
  | "password-gate"
  | "cancelled";

const computeVariant = (
  event: LiveEvent,
  passwordUnlocked: boolean,
): Variant => {
  // Order of precedence per spec §3.3.1
  if (event.status === "cancelled") return "cancelled";
  const isPast =
    event.status === "ended" ||
    (event.endedAt !== null &&
      new Date(event.endedAt).getTime() < Date.now());
  if (isPast) return "past";
  // Password gate: tickets with passwordProtected exist AND user hasn't unlocked
  const visibleTickets = event.tickets.filter(
    (t) => t.visibility !== "hidden",
  );
  const requiresPassword = visibleTickets.some((t) => t.passwordProtected);
  if (requiresPassword && !passwordUnlocked) return "password-gate";
  // Pre-sale: every visible ticket has a future saleStartAt
  const allPreSale =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.saleStartAt !== null &&
        new Date(t.saleStartAt).getTime() > Date.now(),
    );
  if (allPreSale) return "pre-sale";
  // Sold-out: every non-unlimited visible ticket has 0 capacity
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) => !t.isUnlimited && (t.capacity ?? 0) === 0,
    );
  if (allSoldOut) return "sold-out";
  return "published";
};

/** Earliest saleStartAt among tickets (used for pre-sale countdown). */
const computePreSaleStart = (event: LiveEvent): string | null => {
  const candidates = event.tickets
    .filter((t) => t.visibility !== "hidden" && t.saleStartAt !== null)
    .map((t) => t.saleStartAt as string);
  if (candidates.length === 0) return null;
  return candidates.sort()[0];
};

const formatCountdown = (toIso: string): string => {
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
};

/** TRANSITIONAL: when image upload lands (Cycle 5b/B-cycle), swap for real cover URL. */
const ogImageUrl = (event: LiveEvent): string => {
  // [TRANSITIONAL] Placeholder — real OG image generation lands when
  // image upload exists. For now, use a static brand-color fallback.
  return `https://business.mingla.com/og/event/${event.id}.png`;
};

const canonicalUrl = (event: LiveEvent): string =>
  `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`;

// ---- Main component -------------------------------------------------

export const PublicEventPage: React.FC<PublicEventPageProps> = ({
  event,
  brand,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userBrands = useBrandList();
  const [passwordUnlocked, setPasswordUnlocked] = useState<boolean>(false);
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const variant: Variant = useMemo(
    () => computeVariant(event, passwordUnlocked),
    [event, passwordUnlocked],
  );

  // Founder-aware close chrome: shown only when the visitor owns the
  // brand that published this event. Forward-compat — when B-cycle wires
  // real auth + `useBrandList` filters to user-owned brands, this check
  // becomes precise. Today, useBrandList returns all stub brands to any
  // signed-in user, so this resolves to "isSignedIn" in practice.
  const ownsThisEvent = useMemo<boolean>(() => {
    if (user === null) return false;
    return userBrands.some((b) => b.id === event.brandId);
  }, [user, userBrands, event.brandId]);

  const handleClose = useCallback((): void => {
    router.replace("/(tabs)/events" as never);
  }, [router]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleShare = useCallback(async (): Promise<void> => {
    const url = canonicalUrl(event);
    if (Platform.OS === "web") {
      const navAny = (
        globalThis as unknown as {
          navigator?: {
            share?: (data: { title: string; url: string }) => Promise<void>;
            clipboard?: { writeText?: (s: string) => Promise<void> };
          };
        }
      ).navigator;
      if (navAny?.share !== undefined) {
        try {
          await navAny.share({ title: event.name, url });
        } catch {
          // user cancelled — surface no error
        }
      } else if (navAny?.clipboard?.writeText !== undefined) {
        try {
          await navAny.clipboard.writeText(url);
          showToast("Link copied");
        } catch {
          showToast("Couldn't copy link.");
        }
      } else {
        showToast("Share not supported on this browser.");
      }
    } else {
      try {
        await Share.share({ message: `${event.name}\n${url}`, url });
      } catch {
        // user cancelled
      }
    }
  }, [event, showToast]);

  const handleBuyerAction = useCallback(
    (action: "buy" | "free" | "approval" | "password" | "waitlist"): void => {
      // Cycle 8: "buy" + "free" route to checkout (J-C1 → J-C5). Other
      // cases stay TRANSITIONAL until their respective cycles land.
      switch (action) {
        case "buy":
        case "free":
          router.push(`/checkout/${event.id}` as never);
          return;
        case "approval":
          showToast("Approval flow lands Cycle 10 + B4.");
          return;
        case "waitlist":
          showToast("Waitlist invites land B5.");
          return;
        case "password":
          // Password-gate handles its own flow inline.
          return;
      }
    },
    [router, event.id, showToast],
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
          <meta property="og:image" content={ogImageUrl(event)} />
          <meta property="og:type" content="event" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={event.name} />
          <meta
            name="twitter:description"
            content={event.description.slice(0, 200) || event.name}
          />
          <link rel="canonical" href={canonicalUrl(event)} />
        </Head>
      ) : null}

      {variant === "cancelled" ? (
        <CancelledVariant event={event} brand={brand} insetsTop={insets.top} />
      ) : variant === "past" ? (
        <PublishedBody
          event={event}
          brand={brand}
          variant="past"
          onBuyerAction={handleBuyerAction}
        />
      ) : variant === "password-gate" ? (
        <PasswordGateVariant
          event={event}
          insetsTop={insets.top}
          onUnlock={() => setPasswordUnlocked(true)}
        />
      ) : (
        <PublishedBody
          event={event}
          brand={brand}
          variant={variant}
          onBuyerAction={handleBuyerAction}
        />
      )}

      {/* Page-level floating chrome — close (founder only, routes to
          Events tab) + share. Lifted to page-level so all 7 state
          variants share the same chrome. zIndex 3 + position absolute
          floats above hero / banners / variant body. */}
      <View
        style={[styles.floatingChrome, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        {ownsThisEvent ? (
          <IconChrome
            icon="close"
            size={40}
            onPress={handleClose}
            accessibilityLabel="Close"
          />
        ) : (
          <View />
        )}
        <IconChrome
          icon="share"
          size={40}
          onPress={() => setShareModalVisible(true)}
          accessibilityLabel="Share"
        />
      </View>

      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        title={event.name}
        description={event.description.slice(0, 200)}
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

// ---- PublishedBody: handles published / pre-sale / sold-out / past ---

interface PublishedBodyProps {
  event: LiveEvent;
  brand: Brand | null;
  variant: "published" | "pre-sale" | "sold-out" | "past";
  onBuyerAction: (
    action: "buy" | "free" | "approval" | "password" | "waitlist",
  ) => void;
}

const PublishedBody: React.FC<PublishedBodyProps> = ({
  event,
  brand,
  variant,
  onBuyerAction,
}) => {
  const insets = useSafeAreaInsets();
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [showOverflowDates, setShowOverflowDates] = useState<boolean>(false);

  const dateLine = formatDraftDateLine(event);
  const subline = formatDraftDateSubline(event);
  const datesList = formatDraftDatesList(event);
  const titleLine = event.name.length > 0 ? event.name : "Untitled event";
  const brandLetter = (brand?.displayName?.charAt(0) ?? "?").toUpperCase();

  const visibleTickets = useMemo(
    () => sortTicketsByDisplayOrder(
      event.tickets.filter((t) => t.visibility !== "hidden"),
    ),
    [event.tickets],
  );

  const visibleDates: string[] = (() => {
    if (!showAllDates) return [];
    if (datesList.length <= SHOW_INITIAL_DATES || showOverflowDates) {
      return datesList;
    }
    return datesList.slice(0, SHOW_INITIAL_DATES);
  })();

  const isPast = variant === "past";
  const isSoldOut = variant === "sold-out";
  const isPreSale = variant === "pre-sale";
  const preSaleStart =
    isPreSale ? computePreSaleStart(event) : null;

  return (
    <>
      {/* Hero cover */}
      <View style={styles.heroWrap}>
        <EventCover hue={event.coverHue} radius={0} label="" height={380} />
        <View style={styles.heroOverlay} pointerEvents="none" />
      </View>

      {/* Floating chrome lifted to page-level (PublicEventPage) — close
          (founder only) + share. See PublicEventPage's chrome block. */}

      {/* State banner — past / pre-sale / sold-out */}
      {isPast || isPreSale || isSoldOut ? (
        <View
          style={[styles.stateBannerWrap, { top: insets.top + 56 }]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.stateBanner,
              isPast && styles.stateBannerMuted,
              isPreSale && styles.stateBannerInfo,
              isSoldOut && styles.stateBannerWarn,
            ]}
          >
            <Text style={styles.stateBannerLabel}>
              {isPast
                ? "THIS EVENT HAS ENDED"
                : isPreSale && preSaleStart !== null
                  ? `ON SALE ${formatCountdown(preSaleStart).toUpperCase()}`
                  : isPreSale
                    ? "ON SALE SOON"
                    : "SOLD OUT"}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl * 2 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.bodyContent, isPast && styles.bodyContentMuted]}>
          {/* Title block */}
          <View style={styles.titleBlock}>
            <View style={styles.titleBlockText}>
              <Text style={styles.dateLine}>{dateLine}</Text>
              <Text style={styles.titleLine}>{titleLine}</Text>

              {/* Recurring / multi-date pill + accordion expand */}
              {subline !== null ? (
                <View style={styles.recurrencePillRow}>
                  <Pressable
                    onPress={() => setShowAllDates((s) => !s)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showAllDates ? "Collapse date list" : "Show all dates"
                    }
                    style={styles.recurrencePill}
                  >
                    <Text style={styles.recurrencePillLabel}>
                      {subline} · {showAllDates ? "Hide" : "Show all"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {showAllDates && visibleDates.length > 0 ? (
                <View style={styles.expandedDatesList}>
                  {visibleDates.map((label, i) => (
                    <View key={i} style={styles.expandedDateRow}>
                      <Text style={styles.expandedDateText}>{label}</Text>
                    </View>
                  ))}
                  {datesList.length > SHOW_INITIAL_DATES &&
                  !showOverflowDates ? (
                    <Pressable
                      onPress={() => setShowOverflowDates(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Show all ${datesList.length} dates`}
                      style={styles.showAllBtn}
                    >
                      <Text style={styles.showAllLabel}>
                        Show all {datesList.length} dates
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {/* Brand chip */}
          <View style={styles.brandRow}>
            <View style={styles.brandTile}>
              <Text style={styles.brandLetter}>{brandLetter}</Text>
            </View>
            <Text style={styles.brandName}>
              {brand?.displayName ?? "Brand"}
            </Text>
          </View>

          {/* Venue card — honors hideAddressUntilTicket */}
          {event.format !== "online" && event.venueName !== null ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.venueCard}
            >
              <View style={styles.venueRow}>
                <Icon name="location" size={18} color={accent.warm} />
                <View style={styles.venueTextCol}>
                  <Text style={styles.venueName}>{event.venueName}</Text>
                  <Text style={styles.venueAddress}>
                    {event.hideAddressUntilTicket
                      ? "Address shared after ticket purchase"
                      : event.format === "hybrid" && event.address !== null
                        ? `${event.address} · also online`
                        : event.address ?? "Address shared after ticket purchase"}
                  </Text>
                </View>
              </View>
            </GlassCard>
          ) : event.format === "online" ? (
            <GlassCard
              variant="base"
              padding={spacing.md}
              style={styles.venueCard}
            >
              <View style={styles.venueRow}>
                <Icon name="globe" size={18} color={accent.warm} />
                <View style={styles.venueTextCol}>
                  <Text style={styles.venueName}>Online</Text>
                  <Text style={styles.venueAddress}>
                    Conferencing link shared with ticketed guests.
                  </Text>
                </View>
              </View>
            </GlassCard>
          ) : null}

          {/* About */}
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.aboutBody}>
            {event.description.length > 0
              ? event.description
              : "Details coming soon."}
          </Text>

          {/* Tickets list */}
          <Text style={styles.sectionTitle}>Tickets</Text>
          {visibleTickets.length === 0 ? (
            <GlassCard variant="base" padding={spacing.md}>
              <Text style={styles.aboutBody}>
                No tickets available yet.
              </Text>
            </GlassCard>
          ) : (
            <View style={styles.ticketsCol}>
              {visibleTickets.map((t, i) => (
                <PublicTicketRow
                  key={t.id}
                  ticket={t}
                  isLast={i === visibleTickets.length - 1}
                  variant={variant}
                  onBuyerAction={onBuyerAction}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
};

// ---- PublicTicketRow ------------------------------------------------

interface PublicTicketRowProps {
  ticket: TicketStub;
  isLast: boolean;
  variant: "published" | "pre-sale" | "sold-out" | "past";
  onBuyerAction: (
    action: "buy" | "free" | "approval" | "password" | "waitlist",
  ) => void;
}

const PublicTicketRow: React.FC<PublicTicketRowProps> = ({
  ticket,
  isLast,
  variant,
  onBuyerAction,
}) => {
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? formatGbpRound(ticket.priceGbp)
      : "—";
  const subLine = formatTicketSubline(ticket);
  const badges = formatTicketBadges(ticket);
  const buttonLabel = formatTicketButtonLabel(ticket);
  const isVisDisabled = ticket.visibility === "disabled";
  const isSoldOutTicket =
    !ticket.isUnlimited && (ticket.capacity ?? 0) === 0;

  // Decide what action this ticket's button fires.
  const handleTap = (): void => {
    if (variant === "past" || isVisDisabled) return;
    if (variant === "pre-sale") return; // disabled during pre-sale
    if (isSoldOutTicket && ticket.waitlistEnabled) {
      onBuyerAction("waitlist");
      return;
    }
    if (isSoldOutTicket) return; // sold out + no waitlist → disabled
    if (ticket.approvalRequired) {
      onBuyerAction("approval");
      return;
    }
    if (ticket.isFree) {
      onBuyerAction("free");
      return;
    }
    onBuyerAction("buy");
  };

  // Compute final button label + disabled state per variant.
  const effectiveLabel: string = (() => {
    if (variant === "past") return "Sales ended";
    if (variant === "pre-sale") return "On sale soon";
    if (isVisDisabled) return "Sales paused";
    if (isSoldOutTicket && ticket.waitlistEnabled) return "Join waitlist";
    if (isSoldOutTicket) return "Sold out";
    return buttonLabel;
  })();

  const isButtonDisabled =
    variant === "past" ||
    variant === "pre-sale" ||
    isVisDisabled ||
    (isSoldOutTicket && !ticket.waitlistEnabled);

  return (
    <View
      style={[
        styles.ticketRow,
        !isLast && styles.ticketRowDivider,
        isVisDisabled && styles.ticketRowDisabled,
      ]}
    >
      <View style={styles.ticketTextCol}>
        <Text style={styles.ticketName}>{ticket.name}</Text>
        {/* Description (Cycle 6 5b absorption) — only shown when set */}
        {ticket.description !== null && ticket.description.length > 0 ? (
          <Text style={styles.ticketDescription}>{ticket.description}</Text>
        ) : null}
        {/* Sub-line: modifiers + capacity */}
        <Text style={styles.ticketSub}>
          {subLine.length > 0 && subLine !== priceLabel
            ? subLine
            : ticket.isUnlimited
              ? "Unlimited"
              : ticket.capacity !== null
                ? `${ticket.capacity} available`
                : "Available"}
        </Text>
        {badges.length > 0 ? (
          <View style={styles.ticketBadgesRow}>
            {badges.map((b) => (
              <Pill
                key={b.label}
                variant={
                  b.variant === "warning"
                    ? "warn"
                    : b.variant === "muted"
                      ? "draft"
                      : b.variant === "accent"
                        ? "accent"
                        : "info"
                }
              >
                {b.label}
              </Pill>
            ))}
          </View>
        ) : null}
        <Pressable
          onPress={handleTap}
          disabled={isButtonDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: isButtonDisabled }}
          accessibilityLabel={effectiveLabel}
          style={[
            styles.ticketBuyerBtn,
            isButtonDisabled && styles.ticketBuyerBtnDisabled,
          ]}
        >
          <Text
            style={[
              styles.ticketBuyerBtnLabel,
              isButtonDisabled && styles.ticketBuyerBtnLabelDisabled,
            ]}
          >
            {effectiveLabel}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.ticketPrice}>{priceLabel}</Text>
    </View>
  );
};

// ---- CancelledVariant -----------------------------------------------

interface CancelledVariantProps {
  event: LiveEvent;
  brand: Brand | null;
  insetsTop: number;
}

const CancelledVariant: React.FC<CancelledVariantProps> = ({
  event,
  brand,
  insetsTop,
}) => {
  return (
    <View style={[styles.cancelledHost, { paddingTop: insetsTop + spacing.lg }]}>
      <View style={styles.cancelledIconWrap}>
        <Icon name="flag" size={32} color={semantic.error} />
      </View>
      <Text style={styles.cancelledTitle}>This event has been cancelled</Text>
      <Text style={styles.cancelledEventName}>{event.name}</Text>
      <Text style={styles.cancelledBody}>
        {brand?.displayName ?? "The organiser"} has cancelled this event.
        If you purchased tickets, you'll receive refund details by email.
      </Text>
    </View>
  );
};

// ---- PasswordGateVariant --------------------------------------------

interface PasswordGateVariantProps {
  event: LiveEvent;
  insetsTop: number;
  onUnlock: () => void;
}

const PasswordGateVariant: React.FC<PasswordGateVariantProps> = ({
  event,
  insetsTop,
  onUnlock,
}) => {
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<boolean>(false);

  const handleUnlock = useCallback((): void => {
    // [TRANSITIONAL] Frontend stub validation against ticket.password.
    // B4 wires real backend verification (hashed comparison).
    const validPasswords = event.tickets
      .filter((t) => t.passwordProtected && t.password !== null)
      .map((t) => t.password as string);
    if (validPasswords.includes(password)) {
      onUnlock();
    } else {
      setError(true);
      setPassword("");
    }
  }, [event.tickets, password, onUnlock]);

  return (
    <View
      style={[styles.gateHost, { paddingTop: insetsTop + spacing.lg }]}
    >
      <GlassCard
        variant="elevated"
        padding={spacing.lg}
        radius="xl"
        style={styles.gateCard}
      >
        <Icon name="shield" size={28} color={accent.warm} />
        <Text style={styles.gateTitle}>This event requires a password</Text>
        <Text style={styles.gateBody}>
          Enter the password to view ticket options for {event.name}.
        </Text>
        <View
          style={[styles.gateInputWrap, error && styles.gateInputWrapError]}
        >
          <TextInput
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (error) setError(false);
            }}
            placeholder="Password"
            placeholderTextColor={textTokens.quaternary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.gateInput}
            accessibilityLabel="Event password"
            onSubmitEditing={handleUnlock}
          />
        </View>
        {error ? (
          <Text style={styles.gateError}>
            Wrong password. Try again or contact the organiser.
          </Text>
        ) : null}
        <Pressable
          onPress={handleUnlock}
          disabled={password.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Unlock event"
          accessibilityState={{ disabled: password.length === 0 }}
          style={[
            styles.gateUnlockBtn,
            password.length === 0 && styles.gateUnlockBtnDisabled,
          ]}
        >
          <Text style={styles.gateUnlockLabel}>Unlock</Text>
        </Pressable>
      </GlassCard>
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },

  // Hero
  heroWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 380,
    zIndex: 0,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  floatingChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  stateBannerWrap: {
    position: "absolute",
    left: spacing.md,
    zIndex: 3,
  },
  stateBanner: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  stateBannerMuted: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  stateBannerInfo: {
    backgroundColor: semantic.infoTint,
    borderColor: "rgba(59, 130, 246, 0.45)",
  },
  stateBannerWarn: {
    backgroundColor: semantic.warningTint,
    borderColor: "rgba(245, 158, 11, 0.45)",
  },
  stateBannerLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.primary,
  },

  scroll: {
    flex: 1,
    zIndex: 2,
  },
  scrollContent: {
    paddingTop: 280,
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: "#0c0e12",
  },
  bodyContentMuted: {
    opacity: 0.7,
  },

  titleBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleBlockText: {
    flex: 1,
  },
  dateLine: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 8,
  },
  titleLine: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  recurrencePillRow: {
    flexDirection: "row",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  recurrencePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  recurrencePillLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  expandedDatesList: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  expandedDateRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  expandedDateText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  showAllBtn: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  showAllLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: {
    fontWeight: "700",
    fontSize: 13,
    color: "#fff",
  },
  brandName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },

  venueCard: {
    marginBottom: spacing.md,
  },
  venueRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  venueTextCol: {
    flex: 1,
  },
  venueName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  venueAddress: {
    fontSize: 12,
    color: textTokens.secondary,
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  aboutBody: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 24,
  },

  ticketsCol: {
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "hidden",
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  ticketRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  ticketRowDisabled: {
    opacity: 0.5,
  },
  ticketTextCol: {
    flex: 1,
  },
  ticketName: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  ticketDescription: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 4,
    lineHeight: typography.caption.lineHeight * 1.4,
  },
  ticketSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  ticketBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  ticketBuyerBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignSelf: "flex-start",
  },
  ticketBuyerBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  ticketBuyerBtnLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  ticketBuyerBtnLabelDisabled: {
    color: textTokens.tertiary,
  },
  ticketPrice: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },

  // Cancelled variant
  cancelledHost: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  cancelledIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: semantic.errorTint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  cancelledTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  cancelledEventName: {
    fontSize: 16,
    color: textTokens.secondary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  cancelledBody: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },

  // Password gate variant
  gateHost: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  gateCard: {
    width: "100%",
    maxWidth: 480,
    alignItems: "center",
    gap: spacing.sm,
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  gateBody: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  gateInputWrap: {
    width: "100%",
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  gateInputWrapError: {
    borderColor: semantic.error,
  },
  gateInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  gateError: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    textAlign: "center",
    marginTop: 4,
  },
  gateUnlockBtn: {
    width: "100%",
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    marginTop: spacing.md,
  },
  gateUnlockBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  gateUnlockLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: "#fff",
  },

  // Toast wrap
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    zIndex: 5,
  },
});
