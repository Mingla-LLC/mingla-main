/**
 * #4271 — shown while the reader gets ready (Apple 3.9.1, 5.7). Says plainly that
 * a tap can't be taken yet, with real progress when the SDK reports it.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { accent, radius as radiusTokens, spacing, text as textTokens, typography } from "../../../constants/designSystem";
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
  host: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  title: { ...typography.h3, color: textTokens.primary, textAlign: "center" },
  body: { ...typography.bodySm, color: textTokens.secondary, textAlign: "center" },
  barWrap: { alignSelf: "stretch", alignItems: "center", gap: spacing.xs },
  barTrack: {
    alignSelf: "stretch",
    height: 6,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
  },
  barFill: { height: 6, backgroundColor: accent.warm },
  percent: { ...typography.caption, color: textTokens.secondary },
});
