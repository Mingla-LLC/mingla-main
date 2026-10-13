/**
 * RsvpChipInBankChoiceDialog — issue #3645.
 *
 * Shown at Publish when an RSVP has chip-ins switched on and the brand cannot
 * take payments yet. The RSVP itself is free and can always go live, so the
 * host gets a real choice instead of a refusal:
 *
 *   primary    "Connect bank, then publish"        → bank setup, then back here
 *   secondary  "Publish without chip-ins for now"  → chip-ins off on the draft,
 *                                                    then the normal publish
 *
 * Dismissing (scrim, Escape, "Not now") does neither: nothing is published and
 * nothing on the draft changes.
 *
 * Copy is LOCKED (approved on #3645, 2026-10-13). It never names a payment
 * provider.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export const RSVP_CHIP_IN_BANK_CHOICE_COPY = {
  title: "Chip-ins need a bank",
  body: "Your RSVP is free and can go live now. Guests can only chip in once a bank is connected.",
  primary: "Connect bank, then publish",
  secondary: "Publish without chip-ins for now",
  footnote:
    "Without chip-ins, no money is taken from any guest. You can switch them on later.",
  dismiss: "Not now",
} as const;

export interface RsvpChipInBankChoiceDialogProps {
  visible: boolean;
  /** Dismiss without choosing. Publishes nothing, changes nothing. */
  onClose: () => void;
  /** Primary — go to bank setup; the host comes back to this screen. */
  onConnectBank: () => void;
  /** Secondary — switch chip-ins off on the draft, then publish. */
  onPublishWithoutChipIns: () => void;
  /** True while the secondary path is switching chip-ins off. */
  working?: boolean;
  /** A failure from the secondary path, shown in place. */
  errorMessage?: string | null;
  testID?: string;
}

export const RsvpChipInBankChoiceDialog: React.FC<
  RsvpChipInBankChoiceDialogProps
> = ({
  visible,
  onClose,
  onConnectBank,
  onPublishWithoutChipIns,
  working = false,
  errorMessage = null,
  testID = "rsvp-chip-in-bank-choice",
}) => (
  <Modal
    visible={visible}
    onClose={working ? () => undefined : onClose}
    testID={testID}
  >
    <View style={styles.body}>
      <Text accessibilityRole="header" style={styles.title}>
        {RSVP_CHIP_IN_BANK_CHOICE_COPY.title}
      </Text>
      <Text style={styles.description}>
        {RSVP_CHIP_IN_BANK_CHOICE_COPY.body}
      </Text>
      {errorMessage !== null && errorMessage.length > 0 ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          aria-live="assertive"
          style={styles.errorText}
          testID={`${testID}-error`}
        >
          {errorMessage}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={RSVP_CHIP_IN_BANK_CHOICE_COPY.primary}
          onPress={onConnectBank}
          variant="primary"
          size="lg"
          disabled={working}
          fullWidth
          testID={`${testID}-connect`}
        />
        <Button
          label={RSVP_CHIP_IN_BANK_CHOICE_COPY.secondary}
          onPress={onPublishWithoutChipIns}
          variant="secondary"
          size="lg"
          disabled={working}
          loading={working}
          fullWidth
          testID={`${testID}-publish-without`}
        />
        <Text style={styles.footnote}>
          {RSVP_CHIP_IN_BANK_CHOICE_COPY.footnote}
        </Text>
        <Button
          label={RSVP_CHIP_IN_BANK_CHOICE_COPY.dismiss}
          onPress={onClose}
          variant="ghost"
          size="lg"
          disabled={working}
          fullWidth
          testID={`${testID}-dismiss`}
        />
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  description: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: typography.body.fontWeight,
    color: textTokens.secondary,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  footnote: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.35,
    color: textTokens.tertiary,
  },
});

export default RsvpChipInBankChoiceDialog;
