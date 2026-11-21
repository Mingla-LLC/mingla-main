/**
 * issue #4522 / #3281 — how a trip plan pays its selected add-ons.
 * Money is display-only server quote truth; this component never reprices.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CheckoutAddOnPaymentMode } from "@mingla/offering-rendering/ticketCheckoutContract";

import { space } from "../../constants/designSystem";
import { color, themedStyles } from "../../theme/surfaceTokens";
import { formatCurrency } from "../../utils/currency";

export interface AddOnPlanChoiceProps {
  totalCents: number | null;
  currency: string;
  value: CheckoutAddOnPaymentMode;
  onChange: (choice: CheckoutAddOnPaymentMode) => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export const AddOnPlanChoice: React.FC<AddOnPlanChoiceProps> = ({
  totalCents,
  currency,
  value,
  onChange,
  loading = false,
  disabled = false,
  testID = "trip-addon-plan-choice",
}) => {
  const s = styles;
  const controlsDisabled = disabled || loading;
  const amount =
    totalCents === null ? null : formatCurrency(totalCents, currency, true);

  return (
    <View
      style={s.wrap}
      accessibilityState={{ busy: loading }}
      testID={testID}
    >
      <View style={s.titleRow}>
        <Text style={s.title}>
          {amount === null ? "Add-ons" : `Add-ons (${amount})`}
        </Text>
        {loading ? (
          <View
            style={s.skeleton}
            accessibilityLabel="Working out add-on payments"
            testID={`${testID}-loading`}
          />
        ) : null}
      </View>
      <View
        style={s.segment}
        accessibilityRole="radiogroup"
        accessibilityLabel="How to pay for add-ons"
      >
        <Choice
          label="Pay today"
          selected={value === "today"}
          disabled={controlsDisabled}
          onPress={() => onChange("today")}
          testID={`${testID}-today`}
        />
        <Choice
          label="Spread over my plan"
          selected={value === "spread"}
          disabled={controlsDisabled}
          onPress={() => onChange("spread")}
          testID={`${testID}-spread`}
        />
      </View>
    </View>
  );
};

const Choice: React.FC<{
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}> = ({ label, selected, disabled, onPress, testID }) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityLabel={label}
    accessibilityState={{ checked: selected, disabled }}
    aria-checked={selected}
    disabled={disabled}
    onPress={onPress}
    style={[
      styles.choice,
      selected ? styles.choiceSelected : null,
      disabled ? styles.choiceDisabled : null,
    ]}
    testID={testID}
  >
    <Text style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>
      {label}
    </Text>
  </Pressable>
);

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: {
      marginTop: space[3],
      gap: space[2],
    },
    titleRow: {
      minHeight: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space[2],
    },
    title: {
      color: color.text1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    segment: {
      padding: 3,
      borderRadius: 12,
      backgroundColor: color.fill.inset,
      flexDirection: "row",
      gap: 3,
    },
    choice: {
      flex: 1,
      minHeight: 42,
      paddingHorizontal: space[2],
      borderRadius: 9,
      borderWidth: 1,
      borderColor: color.controlOutline,
      alignItems: "center",
      justifyContent: "center",
    },
    choiceSelected: {
      borderColor: color.accent,
      backgroundColor: color.card,
    },
    choiceDisabled: { opacity: 0.72 },
    choiceText: {
      color: color.text2,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      textAlign: "center",
    },
    choiceTextSelected: { color: color.text1 },
    skeleton: {
      width: 70,
      height: 12,
      borderRadius: 6,
      backgroundColor: color.fill.inset,
    },
  }),
);

export default AddOnPlanChoice;
