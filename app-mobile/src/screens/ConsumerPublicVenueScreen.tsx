import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PublicMenuSections,
  PublicVenueTabs,
  type PublicVenueTab,
} from "@mingla/brand-rendering";
// #1558 — the venue category, as DATA. Same total profile table the buyer-web
// page reads, so the two surfaces cannot disagree about what a hotel is.
import {
  stayClockLabel,
  typicalSpendVisible,
  venueCategoryProfile,
  venueMenuTabVisible,
  venueNotTakingReservationsCopy,
  type VenueBookingBody,
  type VenueCategoryProfile,
  type VenueSectionId,
} from "@mingla/brand-rendering/venueCategoryProfile";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";
import {
  ParallaxCoverShell,
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";

import { VenueReserveSheet } from "../components/expandedCard/VenueReserveSheet";
import { usePublicVenue } from "../hooks/usePublicVenue";
import { usePublicStayDetail } from "../hooks/useStayGuest";
import type { ConsumerPublicVenue } from "../services/publicVenueService";
import { postHogService } from "../services/postHogService";
import { captureVenueOrganicEvent } from "../services/venueOrganicCaptureService";
import { ConsumerStayGuestExperience } from "../components/stay/ConsumerStayGuestExperience";
import { captureNativeStayRouteAttribution } from "../services/nativeAdAttributionService";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ═══════════════════════════════════════════════════════════════════════════
// #1558 — the Overview pane, resolved from `profile.overview` through a total
// registry, exactly as the buyer-web page does. Same section ids, same order
// data, one shared profile table — which is what stops this screen and
// PublicVenuePage.tsx disagreeing about what a hotel is while #1559 is still
// pending. The RENDERERS are still per-app (this screen has no map, no
// discovery price and its own gallery grid); #1559 collapses them into one.
// ═══════════════════════════════════════════════════════════════════════════

type Surface = ReturnType<typeof offeringSurfaceStyles>;

interface ConsumerVenueSectionProps {
  venue: ConsumerPublicVenue;
  stayDetail: PublicStayDetail | null;
  profile: VenueCategoryProfile;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
}

/**
 * The consumer read model (`ConsumerPublicVenue`) carries no discovery price —
 * `publicVenueService.ts` drops nine columns the very same view already serves.
 * So this surface's price lede has a MODEL (`profile.pricing`) and no data, and
 * renders nothing rather than inventing a number (Constitution #9).
 * #1559/#1560 give this screen the buyer-web view model; #1562 owns the Stay
 * "from" rate. Until then this is honestly empty, not silently missing.
 */
const ConsumerVenuePriceLedeSection: React.FC<ConsumerVenueSectionProps> = ({
  profile,
}) => {
  if (!typicalSpendVisible(profile, false)) return null;
  return null;
};

const ConsumerVenueAboutSection: React.FC<ConsumerVenueSectionProps> = ({
  venue,
  palette,
}) => {
  const pitch = venue.pitch !== null ? venue.pitch.trim() : "";
  if (pitch.length === 0) return null;
  return (
    <Text style={[styles.body, { color: palette.secondaryText }]}>{pitch}</Text>
  );
};

const ConsumerVenueLocationSection: React.FC<ConsumerVenueSectionProps> = ({
  venue,
  palette,
  surface,
}) => {
  if (venue.address === null) return null;
  return (
    <View style={[styles.card, surface.card]}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>
        WHERE YOU’LL BE
      </Text>
      <Text style={[styles.body, { color: palette.primaryText }]}>
        {venue.address}
      </Text>
    </View>
  );
};

/**
 * Only ever mounted for a category whose profile says
 * `timekeeping: "tradingHours"`. A Stay lists `stayPolicy` in its place, which
 * is why a hotel on this screen no longer publishes a weekly closing time.
 */
const ConsumerVenueHoursSection: React.FC<ConsumerVenueSectionProps> = ({
  venue,
  palette,
  surface,
}) => {
  if (venue.hours.length === 0) return null;
  return (
    <View style={[styles.card, surface.card]}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>HOURS</Text>
      {venue.hours.map((hour) => (
        <View key={hour.weekday} style={styles.hourRow}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            {WEEKDAYS[hour.weekday] ?? hour.weekday}
          </Text>
          <Text style={[styles.body, { color: palette.primaryText }]}>
            {hour.isClosed || hour.openTime === null
              ? "Closed"
              : `${hour.openTime}–${hour.closeTime ?? ""}`}
          </Text>
        </View>
      ))}
    </View>
  );
};

/** #1558 — what a Stay has INSTEAD of trading hours, on this surface too. */
const ConsumerVenueStayPolicySection: React.FC<ConsumerVenueSectionProps> = ({
  stayDetail,
  palette,
  surface,
}) => {
  if (stayDetail === null) return null;
  const houseRules =
    stayDetail.houseRules !== null && stayDetail.houseRules.trim().length > 0
      ? stayDetail.houseRules.trim()
      : null;
  return (
    <View style={[styles.card, surface.card]}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>
        CHECK-IN &amp; CHECK-OUT
      </Text>
      <View style={styles.hourRow}>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Check-in
        </Text>
        <Text style={[styles.body, { color: palette.primaryText }]}>
          {stayClockLabel(stayDetail.checkInTime)}
        </Text>
      </View>
      <View style={styles.hourRow}>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Check-out
        </Text>
        <Text style={[styles.body, { color: palette.primaryText }]}>
          {stayClockLabel(stayDetail.checkOutTime)}
        </Text>
      </View>
      {houseRules !== null ? (
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {houseRules}
        </Text>
      ) : null}
    </View>
  );
};

const ConsumerVenueGallerySection: React.FC<ConsumerVenueSectionProps> = ({
  venue,
}) => {
  if (venue.galleryPhotoUrls.length === 0) return null;
  return (
    <View style={styles.gallery}>
      {venue.galleryPhotoUrls.slice(0, 4).map((url) => (
        <Image key={url} source={{ uri: url }} style={styles.photo} />
      ))}
    </View>
  );
};

/** Total registry — a section id without a renderer does not compile. */
const CONSUMER_VENUE_SECTIONS: Record<
  VenueSectionId,
  React.FC<ConsumerVenueSectionProps>
> = {
  priceLede: ConsumerVenuePriceLedeSection,
  about: ConsumerVenueAboutSection,
  location: ConsumerVenueLocationSection,
  hours: ConsumerVenueHoursSection,
  stayPolicy: ConsumerVenueStayPolicySection,
  gallery: ConsumerVenueGallerySection,
};

type VenueRouteParams = {
  [key: string]: string | string[] | undefined;
  brandSlug: string | string[];
  venueSlug: string | string[];
  tab?: string | string[];
};

export default function ConsumerPublicVenueScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<VenueRouteParams>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const venueSlug = Array.isArray(params.venueSlug)
    ? params.venueSlug[0]
    : params.venueSlug;
  const requested = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const query = usePublicVenue(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof venueSlug === "string" ? venueSlug : null,
  );
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserved, setReserved] = useState(false);
  const [muted, setMuted] = useState(true);
  const stayViewFired = useRef(false);
  const attributionFired = useRef(false);

  useEffect(() => {
    if (attributionFired.current) return;
    if (typeof brandSlug !== "string" || typeof venueSlug !== "string") return;
    attributionFired.current = true;
    void captureNativeStayRouteAttribution({ brandSlug, venueSlug, params });
  }, [brandSlug, params, venueSlug]);

  const venue = query.data ?? null;
  // #1558 — the ONE category read on this screen. Everything that branched on
  // `isStay` now reads a field of this profile, and a NULL category gets the
  // named `uncategorised` arm instead of silently becoming a restaurant.
  const profile = venueCategoryProfile(venue?.venueCategory ?? null);
  // The check-in / check-out times a Stay shows INSTEAD of trading hours. Same
  // query key the Reservations tab already uses (`stayGuestKeys.detail`), so
  // React Query serves both from one fetch; disabled for every other category.
  const stayDetailQuery = usePublicStayDetail(
    venue?.id ?? null,
    profile.bookingBody === "stay",
  );
  useEffect(() => {
    if (
      venue === null ||
      profile.bookingBody !== "stay" ||
      stayViewFired.current
    ) {
      return;
    }
    stayViewFired.current = true;
    postHogService.capture("stay_viewed", {
      surface: "consumer_native",
      brand_id: venue.brandId,
      venue_id: venue.id,
    });
  }, [profile, venue]);
  const captureVenueFunnel = useCallback(
    (
      event:
        | "venue_availability_result_viewed"
        | "venue_reservation_slot_selected"
        | "venue_reservation_failed",
      resultClass?: "phone_invalid" | "create_failed",
    ): void => {
      if (venue === null) return;
      postHogService.capture(event, {
        surface: "consumer_native",
        brand_id: venue.brandId,
        venue_id: venue.id,
        ...(resultClass === undefined ? {} : { result_class: resultClass }),
      });
    },
    [venue],
  );
  const onAvailabilityResultViewed = useCallback(
    () => {
      captureVenueFunnel("venue_availability_result_viewed");
      if (venue !== null) {
        void captureVenueOrganicEvent(
          { brandId: venue.brandId, venueId: venue.id },
          "availability_shown",
        );
      }
    },
    [captureVenueFunnel, venue],
  );
  const onSlotSelected = useCallback(
    () => captureVenueFunnel("venue_reservation_slot_selected"),
    [captureVenueFunnel],
  );
  const onReservationFailed = useCallback(
    (resultClass: "phone_invalid" | "create_failed") =>
      captureVenueFunnel("venue_reservation_failed", resultClass),
    [captureVenueFunnel],
  );
  const theme = useMemo(
    () => resolveTheme(venue?.theme ?? null, null),
    [venue?.theme],
  );
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);

  if (query.isLoading || query.isFetching) {
    return <StateView title="Loading venue…" loading />;
  }
  if (query.isError) {
    return (
      <StateView
        title="This venue could not load"
        body="Try the link again in a moment."
      />
    );
  }
  if (venue === null) {
    return (
      <StateView title="Venue not found" body="This venue is not public." />
    );
  }

  const initialTab: PublicVenueTab =
    requested === "reservations" &&
      (profile.bookingBody === "stay" ||
        venue.reservability.state === "available")
      ? "reservations"
      : "overview";
  const menuCount = venue.menu.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );

  const sectionProps: ConsumerVenueSectionProps = {
    venue,
    stayDetail: stayDetailQuery.data ?? null,
    profile,
    palette,
    surface,
    theme,
  };

  // #1558 — `profile.overview` IS the layout. A restaurant lists `hours`; a
  // hotel lists `stayPolicy`, so this screen stops publishing a hotel's weekly
  // closing time next to a booking tab that says check-in is at three.
  const overview = (
    <View style={styles.pane}>
      {profile.overview.map((sectionId) => {
        const Section = CONSUMER_VENUE_SECTIONS[sectionId];
        return <Section key={sectionId} {...sectionProps} />;
      })}
    </View>
  );

  // #1558 — which booking body mounts is DATA, through a total record. The
  // bodies stay app-side because the fork is a payment rail (native
  // PaymentSheet here, Stripe.js Payment Element on web).
  const reservationBodies: Record<VenueBookingBody, () => React.ReactNode> = {
    stay: () => (
      <View style={styles.pane}>
        <ConsumerStayGuestExperience
          venueId={venue.id}
          venueName={venue.name}
          brandId={venue.brandId}
          palette={palette}
          surface={surface}
          theme={theme}
        />
      </View>
    ),
    table: () =>
      venue.reservability.state === "available" ? (
        <View style={styles.pane}>
          {reserved ? (
            <Text style={[styles.title, { color: palette.primaryText }]}>
              Your table is reserved
            </Text>
          ) : (
            <>
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                Choose your party, date, and a real available time.
              </Text>
              <Pressable
                onPress={() => {
                  setReserveOpen(true);
                  postHogService.capture("public_venue_reservation_started", {
                    surface: "consumer_native",
                    brand_id: venue.brandId,
                    venue_id: venue.id,
                  });
                  void captureVenueOrganicEvent(
                    { brandId: venue.brandId, venueId: venue.id },
                    "reservation_start",
                  );
                }}
                accessibilityRole="button"
                // #1558 — was the hardcoded "Find a table", a fourth competing
                // reserve string. One string per category now, shared with the
                // buyer-web CTA and the sheet heading.
                accessibilityLabel={profile.reserveAction}
                style={[
                  styles.reserveButton,
                  { backgroundColor: palette.accent },
                ]}
              >
                <Text
                  style={[styles.reserveLabel, { color: palette.accentText }]}
                >
                  {profile.reserveAction}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : venue.reservability.state === "error" ? (
        <View style={styles.pane}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            We couldn’t check reservations right now.
          </Text>
          <Pressable
            onPress={() => {
              void query.refetch();
            }}
            accessibilityRole="button"
            accessibilityLabel="Try checking reservations again"
            style={[styles.retryButton, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.reserveLabel, { color: palette.accentText }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {venueNotTakingReservationsCopy(profile)}
        </Text>
      ),
  };
  const reservations = reservationBodies[profile.bookingBody]();

  return (
    <View style={styles.host}>
      <ParallaxCoverShell
        palette={palette}
        theme={theme}
        coverMediaUrl={venue.coverMediaUrl}
        coverMediaType={venue.coverMediaType}
        coverHue={venue.coverHue}
        entranceAnimationKey={`venue:${venue.id}`}
        muted={muted}
        onToggleMute={() => setMuted((value) => !value)}
        showMute={venue.coverMediaType === "video"}
        onClose={() => router.back()}
        onShare={() => {
          void Share.share({
            url: `https://business.usemingla.com/b/${venue.brandSlug}/v/${venue.slug}`,
          });
        }}
        safeAreaTop={insets.top}
        contentBottomInset={insets.bottom + 24}
      >
        <View style={styles.bodyWrap}>
          <Text style={[styles.eyebrow, { color: palette.accent }]}>
            VERIFIED VENUE
          </Text>
          <Text style={[styles.title, { color: palette.primaryText }]}>
            {venue.name}
          </Text>
          <Text style={[styles.body, { color: palette.tertiaryText }]}>
            By {venue.brandName}
          </Text>
          <PublicVenueTabs
            initialTab={initialTab}
            // #1558 — the twin of PublicVenuePage.tsx's gate, now ONE function
            // over the profile's `tabs` array. #1536 flips it by editing that
            // array, in one file, for all five surfaces at once.
            hasMenu={venueMenuTabVisible(profile, menuCount)}
            overview={overview}
            menu={
              <PublicMenuSections
                groups={venue.menu}
                palette={palette}
                surface={surface}
                theme={theme}
              />
            }
            reservations={reservations}
            palette={palette}
            surface={surface}
            theme={theme}
            onTabViewed={(tab: PublicVenueTab) => {
              if (tab === "menu" || tab === "overview") {
                postHogService.capture(
                  tab === "menu"
                    ? "public_venue_menu_viewed"
                    : "public_venue_overview_viewed",
                  {
                    surface: "consumer_native",
                    brand_id: venue.brandId,
                    venue_id: venue.id,
                  },
                );
                void captureVenueOrganicEvent(
                  { brandId: venue.brandId, venueId: venue.id },
                  tab === "menu" ? "menu_open" : "page_view",
                );
              }
            }}
          />
        </View>
      </ParallaxCoverShell>
      {profile.bookingBody === "table" &&
      venue.reservability.state === "available" ? (
        <VenueReserveSheet
          visible={reserveOpen}
          onClose={() => setReserveOpen(false)}
          venueId={venue.reservability.venueId}
          brandId={venue.brandId}
          venueName={venue.name}
          currency={venue.reservability.currency}
          onAvailabilityResultViewed={onAvailabilityResultViewed}
          onSlotSelected={onSlotSelected}
          onReservationFailed={onReservationFailed}
          onReserved={() => {
            setReserveOpen(false);
            setReserved(true);
            postHogService.capture("venue_reservation_completed", {
              surface: "consumer_native",
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
          }}
        />
      ) : null}
    </View>
  );
}

function StateView({
  title,
  body,
  loading = false,
}: {
  title: string;
  body?: string;
  loading?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body !== undefined ? <Text style={styles.stateBody}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  bodyWrap: { gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  body: { fontSize: 14, lineHeight: 21 },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  pane: { gap: 16 },
  card: { borderRadius: 16, padding: 16, gap: 8 },
  hourRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: "48%", aspectRatio: 4 / 3, borderRadius: 12 },
  reserveButton: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 999,
  },
  retryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 18,
  },
  reserveLabel: { fontSize: 16, fontWeight: "900" },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  stateBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    textAlign: "center",
  },
});
