// issue #4420 — "Book a time": the experience page's inline decide area
// (design file → P.exp.decide). Date strip, then times, then people, right on
// the page, so the buyer sees the whole choice before the glass bar says
// "Continue". The rules are NOT here: the route owns one
// useExperienceReserveState (shared with the Reserve sheet) and hands it in,
// and the bar reads the same state's `selection` and `total`.
//
//   slots mode       a day tile picks the day; the time chips are that day's
//                    occurrences ("N left" / struck through when full).
//   open-daily mode  a day tile picks that day's window; the time chips are
//                    the spacing grid inside it (live spots when counted per
//                    start); block hires add "How long"; people is a stepper.
//
// Pure: react-native + this package only (no data client; the route injects
// the slot fetcher into the hook).

import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { experienceBlockLengthLabel, experiencePriceBasisLabel } from "./experiencePriceBasis";
import { experienceRemainingChipText } from "./experienceR3";
import {
  experienceReserveDays,
  experienceReserveTotal,
  experienceStartTimeLabel,
  type ExperienceReserveDate,
  type ExperienceReserveMode,
} from "./experienceReserveModel";
import {
  experienceZoneCityLabel,
  experienceZoneDiffersFromViewer,
  formatExperienceMinute,
} from "./experienceTimeZone";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingPanel,
  OfferingPanelRow,
  OfferingStepper,
} from "./OfferingDecideParts";
import { OfferingSectionTitle, OfferingSubLabel } from "./OfferingSectionTitle";
import { boldFontFamily, type ThemePalette } from "./themePalette";
import type { ExperienceReserveState } from "./useExperienceReserveState";

export interface ExperienceInlinePickerProps {
  state: ExperienceReserveState;
  mode: ExperienceReserveMode;
  dates: ReadonlyArray<ExperienceReserveDate>;
  timezone: string;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The currency the price falls back to when an option carries none. */
  currency?: string | null;
  testID?: string;
}

const windowLabel = (startAt: string, endAt: string, tz: string): string => {
  const s = experienceStartTimeLabel(startAt, tz);
  const e = experienceStartTimeLabel(endAt, tz);
  return s.length > 0 && e.length > 0 ? `${s} – ${e}` : s;
};

export const ExperienceInlinePicker: React.FC<ExperienceInlinePickerProps> = ({
  state,
  mode,
  dates,
  timezone,
  palette,
  theme,
  currency = null,
  testID = "issue-4420-experience-inline-picker",
}) => {
  const boldFamily = boldFontFamily(theme);
  const days = useMemo(
    () => experienceReserveDays(dates, timezone),
    [dates, timezone],
  );
  // The chosen day. In slots mode a day can hold several occurrences, so the
  // day is picked first and the time chip picks the occurrence.
  const [dayKey, setDayKey] = useState<string | null>(null);
  const selectedDayKey =
    dayKey ??
    (state.selectedDate !== null
      ? days.find((d) => d.dates.some((x) => x.id === state.selectedDateId))?.key ?? null
      : null);
  const day = days.find((d) => d.key === selectedDayKey) ?? null;

  const pickDay = (key: string): void => {
    const next = days.find((d) => d.key === key);
    if (next === undefined) return;
    setDayKey(key);
    const open = next.dates.filter(
      (d) => d.ticketsRemaining === null || d.ticketsRemaining > 0,
    );
    if (mode === "open-daily") {
      state.selectDate(open[0]?.id ?? null);
      return;
    }
    // slots: one bookable occurrence that day → chosen at once.
    state.selectDate(open.length === 1 ? open[0].id : null);
  };

  const showOptions = state.optionList.length > 1;
  const zoneCity = experienceZoneCityLabel(timezone);
  const showZone = experienceZoneDiffersFromViewer(timezone) && zoneCity.length > 0;

  const unitPrice = experienceReserveTotal({
    unitCents: state.activeUnitCents,
    currency: state.selectedOption?.currency ?? currency,
    isBlock: false,
    isGroup: true,
    blocks: null,
    party: 1,
  });
  const unitDetail =
    unitPrice !== null
      ? `${unitPrice} ${experiencePriceBasisLabel(
          state.selectedOption?.priceBasis,
          state.selectedOption?.blockMinutes,
        )}`
      : null;
  const partyDetail = state.isGroupOption
    ? `Up to ${state.partyMax} people`
    : unitDetail ?? (state.partyMax < 12 ? `Up to ${state.partyMax}` : null);

  return (
    <View style={styles.root} testID={testID}>
      <OfferingSectionTitle palette={palette} theme={theme}>
        Book a time
      </OfferingSectionTitle>
      <View style={styles.stack}>
        {showOptions ? (
          <View>
            <OfferingSubLabel palette={palette}>Price</OfferingSubLabel>
            <OfferingChipRow
              accessibilityLabel="Choose a price"
              testID={`${testID}-options`}
            >
              {state.optionList.map((opt) => (
                <OfferingChoiceChip
                  key={opt.ticketTypeId}
                  palette={palette}
                  label={`${opt.name} · ${experiencePriceBasisLabel(opt.priceBasis, opt.blockMinutes)}`}
                  selected={state.selectedOption?.ticketTypeId === opt.ticketTypeId}
                  onPress={() => state.selectOption(opt.ticketTypeId)}
                  testID={`${testID}-option-${opt.ticketTypeId}`}
                />
              ))}
            </OfferingChipRow>
          </View>
        ) : null}

        <View>
          <OfferingSubLabel palette={palette}>Date</OfferingSubLabel>
          {days.length === 0 ? (
            <Text style={[styles.hint, { color: palette.secondaryText }]}>
              No upcoming dates available.
            </Text>
          ) : (
            <OfferingDateStrip
              palette={palette}
              fontFamily={boldFamily}
              accessibilityLabel="Choose a date"
              testID={`${testID}-days`}
              onPress={pickDay}
              tiles={days.map((d) => ({
                key: d.key,
                top: d.weekday,
                big: d.dayNumber,
                bottom: d.full ? "Full" : d.month,
                disabled: d.full,
                selected: d.key === selectedDayKey,
                accessibilityLabel: `${d.weekday} ${d.dayNumber} ${d.month}${d.full ? ", full" : ""}`,
              }))}
            />
          )}
        </View>

        <View>
          <OfferingSubLabel palette={palette}>
            {mode === "open-daily" && state.selectedDate !== null
              ? `Time · ${windowLabel(state.selectedDate.startAt, state.selectedDate.endAt, timezone)}${showZone ? ` · ${zoneCity} time` : ""}`
              : showZone
                ? `Time · ${zoneCity} time`
                : "Time"}
          </OfferingSubLabel>
          {day === null ? (
            <Text style={[styles.hint, { color: palette.secondaryText }]}>
              Pick a date to see times.
            </Text>
          ) : mode === "slots" ? (
            <OfferingChipRow accessibilityLabel="Choose a time" testID={`${testID}-times`}>
              {day.dates.map((occ) => {
                const full = occ.ticketsRemaining !== null && occ.ticketsRemaining <= 0;
                return (
                  <OfferingChoiceChip
                    key={occ.id}
                    palette={palette}
                    label={experienceStartTimeLabel(occ.startAt, timezone)}
                    note={full ? null : experienceRemainingChipText(occ.ticketsRemaining)}
                    selected={state.selectedDateId === occ.id}
                    disabled={full}
                    onPress={() => state.selectDate(occ.id)}
                    testID={`${testID}-time-${occ.id}`}
                  />
                );
              })}
            </OfferingChipRow>
          ) : state.timeChoices.length === 0 ? (
            <Text style={[styles.hint, { color: palette.secondaryText }]}>
              No times left on this day. Pick another date.
            </Text>
          ) : (
            <OfferingChipRow accessibilityLabel="Choose a time" testID={`${testID}-times`}>
              {state.timeChoices.map((min) => {
                const rem = state.slotRemainingByMinute.get(min);
                const full = typeof rem === "number" && rem <= 0;
                return (
                  <OfferingChoiceChip
                    key={min}
                    palette={palette}
                    label={formatExperienceMinute(min)}
                    note={full ? null : experienceRemainingChipText(typeof rem === "number" ? rem : null)}
                    selected={state.selectedMinute === min}
                    disabled={full}
                    onPress={() => state.selectMinute(min)}
                    testID={`${testID}-minute-${min}`}
                  />
                );
              })}
            </OfferingChipRow>
          )}
        </View>

        {mode === "open-daily" && state.isBlockOption && state.selectedMinute !== null ? (
          <View>
            <OfferingSubLabel palette={palette}>How long</OfferingSubLabel>
            <OfferingChipRow accessibilityLabel="How long" testID={`${testID}-how-long`}>
              {state.blockChoices.map((n) => (
                <OfferingChoiceChip
                  key={n}
                  palette={palette}
                  label={experienceBlockLengthLabel(n, state.blockMinutes)}
                  selected={state.selectedBlocks === n}
                  onPress={() => state.selectBlocks(n)}
                  testID={`${testID}-blocks-${n}`}
                />
              ))}
            </OfferingChipRow>
          </View>
        ) : null}

        {mode === "open-daily" ? (
          <OfferingPanel palette={palette} testID={`${testID}-people`}>
            <OfferingPanelRow
              palette={palette}
              title="People"
              detail={partyDetail}
              fontFamily={boldFamily}
              right={
                <OfferingStepper
                  palette={palette}
                  value={state.party}
                  min={1}
                  max={state.partyMax}
                  onChange={(n) => state.setParty(n)}
                  decrementLabel="Fewer people"
                  incrementLabel="More people"
                  valueLabel={`${state.party} ${state.party === 1 ? "person" : "people"}`}
                  fontFamily={boldFamily}
                  testID={`${testID}-party`}
                />
              }
            />
          </OfferingPanel>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { marginTop: 28 },
  stack: { gap: 22 },
  hint: { fontSize: 13.5, lineHeight: 19 },
});

export default ExperienceInlinePicker;
