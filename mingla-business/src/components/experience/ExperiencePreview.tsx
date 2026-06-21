/**
 * ExperiencePreview — buyer-eye preview of a published experience. Used in:
 *   - Public buyer-anon route /exp/{brandSlug}/{experienceSlug} (FOUNDATION mode —
 *     immersive parallax cover + body-level fixed chrome + brand-themed palette +
 *     responsive desktop two-column sticky panel). ORCH-1183 [experience-standardize]
 *     rebuilds FOUNDATION mode onto the ONE shared @mingla/offering-rendering
 *     `ExperienceOfferingBody` (mirrors TripPreview's TripOfferingBody) — the
 *     hand-mirrored body sections (meta chips, vibe chips, brand chip, about,
 *     itinerary spine, map, price card) are RETIRED here in favor of the shared
 *     component, so web/business + consumer render byte-identically.
 *   - Wizard Step 5 review-before-publish (LEGACY mode — the framed inline
 *     preview; no shell, no chrome, no palette; byte-stable for the wizard caller).
 *
 * The mode is chosen by whether `palette` is provided:
 *   palette PRESENT → FOUNDATION mode (ParallaxCoverShell-composed full page).
 *   palette ABSENT  → LEGACY mode (the prior inline framed render, unchanged).
 *
 * Anon-tolerant: this component does NOT call useAuth. The public route passes the
 * resolved payload + palette/theme + chrome handlers; the wizard caller passes the
 * draft experience + currentBrand with NO palette.
 *
 * Constitution rule 9 — renders ONLY real wizard-authored fields. NO inclusions, NO
 * refund ladder, NO per-stop price, NO placeholder map.
 */

import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

// ORCH-1138 — scroll/layout handler aliases for the float→dock Reserve CTA,
// forwarded to ParallaxCoverShell (mirror TripPreview).
type ParallaxScrollHandler = (
  event: NativeSyntheticEvent<NativeScrollEvent>,
) => void;
type ParallaxLayoutHandler = (event: LayoutChangeEvent) => void;

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  boldFontFamily,
  offeringSurfaceStyles,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import {
  ParallaxCoverShell,
  ExperienceOfferingBody,
  experiencePriceLabel,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { CollapsibleDescription } from "../offering/CollapsibleDescription";
import { formatExperienceDateSubline } from "../../utils/experienceDateSubline";
import {
  buildExperienceOfferingBrand,
  buildExperienceOfferingData,
} from "./experienceOfferingAdapter";
import type {
  PublicExperience,
  PublicExperienceBrand,
} from "../../services/publicExperienceService";

export interface ExperiencePreviewProps {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  /** Body padding override for framed parents (e.g. wizard). */
  contentPadding?: number;
  testID?: string;

  // ===================== ORCH-1138 FOUNDATION mode (all OPTIONAL) =====================
  /**
   * The resolved brand palette (createThemePalette). PRESENT ⇒ FOUNDATION mode:
   * ExperiencePreview composes the immersive ParallaxCoverShell. ABSENT ⇒ LEGACY
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
  /** sold-out / ended / unavailable pill, rendered above the body content. */
  stateBanner?: React.ReactNode | null;
  /** Desktop sticky-panel Reserve control + reassurance (route-owned). */
  reserveControl?: React.ReactNode;
  /** The "Open daily (hours)" availability strip (route-owned; null when N/A). */
  availabilityBlock?: React.ReactNode | null;
  /** Brand "View" tap → brand page (route-owned). */
  onViewBrand?: () => void;
  /** Floating-bar clearance (phone). */
  contentBottomInset?: number;
  /** Native safe-area top inset for the chrome. */
  safeAreaTop?: number;
  /** The DOCKED Reserve CTA — LAST child of the PHONE body (route-owned). */
  dockedReserve?: React.ReactNode;
  /** Scroll-awareness passthrough so the route hides its floating pill. */
  onScroll?: ParallaxScrollHandler;
  onScrollViewLayout?: ParallaxLayoutHandler;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function formatFromPrice(experience: PublicExperience): string {
  const t = experience.ticket;
  if (t === null) return "Pricing TBD";
  if (t.isFree || t.priceCents === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: t.currency || "USD",
    }).format(t.priceCents / 100);
  } catch {
    return `${(t.priceCents / 100).toFixed(2)} ${t.currency}`;
  }
}

// ORCH-1157 Round-8 [cross-type time audit] — device-locale-aware per-stop time.
// Device on 12h → "7:00 PM", device on 24h → "19:00", always carrying minutes.
// `locale` exists ONLY so tests can pin a clock (undefined → device/OS locale).
// Real-data-only: malformed → null. The surface owns this (the pure package stays
// locale-free); passed to the shared StopSpine via formatStopTime.
function formatStopTime(iso: string | null, locale?: string): string | null {
  if (iso === null) return null;
  const is24h =
    new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
      .hour12 === false;
  if (/^\d{2}:\d{2}/.test(iso)) {
    const [hh, mm] = iso.split(":");
    const h = Number(hh);
    const m = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    const d = new Date(2000, 0, 1, h, m, 0);
    return new Intl.DateTimeFormat(locale, {
      hour: is24h ? "2-digit" : "numeric",
      minute: "2-digit",
    })
      .format(d)
      .replace(/\bam\b/i, "AM")
      .replace(/\bpm\b/i, "PM");
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: is24h ? "2-digit" : "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/\bam\b/i, "AM")
    .replace(/\bpm\b/i, "PM");
}

export const ExperiencePreview: React.FC<ExperiencePreviewProps> = ({
  experience,
  brand,
  contentPadding = spacing.lg,
  testID,
  palette,
  theme,
  muted = true,
  onToggleMute,
  onClose,
  onShare,
  stateBanner = null,
  reserveControl,
  availabilityBlock = null,
  onViewBrand,
  contentBottomInset = 0,
  safeAreaTop = 0,
  dockedReserve,
  onScroll,
  onScrollViewLayout,
}) => {
  // FOUNDATION mode requires palette + theme + the chrome handlers.
  if (
    palette !== undefined &&
    theme !== undefined &&
    onClose !== undefined &&
    onShare !== undefined &&
    onToggleMute !== undefined
  ) {
    return (
      <FoundationExperiencePreview
        experience={experience}
        brand={brand}
        palette={palette}
        theme={theme}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={onClose}
        onShare={onShare}
        stateBanner={stateBanner}
        reserveControl={reserveControl}
        availabilityBlock={availabilityBlock}
        onViewBrand={onViewBrand}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        dockedReserve={dockedReserve}
        onScroll={onScroll}
        onScrollViewLayout={onScrollViewLayout}
        testID={testID}
      />
    );
  }

  // ===================== LEGACY mode (wizard Step-5 preview) =====================
  return (
    <LegacyExperiencePreview
      experience={experience}
      brand={brand}
      contentPadding={contentPadding}
      testID={testID}
    />
  );
};

// =====================================================================
// FOUNDATION mode — Direction A immersive page, now on the SHARED body.
// =====================================================================

const FoundationExperiencePreview: React.FC<{
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  palette: ThemePalette;
  theme: ResolvedTheme;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  stateBanner: React.ReactNode | null;
  reserveControl?: React.ReactNode;
  availabilityBlock?: React.ReactNode | null;
  onViewBrand?: () => void;
  contentBottomInset: number;
  safeAreaTop: number;
  dockedReserve?: React.ReactNode;
  onScroll?: ParallaxScrollHandler;
  onScrollViewLayout?: ParallaxLayoutHandler;
  testID?: string;
}> = ({
  experience,
  brand,
  palette,
  theme,
  muted,
  onToggleMute,
  onClose,
  onShare,
  stateBanner,
  reserveControl,
  availabilityBlock = null,
  onViewBrand,
  contentBottomInset,
  safeAreaTop,
  dockedReserve,
  onScroll,
  onScrollViewLayout,
  testID,
}) => {
  const { isDesktop } = useResponsiveLayout();
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);

  const data = buildExperienceOfferingData(experience);
  const offeringBrand = buildExperienceOfferingBrand(brand);
  const { label: priceLabel, isFree } = experiencePriceLabel(data);

  const coverType =
    experience.coverMediaType === "video"
      ? "video"
      : experience.coverMediaType === "gif"
        ? "gif"
        : experience.coverMediaUrl !== null
          ? "image"
          : null;

  const stopEyebrow =
    experience.stops.length > 0 ? `${experience.stops.length}-stop experience` : null;

  // ---- brand chip (desktop sticky panel) ----
  const brandChip = (
    <View style={[styles.brandRow, surface.card]}>
      <View style={styles.brandTile}>
        <EventCoverMedia
          mediaUrl={brand.coverMediaUrl ?? null}
          mediaType={brand.coverMediaType ?? null}
          hue={brand.coverHue ?? undefined}
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
        <Text style={[styles.brandKicker, surface.tertiaryText]}>Presented by</Text>
        <Text style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}>
          {brand.name}
        </Text>
      </View>
    </View>
  );

  // ---- desktop sticky booking panel ----
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, surface.cardStrong]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        {brandChip}
        <View style={styles.deskPriceRow}>
          <Text style={[styles.pricingLabel, surface.secondaryText]}>
            {isFree ? "Price" : "From"}
          </Text>
          <Text style={[styles.pricingPrice, surface.primaryText, { fontFamily: boldFamily }]}>
            {priceLabel}
          </Text>
        </View>
        {reserveControl}
      </View>
    </View>
  ) : null;

  return (
    <ParallaxCoverShell
      palette={palette}
      theme={theme}
      coverMediaUrl={experience.coverMediaUrl}
      coverMediaType={coverType}
      entranceAnimationKey={`experience:${experience.id}`}
      muted={muted}
      onToggleMute={onToggleMute}
      showMute={coverType === "video"}
      onClose={onClose}
      onShare={onShare}
      // ORCH-1159 — hide the floating X on web (public experience page). Native keeps it.
      hideCloseOnWeb
      heroEyebrow={
        stopEyebrow !== null ? (
          <Text style={styles.heroEyebrow}>{stopEyebrow}</Text>
        ) : undefined
      }
      heroTitle={
        <Text style={[styles.heroTitle, { fontFamily: boldFamily }]}>
          {experience.title}
        </Text>
      }
      stickyPanel={stickyPanel}
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      onScroll={onScroll}
      onScrollViewLayout={onScrollViewLayout}
      // ORCH-1153 BUG-2 — square (1/1) cover frees ~25% more viewport for the shorter
      // experience body. Trip/event/RSVP keep the 4/5 default.
      coverAspectRatio={1}
      testID={testID}
    >
      <ExperienceOfferingBody
        data={data}
        brand={offeringBrand}
        palette={palette}
        theme={theme}
        callbacks={{ onReserve: () => {}, onViewBrand }}
        variant={isDesktop ? "desktop" : "phone"}
        formatStopTime={(iso: string | null) => formatStopTime(iso)}
        availabilityBlock={availabilityBlock}
        stateBanner={stateBanner}
        dockedReserve={!isDesktop ? dockedReserve : undefined}
        testID="orch-1183-experience-body"
      />
    </ParallaxCoverShell>
  );
};

// =====================================================================
// LEGACY mode — the prior framed inline preview (wizard Step-5), unchanged.
// =====================================================================

const LegacyExperiencePreview: React.FC<{
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  contentPadding: number;
  testID?: string;
}> = ({ experience, brand, contentPadding, testID }) => {
  const dateSubline = formatExperienceDateSubline({
    venueText: experience.venueText,
    dateStartIsos: experience.dates.map((d) => d.startAt),
    whenMode: experience.whenMode,
    recurrenceRule: experience.recurrenceRule,
  });

  const fromLabel = formatFromPrice(experience);
  const isFree =
    experience.ticket?.isFree === true ||
    (experience.ticket?.priceCents ?? 1) === 0;

  return (
    <View style={styles.host} testID={testID}>
      {/* Full-bleed cover hero (image / GIF / video via the shared media). */}
      <EventCoverMedia
        hue={hueFromId(experience.id)}
        mediaUrl={experience.coverMediaUrl}
        mediaType={experience.coverMediaType}
        radius={0}
        label=""
        height={240}
      />

      <View style={[styles.body, { padding: contentPadding }]}>
        <Text style={styles.legacyTitle}>{experience.title}</Text>
        <Text style={styles.brandByline}>by {brand.name}</Text>

        {/* Date-model block — one-time / recurring / multi-date. */}
        <View style={styles.whenCard}>
          <Icon name="calendar" size={16} color={accent.warm} />
          <Text style={styles.whenText} numberOfLines={2}>
            {dateSubline}
          </Text>
        </View>

        {/* Description / narrative — ORCH-1117 collapsible (collapsed default). */}
        {experience.description !== null &&
        experience.description.trim().length > 0 ? (
          <View style={styles.descriptionWrap}>
            <CollapsibleDescription
              text={experience.description}
              testID="experience-preview-description"
            />
          </View>
        ) : null}

        {/* STOPS itinerary. */}
        {experience.stops.length > 0 ? (
          <View style={styles.legacySection}>
            <Text style={styles.sectionLabel}>The itinerary</Text>
            <View style={styles.stopsList}>
              {experience.stops.map((stop) => {
                const t = formatStopTime(stop.startTime);
                return (
                  <View key={stop.id} style={styles.legacyStopCard}>
                    <Text style={styles.legacyStopOrder}>
                      STOP {stop.stopOrder + 1}
                    </Text>
                    <Text style={styles.legacyStopName}>{stop.placeName}</Text>
                    {stop.address.trim().length > 0 ? (
                      <Text style={styles.legacyStopAddress} numberOfLines={2}>
                        {stop.address}
                      </Text>
                    ) : null}
                    {t !== null && t.length > 0 ? (
                      <Text style={styles.legacyStopTime}>{t}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* "From {price}". */}
        <View style={styles.legacyPricingCard}>
          <Text style={styles.pricingLabelLegacy}>{isFree ? "Price" : "From"}</Text>
          <Text style={styles.legacyPricingPrice}>{fromLabel}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // ---- foundation: hero ----
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
  // ---- brand chip (desktop sticky panel) ----
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
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
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  // ---- price (foundation) ----
  pricingLabel: { fontSize: 13 },
  pricingPrice: { fontSize: 24, fontWeight: "900" },
  // ---- desktop sticky panel ----
  deskPanel: { borderRadius: 22, overflow: "hidden" },
  deskAccent: { height: 4 },
  deskInner: { padding: 20 },
  deskPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
  },
  // ===================== LEGACY styles (unchanged) =====================
  host: { backgroundColor: "transparent" },
  body: { padding: spacing.lg, gap: spacing.sm },
  legacyTitle: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
  },
  brandByline: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  whenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  whenText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  descriptionWrap: { marginTop: spacing.md },
  legacySection: { marginTop: spacing.lg, gap: spacing.sm },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  stopsList: { gap: spacing.sm },
  legacyStopCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  legacyStopOrder: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
  },
  legacyStopName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  legacyStopAddress: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  legacyStopTime: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  legacyPricingCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  pricingLabelLegacy: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  legacyPricingPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
});

export default ExperiencePreview;
