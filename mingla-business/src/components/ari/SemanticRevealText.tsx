/** Issue #3429 — bounded entrance for an already-complete Ari response. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { ariThread } from "../../constants/designSystem";
import { captureAriRevealOutcome } from "../../services/ariPolishAnalytics";

export interface SemanticRevealTextProps {
  text: string;
  textStyle: object;
  skipSignal?: number;
  surface?: "main" | "website";
}

interface Chunk {
  kind: "paragraph" | "list";
  text: string;
}

export function semanticRevealDuration(chunkCount: number): number {
  return Math.max(300, Math.min(1200, 300 + Math.max(0, chunkCount - 1) * 55));
}

export function splitSemanticChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    if (lines.length > 0 && lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) {
      lines.forEach((line) => chunks.push({ kind: "list", text: line }));
    } else if (block.length > 0) {
      chunks.push({ kind: "paragraph", text: block });
    }
  }
  return chunks.length ? chunks : [{ kind: "paragraph", text }];
}

const RevealChunk: React.FC<{
  chunk: Chunk;
  index: number;
  count: number;
  skipped: boolean;
  reduced: boolean;
  textStyle: object;
}> = ({ chunk, index, count, skipped, reduced, textStyle }) => {
  const opacity = useSharedValue(reduced ? 1 : 0.22);
  const translateY = useSharedValue(reduced ? 0 : 4);
  const total = semanticRevealDuration(count);
  const delay = count <= 1 ? 0 : Math.round((Math.max(0, total - 200) * index) / (count - 1));

  useEffect(() => {
    if (reduced || skipped) {
      opacity.value = withTiming(1, { duration: reduced ? 0 : 80, easing: Easing.out(Easing.quad) });
      translateY.value = withTiming(0, { duration: reduced ? 0 : 80, easing: Easing.out(Easing.quad) });
      return;
    }
    opacity.value = withDelay(delay, withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }));
  }, [delay, opacity, reduced, skipped, translateY]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
  return (
    <Animated.View
      style={[index > 0 && styles.gap, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {chunk.kind === "list" ? (
        <View style={styles.listRow}>
          <Text selectable style={[textStyle, styles.listText]}>{chunk.text}</Text>
        </View>
      ) : (
        <Text selectable style={textStyle}>{chunk.text}</Text>
      )}
    </Animated.View>
  );
};

export const SemanticRevealText: React.FC<SemanticRevealTextProps> = ({
  text,
  textStyle,
  skipSignal = 0,
  surface = "main",
}) => {
  const reduced = useReducedMotion();
  const chunks = useMemo(() => splitSemanticChunks(text), [text]);
  const [skipped, setSkipped] = useState(false);
  const captured = useRef(false);

  useEffect(() => {
    setSkipped(false);
    captured.current = false;
    if (reduced) {
      captured.current = true;
      captureAriRevealOutcome({ surface, outcome: "completed", reducedMotion: true, durationMs: 0 });
      return;
    }
    const duration = semanticRevealDuration(chunks.length);
    const timer = setTimeout(() => {
      if (captured.current) return;
      captured.current = true;
      captureAriRevealOutcome({ surface, outcome: "completed", reducedMotion: false, durationMs: duration });
    }, duration);
    return () => clearTimeout(timer);
  }, [chunks.length, reduced, surface, text]);

  useEffect(() => {
    if (skipSignal > 0) setSkipped(true);
  }, [skipSignal]);

  const skip = (): void => {
    if (reduced || skipped) return;
    setSkipped(true);
    if (!captured.current) {
      captured.current = true;
      captureAriRevealOutcome({ surface, outcome: "skipped", reducedMotion: false, durationMs: 80 });
    }
  };

  return (
    <Pressable
      onPress={skip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Ari said: ${text}`}
    >
      {chunks.map((chunk, index) => (
        <RevealChunk
          key={`${index}-${chunk.text.slice(0, 16)}`}
          chunk={chunk}
          index={index}
          count={chunks.length}
          skipped={skipped}
          reduced={reduced}
          textStyle={textStyle}
        />
      ))}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  gap: { marginTop: ariThread.gapGroup },
  listRow: { flexDirection: "row" },
  listText: { flex: 1 },
});

export default SemanticRevealText;
