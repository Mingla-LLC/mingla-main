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
 * Buyer flow (§F, ORCH-1138 [trip-page-redesign]): Reserve opens the cart
 * (TicketCartSheet) DIRECTLY — seeded at the sole/first sellable tier — skipping
 * the duplicate full detail page the old EBES hop showed. The trip screen owns the
 * SAME usePublicEventTickets + useTripIntakeSchemas + useNativeCheckoutFlow wiring
 * the shared event sheet held, scoped to the trip; the trip's tier `ticket_type_id`s
 * map onto the same `lines` contract; intake answers (when a schema exists — none
 * today) ride the nativeCheckoutFlow `intakeFormData` body key →
 * orders.intake_form_data. The checkout REQUEST is byte-identical to the prior
 * two-tap path (no address / taxCalculationId; venue-sourced tax). The cart renders
 * as a SIBLING BaseBottomSheet root in the same fragment
 * (feedback_rn_sub_sheet_must_render_inside_parent).
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
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  boldFontFamily,
  createThemePalette,
  EventCoverMedia,
  resolveTheme,
  ThemeEntranceAnimation,
  TripOfferingBody,
  TripReserveBar,
  useTripOfferingState,
  // ORCH-1181 — per-package deposit-due-today + the shared installment sub-line
  // copy (identical to business + web). Reuses the same all-in deposit math the
  // cart-level "Due today" reads — never recomputes fees.
  tripTierDepositTodayCents,
  formatTripTierInstallmentNote,
  type TripOfferingData,
  type TripPaymentPlanChoice,
  type TripReserveLine,
} from "@mingla/offering-rendering";
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
import { OfferingChrome } from "@mingla/offering-rendering";

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
// ORCH-1138 [trip-page-redesign] — Reserve opens the cart (TicketCartSheet)
// DIRECTLY. The shared ExpandedBusinessEventSheet is NO LONGER imported here
// (it showed buyers a duplicate full detail page); it stays the events/
// experiences detail+checkout sheet, mounted from ExpandedCardModal +
// MessageInterface. The trip screen now owns the same cart + native-checkout
// wiring EBES held, scoped to the trip.
import TicketCartSheet, {
  type TicketCartCheckoutPayload,
} from "../../components/expandedCard/TicketCartSheet";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import { useTripIntakeSchemas } from "../../hooks/useTripIntakeSchemas";
import { circleKeys } from "../../hooks/queryKeys";
import { useAppStore } from "../../store/appStore";
import {
  type NativeCheckoutOutcome,
  useNativeCheckoutFlow,
} from "../../payments/nativeCheckoutFlow";
import { toastManager } from "../../components/ui/Toast";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { glass } from "../../constants/designSystem";
import { hueFromId } from "../../utils/hueFromId";
import {
  useConsumerTripDetail,
  type ConsumerTripDetail,
} from "../../hooks/useConsumerTripDetail";
import { useEventTheme } from "../../hooks/useEventTheme";
import { useConsumerThemeFont } from "../../theme/useConsumerThemeFont";
import {
  buildConsumerTripOfferingBrand,
  buildConsumerTripOfferingData,
  type ConsumerTripTierEnrichment,
} from "../../hooks/useConsumerTripOfferingData";
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

// META-ORCH-1174 Leg A — a null-safe empty body data so useTripOfferingState can
// run unconditionally (Rules of Hooks) before the loading/error early returns.
const EMPTY_TRIP_OFFERING_DATA: TripOfferingData = {
  id: "",
  title: "",
  description: null,
  startAt: null,
  endAt: null,
  durationLabel: null,
  dateRangeLabel: "",
  departureCityCountry: null,
  destinationCityCountry: null,
  destinationText: null,
  spotsLabel: null,
  bookingDeadlineIso: null,
  days: [],
  inclusions: [],
  refundPolicy: null,
  tiers: [],
  currency: "USD",
  destinationLat: null,
  destinationLng: null,
  bookable: true,
  bookingsClosed: false,
};

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

// META-ORCH-1174 Leg A — the consumer-local installment projection + schedule/
// money formatters + the inline "HOW YOU PAY" mockup were RETIRED: the shared
// TripOfferingBody renders the §10 box via the package TripPaymentChoice
// (projecting via useTripOfferingState's pure projectTripSchedule). `formatMoney`
// stays only for the bar's aggregate price label.

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

// ORCH-1138 [trip-page-redesign] — the full `tripToBusinessEventCard()` adapter
// (which mapped the trip onto the BusinessEventCard shape ExpandedBusinessEventSheet
// consumed) is DELETED: Reserve no longer routes through EBES, so the only
// remaining consumer of a card-shaped object is `useEventTheme`, which reads ONLY
// `card.eventId`. A minimal `{ eventId: detail.tripId }` theme card is built inline
// at the call site instead. The cart fetches tickets/intake by `eventId === tripId`
// directly via usePublicEventTickets / useTripIntakeSchemas.

export default function ConsumerTripDetailScreen({
  brandSlug,
  tripSlug,
  seed = null,
  onBack,
  tabBarAware = true,
  accountPreferences,
}: ConsumerTripDetailScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { detail, isLoading, isError, refetch } = useConsumerTripDetail(
    brandSlug,
    tripSlug,
    seed,
  );
  // ORCH-1138 [trip-page-redesign] — direct-cart state (replaces the old
  // reserveSheetVisible that mounted the duplicate ExpandedBusinessEventSheet
  // detail page). Reserve now seeds + opens TicketCartSheet directly.
  const [cartVisible, setCartVisible] = useState(false);
  const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(
    null,
  );
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);
  // ORCH-1138 — the cart + native-checkout wiring the trip screen now owns
  // (ported from ExpandedBusinessEventSheet, scoped to the trip). The cart
  // fetches its own tickets/intake by eventId === tripId, exactly as EBES did.
  const tripId = detail !== null ? detail.tripId : null;
  const ticketsQuery = usePublicEventTickets(tripId);
  const intakeSchemasQuery = useTripIntakeSchemas(tripId);
  const runNativeCheckout = useNativeCheckoutFlow();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  // ORCH-1130 — consumer pay-full vs pay-over-time choice. Default "full" (the
  // deliberate non-surprising default; a buyer who does nothing pays the whole
  // price, never a silent partial). Threaded into the reserve flow so the
  // server receives an EXPLICIT choice for plan trips (DISC-1130-A consent fix).
  const [paymentPlanChoice, setPaymentPlanChoice] =
    useState<"full" | "installments">("full");
  // META-ORCH-1174 Leg B3 — the per-package selection (DEC-B/C) + per-package plan
  // choice (DEC-F). The §10 multi-package box steppers write through these; the
  // shared state derives the summed all-in / due-today / selected lines. Reserve
  // seeds the cart with the selected lines via initialQuantities (the cart is still
  // the confirmation step — never auto-charges).
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [planChoiceByTier, setPlanChoiceByTier] = useState<
    Record<string, "full" | "installments">
  >({});
  const [seededQuantities, setSeededQuantities] = useState<
    Record<string, number> | undefined
  >(undefined);
  const handleChangeQuantity = useCallback(
    (ticketTypeId: string, qty: number): void => {
      setQuantities((prev) => {
        const next = { ...prev };
        if (qty <= 0) delete next[ticketTypeId];
        else next[ticketTypeId] = qty;
        return next;
      });
    },
    [],
  );
  const handleChangePlanChoice = useCallback(
    (ticketTypeId: string, value: "full" | "installments"): void => {
      setPlanChoiceByTier((prev) => ({ ...prev, [ticketTypeId]: value }));
    },
    [],
  );
  // META-ORCH-1174 — the OS reduce-motion preference, threaded into the shared
  // TripOfferingBody (it owns the About collapse animation + the countdown pill).
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

  // ORCH-1138 [trip-page-redesign] — minimal theme `card`. useEventTheme reads
  // ONLY `card.eventId`, so the full tripToBusinessEventCard adapter (deleted with
  // the EBES mount) is no longer needed — a one-field card suffices for theming.
  // Kept named `card` so the existing palette-parity wiring/tests stay intact.
  const card = useMemo<BusinessEventCard | null>(
    () =>
      detail !== null
        ? ({ eventId: detail.tripId } as unknown as BusinessEventCard)
        : null,
    [detail],
  );

  // ORCH-1138 Leg 1C — resolve the SAME brand palette/theme the business/web trip
  // page uses, via the EXISTING anon-safe useEventTheme(card) (reads
  // business_public_events_view — 🔒 COMMS-0009, NEVER .from('brands')). Default
  // theme (MINGLA palette) when the brand set none / on error — never a crash.
  const themeQuery = useEventTheme(card);
  const theme = themeQuery.data ?? resolveTheme(null, null);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
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

  // ORCH-1138 device-rework #3 — float→dock Reserve CTA visibility tracking. These
  // hooks MUST be declared BEFORE any early return (loading/error/not-found) per
  // the Rules of Hooks. The floating pill is visible ONLY while the in-content
  // docked button's TOP has NOT yet entered the viewport bottom: we track the
  // docked card's `y` within the scroll content (onDockLayout), the scroll offset
  // (onScroll) + the viewport height (onLayout). The derived `floatingPillVisible`
  // (computed below, after the early returns) consumes these.
  const [dockTopY, setDockTopY] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState<number>(0);
  const [viewportH, setViewportH] = useState<number>(0);
  const handleDockLayout = useCallback((e: LayoutChangeEvent): void => {
    setDockTopY(e.nativeEvent.layout.y);
  }, []);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      setScrollY(e.nativeEvent.contentOffset.y);
    },
    [],
  );
  const handleScrollLayout = useCallback((e: LayoutChangeEvent): void => {
    setViewportH(e.nativeEvent.layout.height);
  }, []);

  // META-ORCH-1174 — native render is always single-column immersive (the shared
  // TripOfferingBody is mounted with variant="phone"); useResponsiveLayout is no
  // longer read here (the body derives its own layout).

  // META-ORCH-1174 — the plan-tier schedule projection moved into the shared
  // useTripOfferingState (offeringState.projectedSchedule), and the §10 "Choose
  // how you pay" box is rendered by the shared TripOfferingBody. The consumer no
  // longer hand-rolls the projection / mockup.

  // ORCH-1138 [trip-page-redesign] — Reserve opens the cart DIRECTLY. openCart
  // selects the seed tier (the first SELLABLE tier — capacity>0 or unlimited;
  // single-tier trips just use tiers[0]) and opens TicketCartSheet. Free trips
  // take the SAME path — TicketCartSheet's CTA becomes "Get free", no separate
  // branch. NEVER auto-charges: the cart is still the confirmation step
  // (I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED preserved).
  const openCart = useCallback((): void => {
    if (detail === null || detail.tiers.length === 0) return;
    const sellable =
      detail.tiers.find(
        (t) =>
          t.isUnlimited || t.quantityTotal === null || t.quantityTotal > 0,
      ) ?? detail.tiers[0];
    setInitialTicketTypeId(sellable.ticketTypeId);
    setCartVisible(true);
  }, [detail]);

  // ORCH-1138 (Seth, 2026-06-15) — SPLIT BUTTONS fast path. "Pay in full" /
  // "Pay over time" open the cart with that choice ALREADY selected, skipping the
  // scroll to the "Choose how you pay" toggle. We set `paymentPlanChoice` FIRST
  // (state batches before paint, so the cart mounts with the matching
  // dueTodayCents and handleBuy reads the matching choice — byte-identical to
  // picking the toggle then Reserve), then reuse openCart's seed+open. NEVER
  // auto-charges (the cart is still the confirmation step).
  const openCartWithChoice = useCallback(
    (choice: "full" | "installments"): void => {
      setPaymentPlanChoice(choice);
      openCart();
    },
    [openCart],
  );

  // META-ORCH-1174 Leg A — the ONE normalized body data + the lifted buy-state.
  // Built null-safe so the hooks run unconditionally (Rules of Hooks — BEFORE the
  // loading/error/not-found early returns). The §10 box + the docked/floating bar
  // all read this state → never diverge. Reserve opens the cart DIRECTLY (the
  // gate-protected straight-to-cart flow, ORCH-1138).
  // META-ORCH-1174 Leg B3 — the per-tier server all-in + description from the SAME
  // tickets source the cart uses (usePublicEventTickets). The §10 box DISPLAYS +
  // SUMS this all-in (WYSIWYP); the description rounds out each package row.
  const tierEnrichment = useMemo<
    Map<string, ConsumerTripTierEnrichment>
  >(() => {
    const map = new Map<string, ConsumerTripTierEnrichment>();
    for (const t of ticketsQuery.data ?? []) {
      map.set(t.id, {
        allInCents:
          typeof t.priceAllInGbp === "number"
            ? Math.round(t.priceAllInGbp * 100)
            : null,
        description: t.description ?? null,
      });
    }
    return map;
  }, [ticketsQuery.data]);

  const offeringData = useMemo<TripOfferingData>(
    () =>
      detail !== null
        ? buildConsumerTripOfferingData(detail, tierEnrichment)
        : EMPTY_TRIP_OFFERING_DATA,
    [detail, tierEnrichment],
  );
  // META-ORCH-1174 Leg B3 — Reserve opens the cart DIRECTLY, seeded with the
  // SELECTED LINES (DEC-B). `lines` carries the §10 multi-package selection; we
  // stash it as initialQuantities so the cart lands pre-populated + editable (the
  // confirmation step, never auto-charged). Empty selection → open un-seeded (the
  // cart's own steppers let the buyer pick — never a dead tap). The split-button
  // `choice` fast path is preserved for a single-package plan trip.
  const onReserveFromBody = useCallback(
    (choice?: TripPaymentPlanChoice, lines?: TripReserveLine[]): void => {
      if (lines !== undefined && lines.length > 0) {
        const seed: Record<string, number> = {};
        for (const l of lines) seed[l.ticketTypeId] = l.quantity;
        setSeededQuantities(seed);
        // If any selected line pays over time, lead the cart with the deposit.
        const anyInstallments = lines.some(
          (l) => l.paymentPlanChoice === "installments",
        );
        setPaymentPlanChoice(anyInstallments ? "installments" : "full");
        openCart();
        return;
      }
      setSeededQuantities(undefined);
      if (choice !== undefined) openCartWithChoice(choice);
      else openCart();
    },
    [openCart, openCartWithChoice],
  );
  const offeringState = useTripOfferingState({
    data: offeringData,
    paymentPlanChoice,
    quantities,
    planChoiceByTier,
    onReserve: onReserveFromBody,
  });

  // ORCH-1181 — the per-package installment sub-line shown on each cart tile
  // (parity with the business/web checkout tile). For each PLAN tier whose
  // effective choice is pay-over-time, compute the deposit-due-today off the
  // SAME all-in deposit math the cart-level "Due today" uses
  // (tripTierDepositTodayCents), and format via the SHARED copy formatter. We
  // scale by the buyer's selected quantity (default 1 so the affordance shows on
  // a plan tier even before a row is bumped). Gated on detail.hasPlan so events /
  // experiences / no-plan trips contribute nothing (the map is empty → no notes).
  const installmentNoteByTicketId = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (detail === null || !detail.hasPlan) return map;
    for (const tier of offeringData.tiers) {
      const hasPlan =
        tier.installmentSchedule !== null &&
        tier.installmentSchedule !== undefined;
      if (!hasPlan) continue;
      // Effective per-tier choice: explicit per-tier map wins, else the cart-level
      // toggle (mirrors useTripOfferingState's effectivePlanByTier).
      const choice =
        planChoiceByTier[tier.ticketTypeId] ?? paymentPlanChoice;
      if (choice !== "installments") continue;
      const qty = Math.max(1, quantities[tier.ticketTypeId] ?? 1);
      const deposit = tripTierDepositTodayCents(
        {
          ticketTypeId: tier.ticketTypeId,
          priceCents: tier.priceCents,
          priceAllInCents: tier.priceAllInCents ?? null,
          isFree: tier.isFree,
          isUnlimited: tier.isUnlimited,
          ticketsRemaining: tier.ticketsRemaining,
          installmentSchedule: tier.installmentSchedule,
        },
        qty,
      );
      const note = formatTripTierInstallmentNote(
        deposit,
        tier.currency || detail.currency || "USD",
        (value, currency) =>
          (() => {
            try {
              return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: currency || "USD",
              }).format(value);
            } catch {
              return `${value.toFixed(2)} ${currency}`;
            }
          })(),
      );
      if (note !== null) map[tier.ticketTypeId] = note;
    }
    return map;
  }, [detail, offeringData.tiers, planChoiceByTier, paymentPlanChoice, quantities]);

  // ORCH-1138 — handleBuy ported VERBATIM (behavior) from EBES handleBuy
  // (ExpandedBusinessEventSheet.tsx:313-432), scoped to the trip. Same buyer
  // derivation, same guards, same byte-identical runNativeCheckout request (NO
  // address, NO taxCalculationId — venue-sourced tax per ORCH-1025/1130), same
  // success/cancel/failure toasts + the SAME post-success cache invalidations
  // (businessEventOrders + circle keys, plus the 3× polling loop for paid
  // checkouts) so a trip purchase refreshes the same surfaces (SPEC OQ-1).
  const handleBuy = useCallback(
    async (payload: TicketCartCheckoutPayload): Promise<void> => {
      if (checkoutInFlight) return;
      if (detail === null) return;
      if (user === null) {
        toastManager.show("Please sign in to get tickets.", "warning");
        return;
      }
      const buyerName =
        profile?.display_name?.trim() || user.email?.split("@")[0] || "Guest";
      const buyerEmail = user.email ?? profile?.email ?? "";
      const buyerPhone = profile?.phone ?? "";

      if (buyerEmail.length === 0) {
        toastManager.show(
          "We need an email on your profile to issue tickets.",
          "warning",
        );
        return;
      }
      if (buyerPhone.length === 0) {
        toastManager.show(
          "Add a phone number to your profile to get tickets.",
          "warning",
        );
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCheckoutInFlight(true);

      let result: NativeCheckoutOutcome;
      try {
        result = await runNativeCheckout({
          eventId: detail.tripId,
          lines: payload.lines,
          buyer: {
            name: buyerName,
            email: buyerEmail,
            phone: buyerPhone,
            marketingOptIn: payload.marketingOptIn,
          },
          // ORCH-1025 — no taxCalculationId, no address: tax is computed
          // server-side from the venue. ORCH-1016 (D2) — per-tier trip intake
          // answers ride intakeFormData; empty array omitted (byte-identical).
          ...(payload.intakeFormData.length > 0
            ? { intakeFormData: payload.intakeFormData }
            : {}),
          // ORCH-1130 / DISC-1130-A — forward the buyer's EXPLICIT pay-full vs
          // pay-over-time choice ONLY for a plan trip (detail.hasPlan). Undefined
          // for no-plan trips → request byte-identical; NEVER a silent 'auto'.
          paymentPlanChoice: detail.hasPlan ? paymentPlanChoice : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        setCheckoutInFlight(false);
      }

      if (result.outcome === "succeeded") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        toastManager.show("Ticket secured! Check your calendar.", "success");
        const userId = user.id;
        queryClient.invalidateQueries({
          queryKey: ["businessEventOrders", userId],
        });
        queryClient.invalidateQueries({ queryKey: circleKeys.all });
        if (payload.totalCents > 0) {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts += 1;
            queryClient.invalidateQueries({
              queryKey: ["businessEventOrders", userId],
            });
            queryClient.invalidateQueries({ queryKey: circleKeys.all });
            if (attempts >= 3) clearInterval(interval);
          }, 1000);
        }
      } else if (result.outcome === "canceled") {
        // Silent: user dismissed PaymentSheet.
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastManager.show(result.message, "error");
      }
    },
    [
      checkoutInFlight,
      detail,
      user,
      profile,
      runNativeCheckout,
      paymentPlanChoice,
      queryClient,
    ],
  );

  // ORCH-1138 — cart Continue/Claim → close the cart first (mirror EBES
  // handleCartCheckout :446-449), then fire the checkout.
  const handleCartCheckout = useCallback(
    (payload: TicketCartCheckoutPayload): void => {
      setCartVisible(false);
      void handleBuy(payload);
    },
    [handleBuy],
  );

  const handleCartCancel = useCallback((): void => {
    setCartVisible(false);
    setInitialTicketTypeId(null);
    // META-ORCH-1174 Leg B3 — clear the multi-package seed so a later single-tier
    // Reserve doesn't re-seed the prior multi-selection.
    setSeededQuantities(undefined);
  }, []);

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

  // META-ORCH-1174 — the shared body data + brand contract (one build), and the
  // bar/box buy-state (offeringState, computed above the early returns). The §10
  // box + the docked/floating bars all read offeringState — never diverge.
  const offeringBrand = buildConsumerTripOfferingBrand(detail);

  // META-ORCH-1174 device-rework #3 — derived float-pill visibility (the hooks
  // dockTopY/scrollY/viewportH + their setters are declared at the TOP of the
  // component, BEFORE the early returns, per the Rules of Hooks).
  const reserveBarClearance = 8;
  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;

  // META-ORCH-1174 — the DOCKED reserve CTA (shared TripReserveBar variant="docked"),
  // rendered as the LAST scroll child by the shared body (flush, no void). It reads
  // offeringState; onPress → openCart (the gate-protected straight-to-cart flow).
  // The consumer threads its screen-level safeAreaBottom + the gorhom sheet
  // overshoot (≈63 at the 90% snap) so the floating pill clears the home indicator.
  const dockedReserve: ReactElement = (
    <TripReserveBar
      cta={offeringState.cta}
      palette={palette}
      kicker={offeringState.barKicker}
      fontFamily={boldFamily}
      onPress={openCart}
      splitCtas={offeringState.splitCtas}
      variant="docked"
      safeAreaBottom={insets.bottom}
      onDockLayout={handleDockLayout}
      testID="orch-1138-consumer-trip-reserve"
    />
  );

  const floatingReserve: ReactElement | null = floatingPillVisible ? (
    <TripReserveBar
      cta={offeringState.cta}
      palette={palette}
      kicker={offeringState.barKicker}
      fontFamily={boldFamily}
      onPress={openCart}
      splitCtas={offeringState.splitCtas}
      variant="floating"
      safeAreaBottom={insets.bottom}
      sheetBottomOvershoot={63}
      testID="orch-1138-consumer-trip-reserve"
    />
  ) : null;

  const showMute = detail.coverMediaType === "video";
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
            mediaUrl={detail.coverMediaUrl}
            mediaType={detail.coverMediaType}
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
          // ORCH-1138 device-rework #3 — track scroll offset + viewport height so
          // the floating pill hides once the docked CTA (last child) scrolls in.
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onLayout={handleScrollLayout}
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
            {/* META-ORCH-1174 Leg A — THE ONE shared TripOfferingBody (sections
                2→11) renders inside this gorhom scroll. The eyebrow+title render
                ONCE in the body's phone leadBlock; the DOCKED reserve CTA is passed
                as dockedReserve so it renders as the LAST body child (flush, no
                void). The §10 box + this docked bar read the SAME offeringState. */}
            <TripOfferingBody
              data={offeringData}
              brand={offeringBrand}
              palette={palette}
              theme={theme}
              state={offeringState}
              callbacks={{
                onViewBrand: () => {
                  if (brandSlug.length > 0) {
                    router.push(`/b/${brandSlug}` as never);
                  }
                },
                onReserve: onReserveFromBody,
              }}
              variant="phone"
              paymentPlanChoice={paymentPlanChoice}
              onPaymentPlanChoiceChange={setPaymentPlanChoice}
              quantities={quantities}
              onChangeQuantity={handleChangeQuantity}
              planChoiceByTier={planChoiceByTier}
              onChangePlanChoice={handleChangePlanChoice}
              dockedReserve={dockedReserve}
              reduceMotion={reduceMotion}
              testID="meta-orch-1174-consumer-trip-body"
            />
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

        {/* (4) FLOATING reserve PILL — absolute sibling, JUST the button (no
            full-width bar bg), shown ONLY while the docked CTA (last scroll child)
            is off-screen. Hides once the docked button scrolls in → no double bar.
            NOT stickyFooter (would re-freeze the gorhom scroll). */}
        {floatingReserve}
      </BaseBottomSheet>

      {/* ORCH-1138: Reserve opens the cart DIRECTLY. Do NOT route trips through
          ExpandedBusinessEventSheet — that showed buyers a duplicate detail page
          (Seth, 2026-06-15). EBES stays for events/experiences only. Sibling
          BaseBottomSheet root in the same fragment so it overlays this sheet
          (feedback_rn_sub_sheet_must_render_inside_parent). The checkout request
          is byte-identical to the prior two-tap EBES path (handleBuy ported
          verbatim): same lines/buyer, same paymentPlanChoice forwarding, NO
          address / taxCalculationId (venue-sourced tax, ORCH-1025/1130). */}
      <TicketCartSheet
        visible={cartVisible}
        eventId={detail.tripId}
        tickets={ticketsQuery.data}
        intakeSchemasByTier={intakeSchemasQuery.data}
        fallbackCurrency={detail.currency ?? "USD"}
        initialTicketTypeId={initialTicketTypeId}
        // META-ORCH-1174 Leg B3 — when Reserve fired with a multi-package selection,
        // seed the cart with ALL selected lines (takes precedence over the single
        // initialTicketTypeId). The cart lands pre-populated + editable (the
        // confirmation step). Empty/undefined → single-tier seed (Leg-A behavior).
        initialQuantities={seededQuantities}
        buyerName={
          profile?.display_name?.trim() || user?.email?.split("@")[0] || "Guest"
        }
        buyerEmail={user?.email ?? profile?.email ?? ""}
        buyerPhone={profile?.phone ?? ""}
        isSubmitting={checkoutInFlight}
        clearFloatingNav={false}
        // ORCH-1130 ADDENDUM (Seth-BINDING) — when the buyer picked "Pay over
        // time" on a plan trip, lead the cart's sticky bar with the deposit DUE
        // TODAY (same projected schedule the on-screen toggle renders). Undefined
        // for no-plan / pay-in-full → the all-in total shows, byte-identical.
        dueTodayCents={
          detail.hasPlan &&
          paymentPlanChoice === "installments" &&
          offeringState.projectedSchedule !== null
            ? offeringState.projectedSchedule.depositCents
            : undefined
        }
        // ORCH-1181 — per-package installment sub-line on each cart tile (parity
        // with business/web). Empty for events / no-plan / pay-in-full.
        installmentNoteByTicketId={installmentNoteByTicketId}
        onCancel={handleCartCancel}
        onCheckout={handleCartCheckout}
      />
    </>,
  );
}

const SEAM = 28;

const styles = StyleSheet.create({
  // META-ORCH-1174 Leg A — the native Direction-A composition styles. The forked
  // body styles (leadBlock / metaChip / brand / route / day / band / payMock /
  // about) were RETIRED with the hand-mirrored body — the shared TripOfferingBody
  // owns those now. Only the surface scaffold (cover/scroll/chrome) + the loading
  // / error state styles remain here. Z-order: cover 1 < scroll 2 < reserve 6 <
  // chrome 70.
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
  nativeChrome: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 70,
  },
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
  stateBody: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  stateTitle: { fontSize: 17, fontWeight: "600", color: "#FFFFFF", marginTop: 12 },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
