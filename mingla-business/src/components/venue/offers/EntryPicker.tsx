/**
 * #4490 P2 — "Plan your visit": the day strip, a stepper per price, the ID
 * reminder, the summary with VAT per the venue's mode, and the refund terms.
 *
 * Every day state is drawn and explained, never hidden: a closed, full,
 * gate-only, too-late or not-yet day stays tappable and says why, with a
 * one-tap "Go on {next open day}". A price that does not apply that day (a
 * weekday price, a time-limited price) stays visible, dimmed, with the rule.
 * Steppers stay inside each price's guest range; the button below them waits
 * with the reason in words.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingPanel,
  OfferingStepper,
  type OfferingDateTile,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import {
  entryDateLabel,
  entryDayNotice,
  entryOptionName,
  idCheckNote,
  optionUnavailableLine,
  stepCount,
  summaryLines,
  vatModeLine,
  venueOfferErrorCopy,
  windowText,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";

import { radius, size, space, type } from "../../../constants/designSystem";
import {
  EntryButton,
  EntryNote,
  EntryProblem,
  EntrySectionLabel,
  EntrySummaryRows,
  type EntryThemeProps,
} from "./EntryUi";
import type { EntrySelection } from "./useEntrySelection";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface EntryPickerProps extends EntryThemeProps {
  selection: EntrySelection;
  /** Show the summary (lines and total). The checkout draws it in its own card. */
  showSummary?: boolean;
  testID?: string;
}

export function EntryPicker({
  selection,
  palette,
  theme,
  showSummary = true,
  testID = "issue-4490-entry-picker",
}: EntryPickerProps): React.ReactElement {
  const { offer } = selection;

  if (selection.offerState === "loading") {
    return (
      <View style={styles.skeletonWrap} testID={`${testID}-loading`} accessibilityLabel="Loading prices">
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
        title="We couldn't load this"
        body={venueOfferErrorCopy(selection.offerError)}
        actionLabel="Try again"
        onAction={selection.retryOffer}
        testID={`${testID}-offer-error`}
      />
    );
  }

  const money = (minor: number): string => formatVenueMoney(minor, offer.currencyCode, offer.exponent);
  const tile = selection.selectedTile;
  const dayNotice = tile === null ? null : entryDayNotice(tile);
  const stripTiles: OfferingDateTile[] = selection.tiles.map((t, index) => ({
    key: t.date,
    top: index === 0 ? "Today" : t.top,
    big: t.big,
    bottom: t.bottom.length > 0 ? t.bottom : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === selection.selectedDate,
    accessibilityLabel: `${entryDateLabel(t.date)}${t.bottom.length > 0 ? `, ${t.bottom}` : ""}`,
  }));
  const idNote = idCheckNote(selection.optionRows, selection.counts);
  const vatLine = vatModeLine(offer.vat);
  const quote = selection.quote;

  return (
    <View style={styles.wrap} testID={testID}>
      <EntrySectionLabel palette={palette}>Plan your visit</EntrySectionLabel>
      {selection.daysState === "error" ? (
        <EntryProblem
          palette={palette}
          theme={theme}
          title="We couldn't load the days on sale"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={selection.retryDays}
          testID={`${testID}-days-error`}
        />
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

      {/* #4490 fix 2 (N85) — a timed-session day: one chip per session with
          places left; started sessions read "Past" and can't be picked. */}
      {tile !== null && tile.soldOnline && selection.sessions.length > 0 ? (
        <View style={styles.block} testID={`${testID}-sessions`}>
          <EntrySectionLabel palette={palette}>Pick a time</EntrySectionLabel>
          <OfferingChipRow accessibilityLabel="Choose a session">
            {selection.sessions.map((session) => (
              <OfferingChoiceChip
                key={session.windowId}
                palette={palette}
                label={session.label}
                note={session.note}
                selected={selection.selectedSession?.windowId === session.windowId}
                disabled={!session.usable}
                readableWhenDisabled
                onPress={() => selection.selectSession(session.windowId)}
                accessibilityLabel={`${session.rangeText ?? session.label}, ${session.note}`}
                testID={`${testID}-session-${session.label.replace(":", "")}`}
              />
            ))}
          </OfferingChipRow>
        </View>
      ) : null}

      {tile !== null && tile.row !== null && tile.soldOnline ? (
        <Text style={[styles.dayLine, { color: palette.secondaryText }]} testID={`${testID}-day-line`}>
          {`${entryDateLabel(tile.date)} · ${windowText(tile.row, offer.venue.timezone) ?? "Any time we're open"}${
            tile.state === "few_left" ? ` · Only ${tile.row.remaining} left online` : ""
          }`}
        </Text>
      ) : null}

      {dayNotice !== null && tile !== null ? (
        <View style={styles.block}>
          <EntryNote
            palette={palette}
            icon={tile.state === "full" ? "users" : tile.state === "closed" ? "calendar" : "clock"}
            tone="warning"
            testID={`${testID}-day-notice`}
          >
            {dayNotice}
          </EntryNote>
          {selection.nextOpen !== null ? (
            <EntryButton
              palette={palette}
              theme={theme}
              variant="secondary"
              label={`Go on ${entryDateLabel(selection.nextOpen)} instead`}
              onPress={() => selection.selectDate(selection.nextOpen as string)}
              testID={`${testID}-next-open`}
            />
          ) : (
            <Text style={[styles.hint, { color: palette.secondaryText }]}>
              No other day in the next two months is on sale online yet.
            </Text>
          )}
        </View>
      ) : null}

      {tile !== null && tile.soldOnline ? (
        <OfferingPanel palette={palette} testID={`${testID}-options`}>
          {selection.optionRows.map((row) => {
            const count = selection.counts[row.option.id] ?? 0;
            const detail = [row.dayPriced ? `${money(row.priceMinor)} each` : null, row.rule].filter(Boolean).join(" · ");
            const others = selection.guests - count;
            const max = Math.min(
              row.option.guestMax,
              Math.max(0, (tile.row?.remaining ?? row.option.guestMax) - others),
            );
            return (
              <View
                key={row.option.id}
                style={[styles.optionRow, row.usable ? null : styles.dimmed]}
                testID={`${testID}-option-${row.option.id}`}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.optionName, themeBoldFace(theme), { color: palette.primaryText }]}>
                    {entryOptionName(row.option)}
                  </Text>
                  <Text style={[styles.optionDetail, { color: palette.secondaryText }]}>{detail}</Text>
                  {!row.usable && selection.selectedDate !== null ? (
                    <Text style={[styles.optionDetail, { color: palette.secondaryText }]}>
                      {optionUnavailableLine(row, selection.selectedDate)}
                    </Text>
                  ) : count > 0 && count >= max && max < row.option.guestMax ? (
                    <Text style={[styles.optionDetail, { color: palette.secondaryText }]}>
                      {`Only ${max} left that day.`}
                    </Text>
                  ) : count > 0 && count >= row.option.guestMax ? (
                    <Text style={[styles.optionDetail, { color: palette.secondaryText }]}>
                      {`Up to ${row.option.guestMax} per booking.`}
                    </Text>
                  ) : null}
                </View>
                <OfferingStepper
                  palette={palette}
                  value={row.usable ? count : 0}
                  min={0}
                  max={row.usable ? Math.max(0, max) : 0}
                  onChange={(next) =>
                    selection.setCount(row.option.id, stepCount(row.option, count, next > count ? 1 : -1))
                  }
                  decrementLabel={`One fewer ${row.option.name}`}
                  incrementLabel={`One more ${row.option.name}`}
                  valueLabel={`${count} ${row.option.name}`}
                  testID={`${testID}-stepper-${row.option.id}`}
                />
              </View>
            );
          })}
        </OfferingPanel>
      ) : null}

      {idNote !== null && tile?.soldOnline ? (
        <EntryNote palette={palette} icon="shield" testID={`${testID}-id-note`}>
          {idNote}
        </EntryNote>
      ) : null}

      {showSummary && tile?.soldOnline ? (
        quote.status === "ready" ? (
          <EntrySummaryRows
            palette={palette}
            theme={theme}
            lines={summaryLines(quote.quote.lines, {
              currencyCode: quote.quote.currencyCode,
              exponent: offer.exponent,
              taxMinor: quote.quote.taxMinor,
              feeMinor: quote.quote.feeMinor,
              totalMinor: quote.quote.totalMinor,
              vatMode: quote.quote.vatMode,
              vatRatePct: quote.quote.vatRatePct,
            })}
            testID={`${testID}-summary`}
          />
        ) : quote.status === "loading" ? (
          <Text style={[styles.hint, { color: palette.secondaryText }]} testID={`${testID}-quoting`}>
            Working out your total…
          </Text>
        ) : quote.status === "error" ? (
          <EntryNote palette={palette} icon="flag" tone="error" testID={`${testID}-quote-error`}>
            <Text style={[styles.noteText, { color: palette.primaryText }]}>
              {venueOfferErrorCopy(quote.code, quote.remaining)}
            </Text>
            {/* #4490: the way forward is a real button, never an inline text link. */}
            <EntryButton
              palette={palette}
              theme={theme}
              variant="secondary"
              label="Check again"
              onPress={selection.retryQuote}
              testID={`${testID}-quote-retry`}
            />
          </EntryNote>
        ) : null
      ) : null}

      {vatLine !== null && quote.status !== "ready" && tile?.soldOnline ? (
        <Text style={[styles.hint, { color: palette.tertiaryText }]}>{vatLine}</Text>
      ) : null}
      {offer.policyText !== null ? (
        <Text style={[styles.hint, { color: palette.tertiaryText }]} testID={`${testID}-policy`}>
          {`Refunds: ${offer.policyText}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  block: { gap: space[2] },
  skeletonWrap: { gap: space[3] },
  skeleton: { height: size.btn.xl, borderRadius: radius.md },
  stripSkeleton: { height: size.btn.xl + space[4], borderRadius: radius.md },
  dayLine: { ...type.small },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[2],
  },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionName: { ...type.row },
  optionDetail: { ...type.caption },
  dimmed: { opacity: 0.55 },
  hint: { ...type.caption },
  noteText: { ...type.small },
  link: { ...type.small, textDecorationLine: "underline" },
});
