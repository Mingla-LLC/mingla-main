import React from "react";
import { StyleSheet, Text } from "react-native";

import { glass, typography } from "../../constants/designSystem";
import { getInstalledAppVersionDisplay } from "../../services/appVersionIdentity";

interface AppVersionFooterProps {
  appName: string;
}

export function AppVersionFooter({
  appName,
}: AppVersionFooterProps): React.ReactElement | null {
  const display = getInstalledAppVersionDisplay(appName);
  if (display === null) return null;

  return (
    <Text
      accessible
      accessibilityLabel={display.accessibilityLabel}
      adjustsFontSizeToFit
      maxFontSizeMultiplier={1.4}
      minimumFontScale={0.85}
      numberOfLines={1}
      selectable
      style={styles.text}
      testID="installed-app-version"
    >
      {display.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.xs,
    color: glass.profile.text.settingsDescription.color,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 14,
    letterSpacing: 0.2,
  },
});
