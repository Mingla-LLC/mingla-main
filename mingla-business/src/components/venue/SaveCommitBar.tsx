/**
 * #3655 Story 2 — caption + primary commit control for venue save surfaces.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import type { IconName } from "../ui/Icon";
import { formatUnsavedCaption } from "./venueLeaveContract";

export type SaveCommitCaptionState =
  | "clean"
  | "dirty"
  | "invalid"
  | "saving"
  | "saved"
  | "failed";

export interface SaveCommitBarProps {
  label: string;
  changedLabels: readonly string[];
  captionState: SaveCommitCaptionState;
  /** Override caption text (e.g. invalid reason, review-gated copy). */
  captionOverride?: string | null;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: IconName;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function SaveCommitBar({
  label,
  changedLabels,
  captionState,
  captionOverride = null,
  onPress,
  disabled = false,
  loading = false,
  leadingIcon,
  testID,
  style,
}: SaveCommitBarProps): React.ReactElement {
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (captionState !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 1500);
    return (): void => clearTimeout(timer);
  }, [captionState]);

  const captionText = ((): string => {
    if (captionOverride !== null && captionOverride.length > 0) {
      return captionOverride;
    }
    switch (captionState) {
      case "clean":
        return "No changes yet";
      case "dirty":
        return formatUnsavedCaption(changedLabels);
      case "invalid":
        return "Fix the highlighted fields to save";
      case "saving":
        return changedLabels.length > 0
          ? `Saving ${changedLabels.length} change${changedLabels.length === 1 ? "" : "s"}…`
          : "Saving…";
      case "saved":
        return "Saved";
      case "failed":
        return "Couldn't save. Your changes are still here.";
      default:
        return "No changes yet";
    }
  })();

  const captionStyle =
    captionState === "failed" || captionState === "invalid"
      ? styles.captionBad
      : showSaved || captionState === "saved"
        ? styles.captionOk
        : captionState === "clean"
          ? styles.captionClean
          : styles.captionDirty;

  const commitDisabled =
    disabled ||
    loading ||
    captionState === "clean" ||
    captionState === "invalid" ||
    captionState === "saving";

  return (
    <View
      style={[styles.host, style]}
      accessibilityRole="toolbar"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.captionRow}>
        {captionState === "dirty" || captionState === "saving" ? (
          <View style={styles.dot} accessibilityElementsHidden />
        ) : null}
        <Text
          style={[styles.caption, captionStyle]}
          accessibilityLiveRegion="polite"
        >
          {captionText}
        </Text>
      </View>
      <Button
        label={
          captionState === "failed"
            ? "Try again"
            : loading || captionState === "saving"
              ? "Saving…"
              : label
        }
        onPress={onPress}
        variant="primary"
        size="lg"
        fullWidth
        disabled={commitDisabled && captionState !== "failed"}
        loading={loading || captionState === "saving"}
        leadingIcon={leadingIcon}
        accessibilityLabel={
          captionState === "clean"
            ? `${label}. No changes to save`
            : `${label}. ${captionText}`
        }
        testID={testID !== undefined ? `${testID}-button` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
  },
  captionRow: {
    minHeight: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: accent.warm,
  },
  caption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    textAlign: "center",
  },
  captionClean: {
    color: textTokens.tertiary,
  },
  captionDirty: {
    color: textTokens.secondary,
  },
  captionOk: {
    color: "#4ade80",
  },
  captionBad: {
    color: semantic.errorText,
  },
});

export default SaveCommitBar;
