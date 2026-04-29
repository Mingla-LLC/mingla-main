/**
 * StatusBar — wraps `expo-status-bar` for native; renders a simulated iOS
 * status row on web for prototype-style screens.
 *
 * Three exports:
 * - `<NativeStatusBar />` — always renders, native pass-through. Sensible
 *   defaults (`style="light"`) for our dark canvas.
 * - `<WebStatusBar />` — opt-in, renders only on web; static row with
 *   time on the left and signal/wifi/battery icons on the right.
 * - `<StatusBar />` (default) — switches by `Platform.OS`.
 */

import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import type { StatusBarStyle } from "expo-status-bar";

import { spacing, text as textTokens, typography } from "../../constants/designSystem";

import { Icon } from "./Icon";

export interface NativeStatusBarProps {
  /** Bar foreground style. Defaults to `"light"` to suit the dark Mingla Business canvas. */
  barStyle?: StatusBarStyle;
  translucent?: boolean;
}

export const NativeStatusBar: React.FC<NativeStatusBarProps> = ({
  barStyle = "light",
  translucent = true,
}) => <ExpoStatusBar style={barStyle} translucent={translucent} />;

const formatTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const display = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${display}:${minutes.toString().padStart(2, "0")}`;
};

export interface WebStatusBarProps {
  /** Override the displayed time (defaults to local clock). */
  time?: string;
  textColor?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const WebStatusBar: React.FC<WebStatusBarProps> = ({
  time,
  textColor = textTokens.primary,
  testID,
  style,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (time !== undefined) {
      return;
    }
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return (): void => clearInterval(interval);
  }, [time]);

  const display = time ?? formatTime(now);

  return (
    <View testID={testID} style={[styles.row, style]}>
      <Text style={[styles.time, { color: textColor }]}>{display}</Text>
      <View style={styles.iconCluster}>
        <Icon name="chart" size={14} color={textColor} />
        <Icon name="globe" size={14} color={textColor} />
        <Icon name="flashOn" size={14} color={textColor} />
      </View>
    </View>
  );
};

export interface StatusBarProps extends NativeStatusBarProps, WebStatusBarProps {}

const StatusBar: React.FC<StatusBarProps> = (props) => {
  if (Platform.OS === "web") {
    return <WebStatusBar {...props} />;
  }
  return <NativeStatusBar barStyle={props.barStyle} translucent={props.translucent} />;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  time: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: typography.bodySm.fontWeight,
    letterSpacing: 0.2,
  },
  iconCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});

export { StatusBar };
export default StatusBar;
