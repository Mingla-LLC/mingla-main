import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { ChipRange } from "../../hooks/useChatInputController";

interface ChatInputChipsLayerProps {
  text: string;
  chipRanges: ChipRange[];
}

// ORCH-0908 fix (2026-05-21): rendered as an absolute-positioned overlay
// ABOVE the TextInput, with pointerEvents='none' so taps fall through to the
// editable TextInput below. The TextInput's text color is set transparent
// so only this layer's styled spans are visible. This avoids React Native's
// double-render of `value=` + children that caused the @-chip duplication
// (chip + plain `@Name` slug both visible).
export function ChatInputChipsLayer({
  text,
  chipRanges,
}: ChatInputChipsLayerProps): React.ReactElement {
  const sorted = [...chipRanges].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  sorted.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(
        <Text key={`plain-${cursor}`} style={styles.plainText}>
          {text.slice(cursor, range.start)}
        </Text>,
      );
    }
    nodes.push(
      <Text key={`${range.type}-${range.refId}-${index}`} style={styles.chipText}>
        {text.slice(range.start, range.end)}
      </Text>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <Text key={`plain-${cursor}`} style={styles.plainText}>
        {text.slice(cursor)}
      </Text>,
    );
  }

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Text style={styles.overlayText}>{nodes}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  overlayText: {
    fontSize: 15,
    lineHeight: 20,
    color: "#FFFFFF",
  },
  plainText: {
    color: "#FFFFFF",
  },
  chipText: {
    backgroundColor: "#eb7825",
    color: "#FFFFFF",
    borderRadius: Platform.OS === "ios" ? 6 : 0,
    paddingHorizontal: 4,
    paddingVertical: 2,
    fontWeight: "700",
  },
});
