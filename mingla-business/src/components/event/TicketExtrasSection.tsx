/**
 * issue #3281 — the Extras section of the ticket tier sheet.
 *
 * Sits after Capacity and before Visibility (#3283 design §4). Rendered only
 * inside the lazy TicketTierEditSheet chunk, so it adds nothing to the eager
 * create-flow payload. One extra is open for editing at a time; the rest show
 * a one-line summary. The server prices and enforces every rule; the sentences
 * here come from `validateTicketExtra`, which mirrors the database.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  MultiDateEntry,
  TicketExtraStub,
} from "../../store/draftEventStore";
import { formatDraftDayScopeLabel } from "../../utils/ticketDayScope";
import {
  emptyExtra,
  MAX_EXTRAS_PER_TIER,
  validateTicketExtra,
} from "../../utils/ticketExtras";
import { Button } from "../ui/Button";

export interface TicketExtrasSectionProps {
  extras: readonly TicketExtraStub[];
  onChange: (next: TicketExtraStub[]) => void;
  tierName: string;
  tierIsFree: boolean;
  currencyCode: string;
  formatPrice: (major: number) => string;
  /** The dates this tier admits, in order. Null on a single-date event. */
  tierDayEntries: readonly MultiDateEntry[] | null;
}

const isWholeNumberText = (value: string): boolean => /^\d{0,6}$/.test(value);
const isPriceText = (value: string): boolean =>
  /^\d{0,7}(\.\d{0,2})?$/.test(value);

export const extraSummaryLine = (
  extra: TicketExtraStub,
  formatPrice: (major: number) => string,
  tierDayEntries: readonly MultiDateEntry[] | null,
): string => {
  const parts = [extra.priceGbp > 0 ? formatPrice(extra.priceGbp) : "Free"];
  const days =
    tierDayEntries === null
      ? null
      : formatDraftDayScopeLabel(tierDayEntries, extra.validDayIds);
  if (days !== null) parts.push(days);
  parts.push(extra.isUnlimited ? "Unlimited" : String(extra.capacity ?? 0));
  return parts.join(" · ");
};

export const TicketExtrasSection: React.FC<TicketExtrasSectionProps> = ({
  extras,
  onChange,
  tierName,
  tierIsFree,
  currencyCode,
  formatPrice,
  tierDayEntries,
}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [priceText, setPriceText] = useState("");
  const [capacityText, setCapacityText] = useState("");
  const [maxText, setMaxText] = useState("1");

  const open = (extra: TicketExtraStub): void => {
    setOpenId(extra.id);
    setPriceText(extra.priceGbp > 0 ? String(extra.priceGbp) : "");
    setCapacityText(extra.capacity === null ? "" : String(extra.capacity));
    setMaxText(String(extra.maxPerTicket));
  };
  const update = (id: string, patch: Partial<TicketExtraStub>): void =>
    onChange(
      extras.map((extra) => (extra.id === id ? { ...extra, ...patch } : extra)),
    );
  const add = (): void => {
    const extra = emptyExtra();
    onChange([...extras, extra]);
    open(extra);
  };
  const remove = (id: string): void => {
    onChange(extras.filter((extra) => extra.id !== id));
    if (openId === id) setOpenId(null);
  };

  // Several dates to choose from only when the tier admits more than one.
  const choosableDays =
    tierDayEntries !== null && tierDayEntries.length > 1
      ? tierDayEntries
      : null;
  const singleDay =
    tierDayEntries !== null && tierDayEntries.length === 1
      ? formatDraftDayScopeLabel(tierDayEntries, [tierDayEntries[0].id])
      : null;

  return (
    <View>
      <Text style={styles.sectionHeader}>Extras</Text>
      {extras.length === 0 ? (
        <Text style={styles.helperHint}>
          Sell something with this ticket, like a dinner seat or a shuttle.
          Guests see it once they pick this ticket.
        </Text>
      ) : null}

      {extras.map((extra) => {
        const problem = validateTicketExtra(extra, { tierIsFree });
        const sold = extra.soldCount ?? 0;
        const isOpen = openId === extra.id;
        if (!isOpen) {
          return (
            <Pressable
              key={extra.id}
              onPress={() => open(extra)}
              accessibilityRole="button"
              accessibilityLabel={`Edit extra ${extra.name || "without a name"}`}
              style={[styles.row, problem !== null && styles.rowError]}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {extra.name.trim() || "New extra"}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {extraSummaryLine(extra, formatPrice, tierDayEntries)}
                {sold > 0 ? ` · ${sold} sold` : ""}
              </Text>
              {problem !== null ? (
                <Text style={styles.helperError}>{problem}</Text>
              ) : null}
            </Pressable>
          );
        }
        return (
          <View key={extra.id} style={styles.editor}>
            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={extra.name}
                onChangeText={(name) => update(extra.id, { name })}
                placeholder="Friday dinner"
                placeholderTextColor={textTokens.quaternary}
                maxLength={120}
                style={styles.textInput}
                accessibilityLabel="Extra name"
              />
            </View>

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={extra.description ?? ""}
                onChangeText={(text) =>
                  update(extra.id, {
                    description: text.length > 0 ? text : null,
                  })
                }
                placeholder="Three courses, seated at 20:00"
                placeholderTextColor={textTokens.quaternary}
                maxLength={280}
                style={styles.textInput}
                accessibilityLabel="Extra description"
              />
            </View>

            <Text style={styles.fieldLabel}>Price ({currencyCode})</Text>
            <View
              style={[
                styles.inputWrap,
                (sold > 0 || tierIsFree) && styles.inputWrapDisabled,
              ]}
            >
              <TextInput
                value={priceText}
                editable={sold === 0 && !tierIsFree}
                onChangeText={(value) => {
                  if (!isPriceText(value)) return;
                  setPriceText(value);
                  const parsed = value === "" ? 0 : Number(value);
                  update(extra.id, {
                    priceGbp: Number.isFinite(parsed) ? parsed : 0,
                  });
                }}
                placeholder="0"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={styles.textInput}
                accessibilityLabel={`Extra price in ${currencyCode}`}
              />
            </View>
            <Text style={styles.helperHint}>
              {sold > 0
                ? "Extras people already bought keep their price."
                : tierIsFree
                  ? "A free ticket can only have free extras."
                  : "Leave it at 0 for a free extra. You still cap how many go out."}
            </Text>

            <Pressable
              onPress={() => {
                const isUnlimited = !extra.isUnlimited;
                update(extra.id, {
                  isUnlimited,
                  capacity: isUnlimited ? null : Number(capacityText) || null,
                });
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: extra.isUnlimited }}
              accessibilityLabel="Unlimited capacity for this extra"
              style={styles.toggleRow}
            >
              <View style={styles.toggleLabelCol}>
                <Text style={styles.toggleLabel}>Unlimited capacity</Text>
                <Text style={styles.toggleSub}>
                  No cap on how many of this extra you sell.
                </Text>
              </View>
              <View
                style={[
                  styles.toggleTrack,
                  extra.isUnlimited && styles.toggleTrackOn,
                ]}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    extra.isUnlimited
                      ? styles.toggleThumbOn
                      : styles.toggleThumbOff,
                  ]}
                />
              </View>
            </Pressable>

            {!extra.isUnlimited ? (
              <>
                <Text style={styles.fieldLabel}>Capacity</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={capacityText}
                    onChangeText={(value) => {
                      if (!isWholeNumberText(value)) return;
                      setCapacityText(value);
                      update(extra.id, {
                        capacity: value === "" ? null : Number(value),
                      });
                    }}
                    placeholder="40"
                    placeholderTextColor={textTokens.quaternary}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    style={styles.textInput}
                    accessibilityLabel="Extra capacity"
                  />
                </View>
                {extra.validDayIds !== null ? (
                  <Text style={styles.helperHint}>
                    Each chosen date can sell this many.
                  </Text>
                ) : null}
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Most per ticket</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={maxText}
                onChangeText={(value) => {
                  if (!isWholeNumberText(value)) return;
                  setMaxText(value);
                  update(extra.id, {
                    maxPerTicket: value === "" ? 0 : Number(value),
                  });
                }}
                placeholder="1"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="number-pad"
                selectTextOnFocus
                style={styles.textInput}
                accessibilityLabel="Most of this extra per ticket"
              />
            </View>

            {singleDay !== null ? (
              <Text style={styles.helperHint}>
                {tierName.trim() || "This ticket"} is {singleDay} only, so this
                extra is too.
              </Text>
            ) : null}
            {choosableDays !== null ? (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Dates for this extra"
              >
                <Text style={styles.fieldLabel}>Dates</Text>
                <DayOption
                  label="Every date this ticket admits"
                  selected={extra.validDayIds === null}
                  disabled={sold > 0 && extra.validDayIds !== null}
                  onPress={() => update(extra.id, { validDayIds: null })}
                />
                {choosableDays.map((entry) => {
                  const chosen = extra.validDayIds?.includes(entry.id) ?? false;
                  return (
                    <DayOption
                      key={entry.id}
                      label={
                        formatDraftDayScopeLabel(choosableDays, [entry.id]) ??
                        entry.date
                      }
                      selected={chosen}
                      // A sold extra keeps its dates; new dates can still be added.
                      disabled={
                        sold > 0 && (chosen || extra.validDayIds === null)
                      }
                      onPress={() => {
                        const current = extra.validDayIds ?? [];
                        const next = chosen
                          ? current.filter((id) => id !== entry.id)
                          : [...current, entry.id];
                        update(extra.id, { validDayIds: next });
                      }}
                    />
                  );
                })}
              </View>
            ) : null}

            {problem !== null ? (
              <Text style={styles.helperError}>{problem}</Text>
            ) : null}
            <View style={styles.editorActions}>
              {sold === 0 ? (
                <Button
                  label="Remove extra"
                  variant="ghost"
                  size="sm"
                  onPress={() => remove(extra.id)}
                  accessibilityLabel={`Remove extra ${extra.name}`}
                />
              ) : null}
              <Button
                label="Done"
                variant="secondary"
                size="sm"
                onPress={() => setOpenId(null)}
                accessibilityLabel="Finish editing this extra"
              />
            </View>
          </View>
        );
      })}

      {extras.length < MAX_EXTRAS_PER_TIER ? (
        <Button
          label="Add an extra"
          variant="secondary"
          size="sm"
          leadingIcon="plus"
          onPress={add}
          accessibilityLabel="Add an extra to this ticket"
        />
      ) : null}
    </View>
  );
};

const DayOption: React.FC<{
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}> = ({ label, selected, disabled, onPress }) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected, disabled }}
    accessibilityLabel={label}
    style={[
      styles.dayRow,
      selected && styles.dayRowOn,
      disabled && styles.disabledRow,
    ]}
  >
    <Text style={styles.dayLabel}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  row: {
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowError: {
    borderColor: semantic.error,
  },
  rowTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowMeta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  editor: {
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    borderLeftWidth: 2,
    borderLeftColor: accent.warm,
    backgroundColor: glass.tint.profileBase,
  },
  editorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  inputWrapDisabled: {
    opacity: 0.5,
  },
  textInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginTop: spacing.sm,
  },
  toggleLabelCol: {
    flex: 1,
    paddingRight: spacing.md,
  },
  toggleLabel: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    backgroundColor: glass.border.profileBase,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: textTokens.primary,
  },
  toggleThumbOn: {
    alignSelf: "flex-end",
  },
  toggleThumbOff: {
    alignSelf: "flex-start",
  },
  dayRow: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.xs,
  },
  dayRowOn: {
    borderColor: accent.warm,
  },
  dayLabel: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  disabledRow: {
    opacity: 0.5,
  },
});
