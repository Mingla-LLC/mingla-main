import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { OTPInput } from "../onboarding/OTPInput";
import {
  ClaimContactError,
  sendClaimContactCode,
  verifyClaimContactCode,
  type ClaimContactChannel,
} from "../../services/claimContactService";
import type { ClaimedEntry } from "../../services/attendanceClaimService";

type Props = {
  visible: boolean;
  onClose: () => void;
  onVerified: (result: { foundCount: number; claimed: ClaimedEntry[] }) => void;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

export function AddIdentitySheet({ visible, onClose, onVerified }: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [value, setValue] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const channel = useMemo<ClaimContactChannel>(
    () => value.includes("@") ? "email" : "phone",
    [value],
  );
  const errorCopy = (code: ClaimContactError["code"]): string => {
    switch (code) {
      case "invalid_value": return t("missing.invalidValue");
      case "already_other_account": return t("missing.alreadyOtherAccount");
      case "limit_reached": return t("missing.limitReached");
      case "rate_limited":
      case "locked": return t("missing.rateLimited");
      case "bad_code":
      case "expired": return t("missing.badCode");
      default: return t("error.body");
    }
  };

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (visible) return;
    setValue("");
    setChallengeId(null);
    setSentTo(null);
    setCode("");
    setBusy(false);
    setError(null);
    setResendIn(0);
  }, [visible]);

  const send = async (): Promise<void> => {
    const normalized = channel === "email"
      ? value.trim().toLowerCase()
      : value.replace(/[\s()-]/g, "");
    if (
      (channel === "email" && !EMAIL_SHAPE.test(normalized)) ||
      (channel === "phone" && !E164_SHAPE.test(normalized))
    ) {
      setError(errorCopy("invalid_value"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendClaimContactCode({ channel, value: normalized });
      if (result.alreadyConfirmed) {
        onVerified({ foundCount: 0, claimed: [] });
        return;
      }
      if (!result.challengeId) throw new ClaimContactError("unavailable");
      setChallengeId(result.challengeId);
      setSentTo(result.sentTo);
      setResendIn(30);
    } catch (reason) {
      setError(errorCopy(reason instanceof ClaimContactError ? reason.code : "unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (candidate = code): Promise<void> => {
    if (!challengeId || candidate.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyClaimContactCode({ challengeId, code: candidate });
      onVerified(result);
    } catch (reason) {
      setError(errorCopy(reason instanceof ClaimContactError ? reason.code : "unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseBottomSheet
      accessibilityLabel={t("missing.sheetTitle")}
      enablePanDownToClose={!busy}
      onClose={onClose}
      scrollMode="scroll"
      snapPoints={["72%"]}
      theme="light"
      visible={visible}
      wrapInRNModal
    >
      <View style={styles.body}>
        <Text style={styles.title}>
          {challengeId ? t("missing.codeTitle") : t("missing.sheetTitle")}
        </Text>
        <Text style={styles.description}>
          {challengeId
            ? t("missing.codeSentTo", { value: sentTo ?? "" })
            : t("missing.ctaHint")}
        </Text>

        {challengeId ? (
          <>
            <OTPInput
              disabled={busy}
              error={error !== null}
              length={6}
              onChange={setCode}
              onComplete={(next) => { setCode(next); void verify(next); }}
              value={code}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || resendIn > 0}
              onPress={() => { void send(); }}
              style={styles.resend}
            >
              <Text style={[styles.resendText, resendIn > 0 && styles.disabledText]}>
                {resendIn > 0
                  ? t("missing.resendIn", { seconds: resendIn })
                  : t("missing.resend")}
              </Text>
            </Pressable>
          </>
        ) : (
          <BottomSheetTextInput
            accessibilityLabel={t("missing.fieldPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            keyboardType={channel === "email" ? "email-address" : "email-address"}
            onChangeText={setValue}
            placeholder={t("missing.fieldPlaceholder")}
            placeholderTextColor="#8b8f96"
            style={styles.input}
            value={value}
          />
        )}

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => { void (challengeId ? verify() : send()); }}
          style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.primaryText}>
              {challengeId ? t("missing.verify") : t("missing.sendCode")}
            </Text>
          )}
        </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 36 },
  title: { color: "#17191e", fontSize: 24, fontWeight: "800" },
  description: { color: "#60656e", fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 24 },
  input: { minHeight: 54, borderRadius: 15, borderWidth: 1, borderColor: "#d8dbe0", backgroundColor: "#fff", color: "#17191e", fontSize: 16, paddingHorizontal: 16 },
  primary: { minHeight: 52, borderRadius: 15, backgroundColor: "#eb7825", alignItems: "center", justifyContent: "center", marginTop: 20 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.65 },
  error: { color: "#b42318", fontSize: 13, lineHeight: 18, marginTop: 13 },
  resend: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: 12 },
  resendText: { color: "#eb7825", fontSize: 14, fontWeight: "700" },
  disabledText: { color: "#8b8f96" },
});
