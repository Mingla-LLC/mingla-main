/**
 * #3720 Slice G — Guides tab (Help Centre videos).
 */

import React, { useCallback } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export type GuidesTabPanelProps = {
  onToast: (message: string) => void;
};

export const GuidesTabPanel: React.FC<GuidesTabPanelProps> = ({ onToast }) => {
  const handleOpenHelpCentre = useCallback((): void => {
    void Linking.openURL(HELP_CENTRE_URL).catch(() => {
      onToast("Couldn't open the Help Centre. Try again in a moment.");
    });
  }, [onToast]);

  return (
    <View style={styles.col}>
      <Pressable
        onPress={handleOpenHelpCentre}
        accessibilityRole="link"
        accessibilityLabel="Help Centre videos"
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <GlassCard variant="elevated" radius="md" padding={spacing.md}>
          <View style={styles.rowTop}>
            <Text style={styles.rowSubject} numberOfLines={1}>
              Help Centre videos
            </Text>
            <Icon name="chevR" size={16} color={textTokens.tertiary} />
          </View>
          <Text style={styles.rowMeta} numberOfLines={2}>
            Short guides for hosting on Mingla
          </Text>
        </GlassCard>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  col: {
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowSubject: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowMeta: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: textTokens.tertiary,
  },
});
