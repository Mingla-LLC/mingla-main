/**
 * #4490 P2 — the venue page's Entry tab: pick the entry (when there are
 * several), the day and the guests, see the server's total, then go to
 * checkout with the choice carried in the address (day and counts only:
 * nothing personal, no token).
 *
 * Anonymous (never `useAuth`). The page's booking bar mirrors the choice
 * ("Thu 19 Nov / 3 guests · ₦15,050 · Continue") through `onBookingBarChange`.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { OfferingChipRow, OfferingChoiceChip } from "@mingla/offering-rendering/OfferingDecideParts";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import type { PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";
import type { VenueFeatureOfferView } from "@mingla/brand-rendering/venueFeaturePage";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { entryDateLabel, guestsText } from "@mingla/brand-rendering/venueOffers/entryModel";

import { space, type } from "../../../constants/designSystem";
import { venueOfferCartKey } from "../../../utils/venueOfferBookingTokens";
import { EntryPicker } from "./EntryPicker";
import { EntryButton, EntryNote } from "./EntryUi";
import { entryCheckoutPath } from "./entryCheckoutPath";
import { useEntrySelection } from "./useEntrySelection";

export interface VenueEntryPaneProps {
  brandSlug: string;
  venueSlug: string;
  offers: readonly VenueFeatureOfferView[];
  currencyCode: string;
  exponent: number;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The verb the venue sells entry with ("Buy entry", "Buy a day pass"). */
  verb: string;
  onBookingBarChange?: (bar: PublicVenueReservationBar | null) => void;
}

export function VenueEntryPane(props: VenueEntryPaneProps): React.ReactElement {
  const { offers, palette, theme } = props;
  const entryOffers = useMemo(() => offers.filter((o) => o.kind === "entry"), [offers]);
  const [offerId, setOfferId] = useState<string | null>(entryOffers[0]?.id ?? null);
  const current = entryOffers.find((o) => o.id === offerId) ?? entryOffers[0] ?? null;

  if (current === null) {
    return (
      <Text style={[styles.empty, { color: palette.secondaryText }]} testID="issue-4490-entry-empty">
        Entry isn&apos;t on sale online right now.
      </Text>
    );
  }
  return (
    <View style={styles.wrap} testID="issue-4490-entry-pane">
      {entryOffers.length > 1 ? (
        <OfferingChipRow accessibilityLabel="Choose the entry">
          {entryOffers.map((offer) => (
            <OfferingChoiceChip
              key={offer.id}
              palette={palette}
              label={offer.name}
              note={`from ${formatVenueMoney(offer.fromMinor, props.currencyCode, props.exponent)}`}
              selected={offer.id === current.id}
              onPress={() => setOfferId(offer.id)}
              role="radio"
              testID={`issue-4490-entry-offer-${offer.id}`}
            />
          ))}
        </OfferingChipRow>
      ) : null}
      <View style={styles.head}>
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>{current.name}</Text>
        {current.summary !== null ? (
          <Text style={[styles.summary, { color: palette.secondaryText }]}>{current.summary}</Text>
        ) : null}
      </View>
      <EntryOfferBody key={current.id} {...props} offerId={current.id} />
    </View>
  );
}

function EntryOfferBody({
  brandSlug,
  venueSlug,
  offerId,
  palette,
  theme,
  verb,
  onBookingBarChange,
}: VenueEntryPaneProps & { offerId: string }): React.ReactElement {
  const router = useRouter();
  const [cartKey] = useState(venueOfferCartKey);
  const selection = useEntrySelection({ brandSlug, venueSlug, offeringId: offerId, cartKey });
  const quote = selection.quote.status === "ready" ? selection.quote.quote : null;
  const offer = selection.offer;
  const total =
    quote !== null && offer !== null
      ? formatVenueMoney(quote.totalMinor, quote.currencyCode, offer.exponent)
      : null;
  // #4490 F4 — a venue that can't take payments online sells entry at the gate only.
  const gateOnly = offer !== null && offer.canCollectOnline === false;
  const ready = !gateOnly && selection.problem === null && quote !== null && selection.selectedDate !== null;

  const go = (): void => {
    if (!ready || selection.selectedDate === null) return;
    router.push(
      entryCheckoutPath({
        brandSlug,
        venueSlug,
        offerId,
        date: selection.selectedDate,
        counts: selection.counts,
        windowId: selection.selectedSession?.windowId ?? null,
      }) as never,
    );
  };

  // The page bar mirrors the pick; it hands the bar back when this unmounts.
  const barKey = `${selection.selectedSession?.windowId ?? ""}|${selection.selectedDate}|${JSON.stringify(selection.counts)}|${total}|${ready}|${selection.problem}`;
  useEffect(() => {
    if (onBookingBarChange === undefined) return undefined;
    if (selection.offerState !== "ready" || selection.selectedDate === null || gateOnly) {
      onBookingBarChange(null);
      return undefined;
    }
    onBookingBarChange({
      title:
        selection.selectedSession !== null
          ? `${entryDateLabel(selection.selectedDate)} · ${selection.selectedSession.label}`
          : entryDateLabel(selection.selectedDate),
      subtitle:
        selection.problem !== null
          ? selection.problem
          : total !== null
            ? `${guestsText(selection.guests)} · ${total}`
            : guestsText(selection.guests),
      // #4490 N41: the bar uses the pane's own words.
      ctaLabel: verb,
      enabled: ready,
      onPress: go,
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barKey, selection.offerState]);
  useEffect(
    () => () => {
      onBookingBarChange?.(null);
    },
    [onBookingBarChange],
  );

  return (
    <View style={styles.wrap}>
      {gateOnly ? (
        <EntryNote palette={palette} icon="ticket" tone="warning" testID="issue-4490-entry-gate-only">
          Entry is sold at the gate only right now. Come along and pay when you arrive.
        </EntryNote>
      ) : (
        <EntryPicker selection={selection} palette={palette} theme={theme} />
      )}
      {selection.offerState === "ready" && selection.selectedTile?.soldOnline && !gateOnly ? (
        <>
          {/* #4490 N41: with the page's bar showing the same action, the
              inline button is not drawn, so there is one primary at a time. */}
          {onBookingBarChange === undefined ? (
          <EntryButton
            palette={palette}
            theme={theme}
            label={total !== null ? `${verb} · ${total}` : verb}
            onPress={go}
            disabled={!ready}
            accessibilityLabel={total !== null ? `${verb}, ${total}, go to checkout` : verb}
            testID="issue-4490-entry-continue"
          />
          ) : null}
          {selection.problem !== null ? (
            <Text style={[styles.reason, { color: palette.secondaryText }]} testID="issue-4490-entry-reason">
              {selection.problem}
            </Text>
          ) : (
            <Text style={[styles.reason, { color: palette.tertiaryText }]}>
              No account needed. You pay on the next step.
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  head: { gap: space[1] },
  title: { ...type.h1 },
  summary: { ...type.small },
  empty: { ...type.body, paddingVertical: space[5] },
  reason: { ...type.caption, textAlign: "center" },
});
