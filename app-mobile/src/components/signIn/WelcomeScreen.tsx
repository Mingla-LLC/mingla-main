import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Alert,
  BackHandler,
  AccessibilityInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
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

const googleIcon = require("../../../assets/google_icon.png");
const logo = require("../../../assets/mobile_logo.png");

// Placeholder URLs — replace with actual URLs when provided by product
const TERMS_URL = "https://mingla.app/terms";
const PRIVACY_URL = "https://mingla.app/privacy";

interface WelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
}

export default function WelcomeScreen({
  onGoogleSignIn,
  onAppleSignIn,
}: WelcomeScreenProps) {
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] =
    useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  const isAnyAuthInProgress =
    isGoogleSignInInProgress || isAppleSignInInProgress;

  // Animated values for entrance animation
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(15)).current;
  const appleOpacity = useRef(new Animated.Value(0)).current;
  const appleTranslateY = useRef(new Animated.Value(25)).current;
  const googleOpacity = useRef(new Animated.Value(0)).current;
  const googleTranslateY = useRef(new Animated.Value(25)).current;
  const termsOpacity = useRef(new Animated.Value(0)).current;

  // Entrance animation on mount
  useEffect(() => {
    const runAnimation = async () => {
      let reducedMotion = false;
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reducedMotion = false;
      }

      if (reducedMotion) {
        // Skip all animations — set final values immediately
        logoOpacity.setValue(1);
        logoScale.setValue(1);
        taglineOpacity.setValue(1);
        taglineTranslateY.setValue(0);
        appleOpacity.setValue(1);
        appleTranslateY.setValue(0);
        googleOpacity.setValue(1);
        googleTranslateY.setValue(0);
        termsOpacity.setValue(0.8);
        return;
      }

      // Orchestrated entrance animation sequence (1.2s total)
      Animated.stagger(200, [
        // Logo: fade + scale simultaneously
        Animated.parallel([
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(logoScale, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),

        // Tagline: fade + slide up
        Animated.parallel([
          Animated.timing(taglineOpacity, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(taglineTranslateY, {
            toValue: 0,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),

        // Apple button (iOS only): fade + slide up with spring
        ...(Platform.OS === "ios"
          ? [
              Animated.parallel([
                Animated.timing(appleOpacity, {
                  toValue: 1,
                  duration: 400,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }),
                Animated.spring(appleTranslateY, {
                  toValue: 0,
                  tension: 80,
                  friction: 10,
                  useNativeDriver: true,
                }),
              ]),
            ]
          : []),

        // Google button: fade + slide up with spring
        Animated.parallel([
          Animated.timing(googleOpacity, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(googleTranslateY, {
            toValue: 0,
            tension: 80,
            friction: 10,
            useNativeDriver: true,
          }),
        ]),

        // Terms: gentle fade (to 0.8, not 1 — de-emphasize)
        Animated.timing(termsOpacity, {
          toValue: 0.8,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    };

    runAnimation();
  }, []);

  // Handle Android back button — stay on WelcomeScreen
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true
    );
    return () => backHandler.remove();
  }, []);

  const handleGoogleSignIn = async () => {
    if (isAnyAuthInProgress) return;

    HapticFeedback.buttonPress();
    setIsGoogleSignInInProgress(true);
    try {
      await onGoogleSignIn();
    } catch (error: any) {
      // Silent return for cancellation
      if (
        error?.message?.includes("cancelled") ||
        error?.message?.includes("canceled") ||
        error?.code === "ERR_REQUEST_CANCELED"
      ) {
        return;
      }
      Alert.alert(
        "Couldn't sign you in",
        "Something didn't connect. Give it another tap.",
        [{ text: "Got it" }]
      );
    } finally {
      setIsGoogleSignInInProgress(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (isAnyAuthInProgress) return;

    HapticFeedback.buttonPress();
    setIsAppleSignInInProgress(true);
    try {
      await onAppleSignIn();
    } catch (error: any) {
      // Silent return for cancellation
      if (
        error?.message?.includes("cancelled") ||
        error?.message?.includes("canceled") ||
        error?.code === "ERR_REQUEST_CANCELED"
      ) {
        return;
      }
      Alert.alert(
        "Couldn't sign you in",
        "Something didn't connect. Give it another tap.",
        [{ text: "Got it" }]
      );
    } finally {
      setIsAppleSignInInProgress(false);
    }
  };

  const openTerms = async () => {
    await WebBrowser.openBrowserAsync(TERMS_URL);
  };

  const openPrivacy = async () => {
    await WebBrowser.openBrowserAsync(PRIVACY_URL);
  };

  return (
    <LinearGradient
      colors={[colors.background.primary, backgroundWarmGlow]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar
          barStyle="dark-content"
          backgroundColor="transparent"
          translucent
        />

        {/* Brand Zone */}
        <View style={styles.brandZone}>
          <Animated.View
            style={[
              styles.logoContainer,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
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
          </Animated.View>

          <Animated.Text
            style={[
              styles.tagline,
              {
                opacity: taglineOpacity,
                transform: [{ translateY: taglineTranslateY }],
              },
            ]}
          >
            Dates, hangouts, and everything in between {"\u2014"} sorted.
          </Animated.Text>
        </View>

        {/* Action Zone */}
        <View style={styles.actionZone}>
          {/* Apple Sign-In Button — iOS only */}
          {Platform.OS === "ios" && (
            <Animated.View
              style={[
                styles.buttonAnimWrapper,
                {
                  opacity: appleOpacity,
                  transform: [{ translateY: appleTranslateY }],
                },
              ]}
            >
              <TouchableOpacity
                onPress={handleAppleSignIn}
                style={[
                  styles.appleButton,
                  isAnyAuthInProgress &&
                    !isAppleSignInInProgress &&
                    styles.buttonDisabled,
                ]}
                disabled={isAnyAuthInProgress}
                activeOpacity={0.85}
                accessibilityLabel="Continue with Apple"
                accessibilityRole="button"
                accessibilityHint="Signs you in or creates an account using your Apple ID"
                accessibilityState={{
                  disabled: isAnyAuthInProgress,
                  busy: isAppleSignInInProgress,
                }}
              >
                {isAppleSignInInProgress ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="logo-apple" size={22} color="#ffffff" />
                )}
                <Text style={styles.appleButtonText}>
                  {isAppleSignInInProgress
                    ? "Connecting..."
                    : "Continue with Apple"}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Google Sign-In Button */}
          <Animated.View
            style={[
              styles.buttonAnimWrapper,
              {
                opacity: googleOpacity,
                transform: [{ translateY: googleTranslateY }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              style={[
                styles.googleButton,
                isAnyAuthInProgress &&
                  !isGoogleSignInInProgress &&
                  styles.buttonDisabled,
              ]}
              disabled={isAnyAuthInProgress}
              activeOpacity={0.9}
              accessibilityLabel="Continue with Google"
              accessibilityRole="button"
              accessibilityHint="Signs you in or creates an account using your Google account"
              accessibilityState={{
                disabled: isAnyAuthInProgress,
                busy: isGoogleSignInInProgress,
              }}
            >
              {isGoogleSignInInProgress ? (
                <ActivityIndicator size="small" color="#111827" />
              ) : (
                <Image
                  source={googleIcon}
                  style={styles.googleIcon}
                  resizeMode="contain"
                />
              )}
              <Text style={styles.googleButtonText}>
                {isGoogleSignInInProgress
                  ? "Connecting..."
                  : "Continue with Google"}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Flex spacer */}
          <View style={styles.spacer} />

          {/* Terms & Privacy */}
          <Animated.View style={{ opacity: termsOpacity }}>
            <Text style={styles.termsText}>
              By continuing, you agree to our{" "}
              <Text
                style={styles.termsLink}
                onPress={openTerms}
                accessibilityLabel="Terms of Service"
                accessibilityRole="link"
                accessibilityHint="Opens Mingla's Terms of Service"
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                style={styles.termsLink}
                onPress={openPrivacy}
                accessibilityLabel="Privacy Policy"
                accessibilityRole="link"
                accessibilityHint="Opens Mingla's Privacy Policy"
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  brandZone: {
    flex: 1.2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  logoContainer: {
    alignItems: "center",
  },
  logo: {
    width: s(200),
    maxWidth: "60%",
  },
  tagline: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: "center",
    maxWidth: s(300),
    letterSpacing: 0.2,
    marginTop: spacing.md,
  },
  actionZone: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: vs(16),
  },
  buttonAnimWrapper: {
    width: "100%",
    alignItems: "center",
  },
  appleButton: {
    width: "100%",
    maxWidth: s(400),
    height: vs(56),
    backgroundColor: "#000000",
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    ...shadows.md,
  },
  appleButtonText: {
    color: colors.text.inverse,
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  googleButton: {
    width: "100%",
    maxWidth: s(400),
    height: vs(56),
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    ...shadows.sm,
  },
  googleButtonText: {
    color: colors.text.primary,
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  googleIcon: {
    width: 22,
    height: 22,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  spacer: {
    flex: 1,
  },
  termsText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  termsLink: {
    color: colors.primary[700],
  },
});
