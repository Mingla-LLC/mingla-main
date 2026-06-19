/**
 * EventOfferingBody — ORCH-1167 [event-page-canonical].
 *
 * Leg 1 of META-ORCH-1166 (public offering-page single source of truth). THE ONE
 * shared, shell-agnostic body for the STANDARD ticketed-event public page
 * (event_type='event' ONLY — NOT rsvp/trip/experience). Rendered byte-identically
 * on buyer-web, business iOS/Android, and consumer iOS/Android. Promotes the
 * forked FoundationEventPreview (web/business) + ConsumerEventDetailScreen
 * (consumer) bodies into ONE component.
 *
 * SHELL-AGNOSTIC (SPEC §3B, mandatory): this is a PURE CONTENT body. It hosts NO
 * scroll root and NO cover host. Each surface composes its own proven scroll +
 * parallax-cover scaffold AROUND this body and renders these CHILDREN inside its
 * scroll container:
 *   • buyer-web + business native → inside ParallaxCoverShell (RN ScrollView).
 *   • consumer → inside BaseBottomSheet's gorhom BottomSheetScrollView (the
 *     LOAD-BEARING ORCH-1016/1043/1138 scroll structure — the body must NEVER wrap
 *     ParallaxCoverShell as its scroll root, which re-triggers the gorhom freeze).
 * The cover (section 1) is a pinned sibling the surface scaffold owns; the floating
 * Get-tickets button (section 9) is exposed as <EventOfferingFloatingBar> for the
 * surface to position as a pinned overlay. The 9-section CONTENT order (sections
 * 2–8 + the inline ticket box at 5) is rendered here, identically, every surface.
 *
 * Pure-presentational, props-only, NO app-src imports (I-MOR-0827-PACKAGE-ISOLATION
 * — enforced by the META-ORCH-0827 packages gate that already covers this file).
 * Renders on react-native-web AND native RN.
 *
 * Canonical 9-section order (SPEC §3A):
 *   1. Cover            (surface scaffold — pinned sibling, not here)
 *   2. Event Name       (lead block: date eyebrow + bold title)
 *   3. Date & Time      (meta chips, AM/PM via the host's dateLine/dateSubline)
 *   4. Pills row        (format → ALL vibes → ALL party-types → ALL music-genres →
 *                        tickets-left; each group omits when empty — rule 9)
 *   5. TICKET BOX       (per-tier qty steppers; live Σ-all-in running total
 *                        (WYSIWYP, never bare base); in-box Proceed)
 *   6. Presented By     (brand card → onOpenBrand)
 *   7. About            (collapsible read-more/show-less)
 *   8. Where you'll be  (server-proxied static map via injected staticMapUrl +
 *                        "view on map" card; city-level when address hidden; text
 *                        venue card when no geo — rule 9)
 *   9. Floating button  (<EventOfferingFloatingBar>, surface-pinned)
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
} from "react-native";

import {
  boldFontFamily,
  computeOfferingVariant,
  offeringSurfaceStyles,
  resolveOfferingCta,
  ticketIsDoorOnly,
  ticketIsSoldOut,
  ticketSaleEnded,
  type CtaState,
  type OfferingVariant,
  type PublicBrandProps,
  type PublicEventProps,
  type PublicTicketProps,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/event-rendering";

import { normalizeCityCountry } from "./normalizeCityCountry";
import {
  computeRunningTotal,
  totalSelectedQuantity,
} from "./eventBoxTotals";

// Re-export the pure totals so a single import surface stays one place.
export { computeRunningTotal, totalSelectedQuantity } from "./eventBoxTotals";

const ABOUT_COLLAPSE_THRESHOLD = 160;

// Enable LayoutAnimation on Android once at module load (no-op on iOS/web).
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ===========================================================================
// Shared price formatting (WYSIWYP — all-in, never recompute fees).
// I-PROPOSED-1167-ALLIN-PRICE-IN-TICKET-BOX: the running total uses
// priceAllInGbp (the server fee-grossed all-in), falling back to priceGbp ONLY
// when the tier has no all-in (free / RPC miss) — never fabricating a markup.
// ===========================================================================

const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const formatTicketPrice = (
  ticket: PublicTicketProps,
  fallbackCurrency: string,
): string => {
  if (ticket.isFree) return "Free";
  const price = ticket.priceAllInGbp ?? ticket.priceGbp;
  if (price === null || price === undefined) return "—";
  return formatMoney(price, ticket.currency ?? fallbackCurrency);
};

const sortTickets = (tickets: PublicTicketProps[]): PublicTicketProps[] =>
  [...tickets].sort((a, b) => a.displayOrder - b.displayOrder);

/** A tier is sellable (quantity-pickable) when it has no blocking sub-state. */
const ticketIsSellable = (t: PublicTicketProps): boolean =>
  t.visibility !== "hidden" &&
  t.visibility !== "disabled" &&
  !ticketIsSoldOut(t) &&
  !ticketIsDoorOnly(t) &&
  !ticketSaleEnded(t);

export interface EventOfferingBodyProps {
  /** Extended PublicEventProps (musicGenres + cityGeo added — §4C-types). */
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  variant: OfferingVariant;
  /** I-PAID-SUPPLY gate (ORCH-1076). false → box + CTA disabled. */
  bookable: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;

  // Ticket-box state (LIFTED to the host so the cart can read it — §4C).
  ticketQuantities: Record<string, number>;
  onChangeTicketQuantity: (ticketTypeId: string, qty: number) => void;
  /** In-box Proceed + the floating button (§9) both call this. */
  onProceedToCart: () => void;

  // Links / maps.
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  /**
   * Server-proxied static map URL (the host computes it via buildProxyStaticMapUrl
   * with the city-OR-exact geo the privacy gate selected). null → no map (the
   * honest text venue card renders — rule 9).
   */
  staticMapUrl?: string | null;

  /** Host submitting flag (in-flight checkout) → disables the box CTA. */
  submitting?: boolean;
  testID?: string;
}

export const EventOfferingBody: React.FC<EventOfferingBodyProps> = ({
  event,
  brand,
  variant,
  bookable,
  palette,
  theme,
  ticketQuantities,
  onChangeTicketQuantity,
  onProceedToCart,
  onOpenBrand,
  onOpenMaps,
  staticMapUrl = null,
  submitting = false,
  testID,
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);

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

  const visibleTickets = useMemo(
    () => sortTickets(event.tickets.filter((t) => t.visibility !== "hidden")),
    [event.tickets],
  );

  const ticketsLeftLabel = useMemo<string | null>(() => {
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

  const cityCountry =
    normalizeCityCountry(event.venueName) ?? normalizeCityCountry(event.address);

  // Pills row (SPEC §4: format → vibes → party-types → music-genres → tickets-left).
  const formatLabel =
    event.format === "online"
      ? "Online"
      : event.format === "hybrid"
        ? "In-person + online"
        : "In person";
  const vibeTags = event.vibeTags ?? [];
  const partyTypes = event.partyTypes ?? [];
  const musicGenres = event.musicGenres ?? [];

  // Section 8 — venue copy.
  const venueAddressLabel = event.hideAddressUntilTicket
    ? (cityCountry ?? "Address shared after you get tickets")
    : event.format === "hybrid" && event.address !== null
      ? `${event.address} · also online`
      : (event.address ?? "Address shared after you get tickets");
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

  // Inline-box CTA state (shared resolveOfferingCta single owner). Drives the
  // box's Proceed button copy across free/waitlist/sold-out/pre-sale/past/etc.
  const boxCta: CtaState = useMemo(
    () =>
      resolveOfferingCta({
        variant,
        bookable,
        tickets: visibleTickets,
        currency: event.currency,
      }),
    [variant, bookable, visibleTickets, event.currency],
  );

  const runningTotal = computeRunningTotal(event.tickets, ticketQuantities);
  const selectedQty = totalSelectedQuantity(ticketQuantities);
  const totalLabel =
    selectedQty === 0
      ? null
      : runningTotal === 0
        ? "Free"
        : formatMoney(runningTotal, event.currency);

  // The box Proceed is tappable only when the CTA is actionable AND (for a buy/
  // free state) at least one quantity is chosen. Waitlist proceeds regardless.
  const ctaActionable = boxCta.tappable;
  const proceedEnabled =
    ctaActionable &&
    !submitting &&
    (boxCta.kind === "waitlist" || selectedQty > 0);
  const proceedLabel =
    boxCta.kind === "buy"
      ? totalLabel !== null
        ? `${boxCta.label} · ${totalLabel}`
        : boxCta.label
      : boxCta.kind === "free"
        ? boxCta.label
        : boxCta.kind === "waitlist"
          ? boxCta.label
          : boxCta.title;

  return (
    <View testID={testID}>
      {/* (2) Event name lead block — date eyebrow + bold title. */}
      <View style={styles.leadBlock}>
        {event.dateLine.length > 0 ? (
          <Text style={[styles.eyebrow, { color: palette.accent }]}>
            {event.dateLine}
          </Text>
        ) : null}
        <Text
          style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}
        >
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
      </View>

      {/* (3) Date & time meta chips. */}
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
        {cityCountry !== null ? (
          <MetaChip palette={palette} surface={surface} glyph="⌖" font={boldFamily}>
            {cityCountry}
          </MetaChip>
        ) : null}
      </View>

      {/* (4) Pills row — format → vibes → party-types → music-genres →
          tickets-left. Each group omits entirely when empty (rule 9). */}
      <View style={styles.pillsRow} testID="orch-1167-pills-row">
        <Pill palette={palette} surface={surface} font={boldFamily}>
          {formatLabel}
        </Pill>
        {vibeTags.map((tag, i) => (
          <Pill key={`vibe-${i}`} palette={palette} surface={surface} font={boldFamily}>
            {tag}
          </Pill>
        ))}
        {partyTypes.map((tag, i) => (
          <Pill key={`party-${i}`} palette={palette} surface={surface} font={boldFamily}>
            {tag}
          </Pill>
        ))}
        {musicGenres.map((tag, i) => (
          <Pill key={`music-${i}`} palette={palette} surface={surface} font={boldFamily}>
            {tag}
          </Pill>
        ))}
        {ticketsLeftLabel !== null ? (
          <Pill palette={palette} surface={surface} font={boldFamily} accent>
            {ticketsLeftLabel}
          </Pill>
        ) : null}
      </View>

      {/* (5) TICKET BOX — per-tier steppers + live Σ-all-in + in-box Proceed. */}
      <View style={styles.section}>
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
          Tickets
        </Text>
        {visibleTickets.length === 0 ? (
          <View style={[styles.venueCard, surface.card]}>
            <Text style={[styles.about, surface.secondaryText]}>
              Not on sale yet.
            </Text>
          </View>
        ) : (
          <View style={[styles.ticketBox, surface.card]} testID="orch-1167-ticket-box">
            {visibleTickets.map((t) => (
              <TicketStepperRow
                key={t.id}
                ticket={t}
                fallbackCurrency={event.currency}
                palette={palette}
                surface={surface}
                boldFamily={boldFamily}
                quantity={ticketQuantities[t.id] ?? 0}
                disabled={!bookable}
                onChange={(qty) => onChangeTicketQuantity(t.id, qty)}
              />
            ))}

            {/* live running total = Σ all-in (WYSIWYP) */}
            <View style={[styles.totalRow, { borderTopColor: palette.panelBorder }]}>
              <Text style={[styles.totalLabel, surface.secondaryText]}>Total</Text>
              <Text
                style={[styles.totalValue, surface.primaryText, { fontFamily: boldFamily }]}
                testID="orch-1167-running-total"
              >
                {totalLabel ?? "—"}
              </Text>
            </View>

            <Pressable
              onPress={proceedEnabled ? onProceedToCart : undefined}
              disabled={!proceedEnabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: !proceedEnabled }}
              accessibilityLabel={proceedLabel}
              style={[
                styles.boxProceed,
                proceedEnabled
                  ? { backgroundColor: palette.accent }
                  : {
                      backgroundColor: palette.card,
                      borderColor: palette.panelBorder,
                      borderWidth: 1,
                    },
              ]}
              testID="orch-1167-box-proceed"
            >
              <Text
                style={[
                  styles.boxProceedText,
                  {
                    color: proceedEnabled ? palette.accentText : palette.tertiaryText,
                    fontFamily: boldFamily,
                  },
                ]}
              >
                {proceedLabel}
              </Text>
            </Pressable>

            <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
              All-in price — taxes &amp; fees included, no surprises at checkout.
            </Text>
          </View>
        )}
      </View>

      {/* (6) Presented By — brand card → onOpenBrand. */}
      <View style={styles.section}>
        <Pressable
          onPress={() => {
            if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
          }}
          disabled={brand?.slug === undefined || onOpenBrand === undefined}
          accessibilityRole={onOpenBrand !== undefined ? "button" : undefined}
          accessibilityLabel={
            brand?.displayName !== undefined
              ? `View ${brand.displayName}`
              : "View brand"
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
                <Text
                  style={[
                    styles.brandInitial,
                    { color: palette.accentText, fontFamily: boldFamily },
                  ]}
                >
                  {(brand?.displayName?.trim()[0] ?? "•").toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.brandTextCol}>
            <Text style={[styles.brandKicker, surface.tertiaryText]}>Presented by</Text>
            <Text
              style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
            >
              {brand?.displayName ?? "Brand"}
            </Text>
          </View>
          {onOpenBrand !== undefined ? (
            <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
          ) : null}
        </Pressable>
      </View>

      {/* (7) About — collapsible. */}
      {aboutText.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            About
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

      {/* (8) Where you'll be — static map (city-level when hidden) + venue card. */}
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
              <Text
                style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}
              >
                Online
              </Text>
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
          {staticMapUrl !== null ? (
            <Image
              source={{ uri: staticMapUrl }}
              style={[styles.whereMap, { borderColor: palette.panelBorder }]}
              resizeMode="cover"
              accessibilityLabel={`Map showing ${event.venueName}`}
              testID="orch-1167-where-map"
            />
          ) : null}
          <Pressable
            onPress={() => {
              if (venueMapsQuery !== null) onOpenMaps?.(venueMapsQuery);
            }}
            disabled={!canOpenVenueMaps}
            accessibilityRole={canOpenVenueMaps ? "button" : undefined}
            accessibilityLabel={
              canOpenVenueMaps ? `Open ${event.venueName} in maps` : event.venueName
            }
            style={[styles.venueCard, surface.card]}
          >
            <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
              <Text style={[styles.venueGlyph, { color: palette.accentText }]}>⌖</Text>
            </View>
            <View style={styles.venueTextCol}>
              <Text
                style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {event.venueName}
              </Text>
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                {venueAddressLabel}
              </Text>
              {addressUnlockCaption !== null ? (
                <Text
                  style={[styles.venueUnlockCaption, surface.tertiaryText]}
                  testID="orch-1167-address-unlock-caption"
                >
                  {addressUnlockCaption}
                </Text>
              ) : null}
            </View>
            {canOpenVenueMaps ? (
              <View style={[styles.venuePill, { backgroundColor: palette.accent }]}>
                <Text style={[styles.venuePillText, { color: palette.accentText }]}>
                  Open maps
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

// ===========================================================================
// (9) Floating Get-tickets button — surface-pinned overlay. The surface
// positions it absolutely; it reflects the live Σ-all-in total and calls the
// SAME onProceedToCart the in-box Proceed calls. Preserves the float→dock
// pattern (the surface decides visibility) + the ORCH-1159 close-X behavior
// (the cover-shell chrome owns close/share; this is just the action button).
// ===========================================================================

export interface EventOfferingFloatingBarProps {
  event: PublicEventProps;
  variant: OfferingVariant;
  bookable: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  ticketQuantities: Record<string, number>;
  onProceedToCart: () => void;
  submitting?: boolean;
  testID?: string;
}

export const EventOfferingFloatingBar: React.FC<EventOfferingFloatingBarProps> = ({
  event,
  variant,
  bookable,
  palette,
  theme,
  ticketQuantities,
  onProceedToCart,
  submitting = false,
  testID,
}) => {
  const boldFamily = boldFontFamily(theme);
  const visibleTickets = useMemo(
    () => event.tickets.filter((t) => t.visibility !== "hidden"),
    [event.tickets],
  );
  const cta = useMemo(
    () =>
      resolveOfferingCta({
        variant,
        bookable,
        tickets: visibleTickets,
        currency: event.currency,
      }),
    [variant, bookable, visibleTickets, event.currency],
  );

  const runningTotal = computeRunningTotal(event.tickets, ticketQuantities);
  const selectedQty = totalSelectedQuantity(ticketQuantities);
  const totalLabel =
    selectedQty === 0
      ? null
      : runningTotal === 0
        ? "Free"
        : formatMoney(runningTotal, event.currency);

  const enabled =
    cta.tappable && !submitting && (cta.kind === "waitlist" || selectedQty > 0);
  const label =
    cta.kind === "buy"
      ? totalLabel !== null
        ? `${cta.label} · ${totalLabel}`
        : cta.label
      : cta.kind === "free"
        ? cta.label
        : cta.kind === "waitlist"
          ? cta.label
          : cta.title;

  return (
    <Pressable
      onPress={enabled ? onProceedToCart : undefined}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={label}
      style={[
        styles.floatBar,
        enabled
          ? { backgroundColor: palette.accent }
          : { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder, borderWidth: 1 },
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.floatBarText,
          { color: enabled ? palette.accentText : palette.tertiaryText, fontFamily: boldFamily },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

// ===========================================================================
// Sub-components.
// ===========================================================================

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

const Pill: React.FC<{
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  font: string;
  accent?: boolean;
  children: React.ReactNode;
}> = ({ palette, surface, font, accent = false, children }) => (
  <View
    style={[
      styles.pill,
      accent
        ? { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }
        : surface.card,
    ]}
  >
    <Text
      style={[
        styles.pillText,
        { color: accent ? palette.primaryText : palette.secondaryText, fontFamily: font },
      ]}
    >
      {children}
    </Text>
  </View>
);

const TicketStepperRow: React.FC<{
  ticket: PublicTicketProps;
  fallbackCurrency: string;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  quantity: number;
  disabled: boolean;
  onChange: (qty: number) => void;
}> = ({ ticket, fallbackCurrency, palette, surface, boldFamily, quantity, disabled, onChange }) => {
  const sellable = ticketIsSellable(ticket);
  const isSoldOut = ticketIsSoldOut(ticket);
  const isDoorOnly = ticketIsDoorOnly(ticket);
  const saleEnded = ticketSaleEnded(ticket);
  const isPaused = ticket.visibility === "disabled";

  const stateWord: string | null = saleEnded
    ? "Sales ended"
    : isPaused
      ? "Sales paused"
      : isDoorOnly
        ? "Pay at the door"
        : isSoldOut
          ? "Sold out"
          : null;

  const priceLabel = formatTicketPrice(ticket, fallbackCurrency);
  // Cap: unlimited → 99; else remaining capacity (capacity field carries remaining).
  const cap = ticket.isUnlimited ? 99 : Math.max(0, ticket.capacity ?? 0);
  const canIncrement = sellable && !disabled && quantity < cap;
  const canDecrement = quantity > 0;

  const capacityLabel = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? ticket.capacity <= 0
        ? "Sold out"
        : `${ticket.capacity} available`
      : "Available";

  return (
    <View
      style={[
        styles.stepperRow,
        { borderBottomColor: palette.panelBorder },
        !sellable ? styles.stepperRowMuted : null,
      ]}
    >
      <View style={styles.stepperTextCol}>
        <Text style={[styles.tierName, surface.primaryText, { fontFamily: boldFamily }]}>
          {ticket.name}
        </Text>
        {ticket.description !== null && ticket.description.length > 0 ? (
          <Text style={[styles.tierDesc, surface.secondaryText]}>
            {ticket.description}
          </Text>
        ) : null}
        <Text style={[styles.tierCap, surface.tertiaryText]}>
          {stateWord ?? capacityLabel}
        </Text>
      </View>

      <View style={styles.stepperRight}>
        <Text style={[styles.tierPrice, surface.primaryText, { fontFamily: boldFamily }]}>
          {ticket.isFree ? "Free" : priceLabel}
        </Text>
        {sellable ? (
          <View style={styles.stepper}>
            <Pressable
              onPress={canDecrement ? () => onChange(quantity - 1) : undefined}
              disabled={!canDecrement}
              accessibilityRole="button"
              accessibilityLabel={`Remove one ${ticket.name}`}
              style={[
                styles.stepBtn,
                { borderColor: palette.panelBorder },
                !canDecrement ? styles.stepBtnDisabled : null,
              ]}
            >
              <Text style={[styles.stepGlyph, { color: palette.primaryText }]}>−</Text>
            </Pressable>
            <Text
              style={[styles.stepQty, surface.primaryText, { fontFamily: boldFamily }]}
              accessibilityLabel={`${quantity} selected`}
            >
              {quantity}
            </Text>
            <Pressable
              onPress={canIncrement ? () => onChange(quantity + 1) : undefined}
              disabled={!canIncrement}
              accessibilityRole="button"
              accessibilityLabel={`Add one ${ticket.name}`}
              style={[
                styles.stepBtn,
                { borderColor: palette.panelBorder },
                !canIncrement ? styles.stepBtnDisabled : null,
              ]}
            >
              <Text style={[styles.stepGlyph, { color: palette.primaryText }]}>+</Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={[styles.tierStatePill, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          >
            <Text style={[styles.tierStateText, { color: palette.tertiaryText }]}>
              {stateWord ?? "Unavailable"}
            </Text>
          </View>
        )}
      </View>
    </View>
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
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  about: { fontSize: 16, lineHeight: 23 },
  aboutToggleRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  aboutToggle: { fontSize: 14, fontWeight: "700" },
  // ---- ticket box ----
  ticketBox: { borderRadius: 18, padding: 14 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepperRowMuted: { opacity: 0.7 },
  stepperTextCol: { flex: 1, minWidth: 0 },
  stepperRight: { alignItems: "flex-end", gap: 8 },
  tierName: { fontSize: 15, fontWeight: "800" },
  tierDesc: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  tierCap: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  tierPrice: { fontSize: 15, fontWeight: "900" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: { opacity: 0.4 },
  stepGlyph: { fontSize: 20, fontWeight: "900", lineHeight: 22 },
  stepQty: { fontSize: 16, fontWeight: "900", minWidth: 18, textAlign: "center" },
  tierStatePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tierStateText: { fontSize: 12, fontWeight: "800" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontWeight: "700" },
  totalValue: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
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
  // ---- brand ----
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  brandTile: { width: 42, height: 42, borderRadius: 999, overflow: "hidden" },
  brandPhoto: { width: "100%", height: "100%" },
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1, flexGrow: 1 },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  brandCta: { fontSize: 13, fontWeight: "800" },
  // ---- where ----
  whereMap: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#000",
    marginBottom: 12,
  },
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
  // ---- floating bar ----
  floatBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 16,
    paddingHorizontal: 22,
  },
  floatBarText: { fontSize: 16, fontWeight: "900" },
});

export default EventOfferingBody;
