/**
 * ComposerPreviewTabs — #4273 wave B. One tab per ticked method, above the
 * preview that method's guest will get. The same tabs on the desktop pane and
 * the phone preview sheet.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { CHANNEL_LABEL, type MarketingChannelKind } from "./ChannelTabs";

export interface ComposerPreviewTabsProps {
  channels: readonly MarketingChannelKind[];
  active: MarketingChannelKind;
  onSelect: (kind: MarketingChannelKind) => void;
  pane: React.ReactElement;
}

export const ComposerPreviewTabs: React.FC<ComposerPreviewTabsProps> = ({
  channels,
  active,
  onSelect,
  pane,
}) => (
  <View style={styles.host} testID="composer-preview-tabs">
    {channels.length > 1 ? (
      <View style={styles.row} accessibilityRole="tablist">
        {channels.map((kind) => {
          const isActive = kind === active;
          return (
            <Pressable
              key={kind}
              onPress={() => onSelect(kind)}
              accessibilityRole="tab"
              accessibilityLabel={`Preview ${CHANNEL_LABEL[kind]}`}
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.tab,
                isActive ? styles.tabActive : null,
                pressed ? styles.tabPressed : null,
              ]}
            >
              <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>
                {CHANNEL_LABEL[kind]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null}
    <View style={styles.pane}>{pane}</View>
  </View>
);

const styles = StyleSheet.create({
  host: { flex: 1, minHeight: 0 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexShrink: 0,
  },
  tab: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  tabActive: { borderColor: accent.warm, backgroundColor: accent.tint },
  tabPressed: { opacity: 0.8 },
  tabLabel: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  tabLabelActive: { color: textTokens.primary },
  pane: { flex: 1, minHeight: 0 },
});
