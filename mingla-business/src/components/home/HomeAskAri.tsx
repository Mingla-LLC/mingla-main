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

import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  ariPalette,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

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
        {/* A still Ari mark: the animated orb would put reanimated in Home's
            boot path and its render suites for a 22px decoration. */}
        <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ariPalette.flame,
    borderWidth: 2,
    borderColor: ariPalette.gold,
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
