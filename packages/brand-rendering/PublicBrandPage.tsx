import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import {
  AtSign,
  Facebook,
  Globe2,
  Instagram,
  Linkedin,
  Music2,
  X as XIcon,
  Youtube,
} from "lucide-react-native";
import {
  MINGLA_DEFAULT_THEME,
  ThemeEntranceAnimation,
  resolveTheme,
  type ResolvedTheme,
} from "@mingla/event-rendering";

import { accent, backgroundColor, radius, spacing, text } from "./designTokens";
import type {
  PublicBrand,
  PublicBrandEvent,
  PublicBrandExperience,
  PublicBrandPageProps,
  PublicBrandTicket,
  PublicBrandTrip,
  PublicBrandUpcoming,
} from "./types";

type Tab = "upcoming" | "events" | "trips" | "experiences" | "about";
type SocialKind =
  | "website"
  | "instagram"
  | "tiktok"
  | "x"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "threads";

const PINNED_CTA_CARD_COUNT = 3;

type ThemePalette = {
  page: string;
  accent: string;
  accentText: string;
  pageWash: string;
  heroScrim: string;
  heroLift: string;
  primaryText: string;
  secondaryText: string;
  tertiaryText: string;
  mutedText: string;
  panel: string;
  panelStrong: string;
  panelBorder: string;
  card: string;
  cardBorder: string;
  tabBand: string;
  tabBorder: string;
  accentWash: string;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const normalizeSocialUrl = (raw: string, base: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return `${base}${handle}`;
};

const formatCurrencyRound = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
};

const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

const formatTripDateRange = (
  startAtIso: string | null,
  endAtIso: string | null,
  timezone: string | null,
): string => {
  if (startAtIso === null) return "";
  const tz = timezone ?? "UTC";
  const start = new Date(startAtIso);
  if (Number.isNaN(start.getTime())) return "";
  const format = (date: Date, withYear: boolean): string =>
    date.toLocaleDateString("en-GB", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (endAtIso === null) return format(start, true);
  const end = new Date(endAtIso);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return format(start, true);
  }
  return `${format(start, false)} - ${format(end, true)}`;
};

const minPriceLabel = (
  tickets: PublicBrandTicket[],
  fallbackCurrency: string | null | undefined,
): string | null => {
  const visible = tickets.filter((t) => t.visibility !== "hidden");
  const paid = visible
    .map((t) => t.priceGbp ?? null)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  if (paid.length > 0) {
    return `From ${formatCurrencyRound(paid[0], fallbackCurrency ?? "GBP")}`;
  }
  return visible.some((t) => t.isFree === true) ? "Free" : null;
};

const openUrl = (url: string): void => {
  void Linking.openURL(url).catch(() => undefined);
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
  if (contrastRatio(accentColor, background) >= minimumRatio) return accentColor;
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
  const page = mixHexColors(basePage, theme.color, useDark ? 0.10 : 0.035);
  const accentColor = contrastAdjustedForWhiteText(
    contrastAdjustedAccent(theme.color, page, 3.15),
    4.5,
  );
  const accentText = "#ffffff";
  const primaryText = readableTextFor(page);
  const secondaryText =
    primaryText === "#ffffff" ? "rgba(255,255,255,0.78)" : "rgba(16,20,31,0.76)";
  const tertiaryText =
    primaryText === "#ffffff" ? "rgba(255,255,255,0.58)" : "rgba(16,20,31,0.58)";
  const mutedText =
    primaryText === "#ffffff" ? "rgba(255,255,255,0.40)" : "rgba(16,20,31,0.42)";
  return {
    page,
    accent: accentColor,
    accentText,
    pageWash: hexToRgba(theme.color, useDark ? 0.24 : 0.12),
    heroScrim: useDark ? "rgba(4,5,8,0.50)" : "rgba(248,250,252,0.36)",
    heroLift: useDark ? "rgba(7,7,10,0.82)" : "rgba(248,250,252,0.90)",
    primaryText,
    secondaryText,
    tertiaryText,
    mutedText,
    panel: useDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.76)",
    panelStrong: useDark ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.92)",
    panelBorder: hexToRgba(accentColor, useDark ? 0.38 : 0.30),
    card: useDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.84)",
    cardBorder: useDark ? "rgba(255,255,255,0.11)" : "rgba(16,20,31,0.08)",
    tabBand: hexToRgba(accentColor, useDark ? 0.20 : 0.14),
    tabBorder: hexToRgba(accentColor, useDark ? 0.46 : 0.34),
    accentWash: hexToRgba(accentColor, useDark ? 0.24 : 0.18),
  };
};

const tabLabel: Record<Tab, string> = {
  upcoming: "Upcoming",
  events: "Events",
  trips: "Trips",
  experiences: "Experiences",
  about: "About",
};

const SOCIAL_ICON_BY_KIND: Record<SocialKind, LucideIcon> = {
  website: Globe2,
  instagram: Instagram,
  tiktok: Music2,
  x: XIcon,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
  threads: AtSign,
};

export const PublicBrandPage: React.FC<PublicBrandPageProps> = ({
  brand,
  events,
  pastEvents: providedPastEvents,
  trips,
  pastTrips: providedPastTrips,
  experiences = [],
  upcoming = [],
  upcomingHasMore = false,
  venue = null,
  theme,
  hideFloatingChrome = false,
  chromeTopOffset,
  callbacks,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("about");
  const [coverMediaFailed, setCoverMediaFailed] = useState<boolean>(false);
  const resolvedTheme = useMemo<ResolvedTheme>(
    () => theme ?? resolveTheme(brand.theme ?? null, null),
    [brand.theme, theme],
  );

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((event) => event.status !== "ended" && event.status !== "cancelled")
        .slice()
        .sort((a, b) => a.dateLine.localeCompare(b.dateLine)),
    [events],
  );
  const pastEvents = useMemo(
    () =>
      (providedPastEvents ?? events.filter((event) => event.status === "ended"))
        .slice()
        .sort((a, b) => b.dateLine.localeCompare(a.dateLine)),
    [events, providedPastEvents],
  );
  const upcomingTrips = useMemo(
    () =>
      trips
        .filter((t) => t.status === "scheduled" || t.status === "live")
        .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "")),
    [trips],
  );
  const pastTrips = useMemo(
    () =>
      (providedPastTrips ?? trips.filter((t) => t.status === "ended"))
        .slice()
        .sort((a, b) => (b.endAt ?? "").localeCompare(a.endAt ?? "")),
    [providedPastTrips, trips],
  );

  const visibleTabs = useMemo<Tab[]>(() => {
    const tabs: Tab[] = [];
    if (upcoming.length > 0 || upcomingHasMore) tabs.push("upcoming");
    if (upcomingEvents.length > 0 || pastEvents.length > 0) tabs.push("events");
    if (upcomingTrips.length > 0 || pastTrips.length > 0) tabs.push("trips");
    if (experiences.length > 0) tabs.push("experiences");
    tabs.push("about");
    return tabs;
  }, [
    experiences.length,
    pastEvents.length,
    pastTrips.length,
    upcoming.length,
    upcomingEvents.length,
    upcomingHasMore,
    upcomingTrips.length,
  ]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0] ?? "about");
    }
  }, [activeTab, visibleTabs]);

  const heroColor =
    resolvedTheme.color === MINGLA_DEFAULT_THEME.color && brand.coverHue !== 25
      ? `hsl(${brand.coverHue}, 60%, 45%)`
      : resolvedTheme.color;
  const palette = useMemo(() => createThemePalette(resolvedTheme), [resolvedTheme]);
  const themedFont = { fontFamily: resolvedTheme.fontFamilyValue };

  const socialEntries = useMemo(() => {
    const links = brand.links;
    if (links === undefined) return [];
    const entries: Array<{ kind: SocialKind; label: string; url: string }> = [];
    if (links.website) {
      entries.push({ kind: "website", label: "Website", url: links.website });
    }
    if (links.instagram) {
      entries.push({
        kind: "instagram",
        label: "Instagram",
        url: normalizeSocialUrl(links.instagram, "https://instagram.com/"),
      });
    }
    if (links.tiktok) {
      entries.push({
        kind: "tiktok",
        label: "TikTok",
        url: normalizeSocialUrl(links.tiktok, "https://tiktok.com/@"),
      });
    }
    if (links.x) {
      entries.push({
        kind: "x",
        label: "X",
        url: normalizeSocialUrl(links.x, "https://x.com/"),
      });
    }
    if (links.facebook) {
      entries.push({
        kind: "facebook",
        label: "Facebook",
        url: normalizeSocialUrl(links.facebook, "https://facebook.com/"),
      });
    }
    if (links.youtube) {
      entries.push({
        kind: "youtube",
        label: "YouTube",
        url: normalizeSocialUrl(links.youtube, "https://youtube.com/@"),
      });
    }
    if (links.linkedin) {
      entries.push({
        kind: "linkedin",
        label: "LinkedIn",
        url: normalizeSocialUrl(links.linkedin, "https://linkedin.com/in/"),
      });
    }
    if (links.threads) {
      entries.push({
        kind: "threads",
        label: "Threads",
        url: normalizeSocialUrl(links.threads, "https://threads.net/@"),
      });
    }
    return entries;
  }, [brand.links]);

  const onExternal = callbacks.onOpenExternal ?? openUrl;
  const countForTab = (tab: Tab): number | undefined => {
    if (tab === "upcoming") return upcoming.length;
    if (tab === "events") return upcomingEvents.length + pastEvents.length;
    if (tab === "trips") return upcomingTrips.length + pastTrips.length;
    if (tab === "experiences") return experiences.length;
    return undefined;
  };

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      {hideFloatingChrome ? null : (
        <View
          style={[
            styles.floatingChrome,
            chromeTopOffset !== undefined ? { top: chromeTopOffset } : null,
          ]}
          pointerEvents="box-none"
        >
          <ChromeButton
            label="Close"
            glyph="x"
            onPress={callbacks.onClose}
            testID="orch-0961-public-brand-close"
          />
          <ChromeButton
            label="Share"
            glyph="share"
            onPress={callbacks.onShare}
            testID="orch-0961-public-brand-share"
          />
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[styles.heroWrap, { backgroundColor: heroColor }]}
          pointerEvents="none"
        >
          {brand.coverMediaUrl !== undefined &&
          brand.coverMediaUrl.length > 0 &&
          !coverMediaFailed ? (
            <Image
              source={{ uri: brand.coverMediaUrl }}
              style={styles.heroGradient}
              resizeMode="cover"
              onError={() => setCoverMediaFailed(true)}
              accessibilityLabel="Brand cover"
            />
          ) : (
            <View style={[styles.heroGradient, { backgroundColor: heroColor }]} />
          )}
          <View style={[styles.heroThemeTint, { backgroundColor: palette.pageWash }]} />
          <View style={[styles.heroFade, { backgroundColor: palette.heroScrim }]} />
        </View>

        <View
          style={[
            styles.identityCentered,
            {
              backgroundColor: palette.heroLift,
              borderColor: palette.panelBorder,
            },
          ]}
        >
          <View style={styles.identityTopRow}>
            <Avatar brand={brand} palette={palette} />
            <View style={styles.identityCopy}>
              {venue?.isVerifiedVenue === true ? (
                <Text style={[styles.verifiedBadge, { color: palette.accent }]}>
                  Verified venue
                </Text>
              ) : null}
              <Text
                style={[
                  styles.brandNameCentered,
                  themedFont,
                  { color: palette.primaryText },
                ]}
              >
                {brand.displayName}
              </Text>
              {brand.address !== null && brand.address.trim().length > 0 ? (
                <Text style={[styles.handleLineCentered, { color: palette.tertiaryText }]}>
                  {brand.address.trim()}
                </Text>
              ) : null}
            </View>
          </View>

          {brand.tagline !== undefined && brand.tagline.trim().length > 0 ? (
            <Text
              style={[styles.taglineCentered, themedFont, { color: palette.primaryText }]}
            >
              {brand.tagline}
            </Text>
          ) : null}
          {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
            <Text style={[styles.bioLeadCentered, { color: palette.secondaryText }]}>
              {brand.bio}
            </Text>
          ) : null}
        </View>

        <SocialLinksRow
          entries={socialEntries}
          palette={palette}
          onPress={onExternal}
        />

        {upcoming.length > 0 ? (
          <NextOfferingTeaser
            item={upcoming[0]}
            theme={resolvedTheme}
            palette={palette}
            onPress={(item) => {
              if (callbacks.onOpenUpcoming !== undefined) {
                callbacks.onOpenUpcoming(item);
              }
            }}
          />
        ) : null}

        <View
          style={[
            styles.tabsRow,
            { backgroundColor: palette.accent, borderColor: palette.accent },
          ]}
        >
          {visibleTabs.map((tab) => (
            <TabButton
              key={tab}
              label={tabLabel[tab]}
              count={countForTab(tab)}
              active={activeTab === tab}
              theme={resolvedTheme}
              palette={palette}
              onPress={() => setActiveTab(tab)}
            />
          ))}
        </View>

        {activeTab === "upcoming" ? (
          <UpcomingList
            rows={upcoming}
            theme={resolvedTheme}
            palette={palette}
            emptyCopy="No upcoming offerings yet"
            onPress={(item) => {
              if (callbacks.onOpenUpcoming !== undefined) {
                callbacks.onOpenUpcoming(item);
              }
            }}
          />
        ) : activeTab === "events" ? (
          <EventList
            events={upcomingEvents}
            pastEvents={pastEvents}
            theme={resolvedTheme}
            palette={palette}
            emptyCopy="No public events yet"
            onPress={callbacks.onOpenEvent}
          />
        ) : activeTab === "trips" ? (
          <TripList
            trips={upcomingTrips}
            pastTrips={pastTrips}
            theme={resolvedTheme}
            palette={palette}
            emptyCopy="No public trips yet"
            onPress={callbacks.onOpenTrip}
          />
        ) : activeTab === "experiences" ? (
          <ExperienceList
            experiences={experiences}
            theme={resolvedTheme}
            palette={palette}
            emptyCopy="No public experiences yet"
            onPress={callbacks.onOpenExperience}
          />
        ) : (
          <AboutTab
            brand={brand}
            theme={resolvedTheme}
            palette={palette}
            onExternal={onExternal}
          />
        )}
      </ScrollView>

      <ThemeEntranceAnimation
        theme={resolvedTheme}
        sessionKey={`brand:${brand.slug}:${resolvedTheme.color}:${resolvedTheme.font}`}
        replayOnMount
      />
    </View>
  );
};

const ChromeButton: React.FC<{
  label: string;
  glyph: "x" | "share";
  onPress: () => void;
  testID: string;
}> = ({ label, glyph, onPress, testID }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    testID={testID}
    hitSlop={8}
    style={styles.chromeButton}
  >
    <ChromeGlyph glyph={glyph} />
  </Pressable>
);

const ChromeGlyph: React.FC<{ glyph: "x" | "share" }> = ({ glyph }) => (
  <View style={styles.chromeGlyph} pointerEvents="none">
    {glyph === "x" ? (
      <>
        <View style={[styles.chromeXStroke, styles.chromeXStrokeA]} />
        <View style={[styles.chromeXStroke, styles.chromeXStrokeB]} />
      </>
    ) : (
      <>
        <View style={[styles.chromeShareLine, styles.chromeShareLineTop]} />
        <View style={[styles.chromeShareLine, styles.chromeShareLineBottom]} />
        <View style={[styles.chromeShareDot, styles.chromeShareDotLeft]} />
        <View style={[styles.chromeShareDot, styles.chromeShareDotTop]} />
        <View style={[styles.chromeShareDot, styles.chromeShareDotBottom]} />
      </>
    )}
  </View>
);

const Avatar: React.FC<{
  brand: PublicBrand;
  palette: ThemePalette;
}> = ({ brand, palette }) => {
  const avatarStyle = [
    styles.avatar,
    {
      backgroundColor: palette.panelStrong,
      borderColor: palette.accent,
      shadowColor: palette.accent,
    },
  ];
  if (brand.photo !== undefined && brand.photo.length > 0) {
    return (
      <Image
        source={{ uri: brand.photo }}
        style={avatarStyle}
        resizeMode="cover"
        accessibilityLabel={`${brand.displayName} avatar`}
      />
    );
  }
  return (
    <View style={avatarStyle}>
      <Text style={[styles.avatarInitial, { color: palette.primaryText }]}>
        {(brand.displayName.charAt(0) || "?").toUpperCase()}
      </Text>
    </View>
  );
};

const SocialLinksRow: React.FC<{
  entries: Array<{ kind: SocialKind; label: string; url: string }>;
  palette: ThemePalette;
  onPress: (url: string) => void;
}> = ({ entries, palette, onPress }) => {
  if (entries.length === 0) return null;
  return (
    <View style={styles.socialsRowCompact}>
      {entries.map((entry) => (
        <Pressable
          key={entry.url}
          onPress={() => onPress(entry.url)}
          accessibilityRole="link"
          accessibilityLabel={entry.label}
          style={[
            styles.socialBtnIconOnly,
            { backgroundColor: palette.accent, borderColor: palette.accent },
          ]}
        >
          <SocialIcon kind={entry.kind} color="#ffffff" />
        </Pressable>
      ))}
    </View>
  );
};

const SocialIcon: React.FC<{ kind: SocialKind; color: string }> = ({
  kind,
  color,
}) => {
  const Icon = SOCIAL_ICON_BY_KIND[kind];
  return <Icon color={color} size={23} strokeWidth={2.35} />;
};

const TabButton: React.FC<{
  label: string;
  count?: number;
  active: boolean;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress: () => void;
}> = ({ label, count, active, theme, palette, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[
      styles.tabButton,
      active && styles.tabButtonActive,
    ]}
  >
    <Text
      style={[
        styles.tabLabel,
        { fontFamily: theme.fontFamilyValue },
        { color: "#ffffff" },
        active && styles.tabLabelActive,
      ]}
    >
      {label}
      {count !== undefined ? (
        <Text
          style={styles.tabCount}
        >
          {" "}
          {count}
        </Text>
      ) : null}
    </Text>
  </Pressable>
);

const EventList: React.FC<{
  events: PublicBrandEvent[];
  pastEvents?: PublicBrandEvent[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  emptyCopy: string;
  onPress: (event: PublicBrandEvent) => void;
}> = ({ events, pastEvents = [], theme, palette, emptyCopy, onPress }) => {
  if (events.length === 0 && pastEvents.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={[styles.emptyTabTitle, { color: palette.secondaryText }]}>
          {emptyCopy}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {events.map((event, index) => (
        <EventMiniCard
          key={event.id}
          event={event}
          theme={theme}
          palette={palette}
          onPress={onPress}
          pinCta={index < PINNED_CTA_CARD_COUNT}
        />
      ))}
      {pastEvents.map((event) => (
        <EventMiniCard
          key={event.id}
          event={event}
          theme={theme}
          palette={palette}
          onPress={onPress}
          past
        />
      ))}
    </View>
  );
};

const EventMiniCard: React.FC<{
  event: PublicBrandEvent;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress: (event: PublicBrandEvent) => void;
  pinCta?: boolean;
  past?: boolean;
}> = ({ event, theme, palette, onPress, pinCta = false, past = false }) => {
  const price = minPriceLabel(event.tickets, event.currency);
  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`Open event ${event.name}`}
      style={({ pressed }) => [
        styles.eventCard,
        { backgroundColor: palette.card, borderColor: palette.cardBorder },
        past && styles.eventCardPast,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={event.coverHue}
        mediaUrl={event.coverMediaUrl}
        mediaType={event.coverMediaType}
      />
      <View style={styles.eventBody}>
        <Text style={[styles.eventDate, { color: palette.accent }]}>
          {event.dateLine}
        </Text>
        <Text
          style={[
            styles.eventTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
        {event.venueName !== null && event.venueName.length > 0 ? (
          <Text style={[styles.eventVenue, { color: palette.tertiaryText }]} numberOfLines={1}>
            {event.venueName}
          </Text>
        ) : event.format === "online" || event.format === "hybrid" ? (
          <Text style={[styles.eventVenue, { color: palette.tertiaryText }]}>
            Online event
          </Text>
        ) : null}
        {price !== null ? (
          <Text style={[styles.eventPrice, { color: palette.primaryText }]}>{price}</Text>
        ) : null}
        {pinCta ? (
          <View style={[styles.eventBuyPill, { backgroundColor: palette.accent }]}>
            <Text
              style={[
                styles.eventBuyPillLabel,
                { color: palette.accentText },
              ]}
            >
              Buy tickets
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

const NextOfferingTeaser: React.FC<{
  item: PublicBrandUpcoming;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress: (item: PublicBrandUpcoming) => void;
}> = ({ item, theme, palette, onPress }) => {
  const price = offeringPriceLabel(item);
  const dateLine = formatUpcomingDateLine(item.startsAt);
  const bodyText =
    price !== null
      ? `${dateLine} - ${item.name} - ${price}`
      : `${dateLine} - ${item.name}`;
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Next offering ${item.name}`}
      style={({ pressed }) => [
        styles.nextTeaser,
        { backgroundColor: palette.accent, borderColor: palette.accent },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.nextTeaserCopy}>
        <Text style={styles.nextTeaserLabel}>NEXT EVENT</Text>
        <Text
          style={[
            styles.nextTeaserBody,
            { fontFamily: theme.fontFamilyValue },
          ]}
          numberOfLines={2}
        >
          {bodyText}
        </Text>
      </View>
      <View style={styles.nextTeaserAction}>
        <Text style={styles.nextTeaserActionText}>View</Text>
      </View>
    </Pressable>
  );
};

const TripList: React.FC<{
  trips: PublicBrandTrip[];
  pastTrips?: PublicBrandTrip[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  emptyCopy: string;
  onPress: (trip: PublicBrandTrip) => void;
}> = ({ trips, pastTrips = [], theme, palette, emptyCopy, onPress }) => {
  if (trips.length === 0 && pastTrips.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={[styles.emptyTabTitle, { color: palette.secondaryText }]}>
          {emptyCopy}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {trips.map((trip) => (
        <TripMiniCard
          key={trip.id}
          trip={trip}
          theme={theme}
          palette={palette}
          onPress={onPress}
        />
      ))}
      {pastTrips.map((trip) => (
        <TripMiniCard
          key={trip.id}
          trip={trip}
          theme={theme}
          palette={palette}
          onPress={onPress}
          past
        />
      ))}
    </View>
  );
};

const TripMiniCard: React.FC<{
  trip: PublicBrandTrip;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress: (trip: PublicBrandTrip) => void;
  past?: boolean;
}> = ({ trip, theme, palette, onPress, past = false }) => {
  const dateLine = formatTripDateRange(trip.startAt, trip.endAt, trip.timezone);
  const price =
    trip.minPriceCents !== null && trip.currency !== null
      ? `From ${formatCurrencyRound(trip.minPriceCents / 100, trip.currency)}`
      : trip.hasFreeTier
        ? "Free"
        : null;
  const spotsLabel =
    trip.spotsLeft === null
      ? null
      : trip.spotsLeft === 0
        ? "Sold out"
        : trip.spotsLeft <= 5
          ? `${trip.spotsLeft} ${trip.spotsLeft === 1 ? "spot" : "spots"} left`
          : null;

  return (
    <Pressable
      onPress={() => onPress(trip)}
      accessibilityRole="button"
      accessibilityLabel={`Open trip ${trip.title}`}
      style={({ pressed }) => [
        styles.eventCard,
        { backgroundColor: palette.card, borderColor: palette.cardBorder },
        past && styles.eventCardPast,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(trip.id)}
        mediaUrl={trip.coverMediaUrl}
        mediaType={trip.coverMediaType}
      />
      <View style={styles.eventBody}>
        {dateLine.length > 0 ? (
          <Text style={[styles.eventDate, { color: palette.accent }]}>
            {dateLine}
          </Text>
        ) : null}
        <Text
          style={[
            styles.eventTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {trip.title.length > 0 ? trip.title : "Untitled trip"}
        </Text>
        {trip.destinationText !== null && trip.destinationText.length > 0 ? (
          <Text style={[styles.eventVenue, { color: palette.tertiaryText }]} numberOfLines={1}>
            {trip.destinationText}
          </Text>
        ) : null}
        <View style={styles.tripFooterRow}>
          {price !== null ? (
            <Text style={[styles.eventPrice, { color: palette.primaryText }]}>{price}</Text>
          ) : (
            <View />
          )}
          {trip.bookingsClosed ? (
            <View
              style={[
                styles.tripBadgeClosed,
                { backgroundColor: palette.panel, borderColor: palette.cardBorder },
              ]}
            >
              <Text style={[styles.tripBadgeLabel, { color: palette.primaryText }]}>
                Booking closed
              </Text>
            </View>
          ) : spotsLabel !== null ? (
            <View
              style={[
                styles.tripBadgeScarce,
                { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
              ]}
            >
              <Text style={[styles.tripBadgeLabel, { color: palette.primaryText }]}>
                {spotsLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

const offeringPriceLabel = (item: {
  isFree?: boolean;
  priceFromMinorUnits?: number | null;
  currency?: string | null;
}): string | null => {
  if (item.priceFromMinorUnits !== null && item.priceFromMinorUnits !== undefined) {
    return `From ${formatCurrencyRound(
      item.priceFromMinorUnits / 100,
      item.currency ?? "USD",
    )}`;
  }
  return item.isFree === true ? "Free" : null;
};

const formatUpcomingDateLine = (startsAt: string | null): string => {
  if (startsAt === null) return "Date TBA";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const UpcomingList: React.FC<{
  rows: PublicBrandUpcoming[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  emptyCopy: string;
  onPress: (item: PublicBrandUpcoming) => void;
}> = ({ rows, theme, palette, emptyCopy, onPress }) => {
  if (rows.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={[styles.emptyTabTitle, { color: palette.secondaryText }]}>
          {emptyCopy}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {rows.map((item) => (
        <OfferingMiniCard
          key={`${item.offeringType}:${item.offeringId}`}
          item={item}
          theme={theme}
          palette={palette}
          onPress={onPress}
        />
      ))}
    </View>
  );
};

const OfferingMiniCard: React.FC<{
  item: PublicBrandUpcoming;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress: (item: PublicBrandUpcoming) => void;
}> = ({ item, theme, palette, onPress }) => {
  const price = offeringPriceLabel(item);
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.offeringType} ${item.name}`}
      style={({ pressed }) => [
        styles.eventCard,
        { backgroundColor: palette.card, borderColor: palette.cardBorder },
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(item.offeringId)}
        mediaUrl={item.coverMediaUrl}
        mediaType={item.coverMediaType}
      />
      <View style={styles.eventBody}>
        <Text style={[styles.eventDate, { color: palette.accent }]}>
          {formatUpcomingDateLine(item.startsAt)}
        </Text>
        <Text
          style={[
            styles.eventTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {item.name.length > 0 ? item.name : "Untitled offering"}
        </Text>
        <Text style={[styles.eventVenue, { color: palette.tertiaryText }]}>
          {item.offeringType}
        </Text>
        {price !== null ? (
          <Text style={[styles.eventPrice, { color: palette.primaryText }]}>{price}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const ExperienceList: React.FC<{
  experiences: PublicBrandExperience[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  emptyCopy: string;
  onPress?: (experience: PublicBrandExperience) => void;
}> = ({ experiences, theme, palette, emptyCopy, onPress }) => {
  if (experiences.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={[styles.emptyTabTitle, { color: palette.secondaryText }]}>
          {emptyCopy}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {experiences.map((experience) => (
        <ExperienceMiniCard
          key={experience.experienceId}
          experience={experience}
          theme={theme}
          palette={palette}
          onPress={onPress}
        />
      ))}
    </View>
  );
};

const ExperienceMiniCard: React.FC<{
  experience: PublicBrandExperience;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onPress?: (experience: PublicBrandExperience) => void;
}> = ({ experience, theme, palette, onPress }) => {
  const price = offeringPriceLabel(experience);
  return (
    <Pressable
      onPress={() => onPress?.(experience)}
      accessibilityRole="button"
      accessibilityLabel={`Open experience ${experience.name}`}
      style={({ pressed }) => [
        styles.eventCard,
        { backgroundColor: palette.card, borderColor: palette.cardBorder },
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(experience.experienceId)}
        mediaUrl={experience.coverMediaUrl}
        mediaType="image"
      />
      <View style={styles.eventBody}>
        {experience.nextOccurrenceAt !== null ? (
          <Text style={[styles.eventDate, { color: palette.accent }]}>
            {formatUpcomingDateLine(experience.nextOccurrenceAt)}
          </Text>
        ) : null}
        <Text
          style={[
            styles.eventTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {experience.name.length > 0 ? experience.name : "Untitled experience"}
        </Text>
        {experience.venueText !== null && experience.venueText.length > 0 ? (
          <Text style={[styles.eventVenue, { color: palette.tertiaryText }]} numberOfLines={1}>
            {experience.venueText}
          </Text>
        ) : null}
        {price !== null ? (
          <Text style={[styles.eventPrice, { color: palette.primaryText }]}>{price}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const CoverBlock: React.FC<{
  hue: number;
  mediaUrl: string | null;
  mediaType: string | null;
}> = ({ hue, mediaUrl, mediaType }) => {
  if (
    mediaUrl !== null &&
    mediaUrl.length > 0 &&
    (mediaType === "image" || mediaType === "gif")
  ) {
    return (
      <Image
        source={{ uri: mediaUrl }}
        style={styles.eventCover}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.eventCover,
        { backgroundColor: `hsl(${hue}, 60%, 45%)` },
      ]}
    />
  );
};

const AboutTab: React.FC<{
  brand: PublicBrand;
  theme: ResolvedTheme;
  palette: ThemePalette;
  onExternal: (url: string) => void;
}> = ({ brand, theme, palette, onExternal }) => (
  <View style={styles.aboutWrap}>
    {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
      <View
        style={[
          styles.aboutBlock,
          { backgroundColor: palette.panel, borderColor: palette.cardBorder },
        ]}
      >
        <Text
          style={[
            styles.aboutBlockLabel,
            { fontFamily: theme.fontFamilyValue, color: palette.tertiaryText },
          ]}
        >
          About
        </Text>
        <Text style={[styles.aboutBlockBody, { color: palette.secondaryText }]}>
          {brand.bio}
        </Text>
      </View>
    ) : null}
    {brand.contact?.email !== undefined || brand.contact?.phone !== undefined ? (
      <View
        style={[
          styles.aboutBlock,
          { backgroundColor: palette.panel, borderColor: palette.cardBorder },
        ]}
      >
        <Text
          style={[
            styles.aboutBlockLabel,
            { fontFamily: theme.fontFamilyValue, color: palette.tertiaryText },
          ]}
        >
          Contact
        </Text>
        {brand.contact?.email !== undefined ? (
          <Pressable onPress={() => onExternal(`mailto:${brand.contact?.email}`)}>
            <Text style={[styles.aboutContactLink, { color: palette.accent }]}>
              {brand.contact.email}
            </Text>
          </Pressable>
        ) : null}
        {brand.contact?.phone !== undefined ? (
          <Pressable onPress={() => onExternal(`tel:${brand.contact?.phone}`)}>
            <Text style={[styles.aboutContactLink, { color: palette.accent }]}>
              {brand.contact.phone}
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor,
  },
  heroWrap: {
    height: 264,
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  heroFade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(12,14,18,0.30)",
  },
  heroThemeTint: {
    ...StyleSheet.absoluteFillObject,
  },
  floatingChrome: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 4,
    elevation: 8,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
  },
  chromeGlyph: {
    width: 18,
    height: 18,
  },
  chromeXStroke: {
    position: "absolute",
    top: 8,
    left: 2,
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: text.primary,
  },
  chromeXStrokeA: {
    transform: [{ rotate: "45deg" }],
  },
  chromeXStrokeB: {
    transform: [{ rotate: "-45deg" }],
  },
  chromeShareLine: {
    position: "absolute",
    left: 5,
    width: 9,
    height: 2,
    borderRadius: 1,
    backgroundColor: text.primary,
  },
  chromeShareLineTop: {
    top: 6,
    transform: [{ rotate: "-24deg" }],
  },
  chromeShareLineBottom: {
    top: 11,
    transform: [{ rotate: "24deg" }],
  },
  chromeShareDot: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: text.primary,
  },
  chromeShareDotLeft: {
    left: 1,
    top: 7,
  },
  chromeShareDotTop: {
    right: 1,
    top: 2,
  },
  chromeShareDotBottom: {
    right: 1,
    bottom: 2,
  },
  scroll: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingTop: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  identityCentered: {
    alignItems: "stretch",
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 3,
  },
  identityTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.20)",
    marginTop: 0,
    shadowOpacity: 0.26,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  avatarInitial: {
    color: text.primary,
    fontSize: 38,
    fontWeight: "900",
  },
  brandNameCentered: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "900",
    color: text.primary,
    marginTop: spacing.xs,
    textAlign: "left",
  },
  verifiedBadge: {
    color: accent.warm,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  handleLineCentered: {
    fontSize: 14,
    lineHeight: 19,
    color: text.tertiary,
    marginTop: spacing.xs,
    textAlign: "left",
  },
  bioLeadCentered: {
    fontSize: 16,
    color: text.secondary,
    lineHeight: 25,
    marginTop: spacing.md,
    textAlign: "left",
  },
  taglineCentered: {
    fontSize: 24,
    fontWeight: "800",
    color: text.tertiary,
    lineHeight: 30,
    marginTop: spacing.lg,
    textAlign: "left",
  },
  socialsRowCompact: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    marginTop: 0,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  socialBtnIconOnly: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  nextTeaser: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    gap: spacing.md,
    minHeight: 86,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: accent.tint,
    borderWidth: 1,
    marginBottom: spacing.lg,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  nextTeaserCopy: {
    flex: 1,
    minWidth: 0,
  },
  nextTeaserLabel: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  nextTeaserBody: {
    fontSize: 18,
    lineHeight: 23,
    color: "#ffffff",
    fontWeight: "800",
    marginTop: 5,
  },
  nextTeaserAction: {
    minWidth: 58,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  nextTeaserActionText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  tabsRow: {
    flexDirection: "row",
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.full,
    padding: 5,
    marginBottom: spacing.lg,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    marginBottom: 0,
  },
  tabButtonActive: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: text.tertiary,
    textAlign: "center",
  },
  tabLabelActive: {
    fontWeight: "900",
  },
  tabCount: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "700",
  },
  eventList: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    gap: spacing.lg,
  },
  eventCard: {
    flexDirection: "column",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  eventCardPast: {
    opacity: 0.7,
  },
  cardPressed: {
    opacity: 0.7,
  },
  eventCover: {
    width: "100%",
    height: 174,
  },
  eventBody: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  eventDate: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  eventTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "800",
    color: text.primary,
  },
  eventVenue: {
    fontSize: 13,
    color: text.tertiary,
    marginTop: 2,
  },
  eventPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: text.primary,
    marginTop: spacing.xs,
  },
  eventBuyPill: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    marginTop: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  eventBuyPillLabel: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  tripFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    gap: spacing.sm,
  },
  tripBadgeClosed: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  tripBadgeScarce: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  tripBadgeLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: text.primary,
  },
  emptyTabWrap: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyTabTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: text.secondary,
  },
  aboutWrap: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 620,
    gap: spacing.lg,
  },
  aboutBlock: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  aboutBlockLabel: {
    fontSize: 11,
    color: text.tertiary,
    letterSpacing: 1.4,
    fontWeight: "600",
  },
  aboutBlockBody: {
    fontSize: 15,
    color: text.secondary,
    lineHeight: 22,
  },
  aboutContactLink: {
    fontSize: 14,
    color: accent.warm,
    paddingVertical: 4,
  },
});
