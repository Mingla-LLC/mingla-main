/**
 * PublicBrandPage — the public-facing brand page rendered at /b/{brandSlug}.
 *
 * The IG-bio-link surface. Founders drop the URL into their IG bio, WhatsApp
 * status, email signature; anyone clicks → lands here without auth.
 *
 * 3 tabs: Upcoming · Past · About. Tabs are local UI state — the page
 * itself never branches into multiple URL variants.
 *
 * Founder-aware close chrome: `ownsThisBrand` = signed in + member of the
 * brand. Mirrors PublicEventPage's `ownsThisEvent` pattern from Cycle 6.
 * Share button: always visible, opens ShareModal with brand URL.
 *
 * Honesty model (Constitution #9 + addendum §12):
 *   - Pop-up brands do not render a route handle or faked location.
 *   - Physical brands render public address/location text only when
 *     address is non-empty.
 *   - "Verified host since YYYY" derived from brand owner's joinedAt;
 *     suppressed if no owner-member found.
 *   - No verified blue check, no rating, no Follow CTA, no Bell, no moreH
 *     — these were all designer features cut for Constitution #1 + #9
 *     compliance. See discoveries D-INV-CYCLE7-1..5.
 *
 * Stats card: rendered only from public event rows. Private/stub audience
 * totals are intentionally not public brand-page truth.
 *
 * Past tab: capped at 10 most recent, cancelled events filtered out.
 * Past event cards link to `/e/{brandSlug}/{eventSlug}` (Cycle 6's
 * `past` variant renders the "this event has ended" state).
 *
 * Per Cycle 7 spec §1-§11 (forensics) + §12 (orchestrator addendum).
 *
 * Platform notes (color formats — Cycle 7 FX3 lesson):
 *   Inline `backgroundColor` strings on RN Views go through
 *   `@react-native/normalize-colors`, which accepts ONLY hex / rgb / rgba /
 *   hsl / hsla / hwb. CSS Color Module 4 functions (`oklch`, `lab`, `lch`,
 *   `color-mix`) silently fail on iOS+Android (component renders transparent,
 *   no error logged) and dim into invisibility on web when stacked under a
 *   dark overlay. ALWAYS use `hsl(hue, 60%, 45%)` for any inline color
 *   driven by hue — mirror `EventCover.tsx`'s `baseColour` pattern.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image as ExpoImage } from "expo-image";
import {
  Image as RNImage,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Head from "expo-router/head";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  brandOgImageUrl,
  brandPublicUrl,
  eventPublicPath,
  tripPublicPath,
} from "../../constants/publicUrls";
import type {
  PublicTripCard,
  PublicVenueDetail,
} from "../../services/publicEventsService";
import type { Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { VenueCategory } from "../../types/brand";
import { formatCurrencyRound } from "../../utils/currency";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";

import { Avatar } from "../ui/Avatar";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { ShareModal } from "../ui/ShareModal";
import { VerifiedBadge } from "./VerifiedBadge";
import { VenueHoursTable } from "./VenueHoursTable";
import { VenueLocationPreview } from "./VenueLocationPreview";
import { VenuePhotoGallery } from "./VenuePhotoGallery";
// ORCH-0850 [End-not-start parity systemic]: route Upcoming / Past memo
// predicates through the canonical helper. Pre-0850 memos used
// `new Date(e.date).getTime()` with a `Date.now() - 24h` cutoff — the same
// UTC-midnight bug class as Hub events.tsx and checkout. Visitors saw live
// events listed under Past AND missing from Upcoming on the brand profile.
import { isEventPast } from "../../utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../utils/eventDateMath";

interface PublicBrandPageProps {
  brand: Brand;
  events: LiveEvent[];
  /** ORCH-0963 — empty array for non-trip-planner brands; populated for trip_planner. */
  trips: PublicTripCard[];
  /** Ve4 — verified physical venue listing fields; null for popup/trip brands. */
  venue?: PublicVenueDetail | null;
}

const VENUE_CATEGORY_LABELS: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & Arts",
};

// ORCH-0963: primary = Upcoming (event-brand) | Trips (trip-brand)
//            past    = Past (event-brand) | Past Trips (trip-brand)
type Tab = "primary" | "past" | "about";

const PAST_EVENT_CAP = 10;
const PAST_TRIP_CAP = 10;

// ORCH-0963 — pin the first N upcoming-event cards with a sticky "Buy tickets"
// CTA pill for event-brands (F-5 above-the-fold polish). Trip-planner brands
// don't get this — trip cards already make the join CTA implicit.
const PINNED_CTA_CARD_COUNT = 3;

const canonicalUrl = (brand: Brand): string =>
  brandPublicUrl(brand.slug);

// ---- Main component -------------------------------------------------

export const PublicBrandPage: React.FC<PublicBrandPageProps> = ({
  brand,
  events,
  trips,
  venue = null,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // ORCH-0963 — kind-branched content surface. See
  // I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED. brand.kind=trip_planner switches
  // tabs to Trips/Past Trips and renders TripMiniCards; physical/popup keep
  // Upcoming/Past with EventMiniCards + the new NextEventTeaser strip + sticky
  // pinned CTA on the first 3 cards.
  const isTripBrand = brand.kind === "trip_planner";
  const [activeTab, setActiveTab] = useState<Tab>("primary");
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  // ORCH-0805 — track cover media load failure so the hero falls back to the
  // hue gradient. Reset whenever the underlying URL changes.
  const [coverMediaFailed, setCoverMediaFailed] = useState<boolean>(false);
  const coverMediaUrl = brand?.coverMediaUrl ?? null;
  useEffect(() => {
    setCoverMediaFailed(false);
  }, [coverMediaUrl]);

  const isVerifiedVenue = venue?.isVerifiedVenue === true;
  const pageTitle =
    isVerifiedVenue && venue.city !== null
      ? `${brand.displayName} · ${venue.city} on Mingla`
      : `${brand.displayName} on Mingla`;
  const metaDescription =
    brand.bio?.slice(0, 160) ??
    brand.tagline ??
    (isVerifiedVenue && venue.city !== null
      ? `${brand.displayName} in ${venue.city}`
      : brand.displayName);

  // ORCH-0850: upcoming = not past AND not cancelled.
  // The pre-0850 24h cutoff was a band-aid for the UTC-midnight bug class;
  // with isEventPast routing through computeMasterEndAtUtc the event itself
  // defines its window via event_dates.end_at (preferred) or
  // event.date + event.endsAt + timezone (fallback).
  const upcomingEvents = useMemo<LiveEvent[]>(() => {
    return events
      .filter((e) => {
        if (e.status === "cancelled") return false;
        return !isEventPast(e, computeMasterEndAtUtc(e));
      })
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }, [events]);

  // ORCH-0850: past = isEventPast (canonical) AND not cancelled.
  // Cancelled events were intentionally filtered out pre-0850; preserved.
  const pastEvents = useMemo<LiveEvent[]>(() => {
    return events
      .filter((e) => {
        if (e.status === "cancelled") return false;
        return isEventPast(e, computeMasterEndAtUtc(e));
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, PAST_EVENT_CAP);
  }, [events]);

  // ORCH-0963 — trip memos. Empty arrays for non-trip-planner brands; the
  // server-side dispatch already ensures `trips=[]` for those.
  const upcomingTrips = useMemo<PublicTripCard[]>(() => {
    if (!isTripBrand) return [];
    return trips
      .filter((t) => t.status === "scheduled" || t.status === "live")
      .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
  }, [isTripBrand, trips]);

  const pastTrips = useMemo<PublicTripCard[]>(() => {
    if (!isTripBrand) return [];
    return trips
      .filter((t) => t.status === "ended")
      .sort((a, b) => (b.endAt ?? "").localeCompare(a.endAt ?? ""))
      .slice(0, PAST_TRIP_CAP);
  }, [isTripBrand, trips]);

  // ORCH-0963 — kind-aware tab labels + empty-state copy. Resolved once per
  // render and passed to children to keep the swap site simple.
  const primaryTabLabel = isTripBrand ? "Trips" : "Upcoming";
  const pastTabLabel = isTripBrand ? "Past Trips" : "Past";
  const primaryTabCount = isTripBrand
    ? upcomingTrips.length
    : upcomingEvents.length;
  const pastTabCount = isTripBrand ? pastTrips.length : pastEvents.length;
  const emptyPrimaryCopy = isTripBrand
    ? "No upcoming trips yet"
    : isVerifiedVenue
      ? "No upcoming events from this venue"
      : "No upcoming events yet";
  const emptyPastCopy = isTripBrand
    ? "No past trips to show"
    : "No past events to show";

  // Cycle 13a (DEC-092): brand.members dropped. The "Verified host since YYYY"
  // pill on the public page is suppressed in 13a; restoring it is a B-cycle
  // task once `creator_accounts.created_at` (or brand_team_members.invited_at
  // for the owner row) is wired through React Query.
  const verifiedHostSinceYear = useMemo<number | null>(() => null, []);

  const handleEventCardPress = useCallback(
    (event: LiveEvent): void => {
      // event.brandSlug is the FROZEN-at-publish slug — use it instead
      // of the current brand.slug to handle the (rare) case where the
      // brand was renamed after publish (Cycle 6 freezes brandSlug at
      // publish for exactly this URL stability).
      router.push(
        eventPublicPath({
          brandSlug: event.brandSlug,
          eventSlug: event.eventSlug,
        }) as never,
      );
    },
    [router],
  );

  // ORCH-0963 — trip card tap navigates to /t/{brandSlug}/{tripSlug}. Mirror
  // handleEventCardPress: use trip.brandSlug (frozen at publish) over brand.slug
  // for URL stability if the brand was renamed post-publish.
  const handleTripCardPress = useCallback(
    (trip: PublicTripCard): void => {
      router.push(
        tripPublicPath({
          brandSlug: trip.brandSlug,
          tripSlug: trip.slug,
        }) as never,
      );
    },
    [router],
  );

  const handleSocialPress = useCallback(
    async (url: string): Promise<void> => {
      try {
        if (Platform.OS === "web") {
          const win = (
            globalThis as unknown as {
              window?: { open?: (u: string, t: string) => unknown };
            }
          ).window;
          if (win?.open !== undefined) {
            win.open(url, "_blank");
            return;
          }
        }
        await Linking.openURL(url);
      } catch {
        // user-cancellable / nothing to surface
      }
    },
    [],
  );

  // Brand identity card subline. Slug stays URL identity, not visible identity.
  const showLocation =
    brand.kind === "physical" &&
    brand.address !== null &&
    brand.address.trim().length > 0;
  const identitySubline =
    showLocation && brand.address !== null ? brand.address.trim() : null;

  return (
    <View style={styles.host}>
      {/* SEO Head — web only per FX1 / Cycle 6 lesson. iOS native lacks
          a registered origin URL (DEC-071); rendering Head there throws. */}
      {Platform.OS === "web" ? (
        <Head>
          <title>{pageTitle}</title>
          <meta name="description" content={metaDescription} />
          <meta property="og:title" content={pageTitle} />
          <meta
            property="og:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? metaDescription
            }
          />
          <meta property="og:url" content={canonicalUrl(brand)} />
          <meta
            property="og:image"
            content={brandOgImageUrl({
              brandSlug: brand.slug,
              profilePhotoUrl: brand.photo,
            })}
          />
          <meta property="og:type" content="profile" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={brand.displayName} />
          <meta
            name="twitter:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName
            }
          />
          <meta
            name="twitter:image"
            content={brandOgImageUrl({
              brandSlug: brand.slug,
              profilePhotoUrl: brand.photo,
            })}
          />
          <link rel="canonical" href={canonicalUrl(brand)} />
        </Head>
      ) : null}

      {/* ORCH-0805 — cover hero with 3-state fallback chain.
          1. brand.coverMediaUrl present + load succeeds → image element
             (expo-image on Android for correct GIF animation; RN core
             <Image> on iOS + web because both platforms animate GIFs
             natively and expo-image's web shim has surfaced render-not-loading
             issues in this codebase — ORCH-0805-WEB hotfix 2026-05-12).
          2. brand.coverMediaUrl present but load fails → hue gradient
             (defensive fallback; onError flips coverMediaFailed).
          3. brand.coverMediaUrl null → hue gradient (legacy / unset brands).
          Hue fallback uses hsl() — RN normalize-colors only accepts
          hex/rgb/hsl/hwb. See header docstring "Platform notes". */}
      <View style={styles.heroWrap} pointerEvents="none">
        {coverMediaUrl !== null && coverMediaUrl.length > 0 && !coverMediaFailed ? (
          Platform.OS === "android" ? (
            <ExpoImage
              source={{ uri: coverMediaUrl }}
              style={styles.heroGradient}
              contentFit="cover"
              onError={() => setCoverMediaFailed(true)}
              accessibilityLabel="Brand cover"
            />
          ) : (
            <RNImage
              source={{ uri: coverMediaUrl }}
              // ORCH-0805-WEB hotfix 2026-05-12 — explicit width/height: "100%"
              // is mandatory on react-native-web; the heroGradient style's
              // `position: absolute; inset: 0` alone does NOT stretch the
              // DOM <img> element to fill its parent the way it does on RN
              // native. Without these dimensions, the cover renders at 0px
              // size and looks like the page is missing the cover entirely.
              style={[styles.heroGradient, { width: "100%", height: "100%" }]}
              resizeMode="cover"
              onError={() => setCoverMediaFailed(true)}
              accessibilityLabel="Brand cover"
            />
          )
        ) : (
          <View
            style={[
              styles.heroGradient,
              { backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)` },
            ]}
          />
        )}
        <View style={styles.heroFade} />
      </View>

      {/* Floating chrome — close (founder only) + share. */}
      <View
        style={[styles.floatingChrome, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <View />
        <IconChrome
          icon="share"
          size={40}
          onPress={() => setShareModalVisible(true)}
          accessibilityLabel="Share"
        />
      </View>

      {/* Scroll body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand identity column — Linktree-style centered (Cycle 7 FX2).
            Avatar overlaps the cover band by ~42px (half-in-half-out). */}
        <View style={styles.identityCentered}>
          <Avatar
            name={brand.displayName}
            size="hero"
            photo={brand.photo}
            style={styles.heroAvatarCentered}
          />
          <Text style={styles.brandNameCentered}>{brand.displayName}</Text>
          {isVerifiedVenue ? <VerifiedBadge /> : null}
          {identitySubline !== null ? (
            <Text style={styles.handleLineCentered}>{identitySubline}</Text>
          ) : null}
        </View>

        {/* Tagline / bio (lead) — centered */}
        {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
          <Text style={styles.bioLeadCentered}>{brand.bio}</Text>
        ) : brand.tagline !== undefined && brand.tagline.trim().length > 0 ? (
          <Text style={styles.bioLeadCentered}>{brand.tagline}</Text>
        ) : null}

        {/* Social icons row — Linktree-style icons-only, always visible.
            Promoted from the empty-Upcoming fallback to a permanent slot
            below the bio (Cycle 7 FX2). */}
        <SocialLinksRow
          links={brand.links}
          onPress={handleSocialPress}
          compact
        />

        {isVerifiedVenue && venue !== null ? (
          <GlassCard
            variant="elevated"
            radius="lg"
            padding={spacing.md}
            style={styles.venueCard}
          >
            {venue.venueCategory !== null ? (
              <View style={styles.categoryRow}>
                <View style={styles.categoryChip}>
                  <Text style={styles.categoryChipLabel}>
                    {VENUE_CATEGORY_LABELS[venue.venueCategory]}
                  </Text>
                </View>
              </View>
            ) : null}
            <VenueLocationPreview
              address={brand.address ?? null}
              city={venue.city}
              lat={venue.lat}
              lng={venue.lng}
            />
            <VenueHoursTable hours={venue.hours} />
            <VenuePhotoGallery photoUrls={venue.galleryPhotoUrls} />
          </GlassCard>
        ) : null}

        {/* ORCH-0963 — stats card dropped per SC-12. The "EVENTS: N" tile carried
            low information vs. the real-estate it consumed above the tab strip.
            Tabs now sit higher; for event brands the NextEventTeaser below
            replaces it with a higher-signal "next thing" pointer. */}

        {/* ORCH-0963 — Next-event teaser strip (event-brands with an upcoming event).
            F-5 above-the-fold polish: 1-line summary of the soonest upcoming
            event sits BELOW the bio and ABOVE the tab strip. Trip-brands never
            render this — the trip-cards-first IA already surfaces the next thing. */}
        {!isTripBrand && upcomingEvents.length > 0 ? (
          <NextEventTeaser
            event={upcomingEvents[0]}
            onPress={handleEventCardPress}
          />
        ) : null}

        {/* Tabs — ORCH-0963 kind-branched labels. */}
        <View style={styles.tabsRow}>
          <TabButton
            label={primaryTabLabel}
            count={primaryTabCount}
            active={activeTab === "primary"}
            onPress={() => setActiveTab("primary")}
          />
          <TabButton
            label={pastTabLabel}
            count={pastTabCount}
            active={activeTab === "past"}
            onPress={() => setActiveTab("past")}
          />
          <TabButton
            label="About"
            active={activeTab === "about"}
            onPress={() => setActiveTab("about")}
          />
        </View>

        {/* Tab body — ORCH-0963 kind-branched dispatch. */}
        {activeTab === "primary" ? (
          isTripBrand ? (
            <UpcomingTripsTab
              trips={upcomingTrips}
              onTripPress={handleTripCardPress}
              emptyCopy={emptyPrimaryCopy}
            />
          ) : (
            <UpcomingEventsTab
              events={upcomingEvents}
              brand={brand}
              isVerifiedVenue={isVerifiedVenue}
              onEventPress={handleEventCardPress}
              onSocialPress={handleSocialPress}
              emptyCopy={emptyPrimaryCopy}
            />
          )
        ) : activeTab === "past" ? (
          isTripBrand ? (
            <PastTripsTab
              trips={pastTrips}
              onTripPress={handleTripCardPress}
              emptyCopy={emptyPastCopy}
            />
          ) : (
            <PastEventsTab
              events={pastEvents}
              onEventPress={handleEventCardPress}
              emptyCopy={emptyPastCopy}
            />
          )
        ) : (
          <AboutTab brand={brand} onSocialPress={handleSocialPress} />
        )}

        {/* Footer trust strip */}
        {verifiedHostSinceYear !== null ? (
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Verified host on Mingla since {verifiedHostSinceYear}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Share modal */}
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(brand)}
        title={`${brand.displayName} on Mingla`}
        description={brand.bio?.slice(0, 200) ?? brand.tagline}
      />
    </View>
  );
};

// ---- TabButton ------------------------------------------------------

interface TabButtonProps {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  label,
  count,
  active,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.tabButton, active && styles.tabButtonActive]}
  >
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
      {label}
      {count !== undefined ? (
        <Text style={styles.tabCount}> {count}</Text>
      ) : null}
    </Text>
  </Pressable>
);

// ---- UpcomingEventsTab (was UpcomingTab pre-ORCH-0963) --------------

interface UpcomingEventsTabProps {
  events: LiveEvent[];
  brand: Brand;
  isVerifiedVenue: boolean;
  onEventPress: (e: LiveEvent) => void;
  onSocialPress: (url: string) => void;
  emptyCopy: string;
}

const UpcomingEventsTab: React.FC<UpcomingEventsTabProps> = ({
  events,
  onEventPress,
  emptyCopy,
}) => {
  if (events.length === 0) {
    // Cycle 7 FX2: socials moved to permanent slot below bio (above tabs),
    // so the empty-tab copy doesn't need to repeat them here.
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>{emptyCopy}</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {events.map((e, index) => (
        // ORCH-0963 F-5 — pin sticky "Buy tickets" pill on the first 3 cards.
        <EventMiniCard
          key={e.id}
          event={e}
          onPress={onEventPress}
          pinCta={index < PINNED_CTA_CARD_COUNT}
        />
      ))}
    </View>
  );
};

// ---- PastEventsTab (was PastTab pre-ORCH-0963) ----------------------

interface PastEventsTabProps {
  events: LiveEvent[];
  onEventPress: (e: LiveEvent) => void;
  emptyCopy: string;
}

const PastEventsTab: React.FC<PastEventsTabProps> = ({
  events,
  onEventPress,
  emptyCopy,
}) => {
  if (events.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>{emptyCopy}</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {events.map((e) => (
        // ORCH-0963 — pinned CTA is upcoming-only; past cards never get it.
        <EventMiniCard key={e.id} event={e} onPress={onEventPress} past />
      ))}
    </View>
  );
};

// ---- UpcomingTripsTab (ORCH-0963 new) -------------------------------

interface UpcomingTripsTabProps {
  trips: PublicTripCard[];
  onTripPress: (t: PublicTripCard) => void;
  emptyCopy: string;
}

const UpcomingTripsTab: React.FC<UpcomingTripsTabProps> = ({
  trips,
  onTripPress,
  emptyCopy,
}) => {
  if (trips.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>{emptyCopy}</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {trips.map((t) => (
        <TripMiniCard key={t.id} trip={t} onPress={onTripPress} />
      ))}
    </View>
  );
};

// ---- PastTripsTab (ORCH-0963 new) -----------------------------------

interface PastTripsTabProps {
  trips: PublicTripCard[];
  onTripPress: (t: PublicTripCard) => void;
  emptyCopy: string;
}

const PastTripsTab: React.FC<PastTripsTabProps> = ({
  trips,
  onTripPress,
  emptyCopy,
}) => {
  if (trips.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>{emptyCopy}</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {trips.map((t) => (
        <TripMiniCard key={t.id} trip={t} onPress={onTripPress} past />
      ))}
    </View>
  );
};

// ---- AboutTab -------------------------------------------------------

interface AboutTabProps {
  brand: Brand;
  onSocialPress: (url: string) => void;
}

const AboutTab: React.FC<AboutTabProps> = ({ brand, onSocialPress }) => {
  const hasContact =
    (brand.contact?.email !== undefined && brand.contact.email.length > 0) ||
    (brand.contact?.phone !== undefined && brand.contact.phone.length > 0);

  return (
    <View style={styles.aboutWrap}>
      {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
        <View style={styles.aboutBlock}>
          <Text style={styles.aboutBlockLabel}>About</Text>
          <Text style={styles.aboutBlockBody}>{brand.bio}</Text>
        </View>
      ) : null}
      {hasContact ? (
        <View style={styles.aboutBlock}>
          <Text style={styles.aboutBlockLabel}>Contact</Text>
          {brand.contact?.email !== undefined &&
          brand.contact.email.length > 0 ? (
            <Pressable
              onPress={() => onSocialPress(`mailto:${brand.contact?.email}`)}
              accessibilityRole="link"
              accessibilityLabel={`Email ${brand.contact.email}`}
            >
              <Text style={styles.aboutContactLink}>{brand.contact.email}</Text>
            </Pressable>
          ) : null}
          {brand.contact?.phone !== undefined &&
          brand.contact.phone.length > 0 ? (
            <Pressable
              onPress={() => onSocialPress(`tel:${brand.contact?.phone}`)}
              accessibilityRole="link"
              accessibilityLabel={`Call ${brand.contact.phone}`}
            >
              <Text style={styles.aboutContactLink}>{brand.contact.phone}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.aboutBlock}>
        <Text style={styles.aboutBlockLabel}>Find us</Text>
        <SocialLinksRow links={brand.links} onPress={onSocialPress} />
      </View>
    </View>
  );
};

// ---- SocialLinksRow -------------------------------------------------

interface SocialLinksRowProps {
  links?: Brand["links"];
  onPress: (url: string) => void;
  /**
   * Compact mode renders circular icons-only chips (Linktree style).
   * Default false renders labelled pills (used in About tab).
   * NEW in Cycle 7 FX2.
   */
  compact?: boolean;
}

interface SocialEntry {
  url: string;
  icon: IconName;
  label: string;
}

const SocialLinksRow: React.FC<SocialLinksRowProps> = ({
  links,
  onPress,
  compact = false,
}) => {
  const entries = useMemo<SocialEntry[]>(() => {
    if (links === undefined) return [];
    const out: SocialEntry[] = [];
    if (links.website !== undefined && links.website.length > 0) {
      out.push({ url: links.website, icon: "globe", label: "Website" });
    }
    if (links.instagram !== undefined && links.instagram.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.instagram, "https://instagram.com/"),
        icon: "instagram",
        label: "Instagram",
      });
    }
    if (links.tiktok !== undefined && links.tiktok.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.tiktok, "https://tiktok.com/@"),
        icon: "tiktok",
        label: "TikTok",
      });
    }
    if (links.x !== undefined && links.x.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.x, "https://x.com/"),
        icon: "x",
        label: "X",
      });
    }
    if (links.youtube !== undefined && links.youtube.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.youtube, "https://youtube.com/@"),
        icon: "youtube",
        label: "YouTube",
      });
    }
    if (links.threads !== undefined && links.threads.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.threads, "https://threads.net/@"),
        icon: "threads",
        label: "Threads",
      });
    }
    return out;
  }, [links]);

  if (entries.length === 0) return null;

  return (
    <View style={[styles.socialsRow, compact && styles.socialsRowCompact]}>
      {entries.map((s) => (
        <Pressable
          key={s.url}
          onPress={() => onPress(s.url)}
          accessibilityRole="link"
          accessibilityLabel={s.label}
          style={compact ? styles.socialBtnIconOnly : styles.socialBtn}
        >
          <Icon
            name={s.icon}
            size={compact ? 20 : 18}
            color={compact ? accent.warm : textTokens.secondary}
          />
          {compact ? null : <Text style={styles.socialLabel}>{s.label}</Text>}
        </Pressable>
      ))}
    </View>
  );
};

// ---- EventMiniCard --------------------------------------------------

interface EventMiniCardProps {
  event: LiveEvent;
  onPress: (e: LiveEvent) => void;
  past?: boolean;
  /**
   * ORCH-0963 F-5 — sticky "Buy tickets" pill in the bottom-right corner.
   * Decorative for layout only — the full card remains the single hit target
   * (preserves I-38: no separate 44pt touch target nested inside).
   */
  pinCta?: boolean;
}

const EventMiniCard: React.FC<EventMiniCardProps> = ({
  event,
  onPress,
  past = false,
  pinCta = false,
}) => {
  const dateLine = formatDraftDateLine(event);
  const minPrice = useMemo<string | null>(() => {
    const visible = event.tickets.filter(
      (t) => t.visibility !== "hidden" && !t.isFree,
    );
    if (visible.length === 0) {
      return event.tickets.some((t) => t.visibility !== "hidden" && t.isFree)
        ? "Free"
        : null;
    }
    const prices = visible
      .map((t) => t.priceGbp ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return `From ${formatCurrencyRound(prices[0], event.currency ?? "GBP")}`;
  }, [event.currency, event.tickets]);

  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`Open event ${event.name}`}
      style={({ pressed }) => [
        styles.eventCard,
        past && styles.eventCardPast,
        pressed && styles.eventCardPressed,
      ]}
    >
      <EventCoverMedia
        hue={event.coverHue}
        mediaUrl={event.coverMediaUrl}
        mediaType={event.coverMediaType}
        radius={12}
        label=""
        style={styles.eventCover}
      />
      <View style={styles.eventBody}>
        <Text style={styles.eventDate}>{dateLine}</Text>
        <Text style={styles.eventTitle} numberOfLines={2}>
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
        {event.venueName !== null && event.venueName.length > 0 ? (
          <Text style={styles.eventVenue} numberOfLines={1}>
            {event.venueName}
          </Text>
        ) : event.format === "online" || event.format === "hybrid" ? (
          <Text style={styles.eventVenue}>Online event</Text>
        ) : null}
        {minPrice !== null ? (
          <Text style={styles.eventPrice}>{minPrice}</Text>
        ) : null}
      </View>
      {pinCta && !past ? (
        <View
          style={styles.eventBuyPill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.eventBuyPillLabel} accessibilityLabel="Buy tickets">
            Buy tickets
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

// ---- NextEventTeaser (ORCH-0963 new — event-brand above-the-fold polish) ----

interface NextEventTeaserProps {
  event: LiveEvent;
  onPress: (e: LiveEvent) => void;
}

const NextEventTeaser: React.FC<NextEventTeaserProps> = ({ event, onPress }) => {
  const dateLine = formatDraftDateLine(event);
  const minPrice = useMemo<string | null>(() => {
    // Mirror EventMiniCard pricing logic to preserve I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED
    // honesty (no fabricated prices; null surfaces as omitted UI).
    const visible = event.tickets.filter(
      (t) => t.visibility !== "hidden" && !t.isFree,
    );
    if (visible.length === 0) {
      return event.tickets.some((t) => t.visibility !== "hidden" && t.isFree)
        ? "Free"
        : null;
    }
    const prices = visible
      .map((t) => t.priceGbp ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return `From ${formatCurrencyRound(prices[0], event.currency ?? "GBP")}`;
  }, [event.currency, event.tickets]);

  const eventName = event.name.length > 0 ? event.name : "Untitled event";
  const bodyText =
    minPrice !== null
      ? `${dateLine} · ${eventName}  ·  ${minPrice}`
      : `${dateLine} · ${eventName}`;

  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`Next event ${eventName}`}
      style={({ pressed }) => [
        styles.nextTeaser,
        pressed && styles.nextTeaserPressed,
      ]}
    >
      <Text style={styles.nextTeaserLabel}>NEXT</Text>
      <Text style={styles.nextTeaserBody} numberOfLines={1}>
        {bodyText}
      </Text>
      <Text style={styles.nextTeaserArrow}>→</Text>
    </Pressable>
  );
};

// ---- TripMiniCard (ORCH-0963 new — trip-brand body card) -----------

interface TripMiniCardProps {
  trip: PublicTripCard;
  onPress: (t: PublicTripCard) => void;
  past?: boolean;
}

const TripMiniCard: React.FC<TripMiniCardProps> = ({
  trip,
  onPress,
  past = false,
}) => {
  const dateLine = formatTripDateRange(trip.startAt, trip.endAt, trip.timezone);

  const priceLabel = useMemo<string | null>(() => {
    if (trip.minPriceCents !== null && trip.currency !== null) {
      return `From ${formatCurrencyRound(trip.minPriceCents / 100, trip.currency)}`;
    }
    if (trip.hasFreeTier) return "Free";
    return null;
  }, [trip.minPriceCents, trip.currency, trip.hasFreeTier]);

  // ORCH-0963 SC-2 honesty rules:
  //   - null spotsLeft (unlimited capacity) → no badge, never "null spots left"
  //   - 0 spotsLeft → "Sold out"
  //   - 1..5 spotsLeft → "N spot/spots left" (scarcity prompt)
  //   - >5 spotsLeft → no badge (non-scarce; visual noise)
  // Adversarial T-05 + T-07 guard against regression.
  const spotsLabel = useMemo<string | null>(() => {
    if (trip.spotsLeft === null) return null;
    if (trip.spotsLeft === 0) return "Sold out";
    if (trip.spotsLeft <= 5) {
      return `${trip.spotsLeft} ${trip.spotsLeft === 1 ? "spot" : "spots"} left`;
    }
    return null;
  }, [trip.spotsLeft]);

  // Deterministic hue fallback for cover-less trips (trips have no cover_hue
  // column; events do). Per memory rule [[rn-color-formats]], use hsl() only —
  // RN normalize-colors rejects oklch/lab/lch/color-mix silently.
  const fallbackHue = useMemo<number>(() => hashHueFromString(trip.id), [trip.id]);

  return (
    <Pressable
      onPress={() => onPress(trip)}
      accessibilityRole="button"
      accessibilityLabel={`Open trip ${trip.title}`}
      style={({ pressed }) => [
        styles.eventCard,
        past && styles.eventCardPast,
        pressed && styles.eventCardPressed,
      ]}
    >
      <EventCoverMedia
        hue={fallbackHue}
        mediaUrl={trip.coverMediaUrl}
        mediaType={trip.coverMediaType}
        radius={12}
        label=""
        style={styles.eventCover}
      />
      <View style={styles.eventBody}>
        {dateLine.length > 0 ? (
          <Text style={styles.eventDate}>{dateLine}</Text>
        ) : null}
        <Text style={styles.eventTitle} numberOfLines={2}>
          {trip.title.length > 0 ? trip.title : "Untitled trip"}
        </Text>
        {trip.destinationText !== null && trip.destinationText.length > 0 ? (
          <Text style={styles.eventVenue} numberOfLines={1}>
            {trip.destinationText}
          </Text>
        ) : null}
        <View style={styles.tripFooterRow}>
          {priceLabel !== null ? (
            <Text style={styles.eventPrice}>{priceLabel}</Text>
          ) : (
            <View />
          )}
          {trip.bookingsClosed ? (
            <View style={styles.tripBadgeClosed}>
              <Text style={styles.tripBadgeLabel}>Booking closed</Text>
            </View>
          ) : spotsLabel !== null ? (
            <View style={styles.tripBadgeScarce}>
              <Text style={styles.tripBadgeLabel}>{spotsLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

// ---- Helpers --------------------------------------------------------

// ORCH-0963 — deterministic hue fallback for cover-less trips. Hash the trip
// UUID into an integer 0-359 for `hsl(h, 60%, 45%)`. Same trip → same hue
// across re-renders + reloads. Per memory rule [[rn-color-formats]] only
// hsl/hex/rgb/hwb are RN-safe.
const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

// ORCH-0963 — format a trip date range from start_at + end_at + timezone.
// Same-day → "Fri 19 Sep"; same-month → "19 – 22 Sep 2026"; cross-month →
// "30 Sep – 3 Oct 2026"; cross-year → "30 Dec 2026 – 3 Jan 2027". Returns
// empty string when either bound is null. Defensive guard: if end < start
// (data corruption), renders start only.
const formatTripDateRange = (
  startAtIso: string | null,
  endAtIso: string | null,
  timezone: string | null,
): string => {
  if (startAtIso === null) return "";
  const tz = timezone ?? "UTC";
  const start = new Date(startAtIso);
  if (Number.isNaN(start.getTime())) return "";
  // No end → start-only
  if (endAtIso === null) {
    return start.toLocaleDateString("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const end = new Date(endAtIso);
  if (Number.isNaN(end.getTime())) {
    return start.toLocaleDateString("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  // Defensive — end before start indicates data corruption; render start only.
  if (end.getTime() < start.getTime()) {
    return start.toLocaleDateString("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const startKey = start.toLocaleDateString("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const endKey = end.toLocaleDateString("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Same calendar day in timezone
  if (startKey === endKey) {
    return start.toLocaleDateString("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  const startYear = start.toLocaleDateString("en-GB", {
    timeZone: tz,
    year: "numeric",
  });
  const endYear = end.toLocaleDateString("en-GB", {
    timeZone: tz,
    year: "numeric",
  });
  const startMonth = start.toLocaleDateString("en-GB", {
    timeZone: tz,
    month: "short",
  });
  const endMonth = end.toLocaleDateString("en-GB", {
    timeZone: tz,
    month: "short",
  });
  const startDay = start.toLocaleDateString("en-GB", {
    timeZone: tz,
    day: "numeric",
  });
  const endDay = end.toLocaleDateString("en-GB", {
    timeZone: tz,
    day: "numeric",
  });
  // Cross-year
  if (startYear !== endYear) {
    return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
  }
  // Cross-month, same year
  if (startMonth !== endMonth) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`;
  }
  // Same month, same year
  return `${startDay} – ${endDay} ${endMonth} ${endYear}`;
};

const normalizeSocialUrl = (raw: string, base: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // Strip leading @ if present
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return `${base}${handle}`;
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  heroWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    zIndex: 0,
    overflow: "hidden",
  },
  heroGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Defensive fallback — visible if inline color fails for any reason.
    // Inline override at the call site uses hsl(brand.coverHue, 60%, 45%).
    // Use hsl/rgb/hex/hwb ONLY — RN normalize-colors rejects oklch/lab/lch
    // (CSS Color Module 4 functions are web-only on inline RN styles).
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  heroFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // 30% body-color overlay — keeps a subtle bottom-edge fade without
    // dimming the cover hue into invisibility (Cycle 7 FX3 reduced from
    // 0.55, which made even valid colors read as near-black on web).
    backgroundColor: "rgba(12, 14, 18, 0.30)",
  },
  floatingChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  scroll: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  // Cycle 7 FX2 — Linktree-style centered identity column.
  identityCentered: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  heroAvatarCentered: {
    marginTop: -42,
  },
  brandNameCentered: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: textTokens.primary,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  handleLineCentered: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
    textAlign: "center",
  },
  brandName: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: textTokens.primary,
  },
  handleLine: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  // Cycle 7 FX2 — centered bio with max-width.
  bioLeadCentered: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: "center",
    maxWidth: 540,
    alignSelf: "center",
    paddingHorizontal: spacing.sm,
  },
  // ORCH-0963: statsCard / statsRow / statCol / statValue / statLabel removed
  // along with the EVENTS-count tile per SC-12. NextEventTeaser owns the
  // above-fold "next thing" message for event brands; trip brands use the
  // Trips tab badge for their count.
  venueCard: {
    marginTop: spacing.md,
    gap: spacing.md,
    width: "100%",
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  categoryChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  categoryChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: accent.warm,
  },
  // ORCH-0963 — NextEventTeaser strip styles. Sits between bio and tabs for
  // event-brands. Horizontal pill, full width, 1-line body.
  nextTeaser: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginBottom: spacing.md,
  },
  nextTeaserPressed: {
    opacity: 0.85,
  },
  nextTeaserLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
  },
  nextTeaserBody: {
    flex: 1,
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "500",
  },
  nextTeaserArrow: {
    fontSize: 16,
    color: accent.warm,
    fontWeight: "700",
  },
  // ORCH-0963 — EventMiniCard sticky "Buy tickets" pill (first 3 upcoming cards).
  eventBuyPill: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  eventBuyPillLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0c0e12",
    letterSpacing: 0.2,
  },
  // ORCH-0963 — TripMiniCard footer row (price-left, badge-right).
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
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  tripBadgeScarce: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  tripBadgeLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: 0.2,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: spacing.md,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabButtonActive: {
    borderBottomColor: accent.warm,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  tabLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  tabCount: {
    color: textTokens.quaternary,
    fontWeight: "400",
  },
  eventList: {
    gap: spacing.sm,
  },
  eventCard: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  eventCardPast: {
    opacity: 0.7,
  },
  eventCardPressed: {
    opacity: 0.6,
  },
  eventCover: {
    width: 96,
    height: 116,
  },
  eventBody: {
    flex: 1,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  eventDate: {
    fontSize: 10,
    color: accent.warm,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  eventVenue: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginBottom: 6,
  },
  eventPrice: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  emptyTabWrap: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTabTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  emptyTabBody: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
    maxWidth: 280,
    marginBottom: spacing.sm,
  },
  aboutWrap: {
    gap: spacing.lg,
  },
  aboutBlock: {
    gap: spacing.xs,
  },
  aboutBlockLabel: {
    fontSize: 11,
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  aboutBlockBody: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
  },
  aboutContactLink: {
    fontSize: 14,
    color: accent.warm,
    paddingVertical: 4,
  },
  socialsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  // Cycle 7 FX2 — Linktree-style icons-only row, centered.
  socialsRowCompact: {
    justifyContent: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  // Cycle 7 FX2 — circular icon-only chip for compact mode.
  socialBtnIconOnly: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  socialLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  footer: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  footerText: {
    fontSize: 11,
    color: textTokens.quaternary,
  },
});

export default PublicBrandPage;
