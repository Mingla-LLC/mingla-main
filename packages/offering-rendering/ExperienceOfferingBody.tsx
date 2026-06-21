/**
 * ExperienceOfferingBody — ORCH-1183 [experience-standardize] (final META-ORCH-1166 leg).
 *
 * THE ONE shared, shell-agnostic body for the public EXPERIENCE page
 * (event_type='experience'). Rendered byte-identically on buyer-web + business
 * iOS/Android + consumer iOS/Android. Promotes the two forks — the web/business
 * `FoundationExperiencePreview` (ExperiencePreview.tsx) + the consumer hand-mirrored
 * body (ConsumerExperienceDetailScreen.tsx) — into ONE component. Mirrors
 * ORCH-1174's TripOfferingBody / ORCH-1167's EventOfferingBody / ORCH-1163's
 * RsvpOfferingBody.
 *
 * SHELL-AGNOSTIC (mandatory, gorhom-safe): this is a PURE CONTENT body. It hosts NO
 * scroll root and NO cover host. It returns a plain <View> of sections. It MUST NOT
 * render a ScrollView/BottomSheetScrollView, and NEVER wraps ParallaxCoverShell (the
 * surface owns the shell — re-wrapping re-triggers the ORCH-1016/1043 consumer scroll
 * freeze). Each surface composes its own scroll + parallax-cover scaffold AROUND it:
 *   • buyer-web + business native → inside ParallaxCoverShell (RN ScrollView).
 *   • consumer → inside BaseBottomSheet's gorhom BottomSheetScrollView.
 * The cover is a pinned sibling the surface owns; the floating/docked reserve bar is
 * the shared <TripReserveBar> the surface pins (a single all-in price — NO split,
 * NO installments, NO deposits; experiences are a single all-in charge).
 *
 * Experiences are STOP/place-based (the shared <StopSpine>, NOT trip's DayByDay),
 * carry ONE combined all-in price (ORCH-1151 sums the stops server-side → NEVER a
 * per-stop price), use the canonical 1–4 vibe ids, and a square cover by default
 * (coverAspectRatio={1}, ORCH-1153) — the surface owns the cover/aspect.
 *
 * Pure-presentational, props-only, NO app-src imports (I-MOR-0827-PACKAGE-ISOLATION).
 * All data via `data`/`brand`; all actions via `callbacks`.
 *
 * Section order:
 *   1.  Cover               (surface-pinned sibling — NOT here)
 *   2.  N-stop eyebrow + title (phone only; desktop renders them in the hero)
 *   3.  Meta chips          (location · dates · seats · start-time)
 *   4.  Vibe chips          (canonical intents)
 *   5.  Presented By        (brand cover + name + optional verified tick)
 *   6.  Availability strip  (open-daily hours — surface-injected child)
 *   7.  About               (collapsible)
 *   8.  The itinerary       (shared StopSpine)
 *   9.  Where you'll start  (stop-1 map — lat/lng-gated)
 *   10. Price card          (ONE all-in price — phone inline)
 *   11. Floating/docked bar (surface-pinned sibling — NOT here; docked passed in)
 */

import React, { useCallback, useState } from "react";
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import { boldFontFamily, offeringSurfaceStyles, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";
import { EventCoverMedia } from "./EventCoverMedia";
import { StopSpine } from "./StopSpine";
import { BadgeCheck, Calendar, Clock, MapPin, Sparkles, Users } from "./LucideIcons";
import { buildStaticMapUrl } from "./mapboxStaticImage";
import {
  experienceAvailabilityBanner as computeAvailabilityBanner,
  type AvailabilityBanner,
} from "./experienceAvailabilityBanner";
import type {
  ExperienceOfferingBrand,
  ExperienceOfferingCallbacks,
  ExperienceOfferingData,
} from "./experienceOfferingTypes";

const ABOUT_COLLAPSE_THRESHOLD = 160;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * THE ONE canonical experience vibe-id → label map (single owner). Collapses the
 * two forked maps (web ExperiencePreview INTENT_LABEL derived from
 * EXPERIENCE_INTENTS + consumer EXPERIENCE_INTENT_LABEL). The ids mirror the DB
 * CHECK `events_experience_intents_chk` (adventurous/first-date/romantic/group-fun).
 * Unknown ids drop (rule 9 — never render a raw id).
 */
export const EXPERIENCE_VIBE_LABELS: Readonly<Record<string, string>> = {
  adventurous: "Adventurous",
  "first-date": "First Dates",
  romantic: "Romantic",
  "group-fun": "Group Fun",
};

/** Map raw vibe ids → display labels (drops unknown ids). Single owner. */
export function experienceVibeLabels(ids: readonly string[]): string[] {
  return ids
    .map((id) => EXPERIENCE_VIBE_LABELS[id])
    .filter((label): label is string => typeof label === "string");
}

/**
 * ORCH-1186 Fix 1 — THE single adaptive availability banner, computed INSIDE the
 * shared body from the normalized data so EVERY surface (consumer + business/web)
 * shows identical, correct copy. Replaces the misleading "start" pill (soonest
 * occurrence start, wrong for open-daily) + the surface-only open-daily strip + the
 * fixed/single-date "dates" chip. The pure logic lives in the dep-free
 * `experienceAvailabilityBanner.ts` (deno-unit-tested); this thin wrapper adapts
 * the body's `ExperienceOfferingData` into that pure input.
 */
export function experienceAvailabilityBanner(
  data: ExperienceOfferingData,
): AvailabilityBanner | null {
  return computeAvailabilityBanner({
    openDaily: data.openDaily,
    occurrences: data.occurrences,
    timezone: data.timezone,
    bookable: data.bookable,
  });
}

/**
 * ONE combined all-in price label (WYSIWYP). NEVER a per-stop price. Displays the
 * server all-in (priceAllInCents) — never the bare base under an all-in caption
 * (orch-1153-no-bare-base). Free / no-ticket fall through.
 */
export function experiencePriceLabel(
  data: ExperienceOfferingData,
): { label: string; isFree: boolean } {
  const t = data.ticket;
  if (t === null) return { label: "Pricing TBD", isFree: false };
  if (t.isFree || t.priceCents === 0) return { label: "Free", isFree: true };
  const cents =
    typeof t.priceAllInCents === "number" && t.priceAllInCents > 0
      ? t.priceAllInCents
      : t.priceCents;
  try {
    return {
      label: new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: t.currency || "USD",
      }).format(cents / 100),
      isFree: false,
    };
  } catch {
    return { label: `${(cents / 100).toFixed(2)} ${t.currency}`, isFree: false };
  }
}

export interface ExperienceOfferingBodyProps {
  data: ExperienceOfferingData;
  brand: ExperienceOfferingBrand;
  palette: ThemePalette;
  theme: ResolvedTheme;
  callbacks: ExperienceOfferingCallbacks;
  variant: "phone" | "desktop";
  /**
   * Per-stop start-time → display label. The surface owns the device-locale 12h/24h
   * resolution (kept out of the pure package). undefined → no per-stop time pill.
   */
  formatStopTime?: (startTime: string | null) => string | null;
  /**
   * The "Open daily (hours)" availability strip — a surface-owned node injected
   * beneath the brand chip (route resolves the hours window). null → omitted.
   */
  availabilityBlock?: React.ReactNode | null;
  /**
   * The sold-out / ended / unavailable banner, a surface-owned node rendered above
   * the body content (after the meta/vibe chips). null → omitted.
   */
  stateBanner?: React.ReactNode | null;
  /**
   * Phone-only docked reserve node (the SAME <TripReserveBar variant="docked"> the
   * surface builds) — rendered as the LAST body child, flush. Desktop uses the
   * surface's sticky-panel reserve control instead.
   */
  dockedReserve?: React.ReactNode;
  /** Reduce-motion-aware collapse animation toggle. */
  reduceMotion?: boolean;
  testID?: string;
}

export const ExperienceOfferingBody: React.FC<ExperienceOfferingBodyProps> = ({
  data,
  brand,
  palette,
  theme,
  callbacks,
  variant,
  formatStopTime,
  availabilityBlock = null,
  stateBanner = null,
  dockedReserve,
  reduceMotion = false,
  testID,
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);
  const isDesktop = variant === "desktop";
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);

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

  const aboutText = (data.description ?? "").trim();
  const canCollapseAbout = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;

  const stopCount = data.stops.length;
  const stopEyebrow = stopCount > 0 ? `${stopCount}-stop experience` : null;

  const vibeLabels = experienceVibeLabels(data.intents);
  const { label: priceLabel, isFree } = experiencePriceLabel(data);
  // ORCH-1186 Fix 1 — the ONE adaptive availability banner (computed in-body so
  // consumer + business/web render identical copy; closes the consumer gap).
  const availability = experienceAvailabilityBanner(data);

  // First stop with coords → "Where you'll start" map (rule 9: no placeholder).
  const mapStop = data.stops.find((s) => s.lat !== null && s.lng !== null);
  const mapUrl =
    mapStop !== undefined && mapStop.lat !== null && mapStop.lng !== null
      ? buildStaticMapUrl({
          lat: mapStop.lat,
          lng: mapStop.lng,
          accentHex: palette.accent,
          height: isDesktop ? 300 : 180,
        })
      : null;

  const resolveStopTime = formatStopTime ?? (() => null);

  return (
    <View testID={testID}>
      {/* (2) N-stop eyebrow + title — phone only (desktop renders them in the hero). */}
      {!isDesktop ? (
        <View style={styles.leadBlock} testID="experience-body-title">
          {stopEyebrow !== null ? (
            <Text style={[styles.eyebrowLead, { color: palette.accent }]}>
              {stopEyebrow}
            </Text>
          ) : null}
          <Text style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}>
            {data.title}
          </Text>
        </View>
      ) : (
        <View testID="experience-body-title" />
      )}

      {/* (3) Meta chips — location · seats (rule 9). The dates + start-time chips
          were retired in ORCH-1186 Fix 1; that info now lives in the adaptive
          availability banner below (one source, all cases, every surface). */}
      {data.cityCountry !== null || data.seatsLabel !== null ? (
        <View style={styles.metaRow} testID="experience-body-meta">
          {data.cityCountry !== null ? (
            <MetaChip palette={palette} surface={surface} font={boldFamily} icon="location">
              {data.cityCountry}
            </MetaChip>
          ) : null}
          {data.seatsLabel !== null ? (
            <MetaChip palette={palette} surface={surface} font={boldFamily} icon="users">
              {data.seatsLabel}
            </MetaChip>
          ) : null}
        </View>
      ) : null}

      {/* (4) Vibe chips — canonical curated intents only (rule 9). */}
      {vibeLabels.length > 0 ? (
        <View style={styles.vibesRow} testID="experience-body-vibes">
          {vibeLabels.map((label) => (
            <View
              key={label}
              style={[
                styles.vibeChip,
                { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
              ]}
            >
              <Sparkles size={13} color={palette.accent} />
              {/* ORCH-1186 Fix 2 — label uses primaryText (icon stays accent) to
                  byte-match the standard trip/event MetaPill (no brown-on-brown). */}
              <Text
                style={[
                  styles.vibeChipText,
                  { color: palette.primaryText, fontFamily: boldFamily },
                ]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* state banner (sold-out / ended / unavailable) — surface-owned. */}
      {stateBanner !== null ? (
        <View testID="experience-body-state-banner">{stateBanner}</View>
      ) : null}

      {/* (5) Presented By. */}
      <View style={styles.section} testID="experience-body-presented-by">
        <Pressable
          onPress={callbacks.onViewBrand}
          disabled={callbacks.onViewBrand === undefined}
          accessibilityRole={callbacks.onViewBrand !== undefined ? "button" : undefined}
          accessibilityLabel={`View ${brand.name}`}
          style={[styles.brandRow, surface.card]}
        >
          <View
            style={[
              styles.brandTile,
              brand.coverMediaUrl === null ? { backgroundColor: palette.accent } : null,
            ]}
          >
            {brand.coverMediaUrl !== null ? (
              <EventCoverMedia
                mediaUrl={brand.coverMediaUrl}
                mediaType={brand.coverMediaType}
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
            ) : (
              <View style={styles.brandInitialWrap}>
                <Text
                  style={[
                    styles.brandInitial,
                    { color: palette.accentText, fontFamily: boldFamily },
                  ]}
                >
                  {(brand.name.trim()[0] ?? "•").toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.brandTextCol}>
            <Text style={[styles.brandKicker, surface.tertiaryText]}>Presented by</Text>
            <View style={styles.brandNameRow}>
              <Text
                style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {brand.name}
              </Text>
              {brand.verified ? <BadgeCheck size={15} color={palette.accent} /> : null}
            </View>
          </View>
          <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
        </Pressable>
      </View>

      {/* (6) Adaptive availability banner (ORCH-1186 Fix 1) — computed in-body from
          the normalized data so EVERY surface shows identical, correct copy. The
          surface-injected `availabilityBlock` is honored as a legacy override only
          if a surface still passes one (default null → the computed banner wins). */}
      {availabilityBlock !== null ? (
        <View testID="experience-body-availability">{availabilityBlock}</View>
      ) : availability !== null ? (
        <View
          style={[
            styles.availability,
            { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
          ]}
          testID="experience-body-availability"
        >
          <Clock size={18} color={palette.accent} />
          <View style={styles.availabilityTextCol}>
            <Text
              style={[styles.availabilityWhen, surface.primaryText, { fontFamily: boldFamily }]}
            >
              {availability.primary}
            </Text>
            {availability.sub !== null ? (
              <Text style={[styles.availabilitySub, { color: palette.tertiaryText }]}>
                {availability.sub}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* (7) About — collapsible (rule 9: only when present). */}
      {aboutText.length > 0 ? (
        <View style={styles.section} testID="experience-body-about">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            About this experience
          </Text>
          <Text
            style={[styles.about, surface.secondaryText]}
            numberOfLines={aboutCollapsedNow ? 3 : undefined}
            ellipsizeMode="tail"
          >
            {aboutText}
          </Text>
          {canCollapseAbout ? (
            <Pressable
              onPress={toggleAbout}
              accessibilityRole="button"
              accessibilityState={{ expanded: !aboutCollapsedNow }}
              accessibilityLabel={aboutCollapsedNow ? "Read more" : "Show less"}
              style={styles.aboutToggleRow}
            >
              <Text style={[styles.aboutToggle, { color: palette.accent }]}>
                {aboutCollapsedNow ? "Read more" : "Show less"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* (8) The itinerary — shared StopSpine (REAL authored stops, rule 9). */}
      {data.stops.length > 0 ? (
        <View style={styles.section} testID="experience-body-itinerary">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            The itinerary
          </Text>
          <StopSpine
            stops={data.stops}
            palette={palette}
            surface={surface}
            fontFamily={boldFamily}
            variant={variant}
            formatStopTime={resolveStopTime}
          />
        </View>
      ) : null}

      {/* (9) Where you'll start — stop-1 map (only when lat/lng present, rule 9). */}
      {mapStop !== undefined && mapUrl !== null ? (
        <View style={styles.section} testID="experience-body-map">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll start
          </Text>
          <View style={[styles.mapBlock, surface.card, { height: isDesktop ? 300 : 180 }]}>
            <Image
              source={{ uri: mapUrl }}
              style={styles.mapImage}
              resizeMode="cover"
              accessibilityLabel={`Map of ${mapStop.placeName ?? "the first stop"}`}
            />
            <MapPin size={26} color={palette.accent} />
            {mapStop.placeName !== null ? (
              <View style={[styles.mapCapPill, { backgroundColor: palette.page }]}>
                <Text style={[styles.mapCap, surface.primaryText]}>{mapStop.placeName}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* (10) Price card — ONE combined all-in price (phone inline; desktop in panel). */}
      {!isDesktop && data.ticket !== null ? (
        <View style={[styles.pricingCard, surface.card]} testID="experience-body-price-card">
          <Text style={[styles.pricingLabel, surface.secondaryText]}>
            {isFree ? "Price" : data.openDaily || data.occurrences.length > 1 ? "From" : "Price"}
          </Text>
          <Text
            style={[styles.pricingPrice, surface.primaryText, { fontFamily: boldFamily }]}
          >
            {priceLabel}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
        All-in price — taxes &amp; fees included, no surprises at checkout.
      </Text>

      {/* The phone-only DOCKED reserve CTA — the SAME shared bar the surface builds,
          rendered as the LAST body child (flush, no void). */}
      {!isDesktop && dockedReserve !== undefined ? dockedReserve : null}
    </View>
  );
};

// ---- meta chip ----
const MetaChip: React.FC<{
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  font: string;
  icon: "calendar" | "location" | "users" | "clock";
  children: React.ReactNode;
}> = ({ palette, surface, font, icon, children }) => {
  const Glyph =
    icon === "calendar"
      ? Calendar
      : icon === "location"
        ? MapPin
        : icon === "users"
          ? Users
          : Clock;
  return (
    <View style={[styles.metaChip, surface.card]}>
      <Glyph size={15} color={palette.accent} />
      <Text
        style={[styles.metaChipText, surface.secondaryText, { fontFamily: font }]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  leadBlock: { marginBottom: 4 },
  eyebrowLead: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
  // ---- meta chips ----
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
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
  vibesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  vibeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  vibeChipText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
  // ---- availability banner (ORCH-1186 Fix 1) ----
  availability: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  availabilityTextCol: { flexShrink: 1 },
  availabilityWhen: { fontSize: 15, fontWeight: "800" },
  availabilitySub: { fontSize: 12, marginTop: 2 },
  // ---- sections ----
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  about: { fontSize: 16, lineHeight: 23 },
  aboutToggleRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  aboutToggle: { fontSize: 14, fontWeight: "700" },
  // ---- brand ----
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
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1, flexGrow: 1 },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandNameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  brandName: { fontSize: 15, fontWeight: "800" },
  brandCta: { marginLeft: "auto", fontSize: 12, fontWeight: "800" },
  // ---- map ----
  mapBlock: {
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
  // ---- price card ----
  pricingCard: {
    marginTop: 24,
    padding: 18,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  pricingLabel: { fontSize: 13 },
  pricingPrice: { fontSize: 24, fontWeight: "900" },
  reassure: { fontSize: 12, marginTop: 20, lineHeight: 17 },
});

export default ExperienceOfferingBody;
