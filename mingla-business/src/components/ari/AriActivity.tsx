/** Issue #3429 — event-backed Ari activity and terminal recovery. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AlertCircle,
  ArrowUp,
  Cloud,
  Files,
  RotateCw,
  Search,
  Settings,
  Sparkles,
  Square,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { accent, ariPalette, ariThread, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import type { AriActiveTurn } from "../../hooks/useAgentChat";
import type { AriActivityEventType } from "../../services/ariTurnService";
import { captureAriTurnOutcome } from "../../services/ariPolishAnalytics";

type VisiblePhase = "sending" | Exclude<AriActivityEventType, "accepted" | "response_ready" | "reconciliation_started" | "reconciliation_finished" | "stopped" | "failed">;

const PHASES: Record<VisiblePhase, { label: string; icon: LucideIcon; duration: number; motion: "translateY" | "opacity" | "scale" | "translateX" | "rotate" }> = {
  sending: { label: "Sending your message…", icon: ArrowUp, duration: 900, motion: "translateY" },
  attachments_processing_started: { label: "Ari is reading your attachments…", icon: Files, duration: 1000, motion: "opacity" },
  model_started: { label: "Ari is thinking…", icon: Sparkles, duration: 1200, motion: "scale" },
  workspace_read_started: { label: "Ari is checking your workspace…", icon: Search, duration: 1200, motion: "translateX" },
  approved_action_started: { label: "Ari is working on the approved action…", icon: Settings, duration: 1600, motion: "rotate" },
  automated_retry_started: { label: "Ari is retrying…", icon: RotateCw, duration: 900, motion: "rotate" },
  finalizing_started: { label: "Ari is finishing up…", icon: Sparkles, duration: 800, motion: "opacity" },
};

export function activityLabelForEvent(eventType: AriActivityEventType | null): string | null {
  if (!eventType || !(eventType in PHASES)) return null;
  return PHASES[eventType as VisiblePhase].label;
}

const MotionIcon: React.FC<{ phase: VisiblePhase }> = ({ phase }) => {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const config = PHASES[phase];
  const Icon = config.icon;

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (reduced) return;
    progress.value = withRepeat(withSequence(
      withTiming(1, { duration: config.duration / 2, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: config.duration / 2, easing: Easing.inOut(Easing.quad) }),
    ), -1, false);
    return () => cancelAnimation(progress);
  }, [config.duration, progress, reduced]);

  const animated = useAnimatedStyle(() => {
    const p = progress.value;
    if (config.motion === "opacity") return { opacity: 0.45 + p * 0.55 };
    if (config.motion === "scale") return { transform: [{ scale: 0.92 + p * 0.12 }] };
    if (config.motion === "translateX") return { transform: [{ translateX: -2 + p * 4 }] };
    if (config.motion === "rotate") return { transform: [{ rotate: `${p * 360}deg` }] };
    return { transform: [{ translateY: -p * 2 }] };
  });

  return <Animated.View style={[styles.iconBox, animated]}><Icon size={16} color={ariPalette.flame} strokeWidth={2} /></Animated.View>;
};

export const AriActivity: React.FC<{
  turn: AriActiveTurn;
  onStop: () => Promise<void> | void;
  onRetry: () => Promise<unknown> | void;
  surface?: "main" | "website";
}> = ({ turn, onStop, onRetry, surface = "main" }) => {
  const [longWait, setLongWait] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [waitDismissedUntil, setWaitDismissedUntil] = useState(0);
  const announcedEventId = useRef<string | null>(null);
  const phase: VisiblePhase = turn.event?.event_type && turn.event.event_type in PHASES
    ? turn.event.event_type as VisiblePhase
    : "sending";
  // P2-7: "Reconnecting to Ari…" only while canonical reconciliation is real;
  // a pending Stop keeps the last truthful label.
  const label = turn.reconciling
    ? "Reconnecting to Ari…"
    : PHASES[phase].label;
  const terminal = turn.delivery === "stopped" || turn.delivery === "failed" ||
    (!!turn.accepted && !!turn.errorMessage && turn.delivery === "sent");

  useEffect(() => {
    setLongWait(false);
    setStopRequested(false);
    const remaining = Math.max(0, turn.startedAt + 15_000 - Date.now());
    const timer = setTimeout(() => {
      if (Date.now() >= waitDismissedUntil) setLongWait(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [turn.clientTurnId, turn.startedAt, waitDismissedUntil]);

  useEffect(() => {
    if (terminal) {
      AccessibilityInfo.announceForAccessibility(turn.errorMessage ?? "Ari stopped. Your message is still here.");
      return;
    }
    const eventId = turn.event?.id ?? `${turn.clientTurnId}-${label}`;
    const timer = setTimeout(() => {
      if (announcedEventId.current === eventId) return;
      announcedEventId.current = eventId;
      AccessibilityInfo.announceForAccessibility(label);
    }, 500);
    return () => clearTimeout(timer);
  }, [label, terminal, turn.clientTurnId, turn.errorMessage, turn.event?.id]);

  const icon = useMemo(() => {
    if (turn.reconciling) return <View style={styles.iconBox}><Cloud size={16} color={ariPalette.flame} /></View>;
    if (turn.delivery === "stopped") return <View style={styles.iconBox}><Square size={16} color={ariPalette.flame} /></View>;
    if (terminal) return <View style={styles.iconBox}><AlertCircle size={16} color={ariPalette.flame} /></View>;
    return <MotionIcon phase={phase} />;
  }, [phase, terminal, turn.delivery, turn.reconciling]);

  if (terminal) {
    return (
      <View style={styles.callout} accessibilityRole="alert">
        <View style={styles.labelRow}>{icon}<Text style={styles.label}>{turn.errorMessage}</Text></View>
        <Pressable style={styles.primaryAction} accessibilityRole="button" accessibilityLabel="Try again" onPress={() => void onRetry()}>
          <RotateCw size={16} color={ariThread.onUserBubble} /><Text style={styles.primaryActionText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.callout} accessibilityLiveRegion="polite">
      <View style={styles.labelRow}>{icon}<Text style={styles.label}>{label}</Text></View>
      {!turn.stoppable ? null : longWait ? (
        <View style={styles.longWait}>
          <Text style={styles.longWaitText}>This is taking longer than usual. You can keep waiting or stop Ari.</Text>
          <View style={styles.actionRow}>
            <Pressable style={styles.secondaryAction} accessibilityRole="button" accessibilityLabel="Keep waiting" onPress={() => { setLongWait(false); setWaitDismissedUntil(Date.now() + 30_000); }}>
              <Text style={styles.secondaryActionText}>Keep waiting</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryAction, stopRequested && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={stopRequested ? "Stop requested" : "Stop Ari"}
              accessibilityState={{ disabled: stopRequested }}
              disabled={stopRequested}
              onPress={() => {
                setStopRequested(true);
                captureAriTurnOutcome({ surface, outcome: "cancelled" });
                void onStop();
              }}
            >
              <Square size={15} color={ariThread.onUserBubble} /><Text style={styles.primaryActionText}>Stop Ari</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={[styles.stopControl, stopRequested && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={stopRequested ? "Stop requested" : turn.accepted ? "Stop Ari" : "Stop sending"}
          accessibilityState={{ disabled: stopRequested }}
          disabled={stopRequested}
          onPress={() => { setStopRequested(true); void onStop(); }}
        >
          <Text style={styles.stopText}>{turn.accepted ? "Stop Ari" : "Stop sending"}</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  callout: {
    marginLeft: 24 + ariThread.orbGap,
    minHeight: ariThread.activityMinH,
    maxWidth: ariThread.bubbleMaxWidth,
    borderRadius: ariThread.bubbleRadius,
    borderTopLeftRadius: ariThread.bubbleTail,
    borderWidth: Platform.OS === "android" ? 0 : 1,
    borderColor: glass.border.profileBase,
    backgroundColor: Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileElevated,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  labelRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBox: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, color: textTokens.primary, fontSize: ariThread.labelFont, lineHeight: ariThread.labelLine, fontWeight: "500" },
  stopControl: { minWidth: 88, minHeight: 44, alignSelf: "flex-end", alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  stopText: { color: accent.warm, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  longWait: { gap: spacing.sm },
  longWaitText: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "flex-end" },
  secondaryAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
  secondaryActionText: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  primaryAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: accent.warm },
  primaryActionText: { color: ariThread.onUserBubble, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.45 },
});

export default AriActivity;
