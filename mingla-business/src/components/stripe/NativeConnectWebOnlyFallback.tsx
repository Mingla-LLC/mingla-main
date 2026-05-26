import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { SafeScreen } from "../ui/SafeScreen";

export interface NativeConnectWebOnlyFallbackProps {
  title: string;
  body: string;
}

export const NativeConnectWebOnlyFallback: React.FC<
  NativeConnectWebOnlyFallbackProps
> = ({ title, body }) => {
  const router = useRouter();

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Button
          label="Back to Mingla"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/account" as never);
          }}
          variant="primary"
        />
      </View>
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: canvas.discover,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
});

export default NativeConnectWebOnlyFallback;
