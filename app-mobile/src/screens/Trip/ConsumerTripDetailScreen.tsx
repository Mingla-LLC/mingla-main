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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  boldFontFamily,
  createThemePalette,
  EventCoverMedia,
  formatTripDateRange,
  offeringSurfaceStyles,
  resolveTheme,
  ThemeEntranceAnimation,
  type CtaState,
} from "@mingla/event-rendering";
// ORCH-1138 Leg 1C — the shared Direction-A foundation primitives. The consumer
// trip detail converges on the business/web trip page (TripPreview FOUNDATION
// mode) by REUSING these (NOT importing TripPreview, which is business-local).
//
// ORCH-1138 Leg 1C FIX-1/2 (device-regression rework): we COMPOSE the
// Direction-A native look here (pinned cover + OfferingChrome + scrolling body +
// floating reserve) instead of mounting ParallaxCoverShell as the sheet host.
// WHY: ParallaxCoverShell's native branch wraps its ScrollView inside a
// `nativeHost` <View>, so the gorhom `BottomSheetScrollView` injected as its
// `ScrollComponent` is NOT a DIRECT child of gorhom's height-bounded
// `BottomSheetContent` → viewport==content → maxScroll 0 → the sheet body FROZE
// on Seth's device (the exact ORCH-1016/1043 trap; SPEC §4.5 OQ-3 risk
// materialized). Editing ParallaxCoverShell's native branch is forbidden (it
// ships the business/web page — SPEC OQ-4 / DO-NOT-TOUCH packages/*), so we
// compose AROUND it: the gorhom scroll host is a DIRECT child of <BaseBottomSheet>
// and the themed cover/chrome/reserve are absolute sibling direct children.
import {
  ChipGroup,
  CountAwareGallery,
  OfferingChrome,
  useResponsiveLayout,
} from "@mingla/offering-rendering";

import { Icon } from "../../components/ui/Icon";
// ORCH-1016 REWORK-3 — import the gorhom scroll host re-export from the primitive
// (the SOLE permitted gorhom importer, per
// I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER) and inject it as the
// ParallaxCoverShell's ScrollComponent — gorhom owns the single registered
// scrollable (the exact ORCH-1016/1043 contract, no nested raw ScrollView).
import {
  BaseBottomSheet,
  BottomSheetScrollView,
} from "../../components/ui/BaseBottomSheet";
import { ExpandedBusinessEventSheet } from "../../components/expandedCard/ExpandedBusinessEventSheet";
import { glass } from "../../constants/designSystem";
import { hueFromId } from "../../utils/hueFromId";
import {
  useConsumerTripDetail,
  type ConsumerTripDetail,
  type TripDetailTier,
  type TripInstallmentScheduleData,
} from "../../hooks/useConsumerTripDetail";
import { useEventTheme } from "../../hooks/useEventTheme";
import { mapConsumerTripToFoundation } from "../../hooks/useConsumerTripFoundation";
import { useConsumerThemeFont } from "../../theme/useConsumerThemeFont";
import { ConsumerRefundLadder } from "../../components/offering/ConsumerRefundLadder";
import { ConsumerTripReserveBar } from "../../components/offering/ConsumerTripReserveBar";
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

// ORCH-1130 — precise currency render for the installment ladder (cents → 2dp).
// Distinct from formatMoney (which rounds to whole units for the price chips).
function formatMoneyExact(cents: number, currency: string | null): string {
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

// ORCH-1130 — the absolute-date schedule the consumer "HOW YOU PAY" module
// renders. Pure projection from the tier's stored template + a now() anchor
// (the buyer hasn't booked, so dates are projections). Mirrors the business
// `projectInstallmentSchedule`; kept local so app-mobile has no cross-app import.
interface ConsumerProjectedSchedule {
  depositCents: number;
  fullPriceCents: number;
  currency: string;
  installments: { ordinal: number; amountCents: number; dueAtIso: string }[];
}

function addDaysIso(anchor: Date, days: number): string {
  const r = new Date(anchor.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r.toISOString();
}

function projectConsumerSchedule(
  tier: TripDetailTier,
  anchor: Date,
): ConsumerProjectedSchedule | null {
  const s: TripInstallmentScheduleData | null = tier.installmentSchedule;
  if (s === null) return null;
  const fullPriceCents = tier.priceCents;
  const depositCents = Math.round((fullPriceCents * s.deposit_pct) / 100);
  const installments = s.installments.map((inst) => {
    const amountCents = Math.round((fullPriceCents * inst.pct) / 100);
    let dueAtIso: string;
    if (typeof inst.fixed_date === "string" && inst.fixed_date.length > 0) {
      dueAtIso = `${inst.fixed_date}T00:00:00.000Z`;
    } else {
      dueAtIso = addDaysIso(anchor, inst.days_after_booking ?? 0);
    }
    return { ordinal: inst.ordinal, amountCents, dueAtIso };
  });
  return { depositCents, fullPriceCents, currency: tier.currency, installments };
}

function formatScheduleDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
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
  // ORCH-1130 — consumer pay-full vs pay-over-time choice. Default "full" (the
  // deliberate non-surprising default; a buyer who does nothing pays the whole
  // price, never a silent partial). Threaded into the reserve flow so the
  // server receives an EXPLICIT choice for plan trips (DISC-1130-A consent fix).
  const [paymentPlanChoice, setPaymentPlanChoice] =
    useState<"full" | "installments">("full");
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
  // ORCH-1138 Leg 1C — the per-day gallery's one-playing guard now lives INSIDE
  // the shared CountAwareGallery primitive (it owns the active-video state), so
  // the screen no longer hand-rolls an activeVideoKey here.

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

  // ORCH-1138 Leg 1C — resolve the SAME brand palette/theme the business/web trip
  // page uses, via the EXISTING anon-safe useEventTheme(card) (reads
  // business_public_events_view — 🔒 COMMS-0009, NEVER .from('brands')). Default
  // theme (MINGLA palette) when the brand set none / on error — never a crash.
  const themeQuery = useEventTheme(card);
  const theme = themeQuery.data ?? resolveTheme(null, null);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);
  const boldFamily = boldFontFamily(theme);
  // ORCH-1138 Leg 1C — load the medium + 700-weight BOLD families on demand (the
  // 14 theme faces are deferred out of the boot bundle; a loaded custom font
  // ignores fontWeight on native, so bold text must point fontFamily at the
  // weighted family). Mirrors the business trip route's useThemeFont pair.
  useConsumerThemeFont(theme.fontFamilyValue);
  useConsumerThemeFont(boldFamily);

  // ORCH-1138 Leg 1C — cover-video sound state (only shown when the cover is a
  // video). Default muted (the immersive auto-play default).
  const [muted, setMuted] = useState<boolean>(true);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // ORCH-1138 Leg 1C — native foundation render is always single-column immersive
  // (useResponsiveLayout returns isDesktop=false on native). Referenced so the
  // structural parity with the business FoundationTripPreview is explicit.
  const { isDesktop } = useResponsiveLayout();

  // ORCH-1130 — project the sole/first plan tier's schedule from a now() anchor.
  // Null when no tier has a plan → the "HOW YOU PAY" module is suppressed and
  // the screen stays byte-identical to today.
  const planSchedule = useMemo<ConsumerProjectedSchedule | null>(() => {
    if (detail === null) return null;
    for (const tier of detail.tiers) {
      if (tier.installmentSchedule !== null) {
        return projectConsumerSchedule(tier, new Date());
      }
    }
    return null;
  }, [detail]);
  const planTier = useMemo<TripDetailTier | null>(() => {
    if (detail === null) return null;
    return detail.tiers.find((t) => t.installmentSchedule !== null) ?? null;
  }, [detail]);

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
  const priceLabel = formatMoney(detail.minPriceCents, detail.currency);
  const reserveDisabled = closed;

  // ORCH-1138 Leg 1C — map the consumer trip onto the Direction-A foundation
  // render inputs (pure, rule-9 guarded). The same mapping the business
  // FoundationTripPreview reads, applied to the consumer data shape.
  const fnd = mapConsumerTripToFoundation(detail, palette);
  const dateLabel =
    detail.startAt !== null && detail.endAt !== null
      ? formatTripDateRange(detail.startAt, detail.endAt)
      : null;
  // sold-out derived from spotsLeft (consumer has no per-tier ticketsRemaining).
  const isSoldOut = detail.spotsLeft !== null && detail.spotsLeft <= 0;

  // ── foundation body content (mirror business FoundationTripPreview `left`) ──
  const bodyChildren: ReactElement = (
    <>
      {/* phone lead: eyebrow (duration · destination) + title */}
      <View style={styles.leadBlock}>
        {fnd.heroEyebrow !== null ? (
          <Text style={[styles.eyebrowLead, surface.primaryText]}>
            {fnd.heroEyebrow}
          </Text>
        ) : null}
        <Text
          style={[styles.fndTitle, surface.primaryText, { fontFamily: boldFamily }]}
        >
          {fnd.title}
        </Text>
      </View>

      {/* meta chips (real columns only — rule 9) */}
      <View style={styles.metaChipRow}>
        {dateLabel !== null ? (
          <View style={[styles.metaChip, surface.card]}>
            <Icon name="calendar" size={15} color={palette.accent} />
            <Text
              style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
            >
              {dateLabel}
            </Text>
          </View>
        ) : null}
        {fnd.duration !== null ? (
          <View style={[styles.metaChip, surface.card]}>
            <Icon name="time-outline" size={15} color={palette.accent} />
            <Text
              style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
            >
              {fnd.duration}
            </Text>
          </View>
        ) : null}
        {fnd.seatsLabel !== null ? (
          <View style={[styles.metaChip, surface.card]}>
            <Icon name="people-outline" size={15} color={palette.accent} />
            <Text
              style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
            >
              {fnd.seatsLabel}
            </Text>
          </View>
        ) : null}
        {fnd.destination !== null ? (
          <View style={[styles.metaChip, surface.card]}>
            <Icon name="location" size={15} color={palette.accent} />
            <Text
              style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
            >
              {fnd.destination}
            </Text>
          </View>
        ) : null}
      </View>

      {/* brand chip — ORCH-1138 Leg 1C FIX-3: the "Presented by" cover renders via
          the gif/video-aware EventCoverMedia (NOT a plain <Image>), so an animated
          brand cover shows. The consumer trip data path is anon-safe and carries
          no brand cover today (🔒 COMMS-0009), so fnd.brandCoverMediaUrl is null →
          EventCoverMedia draws its hue gradient fallback (rule 9 — graceful, no
          fabricated cover). The rounded tile clips the media (overflow:hidden). */}
      <View style={[styles.brandRow, surface.card]}>
        <View style={styles.brandTile}>
          <EventCoverMedia
            mediaUrl={fnd.brandCoverMediaUrl}
            mediaType={fnd.brandCoverMediaType}
            hue={hueFromId(detail.brandSlug)}
            // ORCH-1138 FIX-3 — empty label so the no-cover fallback is a CLEAN
            // themed hue gradient, NOT the default "Cover" text (which truncated
            // to the broken "COVE…" placeholder Seth saw in the 42px circle).
            label=""
            radius={999}
            autoplay
            playbackActive
            muted
            loop
            height="100%"
            width="100%"
          />
        </View>
        <View style={styles.brandTextCol}>
          <Text style={[styles.brandKicker, surface.tertiaryText]}>
            Presented by
          </Text>
          <View style={styles.brandNameRow}>
            <Text
              style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
            >
              {fnd.brandName}
            </Text>
            {fnd.brandVerified ? (
              <Icon name="shield-checkmark" size={14} color={palette.accent} />
            ) : null}
          </View>
        </View>
      </View>

      {/* deadline state band (closed / countdown) */}
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

      {/* route — leaving from → destination (each leg only when present).
          ORCH-1138: legs are standardized to "City, Country" in the foundation
          adapter; each routePlace is numberOfLines={1}+ellipsis on a flex:1/
          minWidth:0 column so a long city truncates rather than WRAPS — keeps
          both legs balanced on one aligned row (parity with TripPreview). */}
      {fnd.route !== null ? (
        <View style={[styles.route, surface.card]}>
          {fnd.route.departure !== null ? (
            <View style={styles.routeLeg}>
              <Text style={[styles.routeLabel, surface.tertiaryText]}>
                Leaving from
              </Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.routePlace, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {fnd.route.departure}
              </Text>
            </View>
          ) : null}
          {fnd.route.departure !== null && fnd.route.destination !== null ? (
            <Text style={[styles.routeArrow, { color: palette.accent }]}>→</Text>
          ) : null}
          {fnd.route.destination !== null ? (
            <View style={styles.routeLeg}>
              <Text style={[styles.routeLabel, surface.tertiaryText]}>
                Destination
              </Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.routePlace, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {fnd.route.destination}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* about — ORCH-1117 collapsible (collapsed by default; ≤160 chars no toggle) */}
      {fnd.description !== null
        ? (() => {
            const aboutText = fnd.description;
            const canCollapse = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
            const collapsed = canCollapse && aboutCollapsed;
            return (
              <View style={styles.section}>
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  About this trip
                </Text>
                <Text
                  style={[styles.aboutText, surface.secondaryText]}
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
                    <Text style={[styles.aboutToggleText, { color: palette.accent }]}>
                      {collapsed ? "Read more" : "Show less"}
                    </Text>
                    <Icon
                      name={collapsed ? "chevron-down" : "chevron-up"}
                      size={16}
                      color={palette.accent}
                    />
                  </Pressable>
                ) : null}
              </View>
            );
          })()
        : null}

      {/* day by day — itinerary spine + count-aware galleries */}
      {fnd.days.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
          >
            Day by day
          </Text>
          <View style={styles.itin}>
            <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
            {fnd.days.map((day) => (
              <View key={day.id} style={styles.day}>
                <View style={[styles.dayDot, { backgroundColor: palette.accent }]}>
                  <Text style={[styles.dayDotText, { color: palette.accentText }]}>
                    {day.ordinal}
                  </Text>
                </View>
                <View style={[styles.dayCard, surface.card]}>
                  <Text style={[styles.dayOrd, { color: palette.accent }]}>
                    Day {day.ordinal}
                  </Text>
                  <Text
                    style={[styles.dayTitle, surface.primaryText, { fontFamily: boldFamily }]}
                  >
                    {day.title}
                  </Text>
                  {day.narrative !== null ? (
                    <Text style={[styles.dayNarr, surface.secondaryText]}>
                      {day.narrative}
                    </Text>
                  ) : null}
                  {/* CountAwareGallery renders ZERO nodes for 0 media (rule 9). */}
                  <CountAwareGallery
                    items={day.gallery}
                    palette={palette}
                    variant="phone"
                    accessibilityLabelPrefix={`Day ${day.ordinal} media`}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* what's included */}
      {fnd.includedChips.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
          >
            What&rsquo;s included
          </Text>
          <ChipGroup chips={fnd.includedChips} palette={palette} />
        </View>
      ) : null}

      {/* what's not included */}
      {fnd.excludedChips.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
          >
            What&rsquo;s not included
          </Text>
          <ChipGroup chips={fnd.excludedChips} palette={palette} />
        </View>
      ) : null}

      {/* destination map — DEFERRED on consumer (OQ-1A): the consumer trip data
          carries NO destination lat/lng (F-4), so the section is omitted (rule 9 —
          no fabricated tile). Data-path parity gap vs the business/web page; see
          the implementation report. */}

      {/* cancellation policy — palette-themed ladder (OQ-2 = port for parity) */}
      <ConsumerRefundLadder
        policy={detail.refundPolicy}
        bookingDeadline={detail.bookingDeadline}
        palette={palette}
        surface={surface}
        boldFamily={boldFamily}
      />

      {/* ORCH-1138 [trip-page-redesign] FIX-4 — "Choose how you pay" parity with
          the business/web PaymentMockupCard (DIRECTION_A_V2 `.pay-card`): same
          heading text/casing, the FULL-WIDTH TABBED Pay-in-full / Pay-over-time
          toggle (dark track, active tab = accent fill + accentText — NOT the old
          radio-dot pills), the 34px amount block ("Due today" label on plan), the
          schedule rows + total, and the SAME sub-copy ("One payment, all-in.
          Taxes & fees included." / "{pct}% deposit now, then N payments. {total}
          total — no extra cost."). The toggle remains the consumer choice control
          threaded into Reserve (paymentPlanChoice). Renders ONLY for a bookable,
          not-closed plan trip. ORCH-1130's projection math is untouched. */}
        {planSchedule !== null && planTier !== null && !closed &&
        detail.bookable !== false
          ? (() => {
              const isFull = paymentPlanChoice === "full";
              const fullLabel = formatMoneyExact(
                planSchedule.fullPriceCents,
                planSchedule.currency,
              );
              const depositLabel = formatMoneyExact(
                planSchedule.depositCents,
                planSchedule.currency,
              );
              const futureCount = planSchedule.installments.length;
              // deposit pct derived from the projected amounts (never hardcoded).
              const depositPct =
                planSchedule.fullPriceCents > 0
                  ? Math.round(
                      (planSchedule.depositCents / planSchedule.fullPriceCents) *
                        100,
                    )
                  : 0;
              return (
                <View
                  style={styles.section}
                  testID="orch-1130-consumer-payment-choice"
                >
                  <Text
                    style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                  >
                    Choose how you pay
                  </Text>
                  <View
                    style={[
                      styles.payMockCard,
                      { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
                    ]}
                  >
                    <View
                      style={[styles.payMockAccentBar, { backgroundColor: palette.accent }]}
                    />
                    <View style={styles.payMockInner}>
                      {/* segmented TAB toggle (mockup `.seg`) */}
                      <View
                        accessibilityRole="tablist"
                        accessibilityLabel="How you pay"
                        style={[styles.payMockSeg, { borderColor: palette.panelBorder }]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Pay full ${fullLabel} now`}
                          accessibilityState={{ selected: isFull }}
                          onPress={() => setPaymentPlanChoice("full")}
                          style={[
                            styles.payMockSegBtn,
                            isFull ? { backgroundColor: palette.accent } : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.payMockSegBtnText,
                              { color: isFull ? palette.accentText : palette.secondaryText },
                            ]}
                          >
                            Pay in full
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Pay over time, ${depositLabel} deposit today plus ${futureCount} future payment${futureCount === 1 ? "" : "s"}`}
                          accessibilityState={{ selected: !isFull }}
                          onPress={() => setPaymentPlanChoice("installments")}
                          style={[
                            styles.payMockSegBtn,
                            !isFull ? { backgroundColor: palette.accent } : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.payMockSegBtnText,
                              { color: !isFull ? palette.accentText : palette.secondaryText },
                            ]}
                          >
                            Pay over time
                          </Text>
                        </Pressable>
                      </View>

                      {/* amount block */}
                      {isFull ? (
                        <View>
                          <View style={styles.payMockAmtRow}>
                            <Text
                              style={[styles.payMockAmt, { color: palette.primaryText }, { fontFamily: boldFamily }]}
                            >
                              {fullLabel}
                            </Text>
                          </View>
                          <Text style={[styles.payMockSub, { color: palette.secondaryText }]}>
                            One payment, all-in. Taxes &amp; fees included.
                          </Text>
                        </View>
                      ) : (
                        <View>
                          <View style={styles.payMockAmtRow}>
                            <Text
                              style={[styles.payMockAmtLabel, { color: palette.tertiaryText }]}
                            >
                              Due today
                            </Text>
                            <Text
                              style={[styles.payMockAmt, { color: palette.primaryText }, { fontFamily: boldFamily }]}
                            >
                              {depositLabel}
                            </Text>
                          </View>
                          <Text style={[styles.payMockSub, { color: palette.secondaryText }]}>
                            {depositPct}% deposit now, then {futureCount} payment
                            {futureCount === 1 ? "" : "s"}. {fullLabel} total — no
                            extra cost.
                          </Text>
                          {/* schedule rows + total */}
                          <View
                            style={[styles.payMockSchedule, { borderTopColor: palette.panelBorder }]}
                          >
                            <View style={styles.payMockSchedRow}>
                              <View style={styles.payMockSchedWhen}>
                                <View
                                  style={[styles.payMockSchedDot, { backgroundColor: palette.accent }]}
                                />
                                <Text
                                  style={[styles.payMockSchedWhenText, { color: palette.secondaryText }]}
                                >
                                  Today
                                </Text>
                                <Text
                                  style={[styles.payMockSchedTag, { color: palette.accent }]}
                                >
                                  Deposit
                                </Text>
                              </View>
                              <Text
                                style={[styles.payMockSchedAmt, { color: palette.primaryText }]}
                              >
                                {depositLabel}
                              </Text>
                            </View>
                            {planSchedule.installments.map((inst) => (
                              <View
                                key={inst.ordinal}
                                style={[
                                  styles.payMockSchedRow,
                                  { borderTopWidth: 1, borderTopColor: palette.panelBorder },
                                ]}
                              >
                                <View style={styles.payMockSchedWhen}>
                                  <View
                                    style={[styles.payMockSchedDot, { backgroundColor: palette.tertiaryText }]}
                                  />
                                  <Text
                                    style={[styles.payMockSchedWhenText, { color: palette.secondaryText }]}
                                  >
                                    {formatScheduleDate(inst.dueAtIso)}
                                  </Text>
                                </View>
                                <Text
                                  style={[styles.payMockSchedAmt, { color: palette.primaryText }]}
                                >
                                  {formatMoneyExact(inst.amountCents, planSchedule.currency)}
                                </Text>
                              </View>
                            ))}
                            <View
                              style={[styles.payMockSchedTotal, { borderTopColor: palette.panelBorder }]}
                            >
                              <Text
                                style={[styles.payMockSchedTotalLabel, { color: palette.secondaryText }]}
                              >
                                Total
                              </Text>
                              <Text
                                style={[styles.payMockSchedTotalValue, { color: palette.primaryText }]}
                              >
                                {fullLabel}
                              </Text>
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })()
          : null}
    </>
  );

  // ORCH-1138 Leg 1C — the FLOATING reserve bar (Seth's explicit ask). It floats
  // over the scrolling content via a position:"absolute" overlay INSIDE the
  // ParallaxCoverShell body host (see the return) — NOT BaseBottomSheet's
  // `stickyFooter` prop. The reserve resolves to the SAME buy-state shape
  // (CtaState) the business/web TripReserveBar uses, so the consumer + business
  // bars read identically. Price label + kicker mirror the business bar:
  //   • plan trip + "Pay over time" → "{deposit} today" + "Due today · deposit"
  //   • free → "Free", no kicker
  //   • else → "From {price}" + "All-in, taxes included"
  // checkout wiring is UNCHANGED — onPress → setReserveSheetVisible(true).
  const barPriceLabel =
    planSchedule !== null && paymentPlanChoice === "installments"
      ? `${formatMoneyExact(planSchedule.depositCents, planSchedule.currency)} today`
      : detail.hasFreeTier && priceLabel === null
        ? "Free"
        : priceLabel !== null
          ? priceLabel
          : "";
  const barKicker =
    barPriceLabel === "Free" || barPriceLabel === ""
      ? null
      : planSchedule !== null && paymentPlanChoice === "installments"
        ? "Due today · deposit"
        : "All-in, taxes included";
  const reserveCta: CtaState =
    detail.bookable === false
      ? {
          kind: "unavailable",
          title: "Booking unavailable",
          subline: "The organizer is finishing payment setup.",
          tappable: false,
        }
      : reserveDisabled
        ? { kind: "unavailable", title: "Bookings closed", subline: null, tappable: false }
        : isSoldOut
          ? { kind: "unavailable", title: "Sold out", subline: null, tappable: false }
          : barPriceLabel === "Free"
            ? { kind: "free", label: "Reserve my spot", tappable: true }
            : {
                kind: "buy",
                label: "Reserve my spot",
                price: barPriceLabel === "" ? "" : `From ${barPriceLabel}`,
                tappable: true,
              };

  // ORCH-1138 [trip-page-redesign] FIX-5 — clearance so the last content row
  // clears the floating bar. Bar height ≈ 14 (top pad) + 56 (button) = ~70, PLUS
  // 14 + safe-area bottom (the bar pads `paddingBottom: 14 + bottomInset`). The
  // scroll content reserves bar-height + safe-area (16 floor) — matching the bar's
  // own bottom-inset resolution — so the last section (How-you-pay) clears the bar.
  // matches the bar's own bottom-inset resolution (max(inset,34) + the 28pt
  // gorhom-sheet overshoot) so the last section clears the taller,
  // home-indicator-safe bar. Bar ≈ 14 (top) + 56 (button) = 70 + (14 + that
  // inset) below.
  const safeBottom = Math.max(insets.bottom, 34) + 28;
  const reserveBarClearance = 84 + safeBottom;

  const floatingReserve: ReactElement = (
    <ConsumerTripReserveBar
      cta={reserveCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={() => setReserveSheetVisible(true)}
      // ORCH-1138 FIX-5 — pass the SCREEN-LEVEL inset; the bar's own
      // useSafeAreaInsets can return 0 inside the gorhom sheet context, which let
      // the "From … today" price line bleed under the home indicator.
      safeAreaBottom={insets.bottom}
      testID="orch-1138-consumer-trip-reserve"
    />
  );

  // ORCH-1138 Leg 1C FIX-1/2 (device-regression rework) — PROVEN ORCH-1016/1043
  // sheet-scroll structure restored, themed Direction-A look kept.
  //
  // 🔒 LOAD-BEARING (do NOT re-wrap): the gorhom `BottomSheetScrollView` is a
  // DIRECT child of `<BaseBottomSheet>` (scrollMode="view" passes our children
  // verbatim as direct children of gorhom's height-bounded `BottomSheetContent`).
  // It carries `flex:1` so it claims the bounded snap height → bounded viewport →
  // the body SCROLLS. We compose the Direction-A native look AROUND it (NOT via
  // ParallaxCoverShell, whose native branch nests its ScrollView inside a
  // `nativeHost` <View>, which made the injected gorhom scroll a NON-direct child →
  // viewport==content → maxScroll 0 → the device freeze Seth reported). The cover
  // (EventCoverMedia, gif/video-aware), OfferingChrome (close/share/mute) and the
  // FLOATING ConsumerTripReserveBar are ABSOLUTE sibling DIRECT children of the
  // sheet, layered by zIndex over the scroll — the reserve bar is ALWAYS visible
  // and floats (Seth's explicit ask), NOT a scroll-off footer and NOT
  // BaseBottomSheet.stickyFooter (which froze the scroll in ORCH-1016). The
  // scroll content carries a cover-height spacer + paddingBottom = bar clearance so
  // the first/last rows clear the pinned cover + floating bar. swipe-down still
  // dismisses (gorhom owns the single registered scrollable). DEVICE-VERIFIED:
  // scroll-not-frozen + bar-floats on iOS sim + the cold deep-link route.
  void isDesktop; // native is always single-column immersive (asserted for parity).
  const showMute = fnd.coverMediaType === "video";
  return renderSheetGroup(
    <>
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel={detail.title}
      >
        {/* (1) pinned cover — absolute sibling BEHIND the scroll (zIndex below
            the scrolling body). EventCoverMedia is gif/video/image-aware and
            renders the hue gradient when no cover (rule 9). */}
        <View style={styles.nativeCover} pointerEvents="none">
          <EventCoverMedia
            mediaUrl={fnd.coverMediaUrl}
            mediaType={fnd.coverMediaType}
            hue={hueFromId(detail.tripId)}
            autoplay
            playbackActive
            muted={muted}
            loop
            height="100%"
            width="100%"
          />
          <View style={styles.coverScrim} pointerEvents="none" />
          <ThemeEntranceAnimation
            theme={theme}
            sessionKey={`trip:${detail.tripId}`}
          />
        </View>

        {/* (2) the gorhom scroll host — DIRECT child of <BaseBottomSheet>, flex:1,
            so it claims the bounded snap height and SCROLLS. The body slides up
            over the pinned cover via the opaque rounded seam + a cover-height
            spacer. zIndex above the cover, below chrome + reserve. */}
        <BottomSheetScrollView
          style={styles.nativeScroll}
          contentContainerStyle={[
            styles.nativeScrollContent,
            { paddingBottom: reserveBarClearance },
          ]}
          showsVerticalScrollIndicator={false}
          testID="orch-1138-consumer-trip-scroll"
        >
          {/* spacer holding the pinned-cover height (4:5) */}
          <View style={styles.coverSpacer} />
          <View
            style={[
              styles.nativeBody,
              { backgroundColor: palette.page, borderColor: palette.panelBorder },
            ]}
          >
            {/* ORCH-1138 [trip-page-redesign] FIX-1 — the eyebrow + title render
                EXACTLY ONCE, in the body `leadBlock` (the first child of
                {bodyChildren}). This matches the business PHONE behavior, where
                ParallaxCoverShell renders the hero eyebrow/title ONLY on desktop
                (`if (isDesktop)`) and the phone shows them solely in the body
                `leadBlock`. The previous seam-overlaid heroEyebrow/heroTitle here
                were a SECOND copy (Seth's device showed the eyebrow+title twice) →
                removed. No cover overlay of eyebrow/title on consumer phone. */}
            {bodyChildren}
          </View>
        </BottomSheetScrollView>

        {/* (3) chrome — absolute sibling above the cover + scroll, padded by the
            safe-area top. Reuses the shared OfferingChrome (close/share/mute). */}
        <View
          style={[styles.nativeChrome, { top: insets.top + 12 }]}
          pointerEvents="box-none"
        >
          <OfferingChrome
            palette={palette}
            showMute={showMute}
            muted={muted}
            onClose={onBack}
            onShare={handleShare}
            onToggleMute={toggleMute}
            closeAccessibilityLabel="Close"
            testID="orch-1138-consumer-trip-chrome"
          />
        </View>

        {/* (4) FLOATING reserve bar — absolute sibling pinned to the sheet bottom,
            ALWAYS visible while scrolling (Seth's ask). NOT stickyFooter. */}
        {floatingReserve}
      </BaseBottomSheet>

      {/* Reserve flow — reuses the proven business-event checkout sheet. Sibling
          BaseBottomSheet root in the same fragment so it overlays this sheet.
          UNCHANGED from today (no consumer-checkout change). */}
      {card !== null ? (
        <ExpandedBusinessEventSheet
          visible={reserveSheetVisible}
          data={card}
          onClose={() => setReserveSheetVisible(false)}
          // ORCH-1130 / DISC-1130-A — pass the buyer's explicit choice ONLY for
          // plan trips (detail.hasPlan). Undefined for no-plan trips → the
          // request stays byte-identical and the edge-fn default path is
          // untouched. NEVER let a plan trip resolve to a silent 'auto'.
          paymentPlanChoice={detail.hasPlan ? paymentPlanChoice : undefined}
          // ORCH-1130 ADDENDUM (Seth-BINDING) — when the buyer picked "Pay over
          // time", forward the deposit DUE TODAY (from the same projected
          // schedule the on-screen toggle renders) so the cart sheet's sticky
          // bar leads with it, mirroring Path A + the Reserve bar above.
          dueTodayCents={
            detail.hasPlan &&
            paymentPlanChoice === "installments" &&
            planSchedule !== null
              ? planSchedule.depositCents
              : undefined
          }
          // ORCH-1016: EBES hides the nav itself. The scroll viewport extends ~46px
          // below the visible screen edge, so the spacer must clear that overshoot +
          // a small gap for the Buy CTA — without over-scrolling. ~58.
          bottomContentInset={Math.max(insets.bottom, 16) + 8}
        />
      ) : null}
    </>,
  );
}

const SEAM = 28;

const styles = StyleSheet.create({
  // ORCH-1138 Leg 1C FIX-1/2 — native Direction-A composition (mirrors the
  // packages/offering-rendering ParallaxCoverShell NATIVE branch, but composed
  // inline so the gorhom BottomSheetScrollView is a DIRECT child of the sheet —
  // see the LOAD-BEARING note at the populated return). Z-order (RN native orders
  // siblings by zIndex within the shared gorhom-bounded parent): cover 1 < scroll
  // 2 < reserve 6 < chrome 70.
  // ---- pinned cover behind the scroll (LOWEST) ----
  nativeCover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    aspectRatio: 4 / 5,
    zIndex: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  // ---- the gorhom scroll host (MIDDLE — must z-index above the cover so the
  // body slides OVER the pinned cover, the native parallax fix) ----
  nativeScroll: { zIndex: 2 },
  nativeScrollContent: { flexGrow: 1 },
  coverSpacer: { width: "100%", aspectRatio: 4 / 5 },
  nativeBody: {
    zIndex: 2,
    marginTop: -SEAM,
    borderTopLeftRadius: SEAM,
    borderTopRightRadius: SEAM,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  // ---- chrome (HIGHEST) — absolute box-none sibling padded by the safe-area top ----
  nativeChrome: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 70,
  },
  // ---- foundation lead / title / eyebrow (mirror business FoundationTripPreview) ----
  leadBlock: { marginBottom: 4 },
  eyebrowLead: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  fndTitle: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
  // ORCH-1138 FIX-1 — the seam heroEyebrow/heroTitle styles were removed with the
  // duplicate cover-overlaid eyebrow/title; the in-body leadBlock (eyebrowLead +
  // fndTitle) is the SOLE eyebrow/title render on consumer phone.
  // ---- meta chips ----
  metaChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metaChipText: { fontSize: 13, fontWeight: "600" },
  // ---- brand chip ----
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  // ORCH-1138 Leg 1C FIX-3 — overflow:"hidden" clips the gif/video-aware
  // EventCoverMedia to the circular tile (Android opaque-clip per
  // ANDROID_GLASS_USES_OPAQUE_FALLBACK; no translucent fill).
  brandTile: {
    width: 42,
    height: 42,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#1a1c20",
  },
  brandTextCol: { flexShrink: 1 },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandNameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  brandName: { fontSize: 15, fontWeight: "800" },
  // ---- section / titles ----
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  // ---- route ----
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
    marginTop: 18,
  },
  routeLeg: { flex: 1, minWidth: 0 },
  routeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  routePlace: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  routeArrow: { fontSize: 18 },
  // ---- about ----
  aboutText: { fontSize: 16, lineHeight: 23, marginTop: 0 },
  // ---- itinerary spine ----
  itin: { position: "relative", paddingLeft: 30, marginTop: 4 },
  itinSpine: { position: "absolute", left: 9, top: 6, bottom: 6, width: 2 },
  day: { position: "relative", paddingBottom: 18 },
  dayDot: {
    position: "absolute",
    left: -30,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDotText: { fontSize: 10, fontWeight: "900" },
  dayOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dayNarr: { fontSize: 13, lineHeight: 20, marginTop: 6 },
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
  // ---- foundation day card (palette-themed via surface.card at the call site) ----
  dayCard: { borderRadius: 14, padding: 14 },
  dayTitle: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  // ---- deadline state bands (kept from pre-1138) ----
  band: { borderRadius: 14, padding: 14, marginTop: 14 },
  bandClosed: { backgroundColor: "rgba(255,80,80,0.12)", borderWidth: 1, borderColor: "rgba(255,80,80,0.3)" },
  bandClosedTitle: { fontSize: 15, fontWeight: "700", color: "#FF6B6B", marginBottom: 4 },
  bandBody: { fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 19 },
  bandCountdown: { backgroundColor: "rgba(235,120,37,0.14)", borderWidth: 1, borderColor: "rgba(235,120,37,0.4)" },
  bandCountdownText: { fontSize: 14, fontWeight: "600", color: WARM },
  // ORCH-1138 FIX-4 — "Choose how you pay" mockup card, MIRRORING the business
  // PaymentMockupCard (`mock.*`) styles 1:1 (DIRECTION_A_V2 `.pay-card`): accent
  // bar, dark segmented TAB track, 34px amount, schedule rows + total. Colors are
  // applied from the brand `palette` at the call site (NOT literal warm-orange) so
  // the consumer + business cards read identically.
  payMockCard: {
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  payMockAccentBar: { height: 4 },
  payMockInner: { padding: 18 },
  payMockSeg: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
  },
  payMockSegBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  payMockSegBtnText: { fontSize: 13, fontWeight: "800" },
  payMockAmtRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 16,
  },
  payMockAmtLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  payMockAmt: { fontSize: 34, fontWeight: "900", letterSpacing: -1 },
  payMockSub: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  payMockSchedule: { marginTop: 16, borderTopWidth: 1, paddingTop: 14 },
  payMockSchedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  payMockSchedWhen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  payMockSchedDot: { width: 8, height: 8, borderRadius: 4 },
  payMockSchedWhenText: { fontSize: 13 },
  payMockSchedTag: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginLeft: 8,
  },
  payMockSchedAmt: { fontSize: 14, fontWeight: "800" },
  payMockSchedTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  payMockSchedTotalLabel: { fontSize: 13 },
  payMockSchedTotalValue: { fontSize: 13, fontWeight: "900" },
  // ORCH-1117 — collapsible-description toggle row (color overridden to the
  // brand accent inline at the call site for foundation parity).
  aboutToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  aboutToggleText: { fontSize: 14, fontWeight: "600", color: WARM },
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
