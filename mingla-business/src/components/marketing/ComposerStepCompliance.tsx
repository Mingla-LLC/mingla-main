/**
 * ComposerStepCompliance — Step 4. Read-only locked compliance card.
 *
 * Surfaces what will appear in every email's From / Reply-to / Unsubscribe /
 * Brand address — auto-filled from the current brand. Operator cannot edit
 * (Mingla owns the From line; reply-to is the brand contact email; address
 * is from brands.address). The footer info note explains Mingla's
 * cross-brand unsubscribe honour.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerStepComplianceProps {
  brandName: string | null;
  brandContactEmail: string | null;
  brandAddress: string | null;
}

export const ComposerStepCompliance: React.FC<ComposerStepComplianceProps> = ({
  brandName,
  brandContactEmail,
  brandAddress,
}) => {
  return (
    <View style={styles.host} accessibilityLabel="Compliance — locked, auto-filled">
      <Text style={styles.stepLabel} accessibilityRole="header">STEP 4 — COMPLIANCE (locked)</Text>
      <View style={styles.card}>
        <ComplianceRow label="From" value={`${brandName ?? "{Brand}"} via Mingla`} />
        <ComplianceRow label="Reply-to" value={brandContactEmail ?? "Pending — set in brand profile"} />
        <ComplianceRow label="Unsubscribe" value="Link added automatically" />
        <ComplianceRow label="Brand address" value={brandAddress ?? "Pending — set in brand profile"} />
      </View>
      <View style={styles.infoNote}>
        <Text style={styles.infoText}>
          Your buyers can opt out anytime — Mingla honors this across all your brands.
        </Text>
      </View>
    </View>
  );
};

interface ComplianceRowProps {
  label: string;
  value: string;
}

const ComplianceRow: React.FC<ComplianceRowProps> = ({ label, value }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  host: {
    gap: spacing.xs,
  },
  stepLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  card: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    gap: 2,
  },
  rowLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  rowValue: {
    ...typography.body,
    color: textTokens.primary,
  },
  infoNote: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: semantic.infoTint,
    borderLeftWidth: 3,
    borderLeftColor: semantic.info,
  },
  infoText: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
});
