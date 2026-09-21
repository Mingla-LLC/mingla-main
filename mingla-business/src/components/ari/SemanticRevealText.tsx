/** Issue #3429 — bounded entrance for an already-complete Ari response. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated as CoreAnimated, Easing as CoreEasing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { ariThread, text as textTokens } from "../../constants/designSystem";
import { captureAriRevealOutcome } from "../../services/ariPolishAnalytics";
import { type AriBubbleSegment, toAccessibleText, toSegments } from "./ariBubbleSegments";

export interface SemanticRevealTextProps {
  text: string;
  textStyle: object;
  skipSignal?: number;
  surface?: "main" | "website";
}

type Chunk = AriBubbleSegment;

export function semanticRevealDuration(chunkCount: number): number {
  return Math.max(300, Math.min(1200, 300 + Math.max(0, chunkCount - 1) * 55));
}

/** P2-4: exactly the settled bubble's segments (one segmenter, ChatBubble). */
export function splitSemanticChunks(text: string): Chunk[] {
  const chunks = toSegments(text);
  return chunks.length ? chunks : [{ kind: "paragraph", text }];
}

const ChunkBody: React.FC<{ chunk: Chunk; textStyle: object }> = ({ chunk, textStyle }) => (
  chunk.kind === "bullet" ? (
    <View style={styles.listRow}>
      <Text style={[textStyle, styles.bulletGlyph]}>•</Text>
      <Text selectable style={[textStyle, styles.listText]}>{chunk.text}</Text>
    </View>
  ) : (
    <Text selectable style={textStyle}>{chunk.text}</Text>
  )
);

function revealDelay(index: number, count: number): number {
  const total = semanticRevealDuration(count);
  return count <= 1 ? 0 : Math.round((Math.max(0, total - 200) * index) / (count - 1));
}

/**
 * P2-3 (web): Reanimated's web style path inserted chunks already settled, so
 * nothing animated on Business web. The core Animated driver writes the
 * starting opacity/offset on mount and steps them on animation frames.
 */
const WebRevealChunk: React.FC<{
  chunk: Chunk;
  index: number;
  count: number;
  skipped: boolean;
  reduced: boolean;
  textStyle: object;
}> = ({ chunk, index, count, skipped, reduced, textStyle }) => {
  const opacity = useRef(new CoreAnimated.Value(reduced ? 1 : 0.22)).current;
  const translateY = useRef(new CoreAnimated.Value(reduced ? 0 : 4)).current;
  const delay = revealDelay(index, count);

  useEffect(() => {
    const step = (value: CoreAnimated.Value, toValue: number, duration: number, after: number) =>
      CoreAnimated.timing(value, {
        toValue,
        duration,
        delay: after,
        easing: CoreEasing.out(CoreEasing.quad),
        useNativeDriver: false,
      });
    const animation = reduced || skipped
      ? CoreAnimated.parallel([step(opacity, 1, reduced ? 0 : 80, 0), step(translateY, 0, reduced ? 0 : 80, 0)])
      : CoreAnimated.parallel([step(opacity, 1, 200, delay), step(translateY, 0, 200, delay)]);
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, reduced, skipped, translateY]);

  return (
    <CoreAnimated.View
      style={[index > 0 ? styles.gap : null, { opacity, transform: [{ translateY }] }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <ChunkBody chunk={chunk} textStyle={textStyle} />
    </CoreAnimated.View>
  );
};

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
  const delay = revealDelay(index, count);

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
      <ChunkBody chunk={chunk} textStyle={textStyle} />
    </Animated.View>
  );
};

/**
 * P2-3 (web): Business web aliases `react-native-reanimated` to a static shim
 * whose `useReducedMotion()` always returns true, so the reveal never animated
 * there. On web the browser's own media query is the source of truth.
 */
function webPrefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export const SemanticRevealText: React.FC<SemanticRevealTextProps> = ({
  text,
  textStyle,
  skipSignal = 0,
  surface = "main",
}) => {
  const nativeReduced = useReducedMotion();
  const reduced = Platform.OS === "web" ? webPrefersReducedMotion() : nativeReduced;
  const chunks = useMemo(() => splitSemanticChunks(text), [text]);
  const ChunkComponent = Platform.OS === "web" ? WebRevealChunk : RevealChunk;
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
      accessibilityLabel={`Ari said: ${toAccessibleText(text)}`}
    >
      {chunks.map((chunk, index) => (
        <ChunkComponent
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
  // Identical to ChatBubble's hanging bullet so reveal and settled rows match.
  bulletGlyph: { color: textTokens.tertiary, width: 6, marginRight: 6 },
  listText: { flex: 1 },
});

export default SemanticRevealText;
