/**
 * Banner — #4420 Graphite Glass (spec §3.1). Inline status inside a page:
 * a pane with a 3px leading tone bar, a short title, an optional one-line
 * body and an optional action. Not a toast (it does not float or time out).
 *
 * Tones: warning | danger | ok | info. Colour comes only from `color.*`.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";

import { Material } from "./Material";

export type BannerTone = "warning" | "danger" | "ok" | "info";

export interface BannerAction {
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface BannerProps {
  tone: BannerTone;
  title: string;
  body?: string;
  action?: BannerAction;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const BANNER_TONE_BAR: Record<BannerTone, string> = {
  warning: color.warning,
  danger: color.danger,
  ok: color.success,
  info: color.info,
};

export const Banner: React.FC<BannerProps> = ({ tone, title, body, action, testID, style }) => (
  <Material
    kind="pane"
    radius={radius.md}
    style={[styles.root, style]}
    testID={testID}
  >
    <View
      accessibilityRole={tone === "danger" || tone === "warning" ? "alert" : undefined}
      style={styles.row}
    >
      <View style={[styles.bar, { backgroundColor: BANNER_TONE_BAR[tone] }]} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {body !== undefined && body.length > 0 ? <Text style={styles.body}>{body}</Text> : null}
      </View>
      {action !== undefined ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={8}
          style={styles.action}
          testID={action.testID}
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  </Material>
);

const styles = StyleSheet.create({
  root: { alignSelf: "stretch" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingRight: space[4],
  },
  bar: {
    alignSelf: "stretch",
    width: 3,
    borderTopRightRadius: radius.full,
    borderBottomRightRadius: radius.full,
  },
  text: { flex: 1, minWidth: 0, gap: space[1] },
  title: { ...type.row, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  action: {
    minHeight: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    flexShrink: 0,
  },
  actionLabel: { ...type.btnSm, color: color.text1 },
});

export default Banner;
