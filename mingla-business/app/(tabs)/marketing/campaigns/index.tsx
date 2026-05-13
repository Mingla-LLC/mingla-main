/**
 * Marketing → Campaigns (ORCH-0815-B foundation placeholder).
 *
 * Real campaign list (history with status icons + filter pills + per-row
 * metrics) + composer route + scheduler land in sub-ORCH-B proper.
 *
 * Constitution #9 — no fabricated campaigns. Honest placeholder until
 * composer ships.
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

export default function MarketingCampaignsRoute(): React.ReactElement {
  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Icon name="rocket" size={32} color={accent.warm} />
        <Text style={styles.title}>Your first campaign starts here.</Text>
        <Text style={styles.body}>
          The composer — write subject + body, embed an event card,
          schedule the send, see compliance auto-fill — lands in the next
          phase. Audiences are already live so the moment composer ships,
          you press send.{"\n\n"}
          Until then, you can preview your buyer lists from each brand's
          Customers tab or each event's Buyers tab.
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
