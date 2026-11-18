import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  color,
  radius,
  space,
  type,
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
    backgroundColor: color.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: space[4],
    padding: space[6],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  body: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
  },
});

export default NativeConnectWebOnlyFallback;
