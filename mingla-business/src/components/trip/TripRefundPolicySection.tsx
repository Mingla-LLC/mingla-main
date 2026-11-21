/**
 * #4522 — refund terms in the 4-step builder: three presets and "No refunds" as
 * chips, "Custom…" opening the existing editor, and the "Deposit is
 * non-refundable" switch. The policy it writes is the one the server already
 * validates (`refund_policy`, with the optional `deposit_non_refundable` key from
 * the slice 1 refund keys); a policy without the rule is byte-identical to
 * today's.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import type { RefundPolicy } from "../../services/refundPolicyModel";
import { Icon } from "../ui/Icon";
import { Switch } from "../ui/Switch";
import {
  REFUND_CHIPS,
  applyRefundChip,
  refundChipOf,
  withDepositNonRefundable,
  type RefundChipKey,
} from "./tripBuilderV2RefundChips";

// A chip drawn like TripBuilderChip. Not imported from it: the inclusion chips and
// the question library (the wizard's chunk) share TripBuilderChip, and a module
// two chunks import is hoisted into the business-web boot payload (ORCH-1083).
const RefundChip: React.FC<{
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}> = ({ label, selected, disabled, onPress, testID }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected, disabled }}
    hitSlop={4}
    style={({ pressed }) => [
      styles.chip,
      selected ? styles.chipOn : null,
      pressed ? styles.chipPressed : null,
      disabled ? styles.chipDisabled : null,
    ]}
    testID={testID}
  >
    <View style={styles.chipRow}>
      {selected ? <Icon name="check" size={14} color={color.textStrong} /> : null}
      <Text style={[styles.chipLabel, selected ? styles.chipLabelOn : null]}>{label}</Text>
    </View>
  </Pressable>
);

export interface TripRefundPolicySectionProps {
  value: RefundPolicy | null;
  onChange: (next: RefundPolicy | null) => void;
  disabled?: boolean;
  /**
   * The full editor for "Custom…". Supplied by `RefundPolicyEditor` (this
   * section loads inside its chunk), so no second import of it exists.
   */
  renderCustomEditor: (
    value: RefundPolicy | null,
    onChange: (next: RefundPolicy | null) => void,
  ) => React.ReactNode;
}

export const TripRefundPolicySection: React.FC<TripRefundPolicySectionProps> = ({
  value,
  onChange,
  disabled = false,
  renderCustomEditor,
}) => {
  const selected = refundChipOf(value);
  const [customOpen, setCustomOpen] = useState<boolean>(selected === "custom");
  const depositOn = value?.deposit_non_refundable === true;

  const pick = useCallback(
    (key: RefundChipKey): void => {
      if (key === "custom") {
        setCustomOpen(true);
        return;
      }
      setCustomOpen(false);
      onChange(applyRefundChip(value, key));
    },
    [onChange, value],
  );

  return (
    <View style={styles.host} testID="trip-refund-section">
      <Text accessibilityRole="header" style={styles.title}>
        Refunds
      </Text>
      <View style={styles.row}>
        {REFUND_CHIPS.map((chip) => (
          <RefundChip
            key={chip.key}
            label={chip.label}
            selected={customOpen ? chip.key === "custom" : selected === chip.key}
            disabled={disabled}
            onPress={() => pick(chip.key)}
            testID={`trip-refund-chip-${chip.key}`}
          />
        ))}
      </View>
      {customOpen
        ? renderCustomEditor(value, (next) =>
            // The deposit rule survives an edit made in the full editor.
            onChange(next === null ? null : withDepositNonRefundable(next, depositOn)),
          )
        : null}
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchLabel}>Deposit is non-refundable</Text>
          <Text style={styles.switchSub}>
            {value === null
              ? "Choose a refund option first."
              : "Travelers see this before they pay."}
          </Text>
        </View>
        <Switch
          value={depositOn}
          onValueChange={(next) => onChange(withDepositNonRefundable(value, next))}
          disabled={disabled || value === null}
          accessibilityLabel="Deposit is non-refundable"
          testID="trip-deposit-non-refundable"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipOn: { backgroundColor: color.fill.step, borderColor: color.textStrong },
  chipPressed: { opacity: 0.8 },
  chipDisabled: { opacity: 0.45 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  chipLabel: {
    fontSize: type.chip.fontSize,
    lineHeight: type.chip.lineHeight,
    fontWeight: type.chip.fontWeight,
    color: color.text2,
  },
  chipLabelOn: { color: color.textStrong },
  host: { gap: space[3] },
  title: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
    minHeight: 56,
  },
  switchText: { flex: 1, gap: 2 },
  switchLabel: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  switchSub: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
});
