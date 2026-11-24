/**
 * #4523 — the Host app's injection for @mingla/calendar: tokens, the Host
 * `Sheet`, and Host icons. The package owns no colour and no sheet; this file
 * is the one place the Host supplies them.
 */
import type {
  CalendarConfig,
  CalendarIconName,
  CalendarSheetProps,
  CalendarTokens,
} from "@mingla/calendar/types";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

const TOKENS: CalendarTokens = {
  surface: color.transparent,
  text: color.text1,
  textMuted: color.text2,
  textFaint: color.text3,
  border: color.line,
  fieldFill: color.fill.inset,
  selectedFill: color.paper,
  onSelected: color.ink,
  rangeFill: color.lineStrong,
  todayDot: color.text1,
  error: color.errorText,
  radius: radius.md,
  dayRadius: radius.sm,
};

const ICONS: Record<CalendarIconName, IconName> = {
  calendar: "calendar",
  "chevron-left": "chevL",
  "chevron-right": "chevR",
  close: "close",
  clock: "clock",
};

function HostCalendarSheet({ visible, onClose, title, closeLabel, children, testID }: CalendarSheetProps): React.ReactElement {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.85} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          hitSlop={8}
          onPress={onClose}
          testID={testID === undefined ? undefined : testID.replace(/-sheet$/, "-close")}
          style={styles.close}
        >
          <Icon name="close" color={color.text1} size={18} />
        </Pressable>
      </View>
      {children}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[5],
    paddingTop: space[2],
    minHeight: 48,
  },
  title: { ...type.h2, color: color.text1, flex: 1 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
});

export const HOST_CALENDAR_CONFIG: CalendarConfig = {
  tokens: TOKENS,
  primitives: {
    Sheet: HostCalendarSheet,
    renderIcon: (name, iconColor, size) => <Icon name={ICONS[name]} color={iconColor} size={size} />,
  },
};
