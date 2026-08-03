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
import {
  ParallaxCoverShell,
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
} from "@mingla/offering-rendering";

import { VenueReserveSheet } from "../components/expandedCard/VenueReserveSheet";
import { usePublicVenue } from "../hooks/usePublicVenue";
import { postHogService } from "../services/postHogService";
import { captureVenueOrganicEvent } from "../services/venueOrganicCaptureService";
import { ConsumerStayGuestExperience } from "../components/stay/ConsumerStayGuestExperience";
import { captureNativeStayRouteAttribution } from "../services/nativeAdAttributionService";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  useEffect(() => {
    if (venue?.venueCategory !== "stay" || stayViewFired.current) return;
    stayViewFired.current = true;
    postHogService.capture("stay_viewed", {
      surface: "consumer_native",
      brand_id: venue.brandId,
      venue_id: venue.id,
    });
  }, [venue]);
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
      (venue.venueCategory === "stay" ||
        venue.reservability.state === "available")
      ? "reservations"
      : "overview";
  const menuCount = venue.menu.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  const isStay = venue.venueCategory === "stay";

  const overview = (
    <View style={styles.pane}>
      {venue.pitch !== null && venue.pitch.trim().length > 0 ? (
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {venue.pitch.trim()}
        </Text>
      ) : null}
      {venue.address !== null ? (
        <View style={[styles.card, surface.card]}>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            WHERE YOU’LL BE
          </Text>
          <Text style={[styles.body, { color: palette.primaryText }]}>
            {venue.address}
          </Text>
        </View>
      ) : null}
      {venue.hours.length > 0 ? (
        <View style={[styles.card, surface.card]}>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            HOURS
          </Text>
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
      ) : null}
      {venue.galleryPhotoUrls.length > 0 ? (
        <View style={styles.gallery}>
          {venue.galleryPhotoUrls.slice(0, 4).map((url) => (
            <Image key={url} source={{ uri: url }} style={styles.photo} />
          ))}
        </View>
      ) : null}
    </View>
  );

  const reservations = isStay ? (
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
  ) : venue.reservability.state === "available" ? (
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
              accessibilityLabel="Find a table"
              style={[
                styles.reserveButton,
                { backgroundColor: palette.accent },
              ]}
            >
              <Text
                style={[styles.reserveLabel, { color: palette.accentText }]}
              >
                Find a table
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
        This venue isn’t taking reservations right now.
      </Text>
    );

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
            hasMenu={!isStay && menuCount > 0}
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
      {!isStay && venue.reservability.state === "available" ? (
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
