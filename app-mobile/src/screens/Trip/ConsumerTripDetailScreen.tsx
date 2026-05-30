/**
 * ConsumerTripDetailScreen — in-app full-screen trip detail (ORCH-1016).
 *
 * Mirrors the STRUCTURE of mingla-business app/t/[brandSlug]/[tripSlug].tsx:
 * full-bleed cover hero + X-close/share, deadline/refund band, "Leaving from"
 * meta (above destination), itinerary, inclusions, tiers, sticky Reserve CTA.
 *
 * Anon-read constraint (🔒 COMMS-0009): all data comes from useConsumerTripDetail
 * (anon-direct events/trip_* reads + RPC-sourced brand fields). NEVER `.from('brands')`.
 *
 * Reserve CTA enforcement (🔒 F.3): disabled when bookings_closed OR past deadline,
 * belt-and-suspenders with the feed RPC's WHERE (a deep-linked/stale detail re-enforces).
 *
 * Buyer flow (§F): Reserve opens the proven ExpandedBusinessEventSheet (tier
 * select → cart → tax-preview address → runNativeCheckout). The trip's tier
 * `ticket_type_id`s map onto the same `lines` contract; intake answers (when a
 * schema exists — none today) ride the nativeCheckoutFlow `intakeFormData` body
 * key → orders.intake_form_data.
 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventCoverMedia, formatTripDateRange, RefundPolicyDisplay } from "@mingla/event-rendering";

import { Icon } from "../../components/ui/Icon";
import { ExpandedBusinessEventSheet } from "../../components/expandedCard/ExpandedBusinessEventSheet";
import { hueFromId } from "../../utils/hueFromId";
import {
  useConsumerTripDetail,
  type ConsumerTripDetail,
} from "../../hooks/useConsumerTripDetail";
import type { DiscoverTripRow } from "../../services/tripsDiscoveryService";
import type { BusinessEventCard } from "../../types/mergedDiscover";

interface ConsumerTripDetailScreenProps {
  brandSlug: string;
  tripSlug: string;
  seed?: DiscoverTripRow | null;
  onBack: () => void;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}

const SCREEN_BG = "#0c0e12";
const ACCENT = "#FF6B35";
const WARM = "#eb7825";

function formatMoney(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${code}`;
  }
}

function deadlineState(detail: ConsumerTripDetail): {
  closed: boolean;
  countdownLabel: string | null;
} {
  if (detail.bookingsClosed) return { closed: true, countdownLabel: null };
  if (detail.bookingDeadline === null) return { closed: false, countdownLabel: null };
  const ms = new Date(detail.bookingDeadline).getTime() - Date.now();
  if (ms <= 0) return { closed: true, countdownLabel: null };
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const label =
    days >= 1
      ? `Bookings close in ${days} day${days === 1 ? "" : "s"}`
      : `Bookings close in ${hours} hour${hours === 1 ? "" : "s"}`;
  return { closed: false, countdownLabel: label };
}

// Map the trip detail onto the BusinessEventCard shape ExpandedBusinessEventSheet
// consumes — so the proven cart → tax → runNativeCheckout path is reused verbatim.
function tripToBusinessEventCard(d: ConsumerTripDetail): BusinessEventCard {
  return {
    eventId: d.tripId,
    brandId: "",
    brandSlug: d.brandSlug,
    brandName: d.brandName,
    brandProfilePhotoUrl: null,
    eventSlug: d.tripSlug,
    title: d.title,
    description: d.description,
    coverMediaUrl: d.coverMediaUrl,
    coverMediaType: d.coverMediaType,
    coverHue: hueFromId(d.tripId),
    masterDateUtc: d.startAt,
    masterEndAtUtc: d.endAt,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: d.timezone ?? "UTC",
    venueName: d.destinationText,
    city: d.destinationText,
    address: null,
    hideAddressUntilTicket: false,
    format: "in-person",
    locationGeo: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: d.minPriceCents,
    priceMax: d.minPriceCents,
    currency: d.currency,
    distanceMeters: null,
    isSaved: false,
  } as unknown as BusinessEventCard;
}

export default function ConsumerTripDetailScreen({
  brandSlug,
  tripSlug,
  seed = null,
  onBack,
  accountPreferences,
}: ConsumerTripDetailScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { detail, isLoading, isError, refetch } = useConsumerTripDetail(
    brandSlug,
    tripSlug,
    seed,
  );
  const [reserveSheetVisible, setReserveSheetVisible] = useState(false);

  const handleShare = (): void => {
    void Share.share({
      url: `https://business.usemingla.com/t/${brandSlug}/${tripSlug}`,
    });
  };

  const card = useMemo(
    () => (detail !== null ? tripToBusinessEventCard(detail) : null),
    [detail],
  );

  // ── Loading (cold deep-link) ──
  if (isLoading && detail === null) {
    return (
      <View style={[styles.host, styles.centered]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  // ── Error ──
  if (isError && detail === null) {
    return (
      <View style={[styles.host, styles.centered]}>
        <Pressable
          style={[styles.closeChrome, { top: insets.top + 8 }]}
          onPress={onBack}
          accessibilityLabel="Close"
        >
          <Icon name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.stateTitle}>Couldn't load this trip</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (detail === null) {
    return (
      <View style={[styles.host, styles.centered]}>
        <Pressable
          style={[styles.closeChrome, { top: insets.top + 8 }]}
          onPress={onBack}
          accessibilityLabel="Close"
        >
          <Icon name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.stateTitle}>Trip not found</Text>
      </View>
    );
  }

  const { closed, countdownLabel } = deadlineState(detail);
  const dateLabel =
    detail.startAt !== null && detail.endAt !== null
      ? formatTripDateRange(detail.startAt, detail.endAt)
      : null;
  const priceLabel = formatMoney(detail.minPriceCents, detail.currency);
  const reserveDisabled = closed;
  const includedItems = detail.inclusions.filter((i) => i.kind === "included");
  const excludedItems = detail.inclusions.filter((i) => i.kind === "excluded");

  return (
    <View style={styles.host}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <EventCoverMedia
            hue={hueFromId(detail.tripId)}
            mediaUrl={detail.coverMediaUrl}
            mediaType={detail.coverMediaType}
            radius={0}
            videoContentFit="cover"
            label={detail.title}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.8)"]}
            locations={[0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        {/* Floating chrome */}
        <Pressable
          style={[styles.closeChrome, { top: insets.top + 8 }]}
          onPress={onBack}
          accessibilityLabel="Close"
          hitSlop={8}
        >
          <Icon name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable
          style={[styles.shareChrome, { top: insets.top + 8 }]}
          onPress={handleShare}
          accessibilityLabel="Share"
          hitSlop={8}
        >
          <Icon name="share" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={styles.body}>
          <Text style={styles.title}>{detail.title}</Text>
          <View style={styles.bylineRow}>
            <Text style={styles.byline}>by {detail.brandName}</Text>
            {detail.brandVerified ? (
              <Icon name="shield-checkmark" size={14} color={ACCENT} />
            ) : null}
          </View>

          {/* Meta rows */}
          {dateLabel !== null ? (
            <View style={styles.metaRow}>
              <Icon name="calendar-outline" size={16} color={WARM} />
              <Text style={styles.metaText}>{dateLabel}</Text>
            </View>
          ) : null}
          {/* Leaving from — ABOVE destination */}
          {detail.departureText !== null ? (
            <View style={styles.metaRow}>
              <Icon name="paper-plane-outline" size={16} color={WARM} />
              <Text style={styles.metaText}>Leaving from {detail.departureText}</Text>
            </View>
          ) : null}
          {detail.destinationText !== null ? (
            <View style={styles.metaRow}>
              <Icon name="navigate-outline" size={16} color={WARM} />
              <Text style={styles.metaText}>{detail.destinationText}</Text>
            </View>
          ) : null}
          {detail.totalCapacity !== null ? (
            <View style={styles.metaRow}>
              <Icon name="people-outline" size={16} color={WARM} />
              <Text style={styles.metaText}>
                {detail.totalCapacity} traveler{detail.totalCapacity === 1 ? "" : "s"} max
              </Text>
            </View>
          ) : null}

          {/* Deadline state band */}
          {closed ? (
            <View style={[styles.band, styles.bandClosed]}>
              <Text style={styles.bandClosedTitle}>Bookings closed</Text>
              <Text style={styles.bandBody}>
                This trip stopped taking new bookings. Reach out to the organizer
                with questions.
              </Text>
            </View>
          ) : countdownLabel !== null ? (
            <View style={[styles.band, styles.bandCountdown]}>
              <Text style={styles.bandCountdownText}>{countdownLabel}</Text>
            </View>
          ) : null}

          {/* Refund ladder */}
          {detail.refundPolicy !== null ? (
            <View style={styles.section}>
              <RefundPolicyDisplay policy={detail.refundPolicy} />
            </View>
          ) : null}

          {/* Description */}
          {detail.description !== null && detail.description.trim().length > 0 ? (
            <Text style={styles.description}>{detail.description}</Text>
          ) : null}

          {/* Itinerary */}
          {detail.days.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Day by day</Text>
              {detail.days.map((day) => (
                <View key={day.id} style={styles.dayCard}>
                  <Text style={styles.dayOrdinal}>DAY {day.ordinal}</Text>
                  <Text style={styles.dayTitle}>{day.title}</Text>
                  {day.narrative !== null && day.narrative.trim().length > 0 ? (
                    <Text style={styles.dayNarrative}>{day.narrative}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Inclusions */}
          {includedItems.length > 0 || excludedItems.length > 0 ? (
            <View style={styles.section}>
              {includedItems.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>What's included</Text>
                  {includedItems.map((i) => (
                    <View key={i.id} style={styles.inclRow}>
                      <Icon name="checkmark-circle-outline" size={18} color="#34C759" />
                      <Text style={styles.inclText}>{i.item}</Text>
                    </View>
                  ))}
                </>
              ) : null}
              {excludedItems.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Not included</Text>
                  {excludedItems.map((i) => (
                    <View key={i.id} style={styles.inclRow}>
                      <Icon name="close" size={18} color="rgba(255,255,255,0.4)" />
                      <Text style={[styles.inclText, styles.inclTextMuted]}>{i.item}</Text>
                    </View>
                  ))}
                </>
              ) : null}
            </View>
          ) : null}

          {/* Tiers */}
          {detail.tiers.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Pricing</Text>
              {detail.tiers.map((tier) => (
                <View key={tier.ticketTypeId} style={styles.tierRow}>
                  <Text style={styles.tierName}>{tier.tierName}</Text>
                  <Text style={styles.tierPrice}>
                    {tier.isFree
                      ? "Free"
                      : formatMoney(tier.priceCents, tier.currency) ?? ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky Reserve bar */}
      <View style={[styles.reserveBar, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.reservePriceCol}>
          <Text style={styles.reservePriceLabel}>
            {detail.hasFreeTier && priceLabel === null
              ? "Free"
              : priceLabel !== null
                ? `From ${priceLabel}`
                : ""}
          </Text>
        </View>
        <Pressable
          style={[styles.reserveBtn, reserveDisabled && styles.reserveBtnDisabled]}
          disabled={reserveDisabled}
          onPress={() => setReserveSheetVisible(true)}
          accessibilityLabel="Reserve this trip"
        >
          <Text style={styles.reserveBtnText}>
            {reserveDisabled ? "Bookings closed" : "Reserve"}
          </Text>
        </Pressable>
      </View>

      {/* Reserve flow — reuses the proven business-event checkout sheet. */}
      {card !== null ? (
        <ExpandedBusinessEventSheet
          visible={reserveSheetVisible}
          data={card}
          onClose={() => setReserveSheetVisible(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: SCREEN_BG },
  centered: { alignItems: "center", justifyContent: "center" },
  hero: { width: "100%", height: 320, backgroundColor: "#1a1c20" },
  closeChrome: {
    position: "absolute",
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 10,
  },
  shareChrome: {
    position: "absolute",
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 10,
  },
  body: { padding: 20, gap: 6 },
  title: { fontSize: 22, fontWeight: "700", color: "#FFFFFF", lineHeight: 28 },
  bylineRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  byline: { fontSize: 15, color: "rgba(255,255,255,0.72)" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  metaText: { fontSize: 15, color: "rgba(255,255,255,0.9)", flexShrink: 1 },
  band: { borderRadius: 14, padding: 14, marginTop: 14 },
  bandClosed: { backgroundColor: "rgba(255,80,80,0.12)", borderWidth: 1, borderColor: "rgba(255,80,80,0.3)" },
  bandClosedTitle: { fontSize: 15, fontWeight: "700", color: "#FF6B6B", marginBottom: 4 },
  bandBody: { fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 19 },
  bandCountdown: { backgroundColor: "rgba(235,120,37,0.14)", borderWidth: 1, borderColor: "rgba(235,120,37,0.4)" },
  bandCountdownText: { fontSize: 14, fontWeight: "600", color: WARM },
  section: { marginTop: 18 },
  sectionLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5, color: WARM, marginBottom: 8, textTransform: "uppercase" },
  description: { fontSize: 16, color: "rgba(255,255,255,0.85)", lineHeight: 23, marginTop: 14 },
  dayCard: { marginBottom: 12 },
  dayOrdinal: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3, color: WARM },
  dayTitle: { fontSize: 16, fontWeight: "600", color: "#FFFFFF", marginTop: 2 },
  dayNarrative: { fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 20, marginTop: 4 },
  inclRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  inclText: { fontSize: 15, color: "rgba(255,255,255,0.9)", flexShrink: 1 },
  inclTextMuted: { color: "rgba(255,255,255,0.5)" },
  tierRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  tierName: { fontSize: 15, color: "#FFFFFF" },
  tierPrice: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  reserveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "rgba(16,18,22,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  reservePriceCol: { flexShrink: 1 },
  reservePriceLabel: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
  reserveBtn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  reserveBtnDisabled: { opacity: 0.4 },
  reserveBtnText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },
  stateTitle: { fontSize: 17, fontWeight: "600", color: "#FFFFFF", marginTop: 12 },
  retryBtn: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, paddingVertical: 12, paddingHorizontal: 24 },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
