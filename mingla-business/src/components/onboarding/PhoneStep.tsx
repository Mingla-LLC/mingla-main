import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../services/supabase";
import { extractFunctionError } from "../../utils/extractFunctionError";
import WizardChrome from "./WizardChrome";
import { colors, spacing, radius, fontWeights, surface, border } from "../../constants/designSystem";

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
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const sendOtp = async (channel: Channel = "sms"): Promise<void> => {
    if (!phoneValid) {
      setError(t("onboarding:phone.invalid_phone"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "send-otp",
        { body: { phone: fullPhone, channel } }
      );
      if (fnError) {
        const msg = await extractFunctionError(fnError, t("onboarding:phone.send_failed"));
        throw new Error(msg);
      }
      setPhase("otp");
      startCountdown();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("onboarding:phone.send_failed");
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async (code: string): Promise<void> => {
    setVerifying(true);
    setError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { phone: fullPhone, code },
      });
      if (fnError) {
        const msg = await extractFunctionError(fnError, t("onboarding:phone.verify_failed"));
        throw new Error(msg);
      }
      onContinue(fullPhone);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("onboarding:phone.verify_failed");
      setError(msg);
      setOtpDigits(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleOtpChange = (index: number, value: string): void => {
    if (value.length > 1) {
      // Handle paste of full code
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const newDigits = [...otpDigits];
      digits.forEach((d, i) => {
        if (i + index < 6) newDigits[i + index] = d;
      });
      setOtpDigits(newDigits);
      const nextEmpty = newDigits.findIndex((d) => d === "");
      if (nextEmpty === -1) {
        verifyOtp(newDigits.join(""));
      } else {
        otpRefs.current[nextEmpty]?.focus();
      }
      return;
    }

    const newDigits = [...otpDigits];
    newDigits[index] = value.replace(/\D/g, "");
    setOtpDigits(newDigits);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    const code = newDigits.join("");
    if (code.length === 6 && !newDigits.includes("")) {
      verifyOtp(code);
    }
  };

  const handleOtpKeyPress = (index: number, key: string): void => {
    if (key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const continueAction =
    phase === "phone" ? () => sendOtp("sms") : () => {};

  return (
    <WizardChrome
      currentStep={3}
      totalSteps={4}
      onBack={phase === "otp" ? () => setPhase("phone") : onBack}
      onContinue={continueAction}
      continueLabel={phase === "phone" ? t("onboarding:phone.send_code") : t("onboarding:phone.verify_failed") + "..."}
      continueDisabled={phase === "phone" ? !phoneValid || sending : true}
      continueLoading={sending}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          {phase === "phone" ? t("onboarding:phone.title") : t("onboarding:phone.otp_title")}
        </Text>
        <Text style={styles.subtitle}>
          {phase === "phone"
            ? t("onboarding:phone.subtitle")
            : t("onboarding:phone.otp_subtitle", { phone: fullPhone })}
        </Text>

        {phase === "phone" && (
          <>
            <View style={styles.phoneRow}>
              <TextInput
                style={styles.countryInput}
                value={countryCode}
                onChangeText={setCountryCode}
                keyboardType="phone-pad"
                maxLength={4}
                accessibilityLabel="Country code"
              />
              <TextInput
                style={styles.phoneInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder={t("onboarding:phone.placeholder")}
                placeholderTextColor={colors.text.tertiary}
                keyboardType="phone-pad"
                autoComplete="tel"
                maxLength={15}
                accessibilityLabel="Phone number"
              />
            </View>

            <Text style={styles.consent}>
              {t("onboarding:phone.consent")}
            </Text>
          </>
        )}

        {phase === "otp" && (
          <>
            <View style={styles.otpRow}>
              {otpDigits.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(ref) => {
                    otpRefs.current[i] = ref;
                  }}
                  style={[styles.otpBox, digit && styles.otpBoxFilled]}
                  value={digit}
                  onChangeText={(v) => handleOtpChange(i, v)}
                  onKeyPress={({ nativeEvent }) =>
                    handleOtpKeyPress(i, nativeEvent.key)
                  }
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  accessibilityLabel={`Digit ${i + 1} of verification code`}
                />
              ))}
            </View>

            {verifying && (
              <ActivityIndicator
                size="small"
                color={colors.primary[500]}
                style={styles.verifySpinner}
              />
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
                  {countdown > 0 ? t("onboarding:phone.resend_countdown", { seconds: countdown }) : t("onboarding:phone.resend")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => sendOtp("whatsapp")}
                style={styles.fallbackButton}
              >
                <Text style={styles.fallbackText}>{t("onboarding:phone.try_whatsapp")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => sendOtp("call")}
                style={styles.fallbackButton}
              >
                <Text style={styles.fallbackText}>{t("onboarding:phone.try_call")}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => {
                setPhase("phone");
                setOtpDigits(["", "", "", "", "", ""]);
                setError(null);
              }}
            >
              <Text style={styles.changeNumber}>{t("onboarding:phone.change_number")}</Text>
            </TouchableOpacity>
          </>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
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
    marginBottom: spacing.lg,
  },
  phoneRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  countryInput: {
    width: 72,
    height: 48,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
    textAlign: "center",
  },
  phoneInput: {
    flex: 1,
    height: 48,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
  },
  consent: {
    fontSize: 12,
    color: colors.text.tertiary,
    lineHeight: 18,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: spacing.lg,
  },
  otpBox: {
    width: 48,
    height: 56,
    backgroundColor: surface.input,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.md,
    textAlign: "center",
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  otpBoxFilled: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  verifySpinner: {
    marginBottom: spacing.md,
  },
  fallbacks: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  fallbackButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  fallbackText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  fallbackDisabled: {
    color: colors.text.tertiary,
  },
  changeNumber: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    color: colors.error[500],
    textAlign: "center",
    marginTop: spacing.md,
  },
});
