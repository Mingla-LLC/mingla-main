/**
 * issue #3284 [bundle budget] — the refund policy editor, loaded in its own chunk.
 *
 * Four lazy business-web screens show the editor: the event Settings step, the
 * experience Pricing step, the trip Policy step and the published-trip Settings
 * accordion. Metro places any module that two lazy chunks import statically in
 * `__common`, the boot payload every visitor downloads (ORCH-1083), so all four
 * import this owner and the editor loads through a dynamic `import()` the first
 * time one of them mounts. Nothing loads it on routes that never show the card.
 *
 * A hand loader rather than React.lazy, for two reasons React.lazy cannot meet:
 * - once the chunk is in memory the real editor renders on the FIRST frame of
 *   every later mount (React.lazy suspends each new tree for a tick, which flashes
 *   the placeholder every time the organiser steps back to the card);
 * - a failed load can be retried. React.lazy keeps a rejected import forever, so
 *   its "Try again" could never succeed without a reload.
 *
 * While loading, the card shows the editor's own eyebrow over a static chip row
 * with the editor's geometry, so no chip, preset or "no policy" helper appears
 * before the organiser's real terms. A load failure is reported through
 * reportNonFatal and shows the app's standard error fallback ("Something broke.
 * We're on it." with Try again). No new copy.
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { accent, radius, spacing } from "../../constants/designSystem";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { DefaultFallback } from "../ui/ErrorBoundary";
import type { RefundPolicyEditorProps } from "./RefundPolicyEditor";

type RefundPolicyEditorModule = typeof import("./RefundPolicyEditor");

let loadedEditor: RefundPolicyEditorModule | undefined;
let pendingEditor: Promise<RefundPolicyEditorModule> | undefined;

/** Load the editor chunk once. A failed load is forgotten, so the next call retries. */
export const loadRefundPolicyEditor = (): Promise<RefundPolicyEditorModule> => {
  if (loadedEditor !== undefined) return Promise.resolve(loadedEditor);
  pendingEditor ??= import("./RefundPolicyEditor").then(
    (module) => (loadedEditor = module),
    (error: unknown) => {
      pendingEditor = undefined;
      throw error;
    },
  );
  return pendingEditor;
};

export const LazyRefundPolicyEditor: React.FC<RefundPolicyEditorProps> = (props) => {
  const [editorModule, setEditorModule] = useState(loadedEditor);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (editorModule !== undefined) return undefined;
    let live = true;
    loadRefundPolicyEditor().then(
      (module) => {
        if (live) setEditorModule(module);
      },
      (error: unknown) => {
        reportNonFatal("LazyRefundPolicyEditor", error, { issue: "3284" });
        if (live) setFailure(error ?? "load failed");
      },
    );
    return (): void => {
      live = false;
    };
  }, [editorModule, attempt]);

  const retry = useCallback((): void => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  if (editorModule !== undefined) {
    const { RefundPolicyEditor } = editorModule;
    return <RefundPolicyEditor {...props} />;
  }
  if (failure !== null) {
    return <DefaultFallback error={failure} resetErrorBoundary={retry} />;
  }
  // Trips show three preset chips; events and experiences show four.
  const chips = (props.offeringType ?? "trip") === "trip" ? [0, 1, 2] : [0, 1, 2, 3];
  return (
    <View style={styles.container} testID="refund-policy-editor-loading">
      <Text style={styles.eyebrow}>REFUND POLICY</Text>
      <View style={styles.chipRow} accessibilityState={{ busy: true }}>
        {chips.map((n) => (
          <View key={n} style={styles.chip} />
        ))}
      </View>
    </View>
  );
};

// Mirrors RefundPolicyEditor's container, eyebrow and chip-row geometry, so the
// editor replaces this in place.
const styles = StyleSheet.create({
  container: { paddingVertical: spacing.sm },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    width: 84,
    minHeight: 34,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
});
