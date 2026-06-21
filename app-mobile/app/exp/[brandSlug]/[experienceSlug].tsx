/**
 * Expo Router deep-link for /exp/{brandSlug}/{experienceSlug} (ORCH-1183
 * [experience-standardize]).
 *
 * THE consumer cold deep-link route for an experience — previously NONE existed
 * (the consumer experience flow only ever opened from the deck SEED). Mirrors
 * app/t/[brandSlug]/[tripSlug].tsx + app/e/[brandSlug]/[eventSlug].tsx.
 *
 * Resolves the experience by slug via the ONE canonical anon RPC
 * (useConsumerExperienceDetail → pg_public_experience_by_slug, the SAME read the
 * buyer-web /exp/ page uses), synthesizes a BusinessEventCard SEED from the detail,
 * and mounts the existing ConsumerExperienceDetailScreen — so the cold deep-link
 * reuses the entire proven reserve flow (tickets via usePublicEventTickets, the
 * occurrence/open-daily pickers, the byte-identical checkout) AND renders the SAME
 * shared ExperienceOfferingBody as the deck path. The deck SEED path is unchanged.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import ConsumerExperienceDetailScreen from "../../../src/screens/Experience/ConsumerExperienceDetailScreen";
import { useConsumerExperienceDetail } from "../../../src/hooks/useConsumerExperienceDetail";
import { hueFromId } from "../../../src/utils/hueFromId";
import type { BusinessEventCard } from "../../../src/types/mergedDiscover";

const ACCENT = "#FF6B35";

// START HERE / THEN / END WITH from index + count (mirrors the seed mappers).
function stopLabel(index: number, total: number): "Start Here" | "Then" | "End With" {
  if (index === 0) return "Start Here";
  if (index === total - 1 && total > 1) return "End With";
  return "Then";
}

export default function ExperienceDeepLinkScreen(): React.ReactElement | null {
  const router = useRouter();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    experienceSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const experienceSlug = Array.isArray(params.experienceSlug)
    ? params.experienceSlug[0]
    : params.experienceSlug;

  const onBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const { detail, isLoading, isError } = useConsumerExperienceDetail(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof experienceSlug === "string" ? experienceSlug : null,
  );

  if (typeof brandSlug !== "string" || typeof experienceSlug !== "string") {
    return null;
  }

  if (isLoading) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (isError || detail === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Experience not found</Text>
        <Text style={styles.stateSub}>
          This experience may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  // Synthesize the BusinessEventCard seed the screen's reserve flow reads. The
  // screen re-fetches tickets via usePublicEventTickets(seed.eventId), so the seed
  // carries no ticket fields — only the display + occurrence + recurrence data.
  const seed: BusinessEventCard = {
    eventId: detail.experienceId,
    brandId: detail.brandId,
    brandSlug: detail.brandSlug,
    brandName: detail.brandName,
    brandProfilePhotoUrl: detail.brandCoverMediaUrl,
    eventSlug: detail.experienceSlug,
    title: detail.title,
    description: detail.description,
    coverMediaUrl: detail.coverMediaUrl,
    coverMediaType: detail.coverMediaType,
    coverHue: detail.brandCoverHue ?? hueFromId(detail.experienceId),
    masterDateUtc: detail.occurrences[0]?.startAt ?? null,
    masterEndAtUtc: detail.occurrences[0]?.endAt ?? null,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: detail.timezone,
    venueName: detail.venueText,
    city: detail.venueText,
    address: null,
    hideAddressUntilTicket: true,
    format: "in-person",
    locationGeo:
      detail.stops[0]?.lat != null && detail.stops[0]?.lng != null
        ? { lat: detail.stops[0].lat, lng: detail.stops[0].lng }
        : null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: detail.ticket !== null ? detail.ticket.priceCents / 100 : null,
    priceMax: detail.ticket !== null ? detail.ticket.priceCents / 100 : null,
    displayPriceCents: detail.ticket?.priceCents ?? null,
    displayCurrency: detail.currency,
    currency: detail.currency,
    publicBuyerUrl: `https://business.usemingla.com/exp/${detail.brandSlug}/${detail.experienceSlug}`,
    experienceStops: detail.stops.map((s, idx) => ({
      stopNumber: s.stopOrder + 1,
      placeName: s.placeName,
      address: s.address,
      imageUrl: s.imageUrls[0] ?? null,
      aiDescription: s.description,
      imageUrls: s.imageUrls,
      lat: s.lat,
      lng: s.lng,
      startTime: s.startTime,
      stopLabel: stopLabel(idx, detail.stops.length),
    })),
    experienceIntents: detail.intents,
    brandTheme: {
      color: detail.brandTheme?.color ?? null,
      font: detail.brandTheme?.font ?? null,
      animation: detail.brandTheme?.animation ?? null,
      color_override: detail.brandTheme?.colorOverride ?? null,
      font_override: detail.brandTheme?.fontOverride ?? null,
      animation_override: detail.brandTheme?.animationOverride ?? null,
    },
    upcomingOccurrences: detail.occurrences.map((o) => ({
      eventDateId: o.eventDateId,
      startAt: o.startAt,
      endAt: o.endAt,
      capacity: null,
      sold: 0,
      remaining: o.remaining,
    })),
    isRecurring: detail.isRecurring,
    recurrenceRule: detail.recurrenceRule,
  };

  return (
    <ConsumerExperienceDetailScreen
      seed={seed}
      tabBarAware={false}
      onBack={onBack}
    />
  );
}

const styles = StyleSheet.create({
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  stateSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
  },
});
