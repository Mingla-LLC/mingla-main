/**
 * #4490 P6-3/K — the Plans tab (C §3.6): a card per plan with its name,
 * "{price} a month/year", what you get (three lines, the rest behind "and more"),
 * then Join, which opens the join page. A full plan says so and can't be
 * joined. One plain note says how paying works: the first period today, then
 * an emailed link before each renewal; nothing renews by itself. A guest whose device
 * already holds a membership here gets a way back to their member page.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import type { PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";
import type { VenueFeaturePlanView } from "@mingla/brand-rendering/venueFeaturePage";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";

import { radius, space, type } from "../../../constants/designSystem";
import { EntryButton, EntryNote, entryStyles } from "./EntryUi";
import { memberPagePath, planGiveLines, planJoinPath, readVenueMember } from "./memberGuestModel";

export interface VenuePlansPaneProps {
  brandSlug: string;
  venueSlug: string;
  plans: readonly VenueFeaturePlanView[];
  currencyCode: string;
  exponent: number;
  palette: ThemePalette;
  theme: ResolvedTheme;
  onBookingBarChange: (bar: PublicVenueReservationBar | null) => void;
}

export function VenuePlansPane({
  brandSlug,
  venueSlug,
  plans,
  currencyCode,
  exponent,
  palette,
  theme,
  onBookingBarChange,
}: VenuePlansPaneProps): React.ReactElement {
  const router = useRouter();
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  const [mine, setMine] = useState<{ subscriptionId: string } | null>(null);
  useEffect(() => {
    setMine(readVenueMember(brandSlug, venueSlug));
  }, [brandSlug, venueSlug]);
  const open = useMemo(() => plans.filter((p) => !p.full), [plans]);
  const cheapest = open.length > 0 ? open.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a)) : null;

  useEffect(() => {
    if (cheapest === null) {
      onBookingBarChange(null);
      return undefined;
    }
    onBookingBarChange({
      title: open.length === 1 ? `${cheapest.name} · ${money(cheapest.priceMinor)} a ${cheapest.period}` : `Plans from ${money(cheapest.priceMinor)}`,
      // #4490 fix 3 (N87) — short enough for the docked bar's one line.
      subtitle: "Starts today · no auto-renew",
      ctaLabel: cheapest.joinMode === "request" ? "Ask to join" : open.length === 1 ? "Join" : `Join ${cheapest.name}`,
      enabled: true,
      onPress: () => router.push(planJoinPath(brandSlug, venueSlug, cheapest.id) as never),
    });
    return () => onBookingBarChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheapest?.id, open.length, brandSlug, venueSlug]);

  if (plans.length === 0) {
    return (
      <View style={styles.host} testID="issue-4490-plans-empty">
        <EntryNote palette={palette} icon="star">No plans are on sale right now. Check back soon.</EntryNote>
      </View>
    );
  }

  return (
    <View style={styles.host} testID="issue-4490-plans-pane">
      {mine !== null ? (
        <EntryNote palette={palette} icon="check" tone="success" testID="issue-4490-plans-mine">
          <View style={styles.mineRow}>
            <Text style={[styles.small, { color: palette.primaryText }]}>Your membership here is saved on this device.</Text>
            <EntryButton
              palette={palette}
              theme={theme}
              variant="secondary"
              label="Open my member page"
              onPress={() => router.push(memberPagePath(mine.subscriptionId) as never)}
              testID="issue-4490-plans-open-mine"
            />
          </View>
        </EntryNote>
      ) : null}
      {plans.map((plan) => {
        const lines = planGiveLines(plan);
        const shown = lines.slice(0, 3);
        return (
          <View
            key={plan.id}
            style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID={`issue-4490-plan-${plan.id}`}
          >
            <View style={styles.head}>
              <Text style={[styles.name, themeBoldFace(theme), { color: palette.primaryText }]}>{plan.name}</Text>
              <Text style={[styles.price, themeBoldFace(theme), { color: palette.primaryText }]}>
                {money(plan.priceMinor)}
                <Text style={[styles.small, { color: palette.secondaryText }]}>{` a ${plan.period}`}</Text>
              </Text>
            </View>
            {plan.summary !== null ? <Text style={[styles.small, { color: palette.secondaryText }]}>{plan.summary}</Text> : null}
            {shown.map((line) => (
              <Text key={line} style={[styles.small, { color: palette.primaryText }]}>{`• ${line}`}</Text>
            ))}
            {lines.length > shown.length ? (
              <Text style={[styles.caption, { color: palette.tertiaryText }]}>{`and ${lines.length - shown.length} more`}</Text>
            ) : null}
            {plan.minMonths > 1 ? (
              <Text style={[styles.caption, { color: palette.tertiaryText }]}>{plan.period === "year" ? "1 year minimum" : `${plan.minMonths} months minimum`}</Text>
            ) : null}
            {plan.assignedDeskAvailable ? <Text style={[styles.caption, { color: palette.tertiaryText }]}>An assigned desk may be available.</Text> : null}
            <EntryButton
              palette={palette}
              theme={theme}
              label={plan.full ? "Full right now" : plan.joinMode === "request" ? "Ask to join" : `Join ${plan.name}`}
              disabled={plan.full}
              onPress={() => router.push(planJoinPath(brandSlug, venueSlug, plan.id) as never)}
              testID={`issue-4490-plan-join-${plan.id}`}
            />
          </View>
        );
      })}
      <EntryNote palette={palette} icon="mail" testID="issue-4490-plans-note">
        Nothing renews or is charged by itself. Instant plans take the first payment when you join; request plans wait for the venue to approve you first.
      </EntryNote>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4] },
  head: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space[2] },
  name: { ...type.h2, flexShrink: 1 },
  price: { ...type.body },
  small: { ...type.small },
  caption: { ...type.caption },
  mineRow: { gap: space[2], borderRadius: radius.md },
});
