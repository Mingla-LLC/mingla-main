/**
 * #4271 — shown while the reader gets ready (Apple 3.9.1, 5.7). Says plainly that
 * a tap can't be taken yet, with real progress when the SDK reports it.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../../constants/designSystem";
import { TAP_CONFIGURING_BODY, tapConfiguringTitle } from "../../../constants/tapToPayCopy";
import { Spinner } from "../../ui/Spinner";

export interface TapConfiguringViewProps {
  /** 0 to 1 when the SDK reports it, else null. */
  progress: number | null;
}

export const TapConfiguringView = ({ progress }: TapConfiguringViewProps): React.ReactElement => {
  const percent = progress === null ? null : Math.round(progress * 100);
  return (
    <View style={styles.host} testID="tap-configuring">
      <Text style={styles.title} accessibilityRole="header">
        {tapConfiguringTitle(Platform.OS)}
      </Text>
      <Text style={styles.body}>{TAP_CONFIGURING_BODY}</Text>
      {percent === null ? (
        <Spinner size={36} />
      ) : (
        <View
          style={styles.barWrap}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          testID="tap-configuring-bar"
        >
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.percent}>{`${percent}%`}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], paddingHorizontal: space[6] },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  body: { ...type.small, color: color.text2, textAlign: "center" },
  barWrap: { alignSelf: "stretch", alignItems: "center", gap: space[1] },
  barTrack: {
    alignSelf: "stretch",
    height: 6,
    borderRadius: radiusTokens.lg,
    backgroundColor: color.fill.step,
    overflow: "hidden",
  },
  barFill: { height: 6, backgroundColor: color.accent },
  percent: { ...type.caption, color: color.text2 },
});
