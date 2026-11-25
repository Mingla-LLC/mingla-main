/**
 * #4490 P5-3 — the "By the hour" tab (`pk-room`): rooms, courts, tables or
 * lanes booked by the hour, without an account.
 *
 * Pick the place (when the venue sells more than one), the day (closed,
 * booked-up and too-soon days say so), then the start: the day line shows
 * every step from opening to closing as free, taken (dotted and faded, with
 * the word in its label) or yours. How long is a chip per allowed length from
 * that start (no 60-minute cap; never longer than the time free from it), with
 * the live price (per minute, pro rata to the hour price). The page's bar
 * carries "Thu 26 Nov · 14:00–16:00 / 2 hours · ₦24,000" and Continue opens
 * checkout, where the server quotes the exact total with VAT.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingPanel,
  OfferingPanelRow,
  OfferingStepper,
  type OfferingDateTile,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { accentFillWithBorder, accentOutline, themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { opaqueAccentWashColor } from "@mingla/offering-rendering/themePalette";
import type { PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";
import type { VenueFeatureOfferView } from "@mingla/brand-rendering/venueFeaturePage";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import {
  addDays,
  entryDateLabel,
  entryDayTiles,
  venueClock,
  venueOfferErrorCopy,
  venueToday,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { hourLengthWords, hourLengthsFor } from "@mingla/brand-rendering/venueOffers/hireModel";

import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
import { Button } from "../../ui/Button";
import { dayLineCells, hourCheckoutPath, hourPrice } from "./hourGuestModel";

const DAYS = 21;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface VenueHourPaneProps {
  brandSlug: string;
  venueSlug: string;
  offers: readonly VenueFeatureOfferView[];
  currencyCode: string;
  exponent: number;
  palette: ThemePalette;
  theme: ResolvedTheme;
  onBookingBarChange: (bar: PublicVenueReservationBar | null) => void;
}

export function VenueHourPane({
  brandSlug,
  venueSlug,
  offers,
  currencyCode,
  exponent,
  palette,
  theme,
  onBookingBarChange,
}: VenueHourPaneProps): React.ReactElement {
  const router = useRouter();
  const money = (m: number): string => formatVenueMoney(m, currencyCode, exponent);
  const [offerId, setOfferId] = useState<string | null>(offers.length === 1 ? (offers[0]?.id ?? null) : null);
  const [date, setDate] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [guests, setGuests] = useState(1);

  const detail = useQuery({
    queryKey: ["venueHourOffer", brandSlug, venueSlug, offerId],
    enabled: offerId !== null,
    staleTime: 60_000,
    queryFn: () => venueOfferGuestService.offer({ brandSlug, venueSlug, offeringId: offerId ?? "" }),
  });
  const tz = detail.data?.venue.timezone ?? null;
  const today = venueToday(new Date(), tz);
  const days = useQuery({
    queryKey: ["venueHourDays", offerId, today],
    enabled: offerId !== null && detail.data !== undefined,
    staleTime: 30_000,
    queryFn: () => venueOfferGuestService.availability({ offeringId: offerId ?? "", from: today, to: addDays(today, DAYS - 1) }),
  });
  const tiles = useMemo(() => entryDayTiles(days.data ?? [], today, DAYS), [days.data, today]);
  // Land on the first day that can be booked.
  useEffect(() => {
    if (date !== null || days.data === undefined) return;
    const first = tiles.find((t) => t.soldOnline);
    if (first !== undefined) setDate(first.date);
  }, [date, days.data, tiles]);
  const hourDay = useQuery({
    queryKey: ["venueHourDay", offerId, date, guests],
    enabled: offerId !== null && date !== null,
    staleTime: 15_000,
    queryFn: () => venueOfferGuestService.hourDay({ offeringId: offerId ?? "", date: date ?? "", guests }),
  });
  const day = hourDay.data?.day ?? null;
  const priceMinor = hourDay.data?.priceMinor ?? offers.find((o) => o.id === offerId)?.fromMinor ?? null;
  useEffect(() => {
    setStartsAt(null);
    setMinutes(null);
  }, [offerId, date]);
  const lengths = day !== null ? hourLengthsFor(day, startsAt) : [];
  useEffect(() => {
    if (minutes !== null && !lengths.includes(minutes)) setMinutes(lengths[0] ?? null);
    if (minutes === null && lengths.length > 0) setMinutes(lengths[0] ?? null);
  }, [lengths, minutes]);
  const guestMax = Math.max(1, ...(detail.data?.options.map((o) => o.guestMax) ?? [1]));
  const offer = offers.find((o) => o.id === offerId) ?? null;
  const cells = day !== null ? dayLineCells(day, tz, startsAt !== null && minutes !== null ? { startsAt, minutes } : null) : [];
  const ready = offer !== null && date !== null && startsAt !== null && minutes !== null;
  const endIso = ready ? new Date(Date.parse(startsAt) + minutes * 60_000).toISOString() : null;
  const price = ready && priceMinor !== null ? hourPrice(priceMinor, minutes) : null;

  // The page's bar.
  useEffect(() => {
    if (!ready || offer === null || date === null || startsAt === null || minutes === null) {
      onBookingBarChange(null);
      return;
    }
    onBookingBarChange({
      title: `${entryDateLabel(date)} · ${venueClock(startsAt, tz) ?? ""}–${endIso !== null ? (venueClock(endIso, tz) ?? "") : ""}`,
      subtitle: `${hourLengthWords(minutes)}${price !== null ? ` · ${money(price)}` : ""}${guests > 1 ? ` · ${guests} guests` : ""}`,
      ctaLabel: "Continue",
      enabled: true,
      onPress: () => router.push(hourCheckoutPath({ brandSlug, venueSlug, offerId: offer.id, date, startsAt, minutes, guests }) as never),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, offer?.id, date, startsAt, minutes, guests, price, tz, onBookingBarChange]);
  useEffect(() => () => onBookingBarChange(null), [onBookingBarChange]);

  if (offers.length === 0) {
    return (
      <Text style={[styles.body, { color: palette.secondaryText }]} testID="venue-hour-none">
        Nothing is on sale by the hour right now.
      </Text>
    );
  }

  const stripTiles: OfferingDateTile[] = tiles.map((t, index) => ({
    key: t.date,
    top: index === 0 ? "Today" : t.top,
    big: t.big,
    bottom: t.bottom.length > 0 ? (t.state === "full" ? "Booked" : t.bottom) : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === date,
    accessibilityLabel: `${entryDateLabel(t.date)}${t.bottom.length > 0 ? `, ${t.state === "full" ? "booked up" : t.bottom}` : ""}`,
  }));
  const tile = tiles.find((t) => t.date === date) ?? null;
  const nextOpen = tiles.find((t) => t.soldOnline && t.date !== date && (date === null || t.date > date)) ?? null;

  return (
    <View style={styles.host} testID="venue-hour-pane">
      {offers.length > 1 || offerId === null ? (
        <View style={styles.list} accessibilityLabel="What you can book">
          {offers.map((o) => {
            const on = o.id === offerId;
            return (
              <Pressable
                key={o.id}
                onPress={() => setOfferId(o.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${o.name}, ${money(o.fromMinor)} an hour${on ? ", chosen" : ""}`}
                style={[styles.offer, on ? accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }) : { borderColor: palette.panelBorder, backgroundColor: palette.card }]}
                testID={`venue-hour-offer-${o.id}`}
              >
                <View style={styles.offerText}>
                  <Text style={[styles.offerName, themeBoldFace(theme), { color: palette.primaryText }]}>{o.name}</Text>
                  {o.summary !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{o.summary}</Text> : null}
                </View>
                <Text style={[styles.offerPrice, { color: palette.primaryText }]}>{`${money(o.fromMinor)} an hour`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View>
          <Text style={[styles.offerName, themeBoldFace(theme), { color: palette.primaryText }]}>{offer?.name ?? ""}</Text>
          {offer?.summary ? <Text style={[styles.body, { color: palette.secondaryText }]}>{offer.summary}</Text> : null}
          {offer !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{`${money(offer.fromMinor)} an hour`}</Text> : null}
        </View>
      )}

      {offerId === null ? null : detail.isLoading || days.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.body, { color: palette.secondaryText }]}>Finding free days…</Text>
        </View>
      ) : detail.isError || days.isError ? (
        <View style={[styles.card, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            {venueOfferErrorCopy(detail.error instanceof VenueOfferGuestError ? detail.error.code : "offer_request_failed")}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => { void detail.refetch(); void days.refetch(); }} />
        </View>
      ) : (
        <>
          <OfferingDateStrip
            palette={palette}
            tiles={stripTiles}
            onPress={setDate}
            fontFamily={themeBoldFace(theme).fontFamily}
            accessibilityLabel="Choose a day"
            testID="venue-hour-days"
          />
          {guestMax > 1 ? (
            <OfferingPanel palette={palette}>
              <OfferingPanelRow
                palette={palette}
                title="Guests"
                detail={`Up to ${guestMax}`}
                right={
                  <OfferingStepper
                    palette={palette}
                    value={guests}
                    min={1}
                    max={guestMax}
                    onChange={(n: number) => setGuests(Math.min(guestMax, Math.max(1, n)))}
                    decrementLabel="Fewer guests"
                    incrementLabel="More guests"
                    valueLabel={`${guests} ${guests === 1 ? "guest" : "guests"}`}
                  />
                }
              />
            </OfferingPanel>
          ) : null}
          {tile !== null && !tile.soldOnline ? (
            <View style={[styles.card, { borderColor: palette.panelBorder }]} testID="venue-hour-day-closed">
              <Text style={[styles.body, { color: palette.primaryText }]}>
                {tile.state === "full"
                  ? `${entryDateLabel(tile.date)} is booked up.`
                  : tile.state === "too_soon"
                    ? `${entryDateLabel(tile.date)} is too soon to book online.`
                    : tile.state === "not_yet"
                      ? `${entryDateLabel(tile.date)} isn't open for booking yet.`
                      : `${entryDateLabel(tile.date)} is closed.`}
              </Text>
              {nextOpen !== null ? (
                <Button label={`Go on ${entryDateLabel(nextOpen.date)} instead`} variant="secondary" onPress={() => setDate(nextOpen.date)} testID="venue-hour-next-day" />
              ) : null}
            </View>
          ) : hourDay.isLoading || hourDay.isFetching ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
              <Text style={[styles.body, { color: palette.secondaryText }]}>Finding free hours…</Text>
            </View>
          ) : hourDay.isError ? (
            <View style={[styles.card, { borderColor: palette.panelBorder }]}>
              <Text style={[styles.body, { color: palette.secondaryText }]}>We couldn&apos;t load the hours for this day.</Text>
              <Button label="Try again" variant="secondary" onPress={() => void hourDay.refetch()} />
            </View>
          ) : day === null || day.status !== "open" || day.starts.length === 0 ? (
            <View style={[styles.card, { borderColor: palette.panelBorder }]} testID="venue-hour-no-starts">
              <Text style={[styles.body, { color: palette.primaryText }]}>
                {date !== null ? `No free hours on ${entryDateLabel(date)}.` : "Pick a day."}
              </Text>
              {nextOpen !== null ? (
                <Button label={`Try ${entryDateLabel(nextOpen.date)}`} variant="secondary" onPress={() => setDate(nextOpen.date)} />
              ) : null}
            </View>
          ) : (
            <>
              <Text style={[styles.label, { color: palette.tertiaryText }]}>
                {`OPEN ${venueClock(day.opensAt ?? "", tz) ?? ""}–${venueClock(day.closesAt ?? "", tz) ?? ""}`}
              </Text>
              <View style={styles.dayLine} accessibilityLabel="The day at a glance" testID="venue-hour-day-line">
                {cells.map((c) => (
                  <View
                    key={c.startsAt}
                    accessibilityLabel={`${c.label}, ${c.state === "mine" ? "your booking" : c.state === "free" ? "free" : c.state === "closed" ? "too late to start" : "taken"}`}
                    style={[
                      styles.cell,
                      c.state === "mine"
                        ? accentFillWithBorder(palette)
                        : c.state === "free"
                          ? { backgroundColor: palette.card, borderColor: palette.panelBorder }
                          : { borderColor: palette.panelBorder, borderStyle: "dotted", opacity: 0.45 },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.legend}>
                <Text style={[styles.legendText, { color: palette.secondaryText }]}>Filled: yours · Outlined: free · Dotted: taken</Text>
              </View>
              <Text style={[styles.label, { color: palette.tertiaryText }]}>START</Text>
              <OfferingChipRow accessibilityLabel="Choose a start time" testID="venue-hour-starts">
                {cells
                  .filter((c) => c.state !== "closed" || day.starts.some((st) => st.startsAt === c.startsAt))
                  .map((c) => {
                    const free = day.starts.some((s) => s.startsAt === c.startsAt);
                    return (
                      <OfferingChoiceChip
                        key={c.startsAt}
                        palette={palette}
                        label={c.label}
                        note={free ? null : "Taken"}
                        disabled={!free}
                        readableWhenDisabled
                        selected={startsAt === c.startsAt}
                        accessibilityLabel={free ? `Start at ${c.label}` : `${c.label}, taken`}
                        onPress={() => setStartsAt(c.startsAt)}
                      />
                    );
                  })}
              </OfferingChipRow>
              {startsAt !== null ? (
                <>
                  <Text style={[styles.label, { color: palette.tertiaryText }]}>HOW LONG</Text>
                  <OfferingChipRow accessibilityLabel="Choose how long" testID="venue-hour-lengths">
                    {lengths.map((m) => (
                      <OfferingChoiceChip
                        key={m}
                        palette={palette}
                        label={hourLengthWords(m)}
                        note={priceMinor !== null ? money(hourPrice(priceMinor, m)) : null}
                        selected={minutes === m}
                        accessibilityLabel={`${hourLengthWords(m)}${priceMinor !== null ? `, ${money(hourPrice(priceMinor, m))}` : ""}`}
                        onPress={() => setMinutes(m)}
                      />
                    ))}
                  </OfferingChipRow>
                  {day.maxMinutes === null || (day.starts.find((s) => s.startsAt === startsAt)?.maxMinutes ?? 0) < day.maxMinutes ? (
                    <Text style={[styles.body, { color: palette.secondaryText }]}>
                      {`Longer isn't free from ${venueClock(startsAt, tz) ?? "then"}. Pick an earlier start for more time.`}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={[styles.body, { color: palette.secondaryText }]}>Pick a start time.</Text>
              )}
              {ready && price !== null ? (
                <View style={[styles.summary, { borderColor: palette.panelBorder, backgroundColor: palette.accentWash }]} testID="venue-hour-summary">
                  <Text style={[styles.summaryTitle, { color: palette.primaryText }]}>
                    {`${entryDateLabel(date)} · ${venueClock(startsAt, tz) ?? ""}–${endIso !== null ? (venueClock(endIso, tz) ?? "") : ""}`}
                  </Text>
                  <Text style={[styles.body, { color: palette.primaryText }]}>
                    {`${hourLengthWords(minutes)} × ${money(priceMinor ?? 0)} an hour = ${money(price)}`}
                  </Text>
                  <Text style={[styles.body, { color: palette.secondaryText }]}>
                    VAT and the exact total are shown at checkout before you pay. Busy times can cost more.
                  </Text>
                </View>
              ) : null}
            </>
          )}
          {detail.data?.policyText ? (
            <Text style={[styles.caption, { color: palette.tertiaryText }]}>{detail.data.policyText}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 14 },
  list: { gap: 10 },
  offer: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 14, borderRadius: 16, borderWidth: 1 },
  offerText: { flex: 1, minWidth: 0, gap: 2 },
  offerName: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  offerPrice: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 1.2 },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: { gap: 10, padding: 16, borderRadius: 16, borderWidth: 1 },
  dayLine: { flexDirection: "row", gap: 3, alignItems: "stretch" },
  cell: { flex: 1, height: 36, borderRadius: 6, borderWidth: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendText: { fontSize: 13, lineHeight: 18 },
  summary: { gap: 4, padding: 16, borderRadius: 16, borderWidth: 1 },
  summaryTitle: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
});
