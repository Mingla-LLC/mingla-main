/**
 * +not-found — Cycle 16a J-X4 (DEC-098 D-16-7).
 *
 * Mingla-branded 404 / unknown-route screen. Replaces Expo Router's
 * generic crash UI with a friendly + on-brand "Go home" path.
 *
 * Cross-platform: same component renders on native deep-link (e.g.
 * `mingla-business://garbage`) + web direct URL (e.g.
 * `business.mingla.com/garbage`). No platform branching.
 *
 * Per Cycle 16a SPEC §3.2.1.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../src/components/ui/Button";
import {
  backgroundWarmGlow,
  colors,
  fontWeights,
  spacing,
} from "../src/constants/designSystem";
import { HapticFeedback } from "../src/utils/hapticFeedback";

const logo = require("../assets/mingla_official_logo.png");

export default function NotFoundScreen(): React.ReactElement {
  const router = useRouter();

  const handleGoHome = (): void => {
    HapticFeedback.buttonPress();
    // router.replace (NOT push) — back button can't return to the 404.
    // Index gate routes per signed-in/signed-out state.
    router.replace("/" as never);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: "Not found" }} />
      <LinearGradient
        colors={[colors.background.primary, backgroundWarmGlow]}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
          <View style={styles.content}>
            <Image
              source={logo}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Mingla logo"
              accessibilityRole="image"
            />
            <Text style={styles.heading} accessibilityRole="header">
              Hmm, that&apos;s not a real page.
            </Text>
            <Text style={styles.subtext}>Maybe a typo? Or it moved?</Text>
            <View style={styles.cta}>
              <Button
                label="Go home"
                onPress={handleGoHome}
                variant="primary"
                size="md"
                accessibilityLabel="Go home"
              />
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  logo: {
    width: 140,
    aspectRatio: 1356 / 480,
    marginBottom: spacing.lg,
  },
  heading: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: "center",
  },
  subtext: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  cta: {
    width: "100%",
    maxWidth: 320,
  },
});
