/**
 * #3682 Wave 2.5 — signed-out web Follow sheet (design contract surface m).
 * Always shows "Check your email to finish following" after a successful send
 * (no account-existence leak). Uses Modal (not gorhom).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { accent, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 30;

export type FollowByEmailSheetProps = {
  visible: boolean;
  brandId: string;
  brandName: string;
  onClose: () => void;
  /** Session Pending state on the brand Follow control. */
  onSent: (email: string) => void;
  testID?: string;
};

type Phase = "idle" | "invalid" | "sending" | "sent" | "rate_limited" | "error";

export const FollowByEmailSheet: React.FC<FollowByEmailSheetProps> = ({
  visible,
  brandId,
  brandName,
  onClose,
  onSent,
  testID = "follow-by-email-sheet",
}) => {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [rateRetryIn, setRateRetryIn] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const draftRef = useRef("");

  useEffect(() => {
    if (!visible) return;
    setPhase("idle");
    setErrorMessage(null);
    setEmail(draftRef.current);
    setResendIn(0);
    // Desktop autofocus only (contract: not on phones).
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      if (wide) {
        const t = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(t);
      }
    }
  }, [visible]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  useEffect(() => {
    if (rateRetryIn <= 0) return;
    const id = setInterval(
      () => setRateRetryIn((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [rateRetryIn]);

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setPhase("invalid");
      setErrorMessage("Enter a full email address, like name@example.com.");
      inputRef.current?.focus();
      return;
    }
    setPhase("sending");
    setErrorMessage(null);
    draftRef.current = trimmed;
    try {
      const { data, error } = await supabase.functions.invoke(
        "public-follow-request",
        { body: { brandId, email: trimmed } },
      );
      if (error) {
        const status = (error as { context?: { status?: number } }).context
          ?.status;
        if (status === 429) {
          setPhase("rate_limited");
          setErrorMessage(
            "Too many tries from this device. Wait a few minutes and try again.",
          );
          setRateRetryIn(5 * 60);
          return;
        }
        if (status === 400) {
          setPhase("invalid");
          setErrorMessage(
            (data as { message?: string } | null)?.message ??
              "Enter a full email address, like name@example.com.",
          );
          return;
        }
        setPhase("error");
        setErrorMessage(
          "We couldn't send that. Check your connection and try again.",
        );
        return;
      }
      setPhase("sent");
      setResendIn(RESEND_SECONDS);
      onSent(trimmed);
    } catch {
      setPhase("error");
      setErrorMessage(
        "We couldn't send that. Check your connection and try again.",
      );
    }
  }, [brandId, email, onSent]);

  const title =
    phase === "sent"
      ? "Check your email"
      : `Follow ${brandName}`;
  const body =
    phase === "sent"
      ? `Check your email to finish following ${brandName}.`
      : "Get new dates and offers. We'll email you a link to confirm.";

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      maxWidth={440}
      testID={testID}
    >
      <View style={styles.container}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text
          style={styles.body}
          accessibilityLiveRegion={phase === "sent" ? "polite" : undefined}
        >
          {body}
        </Text>

        {phase === "sent" ? (
          <>
            <Text style={styles.sentTo}>
              Sent to <Text style={styles.sentEmail}>{draftRef.current}</Text>
            </Text>
            <Button
              label="Done"
              onPress={onClose}
              variant="primary"
              accentColor={accent.warm}
              size="lg"
              fullWidth
            />
            <View style={styles.rowLinks}>
              <Pressable
                onPress={() => {
                  setPhase("idle");
                  setEmail("");
                  draftRef.current = "";
                }}
                accessibilityRole="button"
                accessibilityLabel="Use a different email"
              >
                <Text style={styles.link}>Use a different email</Text>
              </Pressable>
              <Pressable
                disabled={resendIn > 0}
                onPress={() => {
                  void submit();
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  resendIn > 0
                    ? `Send again in ${resendIn} seconds`
                    : "Send again"
                }
              >
                <Text style={[styles.link, resendIn > 0 && styles.linkMuted]}>
                  {resendIn > 0
                    ? `Send again in ${resendIn}s`
                    : "Send again"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              ref={inputRef}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (phase === "invalid") setPhase("idle");
              }}
              placeholder="you@example.com"
              placeholderTextColor={textTokens.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              editable={phase !== "sending"}
              style={[
                styles.input,
                phase === "invalid" && styles.inputInvalid,
              ]}
              accessibilityLabel="Email"
              accessibilityHint={
                phase === "invalid"
                  ? "Enter a full email address, like name@example.com."
                  : undefined
              }
              testID={`${testID}-email`}
            />
            {errorMessage !== null ? (
              <Text
                nativeID={`${testID}-error`}
                style={
                  phase === "rate_limited" || phase === "error"
                    ? styles.notice
                    : styles.error
                }
                accessibilityLiveRegion="polite"
              >
                {errorMessage}
              </Text>
            ) : null}
            <View style={styles.cta}>
              {phase === "sending" ? (
                <View style={styles.sending}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.sendingLabel}>Sending…</Text>
                </View>
              ) : phase === "rate_limited" ? (
                <Button
                  label={
                    rateRetryIn > 0
                      ? `Try again in ${formatMmSs(rateRetryIn)}`
                      : "Try again"
                  }
                  onPress={() => {
                    if (rateRetryIn > 0) return;
                    void submit();
                  }}
                  disabled={rateRetryIn > 0}
                  variant="primary"
                  accentColor={accent.warm}
                  size="lg"
                  fullWidth
                />
              ) : (
                <Button
                  label={phase === "error" ? "Try again" : "Continue"}
                  onPress={() => {
                    void submit();
                  }}
                  variant="primary"
                  accentColor={accent.warm}
                  size="lg"
                  fullWidth
                  testID={`${testID}-continue`}
                />
              )}
            </View>
            <Text style={styles.fine}>
              {"By continuing you agree to Mingla's Terms and Privacy Policy. Unfollow anytime."}
            </Text>
          </>
        )}
      </View>
    </Modal>
  );
};

function formatMmSs(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: { width: "100%" },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: textTokens.primary,
    marginBottom: 6,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#888a8f",
    paddingHorizontal: 14,
    fontSize: 16,
    lineHeight: 22,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  inputInvalid: {
    borderColor: "#b42318",
    borderWidth: 2,
  },
  error: {
    color: "#b42318",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  notice: {
    backgroundColor: "#fffaeb",
    borderColor: "#f5d38a",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    color: "#93370d",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  cta: { marginTop: 4 },
  sending: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  sendingLabel: { color: "#fff", fontWeight: "700", fontSize: 16 },
  fine: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  sentTo: {
    fontSize: 15,
    lineHeight: 22,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  sentEmail: { fontWeight: "700", color: textTokens.primary },
  rowLinks: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  link: {
    fontSize: 14,
    color: accent.warm,
    textDecorationLine: "underline",
  },
  linkMuted: { color: textTokens.tertiary },
});
