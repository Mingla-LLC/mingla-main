/**
 * FoundationEventPreview — ORCH-1138 Leg 2 (public EVENT page, Direction A).
 *
 * The buyer-web + business in-app FOUNDATION render for the public event page,
 * mirroring the SHIPPED trip leg's `TripPreview` FoundationTripPreview 1:1 — but
 * for the EVENT model. Composes the shared @mingla/offering-rendering
 * `ParallaxCoverShell` (pinned parallax cover, body-level fixed X·Share·Mute
 * chrome, responsive desktop sticky panel) around a body that renders ONLY real
 * event fields (rule 9): date eyebrow + title, meta chips, brand chip, About,
 * "Where you'll be" venue card, a SELECTABLE ticket-TIER radiogroup as the spine,
 * + the float→dock single CTA (the adapter builds the bars from the SAME
 * resolveOfferingCta state).
 *
 * WHY this lives in the APP layer (not the shared packages/event-rendering): the
 * shared event renderer is a DEPENDENCY of @mingla/offering-rendering (offering-
 * rendering imports offeringSurfaceStyles/ThemePalette FROM event-rendering). If
 * the event-rendering PACKAGE imported offering-rendering, that inverts the edge
 * into a runtime circular dependency (proven on the iOS sim: "Cannot read property
 * 'offeringSurfaceStyles' of undefined" at module init). So — exactly like the
 * trip leg's FoundationTripPreview — the FOUNDATION composition lives in the app
 * layer, which imports BOTH packages freely. The shared PublicEventPage stays
 * BYTE-IDENTICAL to origin/main (its LEGACY stacked render), so EBES's experience
 * mount + chat are provably unaffected (N1 / SC-9).
 *
 * NO refund-ladder / booking-deadline / itinerary / route / pay-toggle / split-CTA
 * — the event model has none (N2 / N3 / N4 / rule 9). The map is rule-9 OMITTED:
 * the public event read carries no venue lat/lng (the view never selected
 * location_geo), so the venue CARD renders without a fabricated tile.
 *
 * Anon-tolerant: no useAuth, no fetch. Pure presentational; the adapter owns
 * state + checkout. Android: opaque glass via the foundation primitives.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  boldFontFamily,
  offeringSurfaceStyles,
  type PublicBrandProps,
  type PublicEventProps,
  type PublicTicketProps,
  type ResolvedTheme,
  type ThemePalette,
  ticketIsDoorOnly,
  ticketIsSoldOut,
  ticketSaleEnded,
} from "@mingla/event-rendering";
import {
  ParallaxCoverShell,
  normalizeCityCountry,
  useResponsiveLayout,
} from "@mingla/offering-rendering";

import { Icon } from "../ui/Icon";

const ABOUT_COLLAPSE_THRESHOLD = 160;
const SHOW_INITIAL_DATES = 10;

// Enable LayoutAnimation on Android once at module load (no-op on iOS/web).
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const sortTickets = (tickets: PublicTicketProps[]): PublicTicketProps[] =>
  [...tickets].sort((a, b) => a.displayOrder - b.displayOrder);

const formatTicketPrice = (
  ticket: PublicTicketProps,
  fallbackCurrency: string,
): string => {
  if (ticket.isFree) return "Free";
  const price = ticket.priceAllInGbp ?? ticket.priceGbp;
  if (price === null || price === undefined) return "—";
  const currency = ticket.currency ?? fallbackCurrency;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
};

export interface FoundationEventPreviewProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  variant: "published" | "pre-sale" | "sold-out" | "past";
  palette: ThemePalette;
  theme: ResolvedTheme;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  stateBanner?: React.ReactNode | null;
  stickyPanel?: React.ReactNode | null;
  dockedReserve?: React.ReactNode;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  contentBottomInset?: number;
  /** Selected tier id (FOUNDATION radiogroup). null → none selected yet. */
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
  testID?: string;
}

export const FoundationEventPreview: React.FC<FoundationEventPreviewProps> = ({
  event,
  brand,
  variant,
  palette,
  theme,
  muted,
  onToggleMute,
  onClose,
  onShare,
  onOpenBrand,
  onOpenMaps,
  stateBanner = null,
  stickyPanel = null,
  dockedReserve,
  onScroll,
  onScrollViewLayout,
  safeAreaTop = 0,
  contentBottomInset = 0,
  selectedTicketId,
  onSelectTicket,
  testID,
}) => {
  const { isDesktop } = useResponsiveLayout();
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const toggleAbout = useCallback((): void => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        200,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setAboutCollapsed((c) => !c);
  }, []);

  const coverType: "image" | "video" | "gif" | null =
    event.coverMediaType === "video"
      ? "video"
      : event.coverMediaType === "gif"
        ? "gif"
        : event.coverMediaUrl !== null
          ? "image"
          : null;

  const cityCountry =
    normalizeCityCountry(event.venueName) ??
    normalizeCityCountry(event.address);

  const visibleTickets = useMemo(
    () => sortTickets(event.tickets.filter((t) => t.visibility !== "hidden")),
    [event.tickets],
  );

  const capacityChip = useMemo<string | null>(() => {
    let total = 0;
    let anyFinite = false;
    for (const t of visibleTickets) {
      if (t.isUnlimited) continue;
      if (t.capacity !== null) {
        total += t.capacity;
        anyFinite = true;
      }
    }
    if (!anyFinite) return null;
    return total <= 0 ? "Sold out" : `${total} tickets left`;
  }, [visibleTickets]);

  // ORCH-1157 Round-6 [rsvp-public-redesign] — when the street is hidden show the
  // City/Country line (real city) as the sub-line, with the unlock caption beneath
  // it (standardized below). The legacy "Address shared after ticket purchase"
  // remains only as the last-resort fallback when there is no city to show.
  const venueAddressLabel = event.hideAddressUntilTicket
    ? (cityCountry ?? "Address shared after you get tickets")
    : event.format === "hybrid" && event.address !== null
      ? `${event.address} · also online`
      : (event.address ?? "Address shared after you get tickets");
  // The caption telling the buyer HOW to unlock the exact street; renders ONLY
  // while the street is hidden. This is the TICKETED page → "after you get
  // tickets" (must never say "RSVP"). Static helper text.
  const addressUnlockCaption: string | null = event.hideAddressUntilTicket
    ? "Full address shared after you get tickets"
    : null;
  const venueMapsQuery =
    event.hideAddressUntilTicket || event.venueName === null
      ? null
      : [event.venueName, event.address].filter(Boolean).join(", ");
  const canOpenVenueMaps =
    venueMapsQuery !== null &&
    venueMapsQuery.trim().length > 0 &&
    onOpenMaps !== undefined;

  const aboutText = event.description.trim();
  const canCollapseAbout = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;
  void variant;

  const brandChip = (
    <Pressable
      onPress={() => {
        if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
      }}
      disabled={brand?.slug === undefined || onOpenBrand === undefined}
      accessibilityRole={onOpenBrand !== undefined ? "button" : undefined}
      accessibilityLabel={
        brand?.displayName !== undefined ? `View ${brand.displayName}` : "View brand"
      }
      style={[styles.brandRow, surface.card]}
    >
      <View style={[styles.brandTile, { backgroundColor: palette.accent }]}>
        {brand?.photo !== undefined && brand.photo.length > 0 ? (
          <Image
            source={{ uri: brand.photo }}
            style={styles.brandPhoto}
            resizeMode="cover"
            accessibilityLabel={`${brand.displayName ?? "Brand"} profile photo`}
          />
        ) : (
          <View style={styles.brandInitialWrap}>
            <Text style={[styles.brandInitial, { color: palette.accentText, fontFamily: boldFamily }]}>
              {(brand?.displayName?.trim()[0] ?? "•").toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.brandTextCol}>
        <Text style={[styles.brandKicker, surface.tertiaryText]}>Presented by</Text>
        <Text style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}>
          {brand?.displayName ?? "Brand"}
        </Text>
      </View>
      {onOpenBrand !== undefined ? (
        <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
      ) : null}
    </Pressable>
  );

  const left = (
    <View>
      {!isDesktop ? (
        <View style={styles.leadBlock}>
          {event.dateLine.length > 0 ? (
            <Text style={[styles.eyebrow, { color: palette.accent }]}>
              {event.dateLine}
            </Text>
          ) : null}
          <Text style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}>
            {event.name.length > 0 ? event.name : "Untitled event"}
          </Text>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        {event.dateLine.length > 0 ? (
          <MetaChip palette={palette} surface={surface} glyph="◷" font={boldFamily}>
            {event.dateLine}
          </MetaChip>
        ) : null}
        {event.dateSubline !== null && event.dateSubline.length > 0 ? (
          <MetaChip palette={palette} surface={surface} glyph="⟳" font={boldFamily}>
            {event.dateSubline}
          </MetaChip>
        ) : null}
        {capacityChip !== null ? (
          <MetaChip palette={palette} surface={surface} glyph="◍" font={boldFamily}>
            {capacityChip}
          </MetaChip>
        ) : null}
        {cityCountry !== null ? (
          <MetaChip palette={palette} surface={surface} glyph="⌖" font={boldFamily}>
            {cityCountry}
          </MetaChip>
        ) : null}
      </View>

      {event.datesList.length > 1 ? (
        <View style={styles.datesWrap}>
          <Pressable
            onPress={() => setShowAllDates((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={
              showAllDates ? "Hide dates" : `Show all ${event.datesList.length} dates`
            }
            style={[styles.datesToggle, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
          >
            <Text style={[styles.datesToggleText, { color: palette.primaryText }]}>
              {showAllDates ? "Hide dates" : `Show all ${event.datesList.length} dates`}
            </Text>
          </Pressable>
          {showAllDates
            ? event.datesList.slice(0, SHOW_INITIAL_DATES).map((label, i) => (
                <View
                  key={i}
                  style={[styles.dateRow, { backgroundColor: palette.card, borderColor: palette.cutoutBorder }]}
                >
                  <Text style={[styles.dateRowText, { color: palette.primaryText }]}>{label}</Text>
                </View>
              ))
            : null}
        </View>
      ) : null}

      {!isDesktop ? brandChip : null}

      {aboutText.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>About</Text>
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

      {/* Where you'll be — venue card (map rule-9 OMITTED: no geo on the read) */}
      {event.format === "online" ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll be
          </Text>
          <View style={[styles.venueCard, surface.card]}>
            <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
              <Text style={[styles.venueGlyph, { color: palette.accentText }]}>◯</Text>
            </View>
            <View style={styles.venueTextCol}>
              <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>Online</Text>
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                Conferencing link shared with ticketed guests.
              </Text>
            </View>
          </View>
        </View>
      ) : event.venueName !== null ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll be
          </Text>
          <Pressable
            onPress={() => {
              if (venueMapsQuery !== null) onOpenMaps?.(venueMapsQuery);
            }}
            disabled={!canOpenVenueMaps}
            accessibilityRole={canOpenVenueMaps ? "button" : undefined}
            accessibilityLabel={canOpenVenueMaps ? `Open ${event.venueName} in maps` : event.venueName}
            style={[styles.venueCard, surface.card]}
          >
            <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
              <Text style={[styles.venueGlyph, { color: palette.accentText }]}>⌖</Text>
            </View>
            <View style={styles.venueTextCol}>
              <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>
                {event.venueName}
              </Text>
              <Text style={[styles.venueAddr, surface.secondaryText]}>{venueAddressLabel}</Text>
              {/* ORCH-1157 Round-6 — unlock caption UNDER the city; only while the
                  exact street is hidden (ticketed copy, never "RSVP"). */}
              {addressUnlockCaption !== null ? (
                <Text
                  style={[styles.venueUnlockCaption, surface.tertiaryText]}
                  testID="orch-1157-ticketed-address-unlock-caption"
                >
                  {addressUnlockCaption}
                </Text>
              ) : null}
            </View>
            {canOpenVenueMaps ? (
              <View style={[styles.venuePill, { backgroundColor: palette.accent }]}>
                <Text style={[styles.venuePillText, { color: palette.accentText }]}>Open maps</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {/* Tickets — the SELECTABLE tier radiogroup (the page spine) */}
      <View style={styles.section}>
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
          {isDesktop ? "Tickets" : "Choose your ticket"}
        </Text>
        {visibleTickets.length === 0 ? (
          <View style={[styles.venueCard, surface.card]}>
            <Text style={[styles.about, surface.secondaryText]}>No tickets available yet.</Text>
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.tierCol}>
            {visibleTickets.map((t) => (
              <FoundationTierRow
                key={t.id}
                ticket={t}
                fallbackCurrency={event.currency}
                palette={palette}
                surface={surface}
                boldFamily={boldFamily}
                selected={selectedTicketId === t.id}
                onSelect={onSelectTicket}
              />
            ))}
          </View>
        )}
        <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
          All-in price — taxes &amp; fees included, no surprises at checkout.
        </Text>
      </View>

      {!isDesktop && dockedReserve !== undefined ? dockedReserve : null}
    </View>
  );

  return (
    <ParallaxCoverShell
      palette={palette}
      theme={theme}
      coverMediaUrl={event.coverMediaUrl}
      coverMediaType={coverType}
      coverHue={event.coverHue}
      entranceAnimationKey={`event:${event.id}`}
      muted={muted}
      onToggleMute={onToggleMute}
      showMute={coverType === "video"}
      onClose={onClose}
      onShare={onShare}
      // ORCH-1159 — hide the floating X on web (public event page; no parent
      // screen to return to for an anonymous share-link visitor). Native keeps
      // it; Share is unaffected.
      hideCloseOnWeb
      heroEyebrow={
        event.dateLine.length > 0 ? (
          <Text style={styles.heroEyebrow}>{event.dateLine}</Text>
        ) : undefined
      }
      heroTitle={
        <Text style={[styles.heroTitle, { fontFamily: boldFamily }]}>
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
      }
      stateBanner={stateBanner}
      stickyPanel={stickyPanel}
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      onScroll={onScroll}
      onScrollViewLayout={onScrollViewLayout}
      testID={testID}
    >
      {left}
    </ParallaxCoverShell>
  );
};

const MetaChip: React.FC<{
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  glyph: string;
  font: string;
  children: React.ReactNode;
}> = ({ palette, surface, glyph, font, children }) => (
  <View style={[styles.metaChip, surface.card]}>
    <Text style={[styles.metaGlyph, { color: palette.accent }]}>{glyph}</Text>
    <Text style={[styles.metaText, surface.secondaryText, { fontFamily: font }]}>
      {children}
    </Text>
  </View>
);

const FoundationTierRow: React.FC<{
  ticket: PublicTicketProps;
  fallbackCurrency: string;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  selected: boolean;
  onSelect: (ticketId: string) => void;
}> = ({ ticket, fallbackCurrency, palette, surface, boldFamily, selected, onSelect }) => {
  const isDisabled = ticket.visibility === "disabled";
  const isSoldOut = ticketIsSoldOut(ticket);
  const isDoorOnly = ticketIsDoorOnly(ticket);
  const saleEnded = ticketSaleEnded(ticket);

  const stateWord: string | null = saleEnded
    ? "Sales ended"
    : isDisabled
      ? "Sales paused"
      : isDoorOnly
        ? "Pay at the door"
        : isSoldOut
          ? "Sold out"
          : null;
  const selectable = stateWord === null;

  const priceLabel = formatTicketPrice(ticket, fallbackCurrency);
  const capacityLabel = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? ticket.capacity <= 0
        ? "Sold out"
        : `${ticket.capacity} available`
      : "Available";

  return (
    <Pressable
      onPress={selectable ? () => onSelect(ticket.id) : undefined}
      disabled={!selectable}
      accessibilityRole={selectable ? "radio" : "text"}
      accessibilityState={selectable ? { checked: selected } : undefined}
      accessibilityLabel={
        ticket.name +
        (priceLabel !== "—" ? `, ${priceLabel}` : "") +
        (stateWord !== null ? `, ${stateWord}` : "")
      }
      style={[
        styles.tierRow,
        surface.card,
        selected ? { borderColor: palette.accent, backgroundColor: palette.accentWash } : null,
        isDisabled || isSoldOut || saleEnded ? styles.tierRowMuted : null,
      ]}
    >
      {selected ? (
        <View pointerEvents="none" style={[styles.tierRail, { backgroundColor: palette.accent }]} />
      ) : null}
      <View style={[styles.radio, { borderColor: selected ? palette.accent : palette.cutoutBorder }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
      </View>
      <View style={styles.tierTextCol}>
        <Text
          style={[
            styles.tierName,
            { color: palette.primaryText, fontFamily: selected ? boldFamily : undefined },
          ]}
        >
          {ticket.name}
        </Text>
        {ticket.description !== null && ticket.description.length > 0 ? (
          <Text style={[styles.tierDesc, { color: palette.secondaryText }]}>{ticket.description}</Text>
        ) : null}
        <Text style={[styles.tierCap, { color: palette.tertiaryText }]}>
          {stateWord ?? capacityLabel}
        </Text>
      </View>
      <View style={[styles.tierPricePill, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}>
        <Text style={[styles.tierPrice, { color: palette.primaryText, fontFamily: boldFamily }]}>
          {ticket.isFree ? "Free" : priceLabel}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  leadBlock: { marginBottom: 4 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#ffffff",
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: 44,
    lineHeight: 47,
    fontWeight: "900",
    letterSpacing: -1,
    color: "#ffffff",
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metaGlyph: { fontSize: 14, fontWeight: "900" },
  metaText: { fontSize: 13, fontWeight: "600" },
  datesWrap: { marginTop: 12, gap: 8 },
  datesToggle: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  datesToggleText: { fontSize: 13, fontWeight: "700" },
  dateRow: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  dateRowText: { fontSize: 13, fontWeight: "600" },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  brandTile: { width: 42, height: 42, borderRadius: 999, overflow: "hidden" },
  brandPhoto: { width: "100%", height: "100%" },
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1, flexGrow: 1 },
  brandKicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  brandCta: { fontSize: 13, fontWeight: "800" },
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  about: { fontSize: 16, lineHeight: 23 },
  aboutToggleRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  aboutToggle: { fontSize: 14, fontWeight: "700" },
  venueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  venueDisk: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  venueGlyph: { fontSize: 18, fontWeight: "900" },
  venueTextCol: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "800" },
  venueAddr: { fontSize: 13, marginTop: 2 },
  venueUnlockCaption: { fontSize: 12, marginTop: 4 },
  venuePill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  venuePillText: { fontSize: 12, fontWeight: "800" },
  reassure: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  tierCol: { gap: 10 },
  tierRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    overflow: "hidden",
  },
  tierRowMuted: { opacity: 0.7 },
  tierRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 999 },
  tierTextCol: { flex: 1, minWidth: 0 },
  tierName: { fontSize: 15, fontWeight: "800" },
  tierDesc: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  tierCap: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  tierPricePill: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  tierPrice: { fontSize: 15, fontWeight: "900" },
});

export default FoundationEventPreview;
