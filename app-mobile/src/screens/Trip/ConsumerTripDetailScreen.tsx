/**
 * ConsumerTripDetailScreen — in-app trip detail (ORCH-1016).
 *
 * ORCH-1016 REWORK (operator UX corrections, 2026-05-30):
 *   1. CANONICAL SHEET — the detail body now renders inside the app's shared
 *      `BaseBottomSheet` primitive (the SOLE permitted gorhom consumer, used by
 *      ExpandedBusinessEventSheet + every other detail/expanded surface), not the
 *      prior bespoke full-screen overlay. Same presentation, same drag-handle/
 *      pan-down close, same dark chrome as the rest of the app. `onClose`→`onBack`.
 *   2. SCROLL CLEARS THE BOTTOM NAV — while the sheet is open it sets
 *      `hidesBottomNav`, so the floating GlassBottomNav is hidden and the Reserve
 *      CTA has no nav to clear (just OS safe-area). (Earlier REWORKs tried to
 *      out-pad the nav, then to host the sheet group in a SheetOverlayCarrier RN
 *      Modal above the nav; both are removed — the carrier broke Android scroll
 *      gestures without fixing z-order.)
 *
 * ORCH-1016 ROOT-CAUSE FIX (frozen-scroll; operator on-device "i cant scroll the
 * content of the sheet itself", 2026-05-30; verified on-device iOS + Android):
 *   The populated sheet uses a BARE `scrollMode="scroll"` so BaseBottomSheet's own
 *   gorhom `BottomSheetScrollView` is the DIRECT child of the height-bounded
 *   `BottomSheetContent` — the ONLY structure gorhom constrains to the snap height.
 *   {detailBody} + {reserveFooter} are its two children. Any wrapper (the
 *   `stickyFooter`/`header`/`bodyContainerStyle` props, or injecting a scroll host
 *   one `BottomSheetView` level deeper as the superseded `scrollMode="view"`
 *   approach did) makes gorhom size the sheet to CONTENT → viewport==content →
 *   maxScroll=0 → frozen. The Reserve footer is the second child (pins at the
 *   bottom), not the `stickyFooter` prop. Loading/empty/error states keep
 *   `scrollMode="view"` (short, non-scrolling). Result: day-by-day + policy + tiers
 *   physically scroll, Reserve stays pinned, swipe-down-to-dismiss still works.
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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  UIManager,
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
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";
import { ExpandedBusinessEventSheet } from "../../components/expandedCard/ExpandedBusinessEventSheet";
import { glass } from "../../constants/designSystem";
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
   * ORCH-1016 REWORK — true when the detail is presented from the in-app
   * Discover overlay where GlassBottomNav is mounted. In that case the whole
   * trip sheet group is hosted above the nav. The cold deep-link route (app/t/...)
   * has no nav and passes false. Default true (the common in-app case).
   */
  tabBarAware?: boolean;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}

const ACCENT = "#FF6B35";
const WARM = "#eb7825";

// ORCH-1117 — collapsible description: copy ≤ this length renders full, no toggle.
const ABOUT_COLLAPSE_THRESHOLD = 160;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  // ORCH-1117 — collapsible description (collapsed by default for long copy).
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setReduceMotion(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  const toggleAbout = useCallback((): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          200,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    setAboutCollapsed((c) => !c);
  }, [reduceMotion]);

  // ORCH-1016 — the SheetOverlayCarrier (RN Modal) is removed: it broke Android
  // scroll gestures and did NOT fix the z-order. The sheets now hide the nav
  // directly via `hidesBottomNav`, so this is a passthrough.
  const renderSheetGroup = (sheetGroup: ReactElement): ReactElement => sheetGroup;

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
    return renderSheetGroup(
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <ActivityIndicator color={ACCENT} />
        </View>
      </BaseBottomSheet>,
    );
  }

  // ── Error ──
  if (isError && detail === null) {
    return renderSheetGroup(
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Couldn&apos;t load this trip</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </BaseBottomSheet>,
    );
  }

  if (detail === null) {
    return renderSheetGroup(
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel="Trip detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Trip not found</Text>
        </View>
      </BaseBottomSheet>,
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

        {/* Description — ORCH-1117 collapsible (collapsed by default; copy ≤160
            chars renders full with no toggle). State signaled by the word +
            chevron, never color alone. */}
        {detail.description !== null && detail.description.trim().length > 0
          ? (() => {
              const aboutText = detail.description;
              const canCollapse = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
              const collapsed = canCollapse && aboutCollapsed;
              return (
                <View>
                  <Text
                    style={styles.description}
                    numberOfLines={collapsed ? 3 : undefined}
                    ellipsizeMode="tail"
                  >
                    {aboutText}
                  </Text>
                  {canCollapse ? (
                    <Pressable
                      onPress={toggleAbout}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !collapsed }}
                      accessibilityLabel={collapsed ? "Read more" : "Show less"}
                      accessibilityHint={
                        collapsed
                          ? "Expands the description"
                          : "Collapses the description"
                      }
                      style={styles.aboutToggleRow}
                    >
                      <Text style={styles.aboutToggleText}>
                        {collapsed ? "Read more" : "Show less"}
                      </Text>
                      <Icon
                        name={
                          collapsed ? "chevron-down" : "chevron-up"
                        }
                        size={16}
                        color={WARM}
                      />
                    </Pressable>
                  ) : null}
                </View>
              );
            })()
          : null}

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

  // ORCH-1016 ROOT-CAUSE FIX — the Reserve bar is a SIBLING rendered directly
  // below {detailBody} as the second child of the bare scrollMode="scroll" sheet
  // (NOT BaseBottomSheet's `stickyFooter` prop, which routes the sheet into the
  // nested BottomSheetView branch that froze the scroll). The footer only needs
  // OS safe-area clearance: the sheet sets `hidesBottomNav`, so the GlassBottomNav
  // is hidden while it's open and the Reserve CTA has no floating nav to clear.
  const footerNavClearance = Math.max(insets.bottom, 16);
  const scrollBottomClearance = footerNavClearance;
  // ORCH-1117 — standardized Reserve bar (price-left / action-right anatomy).
  // When the PAID brand can't charge yet (detail.bookable === false), render a
  // NON-tappable "Booking unavailable" info strip instead of the Reserve action
  // (no dead taps, Constitution #1). The existing "Bookings closed" disabled
  // state is preserved. F-E: this UPGRADES the existing scroll-sibling bar — it
  // is NOT BaseBottomSheet.stickyFooter (which froze the scroll in ORCH-1016).
  const reserveFooter: ReactElement =
    detail.bookable === false ? (
      <View
        style={[
          styles.reserveBar,
          styles.reserveBarUnavailable,
          { paddingBottom: footerNavClearance },
        ]}
        accessibilityRole="text"
        accessibilityLabel="Booking unavailable. The organizer is finishing payment setup."
      >
        <Text style={styles.reserveStripGlyph}>ⓘ</Text>
        <View style={styles.reserveStripTextCol}>
          <Text style={styles.reserveStripTitle}>Booking unavailable</Text>
          <Text style={styles.reserveStripSubline}>
            The organizer is finishing payment setup.
          </Text>
        </View>
      </View>
    ) : (
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
          style={[
            styles.reserveBtn,
            reserveDisabled && styles.reserveBtnDisabled,
          ]}
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

  // ORCH-1016 ROOT-CAUSE FIX (measured on-device): use a BARE scrollMode="scroll"
  // so the gorhom BottomSheetScrollView is the DIRECT child of BottomSheetContent —
  // the ONLY structure gorhom constrains to the snap height (a header / stickyFooter
  // / bodyContainerStyle wrapper makes gorhom size the sheet to content → viewport
  // == content → maxScroll 0 → frozen, proven by measurement). The Reserve CTA lives
  // at the END of the scroll content. `hidesBottomNav` hides the floating nav while
  // open so nothing is painted over the CTA — no fragile scroll-padding needed.
  return renderSheetGroup(
    <>
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="scroll"
        hidesBottomNav
        scrollProps={{
          contentContainerStyle: styles.scrollContent,
          showsVerticalScrollIndicator: false,
        }}
        accessibilityLabel={detail.title}
      >
        {detailBody}
        {reserveFooter}
      </BaseBottomSheet>

      {/* Reserve flow — reuses the proven business-event checkout sheet. Sibling
          BaseBottomSheet root in the same fragment so it overlays this sheet. */}
      {card !== null ? (
        <ExpandedBusinessEventSheet
          visible={reserveSheetVisible}
          data={card}
          onClose={() => setReserveSheetVisible(false)}
          // ORCH-1016: EBES hides the nav itself. The scroll viewport extends ~46px
          // below the visible screen edge, so the spacer must clear that overshoot +
          // a small gap for the Buy CTA — without over-scrolling. ~58.
          bottomContentInset={Math.max(insets.bottom, 16) + 8}
        />
      ) : null}
    </>,
  );
}

const styles = StyleSheet.create({
  // Minimum breathing room; runtime footer/nav clearance is merged inline so
  // the final pricing/tickets rows can scroll fully above the Reserve bar + nav.
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
  // ORCH-1117 — collapsible-description toggle row.
  aboutToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  aboutToggleText: { fontSize: 14, fontWeight: "600", color: WARM },
  // ORCH-1117 — Reserve bar "Booking unavailable" info strip (non-tappable).
  reserveBarUnavailable: {
    justifyContent: "flex-start",
    gap: 10,
  },
  reserveStripGlyph: { fontSize: 18, color: "rgba(255,255,255,0.52)" },
  reserveStripTextCol: { flex: 1 },
  reserveStripTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.72)",
  },
  reserveStripSubline: {
    fontSize: 12,
    color: "rgba(255,255,255,0.52)",
    marginTop: 2,
  },
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
