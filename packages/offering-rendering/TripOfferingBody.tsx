/**
 * TripOfferingBody — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * Trip leg of META-ORCH-1166 (public offering-page single source of truth). THE ONE
 * shared, shell-agnostic body for the public TRIP page (event_type='trip'). Rendered
 * byte-identically on buyer-web + business iOS/Android + consumer iOS/Android.
 * Promotes the forked FoundationTripPreview (web/business) + ConsumerTripDetailScreen
 * hand-mirrored body (consumer) into ONE component. Mirrors ORCH-1167's
 * EventOfferingBody + ORCH-1163's RsvpOfferingBody.
 *
 * SHELL-AGNOSTIC (mandatory, gorhom-safe — SPEC §C.1/§E.2): this is a PURE CONTENT
 * body. It hosts NO scroll root and NO cover host. It returns a plain <View> of
 * sections 2→11; it MUST NOT render a ScrollView/BottomSheetScrollView. Each surface
 * composes its own scroll + parallax-cover scaffold AROUND this body:
 *   • buyer-web + business native → inside ParallaxCoverShell (RN ScrollView).
 *   • consumer → inside BaseBottomSheet's gorhom BottomSheetScrollView (the
 *     load-bearing ORCH-1016/1043 structure — never wrap ParallaxCoverShell here).
 * The cover (§1) is a pinned sibling the surface owns; the floating reserve button
 * (§12) is the shared <TripReserveBar variant="floating"> the surface pins (zIndex 6).
 *
 * Pure-presentational, props-only, NO app-src imports (I-MOR-0827-PACKAGE-ISOLATION).
 * All data via `data`/`brand`; all actions via `callbacks`; all buy-state via
 * `state` (the lifted useTripOfferingState — one owner, the inline box + bars agree).
 *
 * Seth-LOCKED canonical section order (SPEC §A.2):
 *   1.  Cover               (surface-pinned sibling — NOT here)
 *   2.  Event name (title)  (+ duration·destination eyebrow on phone)
 *   3.  Travel dates · Leaving-from · Destination — FULL-WIDTH PILLS
 *   4.  Pills row           (days&nights · spots-left · animated countdown)
 *   5.  Presented By        (brand cover + name + optional verified tick)
 *   6.  About               (collapsible — FOLDED here per Seth)
 *   7.  Itinerary           (shared DayByDay spine)
 *   8.  What's included / NOT
 *   9.  Cancellation policy (shared TripRefundLadder)
 *   10. Choose how you pay  (§10 reserve box — TripPaymentChoice + selection box)
 *   11. Where you'll be     (destination map — FOLDED here per Seth; lat/lng-gated)
 *   12. Floating button     (surface-pinned sibling — NOT here)
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
import { ChipGroup, type Chip } from "./ChipGroup";
import { DayByDay } from "./DayByDay";
import { TripRefundLadder } from "./TripRefundLadder";
import { TripPaymentChoice } from "./TripPaymentChoice";
import { TripCountdownPill } from "./TripCountdownPill";
import { BadgeCheck, Calendar, Moon, Plane, Users } from "./LucideIcons";
import { buildStaticMapUrl } from "./mapboxStaticImage";
import type {
  TripOfferingBrand,
  TripOfferingCallbacks,
  TripOfferingData,
} from "./tripOfferingTypes";
import type { TripOfferingState, TripPaymentPlanChoice } from "./useTripOfferingState";

const ABOUT_COLLAPSE_THRESHOLD = 160;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface TripOfferingBodyProps {
  data: TripOfferingData;
  brand: TripOfferingBrand;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The SHARED buy-state machine (the §10 box + the bars all read it). */
  state: TripOfferingState;
  callbacks: TripOfferingCallbacks;
  variant: "phone" | "desktop";
  /** The live pay-full/pay-over-time toggle value (the surface owns the useState). */
  paymentPlanChoice: TripPaymentPlanChoice;
  onPaymentPlanChoiceChange: (value: TripPaymentPlanChoice) => void;
  /**
   * Phone-only docked reserve node (the SAME <TripReserveBar variant="docked"> the
   * surface builds) — passed in so it renders as the LAST body child, flush beneath
   * §10. Desktop uses the surface's sticky-panel reserve control instead.
   */
  dockedReserve?: React.ReactNode;
  /**
   * Reduce-motion-aware collapse animation toggle. The surface passes its resolved
   * reduce-motion flag so the About collapse skips the height settle when on.
   */
  reduceMotion?: boolean;
  testID?: string;
}

export const TripOfferingBody: React.FC<TripOfferingBodyProps> = ({
  data,
  brand,
  palette,
  theme,
  state,
  callbacks,
  variant,
  paymentPlanChoice,
  onPaymentPlanChoiceChange,
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

  const includedChips: Chip[] = data.inclusions
    .filter((i) => i.kind === "included")
    .map((i) => ({ label: i.item, variant: "yes" }));
  const excludedChips: Chip[] = data.inclusions
    .filter((i) => i.kind === "excluded")
    .map((i) => ({ label: i.item, variant: "no" }));

  const aboutText = (data.description ?? "").trim();
  const canCollapseAbout = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;

  const eyebrow =
    data.durationLabel !== null
      ? `${data.durationLabel}${
          data.destinationCityCountry !== null
            ? ` · ${data.destinationCityCountry}`
            : ""
        }`
      : data.destinationCityCountry;

  // (3) ONE continuous route pill — "From {departure} → {destination}" (Leg A.3
  // bug #2). When only one leg resolves we render that single leg honestly
  // (rule 9 — never fabricate the missing side); null hides the route pill.
  const routeLabel: string | null =
    data.departureCityCountry !== null && data.destinationCityCountry !== null
      ? `From ${data.departureCityCountry} → ${data.destinationCityCountry}`
      : data.departureCityCountry !== null
        ? `From ${data.departureCityCountry}`
        : data.destinationCityCountry !== null
          ? data.destinationCityCountry
          : null;

  const mapUrl =
    data.destinationLat !== null && data.destinationLng !== null
      ? buildStaticMapUrl({
          lat: data.destinationLat,
          lng: data.destinationLng,
          accentHex: palette.accent,
          height: isDesktop ? 300 : 180,
        })
      : null;

  const reserveTappable = state.cta.tappable;
  const boxPriceLabel =
    state.cta.kind === "buy"
      ? state.barPriceLabel
      : state.cta.kind === "free"
        ? "Free"
        : null;

  return (
    <View testID={testID}>
      {/* (2) Event name — phone shows eyebrow + title; desktop renders them in the
          surface hero, so the body title is phone-only. */}
      {!isDesktop ? (
        <View style={styles.leadBlock} testID="trip-body-title">
          {eyebrow !== null && eyebrow.length > 0 ? (
            <Text style={[styles.eyebrowLead, surface.primaryText]}>{eyebrow}</Text>
          ) : null}
          <Text
            style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}
          >
            {data.title}
          </Text>
        </View>
      ) : (
        <View testID="trip-body-title" />
      )}

      {/* (3) Travel dates · From→To route — FULL-WIDTH PILLS (Seth device fix,
          Leg A.3 bug #2): the travel-dates is its own full-width pill, and
          departure→destination is ONE continuous full-width pill (NOT two
          separate blocks) reading "From {departure} → {destination}". */}
      <View testID="trip-body-route-pills">
        {data.dateRangeLabel.length > 0 ? (
          <View
            style={[
              styles.fullPill,
              { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
            ]}
          >
            <Calendar size={17} color={palette.accent} />
            <Text
              style={[
                styles.fullPillText,
                { color: palette.primaryText, fontFamily: boldFamily },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {data.dateRangeLabel}
            </Text>
          </View>
        ) : null}
        {routeLabel !== null ? (
          <View
            style={[
              styles.fullPill,
              { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
            ]}
            testID="trip-body-route-pill"
          >
            <Plane size={17} color={palette.accent} />
            <Text
              style={[
                styles.fullPillText,
                { color: palette.primaryText, fontFamily: boldFamily },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {routeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {/* (4) Pills row — days&nights · spots-left · animated live countdown.
          Leg A.4: the days&nights + seats-left pills are now COMPACT (tighter
          padding/font + a lucide icon) so they sit side-by-side on ONE line
          instead of stacking; the live countdown wraps after them as before. */}
      <View style={styles.pillsRow} testID="trip-body-meta-pills">
        {data.durationLabel !== null ? (
          <MetaPill
            palette={palette}
            font={boldFamily}
            icon={<Moon size={13} color={palette.accent} />}
            label={data.durationLabel}
          />
        ) : null}
        {data.spotsLabel !== null ? (
          <MetaPill
            palette={palette}
            font={boldFamily}
            icon={<Users size={13} color={palette.accent} />}
            label={data.spotsLabel}
          />
        ) : null}
        {data.bookingDeadlineIso !== null && !data.bookingsClosed ? (
          <TripCountdownPill
            deadlineIso={data.bookingDeadlineIso}
            palette={palette}
            fontFamily={boldFamily}
            testID="trip-body-countdown-pill"
          />
        ) : null}
      </View>

      {/* (5) Presented By. */}
      <View style={styles.section} testID="trip-body-presented-by">
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
              brand.coverMediaUrl === null
                ? { backgroundColor: palette.accent }
                : null,
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
              {brand.verified ? (
                <BadgeCheck size={15} color={palette.accent} />
              ) : null}
            </View>
          </View>
          {callbacks.onViewBrand !== undefined ? (
            <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
          ) : null}
        </Pressable>
      </View>

      {/* (6) About — collapsible, FOLDED here per Seth (after Presented-By). */}
      {aboutText.length > 0 ? (
        <View style={styles.section} testID="trip-body-about">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            About this trip
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

      {/* (7) Itinerary — shared DayByDay spine. */}
      {data.days.length > 0 ? (
        <View style={styles.section} testID="trip-body-itinerary">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Day by day
          </Text>
          <DayByDay
            days={data.days}
            palette={palette}
            surface={surface}
            fontFamily={boldFamily}
            variant={variant}
          />
        </View>
      ) : null}

      {/* (8) What's included. */}
      {includedChips.length > 0 ? (
        <View style={styles.section} testID="trip-body-included">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            What&rsquo;s included
          </Text>
          <ChipGroup chips={includedChips} palette={palette} />
        </View>
      ) : null}

      {/* (8) What's NOT included. */}
      {excludedChips.length > 0 ? (
        <View style={styles.section} testID="trip-body-excluded">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            What&rsquo;s not included
          </Text>
          <ChipGroup chips={excludedChips} palette={palette} />
        </View>
      ) : null}

      {/* (9) Cancellation policy — shared TripRefundLadder (renders its own heading). */}
      <View testID="trip-body-cancellation">
        <TripRefundLadder
          policy={data.refundPolicy}
          bookingDeadline={data.bookingDeadlineIso}
          palette={palette}
          surface={surface}
          fontFamily={boldFamily}
        />
      </View>

      {/* (10) Choose how you pay — ONE merged §10 reserve box (Leg A.3 bug #5: the
          prior duplicate "payment-choice" box AND separate "reserve" box are now a
          SINGLE box — payment-plan toggle (plan tiers) + the live price row + the
          in-box Reserve CTA. The box + the docked/floating bars read the SAME
          `state`, so they never disagree. Leg B drops N tier rows into this same
          selectBox slot — the multi-tier seam is intact.) */}
      <View style={styles.section} testID="trip-body-pay-box">
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
          Choose how you pay
        </Text>

        {state.selectedTier !== null ? (
          <View
            style={[styles.selectBox, surface.card]}
            testID="trip-body-select-box"
          >
            {/* The shared pay-full / pay-over-time toggle (plan tiers, open only).
                Tapping drives `paymentPlanChoice` (Leg A.3 bug #4) → the price row
                + the CTA below + the docked/floating bar all update live. */}
            {state.projectedSchedule !== null && state.isClosed === false ? (
              <View style={styles.payChoiceWrap}>
                <TripPaymentChoice
                  schedule={state.projectedSchedule}
                  currency={data.currency}
                  depositPct={0}
                  value={paymentPlanChoice}
                  onChange={onPaymentPlanChoiceChange}
                  palette={palette}
                  fontFamily={boldFamily}
                  testID="trip-body-payment-choice"
                />
              </View>
            ) : null}

            <View style={styles.selectRow}>
              <Text
                style={[styles.selectTierName, surface.primaryText, { fontFamily: boldFamily }]}
                numberOfLines={1}
              >
                {state.selectedTier.tierName}
              </Text>
              <Text
                style={[styles.selectPrice, surface.primaryText, { fontFamily: boldFamily }]}
                testID="trip-body-select-total"
              >
                {boxPriceLabel ?? "—"}
              </Text>
            </View>
            <Pressable
              onPress={reserveTappable ? () => callbacks.onReserve() : undefined}
              disabled={!reserveTappable}
              accessibilityRole="button"
              accessibilityState={{ disabled: !reserveTappable }}
              accessibilityLabel={
                state.cta.kind === "unavailable" ? state.cta.title : "Reserve my spot"
              }
              style={[
                styles.boxProceed,
                reserveTappable
                  ? { backgroundColor: palette.accent }
                  : {
                      backgroundColor: palette.card,
                      borderColor: palette.panelBorder,
                      borderWidth: 1,
                    },
              ]}
              testID="trip-body-box-proceed"
            >
              <Text
                style={[
                  styles.boxProceedText,
                  {
                    color: reserveTappable ? palette.accentText : palette.tertiaryText,
                    fontFamily: boldFamily,
                  },
                ]}
              >
                {state.cta.kind === "unavailable"
                  ? state.cta.title
                  : boxPriceLabel !== null && boxPriceLabel !== "Free"
                    ? `Reserve · ${boxPriceLabel}`
                    : "Reserve my spot"}
              </Text>
            </Pressable>
            <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
              All-in price — taxes &amp; fees included, no surprises at checkout.
            </Text>
          </View>
        ) : null}
      </View>

      {/* (11) Where you'll be — destination map, FOLDED here per Seth (after §9/§10).
          Rule 9: only when real lat/lng resolve a proxy URL. */}
      {data.destinationLat !== null && data.destinationLng !== null && mapUrl !== null ? (
        <View style={styles.section} testID="trip-body-map">
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll be
          </Text>
          <View
            style={[
              styles.mapBlock,
              surface.card,
              { height: isDesktop ? 300 : 180 },
            ]}
          >
            <Image
              source={{ uri: mapUrl }}
              style={styles.mapImage}
              resizeMode="cover"
              accessibilityLabel={`Map of ${data.destinationText ?? "the destination"}`}
            />
            <View style={[styles.mapCapPill, { backgroundColor: palette.page }]}>
              <Text style={[styles.mapCap, surface.primaryText]}>
                {data.destinationText ?? "Destination"}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* The phone-only DOCKED reserve CTA — the SAME <TripReserveBar variant="docked">
          the surface builds, rendered as the LAST body child (flush, no void). */}
      {!isDesktop && dockedReserve !== undefined ? dockedReserve : null}
    </View>
  );
};

// Leg A.4 — the §4 meta pill: a COMPACT icon + label row (tighter padding/font
// than the §3 full-width pills) so days&nights + seats-left sit side-by-side on
// ONE line. The lucide icon replaces the prior leading emoji glyph.
const MetaPill: React.FC<{
  palette: ThemePalette;
  font: string;
  icon: React.ReactNode;
  label: string;
}> = ({ palette, font, icon, label }) => (
  <View
    style={[
      styles.pill,
      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
    ]}
  >
    {icon}
    <Text
      style={[styles.pillText, { color: palette.primaryText, fontFamily: font }]}
      numberOfLines={1}
    >
      {label}
    </Text>
  </View>
);

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
  // ---- §3 full-width pills ----
  fullPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  fullPillText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  // ---- §4 meta pills (Leg A.4: COMPACT icon+label row — tighter padding/font so
  //      days&nights + seats-left sit side-by-side on one line) ----
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { fontSize: 12, fontWeight: "700" },
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
  // ---- §10 box (ONE merged box: payment toggle + price row + reserve CTA) ----
  selectBox: { borderRadius: 18, padding: 14, marginTop: 12 },
  // The payment-plan toggle sits ATOP the price row inside the same box.
  payChoiceWrap: { marginBottom: 14 },
  selectRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  selectTierName: { flexShrink: 1, fontSize: 15, fontWeight: "800" },
  selectPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  boxProceed: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 14,
  },
  boxProceedText: { fontSize: 16, fontWeight: "900" },
  reassure: { fontSize: 12, marginTop: 12, lineHeight: 17, textAlign: "center" },
  // ---- §11 map ----
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
});

export default TripOfferingBody;
