import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Keyboard,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { AppleLogo } from "../ui/BrandIcons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { Icon } from "../ui/Icon";
import {
  spacing,
  radius,
  shadows,
  colors,
  fontWeights,
} from "../../constants/designSystem";
import { s, vs } from "../../utils/responsive";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import { ScrollView } from "../../wrappers/SmartScrollView";
// @ts-ignore -- Expo resolves the required .native/.web implementation per platform.
import { WelcomeVideoBackground } from "./WelcomeVideoBackground";

const googleIcon = require("../../../assets/google_icon.png");
const logo = MINGLA_WORDMARK;

const TERMS_URL = "https://usemingla.com/terms-of-service";
const PRIVACY_URL = "https://usemingla.com/privacy-policy";
const WELCOME_TAGLINE = "Great places and experiences\ndeserve to be discovered.";
const WELCOME_TAGLINE_ACCESSIBILITY =
  "Great places and experiences deserve to be discovered.";
const WELCOME_VIDEO_VEIL = "rgba(0, 0, 0, 0.74)";
const WELCOME_CONTENT_GUTTER = 24;
const WELCOME_LOGO_PILL_WIDTH = 140;
const WELCOME_LOGO_PILL_HEIGHT = 54;
const WELCOME_WORDMARK_WIDTH = 108;
const WELCOME_DESKTOP_PILL_SCALE = 1.2;
const WELCOME_DESKTOP_BREAKPOINT = 768;
const WEB_LOGO_SRC = "/brand/mingla-wordmark.png";

export interface BusinessWelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
  /**
   * Cycle 15 — additive email + 6-digit OTP sign-in (DEC-097).
   * Step 1: send code to email. Caller transitions to OTP-input mode on success.
   */
  onEmailSignIn: (email: string) => Promise<{ error: Error | null }>;
  /**
   * Cycle 15 — Step 2: verify 6-digit code. On success, AuthContext SIGNED_IN
   * listener handles redirect via index gate (preserves I-35 recovery).
   */
  onVerifyEmailOtp: (
    email: string,
    code: string,
  ) => Promise<{ error: Error | null }>;
  /** When set, shows a back control (e.g. return to landing). */
  onBack?: () => void;
}

/**
 * Cycle 15 — internal state machine (DEC-097 D-15-6 — extends Welcome rather
 * than separate /login route to match Cycle 14 4-step delete-flow precedent
 * and avoid feedback_rn_sub_sheet_must_render_inside_parent rule).
 */
type WelcomeMode = "idle" | "email-input" | "otp-input" | "otp-verifying";

const RESEND_COOLDOWN_MS = 60_000;

export default function BusinessWelcomeScreen({
  onGoogleSignIn,
  onAppleSignIn,
  onEmailSignIn,
  onVerifyEmailOtp,
  onBack,
}: BusinessWelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] = useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  // Cycle 15 — email + 6-digit OTP state machine (DEC-097).
  const [mode, setMode] = useState<WelcomeMode>("idle");
  const [emailInput, setEmailInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [resendCooldownEnd, setResendCooldownEnd] = useState<number | null>(
    null,
  );
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  // Memory rule feedback_keyboard_never_blocks_input — dynamic bottom padding
  // when soft keyboard is up so TextInput stays visible above it on native.
  const [keyboardPad, setKeyboardPad] = useState(0);

  const isAnyAuthInProgress =
    isGoogleSignInInProgress || isAppleSignInInProgress;

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.96)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(12)).current;

  const appleOpacity = useRef(new Animated.Value(0)).current;
  const appleTranslateY = useRef(new Animated.Value(25)).current;
  const googleOpacity = useRef(new Animated.Value(0)).current;
  const googleTranslateY = useRef(new Animated.Value(25)).current;
  // Cycle 15 — email button entrance animation (DEC-097 idle mode 3rd CTA).
  const emailOpacity = useRef(new Animated.Value(0)).current;
  const emailTranslateY = useRef(new Animated.Value(25)).current;
  const termsOpacity = useRef(new Animated.Value(0)).current;

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
        emailOpacity.setValue(1);
        emailTranslateY.setValue(0);
        termsOpacity.setValue(1);
        return;
      }

      entrance = Animated.parallel([
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
          ...(Platform.OS === "ios" || Platform.OS === "web"
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
          Animated.parallel([
            Animated.timing(emailOpacity, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(emailTranslateY, {
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
      ]);
      entrance.start();
    };

    void runAnimation();
    return () => {
      mounted = false;
      entrance?.stop();
    };
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

  // Email/OTP inputs remain bottom-anchored rather than moving into the idle
  // SmartScrollView. JS-side keyboardPad preserves that existing mode layout.
  useEffect(() => {
    if (Platform.OS === "web") return;
    // orch-strict-grep-allow orch-0892 — anchored sign-in (no ScrollView)
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardPad(e.endCoordinates.height);
    });
    // orch-strict-grep-allow orch-0892 — anchored sign-in (no ScrollView)
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardPad(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Cycle 15 — resend OTP cooldown countdown (60s per DEC-097 D-15-8 +
  // SPEC §3.5.4). Tick every 500ms for smooth display.
  useEffect(() => {
    if (resendCooldownEnd === null) {
      setResendSecondsLeft(0);
      return;
    }
    const tick = (): void => {
      const remaining = Math.max(
        0,
        Math.ceil((resendCooldownEnd - Date.now()) / 1000),
      );
      setResendSecondsLeft(remaining);
      if (remaining === 0) {
        setResendCooldownEnd(null);
      }
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [resendCooldownEnd]);

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

  // Cycle 15 — email + OTP handlers (DEC-097).
  const handleStartEmailFlow = useCallback((): void => {
    HapticFeedback.buttonPress();
    setMode("email-input");
    setEmailInput("");
    setOtpInput("");
  }, []);

  const handleSendCode = useCallback(async (): Promise<void> => {
    if (submittingEmail || !emailInput.trim()) return;
    HapticFeedback.buttonPress();
    setSubmittingEmail(true);
    try {
      const { error } = await onEmailSignIn(emailInput);
      if (error) {
        Alert.alert("Couldn't send code", error.message, [{ text: "Got it" }]);
        return;
      }
      setMode("otp-input");
      setOtpInput("");
      setResendCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    } finally {
      setSubmittingEmail(false);
    }
  }, [submittingEmail, emailInput, onEmailSignIn]);

  const handleVerifyCode = useCallback(
    async (code: string): Promise<void> => {
      if (submittingOtp) return;
      HapticFeedback.buttonPress();
      setSubmittingOtp(true);
      setMode("otp-verifying");
      try {
        const { error } = await onVerifyEmailOtp(emailInput, code);
        if (error) {
          Alert.alert("Couldn't sign in", error.message, [{ text: "Got it" }]);
          setMode("otp-input");
          setOtpInput("");
          return;
        }
        // Success — AuthContext SIGNED_IN listener handles ensureCreatorAccount
        // + tryRecoverAccountIfDeleted (I-35 gate) + setUser. Index gate
        // redirects to /(tabs)/home automatically.
      } finally {
        setSubmittingOtp(false);
      }
    },
    [submittingOtp, emailInput, onVerifyEmailOtp],
  );

  const handleOtpChange = useCallback(
    (value: string): void => {
      // Digits only, max 6.
      const sanitized = value.replace(/\D/g, "").slice(0, 6);
      setOtpInput(sanitized);
      // Auto-submit on 6th digit.
      if (sanitized.length === 6 && !submittingOtp) {
        void handleVerifyCode(sanitized);
      }
    },
    [submittingOtp, handleVerifyCode],
  );

  const handleResendCode = useCallback(async (): Promise<void> => {
    if (submittingEmail || resendSecondsLeft > 0) return;
    HapticFeedback.buttonPress();
    setSubmittingEmail(true);
    try {
      const { error } = await onEmailSignIn(emailInput);
      if (error) {
        Alert.alert("Couldn't resend code", error.message, [
          { text: "Got it" },
        ]);
        return;
      }
      setResendCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    } finally {
      setSubmittingEmail(false);
    }
  }, [submittingEmail, resendSecondsLeft, emailInput, onEmailSignIn]);

  const handleEditEmail = useCallback((): void => {
    HapticFeedback.buttonPress();
    setMode("email-input");
    setOtpInput("");
  }, []);

  const handleBackToIdle = useCallback((): void => {
    HapticFeedback.buttonPress();
    Keyboard.dismiss();
    setMode("idle");
    setEmailInput("");
    setOtpInput("");
    setResendCooldownEnd(null);
  }, []);

  const openTerms = async () => {
    await WebBrowser.openBrowserAsync(TERMS_URL);
  };

  const openPrivacy = async () => {
    await WebBrowser.openBrowserAsync(PRIVACY_URL);
  };

  const desktop = Platform.OS === "web" && width >= WELCOME_DESKTOP_BREAKPOINT;
  const logoPillScale = desktop ? WELCOME_DESKTOP_PILL_SCALE : 1;
  const logoPillWidth = Math.min(
    width - WELCOME_CONTENT_GUTTER * 2,
    WELCOME_LOGO_PILL_WIDTH * logoPillScale,
  );
  const logoPillHeight =
    (logoPillWidth * WELCOME_LOGO_PILL_HEIGHT) / WELCOME_LOGO_PILL_WIDTH;
  const logoWidth =
    (logoPillWidth * WELCOME_WORDMARK_WIDTH) / WELCOME_LOGO_PILL_WIDTH;
  const logoHeight = logoWidth * 480 / 1356;
  const renderLogo = () => (
    <Animated.View
      style={[
        styles.logoContainer,
        { width: logoPillWidth, height: logoPillHeight },
        { opacity: logoOpacity, transform: [{ scale: logoScale }] },
      ]}
    >
      {Platform.OS === "web" ? (
        React.createElement("img", {
          src: WEB_LOGO_SRC,
          alt: "Mingla",
          role: "img",
          style: {
            width: logoWidth,
            height: logoHeight,
            objectFit: "contain",
            display: "block",
            opacity: 1,
          },
        })
      ) : (
        <Image
          source={logo}
          style={[styles.logo, { width: logoWidth, height: logoHeight }]}
          resizeMode="contain"
          accessibilityLabel="Mingla"
          accessibilityRole="image"
        />
      )}
    </Animated.View>
  );

  const renderIdleAuthGroup = () => (
    <View style={styles.authGroup}>
      {(Platform.OS === "ios" || Platform.OS === "web") && (
        <Animated.View
          style={[
            styles.buttonAnimWrapper,
            { opacity: appleOpacity, transform: [{ translateY: appleTranslateY }] },
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
              <ActivityIndicator size="small" color="#111827" />
            ) : (
              <AppleLogo size={22} color="#111827" />
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
          { opacity: googleOpacity, transform: [{ translateY: googleTranslateY }] },
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

      <Animated.View
        style={[
          styles.buttonAnimWrapper,
          { opacity: emailOpacity, transform: [{ translateY: emailTranslateY }] },
        ]}
      >
        <TouchableOpacity
          onPress={handleStartEmailFlow}
          style={[styles.emailButton, isAnyAuthInProgress && styles.buttonDisabled]}
          disabled={isAnyAuthInProgress}
          activeOpacity={0.9}
          accessibilityLabel="Continue with Email"
          accessibilityRole="button"
        >
          <Icon name="mail" size={22} color={colors.text.primary} />
          <Text style={styles.emailButtonText}>Continue with Email</Text>
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
  );

  const renderModeActions = () => (
    <View
      style={[
        styles.actionZone,
        {
          paddingBottom:
            Math.max(insets.bottom, vs(24)) +
            (keyboardPad > 0 ? keyboardPad + 42 : 0),
        },
      ]}
    >
      {mode === "email-input" && (
        <View style={styles.modeWrapper}>
          <TextInput
            style={styles.emailField}
            value={emailInput}
            onChangeText={setEmailInput}
            placeholder="you@example.com"
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={() => void handleSendCode()}
            editable={!submittingEmail}
            autoFocus
            accessibilityLabel="Email address"
          />
          <TouchableOpacity
            onPress={() => void handleSendCode()}
            style={[
              styles.primaryActionButton,
              (submittingEmail || !emailInput.trim()) && styles.buttonDisabled,
            ]}
            disabled={submittingEmail || !emailInput.trim()}
            activeOpacity={0.9}
            accessibilityLabel="Send 6-digit code"
            accessibilityRole="button"
            accessibilityState={{
              disabled: submittingEmail || !emailInput.trim(),
              busy: submittingEmail,
            }}
          >
            {submittingEmail ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryActionButtonText}>Send code</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBackToIdle}
            style={styles.linkButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Back to sign-in options"
            accessibilityRole="button"
          >
            <Text style={styles.linkButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === "otp-input" && (
        <View style={styles.modeWrapper}>
          <TextInput
            style={styles.codeField}
            value={otpInput}
            onChangeText={handleOtpChange}
            placeholder="••••••"
            placeholderTextColor={colors.text.tertiary}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            editable={!submittingOtp}
            autoFocus
            accessibilityLabel="6-digit code"
          />
          <TouchableOpacity
            onPress={() => void handleResendCode()}
            style={styles.linkButton}
            disabled={submittingEmail || resendSecondsLeft > 0}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel={
              resendSecondsLeft > 0
                ? `Resend code in ${resendSecondsLeft} seconds`
                : "Resend code"
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: submittingEmail || resendSecondsLeft > 0 }}
          >
            <Text
              style={[
                styles.linkButtonText,
                (submittingEmail || resendSecondsLeft > 0) && styles.linkButtonTextDisabled,
              ]}
            >
              {resendSecondsLeft > 0
                ? `Resend code in ${resendSecondsLeft}s`
                : "Resend code"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleEditEmail}
            style={styles.linkButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Wrong email? Edit"
            accessibilityRole="button"
          >
            <Text style={styles.linkButtonTextSubtle}>Wrong email? Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBackToIdle}
            style={styles.linkButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Back to sign-in options"
            accessibilityRole="button"
          >
            <Text style={styles.linkButtonTextSubtle}>Back to sign-in options</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === "otp-verifying" && (
        <View style={styles.verifyingWrapper}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <WelcomeVideoBackground />
      <View pointerEvents="none" style={styles.videoVeil} />
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

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
              <Icon name="chevL" size={28} color="#ffffff" />
            </TouchableOpacity>
          </View>
        ) : null}

        {mode === "idle" ? (
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.idleContent,
              { paddingBottom: Math.max(insets.bottom, WELCOME_CONTENT_GUTTER) },
            ]}
          >
            {renderLogo()}
            <Animated.Text
              style={[
                styles.tagline,
                desktop && styles.taglineDesktop,
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
            {renderIdleAuthGroup()}
          </ScrollView>
        ) : (
          <>
        <View style={styles.centerZone}>
          {renderLogo()}

          {mode === "email-input" && (
            <Text style={styles.modeHeading} accessibilityRole="header">
              What&apos;s your email?
            </Text>
          )}

          {mode === "otp-input" && (
            <>
              <Text style={styles.modeHeading} accessibilityRole="header">
                Check your inbox
              </Text>
              <Text style={styles.modeSubtext}>
                We sent a 6-digit code to{" "}
                <Text style={styles.modeSubtextEmail}>{emailInput}</Text>
              </Text>
            </>
          )}

          {mode === "otp-verifying" && (
            <Text style={styles.modeHeading} accessibilityRole="header">
              Signing you in…
            </Text>
          )}
        </View>

        <View
          style={[
            styles.actionZone,
            {
              // ORCH-1165: +42pt (KEYBOARD_TOOLBAR_HEIGHT) only with the
              // keyboard open, so the Done bar never covers the action zone.
              paddingBottom:
                Math.max(insets.bottom, vs(24)) +
                (keyboardPad > 0 ? keyboardPad + 42 : 0),
            },
          ]}
        >
          {/* Cycle 15 — email input mode (DEC-097 + SPEC §3.5.4). */}
          {mode === "email-input" && (
            <View style={styles.modeWrapper}>
              <TextInput
                style={styles.emailField}
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="you@example.com"
                placeholderTextColor={colors.text.tertiary}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={() => void handleSendCode()}
                editable={!submittingEmail}
                autoFocus
                accessibilityLabel="Email address"
              />
              <TouchableOpacity
                onPress={() => void handleSendCode()}
                style={[
                  styles.primaryActionButton,
                  (submittingEmail || !emailInput.trim()) &&
                    styles.buttonDisabled,
                ]}
                disabled={submittingEmail || !emailInput.trim()}
                activeOpacity={0.9}
                accessibilityLabel="Send 6-digit code"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: submittingEmail || !emailInput.trim(),
                  busy: submittingEmail,
                }}
              >
                {submittingEmail ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryActionButtonText}>Send code</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBackToIdle}
                style={styles.linkButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Back to sign-in options"
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cycle 15 — OTP input mode (DEC-097 D-15-2 + SPEC §3.5.4). */}
          {mode === "otp-input" && (
            <View style={styles.modeWrapper}>
              <TextInput
                style={styles.codeField}
                value={otpInput}
                onChangeText={handleOtpChange}
                placeholder="••••••"
                placeholderTextColor={colors.text.tertiary}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                editable={!submittingOtp}
                autoFocus
                accessibilityLabel="6-digit code"
              />
              <TouchableOpacity
                onPress={() => void handleResendCode()}
                style={styles.linkButton}
                disabled={submittingEmail || resendSecondsLeft > 0}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel={
                  resendSecondsLeft > 0
                    ? `Resend code in ${resendSecondsLeft} seconds`
                    : "Resend code"
                }
                accessibilityRole="button"
                accessibilityState={{
                  disabled: submittingEmail || resendSecondsLeft > 0,
                }}
              >
                <Text
                  style={[
                    styles.linkButtonText,
                    (submittingEmail || resendSecondsLeft > 0) &&
                      styles.linkButtonTextDisabled,
                  ]}
                >
                  {resendSecondsLeft > 0
                    ? `Resend code in ${resendSecondsLeft}s`
                    : "Resend code"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleEditEmail}
                style={styles.linkButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Wrong email? Edit"
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonTextSubtle}>
                  Wrong email? Edit
                </Text>
              </TouchableOpacity>
              {/* ORCH-1102 — never leave the user hanging mid-OTP. A direct
                  "Back to sign-in options" resets the state machine to idle so
                  the Apple/Google/Email buttons are immediately usable again,
                  without the otp → edit → email → back detour. */}
              <TouchableOpacity
                onPress={handleBackToIdle}
                style={styles.linkButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Back to sign-in options"
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonTextSubtle}>
                  Back to sign-in options
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cycle 15 — verifying mode (DEC-097 + SPEC §3.5.4). */}
          {mode === "otp-verifying" && (
            <View style={styles.verifyingWrapper}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
            </View>
          )}
        </View>
          </>
        )}
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
  topBar: {
    paddingTop: 4,
    paddingBottom: 4,
    minHeight: 44,
    justifyContent: "center",
  },
  idleContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: WELCOME_CONTENT_GUTTER,
    paddingTop: WELCOME_CONTENT_GUTTER,
    gap: WELCOME_CONTENT_GUTTER,
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
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "#ffffff",
    borderRadius: 999,
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
    color: "#ffffff",
    letterSpacing: 0,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  taglineDesktop: {
    maxWidth: 430,
    fontSize: 27,
    lineHeight: 34,
  },
  authGroup: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    gap: vs(14),
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
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    ...shadows.sm,
  },
  appleButtonText: {
    color: colors.text.primary,
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
    color: "#ffffff",
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  termsLink: {
    color: "#ffffff",
    fontWeight: fontWeights.semibold,
    textDecorationLine: "underline",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Cycle 15 — email + OTP styles (DEC-097).
  emailButton: {
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
  emailButtonText: {
    color: colors.text.primary,
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  modeHeading: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
    color: "#ffffff",
    textAlign: "center",
    marginTop: vs(8),
    paddingHorizontal: spacing.xl,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  modeSubtext: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: fontWeights.regular,
    color: "#ffffff",
    textAlign: "center",
    marginTop: vs(8),
    paddingHorizontal: spacing.xl,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  modeSubtextEmail: {
    fontWeight: fontWeights.semibold,
    color: "#ffffff",
  },
  modeWrapper: {
    width: "100%",
    alignItems: "center",
    gap: vs(14),
  },
  emailField: {
    width: "100%",
    maxWidth: s(400),
    height: vs(56),
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    color: colors.text.primary,
  },
  codeField: {
    width: "100%",
    maxWidth: s(280),
    height: vs(64),
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    fontSize: 28,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    textAlign: "center",
    letterSpacing: 8,
  },
  primaryActionButton: {
    width: "100%",
    maxWidth: s(400),
    height: vs(56),
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    ...shadows.md,
  },
  primaryActionButtonText: {
    color: colors.text.inverse,
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  linkButton: {
    paddingVertical: vs(8),
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  linkButtonText: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  linkButtonTextDisabled: {
    color: "rgba(255, 255, 255, 0.65)",
  },
  linkButtonTextSubtle: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  verifyingWrapper: {
    width: "100%",
    alignItems: "center",
    paddingVertical: vs(24),
    gap: vs(12),
  },
});
