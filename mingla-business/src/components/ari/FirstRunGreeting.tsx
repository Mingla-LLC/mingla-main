/**
 * #4304 part 3 — Ari's first-run greeting (State B) and, since #4572 item 16,
 * the State A stage.
 *
 * State A (no brand): `FirstRunSetupStage` below. The setup card is the only
 * content: no orb, headline, paragraph or pills. It never collapses while the
 * host types.
 *
 * State B (a brand exists, nothing made yet): `FirstRunGreeting`.
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
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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

  // #4389 P2 — the phone greeting scrolls inside its own box: the ScrollView
  // clips to the space under Ari's top bar, keeps short content anchored at
  // the bottom (flexGrow + flex-end) and lets tall content scroll under it.
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
    </ScrollView>
  );
}

export interface FirstRunSetupStageProps {
  /** The setup card: the only content of the no-brand page. */
  card: React.ReactNode;
  /** Wide desktop: the card and the composer share one centred 880 column. */
  desktop?: boolean;
  /** Desktop only: the screen's composer, drawn under the card. */
  composer?: React.ReactNode;
  /**
   * Phone: the keyboard is up. Only the alignment follows it (top while the
   * keyboard is open, centred when closed); the card stays mounted and the
   * composer's position never reads this.
   */
  keyboardOpen?: boolean;
  testID?: string;
}

/**
 * #4572 item 16 — State A. The card, and nothing else.
 *   - Phone / narrow web: a scroll area between the top bar and the composer,
 *     the card centred in it while the keyboard is closed and top-aligned
 *     while it is open. The area scrolls and dismisses the keyboard with a
 *     swipe down (interactive on iOS).
 *   - Wide desktop: the card and the composer in one centred column.
 */
export function FirstRunSetupStage({
  card,
  desktop = false,
  composer,
  keyboardOpen = false,
  testID = "ari-first-run-setup-stage",
}: FirstRunSetupStageProps): React.ReactElement {
  if (desktop) {
    return (
      <View style={stageStyles.desktopHost} testID={testID}>
        <View style={stageStyles.desktopColumn}>
          {card}
          {composer ? <View style={stageStyles.desktopComposer}>{composer}</View> : null}
        </View>
      </View>
    );
  }
  return (
    <ScrollView
      style={stageStyles.phoneScroll}
      contentContainerStyle={[
        stageStyles.phoneContent,
        keyboardOpen ? stageStyles.phoneTop : stageStyles.phoneCentre,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      {card}
    </ScrollView>
  );
}

const stageStyles = StyleSheet.create({
  phoneScroll: { flex: 1 },
  phoneContent: {
    flexGrow: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  phoneCentre: { justifyContent: "center" },
  phoneTop: { justifyContent: "flex-start" },
  desktopHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  desktopColumn: {
    width: "100%",
    maxWidth: 880,
    gap: space[5],
  },
  desktopComposer: { width: "100%" },
});

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
