/**
 * ComposerPreviewTabs — #4273 wave B. One tab per ticked method, above the
 * preview that method's guest will get. The same tabs on the desktop pane and
 * the phone preview sheet.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  colors,
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
  /** #4273 — the tab's words ("Email · Sent"); defaults to the method name. */
  labelFor?: (kind: MarketingChannelKind) => string;
  /**
   * #4273 — false lets the tabs and pane take their content height inside a
   * page scroll (the sent-campaign screen). Default fills the parent.
   */
  fill?: boolean;
  /**
   * #4273 — the surface the tabs sit on. "light" is the phone preview sheet
   * (#F5F5F7 under a white header): the dark-surface white labels vanish
   * there, so it uses the light-surface text tokens (>= 4.5:1).
   */
  surface?: "dark" | "light";
}

export const ComposerPreviewTabs: React.FC<ComposerPreviewTabsProps> = ({
  channels,
  active,
  onSelect,
  pane,
  labelFor,
  fill = true,
  surface = "dark",
}) => (
  <View style={fill ? styles.host : styles.hostContent} testID="composer-preview-tabs">
    {channels.length > 1 ? (
      <View style={styles.row} accessibilityRole="tablist">
        {channels.map((kind) => {
          const isActive = kind === active;
          return (
            <Pressable
              key={kind}
              onPress={() => onSelect(kind)}
              accessibilityRole="tab"
              accessibilityLabel={labelFor !== undefined ? `Show ${labelFor(kind)}` : `Preview ${CHANNEL_LABEL[kind]}`}
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.tab,
                surface === "light" ? styles.tabOnLight : null,
                isActive ? styles.tabActive : null,
                pressed ? styles.tabPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  isActive ? styles.tabLabelActive : null,
                  surface === "light"
                    ? isActive ? styles.tabLabelActiveOnLight : styles.tabLabelOnLight
                    : null,
                ]}
              >
                {labelFor !== undefined ? labelFor(kind) : CHANNEL_LABEL[kind]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null}
    <View style={fill ? styles.pane : styles.paneContent}>{pane}</View>
  </View>
);

const styles = StyleSheet.create({
  host: { flex: 1, minHeight: 0 },
  hostContent: { flexGrow: 0 },
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
  tabOnLight: {
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
  },
  tabActive: { borderColor: accent.warm, backgroundColor: accent.tint },
  tabPressed: { opacity: 0.8 },
  tabLabel: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  tabLabelActive: { color: textTokens.primary },
  // #4273: secondary #4b5563 on #F5F5F7 / #FFFFFF is 6.9:1 / 7.6:1.
  tabLabelOnLight: { color: colors.text.secondary },
  tabLabelActiveOnLight: { color: colors.text.primary },
  pane: { flex: 1, minHeight: 0 },
  paneContent: { flexGrow: 0 },
});
