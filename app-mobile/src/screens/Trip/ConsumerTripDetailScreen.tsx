/**
 * ConsumerTripDetailScreen — in-app trip detail (ORCH-1016).
 *
 * ORCH-1016 REWORK (operator UX corrections, 2026-05-30):
 *   1. CANONICAL SHEET — the detail body now renders inside the app's shared
 *      `BaseBottomSheet` primitive (the SOLE permitted gorhom consumer, used by
 *      ExpandedBusinessEventSheet + every other detail/expanded surface), not the
 *      prior bespoke full-screen overlay. Same presentation, same drag-handle/
 *      pan-down close, same dark chrome as the rest of the app. `onClose`→`onBack`.
 *   2. SCROLL CLEARS THE BOTTOM NAV — the sheet is `tabBarAware`, so the scroll
 *      body's bottom padding includes `BOTTOM_NAV_CONTENT_HEIGHT + safe-area`
 *      (single source of truth: useAppLayout). The last itinerary Day + Reserve
 *      CTA are fully reachable above the floating GlassBottomNav (no clipped
 *      "Day 3"). The sticky Reserve bar is the sheet's `stickyFooter`, which the
 *      primitive pads with the same nav clearance.
 *
 * ORCH-1016 REWORK-3 (operator on-device STILL froze: "i cant scroll the content
 * of the sheet itself", 2026-05-30):
 *   FROZEN-SCROLL ROOT CAUSE + FIX — REWORK-2 used the primitive-owned scroll mode
 *   plus the stickyFooter prop, which routes BaseBottomSheet into its sticky-footer branch:
 *   `<BottomSheetContent>` → `<BottomSheetView flex:1>` (stickyContainer) →
 *   `<BottomSheetScrollView flex:1>` (stickyBody). gorhom's `BottomSheetContent`
 *   is a height-bounded `overflow:hidden` box; the gold-standard sheet that DOES
 *   scroll (ExpandedBusinessEventSheet) injects its gorhom `BottomSheetScrollView`
 *   as a `flex:1` *DIRECT* child of `BottomSheetContent`. Wrapping the scroll one
 *   `BottomSheetView` level deeper (the sticky-footer branch) changed the measured
 *   viewport so the inner scroll never received a bounded height and froze.
 *
 *   FIX: mirror ExpandedBusinessEventSheet's proven scroll wiring LINE-FOR-LINE —
 *   `scrollMode="view"` so BaseBottomSheet passes children straight into
 *   `BottomSheetContent`, and render the gorhom `BottomSheetScrollView` (re-exported
 *   from the primitive — the SOLE permitted gorhom importer) as a `flex:1` DIRECT
 *   child scroll host, exactly like the working sheet. The sticky Reserve footer is
 *   now a SIBLING `View` BELOW the scroll host (NOT the `stickyFooter` prop), so it
 *   never re-introduces the extra `BottomSheetView` wrapper. The detail body + nav
 *   clearance ride the scroll host's `contentContainerStyle`. Result: the day-by-day
 *   list + policy + tiers physically scroll, the Reserve footer stays pinned, and
 *   swipe-down-to-dismiss still works (gorhom coordinates the single registered
 *   scrollable with the sheet pan).
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
 * key → orders.intake_form_data. ExpandedBusinessEventSheet renders as a SIBLING
 * BaseBottomSheet root in the same fragment (feedback_rn_sub_sheet_must_render_inside_parent).
 */

import React, { useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EventCoverMedia, formatTripDateRange, RefundPolicyDisplay } from "@mingla/event-rendering";

import { Icon } from "../../components/ui/Icon";
// ORCH-1016 REWORK-3 — import the gorhom scroll host re-export from the primitive
// (the SOLE permitted gorhom importer, per
// I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER) and inject it as the trip
// detail's OWN scroll host — the exact wiring ExpandedBusinessEventSheet uses.
import {
  BaseBottomSheet,
  BottomSheetScrollView,
} from "../../components/ui/BaseBottomSheet";
import { ExpandedBusinessEventSheet } from "../../components/expandedCard/ExpandedBusinessEventSheet";
import { glass } from "../../constants/designSystem";
// ORCH-1016 REWORK-3 — the sticky footer is now a SIBLING (not the primitive's
// stickyFooter prop), so this screen owns the floating-nav clearance for the
// scroll body + footer. Single source of truth = useAppLayout (same constant the
// primitive's tabBarAware path reads).
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";
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
  /**
   * ORCH-1016 REWORK — true when the detail is presented BELOW the floating
   * GlassBottomNav (the in-app Discover overlay), so the sheet adds the nav
   * clearance to its scroll body. The cold deep-link route (app/t/...) has no
   * nav and passes false. Default true (the common in-app case).
   */
  tabBarAware?: boolean;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}

const ACCENT = "#FF6B35";
const WARM = "#eb7825";

// Canonical sheet snap tokens — same as ExpandedBusinessEventSheet (the
// gold-standard detail sheet). Two snaps give a 50% preview + 90% full view.
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (
  | string
  | number
)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

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
  tabBarAware = true,
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

  // Floating close/share chrome — preserved from the prior overlay, now layered
  // over the sheet body (inside the BaseBottomSheet) instead of the full screen.
  const chrome = (
    <>
      <Pressable
        style={[styles.closeChrome, { top: 8 }]}
        onPress={onBack}
        accessibilityLabel="Close"
        hitSlop={8}
      >
        <Icon name="close" size={24} color="#FFFFFF" />
      </Pressable>
      <Pressable
        style={[styles.shareChrome, { top: 8 }]}
        onPress={handleShare}
        accessibilityLabel="Share"
        hitSlop={8}
      >
        <Icon name="share" size={22} color="#FFFFFF" />
      </Pressable>
    </>
  );

  // ── Loading (cold deep-link) ──
  if (isLoading && detail === null) {
    return (
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        tabBarAware={tabBarAware}
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <ActivityIndicator color={ACCENT} />
        </View>
      </BaseBottomSheet>
    );
  }

  // ── Error ──
  if (isError && detail === null) {
    return (
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        tabBarAware={tabBarAware}
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Couldn&apos;t load this trip</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </BaseBottomSheet>
    );
  }

  if (detail === null) {
    return (
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        tabBarAware={tabBarAware}
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Trip not found</Text>
        </View>
      </BaseBottomSheet>
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

  // ORCH-1016 REWORK-3 — the detail content is the scroll-host's children. The
  // screen's own gorhom BottomSheetScrollView (mounted in the return below, mirror
  // of ExpandedBusinessEventSheet) wraps this body as a flex:1 direct child of
  // BottomSheetContent, so the day-by-day list + policy + tiers physically scroll
  // while pan-down still dismisses. The close/share chrome rides at the top of the
  // scroll, over the hero.
  const detailBody: ReactElement = (
    <>
      {chrome}
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
                <Text style={styles.sectionLabel}>What&apos;s included</Text>
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
    </>
  );

  // ORCH-1016 REWORK-3 — the Reserve bar is now a SIBLING of the scroll host (a
  // plain RN <View> rendered BELOW the BottomSheetScrollView inside the sheet's
  // height-bounded BottomSheetContent), NOT BaseBottomSheet's `stickyFooter` prop.
  // Using the stickyFooter prop is what routed the sheet into the nested
  // BottomSheetView branch that froze the scroll. As a sibling it pins at the
  // bottom of the flex column while the scroll host claims flex:1 above it.
  //
  // The footer owns the floating-nav + home-indicator clearance (the primitive's
  // tabBarAware padding only applies to its own scroll/sticky branches, which we
  // no longer use). `footerNavClearance` = floating GlassBottomNav height (only
  // when tabBarAware) + safe-area bottom.
  const footerNavClearance =
    (tabBarAware ? BOTTOM_NAV_CONTENT_HEIGHT : 0) + Math.max(insets.bottom, 16);
  const reserveFooter: ReactElement = (
    <View style={[styles.reserveBar, { paddingBottom: footerNavClearance }]}>
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
  );

  // ORCH-1016 REWORK-3 — mirror ExpandedBusinessEventSheet's proven scroll wiring:
  // scrollMode="view" + the gorhom BottomSheetScrollView as the OWN scroll host
  // (a flex:1 DIRECT child of BottomSheetContent), with the Reserve footer as a
  // sibling below it. The scroll content's bottom padding only needs breathing
  // room above the (already nav-cleared) footer — the footer itself carries the
  // nav clearance, so we do NOT double-pad the scroll body.
  return (
    <>
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        accessibilityLabel={detail.title}
      >
        <BottomSheetScrollView
          style={styles.scrollHost}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {detailBody}
        </BottomSheetScrollView>
        {reserveFooter}
      </BaseBottomSheet>

      {/* Reserve flow — reuses the proven business-event checkout sheet. Sibling
          BaseBottomSheet root in the same fragment so it overlays this sheet. */}
      {card !== null ? (
        <ExpandedBusinessEventSheet
          visible={reserveSheetVisible}
          data={card}
          onClose={() => setReserveSheetVisible(false)}
          // ORCH-1016 REWORK-5 (FIX A cont.) — the reserve sheet renders BELOW
          // the floating GlassBottomNav, so its ticket list + Buy CTA must clear
          // the nav height + safe-area (default 32 left the Buy button blocked
          // on-device). Same source of truth + pattern as MessageInterface's
          // group-event sheet (BOTTOM_NAV_CONTENT_HEIGHT + insets.bottom + 32).
          bottomContentInset={BOTTOM_NAV_CONTENT_HEIGHT + insets.bottom + 32}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // ORCH-1016 REWORK-3 — the scroll host claims flex:1 so it gets a bounded
  // viewport inside gorhom's height-bounded BottomSheetContent (exactly like
  // ExpandedBusinessEventSheet's injected scroll host) and a tall body scrolls.
  scrollHost: { flex: 1 },
  // Breathing room above the (separately nav-cleared) sticky Reserve footer.
  scrollContent: { paddingBottom: 24 },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
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
  stateBody: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  stateTitle: { fontSize: 17, fontWeight: "600", color: "#FFFFFF", marginTop: 12 },
  retryBtn: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, paddingVertical: 12, paddingHorizontal: 24 },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
