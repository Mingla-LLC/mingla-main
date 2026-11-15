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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { color, radius as radiusTokens, space, type } from "../../constants/designSystem";
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
  /** #4389 A1 — the setup card under the chips (no-brand first landing). */
  footer?: React.ReactNode;
  testID?: string;
}

export function FirstRunGreeting({
  copy,
  onChip,
  desktop = false,
  composer,
  compact = false,
  disabled = false,
  footer,
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
          {footer}
        </View>
      </View>
    );
  }

  // #4389 P2 — the phone greeting scrolls inside its own box. It used to be a
  // bottom-anchored View: with the A1 setup card it grew taller than the space
  // under Ari's top bar and drew over it (17pt overlap; the orb over the brand
  // chip). The ScrollView clips to that box, keeps short content anchored at
  // the bottom (flexGrow + flex-end) and lets tall content scroll under the bar.
  return (
    <ScrollView
      style={styles.phoneScroll}
      contentContainerStyle={styles.phoneHost}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
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
      {compact ? null : footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  phoneScroll: {
    flex: 1,
  },
  phoneHost: {
    flexGrow: 1,
    justifyContent: "flex-end",
    // Top inset: the first line (or the orb) never touches the bar's edge.
    paddingTop: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[4],
    gap: space[2],
  },
  orbWrap: {
    marginBottom: space[1],
  },
  desktopHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  desktopColumn: {
    width: "100%",
    maxWidth: 640,
    alignItems: "center",
    gap: space[4],
  },
  headline: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: color.text1,
  },
  headlineDesktop: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
  },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
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
    gap: space[1] + 2,
    marginTop: space[2],
  },
  chipsCentred: {
    justifyContent: "center",
    marginTop: 0,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[4] - 2,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
  },
  chipPrimary: {
    backgroundColor: color.fill.tile,
    borderColor: color.lineStrong,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    fontSize: 13,
    color: color.text1,
    fontWeight: "500",
  },
  chipLabelPrimary: {
    color: color.text1,
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
});
