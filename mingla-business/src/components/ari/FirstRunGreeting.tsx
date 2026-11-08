/**
 * #4304 part 3 — Ari's first-run greeting (States A and B).
 *
 * App-written, no AI call: orb, headline, body and every chip. All chips show
 * on phone and desktop alike; they wrap.
 *   - Phone: the greeting sits at the bottom of the thread area, just above the
 *     composer (the composer itself stays the screen's).
 *   - Desktop: everything is centred like a search page, and the screen hands
 *     its composer in as `composer` so the field sits under the headline.
 *
 * Kept separate from `EmptyState` on purpose: ORCH-1057 pins that hero as a
 * chip-free, propless component, and it is still what every other host sees.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  FirstRunChip,
  FirstRunGreetingCopy,
} from "../../utils/firstRunState";
import { AriOrb } from "./AriOrb";

export interface FirstRunGreetingProps {
  copy: FirstRunGreetingCopy;
  onChip: (chip: FirstRunChip) => void;
  /** Wide desktop: centred layout with the composer inside. */
  desktop?: boolean;
  /** Desktop only — the screen's composer, drawn under the copy. */
  composer?: React.ReactNode;
  /** Phone keyboard up: keep the headline and chips, drop the orb and body. */
  compact?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function FirstRunGreeting({
  copy,
  onChip,
  desktop = false,
  composer,
  compact = false,
  disabled = false,
  testID = "ari-first-run-greeting",
}: FirstRunGreetingProps): React.ReactElement {
  const chips = (
    <View
      style={[styles.chips, desktop ? styles.chipsCentred : null]}
      testID="ari-first-run-chips"
    >
      {copy.chips.map((chip) => (
        <Pressable
          key={chip.id}
          onPress={disabled ? undefined : () => onChip(chip)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [
            styles.chip,
            chip.primary === true ? styles.chipPrimary : null,
            pressed && !disabled ? styles.pressed : null,
            disabled ? styles.chipDisabled : null,
          ]}
          testID={`ari-first-run-chip-${chip.id}`}
        >
          <Text
            style={[
              styles.chipLabel,
              chip.primary === true ? styles.chipLabelPrimary : null,
            ]}
          >
            {chip.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  if (desktop) {
    return (
      <View style={styles.desktopHost} testID={testID}>
        <View style={styles.desktopColumn}>
          <AriOrb size="lg" decorative={false} accessibilityLabel="Ari" />
          <Text
            accessibilityRole="header"
            style={[styles.headline, styles.headlineDesktop]}
          >
            {copy.headline}
          </Text>
          <Text style={[styles.body, styles.bodyDesktop]}>{copy.body}</Text>
          {composer ? <View style={styles.desktopComposer}>{composer}</View> : null}
          {chips}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.phoneHost} testID={testID}>
      {compact ? null : (
        <View style={styles.orbWrap}>
          <AriOrb size="md" decorative={false} accessibilityLabel="Ari" />
        </View>
      )}
      <Text accessibilityRole="header" style={styles.headline}>
        {copy.headline}
      </Text>
      {compact ? null : <Text style={styles.body}>{copy.body}</Text>}
      {chips}
    </View>
  );
}

const styles = StyleSheet.create({
  phoneHost: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  orbWrap: {
    marginBottom: spacing.xs,
  },
  desktopHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  desktopColumn: {
    width: "100%",
    maxWidth: 640,
    alignItems: "center",
    gap: spacing.md,
  },
  headline: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: textTokens.primary,
  },
  headlineDesktop: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  bodyDesktop: {
    textAlign: "center",
    maxWidth: 460,
  },
  desktopComposer: {
    width: "100%",
    maxWidth: 560,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
  chipsCentred: {
    justifyContent: "center",
    marginTop: 0,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md - 2,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "#1a1e24",
  },
  chipPrimary: {
    backgroundColor: "rgba(235, 120, 37, 0.16)",
    borderColor: accent.border,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "500",
  },
  chipLabelPrimary: {
    color: "#ffd2b0",
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
});
