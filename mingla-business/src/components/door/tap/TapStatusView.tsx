/**
 * #4271 — full-screen status layout shared by the Tap to Pay screens
 * (design T1 "not on this phone", T3 failures, H4 paid). Ring + title + body +
 * up to two actions, vertically centred, in the Business app's dark tokens.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";

export type TapStatusTone = "ok" | "bad";

export interface TapStatusAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export interface TapStatusViewProps {
  tone: TapStatusTone;
  icon: IconName;
  title: string;
  body?: string | null;
  children?: React.ReactNode;
  primary?: TapStatusAction | null;
  secondary?: TapStatusAction | null;
  /** Secondary rendered as a quiet ghost button (H4 "Done"). */
  secondaryGhost?: boolean;
  testID?: string;
}

export const TapStatusView = ({
  tone,
  icon,
  title,
  body,
  children,
  primary,
  secondary,
  secondaryGhost = false,
  testID,
}: TapStatusViewProps): React.ReactElement => (
  <View style={styles.host} testID={testID}>
    <View style={[styles.ring, tone === "ok" ? styles.ringOk : styles.ringBad]}>
      <Icon
        name={icon}
        size={tone === "ok" ? 30 : 28}
        color={tone === "ok" ? semantic.success : semantic.errorText}
      />
    </View>
    <Text style={tone === "ok" ? styles.titleBig : styles.title} accessibilityRole="header">
      {title}
    </Text>
    {body ? <Text style={styles.body}>{body}</Text> : null}
    {children}
    <View style={styles.actions}>
      {primary ? (
        <Button
          label={primary.label}
          onPress={primary.onPress}
          loading={primary.loading}
          disabled={primary.disabled}
          variant="primary"
          size="lg"
          fullWidth
          testID={primary.testID}
        />
      ) : null}
      {secondary ? (
        <Button
          label={secondary.label}
          onPress={secondary.onPress}
          loading={secondary.loading}
          disabled={secondary.disabled}
          variant={secondaryGhost ? "ghost" : "secondary"}
          size="lg"
          fullWidth
          testID={secondary.testID}
        />
      ) : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  ringOk: { backgroundColor: semantic.successTint },
  ringBad: { backgroundColor: "rgba(239, 68, 68, 0.16)" },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  titleBig: {
    ...typography.display,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
