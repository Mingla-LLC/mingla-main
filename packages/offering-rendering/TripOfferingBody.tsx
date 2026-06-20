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

      {/* (3) Travel dates · Leaving-from · Destination — FULL-WIDTH PILLS. */}
      <View testID="trip-body-route-pills">
        {data.dateRangeLabel.length > 0 ? (
          <View
            style={[
              styles.fullPill,
              { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
            ]}
          >
            <Text style={[styles.fullPillGlyph, { color: palette.accent }]}>📅</Text>
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
        {data.departureCityCountry !== null ? (
          <View
            style={[
              styles.fullPill,
              { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
            ]}
          >
            <Text style={[styles.fullPillGlyph, { color: palette.accent }]}>✈</Text>
            <Text
              style={[
                styles.fullPillText,
                { color: palette.primaryText, fontFamily: boldFamily },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Leaving from {data.departureCityCountry}
            </Text>
          </View>
        ) : null}
        {data.destinationCityCountry !== null ? (
          <View
            style={[
              styles.fullPill,
              { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
            ]}
          >
            <Text style={[styles.fullPillGlyph, { color: palette.accent }]}>📍</Text>
            <Text
              style={[
                styles.fullPillText,
                { color: palette.primaryText, fontFamily: boldFamily },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {data.destinationCityCountry}
            </Text>
          </View>
        ) : null}
      </View>

      {/* (4) Pills row — days&nights · spots-left · animated live countdown. */}
      <View style={styles.pillsRow} testID="trip-body-meta-pills">
        {data.durationLabel !== null ? (
          <Pill palette={palette} font={boldFamily}>
            ⏱ {data.durationLabel}
          </Pill>
        ) : null}
        {data.spotsLabel !== null ? (
          <Pill palette={palette} font={boldFamily}>
            👥 {data.spotsLabel}
          </Pill>
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
                <Text style={[styles.brandVerifiedGlyph, { color: palette.accent }]}>
                  ✓
                </Text>
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

      {/* (10) Choose how you pay — the §10 reserve box (Leg A: single tier). The
          inline box + the bar read the SAME `state`, so they never disagree. */}
      <View style={styles.section} testID="trip-body-pay-box">
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
          Choose how you pay
        </Text>

        {/* The shared payment-plan toggle (renders only for a plan tier). */}
        {state.projectedSchedule !== null && state.isClosed === false ? (
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
        ) : state.selectedTier !== null ? (
          // No-plan trip → quiet price recap (DESIGN §D wireframe 3).
          <View style={[styles.recapCard, surface.card]}>
            <View style={styles.recapRow}>
              <Text
                style={[styles.recapTierName, surface.secondaryText]}
                numberOfLines={1}
              >
                {state.selectedTier.tierName}
              </Text>
              <Text style={[styles.recapPrice, surface.primaryText, { fontFamily: boldFamily }]}>
                {boxPriceLabel ?? "—"}
              </Text>
            </View>
            <Text style={[styles.recapHelper, surface.tertiaryText]}>
              One secure payment. Stripe handles it; we never see your card.
            </Text>
          </View>
        ) : null}

        {/* The real selection box — single tier, live all-in total, in-box CTA. The
            box's container is a vertical list slot (Leg B drops N tier rows here —
            SPEC §D.2). Tapping fires callbacks.onReserve (route push / open cart). */}
        {state.selectedTier !== null ? (
          <View
            style={[styles.selectBox, surface.card]}
            testID="trip-body-select-box"
          >
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

const Pill: React.FC<{
  palette: ThemePalette;
  font: string;
  children: React.ReactNode;
}> = ({ palette, font, children }) => (
  <View
    style={[
      styles.pill,
      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
    ]}
  >
    <Text style={[styles.pillText, { color: palette.primaryText, fontFamily: font }]}>
      {children}
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
  fullPillGlyph: { fontSize: 16, fontWeight: "900" },
  fullPillText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  // ---- §4 meta pills ----
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
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
  brandVerifiedGlyph: { fontSize: 13, fontWeight: "900" },
  brandCta: { marginLeft: "auto", fontSize: 12, fontWeight: "800" },
  // ---- §10 box ----
  recapCard: { borderRadius: 16, padding: 14, marginBottom: 12 },
  recapRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  recapTierName: { flexShrink: 1, fontSize: 13 },
  recapPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  recapHelper: { fontSize: 12, marginTop: 8, textAlign: "center" },
  selectBox: { borderRadius: 18, padding: 14, marginTop: 12 },
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
