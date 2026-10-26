/**
 * #4111 — the brand page foot (D1 / D10), under the active pane on every tab
 * of the shared PublicBrandPage, phone and desktop alike.
 *
 *   "Stay in the loop"  signed-out WEB visitors only (the host passes `loop`).
 *                       Email, Mobile (optional), "Also text me" (only once a
 *                       mobile is entered), Subscribe, consent line; then the
 *                       "Check your email" state with "Use a different email".
 *   "Questions?"        every surface, when the brand takes enquiries (the
 *                       host passes `message`). "Usually replies within …" only
 *                       when the server returned a reply time.
 *
 * Pure presentational, brand-themed. It sits in normal page flow, so it needs
 * no privacy-bar inset (#2331).
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check } from "lucide-react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";

import type { EnquiryPhoneFieldArgs, EnquiryPhoneState } from "./BrandMessageSheet";
import { replyTimeLabel } from "./replyTime";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StayInLoopRequest {
  email: string;
  phoneE164: string | null;
  wantsSms: boolean;
  hp: string;
  t0: number;
}

export interface BrandPageFootLoop {
  /** idle → sending → sent; error keeps the form with a message. */
  state: "idle" | "sending" | "sent" | "error";
  /** The address shown in "Check your email". */
  sentTo: string | null;
  /** Whether a text link was also requested. */
  sentSms: boolean;
  errorMessage: string | null;
  onSubmit: (request: StayInLoopRequest) => void;
  /** "Use a different email". */
  onReset: () => void;
  renderPhoneField?: (args: EnquiryPhoneFieldArgs) => React.ReactElement;
}

export interface BrandPageFootMessage {
  onPress: () => void;
  /** From `brand_enquiry_public_profile.reply_minutes`; null hides the line. */
  replyMinutes: number | null;
}

export interface BrandPageFootProps {
  brandName: string;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** Signed-out web only (D1). Absent → no box. */
  loop?: BrandPageFootLoop;
  /** Absent → no Message card (enquiries off / no team / not loaded yet). */
  message?: BrandPageFootMessage;
  testID?: string;
}

export interface BrandPageFootHandle {
  /** Signed-out web Follow: bring the box into view and focus Email. */
  focusEmail: () => void;
}

const scrollNodeIntoView = (node: unknown): void => {
  if (node === null || typeof node !== "object") return;
  if (!("scrollIntoView" in node)) return;
  const scroll = (node as { scrollIntoView: unknown }).scrollIntoView;
  if (typeof scroll === "function") {
    scroll.call(node, { behavior: "smooth", block: "center" });
  }
};

export const BrandPageFoot = forwardRef<BrandPageFootHandle, BrandPageFootProps>(function BrandPageFoot(
  { brandName, palette, theme, loop, message, testID = "brand-page-foot" }: BrandPageFootProps,
  ref: React.ForwardedRef<BrandPageFootHandle>,
) {
  const emailRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<EnquiryPhoneState>({ e164: null, isEmpty: true, valid: false });
  const [wantsSms, setWantsSms] = useState(false);
  const [hp, setHp] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const openedAt = useRef<number>(Date.now());
  const themedFont = { fontFamily: theme.fontFamilyValue };

  useImperativeHandle(
    ref,
    () => ({
      focusEmail: () => {
        const node = emailRef.current;
        scrollNodeIntoView(node);
        node?.focus();
      },
    }),
    [],
  );

  const smsAllowed = !phone.isEmpty && phone.valid;
  const submit = useCallback((): void => {
    if (loop === undefined || loop.state === "sending") return;
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError("Enter a full email address, like name@example.com.");
      emailRef.current?.focus();
      return;
    }
    if (!phone.isEmpty && !phone.valid) return;
    setEmailError(null);
    loop.onSubmit({
      email: trimmed,
      phoneE164: phone.valid ? phone.e164 : null,
      wantsSms: smsAllowed && wantsSms,
      hp,
      t0: openedAt.current,
    });
  }, [email, hp, loop, phone, smsAllowed, wantsSms]);

  const replyLine = message === undefined ? null : replyTimeLabel(message.replyMinutes);

  if (loop === undefined && message === undefined) return null;

  return (
    <View style={styles.wrap} testID={testID}>
      {loop !== undefined ? (
        <View
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          testID={`${testID}-loop`}
        >
          {loop.state === "sent" ? (
            <View style={styles.sentBody} testID={`${testID}-loop-sent`}>
              <View style={[styles.okIcon, { backgroundColor: palette.accentWash }]}>
                <Check size={20} color={palette.accent} />
              </View>
              <Text style={[styles.title, themedFont, { color: palette.primaryText }]} accessibilityRole="header">
                Check your email
              </Text>
              <Text style={[styles.sub, { color: palette.secondaryText }]} accessibilityLiveRegion="polite">
                {loop.sentTo !== null
                  ? `We sent a link to ${loop.sentTo}.${loop.sentSms ? " We also texted you a link to switch on texts." : ""}`
                  : "We sent you a link."}
              </Text>
              <Pressable
                onPress={() => {
                  setEmail("");
                  loop.onReset();
                  setTimeout(() => emailRef.current?.focus(), 0);
                }}
                accessibilityRole="button"
                accessibilityLabel="Use a different email"
                testID={`${testID}-loop-reset`}
                style={({ pressed }) => [styles.ghostBtn, { borderColor: palette.panelBorder }, pressed && styles.pressed]}
              >
                <Text style={[styles.ghostLabel, { color: palette.primaryText }]}>Use a different email</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={[styles.title, themedFont, { color: palette.primaryText }]} accessibilityRole="header">
                Stay in the loop
              </Text>
              <Text style={[styles.sub, { color: palette.secondaryText }]}>
                {`New dates and offers from ${brandName}.`}
              </Text>
              <TextInput
                ref={emailRef}
                value={email}
                onChangeText={(next: string) => {
                  setEmail(next);
                  if (emailError !== null) setEmailError(null);
                }}
                onSubmitEditing={submit}
                placeholder="Email"
                placeholderTextColor={palette.tertiaryText}
                accessibilityLabel="Email"
                keyboardType="email-address"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={254}
                testID={`${testID}-loop-email`}
                style={[
                  styles.input,
                  {
                    color: palette.primaryText,
                    backgroundColor: palette.page,
                    borderColor: emailError !== null ? "#ef4444" : palette.panelBorder,
                  },
                ]}
              />
              {emailError !== null ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {emailError}
                </Text>
              ) : null}
              {loop.renderPhoneField !== undefined
                ? loop.renderPhoneField({
                    testID: `${testID}-loop-phone`,
                    accessibilityLabel: "Mobile (optional)",
                    placeholder: "Mobile (optional)",
                    palette,
                    onChange: (next: EnquiryPhoneState) => {
                      setPhone(next);
                      if (next.isEmpty || !next.valid) setWantsSms(false);
                    },
                  })
                : null}
              {loop.renderPhoneField !== undefined ? (
                <Pressable
                  onPress={() => {
                    if (smsAllowed) setWantsSms((v: boolean) => !v);
                  }}
                  disabled={!smsAllowed}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: wantsSms, disabled: !smsAllowed }}
                  accessibilityLabel="Also text me. Msg & data rates may apply. Reply STOP to stop."
                  testID={`${testID}-loop-sms`}
                  style={[styles.checkRow, !smsAllowed && styles.dim]}
                >
                  <View
                    style={[
                      styles.checkBox,
                      { borderColor: wantsSms ? palette.accent : palette.panelBorder },
                      wantsSms && { backgroundColor: palette.accent },
                    ]}
                  >
                    {wantsSms ? <Check size={14} color={palette.accentText} /> : null}
                  </View>
                  <Text style={[styles.checkLabel, { color: palette.secondaryText }]}>
                    Also text me. Msg &amp; data rates may apply. Reply STOP to stop.
                  </Text>
                </Pressable>
              ) : null}
              <TextInput
                value={hp}
                onChangeText={setHp}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                autoComplete="off"
                testID={`${testID}-loop-hp`}
                style={styles.honeypot}
              />
              {loop.errorMessage !== null && loop.state === "error" ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite" testID={`${testID}-loop-error`}>
                  {loop.errorMessage}
                </Text>
              ) : null}
              <Pressable
                onPress={submit}
                disabled={loop.state === "sending"}
                accessibilityRole="button"
                accessibilityLabel="Subscribe"
                accessibilityState={{ busy: loop.state === "sending" }}
                testID={`${testID}-loop-submit`}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: palette.accent },
                  loop.state === "sending" && styles.dim,
                  pressed && styles.pressed,
                ]}
              >
                {loop.state === "sending" ? (
                  <ActivityIndicator color={palette.accentText} />
                ) : (
                  <Text style={[styles.primaryLabel, { color: palette.accentText }]}>Subscribe</Text>
                )}
              </Pressable>
              <Text style={[styles.consent, { color: palette.tertiaryText }]}>
                {`By subscribing you agree to get marketing from ${brandName} via Mingla. Unsubscribe any time.`}
              </Text>
            </View>
          )}
        </View>
      ) : null}
      {message !== undefined ? (
        <View
          style={[styles.card, styles.messageCard, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          testID={`${testID}-message`}
        >
          <View style={styles.messageCopy}>
            <Text style={[styles.messageTitle, themedFont, { color: palette.primaryText }]}>Questions?</Text>
            {replyLine !== null ? (
              <Text style={[styles.messageSub, { color: palette.tertiaryText }]} testID={`${testID}-reply-time`}>
                {replyLine}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={message.onPress}
            accessibilityRole="button"
            accessibilityLabel={`Message ${brandName}`}
            testID={`${testID}-message-button`}
            style={({ pressed }) => [styles.lineBtn, { borderColor: palette.accent }, pressed && styles.pressed]}
          >
            <Text numberOfLines={2} style={[styles.lineLabel, { color: palette.primaryText }]}>
              {`Message ${brandName}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

export default BrandPageFoot;

const styles = StyleSheet.create({
  wrap: { gap: 12, marginTop: 24 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16 },
  form: { gap: 10 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  sub: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  errorText: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  honeypot: { position: "absolute", left: -10000, top: 0, width: 1, height: 1, opacity: 0 },
  primaryBtn: { minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 16, lineHeight: 21, fontWeight: "700" },
  consent: { fontSize: 11.5, lineHeight: 16 },
  sentBody: { gap: 8, alignItems: "flex-start" },
  okIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  ghostBtn: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  ghostLabel: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  messageCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  messageCopy: { flex: 1, minWidth: 0 },
  messageTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  messageSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  lineBtn: {
    minHeight: 44,
    maxWidth: "58%",
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  lineLabel: { fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "center" },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
