import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AriOrb } from "../../components/ari/AriOrb";
import { color, space } from "../../constants/designSystem";

/**
 * #4420 (device round 2) — a thread that has not opened after this long is
 * treated as failed (Constitution 3: no screen spins forever). Long enough for
 * a slow network; short enough that a host is never left guessing.
 */
export const ARI_THREAD_OPEN_TIMEOUT_MS = 15_000;

/** True once `active` has stayed true for `ms` without a reset. */
export const useStalled = (active: boolean, ms: number, resetKey: number): boolean => {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!active) return undefined;
    const timer = setTimeout(() => setStalled(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms, resetKey]);
  return active && stalled;
};

export interface AriThreadLoadingStateProps {
  /** The load failed or timed out: show the error and a retry instead. */
  failed?: boolean;
  /**
   * The retry control (the screen passes its Button), so this view stays
   * free of the Button graph and loads in node-env suites.
   */
  retry?: React.ReactNode;
}

/** The visible, motion-aware transition while an existing Ari thread loads. */
export const AriThreadLoadingState: React.FC<AriThreadLoadingStateProps> = ({
  failed = false,
  retry,
}) =>
  failed ? (
    <View style={styles.root} accessibilityLiveRegion="polite" testID="ari-thread-open-failed">
      <AriOrb size="md" decorative />
      <Text style={styles.copy} accessibilityRole="alert">
        Couldn't open this conversation.
      </Text>
      {retry ?? null}
    </View>
  ) : (
    <View
      style={styles.root}
      accessibilityRole="progressbar"
      accessibilityLabel="Opening Ari conversation"
      accessibilityLiveRegion="polite"
    >
      <AriOrb size="md" thinking decorative />
      <Text style={styles.copy}>Opening conversation…</Text>
    </View>
  );

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
  },
  copy: {
    color: color.text2,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
});
