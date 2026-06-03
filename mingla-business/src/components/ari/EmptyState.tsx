/**
 * ORCH-0821 — Ari empty state (first run).
 * Big orb + headline + body.
 *
 * ORCH-1057 — removed the always-on 3-chip wall (it duplicated the
 * `+`-triggered suggestions panel, the single intended entry point for
 * examples). Replaced with one quiet, non-tappable hint row that points at
 * the composer `+` so a first-run user is never stranded.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Plus } from "lucide-react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";

export const EmptyState: React.FC = () => (
  <View style={styles.host}>
    <View style={styles.orbWrap}>
      <AriOrb size="lg" thinking decorative={false} accessibilityLabel="Ari" />
    </View>
    <Text style={styles.headline}>Hi, I&apos;m Ari.</Text>
    <Text style={styles.body}>
      I can create events, manage brands, and answer questions about your business.
    </Text>
    <View style={styles.hintRow}>
      <Plus size={14} color={textTokens.tertiary} strokeWidth={2} />
      <Text style={styles.hintText}>Tap + for things to try</Text>
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
  hintRow: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  hintText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
  },
});

export default EmptyState;
