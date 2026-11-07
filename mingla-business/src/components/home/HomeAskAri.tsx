/**
 * #4304 part 3 — State C Home: the "Ask Ari to do something…" field.
 *
 * Submitting it opens Ari with the text already in the composer (handed over
 * in memory, never in a URL); sending stays the host's tap. An empty submit
 * just opens Ari.
 *
 * Its own file, and rendered OUTSIDE Home's scroll containers: it is a
 * TextInput, and the ORCH-0892 / #1841 keyboard gate forbids a focusable input
 * inside a bare ScrollView/FlatList. The draft card that leads Home's content
 * is `HomeDraftLead` (no input), which does scroll.
 */

import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

/** The orb at rest: AriOrb's own "sm" geometry and colours (24px, 3px halo),
 *  drawn without animation. Shown while the animated orb loads, and wherever
 *  the animation runtime is unavailable (Home's render suites). */
function StaticAriMark(): React.ReactElement {
  return (
    <View style={mark.host} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={mark.outer} />
      <View style={mark.middle} />
      <View style={mark.core} />
    </View>
  );
}

type AriOrbComponent = typeof import("../ari/AriOrb").AriOrb;

/** #4304 — the same animated three-ring orb as Ari's own screen, loaded after
 *  first paint so reanimated stays out of Home's boot path. Until then — or
 *  wherever its runtime cannot load (Home's render suites) — the still mark,
 *  identical at rest, stays. */
function HomeAriOrb(): React.ReactElement {
  const [Orb, setOrb] = useState<AriOrbComponent | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../ari/AriOrb") as typeof import("../ari/AriOrb");
      setOrb(() => mod.AriOrb);
    } catch {
      // Keep the still mark.
    }
  }, []);
  return Orb ? <Orb size="sm" decorative /> : <StaticAriMark />;
}

export interface HomeAskAriProps {
  onAskAri: (text: string) => void;
  testID?: string;
}

export function HomeAskAri({
  onAskAri,
  testID = "home-ask-ari",
}: HomeAskAriProps): React.ReactElement {
  const [text, setText] = useState("");
  const submit = (): void => {
    const value = text.trim();
    setText("");
    onAskAri(value);
  };
  return (
    <View style={styles.host} testID={testID}>
      <View style={styles.askRow}>
        {/* #4304 — the same three-ring orb as Ari's own screen, so the field
            reads as Ari rather than a generic search box. */}
        <View style={styles.mark} testID="home-ask-ari-orb">
          <HomeAriOrb />
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask Ari to do something…"
          placeholderTextColor={textTokens.tertiary}
          style={styles.askInput}
          returnKeyType="send"
          onSubmitEditing={submit}
          blurOnSubmit
          accessibilityLabel="Ask Ari to do something"
          testID="home-ask-ari-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={text.trim() ? "Send to Ari" : "Open Ari"}
          onPress={submit}
          style={({ pressed }) => [styles.send, pressed && styles.pressed]}
          testID="home-ask-ari-send"
        >
          {/* A text glyph, not an SVG icon: keeps react-native-svg out of
              Home's graph (its render suites mock react-native partially). */}
          <Text style={styles.sendGlyph}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    marginBottom: spacing.sm,
  },
  askRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(30, 33, 39, 0.85)",
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  mark: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  askInput: {
    flex: 1,
    minHeight: 36,
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  sendGlyph: {
    color: "#101216",
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "800",
  },
  pressed: { opacity: 0.72 },
});

const ORB = 24;
const HALO = 3;
const mark = StyleSheet.create({
  host: { width: ORB, height: ORB, alignItems: "center", justifyContent: "center" },
  outer: {
    position: "absolute",
    top: -HALO,
    left: -HALO,
    width: ORB + HALO * 2,
    height: ORB + HALO * 2,
    borderRadius: (ORB + HALO * 2) / 2,
    borderWidth: 1.5,
    borderColor: "#f07a3d",
  },
  middle: {
    position: "absolute",
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    borderWidth: 2,
    borderColor: "#f07a3d",
  },
  core: {
    position: "absolute",
    width: ORB * 0.46,
    height: ORB * 0.46,
    borderRadius: ORB * 0.23,
    borderWidth: 1,
    borderColor: "#ffb07c",
    backgroundColor: "#f07a3d",
  },
});
