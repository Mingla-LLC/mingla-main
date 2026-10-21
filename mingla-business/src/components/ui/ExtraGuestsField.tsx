/**
 * ExtraGuestsField — issue #3827 going-box. The ONE "Guests on your own list"
 * control, identical on every host settings surface (ticketed, RSVP, trip,
 * experience; create and edit).
 *
 * A NumberStepper (typeable, clamped 0..5,000, number pad, adjustable a11y)
 * plus the helper line that says exactly what the number does, and the field
 * error when the server refuses the value. Copy and the cap come from
 * constants/guestListPrivacy (one owner). Host renders it inside a
 * SmartScrollView, as NumberStepper requires.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  EXTRA_GUESTS_ERROR,
  EXTRA_GUESTS_LABEL,
  EXTRA_GUEST_COUNT_MAX,
  extraGuestsHelper,
  type GuestPrivacyNoun,
} from "../../constants/guestListPrivacy";
import { NumberStepper } from "./NumberStepper";

export interface ExtraGuestsFieldProps {
  value: number;
  privateGuestList: boolean;
  onChange: (next: number) => void;
  /** "booked" on experiences, "going" everywhere else. */
  noun?: GuestPrivacyNoun;
  /** True when the last save was refused for this value. */
  showError?: boolean;
  /** `<surface>-extra-guests` (stepper suffixes -adjust/-dec/-value/-inc). */
  testID: string;
}

export const ExtraGuestsField: React.FC<ExtraGuestsFieldProps> = ({
  value,
  privateGuestList,
  onChange,
  noun = "going",
  showError = false,
  testID,
}) => (
  <View style={styles.wrap} testID={`${testID}-field`}>
    <NumberStepper
      label={EXTRA_GUESTS_LABEL}
      value={value}
      min={0}
      max={EXTRA_GUEST_COUNT_MAX}
      onChange={onChange}
      testID={testID}
    />
    <Text style={styles.helper} testID={`${testID}-helper`}>
      {extraGuestsHelper(privateGuestList, noun)}
    </Text>
    {showError ? (
      <Text
        style={styles.error}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={`${testID}-error`}
      >
        {EXTRA_GUESTS_ERROR}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  error: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});

export default ExtraGuestsField;
