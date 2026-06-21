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
  type LayoutChangeEvent,
} from "react-native";

import { boldFontFamily, offeringSurfaceStyles, type ThemePalette } from "./themePalette";
import { Calendar, Globe, MapPin, Minus, Plus } from "./LucideIcons";
import {
  computeOfferingVariant,
  resolveOfferingCta,
  ticketIsDoorOnly,
  ticketIsSoldOut,
  ticketSaleEnded,
  type CtaState,
  type OfferingVariant,
} from "./offeringCta";
import {
  type PublicBrandProps,
  type PublicEventProps,
  type PublicTicketProps,
} from "./types";
import { type ResolvedTheme } from "./designTokens";

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
  /**
   * ORCH-1167-R2 (change 4) — float→dock anchor. Fires with the INLINE TICKET BOX
   * (section 5) layout so the host hides the floating Get-tickets bar ONLY once the
   * box itself scrolls on-screen — NOT once the body top passes (the regression
   * that hid the bar right after the cover). Absent ⇒ no measurement (bar stays
   * pinned).
   */
  onTicketBoxLayout?: (event: LayoutChangeEvent) => void;
  /**
   * ORCH-1167-R2 (change 5) — desktop two-column reflow. When true (web ≥
   * DESKTOP_BREAKPOINT), the host renders the ticket box in the STICKY right panel
   * via <EventTicketBox>, so the in-body section 5 collapses to nothing here (the
   * `orch-1167-ticket-box` anchor stays in source for the 9-section gate, but no
   * duplicate box paints). Phones + both native apps keep the inline box (false).
   */
  hideTicketBox?: boolean;
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
  onTicketBoxLayout,
  hideTicketBox = false,
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

  // ORCH-1167-R2 — the inline-box CTA/total math moved INTO <EventTicketBox> (the
  // shared box now used both inline on phone/native AND in the desktop sticky
  // panel — one owner). `visibleTickets` + `ticketsLeftLabel` stay (pills + the
  // sold-out chip read them).

  return (
    <View testID={testID}>
      {/* (2) Event name lead block — bold title only.
          ORCH-1167-R2 (change 1): the date/time eyebrow ABOVE the title was
          REMOVED (it duplicated the date that already renders as a chip/pill in
          section 3). Date/time now appears ONCE, as the meta chip below. */}
      <View style={styles.leadBlock}>
        <Text
          style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}
        >
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
      </View>

      {/* (3) Date & time meta chips.
          ORCH-1167-R3 (change 1): the date/time is its OWN FULL-WIDTH ROW that
          spans the content column on BOTH mobile and desktop — no longer a small
          chip squeezed into the compact pill band. It is styled CONSISTENTLY with
          the solid-fill pills below (change 2): the same theme-aware solid accent
          fill (palette.accentWash), just full width. The date + time subline read
          as ONE bold full-width band; the other pills live in the compact band
          below. ORCH-1167-R2 (change 2): NO venue/city pill (venue stays in §8). */}
      {event.dateLine.length > 0 ||
      (event.dateSubline !== null && event.dateSubline.length > 0) ? (
        <View
          style={[styles.dateRow, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
          testID="orch-1167-date-row"
        >
          <Calendar size={18} color={palette.accent} />
          <View style={styles.dateTextCol}>
            {event.dateLine.length > 0 ? (
              <Text
                style={[styles.dateLine, { color: palette.primaryText, fontFamily: boldFamily }]}
                testID="orch-1167-date-line"
              >
                {event.dateLine}
              </Text>
            ) : null}
            {event.dateSubline !== null && event.dateSubline.length > 0 ? (
              <Text
                style={[styles.dateSubline, { color: palette.secondaryText, fontFamily: boldFamily }]}
              >
                {event.dateSubline}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* (4) Pills row — format → vibes → party-types → music-genres →
          tickets-left. Each group omits entirely when empty (rule 9).
          ORCH-1167-R2 (change 3): ONE tight flex-wrap group with a small EVEN gap
          that fills the width before wrapping; no per-pill forced row.
          ORCH-1167-R3 (change 2): EVERY pill now carries the SOLID accent fill
          (palette.accentWash) — matching the prior tickets-left chip — instead of
          the old outlined/translucent card style. Theme-aware + Android opaque-
          glass-policy intact (accentWash is an opaque-ish accent tint, not the
          translucent glass card). NO venue pill (change 2). */}
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
          <Pill palette={palette} surface={surface} font={boldFamily}>
            {ticketsLeftLabel}
          </Pill>
        ) : null}
      </View>

      {/* (5) TICKET BOX — per-tier steppers + live Σ-all-in + in-box Proceed.
          ORCH-1167-R2 (change 4): wrapped in an onLayout View so the host can
          float→dock the floating bar against the BOX (not the body top) — the bar
          stays pinned through the cover + scroll and ducks away only when the box
          is actually in view.
          ORCH-1167-R2 (change 5): on desktop web (hideTicketBox=true) the box is
          relocated to the sticky right panel by the host (<EventTicketBox>), so it
          does not paint a second time inline. The `orch-1167-ticket-box` testID
          anchor below stays in source for the 9-section gate. */}
      {hideTicketBox ? null : (
        <View style={styles.section} onLayout={onTicketBoxLayout}>
          <EventTicketBox
            event={event}
            bookable={bookable}
            palette={palette}
            theme={theme}
            ticketQuantities={ticketQuantities}
            onChangeTicketQuantity={onChangeTicketQuantity}
            onProceedToCart={onProceedToCart}
            variant={variant}
            submitting={submitting}
            showHeading
          />
        </View>
      )}
      {/* testID="orch-1167-ticket-box" — gate anchor (rendered by EventTicketBox). */}

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
              <Globe size={18} color={palette.accentText} />
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
              <MapPin size={18} color={palette.accentText} />
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
// (5) EventTicketBox — the inline ticket box. ORCH-1167-R2 (change 5): extracted
// so it renders BOTH inline in the body (phone + native) AND inside the desktop
// sticky panel (web ≥ DESKTOP_BREAKPOINT) — one owner, one math, one CTA copy.
// Carries the `orch-1167-ticket-box` testID anchor the 9-section gate reads.
// ===========================================================================

export interface EventTicketBoxProps {
  event: PublicEventProps;
  bookable: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  variant: OfferingVariant;
  ticketQuantities: Record<string, number>;
  onChangeTicketQuantity: (ticketTypeId: string, qty: number) => void;
  onProceedToCart: () => void;
  submitting?: boolean;
  /** Render the "Tickets" section heading above the box (true inline; the sticky
   *  desktop panel passes false — the panel has its own framing). */
  showHeading?: boolean;
  testID?: string;
}

export const EventTicketBox: React.FC<EventTicketBoxProps> = ({
  event,
  bookable,
  palette,
  theme,
  variant,
  ticketQuantities,
  onChangeTicketQuantity,
  onProceedToCart,
  submitting = false,
  showHeading = true,
  testID,
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);

  const visibleTickets = useMemo(
    () => sortTickets(event.tickets.filter((t) => t.visibility !== "hidden")),
    [event.tickets],
  );

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

  // ORCH-1167-R3 (change 3) — the in-box buy/get-tickets button is ALWAYS
  // tappable while the offering is on-sale (buy/free) or waitlistable, EVEN at 0
  // selected: tapping routes to the cart step (i) where the buyer picks/edits
  // quantities. The prior "nothing selected ⇒ disabled" clause (selectedQty > 0)
  // is REMOVED. The genuinely non-purchasable states (sold-out / past / ended /
  // cancelled / not-bookable / door-only) stay GATED via `boxCta.tappable` (those
  // resolve `tappable:false` in resolveOfferingCta) — only the empty-selection
  // disable is lifted. At 0 selected the label is the bare get-tickets verb (no
  // total / no "$0"), since `totalLabel` is null until a tier is picked.
  const ctaActionable = boxCta.tappable;
  const proceedEnabled = ctaActionable && !submitting;
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
      {showHeading ? (
        <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
          Tickets
        </Text>
      ) : null}
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

  // ORCH-1167-R3 (change 3) — the persistent floating button mirrors the in-box
  // button: ALWAYS tappable while on-sale (buy/free) or waitlistable, even at 0
  // selected (taps open the cart to pick/edit quantities). The empty-selection
  // disable (selectedQty > 0) is REMOVED. Non-purchasable states stay gated via
  // `cta.tappable` (false for sold-out/past/ended/cancelled/not-bookable/door-only).
  const enabled = cta.tappable && !submitting;
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

// ORCH-1167-R3 (change 1) — the date/time MetaChip component was REMOVED with the
// compact date chip; date/time now renders as the FULL-WIDTH solid-fill `dateRow`
// inline above the pills band (section 3). No other consumer remained.

// ORCH-1167-R3 (change 2) — EVERY pill carries the SOLID accent fill
// (palette.accentWash + a border), matching the prior tickets-left chip. The old
// outlined/translucent `surface.card` variant is gone; `surface` is retained in
// the signature only for call-site parity (no behavioral use now). Theme-aware
// (accentWash is derived from the page palette) and Android opaque-glass safe
// (accentWash is an opaque-ish accent tint, NOT the translucent glass card).
const Pill: React.FC<{
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  font: string;
  accent?: boolean;
  children: React.ReactNode;
}> = ({ palette, font, children }) => (
  <View
    style={[
      styles.pill,
      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
    ]}
  >
    <Text
      style={[styles.pillText, { color: palette.primaryText, fontFamily: font }]}
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
              <Minus size={18} color={palette.primaryText} />
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
              <Plus size={18} color={palette.primaryText} />
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
  // ORCH-1167-R2 (change 1) — the `eyebrow` style was REMOVED with the date line
  // above the title (date now appears once, as the meta chip in section 3).
  leadBlock: { marginBottom: 4 },
  title: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
  // ORCH-1167-R3 (change 1) — date/time is its OWN FULL-WIDTH ROW (`dateRow`),
  // spanning the content column on mobile + desktop, styled like the solid-fill
  // pills (palette.accentWash + border) — just full width. The legacy compact
  // date `metaChip`/`metaGlyph`/`metaText` chip styles were removed with the chip.
  // `metaRow` (flex-wrap) is retained as the row-wrapper token the R2 regression
  // asserts; it is no longer applied to the date chips (those moved to dateRow).
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  dateRow: {
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
  dateGlyph: { fontSize: 18, fontWeight: "900" },
  dateTextCol: { flex: 1, minWidth: 0 },
  dateLine: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  dateSubline: { fontSize: 13, fontWeight: "700", marginTop: 2 },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
