/**
 * #4490 P2-4 — one freely named price option of an Entry offer (`ed-entry`,
 * `ed-entry-err`). Smart fields only: name (the one free text, 40 with a
 * counter, no default), money in the brand currency (or Free), weekday chips,
 * an ID check with a picked label, an hours window and busy-time prices with
 * the 24-hour time field, and a stepper for the most guests on one booking.
 * Errors sit under their fields; nothing typed is lost.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { IconChrome } from "../../../ui/IconChrome";
import { Input } from "../../../ui/Input";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper } from "../../../ui/NumberStepper";
import { SelectSheet } from "../../../ui/SelectSheet";
import { TimeField } from "../../../ui/TimeField";
import { WeekdayChips } from "../../../ui/WeekdayChips";
import { MenuTextCounter } from "../../MenuTextCounter";
import type { EntryStyle } from "../../../../types/venueOffers";
import { draftKey, multiDayPassSummary, optionIssues, optionNameOrDefault, type BusyRuleDraft, type PriceOptionDraft } from "./offersModel";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const OPTION_NAME_MAX = 40;

// #4490 fix 2 (N77): Age 21+ and Government ID beside the student choices.
const ID_LABELS = [
  "Student ID",
  "NYSC ID",
  "Student or NYSC ID",
  "Age 18+",
  "Age 21+",
  "Government ID",
  "Other",
] as const;

export interface PriceOptionCardProps {
  index: number;
  option: PriceOptionDraft;
  currency: string | null;
  /** The venue's day limit (bounds "most guests"); 0 = not set yet. */
  dailyLimit: number;
  entryStyle: EntryStyle;
  showErrors: boolean;
  canRemove: boolean;
  disabled?: boolean;
  onChange: (next: PriceOptionDraft) => void;
  onRemove: () => void;
}

export function PriceOptionCard({
  index,
  option,
  currency,
  dailyLimit,
  entryStyle,
  showErrors,
  canRemove,
  disabled = false,
  onChange,
  onRemove,
}: PriceOptionCardProps): React.ReactElement {
  const issues = optionIssues(option, dailyLimit > 0 ? dailyLimit : null);
  const patch = (next: Partial<PriceOptionDraft>): void => onChange({ ...option, ...next });
  const idPreset = (ID_LABELS as readonly string[]).includes(option.idLabel) ? option.idLabel : option.idLabel.length > 0 ? "Other" : null;
  const [otherLabel, setOtherLabel] = useState(idPreset === "Other");
  // #4490 fix 2 (N70): the days come from "When it's on sale"; a price only
  // asks for its own days when the host picks "Only some days".
  const everyDay = ALL_DAYS.every((d) => option.weekdays.includes(d));
  const [someDays, setSomeDays] = useState(!everyDay);
  const nameId = `price-option-${option.key}-name`;
  const counterId = `price-option-${option.key}-count`;
  const tid = `price-option-${index}`;

  const patchBusy = (key: string, next: Partial<BusyRuleDraft>): void =>
    patch({ busyRules: option.busyRules.map((r) => (r.key === key ? { ...r, ...next } : r)) });

  return (
    <View style={styles.card} testID={tid}>
      <View style={styles.head}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {optionNameOrDefault(option.name, index)}
        </Text>
        {canRemove ? (
          <IconChrome
            icon="trash"
            size={36}
            accessibilityLabel={`Remove ${option.name.trim().length > 0 ? option.name.trim() : `price ${index + 1}`}`}
            onPress={onRemove}
            disabled={disabled}
            testID={`${tid}-remove`}
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label} nativeID={nameId}>Name (optional)</Text>
        <Input
          value={option.name}
          onChangeText={(name) => patch({ name: name.slice(0, OPTION_NAME_MAX) })}
          placeholder={`Optional. Shown as "${optionNameOrDefault("", index)}" if blank`}
          accessibilityLabel={`Price ${index + 1} name`}
          disabled={disabled}
          error={showErrors ? issues.name : null}
          testID={`${tid}-name`}
        />
        <MenuTextCounter used={option.name.length} limit={OPTION_NAME_MAX} nativeID={counterId} />
      </View>

      <View style={styles.field}>
        <View style={styles.inlineRow}>
          <View style={styles.grow}>
            {option.free ? (
              <Text style={styles.freeNote}>Free entry on this price.</Text>
            ) : (
              <MoneyField
                label="Price per guest"
                valueMinor={option.priceMinor}
                onChangeMinor={(priceMinor) => patch({ priceMinor })}
                currency={currency}
                noCurrency={<Text style={styles.error}>Set your payout country in Settings first, so prices have a currency.</Text>}
                disabled={disabled}
                error={showErrors ? issues.price : null}
                testID={`${tid}-price`}
              />
            )}
          </View>
          <View style={styles.freeSwitch}>
            <Text style={styles.label}>Free</Text>
            <BrandSwitch
              value={option.free}
              onValueChange={(free) => patch({ free })}
              disabled={disabled}
              accessibilityLabel={`Price ${index + 1} is free`}
              testID={`${tid}-free`}
            />
          </View>
        </View>
      </View>


      <View style={styles.field}>
        <NumberStepper
          label="Most guests on one booking"
          value={option.guestMax}
          min={1}
          max={dailyLimit > 0 ? dailyLimit : 100000}
          onChange={(guestMax) => patch({ guestMax })}
          testID={`${tid}-guest-max`}
        />
        {showErrors && issues.guestMax !== null ? <Text style={styles.error}>{issues.guestMax}</Text> : null}
      </View>

      {entryStyle !== "timed_session" ? (
        <View style={styles.subCard} testID={`${tid}-multi-day`}>
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <Text style={styles.switchTitle}>Good for more than one day</Text>
              <Text style={styles.hint}>The guest picks the start day. Later days use space when they check in.</Text>
            </View>
            <BrandSwitch
              value={option.multiDay}
              onValueChange={(multiDay) => patch({ multiDay })}
              disabled={disabled}
              accessibilityLabel="Good for more than one day"
              testID={`${tid}-multi-day-switch`}
            />
          </View>
          {option.multiDay ? (
            <View style={styles.field}>
              <NumberStepper
                label="Days"
                value={option.passDays}
                min={2}
                max={60}
                onChange={(passDays) => patch({ passDays, passWindowDays: Math.max(passDays, option.passWindowDays) })}
                testID={`${tid}-pass-days`}
              />
              <NumberStepper
                label="Within"
                value={option.passWindowDays}
                min={option.passDays}
                max={365}
                onChange={(passWindowDays) => patch({ passWindowDays })}
                testID={`${tid}-pass-window-days`}
              />
              <Text style={styles.hint}>{multiDayPassSummary(option.passDays, option.passWindowDays, true)}</Text>
              {showErrors && issues.pass !== null ? <Text style={styles.error}>{issues.pass}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* #4490 fix 2 (N77): the extras row sits ABOVE what it adds and its
          buttons never disappear (an added extra reads "added" and is off),
          so nothing moves under the pointer when one is added. */}
      <View style={styles.actions}>
        <Button
          label={someDays ? "Some days added" : "Only some days"}
          variant="ghost"
          size="sm"
          leadingIcon="calendar"
          onPress={() => setSomeDays(true)}
          disabled={disabled || someDays}
          testID={`${tid}-add-days`}
        />
        <Button
          label={option.idCheck ? "ID check added" : "Add an ID check"}
          variant="ghost"
          size="sm"
          leadingIcon="shield"
          onPress={() => patch({ idCheck: true })}
          disabled={disabled || option.idCheck}
          testID={`${tid}-add-id`}
        />
        <Button
          label={option.limitHours ? "Hours limited" : "Limit the hours"}
          variant="ghost"
          size="sm"
          leadingIcon="clock"
          onPress={() => patch({ limitHours: true })}
          disabled={disabled || option.limitHours}
          testID={`${tid}-add-hours`}
        />
        <Button
          label="Add a busy-time price"
          variant="ghost"
          size="sm"
          leadingIcon="trending"
          onPress={() =>
            patch({
              busyRules: [
                ...option.busyRules,
                { key: draftKey("busy"), weekdays: [4, 5], from: "18:00", to: "23:00", amountMinor: null },
              ],
            })
          }
          disabled={disabled || option.busyRules.length >= 10}
          testID={`${tid}-add-busy`}
        />
      </View>

      {someDays ? (
        <View style={styles.subCard}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchTitle, styles.grow]}>Only on these days</Text>
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              onPress={() => {
                setSomeDays(false);
                patch({ weekdays: ALL_DAYS });
              }}
              disabled={disabled}
              testID={`${tid}-days-remove`}
            />
          </View>
          <WeekdayChips
            label="Days this price can be used"
            value={option.weekdays}
            onChange={(weekdays) => patch({ weekdays })}
            disabled={disabled}
            showSummary
            testID={`${tid}-days`}
          />
          {showErrors && issues.weekdays !== null ? <Text style={styles.error}>{issues.weekdays}</Text> : null}
        </View>
      ) : null}

      {option.idCheck ? (
        <View style={styles.subCard}>
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <Text style={styles.switchTitle}>Check ID at the gate</Text>
              <Text style={styles.hint}>Guests are told before they pay. Staff are asked to check it.</Text>
            </View>
            <BrandSwitch
              value
              onValueChange={(on) => patch({ idCheck: on, idLabel: on ? option.idLabel : "" })}
              disabled={disabled}
              accessibilityLabel="Check ID at the gate"
              testID={`${tid}-id-switch`}
            />
          </View>
          <SelectSheet
            label="ID to ask for"
            value={otherLabel ? "Other" : idPreset}
            options={ID_LABELS.map((l) => ({ value: l, label: l }))}
            onChange={(picked) => {
              if (picked === "Other") {
                setOtherLabel(true);
                patch({ idLabel: "" });
              } else {
                setOtherLabel(false);
                patch({ idLabel: picked });
              }
            }}
            placeholder="Pick one"
            hasError={showErrors && issues.idLabel !== null && !otherLabel}
            disabled={disabled}
            testID={`${tid}-id-label`}
          />
          {otherLabel ? (
            <Input
              value={option.idLabel}
              onChangeText={(idLabel) => patch({ idLabel: idLabel.slice(0, 40) })}
              placeholder="e.g. Staff card"
              accessibilityLabel="ID to ask for"
              disabled={disabled}
              error={showErrors ? issues.idLabel : null}
              testID={`${tid}-id-other`}
            />
          ) : showErrors && issues.idLabel !== null ? (
            <Text style={styles.error}>{issues.idLabel}</Text>
          ) : null}
        </View>
      ) : null}

      {option.limitHours ? (
        <View style={styles.subCard}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchTitle, styles.grow]}>Only at these hours</Text>
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              onPress={() => patch({ limitHours: false, startTime: "", endTime: "" })}
              disabled={disabled}
              testID={`${tid}-hours-remove`}
            />
          </View>
          <View style={styles.inlineRow}>
            <View style={styles.grow}>
              <TimeField
                label="From"
                value={option.startTime}
                onChangeValue={(startTime) => patch({ startTime })}
                accessibilityLabel={`${option.name || "Price"} from`}
                hasError={showErrors && issues.hours !== null}
                disabled={disabled}
                testID={`${tid}-from`}
              />
            </View>
            <View style={styles.grow}>
              <TimeField
                label="Until"
                value={option.endTime}
                onChangeValue={(endTime) => patch({ endTime })}
                accessibilityLabel={`${option.name || "Price"} until`}
                hasError={showErrors && issues.hours !== null}
                disabled={disabled}
                testID={`${tid}-until`}
              />
            </View>
          </View>
          {showErrors && issues.hours !== null ? <Text style={styles.error}>{issues.hours}</Text> : null}
        </View>
      ) : null}

      {option.busyRules.map((rule, ruleIndex) => (
        <View key={rule.key} style={styles.subCard} testID={`${tid}-busy-${ruleIndex}`}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchTitle, styles.grow]}>Busy-time price {ruleIndex + 1}</Text>
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              onPress={() => patch({ busyRules: option.busyRules.filter((r) => r.key !== rule.key) })}
              disabled={disabled}
            />
          </View>
          <WeekdayChips value={rule.weekdays} onChange={(weekdays) => patchBusy(rule.key, { weekdays })} disabled={disabled} label="Days" />
          <View style={styles.inlineRow}>
            <View style={styles.grow}>
              <TimeField
                label="From"
                value={rule.from}
                onChangeValue={(from) => patchBusy(rule.key, { from })}
                accessibilityLabel={`Busy-time price ${ruleIndex + 1} from`}
                disabled={disabled}
              />
            </View>
            <View style={styles.grow}>
              <TimeField
                label="Until"
                value={rule.to}
                onChangeValue={(to) => patchBusy(rule.key, { to })}
                accessibilityLabel={`Busy-time price ${ruleIndex + 1} until`}
                disabled={disabled}
              />
            </View>
          </View>
          <MoneyField
            label="Price at that time"
            valueMinor={rule.amountMinor}
            onChangeMinor={(amountMinor) => patchBusy(rule.key, { amountMinor })}
            currency={currency}
            disabled={disabled}
            error={showErrors && rule.amountMinor === null ? "Enter the price at that time" : null}
          />
        </View>
      ))}
      {showErrors && issues.busy !== null ? <Text style={styles.error}>{issues.busy}</Text> : null}

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  cardTitle: { ...type.row, color: color.text1, flexShrink: 1 },
  field: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  inlineRow: { flexDirection: "row", gap: space[3], alignItems: "flex-start", flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 140 },
  freeSwitch: { alignItems: "flex-start", gap: space[1], paddingTop: 2 },
  freeNote: { ...type.small, color: color.text2, paddingVertical: space[3] },
  subCard: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  switchTitle: { ...type.row, color: color.text1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
