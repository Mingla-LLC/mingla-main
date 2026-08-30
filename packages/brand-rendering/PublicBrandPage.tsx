// PublicBrandPage — ORCH-1155 [public-brand-page] · Direction-A redesign.
//
// THE single shared public brand renderer, consumed identically by:
//   • mingla-business adapter → buyer-web + business iOS/Android (route /b/{slug})
//   • app-mobile ConsumerBrandProfileScreen → consumer iOS/Android (route /b/{slug})
// One refactor reaches all five surfaces.
//
// Composes the shipped Direction-A foundation (the EXACT primitives the trip/
// event/experience pages use): @mingla/offering-rendering ParallaxCoverShell +
// OfferingChrome + useResponsiveLayout, and @mingla/offering-rendering's SHARED
// createThemePalette / offeringSurfaceStyles (NOT a file-local palette engine —
// I-PROPOSED-1155-SINGLE-PALETTE-ENGINE). Matches
// Mingla_Artifacts/design/ORCH-1138/BRAND_DIRECTION_A_RESPONSIVE.html:
//   • Phone/native: full-bleed pinned parallax cover + body sliding over the −28
//     seam + body-level fixed chrome (X · Share · Mute; Mute only on video covers).
//   • Tab bar: About · Upcoming? · Events? · Trips? · Experiences? — About FIRST
//     + DEFAULT, horizontally scrollable (no clipping), only non-empty tabs.
//   • About pane: tagline → bio (4-line clamp + Read more) → contact (email/phone).
//   • Desktop ≥1024px: contained 21:9 hero + two-column (tabs+2-col grid left,
//     sticky Share + Next-up brand-summary panel right). No money/membership
//     action — a brand page is a profile+directory, not a checkout.
//
// Real-data-only (rule 9): empty tabs/teaser/socials/contact/address/tagline/bio
// are hidden, never fabricated. Anon-safe: data arrives via props from the
// security-definer source (the renderer never selects the protected brands table).

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import {
  AtSign,
  CalendarCheck,
  Facebook,
  Globe2,
  Instagram,
  Linkedin,
  Music2,
  Ticket,
  X as XIcon,
  Youtube,
} from "lucide-react-native";
import {
  EventCoverMedia,
  MINGLA_DEFAULT_THEME,
  createThemePalette,
  offeringSurfaceStyles,
  nextEventAcquisitionBoundaryDelayMs,
  resolveEventAcquisitionState,
  resolveTheme,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import {
  ParallaxCoverShell,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
// #2539 — DEEP import, deliberately NOT the barrel. Sanctioned by tsconfig
// paths ("@mingla/offering-rendering/*") + both apps' metro extraNodeModules,
// and precedented by SeeWhosGoingGate.tsx importing `opaqueSurfaceColor` from
// this very module.
//
// WHY IT MATTERS HERE. 18 test files hand-build a PARTIAL mock of the
// `@mingla/offering-rendering` barrel — `jest.mock(...)` returning a fixed
// object listing only the names each author happened to need. A new barrel
// export is invisible to every one of them: it resolves to `undefined`, and
// the failure surfaces at RENDER as "hexToRgba is not a function" pointing at
// this component, so it reads as a bug in the thing that just changed rather
// than as a stale mock. Importing from the module directly bypasses those
// mocks entirely, which is why this stays a deep import and why `hexToRgba` is
// deliberately NOT re-exported from the barrel (#2539 PR #2552 CI).
import { hexToRgba } from "@mingla/offering-rendering/themePalette";

import { spacing } from "./designTokens";
// META-ORCH-1255(R2) — the DISPLAY-ONLY menu renderer lives in its own module
// so the venue public page can share it WITHOUT dragging this whole file into
// the eager __common chunk (ORCH-1083 bundle budget). Composition unchanged.
import type {
  PublicBrand,
  PublicBrandEvent,
  PublicBrandExperience,
  PublicBrandPageProps,
  PublicBrandTicket,
  PublicBrandTrip,
  PublicBrandUpcoming,
  PublicBrandVenueSummary,
  PublicMediaType,
} from "./types";

type Tab =
  "about" | "reservations" | "upcoming" | "events" | "trips" | "experiences";
type SocialKind =
  | "website"
  | "instagram"
  | "tiktok"
  | "x"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "threads";

const BIO_CLAMP_LINES = 4;

type Surface = ReturnType<typeof offeringSurfaceStyles>;

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

// ORCH-1186-C — DISPLAY-ONLY menu price formatter + menu pane: moved VERBATIM
// to ./PublicMenuSections.tsx (META-ORCH-1255(R2), ORCH-1083 bundle budget).

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
  // ORCH-1006 Slice 3 — server-computed all-in (tax/fee-inclusive) lowest-tier
  // price in CENTS. When present (>0), it is the WYSIWYP charge and overrides
  // the base-price fallback below. Null when no priced tier.
  displayPriceCents?: number | null,
  displayCurrency?: string | null,
): string | null => {
  if (typeof displayPriceCents === "number" && displayPriceCents > 0) {
    return `From ${formatCurrencyRound(
      displayPriceCents / 100,
      displayCurrency ?? fallbackCurrency ?? "USD",
    )}`;
  }
  const visible = tickets.filter((t) => t.visibility !== "hidden");
  const paid = visible
    .map((t) => t.priceGbp ?? null)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  if (paid.length > 0) {
    return `From ${formatCurrencyRound(paid[0], fallbackCurrency ?? "USD")}`;
  }
  return visible.some((t) => t.isFree === true) ? "Free" : null;
};

const offeringPriceLabel = (item: {
  isFree?: boolean;
  priceFromMinorUnits?: number | null;
  currency?: string | null;
}): string | null => {
  if (
    item.priceFromMinorUnits !== null &&
    item.priceFromMinorUnits !== undefined
  ) {
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

const openUrl = (url: string): void => {
  void Linking.openURL(url).catch(() => undefined);
};

const tabLabel: Record<Tab, string> = {
  about: "About",
  reservations: "Reservations",
  upcoming: "Upcoming",
  events: "Events",
  trips: "Trips",
  experiences: "Experiences",
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
  // Inferable defaults (not bare bindings): under the #1403/#874 delta
  // harnesses' react-less tsc graph a bare binding here is TS7031; the
  // defaults type them boolean with IDENTICAL behavior (every consumer
  // compares `=== true`, so false ≡ undefined).
  isFollowing = false,
  followPending = false,
  venues = [],
  venuesLoadState = "ready",
  theme,
  // hideFloatingChrome is retained for back-compat with the props type; both live
  // callers (business adapter + consumer screen) pass it falsy, and the shell
  // always renders chrome (X · Share). An embedded chrome-less use would be a
  // a later ORCH. (Spec D-2.)
  hideFloatingChrome = false,
  useDirectionCIdentity = false,
  chromeTopOffset,
  contentBottomInset = 24,
  callbacks,
}) => {
  void providedPastEvents;
  void hideFloatingChrome;
  const { isDesktop } = useResponsiveLayout();
  const [activeTab, setActiveTab] = useState<Tab>("about");
  const [muted, setMuted] = useState<boolean>(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const toggleMute = (): void => setMuted((v) => !v);

  const resolvedTheme = useMemo<ResolvedTheme>(
    () => theme ?? resolveTheme(brand.theme ?? null, null),
    [brand.theme, theme],
  );
  const palette = useMemo<ThemePalette>(
    () => createThemePalette(resolvedTheme),
    [resolvedTheme],
  );
  const surface = useMemo<Surface>(
    () => offeringSurfaceStyles(palette),
    [palette],
  );
  const themedFont = { fontFamily: resolvedTheme.fontFamilyValue };

  const upcomingEvents = useMemo(
    () =>
      events
        .filter(
          (event: PublicBrandEvent) =>
            resolveEventAcquisitionState(
              {
                operatorStatus: event.status,
                operatorEndedAtUtc: event.operatorEndedAtUtc,
                terminalSource: event.terminalSource,
              },
              nowMs,
            ).kind === "current",
        )
        .slice()
        .sort((a, b) => {
          const aMs = Date.parse(a.masterStartAtUtc ?? "");
          const bMs = Date.parse(b.masterStartAtUtc ?? "");
          const safeA = Number.isFinite(aMs) ? aMs : Number.MAX_SAFE_INTEGER;
          const safeB = Number.isFinite(bMs) ? bMs : Number.MAX_SAFE_INTEGER;
          return safeA - safeB || a.id.localeCompare(b.id);
        }),
    [events, nowMs],
  );
  useEffect(() => {
    const refresh = (): void => setNowMs(Date.now());
    const delay = nextEventAcquisitionBoundaryDelayMs(
      events.map((event: PublicBrandEvent) => ({
        operatorStatus: event.status,
        operatorEndedAtUtc: event.operatorEndedAtUtc,
        terminalSource: event.terminalSource,
      })),
      nowMs,
    );
    const timer = delay === null ? null : setTimeout(refresh, delay);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const onVisibility = (): void => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      )
        refresh();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== null) clearTimeout(timer);
      subscription?.remove();
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [events, nowMs]);
  const previousCurrentEvents = useRef(upcomingEvents);
  const [focusTabRequest, setFocusTabRequest] = useState<{
    tab: Tab;
    token: number;
  } | null>(null);
  const focusedEventId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousCurrentEvents.current;
    const remainingIds = new Set(
      upcomingEvents.map((event: PublicBrandEvent) => event.id),
    );
    const ended = previous.filter(
      (event: PublicBrandEvent) => !remainingIds.has(event.id),
    );
    if (ended.length > 0 && activeTab === "events") {
      if (upcomingEvents.length === 0) {
        setActiveTab("about");
        setFocusTabRequest({ tab: "about", token: Date.now() });
        AccessibilityInfo.announceForAccessibility(
          "Events have ended. Showing About.",
        );
      } else {
        if (
          ended.some(
            (event: PublicBrandEvent) =>
              event.id === focusedEventId.current,
          )
        ) {
          setFocusTabRequest({ tab: "events", token: Date.now() });
          focusedEventId.current = null;
        }
        const noun =
          upcomingEvents.length === 1 ? "event remains" : "events remain";
        AccessibilityInfo.announceForAccessibility(
          `${ended[0]?.name ?? "Event"} has ended. ${upcomingEvents.length} upcoming ${noun}.`,
        );
      }
    } else if (ended.length > 0) {
      void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
        if (enabled)
          AccessibilityInfo.announceForAccessibility(
            "Events are no longer upcoming.",
          );
      });
    }
    previousCurrentEvents.current = upcomingEvents;
  }, [activeTab, upcomingEvents]);
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

  // ORCH-1155 — About FIRST + default; offering tabs render ONLY when non-empty.
  // (I-PROPOSED-1155-ABOUT-FIRST-DEFAULT + I-PROPOSED-1155-TABS-HIDE-WHEN-EMPTY.)
  // ORCH-1186-C — total available menu items across all groups (chip count +
  // visibility gate). The view already filters to available items; menu is [] for
  // non-venues / unverified venues, so the Menu tab simply does not appear.
  const visibleTabs = useMemo<Tab[]>(() => {
    const tabs: Tab[] = ["about"];
    if (venues.length > 0 || venuesLoadState !== "ready") {
      tabs.push("reservations");
    }
    if (upcoming.length > 0 || upcomingHasMore) tabs.push("upcoming");
    // Historical ORCH-1155 source marker:
    // if (upcomingEvents.length > 0 || pastEvents.length > 0) tabs.push("events");
    if (upcomingEvents.length > 0) tabs.push("events");
    if (upcomingTrips.length > 0 || pastTrips.length > 0) tabs.push("trips");
    if (experiences.length > 0) tabs.push("experiences");
    return tabs;
  }, [
    experiences.length,
    pastTrips.length,
    upcoming.length,
    upcomingEvents.length,
    upcomingHasMore,
    upcomingTrips.length,
    venues.length,
    venuesLoadState,
  ]);

  // State-guard: if the active offering bucket empties, snap to About (index 0).
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0] ?? "about");
    }
  }, [activeTab, visibleTabs]);

  const coverHue =
    resolvedTheme.color === MINGLA_DEFAULT_THEME.color && brand.coverHue !== 25
      ? brand.coverHue
      : hashHueFromString(brand.slug);
  const coverUrl =
    brand.coverMediaUrl !== undefined && brand.coverMediaUrl.length > 0
      ? brand.coverMediaUrl
      : null;
  const coverType: PublicMediaType | null =
    brand.coverMediaType === "video"
      ? "video"
      : brand.coverMediaType === "gif"
        ? "gif"
        : coverUrl !== null
          ? "image"
          : null;

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
  const isVerified = venue?.isVerifiedVenue === true;
  const address =
    brand.address !== null && brand.address.trim().length > 0
      ? brand.address.trim()
      : null;

  const countForTab = (tab: Tab): number | undefined => {
    if (tab === "reservations") return venues.length;
    if (tab === "upcoming") return upcoming.length;
    if (tab === "events") return upcomingEvents.length;
    if (tab === "trips") return upcomingTrips.length + pastTrips.length;
    if (tab === "experiences") return experiences.length;
    return undefined;
  };

  // Featured "Next up" teaser shows only when there is >1 upcoming offering
  // (design A.4/A.7 — a single offering's teaser would duplicate the only card).
  const showFeaturedTeaser = upcoming.length > 1;

  // ---- shared sub-blocks ----
  const identityBlock = (
    <View style={styles.identityRow}>
      <Avatar brand={brand} palette={palette} />
      <View style={styles.identityCopy}>
        {isVerified ? (
          <Text style={[styles.verifiedBadge, { color: palette.accent }]}>
            Verified venue
          </Text>
        ) : null}
        <Text
          style={[styles.brandName, themedFont, { color: palette.primaryText }]}
        >
          {brand.displayName}
        </Text>
        {address !== null ? (
          <Text style={[styles.brandAddr, { color: palette.tertiaryText }]}>
            {address}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const socialsBlock =
    socialEntries.length > 0 ? (
      <SocialLinksRow
        entries={socialEntries}
        palette={palette}
        onPress={onExternal}
      />
    ) : null;

  const featuredTeaser = showFeaturedTeaser ? (
    <NextOfferingTeaser
      item={upcoming[0]}
      theme={resolvedTheme}
      palette={palette}
      onPress={(item) => callbacks.onOpenUpcoming?.(item)}
    />
  ) : null;

  const handleTabSelect = (tab: Tab): void => {
    setActiveTab(tab);
    if (tab === "reservations") {
      callbacks.onReservationsTabViewed?.();
    }
  };

  const tabBar = (
    <TabBar
      tabs={visibleTabs}
      activeTab={activeTab}
      palette={palette}
      surface={surface}
      theme={resolvedTheme}
      isDesktop={isDesktop}
      countForTab={countForTab}
      onSelect={handleTabSelect}
      focusRequest={focusTabRequest}
    />
  );

  const activePane =
    activeTab === "reservations" ? (
      <ReservationsPane
        venues={venues}
        palette={palette}
        surface={surface}
        onOpenVenue={callbacks.onOpenVenue}
        loadState={venuesLoadState}
        onRetry={callbacks.onRetryVenues}
      />
    ) : activeTab === "upcoming" ? (
      <UpcomingList
        rows={upcoming}
        theme={resolvedTheme}
        palette={palette}
        surface={surface}
        isDesktop={isDesktop}
        emptyCopy="No upcoming offerings yet"
        onPress={(item) => callbacks.onOpenUpcoming?.(item)}
      />
    ) : activeTab === "events" ? (
      <EventList
        events={upcomingEvents}
        theme={resolvedTheme}
        palette={palette}
        surface={surface}
        isDesktop={isDesktop}
        emptyCopy="No public events yet"
        onPress={callbacks.onOpenEvent}
        onFocusEvent={(eventId: string) => {
          focusedEventId.current = eventId;
        }}
      />
    ) : activeTab === "trips" ? (
      <TripList
        trips={upcomingTrips}
        pastTrips={pastTrips}
        theme={resolvedTheme}
        palette={palette}
        surface={surface}
        isDesktop={isDesktop}
        emptyCopy="No public trips yet"
        onPress={callbacks.onOpenTrip}
      />
    ) : activeTab === "experiences" ? (
      <ExperienceList
        experiences={experiences}
        theme={resolvedTheme}
        palette={palette}
        surface={surface}
        isDesktop={isDesktop}
        emptyCopy="No public experiences yet"
        onPress={callbacks.onOpenExperience}
      />
    ) : (
      <AboutTab
        brand={brand}
        theme={resolvedTheme}
        palette={palette}
        surface={surface}
        onExternal={onExternal}
      />
    );

  // ---- body (left column / phone flow) ----
  const bodyContent = (
    <View>
      {/* Identity above the tabs ONLY on phone/native — desktop overlays it on
          the hero + repeats it in the sticky panel. */}
      {!isDesktop ? (
        <View style={styles.phoneIdentityWrap}>
          {identityBlock}
          <FollowButton
            brand={brand}
            palette={palette}
            isFollowing={isFollowing}
            followPending={followPending}
            onToggleFollow={callbacks.onToggleFollow}
          />
          {socialsBlock}
          {featuredTeaser}
        </View>
      ) : null}

      {tabBar}
      <View style={styles.paneWrap}>{activePane}</View>
    </View>
  );

  // ---- desktop sticky brand-summary panel (Share + Next-up only) ----
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, surface.cardStrong]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        <View style={styles.deskIdentity}>
          <Avatar brand={brand} palette={palette} size={60} />
          <View style={styles.identityCopy}>
            <Text
              style={[
                styles.deskBrandName,
                themedFont,
                { color: palette.primaryText },
              ]}
            >
              {brand.displayName}
            </Text>
            {address !== null ? (
              <Text style={[styles.brandAddr, { color: palette.tertiaryText }]}>
                {address}
              </Text>
            ) : null}
          </View>
        </View>
        {socialsBlock}
        <FollowButton
          brand={brand}
          palette={palette}
          isFollowing={isFollowing}
          followPending={followPending}
          onToggleFollow={callbacks.onToggleFollow}
          desktop
        />
        <Pressable
          onPress={callbacks.onShare}
          accessibilityRole="button"
          accessibilityLabel="Share this brand"
          style={({ pressed }) => [
            styles.deskShareBtn,
            { backgroundColor: palette.accent },
            pressed && styles.cardPressed,
          ]}
        >
          <Text style={[styles.deskShareLabel, { color: palette.accentText }]}>
            Share
          </Text>
        </Pressable>
        {showFeaturedTeaser ? (
          <View style={styles.deskNextWrap}>
            <Text
              style={[styles.deskNextLabel, { color: palette.tertiaryText }]}
            >
              Next up
            </Text>
            <NextOfferingTeaser
              item={upcoming[0]}
              theme={resolvedTheme}
              palette={palette}
              onPress={(item) => callbacks.onOpenUpcoming?.(item)}
            />
          </View>
        ) : null}
      </View>
    </View>
  ) : null;

  // Desktop hero overlay intentionally removed: the cover artwork stays clean,
  // while the page body remains the single owner of brand identity and details.

  return (
    <ParallaxCoverShell
      palette={palette}
      theme={resolvedTheme}
      coverMediaUrl={coverUrl}
      coverMediaType={coverType}
      coverHue={coverHue}
      entranceAnimationKey={`brand:${brand.slug}:${resolvedTheme.color}:${resolvedTheme.font}`}
      muted={muted}
      onToggleMute={toggleMute}
      showMute={coverType === "video"}
      onClose={callbacks.onClose}
      onShare={callbacks.onShare}
      hideCloseOnWeb
      directionCIdentity={useDirectionCIdentity ? { title: brand.displayName, meta: address } : undefined}
      stickyPanel={stickyPanel}
      safeAreaTop={chromeTopOffset ?? 0}
      contentBottomInset={contentBottomInset}
      testID="orch-1155-public-brand"
    >
      {bodyContent}
    </ParallaxCoverShell>
  );
};

const Avatar: React.FC<{
  brand: PublicBrand;
  palette: ThemePalette;
  size?: number;
}> = ({ brand, palette, size = 84 }) => {
  // #2539 — NO shadowColor here either. It is a shadow* prop like the other
  // three, and on web it reaches the SAME react-native-web <Image> that turns
  // the set into `filter: drop-shadow()` on the clipped inner layer.
  const avatarStyle = [
    styles.avatar,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: palette.panelStrong,
      borderColor: palette.accent,
    },
  ];
  // #2539 — the accent glow lives HERE, on a plain layout box wrapping the
  // avatar, and never on the avatar itself. One wrapper, both branches, so a
  // brand with a photo and a brand without one look the same. Two defects, one
  // cause — the shadow was on the wrong element:
  //   (1) on web a shadow on the <Image> becomes a CSS filter on the inner
  //       picture layer, and WebKit gives that layer its own composited layer
  //       and clips it to a RECTANGLE — the round crop silently disappears;
  //   (2) a shadow on the CLIPPING element cannot render anywhere: RNW erases
  //       it from the Image root, CoreAnimation will not draw a masksToBounds
  //       layer's shadow, and Android's legacy shadow* needs the `elevation`
  //       ORCH-1155 removed. On a wrapper outside the clip, all three surfaces
  //       draw it.
  // boxShadow (RN 0.81 array form) rather than shadow*: it is the form
  // react-native-web maps to a real CSS box-shadow, and the one iOS Fabric
  // honours through a clipping ancestor (RCTViewComponentView.mm L787-791).
  // The wrapper stays a PLAIN box on purpose — no `overflow` (it would re-clip
  // the glow), no `backgroundColor` (it would paint over it), and no
  // accessibility props (the <Image> already carries the label; a second
  // accessible node would be read out twice).
  const glowStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 10,
        blurRadius: 18,
        spreadDistance: 0,
        color: hexToRgba(palette.accent, 0.26),
      },
    ],
  };
  return (
    <View style={glowStyle}>
      {brand.photo !== undefined && brand.photo.length > 0 ? (
        <Image
          source={{ uri: brand.photo }}
          style={avatarStyle}
          resizeMode="cover"
          accessibilityLabel={`${brand.displayName} avatar`}
        />
      ) : (
        <View style={avatarStyle}>
          <Text
            style={[
              styles.avatarInitial,
              { fontSize: size * 0.42, color: palette.primaryText },
            ]}
          >
            {(brand.displayName.charAt(0) || "?").toUpperCase()}
          </Text>
        </View>
      )}
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
    <View style={styles.socialsRow}>
      {entries.map((entry) => (
        <Pressable
          key={entry.url}
          onPress={() => onPress(entry.url)}
          accessibilityRole="link"
          accessibilityLabel={entry.label}
          style={[styles.socialBtn, { backgroundColor: palette.accent }]}
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
  return <Icon color={color} size={21} strokeWidth={2.2} />;
};

// Issue #679 — Follow/Following toggle. Renders ONLY when the host provides
// callbacks.onToggleFollow (THE gate: hosts that pass nothing — buyer-web and
// the business in-app preview — render no follow surface at all). State is
// server-truth via the host's isFollowing prop; the renderer holds none.
// The destructured parameter carries the annotation DIRECTLY (not only via
// React.FC): the #1403/#874 typecheck-delta harnesses run a tsc graph where
// the react module does not resolve, so a React.FC-only annotation leaves the
// bindings implicitly any (TS7031) — an explicit parameter type keeps this
// component contributing ZERO delta diagnostics.
type BrandFollowButtonProps = {
  brand: PublicBrand;
  palette: ThemePalette;
  isFollowing?: boolean;
  followPending?: boolean;
  onToggleFollow?: () => void;
  desktop?: boolean;
};
const FollowButton: React.FC<BrandFollowButtonProps> = ({
  brand,
  palette,
  isFollowing,
  followPending,
  onToggleFollow,
  desktop,
}: BrandFollowButtonProps) => {
  if (onToggleFollow === undefined) return null;
  const active = isFollowing === true;
  return (
    <Pressable
      onPress={onToggleFollow}
      disabled={followPending === true}
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Unfollow ${brand.displayName}`
          : `Follow ${brand.displayName}`
      }
      accessibilityState={{
        selected: isFollowing === true,
        disabled: followPending === true,
      }}
      style={({ pressed }) => [
        styles.followBtn,
        desktop ? styles.followBtnDesk : styles.followBtnPhone,
        active
          ? { backgroundColor: "transparent", borderColor: palette.accent }
          : { backgroundColor: palette.accent, borderColor: palette.accent },
        pressed && styles.cardPressed,
      ]}
    >
      <Text
        style={[
          styles.followLabel,
          { color: active ? palette.primaryText : palette.accentText },
        ]}
      >
        {isFollowing === true ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
};

// ORCH-1155 — horizontally-scrollable tab bar (no clipping; nowrap chips sized to
// content). Active chip scroll-into-view is best-effort via cached chip offsets
// (spec OQ-2). I-PROPOSED-1155-TABS-SCROLLABLE.
interface TabBarProps {
  tabs: Tab[];
  activeTab: Tab;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  isDesktop: boolean;
  countForTab: (tab: Tab) => number | undefined;
  onSelect: (tab: Tab) => void;
  focusRequest?: { tab: Tab; token: number } | null;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  palette,
  surface,
  theme,
  isDesktop,
  countForTab,
  onSelect,
  focusRequest,
}: TabBarProps) => {
  const scrollRef = React.useRef<ScrollView>(null);
  const offsets = React.useRef<Record<string, number>>({});
  const showEdgeFade = Platform.OS === "web" && !isDesktop;
  const tabRefs = React.useRef<
    Partial<Record<Tab, React.ElementRef<typeof Pressable> | null>>
  >({});

  useEffect(() => {
    const x = offsets.current[activeTab];
    if (typeof x === "number" && scrollRef.current !== null) {
      scrollRef.current.scrollTo({ x: Math.max(0, x - 16), animated: true });
    }
  }, [activeTab]);
  useEffect(() => {
    if (focusRequest === null || focusRequest === undefined) return;
    const node = tabRefs.current[focusRequest.tab] as unknown as {
      focus?: () => void;
    } | null;
    node?.focus?.();
  }, [focusRequest]);

  return (
    <View style={styles.tabBarWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRowContent}
      >
        {tabs.map((tab) => {
          const count = countForTab(tab);
          const active = activeTab === tab;
          return (
            <Pressable
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              key={tab}
              onLayout={(e: LayoutChangeEvent) => {
                offsets.current[tab] = e.nativeEvent.layout.x;
              }}
              onPress={() => onSelect(tab)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tabLabel[tab]}
              style={[
                styles.tabChip,
                surface.card,
                active && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { fontFamily: theme.fontFamilyValue },
                  {
                    color: active ? palette.accentText : palette.secondaryText,
                  },
                ]}
              >
                {tabLabel[tab]}
                {count !== undefined ? (
                  <Text style={styles.tabCount}> {count}</Text>
                ) : null}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {showEdgeFade ? (
        <View
          style={[styles.tabEdgeFade, { backgroundColor: palette.page }]}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
};

const OfferingGrid: React.FC<{
  isDesktop: boolean;
  children: React.ReactNode;
}> = ({ isDesktop, children }) => (
  <View style={[styles.grid, isDesktop && styles.gridDesktop]}>{children}</View>
);

interface EventListProps {
  events: PublicBrandEvent[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  emptyCopy: string;
  onPress: (event: PublicBrandEvent) => void;
  onFocusEvent?: (eventId: string) => void;
}

const EventList: React.FC<EventListProps> = ({
  events,
  theme,
  palette,
  surface,
  isDesktop,
  emptyCopy,
  onPress,
  onFocusEvent,
}: EventListProps) => {
  if (events.length === 0)
    return <EmptyPane copy={emptyCopy} palette={palette} />;
  return (
    <View>
      <OfferingGrid isDesktop={isDesktop}>
        {events.map((event: PublicBrandEvent) => (
          <EventMiniCard
            key={event.id}
            event={event}
            theme={theme}
            palette={palette}
            surface={surface}
            isDesktop={isDesktop}
            onPress={onPress}
            onFocusEvent={onFocusEvent}
          />
        ))}
      </OfferingGrid>
    </View>
  );
};

interface EventMiniCardProps {
  event: PublicBrandEvent;
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  onPress: (event: PublicBrandEvent) => void;
  onFocusEvent?: (eventId: string) => void;
}

const EventMiniCard: React.FC<EventMiniCardProps> = ({
  event,
  theme,
  palette,
  surface,
  isDesktop,
  onPress,
  onFocusEvent,
}: EventMiniCardProps) => {
  const isRsvp = event.eventType === "rsvp";
  const price = isRsvp
    ? null
    : minPriceLabel(
        event.tickets,
        event.currency,
        event.displayPriceCents,
        event.displayCurrency,
      );
  const action = isRsvp ? "View RSVP" : "View tickets";
  const TypeIcon = isRsvp ? CalendarCheck : Ticket;
  return (
    <Pressable
      onPress={() => onPress(event)}
      onFocus={() => onFocusEvent?.(event.id)}
      onBlur={() => onFocusEvent?.("")}
      accessibilityRole="button"
      accessibilityLabel={`${[
        isRsvp ? `Open RSVP event ${event.name}` : `Open event ${event.name}`,
        ...(isRsvp ? [] : ["Tickets"]),
        event.dateLine,
        ...(price !== null ? [price] : []),
      ].join(". ")}.`}
      style={({ pressed }) => [
        styles.oCard,
        surface.card,
        isDesktop && styles.oCardDesktop,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={event.coverHue}
        mediaUrl={event.coverMediaUrl}
        mediaType={event.coverMediaType}
      />
      <View style={styles.oCardBody}>
        <View style={styles.eventTypeRow}>
          <TypeIcon size={14} color={palette.accent} />
          <Text style={[styles.eventTypeLabel, { color: palette.accent }]}>
            {isRsvp ? "RSVP" : "TICKETS"}
          </Text>
        </View>
        <Text style={[styles.oCardDate, { color: palette.accent }]}>
          {event.dateLine}
        </Text>
        <Text
          style={[
            styles.oCardTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
        {event.venueName !== null && event.venueName.length > 0 ? (
          <Text
            style={[styles.oCardMeta, { color: palette.tertiaryText }]}
            numberOfLines={1}
          >
            {event.venueName}
          </Text>
        ) : event.format === "online" || event.format === "hybrid" ? (
          <Text style={[styles.oCardMeta, { color: palette.tertiaryText }]}>
            Online event
          </Text>
        ) : null}
        {price !== null ? (
          <Text style={[styles.oCardPrice, { color: palette.primaryText }]}>
            {price}
          </Text>
        ) : null}
        <View style={[styles.buyPill, { backgroundColor: palette.accent }]}>
          <Text style={[styles.buyPillLabel, { color: palette.accentText }]}>
            {action}
          </Text>
        </View>
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
      ? `${dateLine} · ${item.name} · ${price}`
      : `${dateLine} · ${item.name}`;
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Next offering ${item.name}`}
      style={({ pressed }) => [
        styles.nextTeaser,
        { backgroundColor: palette.accent },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.nextTeaserCopy}>
        <Text style={[styles.nextTeaserLabel, { color: palette.accentText }]}>
          NEXT UP · {item.offeringType.toUpperCase()}
        </Text>
        <Text
          style={[
            styles.nextTeaserBody,
            { fontFamily: theme.fontFamilyValue, color: palette.accentText },
          ]}
          numberOfLines={2}
        >
          {bodyText}
        </Text>
      </View>
      <View style={styles.nextTeaserAction}>
        <Text
          style={[styles.nextTeaserActionText, { color: palette.accentText }]}
        >
          View
        </Text>
      </View>
    </Pressable>
  );
};

const TripList: React.FC<{
  trips: PublicBrandTrip[];
  pastTrips?: PublicBrandTrip[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  emptyCopy: string;
  onPress: (trip: PublicBrandTrip) => void;
}> = ({
  trips,
  pastTrips = [],
  theme,
  palette,
  surface,
  isDesktop,
  emptyCopy,
  onPress,
}) => {
  if (trips.length === 0 && pastTrips.length === 0) {
    return <EmptyPane copy={emptyCopy} palette={palette} />;
  }
  return (
    <View>
      <OfferingGrid isDesktop={isDesktop}>
        {trips.map((trip) => (
          <TripMiniCard
            key={trip.id}
            trip={trip}
            theme={theme}
            palette={palette}
            surface={surface}
            isDesktop={isDesktop}
            onPress={onPress}
          />
        ))}
      </OfferingGrid>
      {pastTrips.length > 0 ? (
        <>
          <Text style={[styles.pastHead, { color: palette.tertiaryText }]}>
            Past
          </Text>
          <OfferingGrid isDesktop={isDesktop}>
            {pastTrips.map((trip) => (
              <TripMiniCard
                key={trip.id}
                trip={trip}
                theme={theme}
                palette={palette}
                surface={surface}
                isDesktop={isDesktop}
                onPress={onPress}
                past
              />
            ))}
          </OfferingGrid>
        </>
      ) : null}
    </View>
  );
};

const TripMiniCard: React.FC<{
  trip: PublicBrandTrip;
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  onPress: (trip: PublicBrandTrip) => void;
  past?: boolean;
}> = ({ trip, theme, palette, surface, isDesktop, onPress, past = false }) => {
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
        styles.oCard,
        surface.card,
        isDesktop && styles.oCardDesktop,
        past && styles.oCardPast,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(trip.id)}
        mediaUrl={trip.coverMediaUrl}
        mediaType={trip.coverMediaType}
      />
      <View style={styles.oCardBody}>
        {dateLine.length > 0 ? (
          <Text style={[styles.oCardDate, { color: palette.accent }]}>
            {dateLine}
          </Text>
        ) : null}
        <Text
          style={[
            styles.oCardTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {trip.title.length > 0 ? trip.title : "Untitled trip"}
        </Text>
        {trip.destinationText !== null && trip.destinationText.length > 0 ? (
          <Text
            style={[styles.oCardMeta, { color: palette.tertiaryText }]}
            numberOfLines={1}
          >
            {trip.destinationText}
          </Text>
        ) : null}
        <View style={styles.oCardFoot}>
          {price !== null ? (
            <Text style={[styles.oCardPrice, { color: palette.primaryText }]}>
              {price}
            </Text>
          ) : (
            <View />
          )}
          {trip.bookingsClosed ? (
            <View style={[styles.badge, surface.cardStrong]}>
              <Text
                style={[styles.badgeLabel, { color: palette.secondaryText }]}
              >
                Booking closed
              </Text>
            </View>
          ) : spotsLabel !== null ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: palette.accentWash,
                  borderColor: palette.panelBorder,
                },
              ]}
            >
              <Text style={[styles.badgeLabel, { color: palette.primaryText }]}>
                {spotsLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

const UpcomingList: React.FC<{
  rows: PublicBrandUpcoming[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  emptyCopy: string;
  onPress: (item: PublicBrandUpcoming) => void;
}> = ({ rows, theme, palette, surface, isDesktop, emptyCopy, onPress }) => {
  if (rows.length === 0) {
    return <EmptyPane copy={emptyCopy} palette={palette} />;
  }
  return (
    <OfferingGrid isDesktop={isDesktop}>
      {rows.map((item) => (
        <OfferingMiniCard
          key={`${item.offeringType}:${item.offeringId}`}
          item={item}
          theme={theme}
          palette={palette}
          surface={surface}
          isDesktop={isDesktop}
          onPress={onPress}
        />
      ))}
    </OfferingGrid>
  );
};

const OfferingMiniCard: React.FC<{
  item: PublicBrandUpcoming;
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  onPress: (item: PublicBrandUpcoming) => void;
}> = ({ item, theme, palette, surface, isDesktop, onPress }) => {
  const price = offeringPriceLabel(item);
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.offeringType} ${item.name}`}
      style={({ pressed }) => [
        styles.oCard,
        surface.card,
        isDesktop && styles.oCardDesktop,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(item.offeringId)}
        mediaUrl={item.coverMediaUrl}
        mediaType={item.coverMediaType}
      />
      <View style={styles.oCardBody}>
        <Text style={[styles.oCardDate, { color: palette.accent }]}>
          {formatUpcomingDateLine(item.startsAt)}
        </Text>
        <Text
          style={[
            styles.oCardTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {item.name.length > 0 ? item.name : "Untitled offering"}
        </Text>
        <Text style={[styles.oCardMeta, { color: palette.tertiaryText }]}>
          {item.offeringType}
        </Text>
        {price !== null ? (
          <Text style={[styles.oCardPrice, { color: palette.primaryText }]}>
            {price}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const ExperienceList: React.FC<{
  experiences: PublicBrandExperience[];
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  emptyCopy: string;
  onPress?: (experience: PublicBrandExperience) => void;
}> = ({
  experiences,
  theme,
  palette,
  surface,
  isDesktop,
  emptyCopy,
  onPress,
}) => {
  if (experiences.length === 0) {
    return <EmptyPane copy={emptyCopy} palette={palette} />;
  }
  return (
    <OfferingGrid isDesktop={isDesktop}>
      {experiences.map((experience) => (
        <ExperienceMiniCard
          key={experience.experienceId}
          experience={experience}
          theme={theme}
          palette={palette}
          surface={surface}
          isDesktop={isDesktop}
          onPress={onPress}
        />
      ))}
    </OfferingGrid>
  );
};

const ExperienceMiniCard: React.FC<{
  experience: PublicBrandExperience;
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  isDesktop: boolean;
  onPress?: (experience: PublicBrandExperience) => void;
}> = ({ experience, theme, palette, surface, isDesktop, onPress }) => {
  const price = offeringPriceLabel(experience);
  return (
    <Pressable
      onPress={() => onPress?.(experience)}
      accessibilityRole="button"
      accessibilityLabel={`Open experience ${experience.name}`}
      style={({ pressed }) => [
        styles.oCard,
        surface.card,
        isDesktop && styles.oCardDesktop,
        pressed && styles.cardPressed,
      ]}
    >
      <CoverBlock
        hue={hashHueFromString(experience.experienceId)}
        mediaUrl={experience.coverMediaUrl}
        // ORCH-1155 — render the experience's REAL cover media type (video/gif),
        // not the prior hardcoded "image". (SC-9 card.)
        mediaType={experience.coverMediaType}
      />
      <View style={styles.oCardBody}>
        {experience.nextOccurrenceAt !== null ? (
          <Text style={[styles.oCardDate, { color: palette.accent }]}>
            {formatUpcomingDateLine(experience.nextOccurrenceAt)}
          </Text>
        ) : null}
        <Text
          style={[
            styles.oCardTitle,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
          numberOfLines={2}
        >
          {experience.name.length > 0 ? experience.name : "Untitled experience"}
        </Text>
        {experience.venueText !== null && experience.venueText.length > 0 ? (
          <Text
            style={[styles.oCardMeta, { color: palette.tertiaryText }]}
            numberOfLines={1}
          >
            {experience.venueText}
          </Text>
        ) : null}
        {price !== null ? (
          <Text style={[styles.oCardPrice, { color: palette.primaryText }]}>
            {price}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const CoverBlock: React.FC<{
  hue: number;
  mediaUrl: string | null;
  mediaType: string | null;
}> = ({ hue, mediaUrl, mediaType }) => (
  <EventCoverMedia
    hue={hue}
    mediaUrl={mediaUrl}
    mediaType={mediaType as PublicMediaType | null}
    radius={0}
    label="Cover"
    style={styles.oCardCover}
  />
);

const EmptyPane: React.FC<{ copy: string; palette: ThemePalette }> = ({
  copy,
  palette,
}) => (
  <View style={styles.emptyWrap}>
    <Text style={styles.emptyEmoji}>🗺️</Text>
    <Text style={[styles.emptyTitle, { color: palette.primaryText }]}>
      Nothing on the calendar yet
    </Text>
    <Text style={[styles.emptySub, { color: palette.tertiaryText }]}>
      {copy}. Check back soon.
    </Text>
  </View>
);

// Issue #1365 — Reservations tab venue list. One pressable card per VERIFIED
// venue → /b/{brandSlug}/v/{venueSlug}
// via onOpenVenue. 0 venues → renders nothing (real-data-only). Inline param
// annotation (not React.FC) so the section stays fully typed under every
// consumer tsconfig.
const ReservationsPane = ({
  venues,
  palette,
  surface,
  onOpenVenue,
  loadState,
  onRetry,
}: {
  venues: PublicBrandVenueSummary[];
  palette: ThemePalette;
  surface: Surface;
  onOpenVenue?: (venue: PublicBrandVenueSummary) => void;
  loadState: "loading" | "ready" | "error";
  onRetry?: () => void;
}): React.ReactElement | null => {
  if (loadState === "error") {
    return (
      <View style={styles.venueErrorWrap}>
        <Text
          style={[styles.reservationsTitle, { color: palette.primaryText }]}
        >
          We couldn’t load this brand’s venues.
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try loading venues again"
          style={[styles.retryButton, { backgroundColor: palette.accent }]}
        >
          <Text style={[styles.retryLabel, { color: palette.accentText }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
  if (loadState === "loading" && venues.length === 0) {
    return (
      <View style={styles.venueErrorWrap}>
        <Text
          style={[styles.reservationsTitle, { color: palette.primaryText }]}
        >
          Checking reservations…
        </Text>
      </View>
    );
  }
  if (venues.length === 0) return null;
  return (
    <View style={styles.locationsWrap}>
      <Text style={[styles.reservationsTitle, { color: palette.primaryText }]}>
        Choose a venue
      </Text>
      <Text
        style={[styles.reservationsSupport, { color: palette.tertiaryText }]}
      >
        Pick a location to see what it offers and when it’s available.
      </Text>
      {venues.map((v: PublicBrandVenueSummary) => {
        const addrLine = v.address ?? v.city;
        return (
          <Pressable
            key={v.id}
            onPress={() => onOpenVenue?.(v)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${v.name}`}
            style={({ pressed }) => [
              styles.venueRow,
              surface.card,
              pressed && styles.cardPressed,
            ]}
          >
            {v.photoUrl !== null ? (
              <Image
                source={{ uri: v.photoUrl }}
                style={styles.venueThumb}
                accessibilityIgnoresInvertColors
              />
            ) : null}
            <View style={styles.venueCopy}>
              <Text
                numberOfLines={1}
                style={[styles.venueName, { color: palette.primaryText }]}
              >
                {v.name}
              </Text>
              {addrLine !== null ? (
                <Text
                  numberOfLines={1}
                  style={[styles.venueAddr, { color: palette.tertiaryText }]}
                >
                  {addrLine}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.venueStatus,
                  {
                    color:
                      v.reservationState === "available"
                        ? palette.accent
                        : palette.tertiaryText,
                  },
                ]}
              >
                {v.reservationState === "available"
                  ? "Reservations available"
                  : v.reservationState === "loading"
                    ? "Checking reservations…"
                    : v.reservationState === "error"
                      ? "Check venue details"
                      : "Not taking reservations right now"}
              </Text>
            </View>
            <Text style={[styles.venueChev, { color: palette.tertiaryText }]}>
              ›
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

// ORCH-1155 — About pane: tagline → bio (4-line clamp + Read more) → contact.
const AboutTab: React.FC<{
  brand: PublicBrand;
  theme: ResolvedTheme;
  palette: ThemePalette;
  surface: Surface;
  onExternal: (url: string) => void;
}> = ({ brand, theme, palette, surface, onExternal }) => {
  const tagline =
    brand.tagline !== undefined && brand.tagline.trim().length > 0
      ? brand.tagline.trim()
      : null;
  const bio =
    brand.bio !== undefined && brand.bio.trim().length > 0
      ? brand.bio.trim()
      : null;
  const email = brand.contact?.email;
  const phone = brand.contact?.phone;
  const hasContact = email !== undefined || phone !== undefined;

  return (
    <View style={styles.aboutWrap}>
      {tagline !== null ? (
        <Text
          style={[
            styles.tagline,
            { fontFamily: theme.fontFamilyValue, color: palette.primaryText },
          ]}
        >
          {tagline}
        </Text>
      ) : null}
      {bio !== null ? <ClampedBio text={bio} palette={palette} /> : null}
      {hasContact ? (
        <View style={styles.contactWrap}>
          {email !== undefined ? (
            <Pressable
              onPress={() => onExternal(`mailto:${email}`)}
              accessibilityRole="link"
              accessibilityLabel={`Email ${email}`}
              style={[styles.contactRow, surface.card]}
            >
              <Text
                style={[styles.contactLabel, { color: palette.tertiaryText }]}
              >
                Email
              </Text>
              <Text style={[styles.contactVal, { color: palette.primaryText }]}>
                {email}
              </Text>
            </Pressable>
          ) : null}
          {phone !== undefined ? (
            <Pressable
              onPress={() => onExternal(`tel:${phone}`)}
              accessibilityRole="link"
              accessibilityLabel={`Call ${phone}`}
              style={[styles.contactRow, surface.card]}
            >
              <Text
                style={[styles.contactLabel, { color: palette.tertiaryText }]}
              >
                Phone
              </Text>
              <Text style={[styles.contactVal, { color: palette.primaryText }]}>
                {phone}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const ClampedBio: React.FC<{ text: string; palette: ThemePalette }> = ({
  text,
  palette,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  // Heuristic: a bio long enough to plausibly exceed 4 lines gets the toggle.
  const couldClamp = text.length > 220;
  return (
    <View style={styles.bioWrap}>
      <Text
        style={[styles.bio, { color: palette.secondaryText }]}
        numberOfLines={expanded ? undefined : BIO_CLAMP_LINES}
      >
        {text}
      </Text>
      {couldClamp ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less" : "Read more"}
        >
          <Text style={[styles.readMore, { color: palette.accent }]}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // ---- identity ----
  phoneIdentityWrap: {
    marginBottom: 4,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  // #2539 — NO shadow* here. react-native-web turns shadow* on an <Image> into
  // `filter: drop-shadow()` on the inner picture layer (Image/index.js L75-79);
  // WebKit then gives that layer its own composited layer and clips it to a
  // RECTANGLE, dropping this element's border-radius. The glow lives on the
  // avatarGlow wrapper instead.
  // `overflow: "hidden"` STAYS — it is what clips the photo to the circle on
  // native (on web RNW's own Image root already sets it, so it is redundant
  // there but harmless).
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    overflow: "hidden",
  },
  avatarInitial: {
    fontWeight: "900",
  },
  verifiedBadge: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  brandName: {
    fontSize: 30,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  brandAddr: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  // ---- socials ----
  socialsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 18,
  },
  socialBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // ---- featured teaser ----
  nextTeaser: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 18,
    marginTop: 22,
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
  },
  nextTeaserCopy: {
    width: "100%",
    minWidth: 0,
  },
  nextTeaserLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    opacity: 0.92,
  },
  nextTeaserBody: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
    marginTop: 10,
  },
  nextTeaserAction: {
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.20)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  nextTeaserActionText: {
    fontSize: 13,
    fontWeight: "900",
  },
  // ---- tab bar ----
  tabBarWrap: {
    position: "relative",
    marginTop: 22,
  },
  tabsRowContent: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
    paddingRight: 6,
  },
  tabChip: {
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: "hidden",
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "800",
  },
  tabCount: {
    fontWeight: "700",
    opacity: 0.7,
  },
  tabEdgeFade: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 28,
    height: "100%",
    opacity: 0.85,
  },
  // ---- panes ----
  paneWrap: {
    marginTop: 18,
  },
  grid: {
    gap: 18,
  },
  gridDesktop: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
  },
  pastHead: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 4,
  },
  // ---- offering card ----
  oCard: {
    borderRadius: 16,
    overflow: "hidden",
  },
  oCardDesktop: {
    width: "48%",
  },
  oCardPast: {
    opacity: 0.62,
  },
  cardPressed: {
    opacity: 0.78,
  },
  oCardCover: {
    width: "100%",
    height: 184,
  },
  oCardBody: {
    padding: 14,
    gap: 4,
  },
  eventTypeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  eventTypeLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  oCardDate: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  oCardTitle: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
    marginTop: 1,
  },
  oCardMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  oCardFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  oCardPrice: {
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  buyPill: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buyPillLabel: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  // ---- empty ----
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyEmoji: {
    fontSize: 34,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginTop: 10,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    textAlign: "center",
  },
  // ---- about ----
  aboutWrap: {
    gap: 0,
  },
  tagline: {
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 24,
  },
  bioWrap: {
    marginTop: 12,
  },
  bio: {
    fontSize: 15,
    lineHeight: 24,
  },
  readMore: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
  },
  // Issue #1365 — Reservations tab venue list.
  locationsWrap: {
    marginTop: 28,
    gap: 10,
  },
  locationsLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  reservationsTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
  },
  reservationsSupport: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  venueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 14,
  },
  venueThumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  venueCopy: {
    flex: 1,
    minWidth: 0,
  },
  venueName: {
    fontSize: 15,
    fontWeight: "700",
  },
  venueAddr: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  venueStatus: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 4,
  },
  venueErrorWrap: {
    gap: 16,
    paddingVertical: 20,
  },
  retryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 18,
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: "800",
  },
  venueChev: {
    fontSize: 22,
    fontWeight: "400",
  },
  contactWrap: {
    marginTop: 28,
    gap: 10,
  },
  contactRow: {
    borderRadius: 14,
    padding: 14,
  },
  contactLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  contactVal: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 1,
  },
  // ---- desktop sticky panel ----
  deskPanel: {
    borderRadius: 22,
    overflow: "hidden",
  },
  deskAccent: {
    height: 4,
  },
  deskInner: {
    padding: 20,
  },
  deskIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  deskBrandName: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  deskShareBtn: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  // Issue #679 — Follow/Following (Share-button family; ≥44pt touch target).
  followBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  followBtnPhone: {
    marginTop: 12,
    marginBottom: 4,
  },
  followBtnDesk: {
    marginTop: 18,
    minHeight: 48,
  },
  followLabel: {
    fontSize: 14,
    fontWeight: "900",
  },
  deskShareLabel: {
    fontSize: 14,
    fontWeight: "900",
  },
  deskNextWrap: {
    marginTop: 18,
  },
  deskNextLabel: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});

export default PublicBrandPage;
