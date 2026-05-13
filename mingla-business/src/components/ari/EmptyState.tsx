/**
 * ORCH-0821 — Ari empty state (first run).
 * Big orb + headline + body + 3 tap-to-send example chips.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";
import { QuickReplyChips } from "./QuickReplyChips";

export interface EmptyStateProps {
  onChipSelect: (text: string) => void;
}

const EXAMPLES = [
  "Create a brand called Sample Events",
  "What events do I have this week?",
  "Help me schedule a Friday event",
];

export const EmptyState: React.FC<EmptyStateProps> = ({ onChipSelect }) => (
  <View style={styles.host}>
    <View style={styles.orbWrap}>
      <AriOrb size="lg" thinking decorative={false} accessibilityLabel="Ari" />
    </View>
    <Text style={styles.headline}>Hi, I&apos;m Ari.</Text>
    <Text style={styles.body}>
      I can create events, manage brands, and answer questions about your business.
    </Text>
    <View style={styles.chipsWrap}>
      <QuickReplyChips chips={EXAMPLES} onSelect={onChipSelect} layout="stack" />
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  orbWrap: {
    marginBottom: spacing.lg,
  },
  headline: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    marginTop: spacing.sm,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    maxWidth: 280,
  },
  chipsWrap: {
    marginTop: spacing.xl,
    width: "100%",
    maxWidth: 360,
  },
});

export default EmptyState;
