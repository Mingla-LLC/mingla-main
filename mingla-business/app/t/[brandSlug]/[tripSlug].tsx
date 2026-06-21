/**
 * /t/[brandSlug]/[tripSlug] — public buyer-anon trip detail route.
 * Tr2 (ORCH-0859). ORCH-1138 [trip-page-redesign] rebuilds this onto the shared
 * Direction-A foundation (@mingla/offering-rendering): the cover hero, body-level
 * fixed chrome, brand-themed palette, count-aware galleries, and the responsive
 * desktop two-column sticky booking panel now live in TripPreview's FOUNDATION
 * mode (composed via ParallaxCoverShell). This route resolves the brand theme →
 * palette → surface, owns checkout/share/mute state, and feeds them down.
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth on this page.
 * The "no sign-in redirect" guarantee is enforced at the ROOT layout by the
 * `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist in coldLoadAuthGates.ts (ORCH-1115) —
 * the `/t/` prefix is exempted from the ORCH-1102 unauthenticated redirect, so a
 * logged-out guest with the share link sees this page (NOT the sign-in wall).
 * (Living OUTSIDE app/(tabs)/ is no longer sufficient on its own — ORCH-1102
 * moved the redirect to the root layout that wraps every route.)
 *
 * Lives OUTSIDE app/(tabs)/ — same as /e/, /b/, /checkout/.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover on the public trip share-link page (mirrors /e/{brandSlug}/{eventSlug}); the buyer-facing banner aesthetic is intentional. TripPreview renders the cover full-bleed to the screen edge by design; status-bar overlap is the chosen look. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1, pattern parity with screenshot 17-PUBLIC-EVENT-PAGE.png). ORCH-0874 preserves this; ORCH-1138 keeps the full-bleed cover via the ParallaxCoverShell foundation, chrome absolute-positioned over the cover, no SafeScreen wrapping.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import {
  boldFontFamily,
  createThemePalette,
  resolveOfferingSurface,
  resolveTheme,
  useResponsiveLayout,
  useTripOfferingState,
  TripReserveBar,
  type CtaState,
  type TripPaymentPlanChoice,
  type TripReserveLine,
} from "@mingla/offering-rendering";
import { useThemeFont } from "../../../src/theme/useThemeFont";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import {
  tripCheckoutPath,
  tripPublicUrl,
} from "../../../src/constants/publicUrls";
import { usePublicTripBySlug } from "../../../src/hooks/usePublicTripBySlug";
import { useTripTierAllIn } from "../../../src/hooks/useTripTierAllIn";
// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
import { captureWeb } from "../../../src/analytics/webAnalytics";
import { TripPreview } from "../../../src/components/trip/TripPreview";
import {
  buildTripOfferingBrand,
  buildTripOfferingData,
} from "../../../src/components/trip/tripOfferingAdapter";
import { collapseTripPlanChoice } from "../../../src/components/trip/tripCartPlanChoice";

export default function PublicTripRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    tripSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const tripSlug = Array.isArray(params.tripSlug)
    ? params.tripSlug[0]
    : params.tripSlug;

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  // ORCH-1138 — cover-video sound state (default muted). The chrome Mute button
  // toggles EventCoverMedia's muted state via this (Q4: no new audio engine).
  const [muted, setMuted] = useState<boolean>(true);
  // ORCH-1130 — the public-page pay-full vs pay-over-time choice. The /t/ route
  // lives OUTSIDE the checkout CartProvider, so the choice is held here and
  // threaded into checkout as a route param on Reserve (the checkout index seeds
  // CartContext.paymentPlanChoice from it). Default "full".
  const [paymentPlanChoice, setPaymentPlanChoice] =
    useState<TripPaymentPlanChoice>("full");

  const query = usePublicTripBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof tripSlug === "string" ? tripSlug : null,
  );

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount.
  // Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    captureWeb("web_public_offering_viewed", {
      offering_type: "trip",
      brand_slug: typeof brandSlug === "string" ? brandSlug : null,
      slug: typeof tripSlug === "string" ? tripSlug : null,
    });
  }, [brandSlug, tripSlug]);

  // META-ORCH-1174 Leg B3 — the per-package selection + per-package plan choice
  // (the §10 multi-package box owns the values; the shared state derives the
  // summed all-in / due-today / selected lines). Held here (above the body) so the
  // floating bar + the box read the SAME selection. DEC-B/C/F.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [planChoiceByTier, setPlanChoiceByTier] = useState<
    Record<string, TripPaymentPlanChoice>
  >({});
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
    (ticketTypeId: string, value: TripPaymentPlanChoice): void => {
      setPlanChoiceByTier((prev) => ({ ...prev, [ticketTypeId]: value }));
    },
    [],
  );

  // META-ORCH-1174 Leg B3 — resolve the server all-in per ticket_type (WYSIWYP) so
  // the §10 box shows what the buyer pays, not the bare base. Keyed on the trip's
  // event id (the trip RPC returns it as `trip.id`).
  const tripEventId =
    query.data?.trip?.id !== undefined && query.data.trip.id.length > 0
      ? query.data.trip.id
      : null;
  const allInQuery = useTripTierAllIn(tripEventId);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brandSlug === "string" && brandSlug.length > 0) {
      router.replace(`/b/${brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brandSlug]);

  // ORCH-1114: share → web-aware ShareModal (copy-link/QR/native-share-via).
  // NEVER revert to the bare react-native share API — it dead-taps on
  // react-native-web (navigator.share undefined). See SPEC_ORCH-1114.
  const handleShare = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  const handleToggleMute = useCallback((): void => {
    setMuted((m) => !m);
  }, []);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading trip…</Text>
      </View>
    );
  }

  if (query.isError) {
    // ORCH-0879: surface PostgrestError.message (Supabase errors are
    // { code, message, details, hint } objects, NOT JS Error instances).
    const rawError: unknown = query.error;
    const errorMessage =
      rawError !== null &&
      typeof rawError === "object" &&
      "message" in rawError &&
      typeof (rawError as { message: unknown }).message === "string"
        ? (rawError as { message: string }).message
        : "Check your connection and try again.";
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.stateText}>{errorMessage}</Text>
      </View>
    );
  }

  const payload = query.data;
  if (payload === null || payload === undefined) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Trip not found</Text>
        <Text style={styles.stateText}>
          This trip may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  return (
    <ResolvedTripPage
      payload={payload}
      brandSlug={typeof brandSlug === "string" ? brandSlug : ""}
      tripSlug={typeof tripSlug === "string" ? tripSlug : ""}
      allInByTicketType={allInQuery.data ?? null}
      quantities={quantities}
      onChangeQuantity={handleChangeQuantity}
      planChoiceByTier={planChoiceByTier}
      onChangePlanChoice={handleChangePlanChoice}
      muted={muted}
      onToggleMute={handleToggleMute}
      onClose={handleClose}
      onShare={handleShare}
      paymentPlanChoice={paymentPlanChoice}
      onPaymentPlanChoiceChange={setPaymentPlanChoice}
      shareModalVisible={shareModalVisible}
      onCloseShareModal={() => setShareModalVisible(false)}
      safeAreaTop={insets.top}
      safeAreaBottom={insets.bottom}
      // ORCH-1138 device-rework #3 — the DOCKED Reserve CTA is now the LAST scroll
      // child and carries its OWN safe-area bottom padding, so the scroll content
      // NO LONGER reserves a full bar-sized clearance (that oversized pad was the
      // BLACK VOID Seth flagged). A small tail keeps the last pre-dock content from
      // hiding behind the floating pill at the transition moment.
      contentBottomInset={spacing.md}
      router={router}
    />
  );
}

// Split into a child so the theme/palette resolution + hooks run only when a
// payload exists (the early-return state branches above never resolve a theme).
const ResolvedTripPage: React.FC<{
  payload: NonNullable<ReturnType<typeof usePublicTripBySlug>["data"]>;
  brandSlug: string;
  tripSlug: string;
  allInByTicketType: Map<string, number> | null;
  quantities: Record<string, number>;
  onChangeQuantity: (ticketTypeId: string, qty: number) => void;
  planChoiceByTier: Record<string, TripPaymentPlanChoice>;
  onChangePlanChoice: (ticketTypeId: string, value: TripPaymentPlanChoice) => void;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  paymentPlanChoice: TripPaymentPlanChoice;
  onPaymentPlanChoiceChange: (value: TripPaymentPlanChoice) => void;
  shareModalVisible: boolean;
  onCloseShareModal: () => void;
  safeAreaTop: number;
  safeAreaBottom: number;
  contentBottomInset: number;
  router: ReturnType<typeof useRouter>;
}> = ({
  payload,
  brandSlug,
  tripSlug,
  allInByTicketType,
  quantities,
  onChangeQuantity,
  planChoiceByTier,
  onChangePlanChoice,
  muted,
  onToggleMute,
  onClose,
  onShare,
  paymentPlanChoice,
  onPaymentPlanChoiceChange,
  shareModalVisible,
  onCloseShareModal,
  safeAreaTop,
  safeAreaBottom,
  contentBottomInset,
  router,
}) => {
  const trip = payload.trip;
  const { isDesktop } = useResponsiveLayout();

  // ORCH-1138 — resolve brand theme + per-trip overrides → palette → surface.
  const theme = useMemo(
    () => resolveTheme(payload.brand.theme ?? null, payload.themeOverrides ?? null),
    [payload.brand.theme, payload.themeOverrides],
  );
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => resolveOfferingSurface(theme), [theme]);

  // ORCH-1138 R2 — load the resolved brand font (medium + bold) on demand.
  useThemeFont(theme.fontFamilyValue);
  const boldFamily = boldFontFamily(theme);
  useThemeFont(boldFamily);

  // META-ORCH-1174 Leg A — the ONE normalized body data + brand contract (one
  // build; the SAME object useTripOfferingState reads). The shared body never
  // touches the read hook.
  const data = useMemo(
    () => buildTripOfferingData(trip, payload.bookable !== false, allInByTicketType),
    [trip, payload.bookable, allInByTicketType],
  );
  const offeringBrand = useMemo(
    () => buildTripOfferingBrand(payload.brand),
    [payload.brand],
  );

  // META-ORCH-1174 Leg B3 (Seth, ORCH-1138 preserved) — Reserve routes STRAIGHT to
  // the trip checkout chain. DEC-B: the SELECTED LINES ride a JSON `lines` route
  // param `[{ticketTypeId, quantity, paymentPlanChoice?}]` so the checkout index
  // seeds the cart with ALL selected packages (skipping the tier-select step). The
  // single `plan` param stays as the cart-level default (back-compat / single-tier).
  // No address/tax form (venue-sourced, ORCH-1025/1130). When `lines` is empty (a
  // dead-tap-guarded inert CTA never fires, but the split buttons may) the cart
  // opens to pick — never a dead tap.
  const handleTripReserve = useCallback(
    (choice?: TripPaymentPlanChoice, lines?: TripReserveLine[]): void => {
      const linesParam =
        lines !== undefined && lines.length > 0
          ? { lines: JSON.stringify(lines) }
          : {};
      router.push(
        {
          pathname: tripCheckoutPath(trip.id),
          params: { plan: choice ?? paymentPlanChoice, ...linesParam },
        } as never,
      );
    },
    [router, trip.id, paymentPlanChoice],
  );

  // META-ORCH-1174 Leg B3 — the ONE lifted buy-state machine (the inline §10 box +
  // the docked/floating/desktop bars ALL read this; they can never diverge). The
  // surface owns the selection (quantities + per-tier plan choice); the hook
  // derives the summed all-in / due-today / selected lines.
  const offeringState = useTripOfferingState({
    data,
    paymentPlanChoice,
    quantities,
    planChoiceByTier,
    onReserve: handleTripReserve,
  });

  // ORCH-0875 booking-deadline state banner (route-owned; above the body content).
  const deadlineIso = trip.bookingDeadline;
  const isClosed = trip.bookingsClosed === true;
  let countdownLabel: string | null = null;
  if (!isClosed && deadlineIso !== null) {
    const deadlineMs = Date.parse(deadlineIso);
    if (Number.isFinite(deadlineMs)) {
      const diffMs = deadlineMs - Date.now();
      if (diffMs > 0) {
        const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const hours = Math.floor(diffMs / (60 * 60 * 1000));
        const minutes = Math.floor(diffMs / (60 * 1000));
        if (days >= 1) {
          countdownLabel = `Bookings close in ${days} day${days === 1 ? "" : "s"}`;
        } else if (hours >= 1) {
          countdownLabel = `Bookings close in ${hours} hour${hours === 1 ? "" : "s"}`;
        } else if (minutes >= 1) {
          countdownLabel = `Bookings close in ${minutes} minute${minutes === 1 ? "" : "s"}`;
        }
      }
    }
  }

  // ORCH-1138 device-rework #3 — float→dock Reserve CTA visibility tracking.
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
  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;

  const handleViewBrand = useCallback((): void => {
    if (brandSlug.length > 0) {
      router.push(`/b/${brandSlug}` as never);
    }
  }, [router, brandSlug]);

  const isSoldOut = offeringState.isSoldOut;

  // ORCH-1138 — state banner (sold out / closed / deadline) rendered above body.
  const stateBanner = isClosed ? (
    <View style={[styles.banner, { backgroundColor: "rgba(239,68,68,0.14)" }]}>
      <Text style={[styles.bannerText, { color: "#ef4444" }]}>
        Bookings are closed for this trip
      </Text>
    </View>
  ) : isSoldOut ? (
    <View style={[styles.banner, { backgroundColor: palette.card }]}>
      <Text style={[styles.bannerText, { color: palette.secondaryText }]}>SOLD OUT</Text>
    </View>
  ) : countdownLabel !== null ? (
    <View style={[styles.banner, { backgroundColor: palette.accentWash }]}>
      <Text style={[styles.bannerText, { color: palette.accent }]}>{countdownLabel}</Text>
    </View>
  ) : null;

  // ORCH-1138 — desktop sticky-panel Reserve control (phone uses the floating bar).
  const reserveTappable = offeringState.cta.tappable;
  const barPrice = offeringState.barPriceLabel;
  // META-ORCH-1174 Leg B3 — the bars + desktop control fire Reserve with the SAME
  // selected lines the §10 box reads (DEC-B). Empty selection → no lines → the cart
  // opens to pick (never a dead tap; the CTA itself is gated by reserveTappable).
  // ORCH-1180 — collapse the per-package plan choice into the cart-level choice
  // (mirrors the consumer ConsumerTripDetailScreen). If ANY selected line pays over
  // time, the whole cart leads with the deposit; else "full" (NOT "auto", so no
  // installment rows are minted when no package is on a plan — pay-in-full opt-out).
  const reserveSelected = (): void => {
    handleTripReserve(
      collapseTripPlanChoice(offeringState.selectedLines),
      offeringState.selectedLines,
    );
  };
  const reserveControl = (
    <View>
      <Pressable
        onPress={reserveTappable ? reserveSelected : undefined}
        disabled={!reserveTappable}
        accessibilityRole="button"
        accessibilityState={{ disabled: !reserveTappable }}
        accessibilityLabel={
          reserveTappable
            ? `Reserve your spot on ${trip.title}`
            : ctaUnavailableLabel(offeringState.cta)
        }
        style={[
          styles.deskReserve,
          reserveTappable
            ? { backgroundColor: palette.accent }
            : { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 },
        ]}
        testID="orch-1138-trip-desk-reserve"
      >
        <Text
          style={[
            styles.deskReserveText,
            { color: reserveTappable ? palette.accentText : palette.tertiaryText },
            { fontFamily: boldFamily },
          ]}
        >
          {reserveTappable
            ? barPrice === "" || offeringState.cta.kind === "free"
              ? "Reserve my spot"
              : `Reserve · ${barPrice}`
            : ctaUnavailableLabel(offeringState.cta)}
        </Text>
      </Pressable>
      <Text style={[styles.deskReassure, { color: palette.tertiaryText }]}>
        Free to hold · cancel per policy below
      </Text>
    </View>
  );

  // META-ORCH-1174 — the DOCKED Reserve CTA (shared TripReserveBar variant="docked"),
  // rendered by TripPreview as the LAST phone-body child. Reads the SAME state.
  const dockedReserve = !isDesktop ? (
    <TripReserveBar
      cta={offeringState.cta}
      palette={palette}
      kicker={offeringState.barKicker}
      fontFamily={boldFamily}
      onPress={reserveSelected}
      splitCtas={offeringState.splitCtas}
      variant="docked"
      safeAreaBottom={safeAreaBottom}
      onDockLayout={handleDockLayout}
      testID="orch-1117-trip-floating-bar"
    />
  ) : undefined;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <TripPreview
        trip={trip}
        brand={payload.brand}
        offeringData={data}
        offeringBrand={offeringBrand}
        offeringState={offeringState}
        palette={palette}
        theme={theme}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={onClose}
        onShare={onShare}
        onViewBrand={handleViewBrand}
        stateBanner={stateBanner}
        paymentPlanChoice={paymentPlanChoice}
        onPaymentPlanChoiceChange={onPaymentPlanChoiceChange}
        quantities={quantities}
        onChangeQuantity={onChangeQuantity}
        planChoiceByTier={planChoiceByTier}
        onChangePlanChoice={onChangePlanChoice}
        onReserve={handleTripReserve}
        reserveControl={reserveControl}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        dockedReserve={dockedReserve}
        onScroll={handleScroll}
        onScrollViewLayout={handleScrollLayout}
        testID="orch-1138-trip-preview"
      />

      {brandSlug.length > 0 && tripSlug.length > 0 ? (
        <ShareModal
          visible={shareModalVisible}
          onClose={onCloseShareModal}
          url={tripPublicUrl({ brandSlug, tripSlug })}
          title={trip.title}
          description={trip.description?.slice(0, 200)}
        />
      ) : null}

      {/* META-ORCH-1174 — the FLOATING Reserve PILL (phone): shown ONLY while the
          docked CTA is off-screen. The SHARED TripReserveBar (web/business → no
          sheet overshoot). Same state as the docked bar so copy never diverges. */}
      {!isDesktop && floatingPillVisible ? (
        <TripReserveBar
          cta={offeringState.cta}
          palette={palette}
          kicker={offeringState.barKicker}
          fontFamily={boldFamily}
          onPress={reserveSelected}
          splitCtas={offeringState.splitCtas}
          variant="floating"
          safeAreaBottom={safeAreaBottom}
          testID="orch-1117-trip-floating-bar"
        />
      ) : null}
    </View>
  );
};

function ctaUnavailableLabel(cta: CtaState): string {
  return cta.kind === "unavailable" ? cta.title : "Booking unavailable";
}

// ORCH-1117 — minor-unit price formatter for the bar (reads priceCents; never
// recomputes fees).
function formatTripPrice(priceCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(0)} ${currency}`;
  }
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    position: "relative",
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  banner: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  deskReserve: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 18,
  },
  deskReserveText: {
    fontSize: 16,
    fontWeight: "900",
  },
  deskReassure: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
  },
});
