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
  glass,
  radius,
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
    {/* ORCH-1101 REWORK Bug #5: the hint must reference the ACTUAL + button, not
        a literal "+" character. The "word" is the button glyph itself, rendered
        as a chip that mirrors the InputBar "+" suggestions button (bordered
        circle, lucide Plus) inline in the sentence. accessibilityLabel keeps the
        spoken sentence natural ("Tap plus for things to try"). */}
    <View
      style={styles.hintRow}
      accessibilityRole="text"
      accessibilityLabel="Tap the plus button for things to try"
    >
      <Text style={styles.hintText}>Tap </Text>
      <View style={styles.hintChip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Plus size={13} color={textTokens.tertiary} strokeWidth={2.25} />
      </View>
      <Text style={styles.hintText}> for things to try</Text>
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
  },
  // ORCH-1101 REWORK Bug #5: a bordered circle chip that visually quotes the
  // InputBar "+" suggestions button so the hint literally points at it.
  hintChip: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 2,
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
