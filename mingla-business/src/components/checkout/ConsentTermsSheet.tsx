/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — shared Terms & Conditions
 * sheet for the bundled-mandatory consent gate (DEC-186 / DESIGN §S3.5).
 *
 * Renders the §2 T&C/consent body (CONSENT_TERMS_BODY, verbatim) in a scrollable
 * overlay opened from the underlined "all terms and conditions" link in the buyer
 * checkout. Built on the existing `Modal` primitive (web + web-phone + native,
 * scrim, Escape, reduced-motion) — does NOT introduce a new gorhom bottom-sheet
 * consumer (the sole-gorhom-consumer gate stays intact).
 *
 * OQ-3 (design recommendation YES): a sticky "I agree" footer button checks the
 * consent box AND closes — a faster path than read-then-hunt-the-checkbox.
 * Reading the sheet is NOT required to agree.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { CONSENT_TERMS_BODY } from "../../constants/consentDisclosure";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export interface ConsentTermsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** OQ-3 — "I agree" checks the box AND closes. */
  onAgree: () => void;
}

export const ConsentTermsSheet: React.FC<ConsentTermsSheetProps> = ({
  visible,
  onClose,
  onAgree,
}) => {
  return (
    <Modal
      visible={visible}
      onClose={onClose}
      maxWidth={560}
      testID="consent-terms-sheet"
    >
      <View style={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          Terms &amp; Conditions
        </Text>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.body}>{CONSENT_TERMS_BODY}</Text>
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label="I agree"
            onPress={onAgree}
            variant="primary"
            accentColor={accent.warm}
            size="lg"
            fullWidth
          />
          <Button
            label="Close"
            onPress={onClose}
            variant="ghost"
            size="md"
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    maxHeight: "100%",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  scroll: {
    maxHeight: 420,
    borderRadius: radiusTokens.md,
  },
  scrollContent: {
    paddingBottom: spacing.md,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: textTokens.secondary,
  },
  footer: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});

export default ConsentTermsSheet;
