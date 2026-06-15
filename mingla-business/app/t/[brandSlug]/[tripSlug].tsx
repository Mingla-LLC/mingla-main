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

import React, { useCallback, useMemo, useState } from "react";
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
  type CtaState,
} from "@mingla/event-rendering";
import { useResponsiveLayout } from "@mingla/offering-rendering";
import { useThemeFont } from "../../../src/theme/useThemeFont";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { TripReserveBar } from "../../../src/components/trip/TripReserveBar";
import type { ReserveSplitCtas } from "../../../src/components/trip/TripReserveBar";
import {
  tripCheckoutPath,
  tripPublicUrl,
} from "../../../src/constants/publicUrls";
import { usePublicTripBySlug } from "../../../src/hooks/usePublicTripBySlug";
import { TripPreview } from "../../../src/components/trip/TripPreview";
import { TripCheckoutFlow } from "../../../src/components/trip/TripCheckoutFlow";
import type { TripPaymentChoiceValue } from "../../../src/components/trip/TripPaymentChoice";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";

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
    useState<TripPaymentChoiceValue>("full");

  const query = usePublicTripBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof tripSlug === "string" ? tripSlug : null,
  );

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
      muted={muted}
      onToggleMute={handleToggleMute}
      onClose={handleClose}
      onShare={handleShare}
      paymentPlanChoice={paymentPlanChoice}
      onPaymentPlanChoiceChange={setPaymentPlanChoice}
      shareModalVisible={shareModalVisible}
      onCloseShareModal={() => setShareModalVisible(false)}
      safeAreaTop={insets.top}
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
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  paymentPlanChoice: TripPaymentChoiceValue;
  onPaymentPlanChoiceChange: (value: TripPaymentChoiceValue) => void;
  shareModalVisible: boolean;
  onCloseShareModal: () => void;
  safeAreaTop: number;
  contentBottomInset: number;
  router: ReturnType<typeof useRouter>;
}> = ({
  payload,
  brandSlug,
  tripSlug,
  muted,
  onToggleMute,
  onClose,
  onShare,
  paymentPlanChoice,
  onPaymentPlanChoiceChange,
  shareModalVisible,
  onCloseShareModal,
  safeAreaTop,
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

  // ORCH-1138 R2 (device parity fix #1) — LOAD the resolved brand font on demand.
  // The FONT_FAMILY_MAP values (e.g. "Poppins_500Medium") are NOT bundled at the
  // app root (ORCH-1083 deferred the 14 families out of the boot bundle); a themed
  // surface MUST call useThemeFont so expo-font fetches the family. Without this,
  // setting fontFamily on Text silently no-ops on native → the system font shows
  // (Seth's device finding #1). Mirrors PublicEventPage / PublicBrandPage exactly.
  useThemeFont(theme.fontFamilyValue);
  // ORCH-1138 Leg-1 (native-parity fix #2) — ALSO load the BOLD (700-weight)
  // family. On native a loaded custom font ignores `fontWeight`, so every bold
  // text on the page sets `fontFamily` to the weight-specific family
  // (boldFontFamily(theme), e.g. "Inter_700Bold"); without registering it here
  // expo-font has no bold face → native silently falls back to medium/system
  // (the reported "bold not applying" divergence; web synthesized bold from
  // font-weight so it looked correct there). No-op when bold === base (the 3
  // single-weight display faces).
  const boldFamily = boldFontFamily(theme);
  useThemeFont(boldFamily);

  // ORCH-1138 device-rework #3 (Seth's screenshot feedback) — float→dock Reserve
  // CTA visibility tracking, mirroring the consumer ConsumerTripDetailScreen 1:1.
  // The DOCKED CTA is the LAST scroll child (flush beneath "Choose how you pay",
  // no void); a light FLOATING PILL (no full-width bar bg) shows ONLY while that
  // docked button is scrolled OFF-screen. We track the docked card's `y` within
  // the scroll content (onDockLayout), the scroll offset (onScroll) + viewport
  // height (onLayout), then hide the pill once the docked button's top crosses the
  // viewport bottom. Default visible (the docked button starts below the fold).
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

  // ORCH-0875 booking-deadline state.
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

  const tripTier = trip.pricingTiers[0];
  const isSoldOut =
    tripTier !== undefined &&
    tripTier.isUnlimited === false &&
    tripTier.ticketsRemaining !== null &&
    tripTier.ticketsRemaining <= 0;
  const tripPrice =
    tripTier !== undefined && tripTier.priceCents > 0
      ? formatTripPrice(tripTier.priceCents, tripTier.currency)
      : tripTier !== undefined && tripTier.priceCents === 0
        ? "Free"
        : "";

  // ORCH-1130 — the bar's price label follows the live toggle, reading the
  // deposit from the SAME projected schedule TripPaymentChoice renders.
  const barSchedule =
    tripTier !== undefined
      ? projectInstallmentSchedule(tripTier, new Date())
      : null;
  const tripHasPlan = barSchedule !== null;
  const multiTier = trip.pricingTiers.length > 1;
  const depositLabel =
    barSchedule !== null
      ? formatTripPrice(barSchedule.depositCents, tripTier?.currency ?? "USD")
      : "";
  const barPrice = tripHasPlan
    ? paymentPlanChoice === "installments"
      ? `${depositLabel} today`
      : `${tripPrice} total`
    : multiTier
      ? `From ${tripPrice}`
      : tripPrice;

  // ORCH-1138 R2 (device parity fix #8) — the mockup's reserve-bar KICKER line
  // above the price: "All-in, taxes included" in pay-full, "Due today · deposit"
  // when paying over time (DIRECTION_A_V2 `#bar-kicker`). Free trips have no price
  // → no kicker (the CTA spans full-width).
  const barKicker =
    tripPrice === "Free" || tripPrice === ""
      ? null
      : tripHasPlan && paymentPlanChoice === "installments"
        ? "Due today · deposit"
        : "All-in, taxes included";

  const tripCta: CtaState =
    payload.bookable === false
      ? {
          kind: "unavailable",
          title: "Booking unavailable",
          subline: "The organizer is finishing payment setup.",
          tappable: false,
        }
      : isClosed
        ? {
            kind: "unavailable",
            title: "Bookings closed",
            subline: null,
            tappable: false,
          }
        : isSoldOut
          ? {
              kind: "unavailable",
              title: "Sold out",
              subline: null,
              tappable: false,
            }
          : tripTier === undefined
            ? {
                kind: "unavailable",
                title: "Not bookable yet",
                subline: null,
                tappable: false,
              }
            : tripPrice === "Free"
              ? { kind: "free", label: "Reserve my spot", tappable: true }
              : {
                  kind: "buy",
                  label: "Reserve my spot",
                  price: barPrice,
                  tappable: true,
                };

  // ORCH-1138 (Seth, 2026-06-15) — Reserve routes STRAIGHT to checkout with the
  // payment choice in the `plan` param (the checkout-trip route seeds
  // CartContext.paymentPlanChoice from it → byte-identical request). The single
  // bar passes the live toggle choice; the SPLIT BUTTONS pass their own explicit
  // choice ("full" / "installments") so the buyer picks the plan WITHOUT scrolling
  // to the "Choose how you pay" toggle.
  const handleTripReserve = (choice?: TripPaymentChoiceValue): void => {
    router.push(
      {
        pathname: tripCheckoutPath(trip.id),
        params: { plan: choice ?? paymentPlanChoice },
      } as never,
    );
  };

  // ORCH-1138 (Seth, 2026-06-15) — SPLIT BUTTONS for a bookable plan trip ONLY
  // (rule 9: no-plan / disabled trips keep the SINGLE Reserve bar). "Pay in full"
  // shows the full price; "Pay over time" shows the deposit due today. Each routes
  // straight to checkout with its own choice pre-selected.
  const tripSplitCtas: ReserveSplitCtas | undefined =
    tripHasPlan && tripCta.tappable
      ? {
          full: {
            cta: {
              kind: "buy" as const,
              label: "Pay in full",
              price: tripPrice,
              tappable: true,
            },
            onPress: () => handleTripReserve("full"),
          },
          overTime: {
            cta: {
              kind: "buy" as const,
              label: "Pay over time",
              price: depositLabel.length > 0 ? `From ${depositLabel} today` : "",
              tappable: true,
            },
            onPress: () => handleTripReserve("installments"),
          },
        }
      : undefined;

  const handleViewBrand = (): void => {
    if (brandSlug.length > 0) {
      router.push(`/b/${brandSlug}` as never);
    }
  };

  // ORCH-1138 — state banner (sold out / closed / deadline) rendered above body.
  const stateBanner =
    isClosed ? (
      <View style={[styles.banner, { backgroundColor: "rgba(239,68,68,0.14)" }]}>
        <Text style={[styles.bannerText, { color: "#ef4444" }]}>
          Bookings are closed for this trip
        </Text>
      </View>
    ) : isSoldOut ? (
      <View style={[styles.banner, { backgroundColor: palette.card }]}>
        <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
          SOLD OUT
        </Text>
      </View>
    ) : countdownLabel !== null ? (
      <View style={[styles.banner, { backgroundColor: palette.accentWash }]}>
        <Text style={[styles.bannerText, { color: palette.accent }]}>
          {countdownLabel}
        </Text>
      </View>
    ) : null;

  // ORCH-1138 — themed payment block (additive palette prop). Rendered inline on
  // phone + inside the desktop sticky panel by TripPreview.
  const paymentBlock = (
    <TripCheckoutFlow
      trip={trip}
      brand={payload.brand}
      paymentPlanChoice={paymentPlanChoice}
      onPaymentPlanChoiceChange={onPaymentPlanChoiceChange}
      palette={palette}
      fontFamily={boldFamily}
    />
  );

  // ORCH-1138 — desktop sticky-panel Reserve control (phone uses the floating bar).
  const reserveTappable = tripCta.tappable;
  const reserveControl = (
    <View>
      <Pressable
        onPress={reserveTappable ? () => handleTripReserve() : undefined}
        disabled={!reserveTappable}
        accessibilityRole="button"
        accessibilityState={{ disabled: !reserveTappable }}
        accessibilityLabel={
          reserveTappable
            ? `Reserve your spot on ${trip.title}`
            : ctaUnavailableLabel(tripCta)
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
            ? tripPrice === "Free" || tripPrice === ""
              ? "Reserve my spot"
              : `Reserve · ${barPrice}`
            : ctaUnavailableLabel(tripCta)}
        </Text>
      </Pressable>
      <Text style={[styles.deskReassure, { color: palette.tertiaryText }]}>
        Free to hold · cancel per policy below
      </Text>
    </View>
  );

  // ORCH-1138 device-rework #3 — the DOCKED Reserve CTA (variant="docked"),
  // rendered by TripPreview as the LAST phone-body child so it sits flush beneath
  // "Choose how you pay" (no black void). Phone-only; desktop uses the sticky
  // panel's reserveControl. onDockLayout reports its position so the floating pill
  // hides once it scrolls in. Same CtaState + onPress as the floating bar.
  const dockedReserve =
    !isDesktop ? (
      <TripReserveBar
        cta={tripCta}
        palette={palette}
        surface={surface}
        kicker={barKicker}
        fontFamily={boldFamily}
        onPress={() => handleTripReserve()}
        splitCtas={tripSplitCtas}
        variant="docked"
        onDockLayout={handleDockLayout}
        testID="orch-1117-trip-floating-bar"
      />
    ) : undefined;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <TripPreview
        trip={trip}
        brand={payload.brand}
        palette={palette}
        theme={theme}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={onClose}
        onShare={onShare}
        onViewBrand={handleViewBrand}
        stateBanner={stateBanner}
        paymentBlock={paymentBlock}
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

      {/* ORCH-1138 device-rework #3 — the FLOATING Reserve PILL (phone): JUST the
          button (no full-width opaque bar bg), shown ONLY while the in-content
          DOCKED CTA (last scroll child) is off-screen. Hides once the docked
          button scrolls in (floatingPillVisible) → no double bar, no black void.
          Hidden on desktop (the sticky panel carries the Reserve control). Same
          CtaState + onPress as the docked bar so the copy never diverges. */}
      {!isDesktop && floatingPillVisible ? (
        <TripReserveBar
          cta={tripCta}
          palette={palette}
          surface={surface}
          kicker={barKicker}
          fontFamily={boldFamily}
          onPress={() => handleTripReserve()}
          splitCtas={tripSplitCtas}
          variant="floating"
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
