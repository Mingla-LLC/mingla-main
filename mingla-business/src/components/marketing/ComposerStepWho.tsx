/**
 * ComposerStepWho — Step 1 of the composer. Audience picker pressable +
 * reach counts caption.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export interface ComposerStepWhoProps {
  audienceName: string | null;
  reachableEmail: number | null;
  totalAudience: number | null;
  onOpenPicker: () => void;
  disabled?: boolean;
  /**
   * #2262 bpShort ladder, step 1. On a short viewport (< 720pt tall — the
   * 1024x700 desktop case and every phone with the keyboard up) the reach
   * caption moves INTO the picker row as a right-aligned count instead of
   * occupying its own line, recovering ~20pt for the composer sheet.
   *
   * Nothing is lost: the same two numbers are still on screen, and the full
   * sentence stays in the picker's `accessibilityLabel`. The commit bar is
   * never a step in this ladder — it is the last thing standing.
   */
  compact?: boolean;
  /** #4273 — several groups: "3 people · each counted once" (the server's total). */
  combinedCaption?: string | null;
}

export const ComposerStepWho: React.FC<ComposerStepWhoProps> = ({
  audienceName,
  reachableEmail,
  totalAudience,
  onOpenPicker,
  disabled,
  compact,
  combinedCaption,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const isEmpty = audienceName === null;
  const reachText = combinedCaption ?? (
    totalAudience !== null && reachableEmail !== null
      ? `${totalAudience} people · ${reachableEmail} with marketing consent`
      : null);
  const reachCount = totalAudience !== null ? `${totalAudience}` : null;
  const isCompact = compact === true;
  return (
    <View style={styles.host}>
      {/* F.8: dropped "STEP 1 — WHO" label per ORCH-0864 compact-layout brief.
          The Pick-an-audience button is self-explanatory; the step prefix
          was a V1 wizard affordance not needed in the dense V2 layout. */}
      <Pressable
        onPress={onOpenPicker}
        disabled={disabled === true}
        accessibilityRole="button"
        accessibilityLabel={
          isEmpty
            ? "Pick an audience"
            : `Change audience: ${audienceName ?? ""}${reachText !== null ? `. ${reachText}` : ""}`
        }
        accessibilityState={{ disabled: disabled === true }}
        style={({ pressed }) => [
          styles.picker,
          isEmpty ? styles.pickerEmpty : styles.pickerFilled,
          isWideDesktop ? styles.desktopPicker : null,
          isWideDesktop && !isEmpty ? styles.desktopPickerFilled : null,
          pressed && disabled !== true ? styles.pickerPressed : null,
          disabled === true ? styles.pickerDisabled : null,
        ]}
      >
        <Text style={styles.pickerLabel} numberOfLines={1}>
          {isEmpty ? "Pick an audience" : (audienceName ?? "Audience")}
        </Text>
        {isCompact && reachCount !== null ? (
          <Text style={styles.pickerCount} testID="composer-who-compact-count">
            {reachCount}
          </Text>
        ) : null}
        <Text style={styles.pickerChevron}>›</Text>
      </Pressable>
      {isCompact ? null : reachText !== null ? (
        <Text style={styles.reachText}>{reachText}</Text>
      ) : disabled === true ? (
        <Text style={styles.disabledCaption}>
          No audiences yet — your buyers fill in as people purchase tickets.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[1],
  },
  picker: {
    minHeight: 48, // F.8: was 56
    paddingHorizontal: space[4],
    borderRadius: radius.md, // F.8: was radius.lg
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  pickerEmpty: {
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  pickerFilled: {
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  desktopPicker: {
    borderColor: color.lineStrong,
    backgroundColor: "transparent",
  },
  desktopPickerFilled: {
    borderColor: color.lineStrong,
  },
  pickerPressed: {
    opacity: 0.85,
  },
  pickerDisabled: {
    opacity: 0.5,
  },
  pickerLabel: {
    ...type.body,
    color: color.text1,
    fontWeight: "600",
    flex: 1,
  },
  pickerCount: {
    ...type.caption,
    color: color.text3,
    flexShrink: 0,
  },
  pickerChevron: {
    ...type.row,
    color: color.text2,
  },
  reachText: {
    ...type.small,
    color: color.text2,
  },
  disabledCaption: {
    ...type.small,
    color: color.text3,
  },
});
