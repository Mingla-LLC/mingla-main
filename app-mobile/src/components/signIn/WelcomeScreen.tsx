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
  // #3524 — the email panel is an INPUT surface on a screen that had none, so it
  // needs the keyboard avoidance the OAuth buttons never did.
  KeyboardAvoidingView,
  TextInput,
} from "react-native";
import { AppleLogo } from "../ui/BrandIcons";
import { Icon } from "../ui/Icon";
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
import {
  sendPendingClaimEmailCode,
  verifyPendingClaimEmailCode,
  type PendingClaim,
} from "../../services/attendanceClaimService";
import { formatStartsAtLabel } from "../../utils/zoneLabel";
import { postHogService } from "../../services/postHogService";

const googleIcon = require("../../../assets/google_icon.png");
const logo = MINGLA_WORDMARK;

import { LEGAL_URLS } from "../../constants/urls";
// #2211 — the consumer app has no shared CTA primitive, so every capped label
// imports the ceiling directly.
import { BUTTON_MAX_FONT_SCALE } from '../../constants/dynamicType';

interface WelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
  /**
   * #3524 — sign in by emailed code. Optional so every existing render site
   * keeps compiling and behaving IDENTICALLY: with these absent the third option
   * is not rendered at all and this screen is byte-for-byte what it was.
   */
  onSendEmailCode?: (email: string) => Promise<{ ok: boolean; error?: string }>;
  onVerifyEmailCode?: (
    email: string,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Opens the panel already expanded — how the claim sheet's "that's not me"
   * flow lands here, so the guest does not have to find it. */
  emailPanelInitiallyOpen?: boolean;
  /**
   * #3682 Wave 2.5 — follow_invite first open: open on the code step with the
   * email filled in and send exactly one code.
   */
  followInvite?: { brandName: string; email: string } | null;
  /** #4063 — safe claim-link summary. The address is already server-masked. */
  ticketClaim?: PendingClaim | null;
  ticketClaimResolving?: boolean;
}

/** One resend per 30 seconds, with a visible countdown. A guest tapping resend
 * four times in a row is how an account gets provider-rate-limited and then told
 * something unhelpful. */
const RESEND_COOLDOWN_SECONDS = 30;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WELCOME_TAGLINE = "Places, plans, and experiences\nworth showing up for";
const WELCOME_TAGLINE_ACCESSIBILITY =
  "Places, plans, and experiences worth showing up for";
const WELCOME_VIDEO_VEIL = "rgba(0, 0, 0, 0.74)";
const WELCOME_CONTENT_GUTTER = 24;
const WELCOME_LOGO_PILL_WIDTH = 140;
const WELCOME_LOGO_PILL_HEIGHT = 54;
const WELCOME_WORDMARK_WIDTH = 108;

export default function WelcomeScreen({
  onGoogleSignIn,
  onAppleSignIn,
  onSendEmailCode,
  onVerifyEmailCode,
  emailPanelInitiallyOpen = false,
  followInvite = null,
  ticketClaim = null,
  ticketClaimResolving = false,
}: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useTranslation(['auth', 'common']);
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] =
    useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  // #3524 — the email panel's own state. Two steps: address, then the 6-digit
  // code. Nothing here is logged.
  const emailSignInAvailable = onSendEmailCode !== undefined &&
    onVerifyEmailCode !== undefined;
  const followInviteActive =
    followInvite !== null &&
    followInvite !== undefined &&
    typeof followInvite.email === "string" &&
    followInvite.email.length > 0 &&
    emailSignInAvailable;
  const [emailPanelOpen, setEmailPanelOpen] = useState(
    (emailPanelInitiallyOpen || followInviteActive) && emailSignInAvailable,
  );

  /**
   * #3524 — the prop can go true while this screen is ALREADY MOUNTED, and the
   * useState initializer above would never see it.
   *
   * That is the signed-out arm of the claim sheet. The sheet renders on top of
   * this screen, so tapping its `Sign in` does not mount anything new — it closes
   * the sheet and asks for the panel. A mount-only initializer would leave the
   * guest looking at the same three buttons they were looking at before, which is
   * the dead-tap this issue is about, moved one step later.
   *
   * It only ever OPENS. It never closes a panel the guest opened themselves.
   */
  useEffect(() => {
    if ((emailPanelInitiallyOpen || followInviteActive) && emailSignInAvailable) {
      setEmailPanelOpen(true);
    }
  }, [emailPanelInitiallyOpen, followInviteActive, emailSignInAvailable]);
  const [emailStep, setEmailStep] = useState<"address" | "code">(
    followInviteActive ? "code" : "address",
  );
  const [emailAddress, setEmailAddress] = useState(
    followInviteActive ? followInvite!.email : "",
  );
  const [emailCode, setEmailCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  // Always a SENTENCE, never a raw provider message.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const followInviteCodeSentRef = useRef(false);
  const [claimEmailChallengeId, setClaimEmailChallengeId] = useState<string | null>(null);
  const [claimEmailSentTo, setClaimEmailSentTo] = useState<string | null>(null);
  const [claimEmailFallback, setClaimEmailFallback] = useState(false);

  useEffect(() => {
    setClaimEmailChallengeId(null);
    setClaimEmailSentTo(null);
    setClaimEmailFallback(false);
    setEmailCode("");
    setEmailError(null);
  }, [ticketClaim?.code]);

  // #3682 Wave 2.5 O1 — send exactly one code when the invite lands.
  useEffect(() => {
    if (!followInviteActive || !onSendEmailCode) return;
    if (followInviteCodeSentRef.current) return;
    followInviteCodeSentRef.current = true;
    setEmailStep("code");
    setEmailAddress(followInvite!.email);
    setEmailPanelOpen(true);
    setEmailBusy(true);
    void onSendEmailCode(followInvite!.email)
      .then((result) => {
        if (!result.ok) {
          setEmailError(
            result.error ??
              "We couldn't reach Mingla. Check your connection and try again.",
          );
        } else {
          setResendIn(RESEND_COOLDOWN_SECONDS);
        }
      })
      .finally(() => setEmailBusy(false));
  }, [followInviteActive, followInvite, onSendEmailCode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const handle = setInterval(
      () => setResendIn((prior) => (prior <= 1 ? 0 : prior - 1)),
      1000,
    );
    return () => clearInterval(handle);
  }, [resendIn]);

  const isAnyAuthInProgress =
    isGoogleSignInInProgress || isAppleSignInInProgress || emailBusy;

  const claimEmailPreferred = Boolean(
    ticketClaim && !ticketClaim.expired &&
      ticketClaim.preferredProof === "email" && ticketClaim.emailMasked &&
      !claimEmailFallback,
  );

  const sendClaimEmailCode = async (): Promise<void> => {
    if (!ticketClaim || emailBusy) return;
    HapticFeedback.light();
    postHogService.capture("welcome_continue_with_purchase_email_tapped", {
      claim_noun: ticketClaim.noun,
    });
    setEmailBusy(true);
    setEmailError(null);
    try {
      const result = await sendPendingClaimEmailCode(ticketClaim.code);
      if (!result.ok) {
        setEmailError(result.message);
        if (result.error === "rate_limited" || result.error === "no_email") {
          setClaimEmailFallback(true);
        }
        return;
      }
      setClaimEmailChallengeId(result.challengeId);
      setClaimEmailSentTo(result.sentTo);
      setEmailCode("");
      setResendIn(RESEND_COOLDOWN_SECONDS);
      AccessibilityInfo.announceForAccessibility(
        `We emailed a six digit code to ${result.sentTo}.`,
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const submitClaimEmailCode = async (): Promise<void> => {
    if (!claimEmailChallengeId || emailBusy) return;
    const otp = emailCode.trim();
    if (!/^\d{6}$/.test(otp)) {
      setEmailError("Enter the 6-digit code we emailed you.");
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const result = await verifyPendingClaimEmailCode({
        challengeId: claimEmailChallengeId,
        otp,
      });
      if (!result.ok) setEmailError(result.message);
      // On success the auth listener owns the transition and unmounts this screen.
    } finally {
      setEmailBusy(false);
    }
  };

  const sendEmailCode = async (): Promise<void> => {
    if (onSendEmailCode === undefined || emailBusy) return;
    const address = emailAddress.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(address)) {
      setEmailError("Enter the email address you used at checkout.");
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const result = await onSendEmailCode(address);
      if (!result.ok) {
        setEmailError(result.error ?? "We couldn’t send the code. Try again.");
        return;
      }
      // #3540 — keep the displayed/verified address identical to the address
      // the service actually received. This also removes accidental spaces and
      // casing before the user decides whether the inbox is the right one.
      setEmailAddress(address);
      setEmailStep("code");
      setResendIn(RESEND_COOLDOWN_SECONDS);
      AccessibilityInfo.announceForAccessibility(
        "We emailed you a six digit code.",
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const editEmailAddress = (): void => {
    // A follow invite is bound to the address carried by the signed invite.
    // Letting that flow redirect its OTP to another mailbox would sever the
    // server-authoritative identity contract.
    if (followInviteActive || emailBusy) return;

    setEmailStep("address");
    setEmailCode("");
    setEmailError(null);
    setResendIn(0);
    AccessibilityInfo.announceForAccessibility("Edit your email address.");
  };

  const submitEmailCode = async (): Promise<void> => {
    if (onVerifyEmailCode === undefined || emailBusy) return;
    const code = emailCode.trim();
    if (code.length < 6) {
      setEmailError("Enter the 6-digit code we emailed you.");
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const result = await onVerifyEmailCode(
        emailAddress.trim().toLowerCase(),
        code,
      );
      if (!result.ok) {
        setEmailError(
          result.error ?? "We couldn’t verify that code. Try again.",
        );
      }
      // On success the auth listener takes over and this screen unmounts. There
      // is deliberately no navigation call here.
    } finally {
      setEmailBusy(false);
    }
  };

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

  const logoPillWidth = Math.min(
    width - WELCOME_CONTENT_GUTTER * 2,
    WELCOME_LOGO_PILL_WIDTH,
  );
  const logoPillHeight =
    (logoPillWidth * WELCOME_LOGO_PILL_HEIGHT) / WELCOME_LOGO_PILL_WIDTH;
  const logoWidth =
    (logoPillWidth * WELCOME_WORDMARK_WIDTH) / WELCOME_LOGO_PILL_WIDTH;
  const logoHeight = logoWidth * 480 / 1356;
  const startsAtLabel = formatStartsAtLabel(
    ticketClaim?.startsAt,
    ticketClaim?.timezone,
  );
  const claimCardLabel = ticketClaim
    ? t(`auth:welcome.claimCard.${ticketClaim.noun}`, {
      defaultValue: `Your ${ticketClaim.noun} is waiting`,
    })
    : null;
  const expiredMethods = ticketClaim
    ? [
      ticketClaim.emailMasked ? `the email ${ticketClaim.emailMasked}` : null,
      ticketClaim.phoneLast4 ? `the number ending ${ticketClaim.phoneLast4}` : null,
    ].filter((method): method is string => method !== null)
    : [];
  const expiredLine = ticketClaim?.expired
    ? `This link has expired. Your ${ticketClaim.noun} is still yours: ${
      expiredMethods.length > 0
        ? `sign in with ${expiredMethods.join(" or ")}.`
        : "sign in with the email or mobile number you used."
    }`
    : null;

  return (
    <View style={styles.root}>
      <WelcomeVideoBackground />
      <View pointerEvents="none" style={styles.videoVeil} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent
        />

        {/*
          #3524 — this screen gained its FIRST text inputs, so it gained the two
          things an input surface needs:

            KeyboardAvoidingView — the email and code fields sit at the bottom of
              the stack, directly under where the iOS keyboard comes up. Without
              this the guest types into a field they cannot see.
            keyboardShouldPersistTaps="handled" — without it, the first tap on
              "Email me a code" only dismisses the keyboard and does nothing else.
              That is a dead tap, and a dead tap on the button that sends the code
              is indistinguishable from the feature being broken.

          Both are additive: with the keyboard down this renders exactly as before.
        */}
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.idleContent,
            { paddingBottom: Math.max(insets.bottom, WELCOME_CONTENT_GUTTER) },
          ]}
        >
          <Animated.View
            style={[
              styles.logoContainer,
              { width: logoPillWidth, height: logoPillHeight },
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <Image
              source={logo}
              style={[styles.logo, { width: logoWidth, height: logoHeight }]}
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
            accessibilityLabel={
              followInviteActive
                ? `Finish following ${followInvite!.brandName}`
                : WELCOME_TAGLINE_ACCESSIBILITY
            }
            accessibilityRole="header"
          >
            {followInviteActive
              ? `Finish following ${followInvite!.brandName}`
              : WELCOME_TAGLINE}
          </Animated.Text>

          {ticketClaimResolving ? (
            <View style={styles.claimResolving} testID="welcome-ticket-claim-resolving">
              <ActivityIndicator color="#ffffff" />
              <Text style={styles.claimResolvingText}>
                {t("auth:welcome.opening.ticket", {
                  defaultValue: "Opening your ticket…",
                })}
              </Text>
            </View>
          ) : null}

        <View
          style={[styles.authGroup, ticketClaimResolving && styles.hiddenAuthGroup]}
          pointerEvents={ticketClaimResolving ? "none" : "auto"}
          accessibilityElementsHidden={ticketClaimResolving}
          importantForAccessibility={ticketClaimResolving ? "no-hide-descendants" : "auto"}
        >
          {ticketClaim && !ticketClaim.expired ? (
            <View
              style={styles.claimCard}
              accessibilityRole="summary"
              accessibilityLabel={[
                claimCardLabel,
                ticketClaim.title,
                ticketClaim.noun === "receipt" ? ticketClaim.orderLabel : null,
                startsAtLabel,
              ].filter(Boolean).join(". ")}
              testID="welcome-ticket-claim-card"
            >
              <Text style={styles.claimCardEyebrow}>{claimCardLabel}</Text>
              <Text style={styles.claimCardTitle}>{ticketClaim.title}</Text>
              {ticketClaim.noun === "receipt" && ticketClaim.orderLabel ? (
                <Text style={styles.claimCardMeta}>{ticketClaim.orderLabel}</Text>
              ) : null}
              {startsAtLabel ? (
                <Text style={styles.claimCardMeta}>{startsAtLabel}</Text>
              ) : null}
              <Text style={styles.claimCardPrompt}>
                {t("auth:welcome.signInToGetIt", {
                  defaultValue: "Sign in to get it",
                })}
              </Text>
            </View>
          ) : null}

          {expiredLine ? (
            <Text style={styles.claimHint} testID="welcome-ticket-claim-expired">
              {expiredLine}
            </Text>
          ) : null}

          {claimEmailPreferred ? (
            claimEmailChallengeId === null ? (
              <TouchableOpacity
                onPress={() => void sendClaimEmailCode()}
                style={[styles.claimEmailButton, emailBusy && styles.buttonDisabled]}
                disabled={emailBusy}
                accessibilityRole="button"
                accessibilityLabel={`Continue with ${ticketClaim!.emailMasked}`}
                accessibilityState={{ disabled: emailBusy, busy: emailBusy }}
                testID="welcome-claim-email-send"
              >
                {emailBusy ? (
                  <ActivityIndicator size="small" color="#111827" />
                ) : (
                  <Text
                    style={styles.claimEmailButtonText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
                  >
                    {t("auth:welcome.continueWithEmailAddress", {
                      email: ticketClaim!.emailMasked,
                      defaultValue: `Continue with ${ticketClaim!.emailMasked}`,
                    })}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.emailPanel} testID="welcome-claim-email-panel">
                <Text style={styles.emailPanelHeading}>
                  {t("auth:email.checkTitle", { defaultValue: "Check your email" })}
                </Text>
                <Text style={styles.emailPanelLabel}>
                  {t("auth:email.codeSentTo", {
                    email: claimEmailSentTo ?? ticketClaim!.emailMasked,
                    defaultValue: `Enter the 6-digit code we sent to ${
                      claimEmailSentTo ?? ticketClaim!.emailMasked
                    }.`,
                  })}
                </Text>
                <TextInput
                  value={emailCode}
                  onChangeText={(next) => {
                    setEmailCode(next.replace(/[^0-9]/g, "").slice(0, 6));
                    setEmailError(null);
                  }}
                  placeholder="123456"
                  placeholderTextColor="rgba(255,255,255,.45)"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  returnKeyType="done"
                  onSubmitEditing={() => void submitClaimEmailCode()}
                  editable={!emailBusy}
                  maxLength={6}
                  style={[styles.emailInput, styles.emailCodeInput]}
                  accessibilityLabel="Six digit sign-in code"
                  testID="welcome-claim-email-code"
                />
                <TouchableOpacity
                  onPress={() => void submitClaimEmailCode()}
                  style={[styles.emailSubmit, emailBusy && styles.buttonDisabled]}
                  disabled={emailBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with this code"
                  accessibilityState={{ disabled: emailBusy, busy: emailBusy }}
                  testID="welcome-claim-email-verify"
                >
                  {emailBusy ? (
                    <ActivityIndicator size="small" color="#111827" />
                  ) : (
                    <Text style={styles.emailSubmitText}>Sign in</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void sendClaimEmailCode()}
                  style={styles.emailGhost}
                  disabled={emailBusy || resendIn > 0}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: emailBusy || resendIn > 0 }}
                  testID="welcome-claim-email-resend"
                >
                  <Text style={styles.emailGhostText}>
                    {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
                  </Text>
                </TouchableOpacity>
                {emailError ? (
                  <Text style={styles.emailError} accessibilityLiveRegion="polite">
                    {emailError}
                  </Text>
                ) : null}
              </View>
            )
          ) : null}
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
                  <ActivityIndicator size="small" color="#111827" />
                ) : (
                  <AppleLogo size={22} color="#111827" />
                )}
                <Text style={styles.appleButtonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >
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
              <Text style={styles.googleButtonText}
                numberOfLines={1}
                maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
              >
                {isGoogleSignInInProgress
                  ? t('auth:welcome.connecting')
                  : t('auth:welcome.continue_with_google')}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/*
            #3524 — CONTINUE WITH EMAIL. The third way in.

            A guest buys a ticket with an address that has no Google and no Apple
            account behind it. Their ticket can only land on an account that has
            PROVED it owns that address, so before this they could not claim it at
            all — which is the dead end #3524 exists to remove.

            The panel is INLINE, not a route: the claim sheet sends the guest
            straight here mid-claim, and a route push would have to carry and
            restore the pending claim across a navigation it does not own.
          */}
          {emailSignInAvailable && !claimEmailPreferred ? (
            <Animated.View
              style={[
                styles.buttonAnimWrapper,
                {
                  opacity: googleOpacity,
                  transform: [{ translateY: googleTranslateY }],
                },
              ]}
            >
              {!emailPanelOpen ? (
                <TouchableOpacity
                  onPress={() => {
                    HapticFeedback.light();
                    setEmailPanelOpen(true);
                  }}
                  style={[
                    styles.emailButton,
                    isAnyAuthInProgress && styles.buttonDisabled,
                  ]}
                  disabled={isAnyAuthInProgress}
                  activeOpacity={0.9}
                  accessibilityLabel="Continue with email"
                  accessibilityRole="button"
                  accessibilityHint="Signs you in with a code we email you"
                  accessibilityState={{ disabled: isAnyAuthInProgress }}
                  testID="welcome-continue-with-email"
                >
                  <Icon
                    name="mail-outline"
                    size={22}
                    color={colors.text.primary}
                  />
                  <Text
                    style={styles.emailButtonText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
                  >
                    Continue with email
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.emailPanel} testID="welcome-email-panel">
                  {emailStep === "address" ? (
                    <>
                      <Text style={styles.emailPanelLabel}>
                        We’ll email you a 6-digit code.
                      </Text>
                      <TextInput
                        value={emailAddress}
                        onChangeText={(next) => {
                          setEmailAddress(next);
                          setEmailCode("");
                          setEmailError(null);
                          setResendIn(0);
                        }}
                        placeholder="you@example.com"
                        placeholderTextColor="rgba(255,255,255,.45)"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        textContentType="emailAddress"
                        returnKeyType="send"
                        onSubmitEditing={() => void sendEmailCode()}
                        editable={!emailBusy}
                        style={styles.emailInput}
                        accessibilityLabel="Email address"
                        testID="welcome-email-address"
                      />
                      <TouchableOpacity
                        onPress={() => void sendEmailCode()}
                        style={[
                          styles.emailSubmit,
                          emailBusy && styles.buttonDisabled,
                        ]}
                        disabled={emailBusy}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                        accessibilityLabel="Email me a sign-in code"
                        accessibilityState={{
                          disabled: emailBusy,
                          busy: emailBusy,
                        }}
                        testID="welcome-email-send"
                      >
                        {emailBusy ? (
                          <ActivityIndicator size="small" color="#111827" />
                        ) : (
                          <>
                            <Icon
                              name="mail-outline"
                              size={22}
                              color={colors.text.primary}
                            />
                            <Text
                              style={styles.emailSubmitText}
                              maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
                            >
                              Email me a code
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={styles.emailPanelHeading}>
                        {t("auth:email.checkTitle", { defaultValue: "Check your email" })}
                      </Text>
                      <Text style={styles.emailPanelLabel}>
                        {followInviteActive
                          ? t("auth:email.codeSentTo", {
                            email: followInvite!.email,
                            defaultValue: `Enter the 6-digit code we sent to ${followInvite!.email}.`,
                          })
                          : t("auth:email.codeSentTo", {
                            email: emailAddress,
                            defaultValue: `Enter the 6-digit code we sent to ${emailAddress}.`,
                          })}
                      </Text>
                      {!followInviteActive ? (
                        <TouchableOpacity
                          onPress={editEmailAddress}
                          style={styles.emailEdit}
                          disabled={emailBusy}
                          accessibilityRole="button"
                          accessibilityLabel="Wrong email? Edit"
                          accessibilityHint="Returns to the email address field"
                          accessibilityState={{ disabled: emailBusy }}
                          testID="welcome-email-edit"
                        >
                          <Text style={styles.emailEditText}>
                            Wrong email? Edit
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <TextInput
                        value={emailCode}
                        onChangeText={(next) => {
                          setEmailCode(next.replace(/[^0-9]/g, "").slice(0, 6));
                          setEmailError(null);
                        }}
                        placeholder="123456"
                        placeholderTextColor="rgba(255,255,255,.45)"
                        keyboardType="number-pad"
                        autoComplete="one-time-code"
                        textContentType="oneTimeCode"
                        returnKeyType="done"
                        onSubmitEditing={() => void submitEmailCode()}
                        editable={!emailBusy}
                        maxLength={6}
                        style={[styles.emailInput, styles.emailCodeInput]}
                        accessibilityLabel="Six digit sign-in code"
                        testID="welcome-email-code"
                      />
                      <TouchableOpacity
                        onPress={() => void submitEmailCode()}
                        style={[
                          styles.emailSubmit,
                          emailBusy && styles.buttonDisabled,
                        ]}
                        disabled={emailBusy}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                        accessibilityLabel={
                          followInviteActive
                            ? `Verify code and follow ${followInvite!.brandName}`
                            : "Sign in with this code"
                        }
                        accessibilityState={{
                          disabled: emailBusy,
                          busy: emailBusy,
                        }}
                        testID="welcome-email-verify"
                      >
                        {emailBusy ? (
                          <ActivityIndicator size="small" color="#111827" />
                        ) : (
                          <Text
                            style={styles.emailSubmitText}
                            maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
                          >
                            {followInviteActive
                              ? "Verify and follow"
                              : "Sign in"}
                          </Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void sendEmailCode()}
                        style={styles.emailGhost}
                        disabled={emailBusy || resendIn > 0}
                        accessibilityRole="button"
                        accessibilityLabel={resendIn > 0
                          ? `Resend available in ${resendIn} seconds`
                          : "Send a new code"}
                        accessibilityState={{ disabled: emailBusy || resendIn > 0 }}
                        testID="welcome-email-resend"
                      >
                        <Text style={styles.emailGhostText}>
                          {resendIn > 0
                            ? `Send a new code in ${resendIn}s`
                            : "Send a new code"}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {emailError !== null ? (
                    <Text
                      style={styles.emailError}
                      accessibilityLiveRegion="polite"
                      testID="welcome-email-error"
                    >
                      {emailError}
                    </Text>
                  ) : null}
                </View>
              )}
            </Animated.View>
          ) : null}

          {ticketClaim &&
          !ticketClaim.expired &&
          ticketClaim.preferredProof === "phone" ? (
            <Text style={styles.claimHint} testID="welcome-ticket-phone-hint">
              {t("auth:welcome.gotItByText", {
                defaultValue: "Got it by text? Confirm your number next.",
              })}
            </Text>
          ) : ticketClaim &&
            !ticketClaim.expired &&
            ticketClaim.preferredProof === "email" ? (
            <Text style={styles.claimHint} testID="welcome-ticket-number-hint">
              {t("auth:welcome.boughtWithNumber", {
                defaultValue:
                  "Bought with your number? Use any option. You'll confirm your number next.",
              })}
            </Text>
          ) : null}

          {claimEmailFallback && emailError ? (
            <Text
              style={styles.emailError}
              accessibilityLiveRegion="polite"
              testID="welcome-claim-email-fallback-error"
            >
              {emailError}
            </Text>
          ) : null}

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
        </KeyboardAvoidingView>
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
  keyboardAvoider: { flex: 1 },
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
    justifyContent: "center",
    flexShrink: 1,
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
  authGroup: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    gap: vs(14),
  },
  hiddenAuthGroup: { display: "none" },
  claimResolving: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  claimResolvingText: {
    color: "#ffffff",
    fontSize: s(16),
    fontWeight: fontWeights.semibold,
  },
  claimCard: {
    width: "100%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: "rgba(255,255,255,.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.32)",
    gap: 4,
  },
  claimCardEyebrow: {
    color: "rgba(255,255,255,.78)",
    fontSize: s(13),
    fontWeight: fontWeights.semibold,
  },
  claimCardTitle: {
    color: "#ffffff",
    fontSize: s(19),
    lineHeight: vs(25),
    fontWeight: fontWeights.bold,
  },
  claimCardMeta: {
    color: "rgba(255,255,255,.76)",
    fontSize: s(13),
    lineHeight: vs(18),
  },
  claimCardPrompt: {
    color: "#ffffff",
    fontSize: s(14),
    lineHeight: vs(20),
    fontWeight: fontWeights.semibold,
    marginTop: spacing.xs,
  },
  claimHint: {
    color: "rgba(255,255,255,.82)",
    fontSize: s(13),
    lineHeight: vs(19),
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  claimEmailButton: {
    width: "100%",
    minHeight: vs(56),
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    ...shadows.sm,
  },
  claimEmailButtonText: {
    color: "#111827",
    fontSize: s(16),
    fontWeight: fontWeights.semibold,
  },
  buttonAnimWrapper: {
    width: "100%",
    alignItems: "center",
  },
  appleButton: {
    width: "100%",
    maxWidth: s(400),
    // #2211 — `minHeight`, NOT `height`. `vs(56)` is blind to `fontScale`,
    // so at accessibility text sizes BOTH labels cropped to "Continue wi"
    // and a 22 pt icon was the only thing separating "sign in with the
    // account tied to your phone" from "sign in with your Google account".
    minHeight: vs(56),
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
    // #2211 — explicit, so the multiplier cap governs the whole line box.
    lineHeight: 22,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  googleButton: {
    width: "100%",
    maxWidth: s(400),
    // #2211 — `minHeight`, NOT `height`. `vs(56)` is blind to `fontScale`,
    // so at accessibility text sizes BOTH labels cropped to "Continue wi"
    // and a 22 pt icon was the only thing separating "sign in with the
    // account tied to your phone" from "sign in with your Google account".
    minHeight: vs(56),
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
  // #3524 / #4063 — the email option uses the same geometry and visual weight as
  // Apple and Google so all three sign-in choices read as one coherent stack.
  emailButton: {
    width: "100%",
    maxWidth: s(400),
    minHeight: vs(56),
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
    lineHeight: 22,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  emailPanel: {
    width: "100%",
    maxWidth: s(400),
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: "rgba(0,0,0,.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.22)",
  },
  emailPanelLabel: {
    color: "rgba(255,255,255,.82)",
    fontSize: s(14),
    lineHeight: vs(20),
  },
  emailPanelHeading: {
    color: "#ffffff",
    fontSize: s(18),
    lineHeight: vs(24),
    fontWeight: fontWeights.bold,
  },
  emailInput: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: "#ffffff",
    fontSize: s(16),
    backgroundColor: "rgba(255,255,255,.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.26)",
  },
  emailCodeInput: { letterSpacing: 6, textAlign: "center" },
  emailEdit: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  emailEditText: {
    color: "rgba(255,255,255,.82)",
    fontSize: s(14),
    fontWeight: fontWeights.semibold,
    textDecorationLine: "underline",
  },
  emailSubmit: {
    width: "100%",
    maxWidth: s(400),
    minHeight: vs(56),
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    ...shadows.sm,
  },
  emailSubmitText: {
    color: colors.text.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  emailGhost: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emailGhostText: {
    color: "rgba(255,255,255,.72)",
    fontSize: s(14),
    textDecorationLine: "underline",
  },
  emailError: {
    color: "#FCA5A5",
    fontSize: s(13),
    lineHeight: vs(19),
  },
  googleButtonText: {
    color: colors.text.primary,
    fontSize: 17,
    // #2211 — explicit, so the multiplier cap governs the whole line box.
    lineHeight: 22,
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
});
