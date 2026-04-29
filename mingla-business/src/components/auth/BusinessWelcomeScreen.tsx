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
import { AppleLogo } from "../ui/BrandIcons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
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
const logo = require("../../../assets/mingla_official_logo.png");

const TERMS_URL = "https://mingla.app/terms";
const PRIVACY_URL = "https://mingla.app/privacy";

export interface BusinessWelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
  /** When set, shows a back control (e.g. return to landing). */
  onBack?: () => void;
}

const HEADLINE_WORDS = [
  "List",
  "experiences,",
  "reach",
  "guests,",
  "and",
  "grow",
  "\u2014",
  "simply.",
];

export default function BusinessWelcomeScreen({
  onGoogleSignIn,
  onAppleSignIn,
  onBack,
}: BusinessWelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] = useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  const isAnyAuthInProgress = isGoogleSignInInProgress || isAppleSignInInProgress;

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;

  const wordAnims = useRef(
    HEADLINE_WORDS.map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(18),
    }))
  ).current;

  const appleOpacity = useRef(new Animated.Value(0)).current;
  const appleTranslateY = useRef(new Animated.Value(25)).current;
  const googleOpacity = useRef(new Animated.Value(0)).current;
  const googleTranslateY = useRef(new Animated.Value(25)).current;
  const termsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const runAnimation = async () => {
      let reducedMotion = false;
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reducedMotion = false;
      }

      if (reducedMotion) {
        logoOpacity.setValue(1);
        logoScale.setValue(1);
        wordAnims.forEach((w) => {
          w.opacity.setValue(1);
          w.translateY.setValue(0);
        });
        appleOpacity.setValue(1);
        appleTranslateY.setValue(0);
        googleOpacity.setValue(1);
        googleTranslateY.setValue(0);
        termsOpacity.setValue(0.8);
        return;
      }

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
      ]).start();

      setTimeout(() => {
        Animated.stagger(
          70,
          wordAnims.map((w) =>
            Animated.parallel([
              Animated.timing(w.opacity, {
                toValue: 1,
                duration: 350,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.spring(w.translateY, {
                toValue: 0,
                tension: 100,
                friction: 12,
                useNativeDriver: true,
              }),
            ])
          )
        ).start();
      }, 400);

      setTimeout(() => {
        Animated.stagger(120, [
          ...(Platform.OS === "ios" || Platform.OS === "web"
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
          Animated.timing(termsOpacity, {
            toValue: 0.8,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      }, 1300);
    };

    runAnimation();
  }, []);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (onBack) {
        onBack();
        return true;
      }
      return true;
    });
    return () => backHandler.remove();
  }, [onBack]);

  const handleGoogleSignIn = async () => {
    if (isAnyAuthInProgress) return;

    HapticFeedback.buttonPress();
    setIsGoogleSignInInProgress(true);
    try {
      await onGoogleSignIn();
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (
        err?.message?.includes("cancelled") ||
        err?.message?.includes("canceled") ||
        err?.code === "ERR_REQUEST_CANCELED"
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
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (
        err?.message?.includes("cancelled") ||
        err?.message?.includes("canceled") ||
        err?.code === "ERR_REQUEST_CANCELED"
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
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

        {onBack ? (
          <View style={[styles.topBar, { paddingLeft: Math.max(insets.left, spacing.md) }]}>
            <TouchableOpacity
              onPress={() => {
                HapticFeedback.buttonPress();
                onBack();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Ionicons name="chevron-back" size={28} color={colors.text.primary} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.centerZone}>
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

          <Text style={styles.businessBadge}>Mingla Business</Text>

          <View
            style={styles.headlineRow}
            accessibilityLabel="List experiences, reach guests, and grow — simply."
            accessibilityRole="header"
          >
            {HEADLINE_WORDS.map((word, i) => (
              <Animated.Text
                key={i}
                style={[
                  styles.headlineWord,
                  i === HEADLINE_WORDS.length - 1 && styles.headlineAccent,
                  {
                    opacity: wordAnims[i].opacity,
                    transform: [{ translateY: wordAnims[i].translateY }],
                  },
                ]}
              >
                {word}{" "}
              </Animated.Text>
            ))}
          </View>
        </View>

        <View style={[styles.actionZone, { paddingBottom: Math.max(insets.bottom, vs(24)) }]}>
          {(Platform.OS === "ios" || Platform.OS === "web") && (
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
                  isAnyAuthInProgress && !isAppleSignInInProgress && styles.buttonDisabled,
                ]}
                disabled={isAnyAuthInProgress}
                activeOpacity={0.85}
                accessibilityLabel="Continue with Apple"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: isAnyAuthInProgress,
                  busy: isAppleSignInInProgress,
                }}
              >
                {isAppleSignInInProgress ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <AppleLogo size={22} color="#ffffff" />
                )}
                <Text style={styles.appleButtonText}>
                  {isAppleSignInInProgress ? "Connecting..." : "Continue with Apple"}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

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
                isAnyAuthInProgress && !isGoogleSignInInProgress && styles.buttonDisabled,
              ]}
              disabled={isAnyAuthInProgress}
              activeOpacity={0.9}
              accessibilityLabel="Continue with Google"
              accessibilityRole="button"
              accessibilityState={{
                disabled: isAnyAuthInProgress,
                busy: isGoogleSignInInProgress,
              }}
            >
              {isGoogleSignInInProgress ? (
                <ActivityIndicator size="small" color="#111827" />
              ) : (
                <Image source={googleIcon} style={styles.googleIcon} resizeMode="contain" />
              )}
              <Text style={styles.googleButtonText}>
                {isGoogleSignInInProgress ? "Connecting..." : "Continue with Google"}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.termsWrapper, { opacity: termsOpacity }]}>
            <Text style={styles.termsText}>
              By continuing, you agree to our{" "}
              <Text style={styles.termsLink} onPress={openTerms} accessibilityRole="link">
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text style={styles.termsLink} onPress={openPrivacy} accessibilityRole="link">
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
  topBar: {
    paddingTop: 4,
    paddingBottom: 4,
    minHeight: 44,
    justifyContent: "center",
  },
  centerZone: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: vs(48),
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: vs(12),
    flexShrink: 1,
  },
  logo: {
    width: s(180),
    maxWidth: "50%",
    aspectRatio: 1356 / 480,
  },
  businessBadge: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: colors.accent,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: vs(10),
  },
  headlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: s(320),
  },
  headlineWord: {
    fontSize: 22,
    lineHeight: 34,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    letterSpacing: 0.1,
  },
  headlineAccent: {
    fontWeight: fontWeights.bold,
    color: colors.primary[500],
  },
  actionZone: {
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: vs(14),
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
  termsWrapper: {
    marginTop: vs(8),
  },
  termsText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  termsLink: {
    color: colors.primary[700],
  },
});
