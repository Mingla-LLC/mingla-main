import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticFeedback } from "../../utils/hapticFeedback";
import {
  spacing,
  radius,
  shadows,
  colors,
  fontWeights,
  backgroundWarmGlow,
} from "../../constants/designSystem";
import { s, vs } from "../../utils/responsive";

const logo = require("../../../assets/mingla_official_logo.png");

interface BusinessLandingScreenProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export default function BusinessLandingScreen({ onGetStarted, onSignIn }: BusinessLandingScreenProps) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let reduced = false;
      try {
        reduced = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reduced = false;
      }
      if (cancelled) return;
      if (reduced) {
        fade.setValue(1);
        slide.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    })();
    return () => {
      cancelled = true;
    };
  }, [fade, slide]);

  return (
    <LinearGradient
      colors={[colors.background.primary, backgroundWarmGlow]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

        <Animated.View
          style={[
            styles.content,
            {
              opacity: fade,
              transform: [{ translateY: slide }],
            },
          ]}
        >
          <Image
            source={logo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Mingla logo"
            accessibilityRole="image"
          />

          <Text style={styles.kicker}>For experience creators</Text>
          <Text style={styles.title}>Mingla Business</Text>
          <Text style={styles.subtitle}>
            List experiences, reach the right guests, and manage your presence — all in one place.
          </Text>
        </Animated.View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, vs(20)) }]}>
          <TouchableOpacity
            style={styles.primaryCta}
            onPress={() => {
              HapticFeedback.buttonPress();
              onGetStarted();
            }}
            activeOpacity={0.9}
            accessibilityLabel="Get started"
            accessibilityRole="button"
          >
            <Text style={styles.primaryCtaText}>Get started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={() => {
              HapticFeedback.buttonPress();
              onSignIn();
            }}
            activeOpacity={0.7}
            accessibilityLabel="I already have an account"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryCtaText}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: s(200),
    maxWidth: "70%",
    aspectRatio: 1356 / 480,
    marginBottom: vs(28),
  },
  kicker: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: colors.accent,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: vs(8),
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: "center",
    marginBottom: vs(12),
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: "center",
    maxWidth: s(340),
  },
  footer: {
    paddingHorizontal: spacing.lg,
    gap: vs(12),
  },
  primaryCta: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: vs(16),
    alignItems: "center",
    justifyContent: "center",
    minHeight: vs(56),
    ...shadows.md,
  },
  primaryCtaText: {
    color: colors.text.inverse,
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  secondaryCta: {
    paddingVertical: vs(14),
    alignItems: "center",
  },
  secondaryCtaText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.primary[700],
  },
});
