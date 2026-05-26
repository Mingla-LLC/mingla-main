// PublicEventPage — pure-presentational public event renderer.
//
// Per META-ORCH-0827 Pass 2 (Option C). Designed fresh for cross-app
// sharing. Both mingla-business (native + web) and app-mobile (native)
// consume this component via @mingla/event-rendering.
//
// Pattern rules (DEC-PASS2-8 → I-1.2-* invariants after Pass 2 validates):
//   - Pure presentational: NO data fetching, NO useAuth, NO useRouter,
//     NO Zustand reads. All data via props; all actions via callback props.
//   - Role-aware: branches affordances on `viewerRole` prop. Organizer sees
//     close+share, ticket-holder/anonymous see share only.
//   - Self-contained: no imports from any app's src/. Design tokens are
//     local (./designTokens). UI primitives are inline RN primitives.
//
// 7 state variants per spec precedence: cancelled > past > password-gate >
// pre-sale > sold-out > published.
//
// Hidden tickets (visibility="hidden") are filtered out before rendering.
// Disabled tickets render greyed.
//
// Address visibility honors event.hideAddressUntilTicket:
//   - true: venue NAME shown; address replaced with "Address shared after
//     ticket purchase"
//   - false: full address visible
import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BlurView } from "expo-blur";

import {
  accent,
  backgroundColor,
  glass,
  radius,
  MINGLA_DEFAULT_THEME,
  type ResolvedTheme,
  semantic,
  spacing,
  text,
  typography,
} from "./designTokens";
import { resolveTheme } from "./themeResolver";
import { ThemeEntranceAnimation } from "./ThemeEntranceAnimation";
import type {
  PublicEventPageProps,
  PublicEventProps,
  PublicTicketProps,
} from "./types";
import { EventCoverMedia } from "./EventCoverMedia";

const SHOW_INITIAL_DATES = 10;

type Variant =
  | "published"
  | "sold-out"
  | "pre-sale"
  | "past"
  | "password-gate"
  | "cancelled";

type ThemePalette = {
  page: string;
  accent: string;
  accentText: string;
  primaryText: string;
  secondaryText: string;
  tertiaryText: string;
  panel: string;
  panelStrong: string;
  panelBorder: string;
  card: string;
  cutoutBorder: string;
  glass: string;
  glassTint: "dark" | "light";
  accentWash: string;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const FALLBACK_ACCENT_RGB: Rgb = { r: 235, g: 120, b: 37 };

const clampColorChannel = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)));

const parseHexColor = (hex: string): Rgb => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (match === null) return FALLBACK_ACCENT_RGB;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;

const mixHexColors = (from: string, to: string, amount: number): string => {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  const weight = Math.min(1, Math.max(0, amount));
  return rgbToHex({
    r: a.r + (b.r - a.r) * weight,
    g: a.g + (b.g - a.g) * weight,
    b: a.b + (b.b - a.b) * weight,
  });
};

const hexToRgba = (hex: string, alpha: number): string => {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};

const linearizeSrgb = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (hex: string): number => {
  const { r, g, b } = parseHexColor(hex);
  return (
    0.2126 * linearizeSrgb(r) +
    0.7152 * linearizeSrgb(g) +
    0.0722 * linearizeSrgb(b)
  );
};

const contrastRatio = (a: string, b: string): number => {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

const readableTextFor = (background: string): "#000000" | "#ffffff" =>
  contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff";

const contrastAdjustedAccent = (
  accentColor: string,
  background: string,
  minimumRatio: number,
): string => {
  if (contrastRatio(accentColor, background) >= minimumRatio)
    return accentColor;
  const direction = readableTextFor(background);
  let adjusted = accentColor;
  for (let i = 0; i < 12; i++) {
    adjusted = mixHexColors(adjusted, direction, 0.16);
    if (contrastRatio(adjusted, background) >= minimumRatio) return adjusted;
  }
  return adjusted;
};

const contrastAdjustedForWhiteText = (
  accentColor: string,
  minimumRatio: number,
): string => {
  if (contrastRatio(accentColor, "#ffffff") >= minimumRatio) return accentColor;
  let adjusted = accentColor;
  for (let i = 0; i < 12; i++) {
    adjusted = mixHexColors(adjusted, "#000000", 0.14);
    if (contrastRatio(adjusted, "#ffffff") >= minimumRatio) return adjusted;
  }
  return adjusted;
};

const createThemePalette = (theme: ResolvedTheme): ThemePalette => {
  const darkBase = "#07070a";
  const lightBase = "#f8fafc";
  const accentOnDark = contrastRatio(theme.color, darkBase);
  const accentOnLight = contrastRatio(theme.color, lightBase);
  const useDark =
    accentOnDark >= 3 && accentOnLight < 3
      ? true
      : accentOnLight >= 3 && accentOnDark < 3
        ? false
        : theme.foregroundColor === "#ffffff";
  const basePage = useDark ? darkBase : lightBase;
  const page = mixHexColors(basePage, theme.color, useDark ? 0.1 : 0.035);
  const accentColor = contrastAdjustedForWhiteText(
    contrastAdjustedAccent(theme.color, page, 3.15),
    4.5,
  );
  const primaryText = readableTextFor(page);
  return {
    page,
    accent: accentColor,
    accentText: "#ffffff",
    primaryText,
    secondaryText:
      primaryText === "#ffffff"
        ? "rgba(255,255,255,0.78)"
        : "rgba(16,20,31,0.76)",
    tertiaryText:
      primaryText === "#ffffff"
        ? "rgba(255,255,255,0.58)"
        : "rgba(16,20,31,0.58)",
    panel: useDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.76)",
    panelStrong: useDark ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.92)",
    panelBorder: hexToRgba(accentColor, useDark ? 0.38 : 0.3),
    card: useDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
    cutoutBorder: useDark ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.96)",
    glass: useDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.62)",
    glassTint: useDark ? "dark" : "light",
    accentWash: hexToRgba(accentColor, useDark ? 0.24 : 0.18),
  };
};

const computeVariant = (
  event: PublicEventProps,
  passwordUnlocked: boolean,
): Variant => {
  if (event.status === "cancelled") return "cancelled";
  const isPast =
    event.status === "ended" ||
    (event.endedAt !== null && new Date(event.endedAt).getTime() < Date.now());
  if (isPast) return "past";
  const visibleTickets = event.tickets.filter((t) => t.visibility !== "hidden");
  const requiresPassword = visibleTickets.some((t) => t.passwordProtected);
  if (requiresPassword && !passwordUnlocked) return "password-gate";
  const allPreSale =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.saleStartAt !== null &&
        new Date(t.saleStartAt).getTime() > Date.now(),
    );
  if (allPreSale) return "pre-sale";
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) === 0);
  if (allSoldOut) return "sold-out";
  return "published";
};

const computePreSaleStart = (event: PublicEventProps): string | null => {
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

const sortTicketsByDisplayOrder = (
  tickets: PublicTicketProps[],
): PublicTicketProps[] =>
  [...tickets].sort((a, b) => a.displayOrder - b.displayOrder);

const formatTicketPrice = (
  ticket: PublicTicketProps,
  fallbackCurrency: string,
): string => {
  if (ticket.isFree) return "Free";
  if (ticket.priceGbp === null) return "—";
  const currency = ticket.currency ?? fallbackCurrency;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(ticket.priceGbp);
  } catch {
    return `${currency} ${ticket.priceGbp.toFixed(2)}`;
  }
};

// ---- Main component -------------------------------------------------

export const PublicEventPage: React.FC<PublicEventPageProps> = ({
  event,
  brand,
  viewerRole,
  callbacks,
  hideFloatingChrome = false,
  theme,
}) => {
  const [passwordUnlocked, setPasswordUnlocked] = useState<boolean>(false);
  const resolvedTheme = useMemo<ResolvedTheme>(
    () =>
      theme ?? resolveTheme(brand?.theme ?? null, event.themeOverrides ?? null),
    [theme, brand?.theme, event.themeOverrides],
  );

  const variant: Variant = useMemo(
    () => computeVariant(event, passwordUnlocked),
    [event, passwordUnlocked],
  );
  const resolvedPalette = useMemo(
    () => createThemePalette(resolvedTheme),
    [resolvedTheme],
  );

  const ownsThisEvent = viewerRole === "organizer";

  const handleUnlockPassword = useCallback(
    (password: string): void => {
      const ok = callbacks.onUnlockPassword?.(password) ?? false;
      if (ok) setPasswordUnlocked(true);
    },
    [callbacks],
  );

  return (
    <View style={[styles.host, { backgroundColor: resolvedPalette.page }]}>
      {variant === "cancelled" ? (
        <CancelledVariant event={event} brand={brand} />
      ) : variant === "password-gate" ? (
        <PasswordGateVariant event={event} onUnlock={handleUnlockPassword} />
      ) : (
        <PublishedBody
          event={event}
          brand={brand}
          variant={variant}
          callbacks={callbacks}
          theme={resolvedTheme}
        />
      )}

      {/* Floating chrome — close (organizer only) + share. zIndex 3
          floats above hero / banners / variant body.

          ORCH-0961 rework: hosts that render their own chrome (e.g. the
          buyer-web public event adapter) pass `hideFloatingChrome` to
          suppress this row so only one Share/Close exists in the DOM and
          accessibility tree. */}
      {hideFloatingChrome ? null : (
        <View style={styles.floatingChrome} pointerEvents="box-none">
          {ownsThisEvent ? (
            <Pressable
              onPress={callbacks.onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.chromeButton}
            >
              <Text
                style={[
                  styles.chromeIcon,
                  { color: resolvedTheme.foregroundColor },
                ]}
              >
                ×
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable
            onPress={callbacks.onShare}
            accessibilityRole="button"
            accessibilityLabel="Share"
            hitSlop={8}
            style={styles.chromeButton}
          >
            <Text
              style={[
                styles.chromeIcon,
                { color: resolvedTheme.foregroundColor },
              ]}
            >
              ↗
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

// ---- PublishedBody --------------------------------------------------

interface PublishedBodyProps {
  event: PublicEventProps;
  brand: PublicEventPageProps["brand"];
  variant: "published" | "pre-sale" | "sold-out" | "past";
  callbacks: PublicEventPageProps["callbacks"];
  theme: ResolvedTheme;
}

const PublishedBody: React.FC<PublishedBodyProps> = ({
  event,
  brand,
  variant,
  callbacks,
  theme,
}) => {
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [showOverflowDates, setShowOverflowDates] = useState<boolean>(false);

  const titleLine = event.name.length > 0 ? event.name : "Untitled event";
  const brandLetter = (brand?.displayName?.charAt(0) ?? "?").toUpperCase();
  const venueAddressLabel = event.hideAddressUntilTicket
    ? "Address shared after ticket purchase"
    : event.format === "hybrid" && event.address !== null
      ? `${event.address} · also online`
      : (event.address ?? "Address shared after ticket purchase");
  const venueMapsQuery =
    event.hideAddressUntilTicket || event.venueName === null
      ? null
      : [event.venueName, event.address].filter(Boolean).join(", ");
  const canOpenVenueMaps =
    venueMapsQuery !== null &&
    venueMapsQuery.trim().length > 0 &&
    callbacks.onOpenMaps !== undefined;

  const visibleTickets = useMemo(
    () =>
      sortTicketsByDisplayOrder(
        event.tickets.filter((t) => t.visibility !== "hidden"),
      ),
    [event.tickets],
  );

  const visibleDates: string[] = (() => {
    if (!showAllDates) return [];
    if (event.datesList.length <= SHOW_INITIAL_DATES || showOverflowDates) {
      return event.datesList;
    }
    return event.datesList.slice(0, SHOW_INITIAL_DATES);
  })();

  const isPast = variant === "past";
  const isSoldOut = variant === "sold-out";
  const isPreSale = variant === "pre-sale";
  const preSaleStart = isPreSale ? computePreSaleStart(event) : null;
  const heroColor =
    theme.color === MINGLA_DEFAULT_THEME.color && event.coverHue !== 25
      ? `hsl(${event.coverHue}, 60%, 45%)`
      : theme.color;
  const palette = useMemo(() => createThemePalette(theme), [theme]);

  return (
    <>
      {/* Hero cover */}
      <View style={styles.heroWrap}>
        {event.coverMediaUrl !== null &&
        (event.coverMediaType === "image" || event.coverMediaType === "gif") ? (
          <Image
            source={{ uri: event.coverMediaUrl }}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityLabel="Event cover"
          />
        ) : event.coverMediaUrl !== null && event.coverMediaType === "video" ? (
          <EventCoverMedia
            mediaUrl={event.coverMediaUrl}
            mediaType="video"
            hue={event.coverHue}
            height={380}
            radius={0}
            muted={true}
            autoplay={true}
            loop={true}
            showAudioControl
            audioControlLabel="event cover video"
          />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: heroColor }]} />
        )}
        <View style={styles.heroOverlay} pointerEvents="none" />
        <ThemeEntranceAnimation
          theme={theme}
          sessionKey={`event:${event.id}`}
        />
        {event.coverCredit !== null ? (
          <View style={styles.coverCreditBadge} pointerEvents="none">
            <Text style={styles.coverCreditText}>{event.coverCredit}</Text>
          </View>
        ) : null}
      </View>

      {/* State banner — past / pre-sale / sold-out */}
      {isPast || isPreSale || isSoldOut ? (
        <View style={styles.stateBannerWrap} pointerEvents="none">
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
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.bodyContent,
            {
              backgroundColor: palette.page,
              borderColor: palette.panelBorder,
              shadowColor: palette.accent,
            },
            isPast && styles.bodyContentMuted,
          ]}
        >
          <BlurView
            tint={palette.glassTint}
            intensity={28}
            pointerEvents="none"
            style={styles.bodyGlassLayer}
          />
          {/* Title block */}
          <View style={styles.titleBlock}>
            <View style={styles.titleBlockText}>
              <Text
                style={[
                  styles.dateLine,
                  { color: "#ffffff", fontFamily: theme.fontFamilyValue },
                ]}
              >
                {event.dateLine}
              </Text>
              <Text
                style={[
                  styles.titleLine,
                  {
                    color: palette.primaryText,
                    fontFamily: theme.fontFamilyValue,
                  },
                ]}
              >
                {titleLine}
              </Text>

              {event.dateSubline !== null ? (
                <View style={styles.recurrencePillRow}>
                  <Pressable
                    onPress={() => setShowAllDates((s) => !s)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showAllDates ? "Collapse date list" : "Show all dates"
                    }
                    style={[
                      styles.recurrencePill,
                      {
                        backgroundColor: palette.accentWash,
                        borderColor: palette.panelBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.recurrencePillLabel, { color: "#ffffff" }]}
                    >
                      {event.dateSubline} · {showAllDates ? "Hide" : "Show all"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {showAllDates && visibleDates.length > 0 ? (
                <View style={styles.expandedDatesList}>
                  {visibleDates.map((label, i) => (
                    <View
                      key={i}
                      style={[
                        styles.expandedDateRow,
                        {
                          backgroundColor: palette.card,
                          borderColor: palette.cutoutBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.expandedDateText,
                          { color: palette.primaryText },
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  ))}
                  {event.datesList.length > SHOW_INITIAL_DATES &&
                  !showOverflowDates ? (
                    <Pressable
                      onPress={() => setShowOverflowDates(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Show all ${event.datesList.length} dates`}
                      style={styles.showAllBtn}
                    >
                      <Text
                        style={[styles.showAllLabel, { color: palette.accent }]}
                      >
                        Show all {event.datesList.length} dates
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {/* Brand chip */}
          <Pressable
            onPress={() => {
              if (brand?.slug !== undefined)
                callbacks.onOpenBrand?.(brand.slug);
            }}
            disabled={
              brand?.slug === undefined || callbacks.onOpenBrand === undefined
            }
            accessibilityRole={
              callbacks.onOpenBrand === undefined ? undefined : "button"
            }
            accessibilityLabel={
              brand?.displayName !== undefined
                ? `View ${brand.displayName}`
                : "View brand"
            }
            style={({ pressed }) => [
              styles.brandRow,
              {
                backgroundColor: palette.glass,
                borderColor: palette.cutoutBorder,
              },
              callbacks.onOpenBrand !== undefined && styles.brandRowInteractive,
              pressed && styles.brandRowPressed,
            ]}
          >
            {brand?.photo !== undefined && brand.photo.length > 0 ? (
              <Image
                source={{ uri: brand.photo }}
                style={[
                  styles.brandTile,
                  styles.brandPhoto,
                  { borderColor: palette.cutoutBorder },
                ]}
                resizeMode="cover"
                accessibilityLabel={`${brand.displayName} profile photo`}
              />
            ) : (
              <View
                style={[styles.brandTile, { backgroundColor: palette.accent }]}
              >
                <Text
                  style={[styles.brandLetter, { color: palette.accentText }]}
                >
                  {brandLetter}
                </Text>
              </View>
            )}
            <View style={styles.brandTextCol}>
              <Text
                style={[styles.brandKicker, { color: palette.tertiaryText }]}
              >
                Presented by
              </Text>
              <Text style={[styles.brandName, { color: palette.primaryText }]}>
                {brand?.displayName ?? "Brand"}
              </Text>
            </View>
            {callbacks.onOpenBrand !== undefined ? (
              <Text style={[styles.brandCta, { color: palette.accent }]}>
                View
              </Text>
            ) : null}
          </Pressable>

          {/* Venue card — honors hideAddressUntilTicket */}
          {event.format !== "online" && event.venueName !== null ? (
            <Pressable
              onPress={() => {
                if (venueMapsQuery !== null)
                  callbacks.onOpenMaps?.(venueMapsQuery);
              }}
              disabled={!canOpenVenueMaps}
              accessibilityRole={canOpenVenueMaps ? "button" : undefined}
              accessibilityLabel={
                canOpenVenueMaps
                  ? `Open ${event.venueName} in maps`
                  : event.venueName
              }
              accessibilityHint={
                canOpenVenueMaps
                  ? "Opens this event location in your maps app"
                  : undefined
              }
              style={({ pressed }) => [
                styles.venueCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.cutoutBorder,
                },
                canOpenVenueMaps && styles.venueCardInteractive,
                pressed && styles.venueCardPressed,
              ]}
            >
              <View style={styles.venueRow}>
                <View
                  style={[
                    styles.venueIconDisk,
                    { backgroundColor: palette.accent },
                  ]}
                >
                  <Text
                    style={[styles.venueIcon, { color: palette.accentText }]}
                  >
                    ⌖
                  </Text>
                </View>
                <View style={styles.venueTextCol}>
                  <Text
                    style={[styles.venueName, { color: palette.primaryText }]}
                  >
                    {event.venueName}
                  </Text>
                  <Text
                    style={[
                      styles.venueAddress,
                      { color: palette.secondaryText },
                    ]}
                  >
                    {venueAddressLabel}
                  </Text>
                </View>
                {canOpenVenueMaps ? (
                  <View
                    style={[
                      styles.venueMapsPill,
                      {
                        backgroundColor: palette.accent,
                        borderColor: palette.accentText,
                        shadowColor: palette.accent,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.venueMapsText,
                        { color: palette.accentText },
                      ]}
                    >
                      Open maps
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ) : event.format === "online" ? (
            <View
              style={[
                styles.venueCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.cutoutBorder,
                },
              ]}
            >
              <View style={styles.venueRow}>
                <View
                  style={[
                    styles.venueIconDisk,
                    { backgroundColor: palette.accent },
                  ]}
                >
                  <Text
                    style={[styles.venueIcon, { color: palette.accentText }]}
                  >
                    ◯
                  </Text>
                </View>
                <View style={styles.venueTextCol}>
                  <Text
                    style={[styles.venueName, { color: palette.primaryText }]}
                  >
                    Online
                  </Text>
                  <Text
                    style={[
                      styles.venueAddress,
                      { color: palette.secondaryText },
                    ]}
                  >
                    Conferencing link shared with ticketed guests.
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* About */}
          <Text
            style={[
              styles.sectionTitle,
              {
                color: palette.primaryText,
                fontFamily: theme.fontFamilyValue,
              },
            ]}
          >
            About
          </Text>
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            {event.description.length > 0
              ? event.description
              : "Details coming soon."}
          </Text>

          {/* Tickets */}
          <Text
            style={[
              styles.sectionTitle,
              {
                color: palette.primaryText,
                fontFamily: theme.fontFamilyValue,
              },
            ]}
          >
            Tickets
          </Text>
          {visibleTickets.length === 0 ? (
            <View
              style={[
                styles.emptyTicketsCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.cutoutBorder,
                },
              ]}
            >
              <Text
                style={[styles.aboutBody, { color: palette.secondaryText }]}
              >
                No tickets available yet.
              </Text>
            </View>
          ) : (
            <View style={styles.ticketsCol}>
              {visibleTickets.map((t) => (
                <PublicTicketRow
                  key={t.id}
                  ticket={t}
                  variant={variant}
                  fallbackCurrency={event.currency}
                  callbacks={callbacks}
                  theme={theme}
                  palette={palette}
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
  ticket: PublicTicketProps;
  variant: "published" | "pre-sale" | "sold-out" | "past";
  fallbackCurrency: string;
  callbacks: PublicEventPageProps["callbacks"];
  theme: ResolvedTheme;
  palette: ThemePalette;
}

const PublicTicketRow: React.FC<PublicTicketRowProps> = ({
  ticket,
  variant,
  fallbackCurrency,
  callbacks,
  theme,
  palette,
}) => {
  const priceLabel = formatTicketPrice(ticket, fallbackCurrency);
  const isVisDisabled = ticket.visibility === "disabled";
  const saleEnded =
    ticket.saleEndAt !== null &&
    Number.isFinite(new Date(ticket.saleEndAt).getTime()) &&
    new Date(ticket.saleEndAt).getTime() <= Date.now();
  const isSoldOutTicket = !ticket.isUnlimited && (ticket.capacity ?? 0) === 0;
  const isDoorOnly = ticket.availableAt === "door";

  const handleTap = (): void => {
    if (variant === "past" || isVisDisabled || saleEnded) return;
    if (isDoorOnly) return;
    if (variant === "pre-sale") return;
    if (isSoldOutTicket && ticket.waitlistEnabled) {
      callbacks.onJoinWaitlist(ticket.id);
      return;
    }
    if (isSoldOutTicket) return;
    if (ticket.approvalRequired) {
      callbacks.onRequestApproval(ticket.id);
      return;
    }
    if (ticket.isFree) {
      callbacks.onClaimFreeTicket(ticket.id);
      return;
    }
    callbacks.onBuyTicket(ticket.id);
  };

  const effectiveLabel: string = (() => {
    if (variant === "past") return "Sales ended";
    if (saleEnded) return "Sales ended";
    if (variant === "pre-sale") return "On sale soon";
    if (isVisDisabled) return "Sales paused";
    if (isDoorOnly) return "Pay at the door";
    if (isSoldOutTicket && ticket.waitlistEnabled) return "Join waitlist";
    if (isSoldOutTicket) return "Sold out";
    if (ticket.approvalRequired) return "Request approval";
    if (ticket.isFree) return "Get free ticket";
    return "Buy ticket";
  })();

  const isButtonDisabled =
    variant === "past" ||
    saleEnded ||
    variant === "pre-sale" ||
    isVisDisabled ||
    isDoorOnly ||
    (isSoldOutTicket && !ticket.waitlistEnabled);

  const capacityLabel = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? `${ticket.capacity} available`
      : "Available";

  return (
    <View
      style={[
        styles.ticketCard,
        {
          backgroundColor: palette.card,
          borderColor: palette.cutoutBorder,
        },
        isVisDisabled && styles.ticketCardDisabled,
      ]}
    >
      <View
        pointerEvents="none"
        style={[styles.ticketCardAccent, { backgroundColor: palette.accent }]}
      />
      <View style={styles.ticketHeaderRow}>
        <View style={styles.ticketTextCol}>
          <Text style={[styles.ticketName, { color: palette.primaryText }]}>
            {ticket.name}
          </Text>
          {ticket.description !== null && ticket.description.length > 0 ? (
            <Text
              style={[
                styles.ticketDescription,
                { color: palette.secondaryText },
              ]}
            >
              {ticket.description}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.ticketPricePill,
            {
              backgroundColor: palette.accentWash,
              borderColor: palette.panelBorder,
            },
          ]}
        >
          <Text style={[styles.ticketPrice, { color: palette.primaryText }]}>
            {priceLabel}
          </Text>
        </View>
      </View>
      <View style={styles.ticketFooterRow}>
        <Text style={[styles.ticketSub, { color: palette.tertiaryText }]}>
          {capacityLabel}
        </Text>
        <Pressable
          onPress={handleTap}
          disabled={isButtonDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: isButtonDisabled }}
          accessibilityLabel={effectiveLabel}
          style={[
            styles.ticketBuyerBtn,
            {
              backgroundColor: palette.accent,
              borderColor: palette.accentText,
              shadowColor: palette.accent,
            },
            isButtonDisabled && styles.ticketBuyerBtnDisabled,
            isButtonDisabled && {
              backgroundColor: palette.panel,
              borderColor: palette.cutoutBorder,
              shadowOpacity: 0,
            },
          ]}
        >
          <Text
            style={[
              styles.ticketBuyerBtnLabel,
              {
                color: palette.accentText,
                fontFamily: theme.fontFamilyValue,
              },
              isButtonDisabled && { color: palette.tertiaryText },
            ]}
          >
            {effectiveLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

// ---- CancelledVariant -----------------------------------------------

interface CancelledVariantProps {
  event: PublicEventProps;
  brand: PublicEventPageProps["brand"];
}

const CancelledVariant: React.FC<CancelledVariantProps> = ({
  event,
  brand,
}) => (
  <View style={styles.cancelledHost}>
    <View style={styles.cancelledIconWrap}>
      <Text style={styles.cancelledIcon}>!</Text>
    </View>
    <Text style={styles.cancelledTitle}>This event has been cancelled</Text>
    <Text style={styles.cancelledEventName}>{event.name}</Text>
    <Text style={styles.cancelledBody}>
      {brand?.displayName ?? "The organiser"} has cancelled this event. If you
      purchased tickets, you will receive refund details by email.
    </Text>
  </View>
);

// ---- PasswordGateVariant --------------------------------------------

interface PasswordGateVariantProps {
  event: PublicEventProps;
  onUnlock: (password: string) => void;
}

const PasswordGateVariant: React.FC<PasswordGateVariantProps> = ({
  event,
  onUnlock,
}) => {
  const [password, setPassword] = useState<string>("");
  const [errored, setErrored] = useState<boolean>(false);

  const handleSubmit = useCallback((): void => {
    if (password.length === 0) return;
    onUnlock(password);
    setErrored(true);
    setPassword("");
  }, [password, onUnlock]);

  return (
    <View style={styles.gateHost}>
      <View style={styles.gateCard}>
        <Text style={styles.gateIcon}>🔒</Text>
        <Text style={styles.gateTitle}>This event requires a password</Text>
        <Text style={styles.gateBody}>
          Enter the password to view ticket options for {event.name}.
        </Text>
        <View
          style={[styles.gateInputWrap, errored && styles.gateInputWrapError]}
        >
          <TextInput
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (errored) setErrored(false);
            }}
            placeholder="Password"
            placeholderTextColor={text.quaternary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.gateInput}
            accessibilityLabel="Event password"
            onSubmitEditing={handleSubmit}
          />
        </View>
        {errored ? (
          <Text style={styles.gateError}>
            Wrong password. Try again or contact the organiser.
          </Text>
        ) : null}
        <Pressable
          onPress={handleSubmit}
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
      </View>
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor,
  },

  // Floating chrome
  floatingChrome: {
    position: "absolute",
    top: Platform.OS === "web" ? spacing.md : spacing.xl + spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
  },
  chromeIcon: {
    color: text.primary,
    fontSize: 20,
    fontWeight: "600",
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
  heroImage: {
    width: "100%",
    height: 380,
  },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  coverCreditBadge: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.sm,
    maxWidth: "70%",
    borderRadius: 999,
    backgroundColor: "rgba(0, 0, 0, 0.48)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  coverCreditText: {
    color: text.inverse,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
  },

  // State banner
  stateBannerWrap: {
    position: "absolute",
    top: Platform.OS === "web" ? 56 + spacing.md : 56 + spacing.xl + spacing.md,
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
    color: text.primary,
  },

  // Scroll body
  scroll: {
    flex: 1,
    zIndex: 2,
  },
  scrollContent: {
    paddingTop: 288,
    paddingBottom: spacing.xl * 2,
  },
  bodyContent: {
    position: "relative",
    overflow: "hidden",
    alignSelf: "center",
    width: "100%",
    maxWidth: 660,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "rgba(5, 7, 11, 0.96)",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 7,
  },
  bodyGlassLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bodyContentMuted: {
    opacity: 0.7,
  },

  // Title block
  titleBlock: {
    marginBottom: spacing.md,
  },
  titleBlockText: {
    flex: 1,
  },
  dateLine: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 8,
  },
  titleLine: {
    fontSize: 36,
    lineHeight: 41,
    fontWeight: "900",
    color: text.primary,
    marginBottom: spacing.sm,
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
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
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  expandedDateText: {
    fontSize: typography.bodySm.fontSize,
    color: text.primary,
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

  // Brand chip
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    marginBottom: spacing.lg,
  },
  brandRowInteractive: {
    borderRadius: radius.lg,
  },
  brandRowPressed: {
    opacity: 0.72,
  },
  brandTile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  brandPhoto: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.26)",
  },
  brandLetter: {
    fontWeight: "900",
    fontSize: 17,
    color: "#fff",
  },
  brandTextCol: {
    flex: 1,
    minWidth: 0,
  },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: text.tertiary,
    marginBottom: 2,
  },
  brandName: {
    fontSize: 16,
    fontWeight: "800",
    color: text.primary,
  },
  brandCta: {
    marginLeft: "auto",
    color: accent.warm,
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
  },

  // Venue card
  venueCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  venueCardInteractive: {
    borderColor: "rgba(255,255,255,0.32)",
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  venueCardPressed: {
    opacity: 0.74,
  },
  venueRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  venueIconDisk: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  venueIcon: {
    fontSize: 18,
    color: "#ffffff",
    width: 20,
    textAlign: "center",
    lineHeight: 22,
  },
  venueTextCol: {
    flex: 1,
    minWidth: 0,
  },
  venueName: {
    fontSize: 15,
    fontWeight: "800",
    color: text.primary,
  },
  venueAddress: {
    fontSize: 12,
    color: text.secondary,
    marginTop: 2,
  },
  venueMapsPill: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: accent.warm,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  venueMapsText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  sectionTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900",
    color: text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  aboutBody: {
    fontSize: 15,
    color: text.secondary,
    lineHeight: 24,
  },

  // Tickets
  emptyTicketsCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  ticketsCol: {
    gap: spacing.md,
  },
  ticketCard: {
    position: "relative",
    overflow: "hidden",
    padding: spacing.md,
    paddingTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.24)",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
  ticketCardAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  ticketCardDisabled: {
    opacity: 0.5,
  },
  ticketHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  ticketTextCol: {
    flex: 1,
    minWidth: 0,
  },
  ticketName: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    color: text.primary,
  },
  ticketDescription: {
    fontSize: typography.caption.fontSize,
    color: text.secondary,
    marginTop: 4,
    lineHeight: typography.caption.lineHeight * 1.4,
  },
  ticketSub: {
    fontSize: 11,
    color: text.tertiary,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    flex: 1,
  },
  ticketFooterRow: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  ticketBuyerBtn: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    borderRadius: radius.lg,
    backgroundColor: accent.tint,
    borderWidth: 2,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: accent.warm,
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  ticketBuyerBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  ticketBuyerBtnLabel: {
    fontSize: 17,
    fontWeight: "900",
    color: accent.warm,
    letterSpacing: 0.5,
  },
  ticketBuyerBtnLabelDisabled: {
    color: text.tertiary,
  },
  ticketPricePill: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  ticketPrice: {
    fontSize: 14,
    fontWeight: "900",
    color: text.primary,
  },

  // Cancelled
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
  cancelledIcon: {
    fontSize: 32,
    fontWeight: "700",
    color: semantic.error,
  },
  cancelledTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: text.primary,
    textAlign: "center",
  },
  cancelledEventName: {
    fontSize: 16,
    color: text.secondary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  cancelledBody: {
    fontSize: 14,
    color: text.tertiary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },

  // Password gate
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
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  gateIcon: {
    fontSize: 28,
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: text.primary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  gateBody: {
    fontSize: 14,
    color: text.secondary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  gateInputWrap: {
    width: "100%",
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
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
    color: text.primary,
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
    borderRadius: radius.md,
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
});
