/**
 * #4490 Explorer W3 — one native venue page pane (Entry, Groups, Private hire,
 * By the hour, Plans). The five named panes (`EntryPane` …) are this component
 * with their kind fixed.
 *
 * States (spec 06 §5): loading (rows drawn from the page payload at once; each
 * book button waits with a spinner while its "what's left" read runs: never a
 * dead tap), empty ("Nothing to book here right now."), error and offline (a
 * plain line with "Try again"; the book buttons stay usable, the next step
 * asks the server anyway), sold out (the row says "Sold out" and its button is
 * disabled), success. The docked bar reads this tab's cheapest open row.
 * Every price shown is a server "from" price, display only.
 *
 * The book button goes through `openVenueOfferCheckout`, the one seam: W4's
 * native checkout sheet (`VenueOfferCheckoutSheet`) opens on the tapped offer.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { PublicVenueEntrySlotContext } from "@mingla/brand-rendering/PublicVenueScreen";
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";
import type { VenueFeaturePlanView } from "@mingla/brand-rendering/venueFeaturePage";
import { accentFillWithBorder } from "@mingla/offering-rendering/themeAccentStyle";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";
import { crowdCategoryFor } from "../venuePage/venueExplorerModel";
import { captureVenueTappedToBook } from "./venueBookAnalytics";
import { venueMoneyText } from "./venueMoneyText";
import { openVenueOfferCheckout } from "./venueOfferCheckoutSeam";
import { VenueOfferCheckoutSheet, type VenueCheckoutOpen } from "./VenueOfferCheckoutSheet";
import { takeVenueCheckoutForSignedIn, type VenueCheckoutSnapshot } from "./venueCheckoutResume";
import type { VenueCheckoutKind } from "../../payments/venueOfferCheckoutFlow";
import {
  offerPaneRows,
  paneAvailabilityWindow,
  paneBar,
  paneStatus,
  planPaneRows,
  PANE_COPY,
  PANE_OFFER_KIND,
  type VenuePaneKind,
  type VenuePaneRow,
} from "./venuePaneModel";
import { useVenueOfferAvailability } from "./useVenueOfferAvailability";

/** The checkout each pane opens (the seam's tab rule, by pane). */
const PANE_CHECKOUT_KIND: Record<VenuePaneKind, VenueCheckoutKind> = {
  entry: "entry",
  groups: "group_package",
  hire: "private_hire",
  by_the_hour: "by_the_hour",
  plans: "plan",
};

const PANE_TAB: Record<VenuePaneKind, PublicVenueTab> = {
  entry: "entry",
  groups: "groups",
  hire: "hire",
  by_the_hour: "by_the_hour",
  plans: "plans",
};

export interface VenueOfferPaneProps {
  kind: VenuePaneKind;
  context: PublicVenueEntrySlotContext & { plans?: readonly VenueFeaturePlanView[] };
  brandSlug: string;
  venueSlug: string;
  venueId: string;
  /** The venue's IANA zone (its own "today" for the availability window). */
  timezone: string | null;
  /** The deck's mode when the page was opened from a collab deck. */
  mode: "solo" | "collab";
  /** #4490 W4: the venue's name and place for the checkout sheet, and what picks its crowd curve. */
  venueName?: string;
  lat?: number | null;
  lng?: number | null;
  deckCategory?: string | null;
  venueCategory?: string | null;
  /** Test seam: "now" for the availability window. */
  now?: Date;
}

export function VenueOfferPane({
  kind,
  context,
  brandSlug,
  venueSlug,
  venueId,
  timezone,
  mode,
  now,
  venueName,
  lat,
  lng,
  deckCategory,
  venueCategory,
}: VenueOfferPaneProps): React.ReactElement {
  const crowdCategory = crowdCategoryFor(deckCategory, venueCategory);
  // #4490 W4: the native checkout sheet for the tapped offer (one per pane).
  const [checkout, setCheckout] = useState<VenueCheckoutOpen | null>(null);
  // #4490 06-W4 fix 1 (W4-N4): signed in again as the same account after the
  // session ended mid-checkout: reopen that checkout here, on the same offer
  // and step with the picks kept (taken once, from memory only).
  const [resume, setResume] = useState<VenueCheckoutSnapshot | null>(null);
  useEffect(() => {
    const kept = takeVenueCheckoutForSignedIn(`venue:${brandSlug}:${venueSlug}:${PANE_CHECKOUT_KIND[kind]}`);
    if (kept === null) return;
    setResume(kept);
    setCheckout(kept.open);
  }, [brandSlug, kind, venueSlug]);
  const currency = useMemo(
    () => ({ code: context.currencyCode, exponent: context.exponent }),
    [context.currencyCode, context.exponent],
  );
  const paneOffers = useMemo(
    () => (kind === "plans" ? [] : context.offers.filter((o) => o.kind === PANE_OFFER_KIND[kind])),
    [context.offers, kind],
  );
  const windowNow = now ?? null;
  const availabilityWindow = useMemo(
    () => paneAvailabilityWindow(windowNow ?? new Date(), timezone),
    // The window is the venue's day: recomputed per mount, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timezone, windowNow?.getTime()],
  );
  const availability = useVenueOfferAvailability(paneOffers, availabilityWindow);
  const rows: VenuePaneRow[] = useMemo(
    () =>
      kind === "plans"
        ? planPaneRows(context.plans ?? [], currency, venueMoneyText)
        : offerPaneRows(kind, paneOffers, availability.byOffer, currency, venueMoneyText),
    [availability.byOffer, context.plans, currency, kind, paneOffers],
  );
  const status = paneStatus(rows, availability.reads);
  // The hand-off could not open (this build has no buyer web for its backend):
  // said under the offer that raised it, never a silent dead tap. W3 fix 3
  // (W3-N23): scoped to that row of this pane; the route keys each pane by its
  // kind, so another tab starts clean, and the next tap clears it.
  const [handoffFailedRowId, setHandoffFailedRowId] = useState<string | null>(null);

  const book = useCallback(
    (row: VenuePaneRow): void => {
      if (row.soldOut) return;
      captureVenueTappedToBook({
        venueId,
        tab: PANE_TAB[kind],
        offerKind: row.offerKind,
        source: "venue_page",
        positionInDeck: null,
        isHostedVenue: true,
        mode,
      });
      const opened = openVenueOfferCheckout(
        { brandSlug, venueSlug, tab: PANE_TAB[kind], offerId: row.id },
        {
          venueId,
          venueName: venueName ?? "",
          currencyCode: context.currencyCode,
          exponent: context.exponent,
          timezone,
          lat: lat ?? null,
          lng: lng ?? null,
          category: crowdCategory ?? null,
          plans: context.plans,
        },
        setCheckout,
      );
      setHandoffFailedRowId(opened ? null : row.id);
    },
    [brandSlug, context.currencyCode, context.exponent, context.plans, crowdCategory, kind, lat, lng, mode, timezone, venueId, venueName, venueSlug],
  );

  // The docked bar speaks for this tab: its cheapest open row.
  const bar = paneBar(kind, rows, paneOffers, context.verb);
  const barRow = bar === null ? null : rows.find((r) => r.id === bar.rowId) ?? null;
  const { onBookingBarChange } = context;
  const barKey = bar === null ? "none" : `${bar.rowId}|${bar.title}|${bar.subtitle}|${bar.ctaLabel}|${bar.enabled}`;
  useEffect(() => {
    if (bar === null || barRow === null) {
      onBookingBarChange(null);
      return undefined;
    }
    onBookingBarChange({
      title: bar.title,
      subtitle: bar.subtitle,
      ctaLabel: bar.ctaLabel,
      enabled: bar.enabled,
      onPress: () => book(barRow),
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barKey, book, onBookingBarChange]);
  useEffect(() => () => onBookingBarChange(null), [onBookingBarChange]);

  const { palette } = context;
  if (status === "empty") {
    return (
      <View style={styles.pane} testID={`venue-pane-${kind}-empty`}>
        <Text style={[styles.stateLine, { color: palette.secondaryText }]}>{PANE_COPY.empty}</Text>
      </View>
    );
  }
  return (
    <View style={styles.pane} testID={`venue-pane-${kind}`}>
      <VenueOfferCheckoutSheet open={checkout}
        resume={resume}
        onClose={() => {
          setResume(null);
          setCheckout(null);
        }}
      />
      {status === "error" || status === "offline" ? (
        <View style={styles.stateRow} testID={`venue-pane-${kind}-${status}`}>
          <Text style={[styles.stateLine, { color: palette.secondaryText }]}>
            {status === "offline" ? PANE_COPY.offline : PANE_COPY.error}
          </Text>
          <Pressable
            onPress={availability.retry}
            accessibilityRole="button"
            accessibilityLabel={PANE_COPY.retry}
            hitSlop={spacing.sm}
            style={({ pressed }) => [styles.retry, { borderColor: palette.panelBorder }, pressed ? styles.pressed : null]}
            testID={`venue-pane-${kind}-retry`}
          >
            <Text style={[styles.retryLabel, { color: palette.primaryText }]}>{PANE_COPY.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      {rows.map((row) => (
        <React.Fragment key={row.id}>
        <View
          style={[styles.row, { borderColor: palette.panelBorder, backgroundColor: palette.card }]}
          testID={`venue-pane-row-${row.id}`}
        >
          <View style={styles.rowText}>
            <Text style={[styles.rowName, { color: palette.primaryText }]} numberOfLines={2}>
              {row.name}
            </Text>
            {row.line !== null ? (
              <Text style={[styles.rowLine, { color: palette.secondaryText }]} numberOfLines={2}>
                {row.line}
              </Text>
            ) : null}
            <Text style={[styles.rowPrice, { color: palette.primaryText }]}>{row.price}</Text>
            {row.todayTag !== null ? (
              <Text style={[styles.rowTag, { color: palette.secondaryText }]} testID={`venue-pane-tag-${row.id}`}>
                {row.todayTag === "Sold out today" ? PANE_COPY.soldOutToday : PANE_COPY.closedToday}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => book(row)}
            disabled={row.soldOut || row.checking}
            accessibilityRole="button"
            accessibilityLabel={
              row.soldOut
                ? `${row.name}, ${PANE_COPY.soldOut}`
                : `${row.actionLabel}, ${row.name}, ${row.price}${row.todayTag !== null ? `, ${row.todayTag}` : ""}`
            }
            accessibilityState={{ disabled: row.soldOut || row.checking, busy: row.checking }}
            style={({ pressed }) => [
              styles.button,
              row.soldOut
                ? { backgroundColor: palette.panel, borderColor: palette.panelBorder }
                : accentFillWithBorder(palette),
              pressed ? styles.pressed : null,
            ]}
            testID={`venue-pane-book-${row.id}`}
          >
            {row.checking ? (
              <ActivityIndicator color={palette.accentText} />
            ) : (
              <Text
                style={[styles.buttonLabel, { color: row.soldOut ? palette.secondaryText : palette.accentText }]}
                numberOfLines={1}
              >
                {row.soldOut ? PANE_COPY.soldOut : row.actionLabel}
              </Text>
            )}
          </Pressable>
        </View>
        {handoffFailedRowId === row.id ? (
          <Text
            style={[styles.stateLine, { color: palette.secondaryText }]}
            testID={`venue-pane-${kind}-handoff-error`}
            accessibilityLiveRegion="polite"
          >
            {PANE_COPY.error}
          </Text>
        ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { gap: spacing.sm },
  stateRow: { gap: spacing.sm, alignItems: "flex-start" },
  stateLine: { ...typography.sm },
  retry: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
  },
  retryLabel: { ...typography.sm, fontWeight: fontWeights.semibold },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  rowName: { ...typography.md, fontWeight: fontWeights.semibold },
  rowLine: { ...typography.sm },
  rowPrice: { ...typography.sm, fontWeight: fontWeights.semibold },
  rowTag: { ...typography.xs, fontWeight: fontWeights.semibold },
  button: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
  },
  buttonLabel: { ...typography.sm, fontWeight: fontWeights.bold },
  pressed: { opacity: 0.72 },
});
