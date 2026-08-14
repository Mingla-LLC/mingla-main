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
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { AppleLogo } from "../ui/BrandIcons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { HapticFeedback } from "../../utils/hapticFeedback";
import {
  spacing,
  radius,
  shadows,
  colors,
  fontWeights,
} from "../../constants/designSystem";
import { s, vs } from "../../utils/responsive";
import { useTranslation } from "react-i18next";
// ISSUE-1001 — wordmark from the canonical master package (same bytes as the
// deleted app-local mingla_official_logo.png copy).
import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import { WelcomeVideoBackground } from "./WelcomeVideoBackground";

const googleIcon = require("../../../assets/google_icon.png");
const logo = MINGLA_WORDMARK;

import { LEGAL_URLS } from "../../constants/urls";

interface WelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
}

const WELCOME_TAGLINE = "Places, plans, and experiences\nworth showing up for";
const WELCOME_TAGLINE_ACCESSIBILITY =
  "Places, plans, and experiences worth showing up for";
const WELCOME_VIDEO_VEIL = "rgba(255,255,255,0.64)";
const WELCOME_CONTENT_GUTTER = 24;
const WELCOME_NATIVE_LOGO_CAP = 320;

export default function WelcomeScreen({
  onGoogleSignIn,
  onAppleSignIn,
}: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useTranslation(['auth', 'common']);
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] =
    useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  const isAnyAuthInProgress =
    isGoogleSignInInProgress || isAppleSignInInProgress;

  // Animated values for entrance animation
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.96)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(12)).current;

  const appleOpacity = useRef(new Animated.Value(0)).current;
  const appleTranslateY = useRef(new Animated.Value(25)).current;
  const googleOpacity = useRef(new Animated.Value(0)).current;
  const googleTranslateY = useRef(new Animated.Value(25)).current;
  const termsOpacity = useRef(new Animated.Value(0)).current;

  // Entrance animation on mount
  useEffect(() => {
    let mounted = true;
    let entrance: Animated.CompositeAnimation | undefined;
    const runAnimation = async () => {
      let reducedMotion = false;
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reducedMotion = false;
      }
      if (!mounted) return;

      if (reducedMotion) {
        logoOpacity.setValue(1);
        logoScale.setValue(1);
        taglineOpacity.setValue(1);
        taglineTranslateY.setValue(0);
        appleOpacity.setValue(1);
        appleTranslateY.setValue(0);
        googleOpacity.setValue(1);
        googleTranslateY.setValue(0);
        termsOpacity.setValue(1);
        return;
      }

      const animations = [
        Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        ]),
        Animated.sequence([
          Animated.delay(160),
          Animated.parallel([
            Animated.timing(taglineOpacity, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(taglineTranslateY, {
              toValue: 0,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(300),
          Animated.stagger(80, [
          ...(Platform.OS === "ios"
            ? [
                Animated.parallel([
                  Animated.timing(appleOpacity, {
                    toValue: 1,
                    duration: 300,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                  }),
                  Animated.timing(appleTranslateY, {
                    toValue: 0,
                    duration: 300,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                  }),
                ]),
              ]
            : []),
          Animated.parallel([
            Animated.timing(googleOpacity, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(googleTranslateY, {
              toValue: 0,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(termsOpacity, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          ]),
        ]),
      ];
      entrance = Animated.parallel(animations);
      entrance.start();
    };

    void runAnimation();
    return () => {
      mounted = false;
      entrance?.stop();
    };
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
        t('auth:welcome.sign_in_failed_title'),
        t('auth:welcome.sign_in_failed_body'),
        [{ text: t('auth:welcome.sign_in_failed_ok') }]
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
        t('auth:welcome.sign_in_failed_title'),
        t('auth:welcome.sign_in_failed_body'),
        [{ text: t('auth:welcome.sign_in_failed_ok') }]
      );
    } finally {
      setIsAppleSignInInProgress(false);
    }
  };

  const openTerms = async () => {
    await WebBrowser.openBrowserAsync(LEGAL_URLS.termsOfService);
  };

  const openPrivacy = async () => {
    await WebBrowser.openBrowserAsync(LEGAL_URLS.privacyPolicy);
  };

  const logoWidth = Math.min(width - WELCOME_CONTENT_GUTTER * 2, WELCOME_NATIVE_LOGO_CAP);

  return (
    <View style={styles.root}>
      <WelcomeVideoBackground />
      <View pointerEvents="none" style={styles.videoVeil} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar
          barStyle="dark-content"
          backgroundColor="transparent"
          translucent
        />

        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.idleContent,
            { paddingBottom: Math.max(insets.bottom, WELCOME_CONTENT_GUTTER) },
          ]}
        >
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
              style={[styles.logo, { width: logoWidth, height: logoWidth * 480 / 1356 }]}
              resizeMode="contain"
              accessibilityLabel="Mingla"
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
            accessibilityLabel={WELCOME_TAGLINE_ACCESSIBILITY}
            accessibilityRole="header"
          >
            {WELCOME_TAGLINE}
          </Animated.Text>

        <View style={styles.authGroup}>
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
                accessibilityLabel={t('auth:welcome.continue_with_apple')}
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
                  <AppleLogo size={22} color="#ffffff" />
                )}
                <Text style={styles.appleButtonText}>
                  {isAppleSignInInProgress
                    ? t('auth:welcome.connecting')
                    : t('auth:welcome.continue_with_apple')}
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
              accessibilityLabel={t('auth:welcome.continue_with_google')}
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
                  ? t('auth:welcome.connecting')
                  : t('auth:welcome.continue_with_google')}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Terms & Privacy */}
          <Animated.View style={[styles.termsWrapper, { opacity: termsOpacity }]}>
            <Text style={styles.termsText}>
              {t('auth:welcome.terms_prefix')}
              <Text
                style={styles.termsLink}
                onPress={openTerms}
                accessibilityLabel={t('auth:welcome.terms_of_service')}
                accessibilityRole="link"
              >
                {t('auth:welcome.terms_of_service')}
              </Text>
              {t('auth:welcome.terms_and')}
              <Text
                style={styles.termsLink}
                onPress={openPrivacy}
                accessibilityLabel={t('auth:welcome.privacy_policy')}
                accessibilityRole="link"
              >
                {t('auth:welcome.privacy_policy')}
              </Text>
              {t('auth:welcome.terms_suffix')}
            </Text>
          </Animated.View>
        </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  videoVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: WELCOME_VIDEO_VEIL,
  },
  container: {
    flex: 1,
  },
  idleContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: WELCOME_CONTENT_GUTTER,
    paddingTop: WELCOME_CONTENT_GUTTER,
    gap: WELCOME_CONTENT_GUTTER,
  },
  logoContainer: {
    alignItems: "center",
    flexShrink: 1,
  },
  logo: {
    aspectRatio: 1356 / 480,
  },
  tagline: {
    width: "100%",
    maxWidth: 342,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: fontWeights.bold,
    color: "#111827",
    letterSpacing: 0,
    textAlign: "center",
  },
  authGroup: {
    width: "100%",
    maxWidth: 400,
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
    color: colors.text.primary,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  termsLink: {
    color: colors.text.primary,
    fontWeight: fontWeights.semibold,
    textDecorationLine: "underline",
  },
});
