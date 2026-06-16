/**
 * /exp/[brandSlug]/[experienceSlug] — public buyer-anon experience detail route.
 * META-ORCH-1059 Sub-C → ORCH-1138 Leg 3 rebuilds this onto the shared
 * Direction-A foundation (@mingla/offering-rendering), mirroring /t/ (Leg 1) +
 * /e/ (Leg 2): the parallax cover hero + body-level fixed chrome + brand-themed
 * palette + count-aware per-stop galleries + vibe chips + the float→dock
 * "Reserve" CTA + the responsive desktop two-column sticky panel now live in
 * ExperiencePreview's FOUNDATION mode. This route resolves the brand theme →
 * palette → surface, owns the share/mute/picker state, and wires the ADAPTIVE
 * reservation flow (single → straight to cart; multi/recurring → slot picker →
 * cart; open-daily → date + time-in-window + party-size → cart).
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth on this page.
 * The "no sign-in redirect" guarantee is enforced at the ROOT layout by the
 * `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist in coldLoadAuthGates.ts (ORCH-1115).
 *
 * The verb is "Reserve" everywhere (SPEC SC-4). ONE CTA — experiences have NO
 * pay-in-full/pay-over-time split (SC-5). The picker adds the chosen occurrence
 * via the EXISTING eventDateId checkout path; the request stays byte-identical
 * to today on the single/no-date path (SC-3).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover on the public experience share-link page (mirrors /t/{brandSlug}/{tripSlug}); the buyer-facing banner aesthetic is intentional. The ParallaxCoverShell renders the cover full-bleed to the screen edge by design; chrome absolute-positions over the cover. Per META-ORCH-1059 Sub-C + ORCH-1138 Leg 3 foundation parity.

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
import { Icon } from "../../../src/components/ui/Icon";
import { TripReserveBar } from "../../../src/components/trip/TripReserveBar";
import {
  experienceCheckoutPath,
  experiencePublicUrl,
} from "../../../src/constants/publicUrls";
import { usePublicExperienceBySlug } from "../../../src/hooks/usePublicExperience";
import { ExperiencePreview } from "../../../src/components/experience/ExperiencePreview";
import {
  ExperienceReservePicker,
  type ExperienceReserveMode,
  type ExperienceReserveSelection,
} from "../../../src/components/experience/ExperienceReservePicker";
import type {
  PublicExperience,
  PublicExperienceDate,
} from "../../../src/services/publicExperienceService";

function allDatesPast(isos: string[], nowMs: number = Date.now()): boolean {
  const valid = isos
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  if (valid.length === 0) return false;
  return valid.every((ms) => ms < nowMs);
}

// ORCH-1138 Leg 3 — the bookable occurrences: future dates with remaining > 0
// (or unlimited). Mirrors the ORCH-1072 deck signal (bookableOccurrences).
function bookableDates(
  dates: ReadonlyArray<PublicExperienceDate>,
  nowMs: number = Date.now(),
): PublicExperienceDate[] {
  return dates.filter((d) => {
    const ms = new Date(d.startAt).getTime();
    const future = !Number.isFinite(ms) || ms >= nowMs;
    const hasStock =
      d.ticketsRemaining === null || d.ticketsRemaining > 0;
    return future && hasStock;
  });
}

// ORCH-1138 Leg 3 (§4.5 / OQ-5) — "open daily within hours": a recurring
// experience whose recurrence repeats daily forever (preset=daily + never). The
// adaptive Reserve opens the restaurant-style date + time-in-window + party flow.
function isOpenDaily(experience: PublicExperience): boolean {
  if (experience.whenMode !== "recurring") return false;
  const rule = experience.recurrenceRule;
  if (rule === null) return false;
  return rule.preset === "daily" && rule.termination?.kind === "never";
}

export default function PublicExperienceRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(true);

  const query = usePublicExperienceBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof experienceSlug === "string" ? experienceSlug : null,
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

  // ORCH-1114: share → web-aware ShareModal. NEVER the bare react-native share.
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
        <Text style={styles.stateText}>Loading experience…</Text>
      </View>
    );
  }

  if (query.isError) {
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
        <Text style={styles.stateTitle}>Couldn&rsquo;t load experience</Text>
        <Text style={styles.stateText}>{errorMessage}</Text>
      </View>
    );
  }

  const payload = query.data;
  if (payload === null || payload === undefined) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Experience not found</Text>
        <Text style={styles.stateText}>
          This experience may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  return (
    <ResolvedExperiencePage
      payload={payload}
      brandSlug={typeof brandSlug === "string" ? brandSlug : ""}
      experienceSlug={typeof experienceSlug === "string" ? experienceSlug : ""}
      muted={muted}
      onToggleMute={handleToggleMute}
      onClose={handleClose}
      onShare={handleShare}
      shareModalVisible={shareModalVisible}
      onCloseShareModal={() => setShareModalVisible(false)}
      safeAreaTop={insets.top}
      contentBottomInset={spacing.md}
      router={router}
    />
  );
}

const ResolvedExperiencePage: React.FC<{
  payload: NonNullable<ReturnType<typeof usePublicExperienceBySlug>["data"]>;
  brandSlug: string;
  experienceSlug: string;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  shareModalVisible: boolean;
  onCloseShareModal: () => void;
  safeAreaTop: number;
  contentBottomInset: number;
  router: ReturnType<typeof useRouter>;
}> = ({
  payload,
  brandSlug,
  experienceSlug,
  muted,
  onToggleMute,
  onClose,
  onShare,
  shareModalVisible,
  onCloseShareModal,
  safeAreaTop,
  contentBottomInset,
  router,
}) => {
  const experience = payload.experience;
  const brand = payload.brand;
  const { isDesktop } = useResponsiveLayout();

  // ORCH-1138 Leg 3 — resolve brand theme + per-experience overrides → palette.
  const theme = useMemo(
    () => resolveTheme(brand.theme ?? null, experience.themeOverrides ?? null),
    [brand.theme, experience.themeOverrides],
  );
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => resolveOfferingSurface(theme), [theme]);
  useThemeFont(theme.fontFamilyValue);
  const boldFamily = boldFontFamily(theme);
  useThemeFont(boldFamily);

  // float→dock Reserve pill visibility (mirror the trip route 1:1).
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

  // adaptive reservation state
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);

  const dateIsos = experience.dates.map((d) => d.startAt);
  const isEnded = allDatesPast(dateIsos);
  const ticket = experience.ticket;
  const isSoldOut =
    ticket !== null &&
    !ticket.isUnlimited &&
    ticket.quantityTotal !== null &&
    ticket.ticketsRemaining !== null &&
    ticket.ticketsRemaining <= 0;

  const openDaily = isOpenDaily(experience);
  const bookable = useMemo(
    () => bookableDates(experience.dates),
    [experience.dates],
  );
  // The picker opens when there's >1 bookable occurrence OR it's open-daily;
  // exactly 1 / 0 → straight to cart (auto-select the single occurrence).
  const reserveMode: ExperienceReserveMode = openDaily ? "open-daily" : "slots";
  const usesPicker = openDaily || bookable.length > 1;

  // ---- price + CTA (single CTA — no split, SC-5) ----
  const expPrice =
    ticket !== null && ticket.priceCents > 0
      ? formatExpPrice(ticket.priceCents, ticket.currency)
      : ticket !== null
        ? "Free"
        : "";
  const expCta: CtaState = isEnded
    ? { kind: "unavailable", title: "Ended", subline: null, tappable: false }
    : isSoldOut
      ? { kind: "unavailable", title: "Sold out", subline: null, tappable: false }
      : !experience.bookable
        ? {
            kind: "unavailable",
            title: "Booking unavailable",
            subline: "The organizer is finishing payment setup.",
            tappable: false,
          }
        : ticket === null
          ? {
              kind: "unavailable",
              title: "Not on sale yet",
              subline: null,
              tappable: false,
            }
          : expPrice === "Free"
            ? { kind: "free", label: "Reserve", tappable: true }
            : {
                kind: "buy",
                label: "Reserve",
                price: usesPicker ? `From ${expPrice}` : expPrice,
                tappable: true,
              };
  const barKicker =
    expPrice === "Free" || expPrice === "" ? null : "All-in, taxes included";

  // ---- straight-to-cart routing (with optional eventDateId + quantity) ----
  const goToCart = useCallback(
    (selection?: ExperienceReserveSelection): void => {
      const routeParams: Record<string, string> = {};
      if (selection !== undefined) {
        routeParams.eventDateId = selection.eventDateId;
        if (selection.quantity > 1) {
          routeParams.quantity = String(selection.quantity);
        }
      }
      router.push(
        {
          pathname: experienceCheckoutPath(experience.id),
          params: routeParams,
        } as never,
      );
    },
    [router, experience.id],
  );

  // Reserve tap — ADAPTIVE (SC-3): >1 / open-daily → picker; ===1 auto-select;
  // 0 / single → straight to cart with NO eventDateId (byte-identical).
  const handleReserve = useCallback((): void => {
    if (usesPicker) {
      setPickerVisible(true);
      return;
    }
    if (bookable.length === 1) {
      goToCart({ eventDateId: bookable[0].id, quantity: 1 });
      return;
    }
    goToCart(); // single / no-date supply → no eventDateId
  }, [usesPicker, bookable, goToCart]);

  const handlePickerConfirm = useCallback(
    (selection: ExperienceReserveSelection): void => {
      setPickerVisible(false);
      goToCart(selection);
    },
    [goToCart],
  );

  const handleViewBrand = (): void => {
    if (brandSlug.length > 0) router.push(`/b/${brandSlug}` as never);
  };

  // state banner (sold out / ended / unavailable) rendered above the body.
  const stateBanner = isEnded ? (
    <View style={[styles.banner, { backgroundColor: palette.card }]}>
      <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
        THIS EXPERIENCE HAS ENDED
      </Text>
    </View>
  ) : isSoldOut ? (
    <View style={[styles.banner, { backgroundColor: palette.card }]}>
      <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
        SOLD OUT
      </Text>
    </View>
  ) : !experience.bookable ? (
    <View style={[styles.banner, { backgroundColor: palette.card }]}>
      <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
        BOOKING UNAVAILABLE RIGHT NOW
      </Text>
    </View>
  ) : null;

  // ORCH-1138 Leg 3 (§4.5) — "Open daily (hours)" availability strip. Shown only
  // for an open-daily experience whose materialized occurrences carry a window.
  const availabilityBlock =
    openDaily && bookable.length > 0 ? (
      <View
        style={[
          styles.hours,
          { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
        ]}
      >
        <Icon name="clock" size={18} color={palette.accent} />
        <View style={styles.hoursTextCol}>
          <Text style={[styles.hoursWhen, { color: palette.primaryText }, { fontFamily: boldFamily }]}>
            {formatOpenHours(bookable[0], experience.timezone)}
          </Text>
          <Text style={[styles.hoursSub, { color: palette.tertiaryText }]}>
            Reserve a table any upcoming day
          </Text>
        </View>
      </View>
    ) : null;

  // desktop sticky-panel Reserve control (phone uses the floating bar).
  const reserveTappable = expCta.tappable;
  const reserveControl = (
    <View>
      <Pressable
        onPress={reserveTappable ? handleReserve : undefined}
        disabled={!reserveTappable}
        accessibilityRole="button"
        accessibilityState={{ disabled: !reserveTappable }}
        accessibilityLabel={
          reserveTappable
            ? `Reserve your spot on ${experience.title}`
            : ctaUnavailableLabel(expCta)
        }
        style={[
          styles.deskReserve,
          reserveTappable
            ? { backgroundColor: palette.accent }
            : { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 },
        ]}
        testID="orch-1138-experience-desk-reserve"
      >
        <Text
          style={[
            styles.deskReserveText,
            { color: reserveTappable ? palette.accentText : palette.tertiaryText },
            { fontFamily: boldFamily },
          ]}
        >
          {reserveTappable
            ? expPrice === "Free" || expPrice === ""
              ? "Reserve"
              : `Reserve · ${expCta.kind === "buy" ? expCta.price : expPrice}`
            : ctaUnavailableLabel(expCta)}
        </Text>
      </Pressable>
      <Text style={[styles.deskReassure, { color: palette.tertiaryText }]}>
        Free to hold · all-in, taxes included
      </Text>
    </View>
  );

  // DOCKED Reserve CTA — LAST phone-body child (single CTA, no split).
  const dockedReserve = !isDesktop ? (
    <TripReserveBar
      cta={expCta}
      palette={palette}
      surface={surface}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={handleReserve}
      variant="docked"
      onDockLayout={handleDockLayout}
      testID="orch-1138-experience-reserve-bar"
    />
  ) : undefined;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ExperiencePreview
        experience={experience}
        brand={brand}
        palette={palette}
        theme={theme}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={onClose}
        onShare={onShare}
        onViewBrand={handleViewBrand}
        stateBanner={stateBanner}
        reserveControl={reserveControl}
        availabilityBlock={availabilityBlock}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        dockedReserve={dockedReserve}
        onScroll={handleScroll}
        onScrollViewLayout={handleScrollLayout}
        testID="orch-1138-experience-preview"
      />

      {brandSlug.length > 0 && experienceSlug.length > 0 ? (
        <ShareModal
          visible={shareModalVisible}
          onClose={onCloseShareModal}
          url={experiencePublicUrl({ brandSlug, experienceSlug })}
          title={experience.title}
          description={experience.description?.slice(0, 200) ?? undefined}
        />
      ) : null}

      {/* FLOATING Reserve PILL (phone) — shown while the docked CTA is off-screen */}
      {!isDesktop && floatingPillVisible ? (
        <TripReserveBar
          cta={expCta}
          palette={palette}
          surface={surface}
          kicker={barKicker}
          fontFamily={boldFamily}
          onPress={handleReserve}
          variant="floating"
          testID="orch-1138-experience-reserve-bar"
        />
      ) : null}

      {/* ADAPTIVE Reserve picker (slots / open-daily) — selection only. */}
      <ExperienceReservePicker
        visible={pickerVisible}
        mode={reserveMode}
        dates={experience.dates}
        timezone={experience.timezone}
        palette={palette}
        fontFamily={boldFamily}
        eventRemaining={ticket?.ticketsRemaining ?? null}
        onCancel={() => setPickerVisible(false)}
        onConfirm={handlePickerConfirm}
      />
    </View>
  );
};

function ctaUnavailableLabel(cta: CtaState): string {
  return cta.kind === "unavailable" ? cta.title : "Booking unavailable";
}

function formatExpPrice(priceCents: number, currency: string): string {
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

// ORCH-1138 Leg 3 — "Open daily · 8:00 AM – 9:00 PM" from an occurrence window.
function formatOpenHours(date: PublicExperienceDate, timezone: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone || "UTC",
      }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  };
  const s = fmt(date.startAt);
  const e = fmt(date.endAt);
  return s.length > 0 && e.length > 0
    ? `Open daily · ${s} – ${e}`
    : "Open daily";
}

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
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
  bannerText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  hours: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  hoursTextCol: { flex: 1, minWidth: 0 },
  hoursWhen: { fontSize: 14, fontWeight: "800" },
  hoursSub: { fontSize: 11, marginTop: 1 },
  deskReserve: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 18,
  },
  deskReserveText: { fontSize: 16, fontWeight: "900" },
  deskReassure: { fontSize: 11, textAlign: "center", marginTop: 10 },
});
