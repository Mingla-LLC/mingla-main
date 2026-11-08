/**
 * #4304 — Home's Recent area when nothing has been opened yet.
 *
 * Instead of "Nothing recent yet / Create something", Home invites the host to
 * tell Ari what to make: the Ari orb, one line of copy, a tap-to-type Ari field
 * and the same "what are you hosting" chips as the new-brand screen. Each opens
 * a NEW Ari chat (a chip's words land in the composer). The manual wizards
 * stay in the top bar's "+".
 *
 * The field is a Pressable styled as a field, not a TextInput: this panel
 * scrolls with Home, and the ORCH-0892 / #1841 keyboard gate forbids a
 * focusable input inside a bare ScrollView/FlatList. Typing happens in Ari.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { accent, spacing, text as textTokens } from "../../constants/designSystem";
import { EMPTY_BRAND_CHIPS } from "../../utils/firstRunState";
import { HomeAriOrb } from "./HomeAriOrb";

/** What a chip puts in Ari's composer. */
export function recentPromptChipText(label: string): string {
  return `I want to make ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export interface HomeRecentAriPromptProps {
  /** Opens a new Ari chat; `text` lands in the composer ("" = empty). */
  onOpenAri: (text: string) => void;
  /** Wide desktop: Recent only gets the height left under the pulse panel, so
   *  the prompt drops the headline and puts the orb inside the field. */
  compact?: boolean;
}

export function HomeRecentAriPrompt({
  onOpenAri,
  compact = false,
}: HomeRecentAriPromptProps): React.ReactElement {
  return (
    <View style={[styles.panel, compact && styles.panelCompact]} testID="home-recent-ari-prompt">
      {compact ? null : (
        <>
          <HomeAriOrb size="md" />
          <Text style={styles.title}>What are you hosting next?</Text>
          <Text style={styles.body}>
            Tell Ari the idea in a sentence and it drafts it for you. Anything you open shows up here.
          </Text>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tell Ari what to make"
        onPress={() => onOpenAri("")}
        style={({ pressed }) => [styles.field, compact && styles.fieldCompact, pressed && styles.pressed]}
        testID="home-recent-ari-field"
      >
        {compact ? (
          <View style={styles.fieldOrb}>
            <HomeAriOrb size="sm" />
          </View>
        ) : null}
        <Text style={styles.fieldText} numberOfLines={1}>
          {compact ? "Nothing here yet. Tell Ari what you're hosting next…" : "Tell Ari what to make…"}
        </Text>
        <View style={styles.send}>
          <Text style={styles.sendGlyph}>↑</Text>
        </View>
      </Pressable>
      <View style={[styles.chips, compact && styles.chipsCompact]}>
        {EMPTY_BRAND_CHIPS.map((chip) => (
          <Pressable
            key={chip.id}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
            onPress={() => onOpenAri(recentPromptChipText(chip.label))}
            style={({ pressed }) => [
              styles.chip,
              chip.primary === true && styles.chipPrimary,
              pressed && styles.pressed,
            ]}
            testID={`home-recent-ari-chip-${chip.id}`}
          >
            <Text style={[styles.chipText, chip.primary === true && styles.chipTextPrimary]}>
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    // #4304 — full width of Home's content (on desktop it sits in a wrapping
    // row, which would otherwise shrink it to its content).
    width: "100%",
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  panelCompact: {
    alignItems: "stretch",
    paddingVertical: spacing.xs,
    // The desktop Recent grid sits 4px outside its clipping scroll (card
    // gutters); this keeps the field's and first chip's left edge visible.
    paddingHorizontal: 4,
  },
  title: {
    marginTop: spacing.sm,
    color: textTokens.primary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    color: textTokens.secondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 420,
  },
  field: {
    marginTop: spacing.sm,
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(30, 33, 39, 0.85)",
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  fieldCompact: { marginTop: 0, paddingLeft: spacing.sm },
  fieldOrb: { width: 32, alignItems: "center", marginRight: spacing.xs },
  fieldText: { flex: 1, color: textTokens.tertiary, fontSize: 15 },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  sendGlyph: { color: "#101216", fontSize: 18, lineHeight: 20, fontWeight: "800" },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs,
    maxWidth: 560,
    marginTop: spacing.xs,
  },
  chipsCompact: { justifyContent: "flex-start", maxWidth: "100%", alignItems: "center" },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md - 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  chipPrimary: {
    borderColor: "rgba(235, 120, 37, 0.55)",
    backgroundColor: "rgba(235, 120, 37, 0.14)",
  },
  chipText: { color: textTokens.primary, fontSize: 13, fontWeight: "600" },
  chipTextPrimary: { color: "#ffd7bd" },
  pressed: { opacity: 0.72 },
});
