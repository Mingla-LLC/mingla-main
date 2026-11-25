/**
 * #4490 P3-3 — booking one group package: the day (days inside the lead time
 * explained, never hidden), the start time (a taken time says so), the group
 * size (stepper inside the package's range, no 50 cap), the choice guests
 * make, extras, "How you pay" (Half now / All now when the package takes a
 * deposit), and the server's total with VAT, pay now and pay later.
 *
 * Used in the venue page's Groups pane; the checkout re-reads the same
 * selection from its address. Anonymous: no `useAuth`.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingStepper,
  type OfferingDateTile,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import { entryDateLabel, venueOfferErrorCopy } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  depositWords,
  durationLine,
  durationText,
  leadText,
  nextOpenPackageDate,
  packageDayNotice,
  packagePriceWords,
  packageSummaryLines,
  untilWords,
  venueDayOf,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { EntryButton, EntryNote, EntryProblem, EntrySectionLabel, EntrySummaryRows, type EntryThemeProps } from "./EntryUi";
import { ExtrasList } from "./ExtrasList";
import { PayModeChoice } from "./PayModeChoice";
import type { PackageSelection } from "./usePackageSelection";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PackageFormProps extends EntryThemeProps {
  selection: PackageSelection;
  /** Show the summary and pay mode (the checkout draws its own). */
  showSummary?: boolean;
  testID?: string;
}

export function PackageForm({ selection, palette, theme, showSummary = true, testID = "issue-4490-package" }: PackageFormProps): React.ReactElement {
  const { offer } = selection;
  // #4490 N32: a typed count below the smallest group is raised, and said so.
  const [raisedTo, setRaisedTo] = React.useState<number | null>(null);
  if (selection.offerState === "loading") {
    return (
      <View style={styles.skeletonWrap} testID={`${testID}-loading`} accessibilityLabel="Loading the package">
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
        title="We couldn't load this package"
        body={venueOfferErrorCopy(selection.offerError)}
        actionLabel="Try again"
        onAction={selection.retryOffer}
        testID={`${testID}-error`}
      />
    );
  }

  const money = (m: number): string => formatVenueMoney(m, offer.currencyCode, offer.exponent);
  const tz = offer.venue.timezone;
  const tile = selection.selectedTile;
  const notice = tile === null ? null : packageDayNotice(tile, offer.minNoticeMinutes);
  const nextOpen = selection.selectedDate === null ? null : nextOpenPackageDate(selection.tiles, selection.selectedDate);
  const stripTiles: OfferingDateTile[] = selection.tiles.map((t, index) => ({
    key: t.date,
    top: index === 0 ? "Today" : t.top,
    big: t.big,
    bottom: t.state === "too_soon" ? "Too soon" : t.bottom.length > 0 ? t.bottom : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === selection.selectedDate,
    accessibilityLabel: `${entryDateLabel(t.date)}${t.state === "too_soon" ? ", too soon to book" : t.bottom.length > 0 ? `, ${t.bottom}` : ""}`,
  }));
  const chosenRow = selection.rows.find((r) => r.windowId === selection.windowId) ?? null;
  // "change it until …" only while that moment is still ahead.
  const changeAt =
    chosenRow !== null && offer.guestChangeUntilMinutes !== null
      ? Date.parse(chosenRow.startsAt) - offer.guestChangeUntilMinutes * 60_000
      : NaN;
  const changeUntil = !Number.isNaN(changeAt) && changeAt > Date.now() ? untilWords(new Date(changeAt).toISOString(), tz) : null;
  const choices = offer.inclusions.filter((i) => i.kind === "choice");
  const included = offer.inclusions.filter((i) => i.kind !== "choice");
  const quote = selection.quote.status === "ready" ? selection.quote.quote : null;
  const plan = quote?.payPlan ?? null;
  const depositOffered = offer.payModes.includes("deposit") && (plan === null || plan.payModes.includes("deposit"));
  const deposit = plan?.depositMinor ?? null;
  const later = quote !== null && deposit !== null ? quote.totalMinor - deposit : null;
  const laterBy = venueDayOf(plan?.balanceDueAt ?? null, tz);
  const unit = offer.options.length === 1 && offer.options[0].unit === "booking" ? "booking" : "guest";

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.facts}>
        <Text style={[styles.price, themeBoldFace(theme), { color: palette.primaryText }]}>
          {packagePriceWords(offer, (o) => o.unit ?? "guest")}
        </Text>
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {[`${selection.range.min} to ${selection.range.max} guests`, durationText(offer.durationMinutes), offer.minNoticeMinutes ? `book ${leadText(offer.minNoticeMinutes)} ahead` : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {included.length > 0 ? (
          <View style={styles.included} testID={`${testID}-included`}>
            {included.map((i, n) => (
              <Text key={`${i.label}-${n}`} style={[styles.small, { color: palette.primaryText }]}>
                {`•  ${i.label}${i.kind === "staff" && i.staffRatio !== null ? ` (1 for every ${i.staffRatio} guests)` : ""}`}
              </Text>
            ))}
            {choices.map((c) => (
              <Text key={c.label} style={[styles.small, { color: palette.primaryText }]}>
                {`•  ${c.label}: you choose ${c.options.join(", ")}`}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {!offer.canCollectOnline ? (
        <EntryNote palette={palette} icon="flag" tone="warning" testID={`${testID}-venue-only`}>
          Group bookings are taken at the venue only right now. Contact the venue to book this package.
        </EntryNote>
      ) : null}

      <EntrySectionLabel palette={palette}>Pick a day</EntrySectionLabel>
      {selection.daysState === "error" ? (
        <EntryProblem palette={palette} theme={theme} title="We couldn't load the days" body="Check your connection and try again." actionLabel="Try again" onAction={selection.retryDays} testID={`${testID}-days-error`} />
      ) : selection.daysState === "loading" ? (
        <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading days" />
      ) : (
        <OfferingDateStrip
          palette={palette}
          tiles={stripTiles}
          onPress={selection.selectDate}
          fontFamily={themeBoldFace(theme).fontFamily}
          accessibilityLabel="Choose a day"
          testID={`${testID}-day`}
        />
      )}
      {notice !== null ? (
        <View style={styles.block}>
          <EntryNote palette={palette} icon="calendar" tone="warning" testID={`${testID}-day-notice`}>
            {notice}
          </EntryNote>
          {nextOpen !== null ? (
            <EntryButton
              palette={palette}
              theme={theme}
              variant="secondary"
              label={`Go on ${entryDateLabel(nextOpen)} instead`}
              onPress={() => selection.selectDate(nextOpen)}
              testID={`${testID}-next-open`}
            />
          ) : null}
        </View>
      ) : null}

      {tile !== null && tile.soldOnline ? (
        <>
          <EntrySectionLabel palette={palette}>Start time</EntrySectionLabel>
          <OfferingChipRow accessibilityLabel="Choose a start time" testID={`${testID}-times`}>
            {selection.chips.map((c) => (
              <OfferingChoiceChip
                key={c.windowId}
                palette={palette}
                label={c.time}
                note={c.note}
                selected={c.windowId === selection.windowId}
                disabled={!c.usable}
                onPress={() => selection.selectWindow(c.windowId)}
                role="radio"
                accessibilityLabel={`${c.time}${c.note !== null ? `, ${c.note}` : ""}`}
                testID={`${testID}-time-${c.time}`}
              />
            ))}
          </OfferingChipRow>
          {chosenRow !== null ? (
            <Text style={[styles.small, { color: palette.secondaryText }]} testID={`${testID}-duration`}>
              {durationLine(chosenRow, offer.durationMinutes, tz)}
            </Text>
          ) : selection.chips.length > 0 && selection.chips.every((c) => !c.usable) ? (
            <Text style={[styles.small, { color: palette.secondaryText }]}>Every start time that day is taken. Pick another day.</Text>
          ) : null}

          <EntrySectionLabel palette={palette}>Guests</EntrySectionLabel>
          <View style={styles.guestsRow}>
            <View style={styles.grow}>
              <Text style={[styles.row, themeBoldFace(theme), { color: palette.primaryText }]}>{`${selection.guests} guests`}</Text>
              <Text style={[styles.small, { color: palette.secondaryText }]}>
                {`${selection.range.min} to ${selection.range.max} guests${changeUntil !== null ? ` · change it until ${changeUntil}` : ""}`}
              </Text>
            </View>
            <OfferingStepper
              palette={palette}
              value={selection.guests}
              min={selection.range.min}
              max={selection.range.max}
              onChange={(n) => {
                setRaisedTo(null);
                selection.setGuests(n);
              }}
              typeable
              onClamp={(typed, clamped) => setRaisedTo(typed < clamped ? clamped : null)}
              decrementLabel="One guest fewer"
              incrementLabel="One guest more"
              valueLabel={`${selection.guests} guests. Type a number or use minus and plus`}
              testID={`${testID}-guests`}
            />
          </View>
          {raisedTo !== null ? (
            <Text style={[styles.small, { color: palette.secondaryText }]} accessibilityLiveRegion="polite">{`The smallest group for this package is ${raisedTo}, so we set ${raisedTo}.`}</Text>
          ) : null}
          {selection.guests >= selection.range.max ? (
            <Text style={[styles.small, { color: palette.secondaryText }]}>{`${selection.range.max} is the most for this package. For more, ask the venue.`}</Text>
          ) : null}

          {choices.map((c, qi) => (
            <View key={c.label} style={styles.block} testID={`${testID}-choice-${qi}`}>
              <EntrySectionLabel palette={palette}>{c.label}</EntrySectionLabel>
              <OfferingChipRow accessibilityLabel={c.label}>
                {c.options.map((o, oi) => (
                  <OfferingChoiceChip
                    key={o}
                    palette={palette}
                    label={o}
                    selected={selection.answers[qi] === oi}
                    onPress={() => selection.setAnswer(qi, oi)}
                    role="radio"
                    testID={`${testID}-choice-${qi}-${oi}`}
                  />
                ))}
              </OfferingChipRow>
            </View>
          ))}

          <ExtrasList
            palette={palette}
            theme={theme}
            extras={offer.extras}
            picked={selection.extras}
            onToggle={selection.toggleExtra}
            currencyCode={offer.currencyCode}
            exponent={offer.exponent}
            testID={`${testID}-extras`}
          />

          {depositOffered && showSummary ? (
            <PayModeChoice
              palette={palette}
              value={selection.payMode}
              onChange={selection.setPayMode}
              depositLabel={depositWords(
                plan ?? { depositKind: offer.deposit.kind, depositValue: offer.deposit.value, depositMinor: null },
                offer.currencyCode,
                offer.exponent,
              )}
              depositAmount={deposit !== null ? money(deposit) : null}
              fullAmount={quote !== null ? money(quote.totalMinor) : null}
              laterLine={later !== null && later > 0 ? `Then ${money(later)}${laterBy !== null ? ` by ${laterBy}` : " later"}` : null}
              fontFamily={themeBoldFace(theme).fontFamily}
              testID={`${testID}-pay-mode`}
            />
          ) : null}
          {plan?.collapsed === "balance_due_passed" && offer.payModes.includes("deposit") ? (
            <Text style={[styles.small, { color: palette.secondaryText }]}>This day is close, so it's paid in full now.</Text>
          ) : null}

          {showSummary ? (
            quote !== null ? (
              <EntrySummaryRows
                palette={palette}
                theme={theme}
                lines={packageSummaryLines(quote, {
                  exponent: offer.exponent,
                  offerName: offer.name,
                  guests: selection.guests,
                  unit,
                  payNowMinor: selection.payMode === "deposit" && depositOffered && deposit !== null ? deposit : null,
                  laterMinor: later,
                  laterBy,
                })}
                testID={`${testID}-summary`}
              />
            ) : selection.quote.status === "loading" ? (
              <Text style={[styles.small, { color: palette.secondaryText }]} testID={`${testID}-quoting`}>
                Working out your total…
              </Text>
            ) : selection.quote.status === "error" ? (
              <EntryNote palette={palette} icon="flag" tone="error" testID={`${testID}-quote-error`}>
                <Text style={[styles.small, { color: palette.primaryText }]}>
                  {venueOfferErrorCopy(selection.quote.code, selection.quote.remaining)}
                </Text>
                <EntryButton palette={palette} theme={theme} variant="secondary" label="Check again" onPress={selection.retryQuote} />
              </EntryNote>
            ) : null
          ) : null}
        </>
      ) : null}

      {offer.policyText !== null ? (
        <Text style={[styles.caption, { color: palette.tertiaryText }]} testID={`${testID}-policy`}>
          {`Refunds: ${offer.policyText}.`}
          {offer.moveUntilMinutes !== null ? ` Move your day up to ${leadText(offer.moveUntilMinutes)} before.` : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  block: { gap: space[2] },
  facts: { gap: space[1] },
  included: { gap: 2, paddingTop: space[1] },
  price: { ...type.h2 },
  small: { ...type.small },
  caption: { ...type.caption },
  row: { ...type.row },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  guestsRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  skeletonWrap: { gap: space[3] },
  skeleton: { height: size.btn.xl, borderRadius: radius.md },
  stripSkeleton: { height: size.btn.xl + space[4], borderRadius: radius.md },
});
