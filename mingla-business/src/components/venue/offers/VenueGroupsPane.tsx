/**
 * #4490 P3-3 — the venue page's Groups tab ("Groups & parties"): the venue's
 * group packages as cards, then the chosen package's form (day, start time,
 * group size, choices, extras, how you pay, the total) and Continue to
 * checkout with the choice in the address (no personal data, no token).
 *
 * Anonymous (never `useAuth`). The page's booking bar mirrors the choice.
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
import { packageCheckoutPath } from "@mingla/brand-rendering/venueOffers/packageModel";

import { space, type } from "../../../constants/designSystem";
import { venueOfferCartKey } from "../../../utils/venueOfferBookingTokens";
import { EntryButton, EntrySectionLabel } from "./EntryUi";
import { PackageForm } from "./PackageForm";
import { usePackageSelection } from "./usePackageSelection";

export interface VenueGroupsPaneProps {
  brandSlug: string;
  venueSlug: string;
  offers: readonly VenueFeatureOfferView[];
  currencyCode: string;
  exponent: number;
  palette: ThemePalette;
  theme: ResolvedTheme;
  onBookingBarChange?: (bar: PublicVenueReservationBar | null) => void;
}

export function VenueGroupsPane(props: VenueGroupsPaneProps): React.ReactElement {
  const { offers, palette, theme, currencyCode, exponent } = props;
  const packages = useMemo(() => offers.filter((o) => o.kind === "group_package"), [offers]);
  const [offerId, setOfferId] = useState<string | null>(packages.length === 1 ? packages[0].id : null);
  const current = packages.find((o) => o.id === offerId) ?? null;

  if (packages.length === 0) {
    return (
      <Text style={[styles.empty, { color: palette.secondaryText }]} testID="issue-4490-groups-empty">
        Group bookings aren&apos;t open online right now.
      </Text>
    );
  }
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  return (
    <View style={styles.wrap} testID="issue-4490-groups-pane">
      <View style={styles.head}>
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>Groups &amp; parties</Text>
        <Text style={[styles.summary, { color: palette.secondaryText }]}>A set price for your group, with everything included. No account needed.</Text>
      </View>
      {packages.length > 1 || current === null ? (
        <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="Choose a package">
          {packages.map((p) => (
            <OfferingRadioCard
              key={p.id}
              palette={palette}
              title={p.name}
              detail={[p.summary, p.guestMin !== null && p.guestMax !== null ? `${p.guestMin} to ${p.guestMax} guests` : null].filter(Boolean).join(" · ") || null}
              price={p.unit === "booking" ? `${money(p.fromMinor)} a group` : `${money(p.fromMinor)} a guest`}
              selected={p.id === current?.id}
              onPress={() => setOfferId(p.id)}
              fontFamily={themeBoldFace(theme).fontFamily}
              testID={`issue-4490-groups-card-${p.id}`}
            />
          ))}
        </View>
      ) : null}
      {current !== null ? (
        <View style={styles.wrap}>
          {packages.length > 1 ? <EntrySectionLabel palette={palette}>{current.name}</EntrySectionLabel> : (
            <View style={styles.head}>
              <Text style={[styles.subtitle, themeBoldFace(theme), { color: palette.primaryText }]}>{current.name}</Text>
              {current.summary !== null ? <Text style={[styles.summary, { color: palette.secondaryText }]}>{current.summary}</Text> : null}
            </View>
          )}
          <PackageBody key={current.id} {...props} offerId={current.id} />
        </View>
      ) : (
        <Text style={[styles.summary, { color: palette.tertiaryText }]}>Pick a package to see days, times and the price for your group.</Text>
      )}
    </View>
  );
}

function PackageBody({
  brandSlug,
  venueSlug,
  offerId,
  palette,
  theme,
  onBookingBarChange,
}: VenueGroupsPaneProps & { offerId: string }): React.ReactElement {
  const router = useRouter();
  const [cartKey] = useState(venueOfferCartKey);
  const selection = usePackageSelection({ brandSlug, venueSlug, offeringId: offerId, cartKey });
  const offer = selection.offer;
  const quote = selection.quote.status === "ready" ? selection.quote.quote : null;
  const deposit = quote?.payPlan.payModes.includes("deposit") === true && selection.payMode === "deposit" ? quote.payPlan.depositMinor : null;
  const payNow = quote === null || offer === null ? null : formatVenueMoney(deposit ?? quote.totalMinor, quote.currencyCode, offer.exponent);
  const ready = selection.problem === null && quote !== null && selection.choice !== null;
  const label = payNow !== null ? `Continue · ${payNow} now` : "Continue";

  const go = (): void => {
    if (!ready || selection.choice === null) return;
    router.push(
      packageCheckoutPath({
        brandSlug,
        venueSlug,
        offerId,
        ...selection.choice,
        payMode: deposit !== null ? "deposit" : "full",
      }) as never,
    );
  };

  const barKey = `${selection.selectedDate}|${selection.windowId}|${selection.guests}|${payNow}|${ready}|${selection.problem}`;
  useEffect(() => {
    if (onBookingBarChange === undefined) return undefined;
    if (selection.offerState !== "ready" || selection.selectedDate === null || offer?.canCollectOnline === false) {
      onBookingBarChange(null);
      return undefined;
    }
    onBookingBarChange({
      title: entryDateLabel(selection.selectedDate),
      subtitle: selection.problem ?? (payNow !== null ? `${selection.guests} guests · ${payNow} now` : `${selection.guests} guests`),
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
      <PackageForm selection={selection} palette={palette} theme={theme} />
      {selection.offerState === "ready" && offer?.canCollectOnline !== false ? (
        <>
          <EntryButton
            palette={palette}
            theme={theme}
            label={label}
            onPress={go}
            disabled={!ready}
            accessibilityLabel={`${label}, go to checkout`}
            testID="issue-4490-groups-continue"
          />
          <Text style={[styles.reason, { color: selection.problem !== null ? palette.secondaryText : palette.tertiaryText }]} testID="issue-4490-groups-reason">
            {selection.problem ?? "No account needed. You add your details and pay on the next step."}
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
  subtitle: { ...type.h2 },
  summary: { ...type.small },
  empty: { ...type.body, paddingVertical: space[5] },
  reason: { ...type.caption, textAlign: "center" },
});
