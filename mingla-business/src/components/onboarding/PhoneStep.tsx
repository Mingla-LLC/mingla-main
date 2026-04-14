import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Keyboard,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { supabase } from "../../services/supabase";
import { extractFunctionError } from "../../utils/extractFunctionError";
import WizardChrome from "./WizardChrome";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  shadows,
  surface,
  border,
} from "../../constants/designSystem";

interface PhoneStepProps {
  onContinue: (phone: string) => void;
  onBack: () => void;
}

type Phase = "phone" | "otp";
type Channel = "sms" | "whatsapp" | "call";

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export default function PhoneStep({
  onContinue,
  onBack,
}: PhoneStepProps): React.JSX.Element {
  const { t } = useTranslation(["onboarding", "common"]);
  const [phase, setPhase] = useState<Phase>("phone");
  const [countryCode, setCountryCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const otpInputRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, "")}`;
  const phoneValid = E164_REGEX.test(fullPhone);

  const startCountdown = (): void => {
    setCountdown(30);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const animateIn = (): void => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const sendOtp = async (channel: Channel = "sms"): Promise<void> => {
    if (!phoneValid) {
      setError(t("onboarding:phone.invalid_phone"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("send-otp", {
        body: { phone: fullPhone, channel },
      });
      if (fnError) {
        const msg = await extractFunctionError(
          fnError,
          t("onboarding:phone.send_failed")
        );
        throw new Error(msg);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase("otp");
      setOtp("");
      startCountdown();
      animateIn();
      // Focus OTP input after transition
      setTimeout(() => otpInputRef.current?.focus(), 400);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : t("onboarding:phone.send_failed");
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async (code: string): Promise<void> => {
    if (code.length !== 6) return;
    Keyboard.dismiss();
    setVerifying(true);
    setError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { phone: fullPhone, code },
      });
      if (fnError) {
        const msg = await extractFunctionError(
          fnError,
          t("onboarding:phone.verify_failed")
        );
        throw new Error(msg);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onContinue(fullPhone);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : t("onboarding:phone.verify_failed");
      setError(msg);
      setOtp("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      otpInputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleOtpChange = (value: string): void => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setOtp(cleaned);
    if (cleaned.length === 6) {
      verifyOtp(cleaned);
    }
  };

  return (
    <WizardChrome
      currentStep={3}
      totalSteps={4}
      onBack={
        phase === "otp"
          ? () => {
              setPhase("phone");
              setOtp("");
              setError(null);
            }
          : onBack
      }
      onContinue={() => sendOtp("sms")}
      continueLabel={
        phase === "phone" ? t("onboarding:phone.send_code") : " "
      }
      continueDisabled={phase === "phone" ? !phoneValid || sending : true}
      continueLoading={sending}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {phase === "phone" && (
          <Animated.View>
            <Text style={styles.title}>{t("onboarding:phone.title")}</Text>
            <Text style={styles.subtitle}>
              {t("onboarding:phone.subtitle")}
            </Text>

            <View style={styles.phoneRow}>
              <TouchableOpacity style={styles.countryButton} activeOpacity={0.7}>
                <Text style={styles.countryText}>{countryCode}</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.phoneInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder={t("onboarding:phone.placeholder")}
                placeholderTextColor={colors.text.tertiary}
                keyboardType="phone-pad"
                autoComplete="tel"
                maxLength={15}
                autoFocus
                accessibilityLabel={t("onboarding:phone.placeholder")}
              />
            </View>

            <Text style={styles.consent}>
              {t("onboarding:phone.consent")}
            </Text>
          </Animated.View>
        )}

        {phase === "otp" && (
          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.title}>
              {t("onboarding:phone.otp_title")}
            </Text>
            <Text style={styles.subtitle}>
              {t("onboarding:phone.otp_subtitle", { phone: fullPhone })}
            </Text>

            {/* Single hidden input for OTP — renders as visual boxes */}
            <View style={styles.otpContainer}>
              <View style={styles.otpBoxes}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const digit = otp[i] ?? "";
                  const isFocused = i === otp.length && !verifying;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.otpBox,
                        digit ? styles.otpBoxFilled : null,
                        isFocused ? styles.otpBoxFocused : null,
                      ]}
                    >
                      <Text style={styles.otpDigit}>{digit}</Text>
                    </View>
                  );
                })}
              </View>
              <TextInput
                ref={otpInputRef}
                style={styles.otpHiddenInput}
                value={otp}
                onChangeText={handleOtpChange}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                caretHidden
                accessibilityLabel="Verification code"
              />
            </View>

            {verifying && (
              <View style={styles.verifyingRow}>
                <ActivityIndicator size="small" color={colors.primary[500]} />
                <Text style={styles.verifyingText}>Verifying...</Text>
              </View>
            )}

            <View style={styles.fallbacks}>
              <TouchableOpacity
                onPress={() => sendOtp("sms")}
                disabled={countdown > 0}
                style={styles.fallbackButton}
              >
                <Text
                  style={[
                    styles.fallbackText,
                    countdown > 0 && styles.fallbackDisabled,
                  ]}
                >
                  {countdown > 0
                    ? t("onboarding:phone.resend_countdown", {
                        seconds: countdown,
                      })
                    : t("onboarding:phone.resend")}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.altChannels}>
              <TouchableOpacity
                onPress={() => sendOtp("whatsapp")}
                style={styles.channelPill}
              >
                <Text style={styles.channelText}>
                  {t("onboarding:phone.try_whatsapp")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => sendOtp("call")}
                style={styles.channelPill}
              >
                <Text style={styles.channelText}>
                  {t("onboarding:phone.try_call")}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => {
                setPhase("phone");
                setOtp("");
                setError(null);
              }}
              style={styles.changeNumberButton}
            >
              <Text style={styles.changeNumberText}>
                {t("onboarding:phone.change_number")}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </WizardChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginBottom: spacing.xl,
  },
  phoneRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  countryButton: {
    width: 72,
    height: 52,
    backgroundColor: surface.input,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  countryText: {
    fontSize: 18,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  phoneInput: {
    flex: 1,
    height: 52,
    backgroundColor: surface.input,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 18,
    color: colors.text.primary,
    letterSpacing: 0.5,
  },
  consent: {
    fontSize: 12,
    color: colors.text.tertiary,
    lineHeight: 18,
  },
  otpContainer: {
    position: "relative",
    marginBottom: spacing.lg,
  },
  otpBoxes: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  otpBox: {
    width: 48,
    height: 58,
    backgroundColor: surface.input,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  otpBoxFilled: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
    ...shadows.sm,
  },
  otpBoxFocused: {
    borderColor: colors.primary[500],
    borderWidth: 2,
  },
  otpDigit: {
    fontSize: 26,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  otpHiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    fontSize: 1,
  },
  verifyingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  verifyingText: {
    fontSize: 14,
    color: colors.text.tertiary,
  },
  fallbacks: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  fallbackButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  fallbackText: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
  },
  fallbackDisabled: {
    color: colors.text.tertiary,
    fontWeight: fontWeights.regular,
  },
  altChannels: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  channelPill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.gray[100],
    borderRadius: radius.full,
  },
  channelText: {
    fontSize: 13,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  changeNumberButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  changeNumberText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  errorContainer: {
    backgroundColor: "#fef2f2",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    fontSize: 14,
    color: colors.error[500],
    textAlign: "center",
  },
});
