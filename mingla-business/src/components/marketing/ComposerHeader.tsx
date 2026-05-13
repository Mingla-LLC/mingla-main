/**
 * ComposerHeader — top bar for the composer route.
 * Left: back chevron. Center: "New campaign". Right: "Save draft" action.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../ui/Icon";
import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerHeaderProps {
  title?: string;
  onBack: () => void;
  onSaveDraft: () => void;
  saveDraftDisabled?: boolean;
}

export const ComposerHeader: React.FC<ComposerHeaderProps> = ({
  title = "New campaign",
  onBack,
  onSaveDraft,
  saveDraftDisabled,
}) => {
  return (
    <View style={styles.host}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [
          styles.iconBtn,
          pressed ? styles.iconBtnPressed : null,
        ]}
        hitSlop={8}
      >
        <Icon name="arrowL" size={24} color={textTokens.primary} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Pressable
        onPress={onSaveDraft}
        disabled={saveDraftDisabled === true}
        accessibilityRole="button"
        accessibilityLabel="Save draft"
        style={({ pressed }) => [
          styles.saveBtn,
          pressed && saveDraftDisabled !== true ? styles.saveBtnPressed : null,
          saveDraftDisabled === true ? styles.saveBtnDisabled : null,
        ]}
        hitSlop={8}
      >
        <Text
          style={[
            styles.saveLabel,
            saveDraftDisabled === true ? styles.saveLabelDisabled : null,
          ]}
        >
          Save draft
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
    gap: spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  iconBtnPressed: {
    opacity: 0.78,
  },
  title: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  saveBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnPressed: {
    opacity: 0.78,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  saveLabelDisabled: {
    color: textTokens.tertiary,
  },
});
