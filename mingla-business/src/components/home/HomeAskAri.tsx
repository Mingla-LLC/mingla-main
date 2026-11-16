/**
 * #4304 part 3 — State C Home: the "Ask Ari to do something…" field.
 *
 * Submitting it opens Ari with the text already in the composer (handed over
 * in memory, never in a URL); sending stays the host's tap. An empty submit
 * just opens Ari.
 *
 * Its own file, and rendered OUTSIDE Home's scroll containers: it is a
 * TextInput, and the ORCH-0892 / #1841 keyboard gate forbids a focusable input
 * inside a bare ScrollView/FlatList. When Recent is empty, Home shows
 * `HomeRecentAriPrompt` (no input) instead.
 */

import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
  materials,
} from "../../constants/designSystem";
import { HomeAriOrb } from "./HomeAriOrb";
import { FIELD_FOCUS_BOX_PROPS } from "../ui/fieldFocusCss";

/** The orb at rest: AriOrb's own "sm" geometry and colours (24px, 3px halo),
 *  drawn without animation. Shown while the animated orb loads, and wherever
 *  the animation runtime is unavailable (Home's render suites). */
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
      <View style={styles.askRow} {...FIELD_FOCUS_BOX_PROPS}>
        {/* #4304 — the same three-ring orb as Ari's own screen, so the field
            reads as Ari rather than a generic search box. */}
        <View style={styles.mark} testID="home-ask-ari-orb">
          <HomeAriOrb />
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask Ari to do something…"
          placeholderTextColor={color.text3}
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
    marginBottom: space[2],
  },
  askRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.card2,
    paddingLeft: space[4],
    paddingRight: space[1],
    paddingVertical: space[1],
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
    color: color.text1,
    fontSize: type.small.fontSize,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  sendGlyph: {
    color: color.ink,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "800",
  },
  pressed: { opacity: 0.72 },
});
