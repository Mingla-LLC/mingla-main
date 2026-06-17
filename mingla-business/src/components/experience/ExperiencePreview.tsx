/**
 * ExperiencePreview — buyer-eye preview of a published experience. Used in:
 *   - Public buyer-anon route /exp/{brandSlug}/{experienceSlug} (FOUNDATION mode —
 *     ORCH-1138 Leg 3 Direction A: immersive parallax cover + body-level fixed
 *     chrome + brand-themed palette + responsive desktop two-column sticky panel +
 *     vibe chips + REAL per-stop itinerary with per-stop count-aware galleries +
 *     blurbs + a map of stop 1 + the "Reserve" CTA).
 *   - Wizard Step 5 review-before-publish (LEGACY mode — the framed inline
 *     preview; no shell, no chrome, no palette; byte-stable for the wizard caller).
 *
 * META-ORCH-1059 Sub-C → rebuilt by ORCH-1138 Leg 3 onto the shared
 * @mingla/offering-rendering foundation (mirrors TripPreview Leg 1). The mode is
 * chosen by whether `palette` is provided:
 *   palette PRESENT → FOUNDATION mode (ParallaxCoverShell-composed full page).
 *   palette ABSENT  → LEGACY mode (the prior inline framed render, unchanged).
 *
 * Anon-tolerant: this component does NOT call useAuth. The public route passes the
 * resolved payload + palette/theme + chrome handlers; the wizard caller passes the
 * draft experience + currentBrand with NO palette.
 *
 * Constitution rule 9 — renders ONLY real wizard-authored fields: cover, title,
 * brand, date model, description, REAL stops (name/address/start_time/blurb/media),
 * vibe chips (experience_intents), and a stop-1 map (only when lat/lng present).
 * NO inclusions, NO refund ladder, NO per-stop price, NO placeholder map — those
 * are not authored for experiences (DESIGN §A.7 / SPEC rule 9).
 */

import React from "react";
import {
  Image,
  Pressable,
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
} from "@mingla/event-rendering";
import {
  ParallaxCoverShell,
  CountAwareGallery,
  useResponsiveLayout,
  normalizeCityCountry,
  type CountAwareGalleryItem,
} from "@mingla/offering-rendering";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { CollapsibleDescription } from "../offering/CollapsibleDescription";
import { formatExperienceDateSubline } from "../../utils/experienceDateSubline";
import { EXPERIENCE_INTENTS } from "../../constants/experienceIntents";
// ORCH-1138 rework (§4.D F-1.2) — START HERE / THEN / END WITH stop labels.
import { labelForIndex } from "./experienceWizardTypes";
import type {
  PublicExperience,
  PublicExperienceBrand,
  PublicExperienceStop,
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

function formatStopTime(iso: string | null): string {
  if (iso === null) return "";
  // start_time is stored as a clock string ("HH:mm[:ss]") or an ISO instant.
  if (/^\d{2}:\d{2}/.test(iso)) {
    const [hh, mm] = iso.split(":");
    const h = Number(hh);
    if (!Number.isFinite(h)) return "";
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${ampm}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
}

// ORCH-1138 Leg 3 — id → human label for the vibe chips (single source of truth:
// EXPERIENCE_INTENTS). Unknown ids drop (rule 9 — never render a raw id).
const INTENT_LABEL = new Map<string, string>(
  EXPERIENCE_INTENTS.map((o) => [o.id, o.label]),
);

function stopMediaItems(stop: PublicExperienceStop): CountAwareGalleryItem[] {
  return stop.imageUrls.map((url) => ({
    url,
    // experience_stops.image_urls are images (videos ride cover). Mark image.
    type: "image",
  }));
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
// FOUNDATION mode — Direction A immersive page (ORCH-1138 Leg 3)
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

  const dateSubline = formatExperienceDateSubline({
    venueText: experience.venueText,
    dateStartIsos: experience.dates.map((d) => d.startAt),
    whenMode: experience.whenMode,
    recurrenceRule: experience.recurrenceRule,
  });

  // "City, Country" normalized from venue text (rule 9: null → omit).
  const cityCountry = normalizeCityCountry(experience.venueText);
  const fromLabel = formatFromPrice(experience);
  const isFree = experience.ticket?.isFree === true ||
    (experience.ticket?.priceCents ?? 1) === 0;

  // Vibe chips — real experience_intents only (rule 9). Unknown ids dropped.
  const vibeChips = experience.intents
    .map((id) => INTENT_LABEL.get(id))
    .filter((label): label is string => typeof label === "string");

  const coverType =
    experience.coverMediaType === "video"
      ? "video"
      : experience.coverMediaType === "gif"
        ? "gif"
        : experience.coverMediaUrl !== null
          ? "image"
          : null;

  // first stop with coords → map block (rule 9: no placeholder when absent).
  const mapStop = experience.stops.find(
    (s) => s.lat !== null && s.lng !== null,
  );

  // ORCH-1138 rework (§4.D F-1.1) — the lead EYEBROW is the derived stop count
  // ("3-stop experience"); City,Country stays a META CHIP only (no duplication).
  const stopCount = experience.stops.length;
  const stopEyebrow = stopCount > 0 ? `${stopCount}-stop experience` : null;

  // ORCH-1138 rework (§4.D F-1.4) — seats meta chip from the ONE ticket's
  // remaining/total (rule 9: omit when unlimited/unknown).
  const seatsChip = (() => {
    const t = experience.ticket;
    if (t == null || t.isUnlimited) return null;
    const remaining = t.ticketsRemaining;
    const total = t.quantityTotal;
    if (remaining == null && total == null) return null;
    if (remaining != null && total != null) {
      return `${Math.max(remaining, 0)} spots left · ${total} max`;
    }
    if (remaining != null) return `${Math.max(remaining, 0)} spots left`;
    if (total != null) return `${total} max`;
    return null;
  })();

  // ORCH-1138 rework (§4.D F-1.4) — start-time meta chip from the master/first
  // occurrence start instant (rule 9: omit when no date).
  const startTimeChip = (() => {
    const first = experience.dates[0];
    if (first == null) return null;
    const d = new Date(first.startAt);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return `${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: first.timezone || "UTC",
      }).format(d)} start`;
    } catch {
      return null;
    }
  })();

  // ---- brand chip ----
  const brandChip = (
    <Pressable
      onPress={onViewBrand}
      accessibilityRole="button"
      accessibilityLabel={`View ${brand.name}`}
      style={[styles.brandRow, surface.card]}
    >
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
        <Text style={[styles.brandKicker, surface.tertiaryText]}>
          Presented by
        </Text>
        <Text style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}>
          {brand.name}
        </Text>
      </View>
      <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
    </Pressable>
  );

  const left = (
    <View>
      {/* phone-only lead eyebrow + title (desktop shows them in the hero) */}
      {!isDesktop ? (
        <View style={styles.leadBlock}>
          {/* ORCH-1138 rework (§4.D F-1.1) — N-stop eyebrow (was cityCountry). */}
          {stopEyebrow !== null ? (
            <Text style={[styles.eyebrowLead, { color: palette.accent }]}>
              {stopEyebrow}
            </Text>
          ) : null}
          <Text style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}>
            {experience.title}
          </Text>
        </View>
      ) : null}

      {/* meta chips — City,Country (shown ONCE) · dates · seats · start-time
          (ORCH-1138 rework §4.D F-1.4; rule 9 — only when known) */}
      <View style={styles.metaRow}>
        {dateSubline.length > 0 ? (
          <MetaChip palette={palette} surface={surface} icon="calendar" fontFamily={boldFamily}>
            {dateSubline}
          </MetaChip>
        ) : null}
        {cityCountry !== null ? (
          <MetaChip palette={palette} surface={surface} icon="location" fontFamily={boldFamily}>
            {cityCountry}
          </MetaChip>
        ) : null}
        {seatsChip !== null ? (
          <MetaChip palette={palette} surface={surface} icon="users" fontFamily={boldFamily}>
            {seatsChip}
          </MetaChip>
        ) : null}
        {startTimeChip !== null ? (
          <MetaChip palette={palette} surface={surface} icon="clock" fontFamily={boldFamily}>
            {startTimeChip}
          </MetaChip>
        ) : null}
      </View>

      {/* vibe chips — real curated intents only (rule 9) */}
      {vibeChips.length > 0 ? (
        <View style={styles.vibesRow}>
          {vibeChips.map((label) => (
            <View
              key={label}
              style={[
                styles.vibeChip,
                { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
              ]}
            >
              <Icon name="sparkle" size={13} color={palette.accent} />
              <Text style={[styles.vibeChipText, surface.primaryText, { fontFamily: boldFamily }]}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* brand chip — phone inline; desktop puts it in the sticky panel */}
      {!isDesktop ? brandChip : null}

      {/* "Open daily (hours)" availability strip (route-owned; null otherwise) */}
      {availabilityBlock}

      {/* about */}
      {experience.description !== null &&
      experience.description.trim().length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            About this experience
          </Text>
          <View style={styles.aboutWrap}>
            <CollapsibleDescription
              text={experience.description}
              testID="experience-preview-description"
            />
          </View>
        </View>
      ) : null}

      {/* the itinerary — REAL authored stops (rule 9) */}
      {experience.stops.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            The itinerary
          </Text>
          <StopSpine
            stops={experience.stops}
            palette={palette}
            surface={surface}
            fontFamily={boldFamily}
            variant={isDesktop ? "desktop" : "phone"}
          />
        </View>
      ) : null}

      {/* where you'll be — stop-1 map (only when lat/lng present, rule 9) */}
      {mapStop !== undefined ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            {/* ORCH-1138 rework (§4.D F-1.3) */}
            Where you&rsquo;ll start
          </Text>
          <View
            style={[styles.mapBlock, surface.card, { height: isDesktop ? 300 : 180 }]}
          >
            {(() => {
              const mapUrl = buildStaticMapUrl({
                lat: mapStop.lat as number,
                lng: mapStop.lng as number,
                accentHex: palette.accent,
                height: isDesktop ? 300 : 180,
              });
              return mapUrl !== null ? (
                <Image
                  source={{ uri: mapUrl }}
                  style={styles.mapImage}
                  resizeMode="cover"
                  accessibilityLabel={`Map of ${mapStop.placeName}`}
                />
              ) : null;
            })()}
            <Icon name="location" size={28} color={palette.accent} />
            <View style={[styles.mapCapPill, { backgroundColor: palette.page }]}>
              <Text style={[styles.mapCap, surface.primaryText]}>
                {mapStop.placeName}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* phone-only price summary card */}
      {!isDesktop ? (
        <View style={[styles.pricingCard, surface.card]}>
          <Text style={[styles.pricingLabel, surface.secondaryText]}>
            {isFree ? "Price" : "From"}
          </Text>
          <Text style={[styles.pricingPrice, surface.primaryText, { fontFamily: boldFamily }]}>
            {fromLabel}
          </Text>
        </View>
      ) : null}

      {/* DOCKED Reserve CTA — LAST phone-body child (flush, no void) */}
      {!isDesktop && dockedReserve !== undefined ? dockedReserve : null}
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
            {fromLabel}
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
      heroEyebrow={
        /* ORCH-1138 rework (§4.D F-1.1) — N-stop eyebrow (was cityCountry; city
           is the meta chip). */
        stopEyebrow !== null ? (
          <Text style={styles.heroEyebrow}>{stopEyebrow}</Text>
        ) : undefined
      }
      heroTitle={
        <Text style={[styles.heroTitle, { fontFamily: boldFamily }]}>
          {experience.title}
        </Text>
      }
      stateBanner={stateBanner}
      stickyPanel={stickyPanel}
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      onScroll={onScroll}
      onScrollViewLayout={onScrollViewLayout}
      // ORCH-1153 BUG-2 (Seth device): the experience body is shorter than a
      // multi-day trip's, so the shared 4/5 cover (height ≈ 1.25× width) left
      // only a slit of readable content on first paint. A square (1/1) cover
      // pins full-bleed exactly as before but frees ~25% more viewport for the
      // detail content to slide over. Trip/event/RSVP keep the 4/5 default.
      coverAspectRatio={1}
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
  fontFamily: string;
  children: React.ReactNode;
}> = ({ palette, surface, icon, fontFamily, children }) => (
  <View style={[styles.metaChip, surface.card]}>
    <Icon name={icon} size={15} color={palette.accent} />
    <Text style={[styles.metaChipText, surface.secondaryText, { fontFamily }]} numberOfLines={1}>
      {children}
    </Text>
  </View>
);

// ---- stop spine (REAL authored stops) ----
const StopSpine: React.FC<{
  stops: PublicExperienceStop[];
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  fontFamily: string;
  variant: "phone" | "desktop";
}> = ({ stops, palette, surface, fontFamily, variant }) => (
  <View style={styles.itin}>
    <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
    {stops.map((stop, idx) => {
      const t = formatStopTime(stop.startTime);
      const media = stopMediaItems(stop);
      return (
        <View key={stop.id} style={styles.stop}>
          <View style={[styles.stopDot, { backgroundColor: palette.accent }]}>
            <Text style={[styles.stopDotText, { color: palette.accentText }]}>
              {stop.stopOrder + 1}
            </Text>
          </View>
          <View style={[styles.stopCard, surface.card]}>
            <View style={styles.stopHead}>
              {/* ORCH-1138 rework (§4.D F-1.2) — START HERE / THEN / END WITH. */}
              <Text style={[styles.stopOrd, { color: palette.accent }]}>
                {labelForIndex(idx, stops.length)}
              </Text>
              {t.length > 0 ? (
                <Text style={[styles.stopTime, surface.tertiaryText]}>{t}</Text>
              ) : null}
            </View>
            <Text style={[styles.stopTitle, surface.primaryText, { fontFamily }]}>
              {stop.placeName}
            </Text>
            {stop.address.trim().length > 0 ? (
              <Text style={[styles.stopAddr, surface.tertiaryText]} numberOfLines={2}>
                {stop.address}
              </Text>
            ) : null}
            {stop.description !== null && stop.description.trim().length > 0 ? (
              <Text style={[styles.stopBlurb, surface.secondaryText]}>
                {stop.description}
              </Text>
            ) : null}
            {media.length > 0 ? (
              <CountAwareGallery
                items={media}
                palette={palette}
                variant={variant}
                accessibilityLabelPrefix={`Stop ${stop.stopOrder + 1} media`}
              />
            ) : null}
          </View>
        </View>
      );
    })}
  </View>
);

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
  const isFree = experience.ticket?.isFree === true ||
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
                    {t.length > 0 ? (
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
  // ---- foundation: lead/title/eyebrow ----
  leadBlock: { marginBottom: 4 },
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
    maxWidth: "100%",
  },
  metaChipText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  // ---- vibe chips ----
  vibesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  vibeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  vibeChipText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
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
  brandCta: { marginLeft: "auto", fontSize: 12, fontWeight: "800" },
  // ---- section / titles ----
  section: { marginTop: 24 },
  secTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  aboutWrap: { marginTop: 0 },
  // ---- stop spine ----
  itin: { position: "relative", paddingLeft: 30, marginTop: 4 },
  itinSpine: { position: "absolute", left: 9, top: 6, bottom: 6, width: 2 },
  stop: { position: "relative", paddingBottom: 18 },
  stopDot: {
    position: "absolute",
    left: -30,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  stopDotText: { fontSize: 10, fontWeight: "900" },
  stopCard: { borderRadius: 14, padding: 14 },
  stopHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  stopOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stopTime: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  stopTitle: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  stopAddr: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  stopBlurb: { fontSize: 13, lineHeight: 20, marginTop: 8 },
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
  mapImage: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  mapCapPill: {
    position: "absolute",
    left: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mapCap: { fontSize: 12, fontWeight: "700" },
  // ---- price card (foundation) ----
  pricingCard: {
    marginTop: 24,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
  },
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
