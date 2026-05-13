/**
 * Marketing → Templates (ORCH-0815-B foundation placeholder).
 *
 * The 5 Mingla starter-pack email templates are ALREADY seeded into
 * `marketing_templates` (ORCH-0815-A1 migration). This screen will render
 * them + any user-created templates when the composer ships in sub-ORCH-B
 * proper.
 *
 * Template authorship rule (enforced at DB layer via
 * `marketing_templates_authorship_valid` CHECK): starter-pack rows have
 * `account_id IS NULL`; user rows have `account_id IS NOT NULL`.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "../../../../src/components/ui/Icon";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";

export default function MarketingTemplatesRoute(): React.ReactElement {
  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Icon name="template" size={32} color={accent.warm} />
        <Text style={styles.title}>5 starter templates are ready.</Text>
        <Text style={styles.body}>
          We pre-loaded "Last call", "Pre-event reminder", "Thank you for
          coming", "Similar upcoming event", and "Re-engagement" templates
          for every brand to use. They're sitting in the database — the UI
          to browse + edit + duplicate them lands in the next phase along
          with the composer.{"\n\n"}
          You'll also be able to save your own custom templates from any
          campaign with one tap.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  card: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
  },
});
