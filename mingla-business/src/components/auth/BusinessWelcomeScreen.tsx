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
// #2211 — the app's one Dynamic Type ceiling. These CTAs are hand-rolled
// TouchableOpacitys and never touch the shared `Button` primitive, so capping
// the primitive does nothing for THIS screen.
import { BUTTON_MAX_FONT_SCALE } from "../../constants/dynamicType";
import { Icon } from "../ui/Icon";
import {
  color,
  edge,
  fontWeights,
  materials,
  radius,
  shadow,
  size,
  space,
  type,
} from "../../constants/designSystem";
import { s, vs } from "../../utils/responsive";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import { ScrollView } from "../../wrappers/SmartScrollView";
// @ts-ignore -- Expo resolves the required .native/.web implementation per platform.
import { WelcomeVideoBackground } from "./WelcomeVideoBackground";
// #4238 W3-4: host web sign-up started (browser only; a no-op on native).
import { fireHostSignUpStarted } from "../../analytics/webAnalytics";

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
/** #4420 round-3 item 1 — desktop sign-in: video pane left, sign-in panel right. */
const WELCOME_DESKTOP_PANEL_WIDTH = 560;
const WEB_LOGO_SRC = "/brand/mingla-wordmark.png";

/**
 * #4420 — a sign-in failure the screen shows inline. `Alert.alert` is a no-op
 * on react-native-web, so a failed web sign-in showed nothing at all; the
 * inline error renders on every platform.
 */
export interface WelcomeAuthError {
  title: string;
  body: string;
}

const PROVIDER_SIGN_IN_FAILED: WelcomeAuthError = {
  title: "Couldn't sign you in",
  body: "Something didn't connect. Give it another tap.",
};

const isCancelledSignIn = (err: { message?: string; code?: string } | null | undefined): boolean =>
  err?.message?.includes("cancelled") === true ||
  err?.message?.includes("canceled") === true ||
  err?.code === "ERR_REQUEST_CANCELED";

export interface BusinessWelcomeScreenProps {
  /**
   * #4420 — may resolve `{ error }`. On web the provider redirect reports its
   * failure that way and nothing else shows it, so the screen does. On native
   * AuthContext has already shown its own alert for a returned error.
   */
  onGoogleSignIn: () => Promise<void | { error: Error | null }>;
  onAppleSignIn: () => Promise<void | { error: Error | null }>;
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
  const [authError, setAuthError] = useState<WelcomeAuthError | null>(null);
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
    // #4420 round-3 item 3 — iOS listens to the WILL events so the field and
    // its button ride up WITH the keyboard animation instead of sitting under
    // it until the Did event lands. Android keeps the Did events.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    // orch-strict-grep-allow orch-0892 — anchored sign-in (no ScrollView)
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardPad(e.endCoordinates.height);
    });
    // orch-strict-grep-allow orch-0892 — anchored sign-in (no ScrollView)
    const hideSub = Keyboard.addListener(hideEvent, () => {
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
    setAuthError(null);
    fireHostSignUpStarted();
    try {
      const result = await onGoogleSignIn();
      const returned = result ? result.error : null;
      if (Platform.OS === "web" && returned && !isCancelledSignIn(returned as { message?: string; code?: string })) {
        setAuthError(PROVIDER_SIGN_IN_FAILED);
      }
    } catch (error: unknown) {
      if (isCancelledSignIn(error as { message?: string; code?: string })) return;
      setAuthError(PROVIDER_SIGN_IN_FAILED);
    } finally {
      setIsGoogleSignInInProgress(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (isAnyAuthInProgress) return;

    HapticFeedback.buttonPress();
    setIsAppleSignInInProgress(true);
    setAuthError(null);
    fireHostSignUpStarted();
    try {
      const result = await onAppleSignIn();
      const returned = result ? result.error : null;
      if (Platform.OS === "web" && returned && !isCancelledSignIn(returned as { message?: string; code?: string })) {
        setAuthError(PROVIDER_SIGN_IN_FAILED);
      }
    } catch (error: unknown) {
      if (isCancelledSignIn(error as { message?: string; code?: string })) return;
      setAuthError(PROVIDER_SIGN_IN_FAILED);
    } finally {
      setIsAppleSignInInProgress(false);
    }
  };

  // Cycle 15 — email + OTP handlers (DEC-097).
  const handleStartEmailFlow = useCallback((): void => {
    HapticFeedback.buttonPress();
    setAuthError(null);
    setMode("email-input");
    setEmailInput("");
    setOtpInput("");
  }, []);

  const handleSendCode = useCallback(async (): Promise<void> => {
    if (submittingEmail || !emailInput.trim()) return;
    HapticFeedback.buttonPress();
    setSubmittingEmail(true);
    setAuthError(null);
    fireHostSignUpStarted();
    try {
      const { error } = await onEmailSignIn(emailInput);
      if (error) {
        setAuthError({ title: "Couldn't send code", body: error.message });
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
      setAuthError(null);
      setMode("otp-verifying");
      try {
        const { error } = await onVerifyEmailOtp(emailInput, code);
        if (error) {
          setAuthError({ title: "Couldn't sign in", body: error.message });
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
    setAuthError(null);
    try {
      const { error } = await onEmailSignIn(emailInput);
      if (error) {
        setAuthError({ title: "Couldn't resend code", body: error.message });
        return;
      }
      setResendCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    } finally {
      setSubmittingEmail(false);
    }
  }, [submittingEmail, resendSecondsLeft, emailInput, onEmailSignIn]);

  const handleEditEmail = useCallback((): void => {
    HapticFeedback.buttonPress();
    setAuthError(null);
    setMode("email-input");
    setOtpInput("");
  }, []);

  const handleBackToIdle = useCallback((): void => {
    HapticFeedback.buttonPress();
    setAuthError(null);
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

  const renderTagline = () => (
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
  );

  // #4420 — the sign-in error, inline above the controls on every platform.
  const renderAuthError = () =>
    authError === null ? null : (
      <View
        style={styles.authError}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="welcome-auth-error"
      >
        <Text style={styles.authErrorTitle}>{authError.title}</Text>
        <Text style={styles.authErrorBody}>{authError.body}</Text>
      </View>
    );

  const renderIdleAuthGroup = () => (
    <View style={[styles.authGroup, desktop && styles.authGroupDesktop]}>
      {renderAuthError()}
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
              <ActivityIndicator size="small" color={color.ink} />
            ) : (
              <AppleLogo size={22} color="#111827" />
            )}
            <Text style={styles.appleButtonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >
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
            <ActivityIndicator size="small" color={color.ink} />
          ) : (
            <Image source={googleIcon} style={styles.googleIcon} resizeMode="contain" />
          )}
          <Text style={styles.googleButtonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >
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
          <Icon name="mail" size={22} color={color.text1} />
          <Text style={styles.emailButtonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >Continue with Email</Text>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View style={[styles.termsWrapper, { opacity: termsOpacity }]}>
        <Text style={[styles.termsText, desktop && styles.termsTextDesktop]}>
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

  return (
    <View style={styles.root}>
      {/* Desktop: the video fills the left pane only and carries the centred
          tagline (#4420 round-3 item 1); phone: the video fills the screen. */}
      <View
        pointerEvents="none"
        style={desktop ? styles.mediaPaneDesktop : StyleSheet.absoluteFill}
      >
        <WelcomeVideoBackground />
        <View pointerEvents="none" style={styles.videoVeil} />
        {desktop ? (
          <View style={styles.mediaTaglineDesktop}>{renderTagline()}</View>
        ) : null}
      </View>
      <SafeAreaView
        style={[styles.container, desktop && styles.panelDesktop]}
        edges={["top", "left", "right"]}
      >
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {onBack ? (
          <View style={[styles.topBar, { paddingLeft: Math.max(insets.left, space[4]) }]}>
            <TouchableOpacity
              onPress={() => {
                HapticFeedback.buttonPress();
                onBack();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Icon name="chevL" size={28} color={color.textOnPhoto} />
            </TouchableOpacity>
          </View>
        ) : null}

        {mode === "idle" ? (
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.idleContent,
              desktop && styles.idleContentDesktop,
              { paddingBottom: Math.max(insets.bottom, WELCOME_CONTENT_GUTTER) },
            ]}
          >
            {renderLogo()}
            {desktop ? null : renderTagline()}
            {renderIdleAuthGroup()}
          </ScrollView>
        ) : (
          <>
        <View style={[styles.centerZone, desktop && styles.centerZoneDesktop]}>
          {desktop ? null : renderLogo()}

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
            desktop && styles.actionZoneDesktop,
            {
              // ORCH-1165: +42pt (KEYBOARD_TOOLBAR_HEIGHT) only with the
              // keyboard open, so the Done bar never covers the action zone.
              paddingBottom:
                Math.max(insets.bottom, vs(24)) +
                (keyboardPad > 0 ? keyboardPad + 42 : 0),
            },
          ]}
        >
          {mode === "email-input" || mode === "otp-input" ? renderAuthError() : null}
          {/* Cycle 15 — email input mode (DEC-097 + SPEC §3.5.4). */}
          {mode === "email-input" && (
            <View style={styles.modeWrapper}>
              <Text style={styles.fieldLabel} importantForAccessibility="no">
                Email address
              </Text>
              <TextInput
                style={styles.emailField}
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="you@example.com"
                placeholderTextColor={color.text3}
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
                  !submittingEmail && !emailInput.trim() && styles.primaryActionButtonEmpty,
                  submittingEmail && styles.buttonDisabled,
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
                  <ActivityIndicator size="small" color={color.ink} />
                ) : (
                  <Text
                    style={[
                      styles.primaryActionButtonText,
                      !emailInput.trim() && styles.primaryActionButtonTextEmpty,
                    ]}
                  >
                    Send code
                  </Text>
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
              {/* #4420 — six code cells drawn over ONE input, so paste,
                  one-time-code autofill and the number pad still work. */}
              <View style={styles.codeCells}>
                {Array.from({ length: 6 }, (_, i) => {
                  const digit = otpInput[i] ?? "";
                  const active = i === Math.min(otpInput.length, 5);
                  return (
                    <View
                      key={i}
                      style={[styles.codeCell, active && styles.codeCellActive]}
                      importantForAccessibility="no"
                    >
                      <Text style={[styles.codeCellText, digit === "" && styles.codeCellDot]}>
                        {digit === "" ? "•" : digit}
                      </Text>
                    </View>
                  );
                })}
              <TextInput
                style={styles.codeField}
                value={otpInput}
                onChangeText={handleOtpChange}
                placeholder="••••••"
                placeholderTextColor={color.text3}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                editable={!submittingOtp}
                autoFocus
                caretHidden
                accessibilityLabel="6-digit code"
              />
              </View>
              <View style={styles.codeLinksRow}>
              <TouchableOpacity
                onPress={() => void handleResendCode()}
                style={styles.linkButtonInline}
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
                style={styles.linkButtonInline}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Wrong email? Edit"
                accessibilityRole="button"
              >
                <Text style={styles.linkButtonTextSubtle}>
                  Wrong email? Edit
                </Text>
              </TouchableOpacity>
              </View>
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
              <ActivityIndicator size="large" color={color.text1} />
            </View>
          )}
        </View>
        {/* Desktop: balance the panel so the form sits mid-height. */}
        {desktop ? <View style={styles.desktopSpacer} /> : null}
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

// #4420 — the white logo pill, white-on-video text with its shadow, the Apple
// button fill and the #111827 Apple mark are pinned byte-for-byte by the
// issue-2052 video welcome contract (.github/scripts/strict-grep/
// issue-2052-video-welcome-contract.mjs). They are content over the video, not
// chrome; everything else on this screen reads tokens.
const PHOTO_TEXT_SHADOW = {
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
} as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  mediaPaneDesktop: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: WELCOME_DESKTOP_PANEL_WIDTH,
    overflow: "hidden",
  },
  mediaTaglineDesktop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[9],
  },
  videoVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: WELCOME_VIDEO_VEIL,
  },
  container: {
    flex: 1,
  },
  panelDesktop: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: WELCOME_DESKTOP_PANEL_WIDTH,
    backgroundColor: color.canvas,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: color.line,
  },
  topBar: {
    paddingTop: space[1],
    paddingBottom: space[1],
    minHeight: size.iconBtn.md,
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
  idleContentDesktop: {
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: space[10] + space[4],
    gap: space[7],
  },
  centerZone: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "flex-end",
    paddingHorizontal: space[6],
    paddingBottom: space[6],
    gap: space[3],
  },
  centerZoneDesktop: {
    paddingHorizontal: space[10] + space[4],
  },
  desktopSpacer: {
    flex: 1,
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
    ...type.title,
    fontWeight: fontWeights.bold,
    color: "#ffffff",
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    ...PHOTO_TEXT_SHADOW,
  },
  taglineDesktop: {
    maxWidth: 620,
    ...type.display,
    fontSize: 44,
    lineHeight: 48,
  },
  authGroup: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    gap: space[3],
  },
  authGroupDesktop: {
    alignItems: "stretch",
  },
  actionZone: {
    paddingHorizontal: space[6],
    alignItems: "stretch",
    gap: space[3],
  },
  actionZoneDesktop: {
    paddingHorizontal: space[10] + space[4],
  },
  buttonAnimWrapper: {
    width: "100%",
    alignItems: "center",
  },
  appleButton: {
    width: "100%",
    maxWidth: s(400),
    // #2211 — `minHeight`, NOT `height`: at accessibility text sizes the
    // label must grow the button rather than crop to "Continue wi".
    minHeight: size.btn.phoneLg,
    backgroundColor: "#ffffff",
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
    ...shadow.paper,
  },
  appleButtonText: {
    color: color.ink,
    ...type.btn,
  },
  // #4420 — Google and Email are the dark control material (the mockup);
  // Apple keeps its required white button and black mark.
  googleButton: {
    width: "100%",
    maxWidth: s(400),
    // #2211 — `minHeight`, NOT `height` (see appleButton).
    minHeight: size.btn.phoneLg,
    backgroundColor: materials.control.glassFill,
    borderWidth: edge.control.borderWidth,
    borderColor: edge.control.borderColor,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
  },
  googleButtonText: {
    color: color.text1,
    ...type.btn,
  },
  googleIcon: {
    width: 22,
    height: 22,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  termsWrapper: {
    marginTop: space[2],
    alignSelf: "stretch",
  },
  termsText: {
    ...type.caption,
    fontWeight: fontWeights.regular,
    color: "#ffffff",
    textAlign: "center",
    paddingHorizontal: space[6],
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    ...PHOTO_TEXT_SHADOW,
  },
  termsTextDesktop: {
    color: color.text2,
    textAlign: "left",
    paddingHorizontal: 0,
  },
  termsLink: {
    color: color.textOnPhoto,
    fontWeight: fontWeights.semibold,
    textDecorationLine: "underline",
  },
  // Cycle 15 — email + OTP styles (DEC-097).
  emailButton: {
    width: "100%",
    maxWidth: s(400),
    // #2211 — `minHeight`, NOT `height` (see appleButton).
    minHeight: size.btn.phoneLg,
    backgroundColor: materials.control.glassFill,
    borderWidth: edge.control.borderWidth,
    borderColor: edge.control.borderColor,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
  },
  emailButtonText: {
    color: color.text1,
    ...type.btn,
  },
  modeHeading: {
    ...type.title,
    color: color.textOnPhoto,
    textAlign: "left",
    marginTop: space[3],
    textShadowColor: color.mask,
    ...PHOTO_TEXT_SHADOW,
  },
  modeSubtext: {
    ...type.body,
    color: color.textOnPhoto2,
    textAlign: "left",
    textShadowColor: color.mask,
    ...PHOTO_TEXT_SHADOW,
  },
  modeSubtextEmail: {
    fontWeight: fontWeights.semibold,
    color: color.textOnPhoto,
  },
  authError: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    gap: space[1],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.errorLine,
    backgroundColor: color.errorTint,
  },
  authErrorTitle: {
    ...type.row,
    color: color.errorText,
  },
  authErrorBody: {
    ...type.small,
    color: color.errorText,
  },
  modeWrapper: {
    width: "100%",
    maxWidth: s(400),
    alignSelf: "center",
    alignItems: "stretch",
    gap: space[3],
  },
  fieldLabel: {
    ...type.caption,
    color: color.textOnPhoto2,
    marginBottom: -space[1],
  },
  emailField: {
    width: "100%",
    minHeight: size.btn.phoneLg,
    backgroundColor: color.card,
    borderWidth: edge.ringInputFocus.borderWidth,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    ...type.body,
    lineHeight: undefined,
    color: color.text1,
  },
  codeCells: {
    flexDirection: "row",
    gap: space[2],
    width: "100%",
  },
  codeCell: {
    flex: 1,
    minWidth: 0,
    height: size.btn.phoneLg,
    backgroundColor: color.card,
    borderWidth: edge.lineStrong.borderWidth,
    borderColor: edge.lineStrong.borderColor,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  codeCellActive: {
    borderWidth: edge.ringInputFocus.borderWidth,
    borderColor: edge.ringInputFocus.borderColor,
  },
  codeCellText: {
    ...type.title,
    color: color.text1,
  },
  codeCellDot: {
    ...type.body,
    color: color.text3,
  },
  // The real input sits over the cells, invisible, so a tap anywhere on them
  // focuses it and paste / one-time-code autofill land in one field.
  codeField: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.011,
    color: color.transparent,
    fontSize: 1,
  },
  codeLinksRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space[2],
  },
  linkButtonInline: {
    paddingVertical: space[2],
  },
  primaryActionButton: {
    width: "100%",
    minHeight: size.btn.phoneLg,
    backgroundColor: color.paper,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
    ...shadow.paper,
  },
  primaryActionButtonText: {
    color: color.ink,
    ...type.btn,
  },
  primaryActionButtonEmpty: {
    backgroundColor: color.card2,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryActionButtonTextEmpty: {
    color: color.text4,
  },
  linkButton: {
    paddingVertical: space[2],
    alignSelf: "flex-start",
  },
  linkButtonText: {
    ...type.btn,
    color: color.textOnPhoto,
    textShadowColor: color.mask,
    ...PHOTO_TEXT_SHADOW,
  },
  linkButtonTextDisabled: {
    color: color.textOnPhoto2,
    opacity: 0.75,
  },
  linkButtonTextSubtle: {
    ...type.small,
    fontWeight: fontWeights.medium,
    color: color.textOnPhoto2,
    textShadowColor: color.mask,
    ...PHOTO_TEXT_SHADOW,
  },
  verifyingWrapper: {
    width: "100%",
    alignItems: "center",
    paddingVertical: space[6],
    gap: space[3],
  },
});
