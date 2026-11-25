/**
 * #4490 P4-3 — the venue page's Private hire tab: the venue's hire offer(s),
 * then the group size, the day, the session and the space, and Continue to
 * the request page with the choice in the address (nothing personal, no
 * token). The page's booking bar mirrors the choice.
 *
 * Anonymous (never `useAuth`).
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { OfferingRadioCard } from "@mingla/offering-rendering/OfferingDecideParts";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import type { PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";
import type { VenueFeatureOfferView } from "@mingla/brand-rendering/venueFeaturePage";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { entryDateLabel } from "@mingla/brand-rendering/venueOffers/entryModel";
import { hireRequestPath } from "@mingla/brand-rendering/venueOffers/hireModel";

import { space, type } from "../../../constants/designSystem";
import { EntryButton, EntrySectionLabel } from "./EntryUi";
import { HireForm } from "./HireForm";
import { useHireSelection } from "./useHireSelection";

export interface VenueHirePaneProps {
  brandSlug: string;
  venueSlug: string;
  offers: readonly VenueFeatureOfferView[];
  currencyCode: string;
  exponent: number;
  palette: ThemePalette;
  theme: ResolvedTheme;
  onBookingBarChange?: (bar: PublicVenueReservationBar | null) => void;
}

export function VenueHirePane(props: VenueHirePaneProps): React.ReactElement {
  const { offers, palette, theme, currencyCode, exponent } = props;
  const hires = useMemo(() => offers.filter((o) => o.kind === "private_hire"), [offers]);
  const [offerId, setOfferId] = useState<string | null>(hires.length === 1 ? hires[0].id : null);
  const current = hires.find((o) => o.id === offerId) ?? null;

  if (hires.length === 0) {
    return (
      <Text style={[styles.empty, { color: palette.secondaryText }]} testID="issue-4490-hire-empty">
        Private hire isn&apos;t open online right now.
      </Text>
    );
  }
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  return (
    <View style={styles.wrap} testID="issue-4490-hire-pane">
      <View style={styles.head}>
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>Private hire</Text>
        <Text style={[styles.summary, { color: palette.secondaryText }]}>
          A space to yourselves. Ask for a date; nothing to pay until the venue says yes. No account needed.
        </Text>
      </View>
      {hires.length > 1 || current === null ? (
        <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="Choose what to hire">
          {hires.map((h) => (
            <OfferingRadioCard
              key={h.id}
              palette={palette}
              title={h.name}
              detail={[h.summary, h.guestMax !== null ? `up to ${h.guestMax} guests` : null].filter(Boolean).join(" · ") || null}
              price={`From ${money(h.fromMinor)}${h.unit === "hour" ? " an hour" : ""}`}
              selected={h.id === current?.id}
              onPress={() => setOfferId(h.id)}
              fontFamily={themeBoldFace(theme).fontFamily}
              testID={`issue-4490-hire-card-${h.id}`}
            />
          ))}
        </View>
      ) : null}
      {current !== null ? (
        <View style={styles.wrap}>
          {hires.length > 1 ? (
            <EntrySectionLabel palette={palette}>{current.name}</EntrySectionLabel>
          ) : current.summary !== null ? (
            <Text style={[styles.summary, { color: palette.secondaryText }]}>{current.summary}</Text>
          ) : null}
          <HireBody key={current.id} {...props} offerId={current.id} />
        </View>
      ) : (
        <Text style={[styles.summary, { color: palette.tertiaryText }]}>Pick one to see free days and spaces.</Text>
      )}
    </View>
  );
}

function HireBody({ brandSlug, venueSlug, offerId, palette, theme, onBookingBarChange }: VenueHirePaneProps & { offerId: string }): React.ReactElement {
  const router = useRouter();
  const selection = useHireSelection({ brandSlug, venueSlug, offeringId: offerId });
  const offer = selection.offer;
  const ready = selection.problem === null && selection.choice !== null;
  const label = offer?.mode === "instant" ? "Continue to book" : "Continue to request";

  const go = (): void => {
    if (!ready || selection.choice === null) return;
    router.push(hireRequestPath({ brandSlug, venueSlug, offerId, ...selection.choice }) as never);
  };

  const place = selection.selectedPlace;
  const barKey = `${selection.selectedDate}|${selection.windowId}|${selection.guests}|${selection.optionId}|${selection.startsAt}|${selection.minutes}|${ready}|${selection.problem}`;
  useEffect(() => {
    if (onBookingBarChange === undefined) return undefined;
    if (selection.offerState !== "ready" || selection.selectedDate === null || offer?.canCollectOnline === false) {
      onBookingBarChange(null);
      return undefined;
    }
    onBookingBarChange({
      title: entryDateLabel(selection.selectedDate),
      subtitle: selection.problem ?? `${selection.guests} guests · ${place?.placeName ?? ""}`,
      ctaLabel: "Continue",
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
      <HireForm selection={selection} palette={palette} theme={theme} />
      {selection.offerState === "ready" && offer?.canCollectOnline !== false ? (
        <>
          <EntryButton
            palette={palette}
            theme={theme}
            label={label}
            onPress={go}
            disabled={!ready}
            accessibilityLabel={`${label}${place !== null ? `, ${place.placeName}` : ""}`}
            testID="issue-4490-hire-continue"
          />
          <Text style={[styles.reason, { color: selection.problem !== null ? palette.secondaryText : palette.tertiaryText }]} testID="issue-4490-hire-reason">
            {selection.problem ??
              (offer?.mode === "instant"
                ? "No account needed. You add your details and pay the deposit on the next step."
                : "No account needed. You add your details on the next step. Nothing to pay yet.")}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  head: { gap: space[1] },
  cards: { gap: space[2] },
  title: { ...type.h1 },
  summary: { ...type.small },
  empty: { ...type.body, paddingVertical: space[5] },
  reason: { ...type.caption, textAlign: "center" },
});
