/**
 * #4490 P4-3 — choosing a private hire: how many guests (a stepper up to the
 * largest space), the day (free / on hold / taken per day, never free text),
 * the session, then the space or spaces together that fit (site plan when
 * the venue drew one, and a list: name, "Fits 60 – 150 · Covered", price,
 * and why a place can't be asked for). Spaces too small for the group are
 * filtered with one line saying so, never an error.
 *
 * Used by the venue page's Private hire tab and the request page.
 * Anonymous: no `useAuth`.
 */
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingStepper,
  type OfferingDateTile,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { entryDateLabel, venueClock, venueOfferErrorCopy } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  hourLengthWords,
  hirePriceWords,
  placeFitsLine,
  placeUnavailableLine,
  type HirePlaceOption,
} from "@mingla/brand-rendering/venueOffers/hireModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { EntryButton, EntryNote, EntryProblem, EntrySectionLabel, type EntryThemeProps } from "./EntryUi";
import type { HireSelection } from "./useHireSelection";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface HireFormProps extends EntryThemeProps {
  selection: HireSelection;
  /** Show the day, session and place pickers (the request page shows a summary instead). */
  compact?: boolean;
  testID?: string;
}

export function HireForm({ selection, palette, theme, compact = false, testID = "issue-4490-hire" }: HireFormProps): React.ReactElement {
  const { offer } = selection;
  const [clampNote, setClampNote] = React.useState<string | null>(null);
  const tones = statusOn(palette);
  const hair = neutralHair(palette);
  if (selection.offerState === "loading") {
    return (
      <View style={styles.skeletonWrap} testID={`${testID}-loading`} accessibilityLabel="Loading private hire">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.skeleton, { backgroundColor: palette.panel }]} />
        ))}
      </View>
    );
  }
  if (selection.offerState === "error" || offer === null) {
    return (
      <EntryProblem
        palette={palette}
        theme={theme}
        title="We couldn't load private hire"
        body={venueOfferErrorCopy(selection.offerError)}
        actionLabel="Try again"
        onAction={selection.retryOffer}
        testID={`${testID}-error`}
      />
    );
  }
  const money = (m: number): string => formatVenueMoney(m, offer.currencyCode, offer.exponent);
  const stripTiles: OfferingDateTile[] = selection.tiles.map((t) => ({
    key: t.date,
    top: t.date === selection.today ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${t.date}T12:00:00Z`)),
    big: String(Number(t.date.slice(8, 10))),
    bottom: t.word.length > 0 ? t.word : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === selection.selectedDate,
    disabled: t.state === "none",
    accessibilityLabel: `${entryDateLabel(t.date)}${t.word.length > 0 ? `, ${t.word}` : ", nothing to hire"}`,
  }));
  const plan = selection.media.filter((m) => m.planShape !== null);
  const selected = selection.selectedPlace;
  const selectedSpaceIds = new Set<string>(
    selected === null
      ? []
      : selected.spaceId !== null
        ? [selected.spaceId]
        : offer.combinations.find((c) => c.id === selected.combinationId)?.spaceIds ?? [],
  );

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.facts}>
        <Text style={[styles.price, themeBoldFace(theme), { color: palette.primaryText }]}>{hirePriceWords(offer)}</Text>
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {[
            `${selection.range.min.toLocaleString("en-GB")} to ${selection.range.max.toLocaleString("en-GB")} guests`,
            offer.mode === "request" ? `By request · reply within ${offer.requestResponseHours} hours` : "Book instantly",
            offer.damageDepositMinor > 0 ? `${money(offer.damageDepositMinor)} refundable damage deposit` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      {!offer.canCollectOnline ? (
        <EntryNote palette={palette} icon="flag" tone="warning" testID={`${testID}-venue-only`}>
          Private hire is booked with the venue directly right now. Contact the venue to ask for a date.
        </EntryNote>
      ) : null}

      <EntrySectionLabel palette={palette}>Guests</EntrySectionLabel>
      <View style={styles.guestsRow}>
        <View style={styles.grow}>
          <Text style={[styles.row, themeBoldFace(theme), { color: palette.primaryText }]}>{`${selection.guests.toLocaleString("en-GB")} guests`}</Text>
          <Text style={[styles.small, { color: palette.secondaryText }]}>{`Up to ${selection.range.max.toLocaleString("en-GB")} in the biggest space`}</Text>
        </View>
        <OfferingStepper
          palette={palette}
          value={selection.guests}
          min={selection.range.min}
          max={selection.range.max}
          onChange={(n) => {
            setClampNote(null);
            selection.setGuests(n);
          }}
          typeable
          onClamp={(typed, clamped) =>
            setClampNote(
              typed > clamped
                ? `${typed.toLocaleString("en-GB")} is more than any space here takes, so we set ${clamped.toLocaleString("en-GB")}.`
                : `The smallest group here is ${clamped.toLocaleString("en-GB")}, so we set ${clamped.toLocaleString("en-GB")}.`,
            )
          }
          decrementLabel="One guest fewer"
          incrementLabel="One guest more"
          valueLabel={`${selection.guests} guests. Type a number or use minus and plus`}
          testID={`${testID}-guests`}
        />
      </View>
      {clampNote !== null ? (
        <Text style={[styles.small, { color: palette.secondaryText }]} accessibilityLiveRegion="polite" testID={`${testID}-guests-clamped`}>
          {clampNote}
        </Text>
      ) : null}
      {clampNote === null && selection.guests >= selection.range.max ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{`${selection.range.max.toLocaleString("en-GB")} is the most any space here takes.`}</Text>
      ) : null}

      {compact ? null : (
        <>
          <EntrySectionLabel palette={palette}>Pick a day</EntrySectionLabel>
          {selection.daysState === "error" ? (
            <EntryProblem palette={palette} theme={theme} title="We couldn't load the days" body="Check your connection and try again." actionLabel="Try again" onAction={selection.retryDays} testID={`${testID}-days-error`} />
          ) : selection.daysState === "loading" ? (
            <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading days" />
          ) : (
            <>
              <OfferingDateStrip
                palette={palette}
                tiles={stripTiles}
                onPress={selection.selectDate}
                fontFamily={themeBoldFace(theme).fontFamily}
                accessibilityLabel="Choose a day"
                testID={`${testID}-day`}
              />
              <View style={styles.pagerRow}>
                <EntryButton palette={palette} theme={theme} variant="secondary" label="Earlier days" onPress={selection.earlier} disabled={!selection.canGoEarlier} testID={`${testID}-earlier`} />
                <EntryButton palette={palette} theme={theme} variant="secondary" label="Later days" onPress={selection.later} testID={`${testID}-later`} />
              </View>
            </>
          )}

          {selection.selectedDate !== null && selection.daysState === "ready" ? (
            <>
              <EntrySectionLabel palette={palette}>{`Session · ${entryDateLabel(selection.selectedDate)}`}</EntrySectionLabel>
              {selection.sessions.length === 0 ? (
                <Text style={[styles.small, { color: palette.secondaryText }]}>Nothing to hire that day. Pick another day.</Text>
              ) : (
                <OfferingChipRow accessibilityLabel="Choose a session" testID={`${testID}-sessions`}>
                  {selection.sessions.map((s) => (
                    <OfferingChoiceChip
                      key={s.windowId}
                      palette={palette}
                      label={`${s.label}${s.times !== null ? ` ${s.times}` : ""}`}
                      note={s.note}
                      selected={s.windowId === selection.windowId}
                      disabled={!s.usable}
                      onPress={() => selection.selectWindow(s.windowId)}
                      role="radio"
                      accessibilityLabel={`${s.label}${s.times !== null ? `, ${s.times}` : ""}${s.note !== null ? `, ${s.note}` : ""}`}
                      testID={`${testID}-session-${s.label.replace(/\s+/g, "-").toLowerCase()}`}
                    />
                  ))}
                </OfferingChipRow>
              )}
            </>
          ) : null}

          {selection.isFlex && selection.hourDay !== null ? (
            <>
              <EntrySectionLabel palette={palette}>Start time</EntrySectionLabel>
              <OfferingChipRow accessibilityLabel="Choose a start time" testID={`${testID}-flex-starts`}>
                {selection.hourDay.starts.map((x) => {
                  const clock = venueClock(x.startsAt, offer.venue.timezone) ?? "—";
                  return (
                    <OfferingChoiceChip
                      key={x.startsAt}
                      palette={palette}
                      label={clock}
                      note={null}
                      selected={x.startsAt === selection.startsAt}
                      onPress={() => selection.selectStart(x.startsAt)}
                      role="radio"
                      accessibilityLabel={`Start at ${clock}`}
                      testID={`${testID}-flex-start-${clock.replace(":", "")}`}
                    />
                  );
                })}
              </OfferingChipRow>
              {selection.startsAt !== null ? (
                <>
                  <EntrySectionLabel palette={palette}>How long</EntrySectionLabel>
                  <OfferingChipRow accessibilityLabel="Choose how long" testID={`${testID}-flex-lengths`}>
                    {selection.lengths.map((m) => (
                      <OfferingChoiceChip
                        key={m}
                        palette={palette}
                        label={hourLengthWords(m)}
                        note={null}
                        selected={m === selection.minutes}
                        onPress={() => selection.selectMinutes(m)}
                        role="radio"
                        accessibilityLabel={hourLengthWords(m)}
                        testID={`${testID}-flex-length-${m}`}
                      />
                    ))}
                  </OfferingChipRow>
                  <Text style={[styles.small, { color: palette.secondaryText }]}>{`At least ${hourLengthWords(selection.hourDay.minMinutes)}.`}</Text>
                </>
              ) : null}
            </>
          ) : null}

          {selection.windowId !== null && !(selection.isFlex && (selection.startsAt === null || selection.minutes === null)) ? (
            <>
              <EntrySectionLabel palette={palette}>Choose your space</EntrySectionLabel>
              {selection.placesState === "error" ? (
                <EntryProblem palette={palette} theme={theme} title="We couldn't load the spaces" body="Check your connection and try again." actionLabel="Try again" onAction={selection.retryPlaces} testID={`${testID}-places-error`} />
              ) : selection.placesState === "loading" ? (
                <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading spaces" />
              ) : (
                <>
                  {plan.length > 0 ? (
                    <View style={[styles.plan, { borderColor: hair, backgroundColor: palette.panel }]} accessibilityLabel="Site plan" testID={`${testID}-plan`}>
                      {plan.map((m) => {
                        const sp = offer.spaces.find((s) => s.id === m.id);
                        const shape = m.planShape;
                        if (sp === undefined || shape === null) return null;
                        const on = selectedSpaceIds.has(m.id);
                        const usable = selection.places.shown.some((p) => p.status === "available" && (p.spaceId === m.id || offer.combinations.find((c) => c.id === p.combinationId)?.spaceIds.includes(m.id) === true));
                        return (
                          <View
                            key={m.id}
                            style={[
                              styles.planShape,
                              {
                                left: `${shape.x}%`,
                                top: `${shape.y}%`,
                                width: `${shape.w}%`,
                                height: `${shape.h}%`,
                                borderColor: on ? palette.primaryText : hair,
                                borderWidth: on ? 2 : 1,
                                backgroundColor: on ? palette.accentWash : palette.card,
                                opacity: usable || on ? 1 : 0.45,
                              },
                            ]}
                            accessibilityLabel={`${sp.name}${on ? ", your choice" : usable ? ", free" : ", not for your group"}`}
                          >
                            <Text style={[styles.planText, { color: palette.primaryText }]} numberOfLines={2}>{sp.name}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  <View style={styles.places} accessibilityRole="radiogroup" accessibilityLabel="Choose your space" testID={`${testID}-places`}>
                    {selection.places.shown.map((p) => (
                      <PlaceCard
                        key={p.priceOptionId}
                        place={p}
                        photo={photoFor(p, selection, offer.combinations)}
                        selected={p.priceOptionId === selection.optionId}
                        onPress={() => selection.selectOption(p.priceOptionId)}
                        money={money}
                        guests={selection.guests}
                        palette={palette}
                        fontFamily={themeBoldFace(theme).fontFamily}
                        tones={tones}
                        hair={hair}
                        testID={`${testID}-place-${p.priceOptionId}`}
                      />
                    ))}
                  </View>
                  {selection.places.hiddenLine !== null ? (
                    <Text style={[styles.small, { color: palette.secondaryText }]} testID={`${testID}-hidden-line`}>{selection.places.hiddenLine}</Text>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </>
      )}

      {offer.policyText !== null ? (
        <Text style={[styles.caption, { color: palette.tertiaryText }]} testID={`${testID}-policy`}>{`If you cancel: ${offer.policyText}.`}</Text>
      ) : null}
    </View>
  );
}

function photoFor(p: HirePlaceOption, selection: HireSelection, combos: ReadonlyArray<{ id: string; spaceIds: string[] }>): string | null {
  const ids = p.spaceId !== null ? [p.spaceId] : combos.find((c) => c.id === p.combinationId)?.spaceIds ?? [];
  for (const id of ids) {
    const url = selection.media.find((m) => m.id === id)?.photoUrls[0];
    if (url !== undefined) return url;
  }
  return null;
}

function PlaceCard({
  place,
  photo,
  selected,
  onPress,
  money,
  guests,
  palette,
  fontFamily,
  tones,
  hair,
  testID,
}: {
  place: HirePlaceOption;
  photo: string | null;
  selected: boolean;
  onPress: () => void;
  money: (m: number) => string;
  guests: number;
  palette: EntryThemeProps["palette"];
  fontFamily: string | undefined;
  tones: ReturnType<typeof statusOn>;
  hair: string;
  testID: string;
}): React.ReactElement {
  const why = placeUnavailableLine(place);
  const free = place.status === "available";
  const price = place.unit === "guest" ? `${money(place.priceMinor)} a guest` : place.unit === "hour" ? `${money(place.priceMinor)} an hour` : money(place.priceMinor);
  const extra = free && guests > place.guestMax ? `${guests - place.guestMax} above this price's range: extra guests cost more` : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!free}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !free }}
      accessibilityLabel={`${place.placeName}, ${placeFitsLine(place)}, ${price}${why !== null ? `, ${why}` : ", free"}`}
      style={({ pressed }) => [
        styles.card,
        { borderColor: selected ? palette.primaryText : hair, backgroundColor: palette.card, opacity: free ? 1 : 0.6 },
        selected ? styles.cardSelected : null,
        pressed && free ? styles.pressed : null,
      ]}
      testID={testID}
    >
      {photo !== null ? <Image source={{ uri: photo }} style={styles.photo} accessibilityIgnoresInvertColors /> : null}
      <View style={styles.cardText}>
        <Text style={[styles.row, { color: palette.primaryText, fontFamily }]} numberOfLines={2}>{place.placeName}</Text>
        <Text style={[styles.small, { color: palette.secondaryText }]}>{placeFitsLine(place)}</Text>
        {why !== null ? (
          <Text style={[styles.small, { color: place.status === "held" ? tones.warning.text : palette.secondaryText }]}>{why}</Text>
        ) : (
          <Text style={[styles.small, { color: tones.success.text }]}>{extra ?? "Free"}</Text>
        )}
      </View>
      <Text style={[styles.row, { color: palette.primaryText, fontFamily }]}>{price}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  facts: { gap: space[1] },
  price: { ...type.h2 },
  small: { ...type.small },
  caption: { ...type.caption },
  row: { ...type.row },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  guestsRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  pagerRow: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  skeletonWrap: { gap: space[3] },
  skeleton: { height: size.btn.xl, borderRadius: radius.md },
  stripSkeleton: { height: size.btn.xl + space[4], borderRadius: radius.md },
  plan: { width: "100%", aspectRatio: 16 / 9, borderWidth: 1, borderRadius: radius.md, position: "relative", overflow: "hidden" },
  planShape: { position: "absolute", borderRadius: radius.sm, padding: space[1], justifyContent: "center", alignItems: "center" },
  planText: { ...type.caption, textAlign: "center" },
  places: { gap: space[2] },
  card: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, minHeight: size.btn.xl },
  cardSelected: { borderWidth: 2 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  photo: { width: 56, height: 56, borderRadius: radius.sm },
  pressed: { opacity: 0.85 },
});
