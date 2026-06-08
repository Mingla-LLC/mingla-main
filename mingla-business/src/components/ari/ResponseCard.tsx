/**
 * ORCH-1101 — ResponseCard (§5.4)
 *
 * Presentational ONLY. For Ari answers that are DATA, not prose — "here are
 * your 3 events this week," a created-entity receipt, a metric. A glass card
 * that threads inline like a fat Ari bubble. The downstream smart-Ari ORCH
 * supplies the data + wires the callbacks.
 *
 * The 5 named states (default / loading / disabled / submitted / error) are all
 * rendered from the `state` prop. Anti-slop: the thumbnail is a REAL photo URI
 * only — never a placeholder; if there's no real cover, pass no thumbnail.
 */

import React, { useEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  ariPalette,
  ariThread,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";
import { GlassChrome } from "../ui/GlassChrome";

export interface ResponseRow {
  /** Left label (micro, tertiary). */
  label: string;
  /** Right value (13, primary). */
  value: string;
}

export interface ResponseAction {
  id: string;
  label: string;
  /** Primary = filled ember pill; ghost = bordered. Default ghost. */
  primary?: boolean;
}

export type ResponseCardState =
  | "default" // data shown
  | "loading" // 3 shimmer skeleton rows
  | "disabled" // 0.4 (e.g. stale)
  | "submitted" // post-action success ribbon inline
  | "error"; // single muted "Couldn't load — tap to retry" row

export interface ResponseCardProps {
  eyebrow?: string;
  title: string;
  rows: ResponseRow[];
  /** Real cover-photo URI only. Omit when there is no real photo. */
  thumbnail?: string;
  actions?: ResponseAction[];
  state: ResponseCardState;
  /** Whether to prefix the row with the Ari orb (first-of-group). Default true. */
  showOrb?: boolean;
  onAction?: (id: string) => void;
  onRetry?: () => void;
}

const SkeletonRow: React.FC<{ widthPct: number; reduceMotion: boolean }> = ({
  widthPct,
  reduceMotion,
}) => {
  const shimmer = useSharedValue(0.5);
  useEffect(() => {
    if (!reduceMotion) {
      shimmer.value = withRepeat(
        withTiming(1, { duration: 1100, easing: Easing.linear }),
        -1,
        true,
      );
    } else {
      shimmer.value = 0.5;
    }
    return (): void => cancelAnimation(shimmer);
  }, [reduceMotion, shimmer]);
  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  return (
    <Animated.View
      style={[styles.skeletonRow, { width: `${widthPct}%` }, style]}
    />
  );
};

export const ResponseCard: React.FC<ResponseCardProps> = ({
  eyebrow,
  title,
  rows,
  thumbnail,
  actions,
  state,
  showOrb = true,
  onAction,
  onRetry,
}) => {
  const reduceMotion = useReducedMotion();

  const body = ((): React.ReactNode => {
    if (state === "loading") {
      return (
        <View style={styles.skeletonWrap} accessibilityLabel="Loading">
          <SkeletonRow widthPct={90} reduceMotion={reduceMotion} />
          <SkeletonRow widthPct={70} reduceMotion={reduceMotion} />
          <SkeletonRow widthPct={80} reduceMotion={reduceMotion} />
        </View>
      );
    }
    if (state === "error") {
      // Muted inline retry row — NOT a red card (matches the toast-not-inline
      // -red philosophy). semantic.error label only.
      return (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Couldn't load. Tap to retry."
          style={({ pressed }) => [styles.errorRow, pressed && styles.pressed]}
        >
          <Text style={styles.errorText}>Couldn&apos;t load — tap to retry</Text>
        </Pressable>
      );
    }
    return (
      <>
        {eyebrow ? (
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow.toUpperCase()}
          </Text>
        ) : null}
        <View style={styles.titleRow}>
          {thumbnail ? (
            <Image
              source={{ uri: thumbnail }}
              style={styles.thumbnail}
              accessibilityIgnoresInvertColors
            />
          ) : null}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>
        {rows.length > 0 ? (
          <View style={styles.rows}>
            {rows.map((r, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {r.label}
                </Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {state === "submitted" ? (
          <View style={styles.submittedRibbon}>
            <Text style={styles.submittedText}>Done</Text>
          </View>
        ) : actions && actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => onAction?.(a.id)}
                hitSlop={{ top: 5, bottom: 5 }}
                style={({ pressed }) => [
                  styles.actionBtn,
                  a.primary ? styles.primaryBtn : styles.ghostBtn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <Text style={a.primary ? styles.primaryText : styles.ghostText}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </>
    );
  })();

  return (
    <View style={styles.host}>
      <View style={styles.orbWrap}>
        {showOrb ? <AriOrb size="sm" decorative /> : <View style={styles.orbSpacer} />}
      </View>
      <GlassChrome
        intensity="cardElevated"
        tintColor={glass.tint.profileElevated}
        borderColor={glass.border.profileElevated}
        radius="lg"
        style={[styles.card, state === "disabled" && styles.cardDisabled]}
      >
        <View style={styles.inner} accessibilityRole="summary">
          {body}
        </View>
      </GlassChrome>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  orbWrap: {
    marginTop: 2,
    marginRight: ariThread.orbGap,
  },
  orbSpacer: {
    width: 24,
    height: 24,
  },
  card: {
    flexShrink: 1,
    maxWidth: "80%",
  },
  cardDisabled: {
    opacity: 0.4,
  },
  inner: {
    padding: ariThread.cardPad,
  },
  eyebrow: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: 1.1,
    color: textTokens.secondary,
  },
  titleRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileBase,
  },
  title: {
    flexShrink: 1,
    fontSize: ariThread.cardTitleFont,
    lineHeight: ariThread.cardTitleLine,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  rows: {
    marginTop: spacing.sm,
    gap: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.tertiary,
    letterSpacing: 0.3,
  },
  rowValue: {
    fontSize: 13,
    lineHeight: 17,
    color: textTokens.primary,
    flexShrink: 1,
    textAlign: "right",
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  actionBtn: {
    height: ariThread.btnHeight,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  primaryBtn: {
    backgroundColor: ariPalette.userBubble,
    overflow: "hidden",
  },
  ghostText: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  primaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  pressed: {
    opacity: 0.85,
  },
  skeletonWrap: {
    gap: spacing.sm,
    paddingVertical: 4,
  },
  skeletonRow: {
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileElevated,
  },
  errorRow: {
    paddingVertical: 4,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 17,
    color: semantic.error,
  },
  submittedRibbon: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: semantic.successTint,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: ariThread.ribbonPadH,
    paddingVertical: ariThread.ribbonPadV,
  },
  submittedText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.success,
  },
});

export default ResponseCard;
