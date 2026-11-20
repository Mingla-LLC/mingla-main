/**
 * #4522 — the screens of the 4-step trip builder (flag `tripBuilderV2`) that
 * are not a step body: the "Saved" pill, the publish checklist and the section
 * headings. The rules they draw live in `tripBuilderV2Model.ts`.
 *
 * `TRIP_BUILDER_V2` is the one place the wizard reads the flag, so the wizard
 * has a single new import and a flag-off build is byte-for-byte today's wizard.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { isFeatureEnabled } from "../../config/featureFlags";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import {
  BUILDER_STEP_TITLES,
  checklistProgress,
  publishUnlockLine,
  type BuilderStep,
  type ChecklistItem,
  type PillState,
} from "./tripBuilderV2Model";

export const TRIP_BUILDER_V2: boolean = isFeatureEnabled("tripBuilderV2");

// ---------------------------------------------------------------------------
// "Saved" pill
// ---------------------------------------------------------------------------

export interface TripBuilderAutosavePillProps {
  state: PillState;
  /** Tapping a failed pill saves now. */
  onRetry: () => void;
}

export const TripBuilderAutosavePill: React.FC<TripBuilderAutosavePillProps> = ({
  state,
  onRetry,
}) => {
  if (state.kind === "idle") return null;
  const failed = state.kind === "error" || state.kind === "conflict";
  const body = (
    <View
      style={[styles.pill, failed ? styles.pillFailed : null]}
      testID="trip-builder-save-pill"
    >
      {state.kind === "saved" ? (
        <Icon name="check" size={12} color={color.success} />
      ) : null}
      <Text style={[styles.pillText, failed ? styles.pillTextFailed : null]}>
        {state.label}
      </Text>
    </View>
  );
  if (!state.retryable) {
    return (
      <View accessibilityRole="text" accessibilityLiveRegion="polite">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Not saved. Tap to save now."
      hitSlop={8}
      testID="trip-builder-save-pill-retry"
    >
      {body}
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
// Section heading inside a step
// ---------------------------------------------------------------------------

export const TripBuilderSectionTitle: React.FC<{ title: string }> = ({ title }) => (
  <Text accessibilityRole="header" style={styles.sectionTitle}>
    {title}
  </Text>
);

// ---------------------------------------------------------------------------
// Publish checklist
// ---------------------------------------------------------------------------

export interface TripPublishChecklistProps {
  items: ReadonlyArray<ChecklistItem>;
  onJump: (item: ChecklistItem) => void;
  onConnectBank: () => void;
}

export const TripPublishChecklist: React.FC<TripPublishChecklistProps> = ({
  items,
  onJump,
  onConnectBank,
}) => {
  const { done, total } = checklistProgress(items);
  const unlock = publishUnlockLine(items);
  return (
    <GlassCard variant="base" padding={space[4]} radius="lg" testID="trip-publish-checklist">
      <View style={styles.checkHeader}>
        <Text accessibilityRole="header" style={styles.checkTitle}>
          Before you publish
        </Text>
        <Text style={styles.checkCount} testID="trip-publish-checklist-count">
          {done} of {total}
        </Text>
      </View>
      {items.map((item) => (
        <View key={item.key} style={styles.checkRow} testID={`trip-checklist-${item.key}`}>
          <View style={[styles.checkDot, item.done ? styles.checkDotDone : null]}>
            {item.done ? <Icon name="check" size={12} color={color.paper} /> : null}
          </View>
          <Text style={[styles.checkLabel, item.done ? styles.checkLabelDone : null]}>
            {item.label}
          </Text>
          {item.done ? null : (
            <Pressable
              onPress={() => (item.action === "connect_bank" ? onConnectBank() : onJump(item))}
              accessibilityRole="button"
              accessibilityLabel={
                item.action === "connect_bank"
                  ? "Connect bank"
                  : `Fix ${item.label} in ${BUILDER_STEP_TITLES[item.step]}`
              }
              hitSlop={8}
              style={styles.checkFix}
              testID={`trip-checklist-fix-${item.key}`}
            >
              <Text style={styles.checkFixText}>
                {item.action === "connect_bank"
                  ? "Connect bank"
                  : `Fix in ${BUILDER_STEP_TITLES[item.step]}`}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
      <Text
        style={styles.unlockLine}
        accessibilityLiveRegion="polite"
        testID="trip-publish-unlock-line"
      >
        {unlock ?? "Everything is ready. Publish when you are."}
      </Text>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  pillFailed: {
    borderColor: color.danger,
  },
  pillText: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  pillTextFailed: {
    color: color.danger,
  },
  sectionTitle: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginTop: space[4],
  },
  checkHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[3],
  },
  checkTitle: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  checkCount: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 44,
  },
  checkDot: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDotDone: {
    backgroundColor: color.success,
    borderColor: color.success,
  },
  checkLabel: {
    flex: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  checkLabelDone: {
    color: color.text2,
  },
  checkFix: {
    minHeight: 44,
    justifyContent: "center",
  },
  checkFixText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  unlockLine: {
    marginTop: space[3],
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
});
