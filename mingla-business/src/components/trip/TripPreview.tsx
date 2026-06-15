/**
 * TripPreview — buyer-eye preview of a Trip. Used in:
 *   - Public buyer-anon route /t/{brandSlug}/{tripSlug} (FOUNDATION mode —
 *     ORCH-1138 Direction A: immersive parallax cover + body-level fixed chrome
 *     + brand-themed palette + responsive desktop two-column sticky panel).
 *   - Wizard Step 5 review-before-publish (LEGACY mode — the framed inline
 *     preview; no shell, no chrome, no palette).
 *
 * Tr2 (ORCH-0859) → rebuilt by ORCH-1138 onto the shared @mingla/offering-
 * rendering foundation. The mode is chosen by whether `palette` is provided:
 *   palette PRESENT → FOUNDATION mode (ParallaxCoverShell-composed full page).
 *   palette ABSENT  → LEGACY mode (the prior inline framed render, byte-stable
 *                     for the wizard Step-5 caller — TripCreatorStep5Review).
 *
 * Anon-tolerant: this component does NOT call useAuth. The public route passes
 * the Trip + Brand payload from usePublicTripBySlug + the resolved palette/theme
 * + chrome handlers; the wizard caller passes the in-flight draft Trip +
 * currentBrand with NO palette.
 *
 * Constitution rule 9 — renders ONLY real model fields: per-day items
 * (ordinal/date/title/narrative/media), inclusions, route legs, destination map
 * (only when lat/lng present). NO timed stops, NO trip-level gallery, NO brand
 * bio, NO placeholder map.
 */

import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  formatTripDateRange,
  offeringSurfaceStyles,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/event-rendering";
import {
  ParallaxCoverShell,
  CountAwareGallery,
  ChipGroup,
  useResponsiveLayout,
  type Chip,
  type CountAwareGalleryItem,
} from "@mingla/offering-rendering";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { CollapsibleDescription } from "../offering/CollapsibleDescription";
import type { RefundPolicy } from "../../services/refundPolicyService";
import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "../../services/tripsService";
import type { BrandStripeStatus } from "../../store/currentBrandStore";

export interface TripPreviewBrand {
  id: string;
  slug: string;
  name: string;
  bio?: string | null;
  coverMediaUrl?: string | null;
  /**
   * ORCH-1076 Stream B — brand Stripe-readiness, threaded ONLY from the
   * authenticated trip creator route (app/trip/[id]/edit.tsx) so the wizard can
   * proactively gate a paid trip's Publish. OPTIONAL + additive: the public
   * buyer-anon /t/{slug} route never passes it (and never publishes), so this
   * keeps TripPreviewBrand anon-tolerant.
   */
  stripeStatus?: BrandStripeStatus | null;
}

export interface TripPreviewProps {
  trip: Trip;
  brand: TripPreviewBrand;
  /** When true, render the legacy "Reserve my spot" CTA. False for wizard preview. */
  showCta?: boolean;
  /** Optional body padding override for framed parent surfaces like the wizard. */
  contentPadding?: number;
  /** Fired when buyer taps the legacy CTA. Required when showCta=true. */
  onReserveTap?: () => void;
  testID?: string;

  // ===================== ORCH-1138 FOUNDATION mode (all OPTIONAL) =====================
  /**
   * The resolved brand palette (from createThemePalette). PRESENT ⇒ FOUNDATION
   * mode: TripPreview composes the immersive ParallaxCoverShell. ABSENT ⇒ LEGACY
   * inline render (wizard preview), unchanged.
   */
  palette?: ThemePalette;
  /** Resolved theme (font + entrance animation). Required in FOUNDATION mode. */
  theme?: ResolvedTheme;
  /** Cover-video sound state. */
  muted?: boolean;
  onToggleMute?: () => void;
  /** Chrome close/share handlers (route owns them). */
  onClose?: () => void;
  onShare?: () => void;
  /** sold-out / closed / deadline pill, rendered above the body content. */
  stateBanner?: React.ReactNode | null;
  /**
   * Themed payment block (TripCheckoutFlow). Rendered inline on phone and inside
   * the sticky panel on desktop. Built by the route so it carries route state.
   */
  paymentBlock?: React.ReactNode;
  /** Desktop sticky-panel Reserve control + reassurance (route-owned). */
  reserveControl?: React.ReactNode;
  /** Brand "View" tap → brand page (route-owned). */
  onViewBrand?: () => void;
  /** Floating-bar clearance (phone). */
  contentBottomInset?: number;
  /** Native safe-area top inset for the chrome. */
  safeAreaTop?: number;
}

// ORCH-1016 — date range from the shared @mingla/event-rendering helper so the
// consumer card/detail and this preview/public page format identically.

function formatPrice(tier: TripPricingTier | undefined): string {
  if (tier === undefined) return "Pricing TBD";
  if (tier.priceCents === 0) return "Free";
  try {
    const major = tier.priceCents / 100;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: tier.currency || "USD",
    }).format(major);
  } catch {
    return `${(tier.priceCents / 100).toFixed(2)} ${tier.currency}`;
  }
}

// ORCH-1138 — derived "N days · M nights" from the trip date range. Returns null
// when the range can't be derived (rule 9 — never fabricate a duration).
function deriveDuration(startAt: string | null, endAt: string | null): string | null {
  if (startAt === null || endAt === null) return null;
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const nights = Math.max(0, Math.round((e - s) / dayMs));
  const days = nights + 1;
  if (nights === 0) return `${days} day`;
  return `${days} days · ${nights} night${nights === 1 ? "" : "s"}`;
}

function mediaToGalleryItems(day: TripDay): CountAwareGalleryItem[] {
  return day.media.map((m) => ({
    url: m.url,
    type: m.type === "video" ? "video" : "image",
  }));
}

// ORCH-1138 Q2 — collapse to first 2 days + "Show all N days" when 5+ days.
const LONG_ITINERARY_THRESHOLD = 5;
const COLLAPSED_DAY_COUNT = 2;

export const TripPreview: React.FC<TripPreviewProps> = ({
  trip,
  brand,
  showCta = false,
  contentPadding = spacing.lg,
  onReserveTap,
  testID,
  palette,
  theme,
  muted = true,
  onToggleMute,
  onClose,
  onShare,
  stateBanner = null,
  paymentBlock,
  reserveControl,
  onViewBrand,
  contentBottomInset = 0,
  safeAreaTop = 0,
}) => {
  // FOUNDATION mode requires both palette + theme + the chrome handlers.
  if (
    palette !== undefined &&
    theme !== undefined &&
    onClose !== undefined &&
    onShare !== undefined &&
    onToggleMute !== undefined
  ) {
    return (
      <FoundationTripPreview
        trip={trip}
        brand={brand}
        palette={palette}
        theme={theme}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={onClose}
        onShare={onShare}
        stateBanner={stateBanner}
        paymentBlock={paymentBlock}
        reserveControl={reserveControl}
        onViewBrand={onViewBrand}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        testID={testID}
      />
    );
  }

  // ===================== LEGACY mode (wizard Step-5 preview) =====================
  return (
    <LegacyTripPreview
      trip={trip}
      brand={brand}
      showCta={showCta}
      contentPadding={contentPadding}
      onReserveTap={onReserveTap}
      testID={testID}
    />
  );
};

// =====================================================================
// FOUNDATION mode — Direction A immersive page (ORCH-1138)
// =====================================================================

const FoundationTripPreview: React.FC<{
  trip: Trip;
  brand: TripPreviewBrand;
  palette: ThemePalette;
  theme: ResolvedTheme;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  stateBanner: React.ReactNode | null;
  paymentBlock?: React.ReactNode;
  reserveControl?: React.ReactNode;
  onViewBrand?: () => void;
  contentBottomInset: number;
  safeAreaTop: number;
  testID?: string;
}> = ({
  trip,
  brand,
  palette,
  theme,
  muted,
  onToggleMute,
  onClose,
  onShare,
  stateBanner,
  paymentBlock,
  reserveControl,
  onViewBrand,
  contentBottomInset,
  safeAreaTop,
  testID,
}) => {
  const { isDesktop } = useResponsiveLayout();
  const surface = offeringSurfaceStyles(palette);
  const fontFamily = theme.fontFamilyValue;

  const bt = trip.businessTrip;
  const tier = trip.pricingTiers[0];
  const includedChips: Chip[] = trip.inclusions
    .filter((i) => i.kind === "included")
    .map((i) => ({ label: i.item, variant: "yes" }));
  const excludedChips: Chip[] = trip.inclusions
    .filter((i) => i.kind === "excluded")
    .map((i) => ({ label: i.item, variant: "no" }));

  const duration = deriveDuration(bt.startAt, bt.endAt);
  const dateLabel = formatTripDateRange(bt.startAt, bt.endAt);
  const isSoldOut =
    tier !== undefined &&
    tier.isUnlimited === false &&
    tier.ticketsRemaining !== null &&
    tier.ticketsRemaining <= 0;
  const capacity = bt.capacity;

  const coverType =
    trip.coverMediaType === "video"
      ? "video"
      : trip.coverMediaType === "gif"
        ? "gif"
        : trip.coverMediaUrl !== null
          ? "image"
          : null;

  // ---- brand chip ----
  const brandChip = (
    <Pressable
      onPress={onViewBrand}
      accessibilityRole="button"
      accessibilityLabel={`View ${brand.name}`}
      style={[styles.brandRow, surface.card]}
    >
      {brand.coverMediaUrl != null ? (
        <Image
          source={{ uri: brand.coverMediaUrl }}
          style={styles.brandTile}
          accessibilityLabel=""
        />
      ) : (
        <View style={[styles.brandTile, { backgroundColor: palette.accentWash }]} />
      )}
      <View style={styles.brandTextCol}>
        <Text style={[styles.brandKicker, surface.tertiaryText]}>
          Presented by
        </Text>
        <Text style={[styles.brandName, surface.primaryText, { fontFamily }]}>
          {brand.name}
        </Text>
      </View>
      <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
    </Pressable>
  );

  // ---- itinerary (collapse-aware) ----
  const itinerary = trip.days.length > 0 ? (
    <DayByDay
      trip={trip}
      palette={palette}
      surface={surface}
      fontFamily={fontFamily}
      variant={isDesktop ? "desktop" : "phone"}
    />
  ) : null;

  // ---- refund + deadline strips (left column on BOTH viewports) ----
  // ORCH-1138 R2 (device parity fix #7) — the cancellation block is rendered to
  // the mockup (`.strip` + `.refund-ladder` rows) and PALETTE-THEMED. The shared
  // <RefundPolicyDisplay/> hardcodes warm-orange (#eb7825) + a white-on-dark
  // timeline and is consumed by the consumer-app trip detail, so it is NOT
  // re-themed here; instead the FOUNDATION path renders a bespoke palette-driven
  // ladder from the SAME real refundPolicy.tiers (rule 9 — only when present).
  const refundBlock =
    trip.refundPolicy !== null || trip.bookingDeadline !== null ? (
      <View style={styles.section}>
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
          Cancellation policy
        </Text>
        <RefundLadder
          policy={trip.refundPolicy}
          bookingDeadline={trip.bookingDeadline}
          palette={palette}
          surface={surface}
        />
      </View>
    ) : null;

  const left = (
    <View>
      {/* phone-only lead eyebrow + title (desktop shows them in the hero) */}
      {!isDesktop ? (
        <View style={styles.leadBlock}>
          {duration !== null ? (
            <Text style={[styles.eyebrowLead, surface.primaryText]}>
              {duration}
              {bt.destinationLocationText != null
                ? ` · ${bt.destinationLocationText}`
                : ""}
            </Text>
          ) : null}
          <Text style={[styles.title, surface.primaryText, { fontFamily }]}>
            {trip.title}
          </Text>
        </View>
      ) : null}

      {/* meta chips */}
      <View style={styles.metaRow}>
        {dateLabel.length > 0 ? (
          <MetaChip palette={palette} surface={surface} icon="calendar">
            {dateLabel}
          </MetaChip>
        ) : null}
        {duration !== null ? (
          <MetaChip palette={palette} surface={surface} icon="clock">
            {duration}
          </MetaChip>
        ) : null}
        {capacity !== null ? (
          <MetaChip palette={palette} surface={surface} icon="users">
            {isSoldOut
              ? `Sold out · ${capacity} of ${capacity} booked`
              : tier?.ticketsRemaining != null
                ? `${tier.ticketsRemaining} seats left · ${capacity} max`
                : `${capacity} max`}
          </MetaChip>
        ) : null}
        {bt.destinationLocationText != null ? (
          <MetaChip palette={palette} surface={surface} icon="location">
            {bt.destinationLocationText}
          </MetaChip>
        ) : null}
      </View>

      {/* brand chip — phone shows it inline; desktop puts it in the sticky panel */}
      {!isDesktop ? brandChip : null}

      {/* route line */}
      {bt.departureLocationText != null || bt.destinationLocationText != null ? (
        <View style={[styles.route, surface.card]}>
          {bt.departureLocationText != null ? (
            <View style={styles.routeLeg}>
              <Text style={[styles.routeLabel, surface.tertiaryText]}>
                Leaving from
              </Text>
              <Text style={[styles.routePlace, surface.primaryText]}>
                {bt.departureLocationText}
              </Text>
            </View>
          ) : null}
          {bt.departureLocationText != null &&
          bt.destinationLocationText != null ? (
            <Text style={[styles.routeArrow, { color: palette.accent }]}>→</Text>
          ) : null}
          {bt.destinationLocationText != null ? (
            <View style={styles.routeLeg}>
              <Text style={[styles.routeLabel, surface.tertiaryText]}>
                Destination
              </Text>
              <Text style={[styles.routePlace, surface.primaryText]}>
                {bt.destinationLocationText}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* about */}
      {trip.description !== null && trip.description.trim().length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            About this trip
          </Text>
          <View style={styles.aboutWrap}>
            <CollapsibleDescription
              text={trip.description}
              testID="trip-preview-description"
            />
          </View>
        </View>
      ) : null}

      {/* day by day */}
      {itinerary !== null ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            Day by day
          </Text>
          {itinerary}
        </View>
      ) : null}

      {/* what's included */}
      {includedChips.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            What&rsquo;s included
          </Text>
          <ChipGroup chips={includedChips} palette={palette} />
        </View>
      ) : null}

      {/* what's not included */}
      {excludedChips.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            What&rsquo;s not included
          </Text>
          <ChipGroup chips={excludedChips} palette={palette} />
        </View>
      ) : null}

      {/* destination map — only when lat/lng present (rule 9: no placeholder).
          ORCH-1138 Leg 1: the mockup shows a STATIC MAP IMAGE with a themed pin
          + caption pill. We render a Mapbox Static Images API URL (a plain
          <Image>, NO map SDK / NO new dependency) themed to the brand accent,
          using the client-safe PUBLIC `pk.*` token (Constants.expoConfig.extra.
          EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN — wired in app.config.ts).
          FAIL-SAFE (rule 9): buildStaticMapUrl returns null when the token is
          absent at runtime OR coords are missing/non-finite → we HIDE the image
          and fall back to the HONEST pin+caption card. Never a fabricated tile,
          never a crash. Works on native AND react-native-web. */}
      {bt.destinationLat !== null && bt.destinationLng !== null ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            Where you&rsquo;ll be
          </Text>
          <View
            style={[
              styles.mapBlock,
              surface.card,
              { height: isDesktop ? 300 : 180 },
            ]}
          >
            {(() => {
              const mapUrl = buildStaticMapUrl({
                lat: bt.destinationLat,
                lng: bt.destinationLng,
                accentHex: palette.accent,
                height: isDesktop ? 300 : 180,
              });
              return mapUrl !== null ? (
                <Image
                  source={{ uri: mapUrl }}
                  style={styles.mapImage}
                  resizeMode="cover"
                  accessibilityLabel={`Map of ${
                    bt.destinationLocationText ?? "the destination"
                  }`}
                />
              ) : null;
            })()}
            <Icon name="location" size={28} color={palette.accent} />
            <View style={[styles.mapCapPill, { backgroundColor: palette.page }]}>
              <Text style={[styles.mapCap, surface.primaryText]}>
                {bt.destinationLocationText ?? "Destination"}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* phone-only inline payment block */}
      {!isDesktop && paymentBlock !== undefined ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily }]}>
            Choose how you pay
          </Text>
          {paymentBlock}
        </View>
      ) : null}

      {/* refund + deadline (left column on BOTH viewports) */}
      {refundBlock}
    </View>
  );

  // ---- desktop sticky booking panel ----
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, surface.cardStrong]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        {brandChip}
        {paymentBlock !== undefined ? (
          <View style={styles.deskPayWrap}>{paymentBlock}</View>
        ) : null}
        {reserveControl}
      </View>
    </View>
  ) : null;

  return (
    <ParallaxCoverShell
      palette={palette}
      theme={theme}
      coverMediaUrl={trip.coverMediaUrl}
      coverMediaType={coverType}
      entranceAnimationKey={`trip:${trip.id}`}
      muted={muted}
      onToggleMute={onToggleMute}
      showMute={coverType === "video"}
      onClose={onClose}
      onShare={onShare}
      heroEyebrow={
        duration !== null ? (
          <Text style={styles.heroEyebrow}>
            {duration}
            {bt.destinationLocationText != null
              ? ` · ${bt.destinationLocationText}`
              : ""}
          </Text>
        ) : undefined
      }
      heroTitle={
        <Text style={[styles.heroTitle, { fontFamily }]}>{trip.title}</Text>
      }
      stateBanner={stateBanner}
      stickyPanel={stickyPanel}
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      testID={testID}
    >
      {left}
    </ParallaxCoverShell>
  );
};

// ---- meta chip ----
const MetaChip: React.FC<{
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  icon: React.ComponentProps<typeof Icon>["name"];
  children: React.ReactNode;
}> = ({ palette, surface, icon, children }) => (
  <View style={[styles.metaChip, surface.card]}>
    <Icon name={icon} size={15} color={palette.accent} />
    <Text style={[styles.metaChipText, surface.secondaryText]}>{children}</Text>
  </View>
);

// ---- day-by-day spine ----
const DayByDay: React.FC<{
  trip: Trip;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  fontFamily: string;
  variant: "phone" | "desktop";
}> = ({ trip, palette, surface, fontFamily, variant }) => {
  const isLong = trip.days.length >= LONG_ITINERARY_THRESHOLD;
  const [expanded, setExpanded] = React.useState<boolean>(false);
  const visibleDays =
    isLong && !expanded ? trip.days.slice(0, COLLAPSED_DAY_COUNT) : trip.days;

  return (
    <View style={styles.itin}>
      <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
      {visibleDays.map((day: TripDay) => (
        <View key={day.id} style={styles.day}>
          <View style={[styles.dayDot, { backgroundColor: palette.accent }]}>
            <Text style={[styles.dayDotText, { color: palette.accentText }]}>
              {day.ordinal}
            </Text>
          </View>
          <View style={[styles.dayCard, surface.card]}>
            <View style={styles.dayHead}>
              <Text style={[styles.dayOrd, { color: palette.accent }]}>
                Day {day.ordinal}
              </Text>
              {day.date !== null ? (
                <Text style={[styles.dayDate, surface.tertiaryText]}>
                  {day.date}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.dayTitle, surface.primaryText, { fontFamily }]}>
              {day.title}
            </Text>
            {day.narrative !== null && day.narrative.trim().length > 0 ? (
              <Text style={[styles.dayNarr, surface.secondaryText]}>
                {day.narrative}
              </Text>
            ) : null}
            {/* CHANGE 1 (mockup v3) — NO timed stops; the wizard does not author
                them, rendering would fabricate data (rule 9). Day ends at media. */}
            <CountAwareGallery
              items={mediaToGalleryItems(day)}
              palette={palette}
              variant={variant}
              accessibilityLabelPrefix={`Day ${day.ordinal} media`}
            />
          </View>
        </View>
      ))}
      {isLong ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Show fewer days" : `Show all ${trip.days.length} days`
          }
          style={styles.showAllRow}
        >
          <Text style={[styles.showAllText, { color: palette.accent }]}>
            {expanded ? "Show fewer days" : `Show all ${trip.days.length} days`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

// ---- refund ladder + deadline strips (mockup `.strip` / `.refund-ladder`) ----
// ORCH-1138 R2 (device parity fix #7). Palette-themed; built ONLY from real
// refundPolicy.tiers + bookingDeadline (rule 9). Mirrors the shared
// RefundPolicyDisplay's tier-label semantics but reads from the brand palette so
// the percentages/accent match the page (the shared component is warm-orange).
const REFUND_KIND_COPY: Record<RefundPolicy["kind"], string> = {
  flexible:
    "Flexible — cancel for a full or partial refund based on how early you cancel.",
  standard:
    "Standard — partial refunds up to the cutoff, based on how early you cancel.",
  strict: "Strict — limited refunds; review the cancellation windows below.",
  custom: "Cancel for a refund based on the windows below.",
};

function refundTierLabel(
  tier: { days_before_start: number },
  index: number,
  tiers: ReadonlyArray<{ days_before_start: number }>,
): string {
  const isLast = index === tiers.length - 1;
  if (index === 0) return `${tier.days_before_start}+ days before departure`;
  if (isLast && tier.days_before_start === 0) {
    const prev = tiers[index - 1];
    return `Under ${prev.days_before_start} days`;
  }
  const prev = tiers[index - 1];
  return `${tier.days_before_start}–${prev.days_before_start - 1} days before`;
}

function formatDeadline(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

const RefundLadder: React.FC<{
  policy: RefundPolicy | null;
  bookingDeadline: string | null;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
}> = ({ policy, bookingDeadline, palette, surface }) => {
  const tiers = policy !== null ? policy.tiers : [];
  const deadlineLabel = formatDeadline(bookingDeadline);
  return (
    <View>
      {policy !== null ? (
        <View style={[styles.strip, surface.card]}>
          <Icon name="check" size={16} color={palette.accent} />
          <Text style={[styles.stripText, surface.secondaryText]}>
            {REFUND_KIND_COPY[policy.kind]}
          </Text>
        </View>
      ) : null}
      {tiers.length > 0 ? (
        <View style={styles.refundLadder}>
          {tiers.map((tier, index) => {
            const isZero = tier.refund_pct === 0;
            return (
              <View
                key={`rl-${index}`}
                style={[
                  styles.rlRow,
                  index > 0 ? { borderTopWidth: 1, borderTopColor: palette.panelBorder } : null,
                ]}
                accessibilityLabel={`${refundTierLabel(tier, index, tiers)}: ${
                  isZero ? "no refund" : `${tier.refund_pct}% refund`
                }`}
              >
                <Text style={[styles.rlLabel, surface.secondaryText]}>
                  {refundTierLabel(tier, index, tiers)}
                </Text>
                <Text
                  style={[
                    styles.rlPct,
                    { color: isZero ? palette.tertiaryText : palette.primaryText },
                  ]}
                >
                  {isZero ? "No refund" : `${tier.refund_pct}% refund`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {deadlineLabel !== null ? (
        <View style={[styles.strip, surface.card]}>
          <Icon name="clock" size={16} color={palette.accent} />
          <Text style={[styles.stripText, surface.secondaryText]}>
            Bookings close {deadlineLabel}.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// =====================================================================
// LEGACY mode — the prior framed inline preview (wizard Step-5), unchanged.
// =====================================================================

const LegacyTripPreview: React.FC<{
  trip: Trip;
  brand: TripPreviewBrand;
  showCta: boolean;
  contentPadding: number;
  onReserveTap?: () => void;
  testID?: string;
}> = ({ trip, brand, showCta, contentPadding, onReserveTap, testID }) => {
  const includedItems = trip.inclusions.filter((i) => i.kind === "included");
  const excludedItems = trip.inclusions.filter((i) => i.kind === "excluded");
  const tier = trip.pricingTiers[0];
  // ORCH-1119 — one-playing guard for per-day gallery videos.
  const [activeVideoKey, setActiveVideoKey] = React.useState<string | null>(
    null,
  );

  return (
    <View style={styles.legacyHost} testID={testID}>
      {/* Cover image */}
      {trip.coverMediaUrl !== null ? (
        <Image
          source={{ uri: trip.coverMediaUrl }}
          style={styles.legacyCover}
          accessibilityLabel={`Cover image for ${trip.title}`}
        />
      ) : (
        <View style={[styles.legacyCover, styles.legacyCoverPlaceholder]}>
          <Text style={styles.legacyCoverPlaceholderText}>No cover image</Text>
        </View>
      )}

      <View style={[styles.legacyBody, { padding: contentPadding }]}>
        <Text style={styles.legacyTitle}>{trip.title}</Text>
        <Text style={styles.legacyBrandByline}>by {brand.name}</Text>

        <View style={styles.legacyMetaRow}>
          <Icon name="calendar" size={16} color={accent.warm} />
          <Text style={styles.legacyMetaText}>
            {formatTripDateRange(
              trip.businessTrip.startAt,
              trip.businessTrip.endAt,
            )}
          </Text>
        </View>
        {trip.businessTrip.departureLocationText !== null ? (
          <View style={styles.legacyMetaRow}>
            <Icon name="send" size={16} color={accent.warm} />
            <Text style={styles.legacyMetaText} numberOfLines={2}>
              Leaving from {trip.businessTrip.departureLocationText}
            </Text>
          </View>
        ) : null}
        {trip.businessTrip.destinationLocationText !== null ? (
          <View style={styles.legacyMetaRow}>
            <Icon name="location" size={16} color={accent.warm} />
            <Text style={styles.legacyMetaText} numberOfLines={2}>
              {trip.businessTrip.destinationLocationText}
            </Text>
          </View>
        ) : null}
        {trip.businessTrip.capacity !== null ? (
          <View style={styles.legacyMetaRow}>
            <Icon name="users" size={16} color={accent.warm} />
            <Text style={styles.legacyMetaText}>
              {trip.businessTrip.capacity} traveler
              {trip.businessTrip.capacity === 1 ? "" : "s"} max
            </Text>
          </View>
        ) : null}

        {trip.description !== null && trip.description.trim().length > 0 ? (
          <View style={styles.legacyDescriptionWrap}>
            <CollapsibleDescription
              text={trip.description}
              testID="trip-preview-description"
            />
          </View>
        ) : null}

        {trip.days.length > 0 ? (
          <View style={styles.legacySection}>
            <Text style={styles.legacySectionLabel}>Day by day</Text>
            <View style={styles.legacyDaysList}>
              {trip.days.map((day: TripDay) => {
                const firstVideoIndex = day.media.findIndex(
                  (m) => m.type === "video",
                );
                const defaultKey =
                  firstVideoIndex >= 0 ? `${day.id}-${firstVideoIndex}` : null;
                return (
                  <View key={day.id} style={styles.legacyDayCard}>
                    <Text style={styles.legacyDayOrdinal}>
                      DAY {day.ordinal}
                    </Text>
                    <Text style={styles.legacyDayTitle}>{day.title}</Text>
                    {day.narrative !== null &&
                    day.narrative.trim().length > 0 ? (
                      <Text style={styles.legacyDayNarrative}>
                        {day.narrative}
                      </Text>
                    ) : null}
                    {day.media.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.legacyDayMediaRow}
                        accessibilityLabel={`Day ${day.ordinal} media gallery`}
                      >
                        {day.media.map((m, mi) => {
                          const key = `${day.id}-${mi}`;
                          const isActive =
                            activeVideoKey === null
                              ? key === defaultKey
                              : activeVideoKey === key;
                          return m.type === "video" ? (
                            <Pressable
                              key={key}
                              onPress={() =>
                                setActiveVideoKey((cur) =>
                                  cur === key ? null : key,
                                )
                              }
                              accessibilityRole="imagebutton"
                              accessibilityLabel={`Day ${day.ordinal} media ${mi + 1}, video`}
                              style={styles.legacyDayMediaTile}
                            >
                              <EventCoverMedia
                                mediaUrl={m.url}
                                mediaType="video"
                                autoplay
                                playbackActive={isActive}
                                muted
                                loop
                                radius={12}
                                height="100%"
                                width="100%"
                              />
                              {!isActive ? (
                                <View
                                  style={styles.legacyDayMediaPlayBadge}
                                  pointerEvents="none"
                                >
                                  <Icon name="play" size={12} color="#FFFFFF" />
                                </View>
                              ) : null}
                            </Pressable>
                          ) : (
                            <Image
                              key={key}
                              source={{ uri: m.url }}
                              style={styles.legacyDayMediaTile}
                              resizeMode="cover"
                              accessibilityRole="image"
                              accessibilityLabel={`Day ${day.ordinal} media ${mi + 1}, image`}
                            />
                          );
                        })}
                      </ScrollView>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {includedItems.length > 0 || excludedItems.length > 0 ? (
          <View style={styles.legacySection}>
            {includedItems.length > 0 ? (
              <>
                <Text style={styles.legacySectionLabel}>
                  What&rsquo;s included
                </Text>
                <View style={styles.legacyItemsList}>
                  {includedItems.map((i: TripInclusion) => (
                    <View key={i.id} style={styles.legacyItemRow}>
                      <Icon name="check" size={14} color={accent.warm} />
                      <Text style={styles.legacyItemText}>{i.item}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {excludedItems.length > 0 ? (
              <>
                <Text
                  style={[styles.legacySectionLabel, styles.legacyExcludedLabel]}
                >
                  What&rsquo;s NOT included
                </Text>
                <View style={styles.legacyItemsList}>
                  {excludedItems.map((i: TripInclusion) => (
                    <View key={i.id} style={styles.legacyItemRow}>
                      <Icon
                        name="close"
                        size={14}
                        color={textTokens.tertiary}
                      />
                      <Text style={styles.legacyItemText}>{i.item}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {tier !== undefined ? (
          <View style={styles.legacyPricingCard}>
            <View>
              <Text style={styles.legacyPricingTierName}>{tier.tierName}</Text>
              <Text style={styles.legacyPricingPrice}>{formatPrice(tier)}</Text>
            </View>
            {showCta && onReserveTap !== undefined ? (
              <Pressable
                onPress={onReserveTap}
                accessibilityRole="button"
                accessibilityLabel={`Reserve your spot on ${trip.title}`}
                style={styles.legacyReserveCta}
                testID="trip-preview-reserve-cta"
              >
                <Text style={styles.legacyReserveCtaText}>Reserve my spot</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // ---- foundation: lead/title/eyebrow ----
  leadBlock: {
    marginBottom: 4,
  },
  eyebrowLead: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    lineHeight: 35,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  heroEyebrow: {
    color: "#ffffff",
    opacity: 0.92,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "900",
    letterSpacing: -0.5,
    maxWidth: "72%",
  },
  // ---- meta chips ----
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metaChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
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
  brandTile: {
    width: 42,
    height: 42,
    borderRadius: 999,
  },
  brandTextCol: {
    flexShrink: 1,
  },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandName: {
    fontSize: 15,
    fontWeight: "800",
    marginTop: 1,
  },
  brandCta: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: "800",
  },
  // ---- section / titles ----
  section: {
    marginTop: 24,
  },
  secTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  // ---- route ----
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
  },
  routeLeg: {
    flex: 1,
    minWidth: 0,
  },
  routeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  routePlace: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  routeArrow: {
    fontSize: 18,
  },
  // ---- about ----
  aboutWrap: {
    marginTop: 0,
  },
  // ---- itinerary ----
  itin: {
    position: "relative",
    paddingLeft: 30,
    marginTop: 4,
  },
  itinSpine: {
    position: "absolute",
    left: 9,
    top: 6,
    bottom: 6,
    width: 2,
  },
  day: {
    position: "relative",
    paddingBottom: 18,
  },
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
  dayDotText: {
    fontSize: 10,
    fontWeight: "900",
  },
  dayCard: {
    borderRadius: 14,
    padding: 14,
  },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dayOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dayDate: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: "800",
    marginTop: 4,
  },
  dayNarr: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  showAllRow: {
    paddingVertical: 8,
  },
  showAllText: {
    fontSize: 14,
    fontWeight: "800",
  },
  // ---- map ----
  mapBlock: {
    height: 180,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    overflow: "hidden",
  },
  // Mapbox static image fills the card as a background; the accent pin + caption
  // pill overlay it (mockup `.map img` — width/height 100%, object-fit cover).
  mapImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  mapCapPill: {
    position: "absolute",
    left: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mapCap: {
    fontSize: 12,
    fontWeight: "700",
  },
  // ---- strips + refund ladder (mockup `.strip` / `.refund-ladder`) ----
  strip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  stripText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  refundLadder: {
    marginTop: 8,
  },
  rlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
  },
  rlLabel: {
    flexShrink: 1,
    fontSize: 13,
  },
  rlPct: {
    fontSize: 13,
    fontWeight: "800",
  },
  // ---- desktop sticky panel ----
  deskPanel: {
    borderRadius: 22,
    overflow: "hidden",
  },
  deskAccent: {
    height: 4,
  },
  deskInner: {
    padding: 20,
  },
  deskPayWrap: {
    marginTop: 18,
  },
  // ===================== LEGACY styles (unchanged from pre-1138) =====================
  legacyHost: {
    backgroundColor: "transparent",
  },
  legacyCover: {
    width: "100%",
    height: 220,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  legacyCoverPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  legacyCoverPlaceholderText: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
  },
  legacyBody: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  legacyTitle: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
  },
  legacyBrandByline: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  legacyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  legacyMetaText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  legacyDescriptionWrap: {
    marginTop: spacing.md,
  },
  legacySection: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  legacySectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  legacyExcludedLabel: {
    marginTop: spacing.md,
  },
  legacyDaysList: {
    gap: spacing.sm,
  },
  legacyDayCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  legacyDayOrdinal: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
  },
  legacyDayTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  legacyDayNarrative: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  legacyDayMediaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  legacyDayMediaTile: {
    width: 96,
    height: 96,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: Platform.select({
      android: "#1A1A1C",
      default: "rgba(255,255,255,0.06)",
    }),
  },
  legacyDayMediaPlayBadge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  legacyItemsList: {
    gap: spacing.xs,
  },
  legacyItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legacyItemText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  legacyPricingCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  legacyPricingTierName: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  legacyPricingPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 2,
  },
  legacyReserveCta: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
  },
  legacyReserveCtaText: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

export default TripPreview;
