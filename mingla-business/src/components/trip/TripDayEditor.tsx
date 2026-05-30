/**
 * TripDayEditor — single day card used inside TripCreatorStep2Itinerary.
 * Tr2 (ORCH-0859).
 *
 * Renders one day's editable title + narrative + ordinal display + delete
 * button. Stacked-cards UX (SPEC §4.8 Step 2). Reorder handled by parent
 * via swap-buttons (drag-reorder via react-native-draggable-flatlist
 * intentionally deferred to polish ORCH — adds a new dep + complexity not
 * worth Tr2 scope).
 */

import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export interface TripDayDraft {
  ordinal: number;
  title: string;
  narrative: string;
}

export interface TripDayEditorProps {
  day: TripDayDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<TripDayDraft>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled?: boolean;
  testID?: string;
}

const NARRATIVE_MAX = 1000;

export const TripDayEditor: React.FC<TripDayEditorProps> = ({
  day,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  disabled,
  testID,
}) => {
  const canMoveUp = !disabled && index > 0;
  const canMoveDown = !disabled && index < total - 1;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.ordinalLabel}>Day {day.ordinal}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={onMoveUp}
            disabled={!canMoveUp}
            accessibilityRole="button"
            accessibilityLabel={`Move day ${day.ordinal} up`}
            accessibilityState={{ disabled: !canMoveUp }}
            style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
            hitSlop={8}
          >
            <Icon name="chevU" size={16} color={textTokens.secondary} />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={!canMoveDown}
            accessibilityRole="button"
            accessibilityLabel={`Move day ${day.ordinal} down`}
            accessibilityState={{ disabled: !canMoveDown }}
            style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
            hitSlop={8}
          >
            <Icon name="chevD" size={16} color={textTokens.secondary} />
          </Pressable>
          <Pressable
            onPress={onDelete}
            disabled={disabled || total <= 1}
            accessibilityRole="button"
            accessibilityLabel={`Delete day ${day.ordinal}`}
            accessibilityState={{ disabled: disabled || total <= 1 }}
            style={[
              styles.iconBtn,
              (disabled || total <= 1) && styles.iconBtnDisabled,
            ]}
            hitSlop={8}
          >
            <Icon name="trash" size={16} color={textTokens.tertiary} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.fieldLabel}>Day title</Text>
      <TextInput
        value={day.title}
        onChangeText={(v) => onChange({ title: v })}
        placeholder={`e.g. Day ${day.ordinal} — Arrival + sunset welcome dinner`}
        placeholderTextColor={textTokens.tertiary}
        editable={!disabled}
        accessibilityLabel={`Day ${day.ordinal} title`}
        style={styles.titleInput}
        testID={testID === undefined ? undefined : `${testID}-title`}
      />

      <Text style={styles.fieldLabel}>What happens</Text>
      <TextInput
        value={day.narrative}
        onChangeText={(v) => onChange({ narrative: v.slice(0, NARRATIVE_MAX) })}
        placeholder="Briefly describe what travelers will do on this day"
        placeholderTextColor={textTokens.tertiary}
        multiline
        numberOfLines={3}
        maxLength={NARRATIVE_MAX}
        editable={!disabled}
        accessibilityLabel={`Day ${day.ordinal} narrative`}
        style={styles.narrativeInput}
        textAlignVertical="top"
        testID={testID === undefined ? undefined : `${testID}-narrative`}
      />
      <Text style={styles.charCounter}>
        {day.narrative.length}/{NARRATIVE_MAX}
      </Text>
    </View>
  );
};

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  ordinalLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    color: textTokens.secondary,
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  iconBtnDisabled: {
    opacity: 0.35,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  titleInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  narrativeInput: {
    minHeight: 72,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  charCounter: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    alignSelf: "flex-end",
  },
});

export default TripDayEditor;
