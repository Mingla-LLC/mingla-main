/**
 * issue #4508 1.16-1.21 — "{Inviter} saved you a spot".
 *
 * Opened from the guest's text link (usemingla.com/c/<code>, the app scheme
 * or the OneLink after install). Shows the event, the friendship sentence
 * before the tap (1.21), and claims the pass:
 *   - signed in with the invited number already proved → one tap;
 *   - signed in otherwise → confirm the invited number with a code
 *     (send-otp / verify-otp), give a name, then claim;
 *   - signed out → sign in or create an account first (the code is held
 *     through install and onboarding, then this screen reopens).
 * "This isn't me" releases the spot. Every claim outcome has a designed state
 * with a way forward.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone.mjs";
import type { PhoneInputTheme } from "@mingla/phone-input";

import {
  PROGRAM_COLORS,
  ProgramButton,
  ProgramCard,
  ProgramField,
  ProgramLoadError,
  ProgramLoading,
  ProgramNotice,
  ProgramScreen,
} from "../programs/ProgramUi";
import { PhoneInput } from "../onboarding/PhoneInput";
import { useAppStore } from "../../store/appStore";
import { sendOtp, verifyOtp, type OtpChannel } from "../../services/otpService";
import {
  phoneStepSendChannel,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  withRefusedChannel,
} from "../../utils/edgeFunctionError";
import { mixpanelService } from "../../services/mixpanelService";
import { logger } from "../../utils/logger";
import {
  claimRsvpGuestLink,
  releaseRsvpGuestLink,
  resolveRsvpGuestLink,
} from "../../services/rsvpGuestLinkService";
import { fetchRsvpPartyPasses } from "../../services/rsvpDeckService";
import { setPendingRsvpGuest, clearPendingRsvpGuest } from "../../services/pendingRsvpGuest";
import { openShellDestination } from "../../services/deepLinkService";
import { KEYBOARD_SCROLL_BOTTOM_OFFSET } from "../../wrappers/keyboardConstants";
import {
  claimOutcomeScreen,
  formatGuestEventWhen,
  friendshipSentence,
  inAppEventPath,
  inviteMode,
  releaseOutcomeMessage,
  resolvedInfoScreen,
  type RsvpGuestResolved,
  type RsvpGuestScreen,
} from "../../utils/rsvpGuestClaim";

type Phase =
  | { kind: "loading" }
  | { kind: "load_error"; rateLimited: boolean }
  | { kind: "ready"; resolved: RsvpGuestResolved; screen: RsvpGuestScreen | null }
  | { kind: "released"; title: string; body: string };

const C = PROGRAM_COLORS;
// #4561 copy (approved on the issue; this screen keeps its strings inline).
const SMS_REFUSED_TEXT = "We can't text this number.";
const ALL_REFUSED_TEXT =
  "We couldn't reach this number by text or call. Try a different number, or email us and we'll help.";
const CALL_CODE_PROMPT = "Enter the 6-digit code we're calling you with.";
// The dark program surface for the shared phone field.
// #4508 R2 / round 8: room under the focused number field for the whole
// "Text me a code" button above the Done bar. On a device the floating Done
// pill stands taller than the flat bar KEYBOARD_SCROLL_BOTTOM_OFFSET assumes
// (round 7: the button sat half under it), so the room is the button's own
// gap and height, breathing room under it, and the pill's extra margin.
const CLAIM_BUTTON_GAP = 14;
const CLAIM_BUTTON_HEIGHT = 50;
const CLAIM_BUTTON_BREATHING = 12;
const FLOATING_DONE_PILL_MARGIN = 24;
const CLAIM_FIELD_BOTTOM_OFFSET = KEYBOARD_SCROLL_BOTTOM_OFFSET + CLAIM_BUTTON_GAP +
  CLAIM_BUTTON_HEIGHT + CLAIM_BUTTON_BREATHING + FLOATING_DONE_PILL_MARGIN;

const PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#141414",
  fieldBackground: C.field,
  textPrimary: C.text,
  textTertiary: C.faint,
  borderDefault: C.border,
  borderFocused: C.accent,
  borderError: C.danger,
  searchBackground: C.field,
  rowPressedBackground: C.accentSoft,
  divider: C.border,
  accessoryBackground: "#141414",
  accessoryBorder: C.border,
  accent: C.accent,
  errorText: C.danger,
};

export function RsvpGuestClaimScreen({ code }: { code: string }): React.ReactElement {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const signedIn = user !== null;

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [busy, setBusy] = useState<"claim" | "release" | "send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile?.display_name?.trim() ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  // #4561: channels refused for the typed number, and how the code went out.
  const [refused, setRefused] = useState<{ number: string; channels: OtpChannel[] }>({ number: "", channels: [] });
  const [sentChannel, setSentChannel] = useState<OtpChannel>("sms");
  const [otp, setOtp] = useState("");
  const [pass, setPass] = useState<{ qr: string; name: string } | null>(null);
  const [passError, setPassError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (name.trim().length === 0 && profile?.display_name) setName(profile.display_name.trim());
    // Only seed once the profile arrives; typing wins afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.display_name]);

  const load = useCallback(async (): Promise<void> => {
    setPhase({ kind: "loading" });
    setError(null);
    try {
      const resolved = await resolveRsvpGuestLink(code);
      if (!mounted.current) return;
      setPhase({ kind: "ready", resolved, screen: resolvedInfoScreen(resolved) });
    } catch (e) {
      if (!mounted.current) return;
      setPhase({ kind: "load_error", rateLimited: e instanceof Error && e.message === "rate_limited" });
    }
  }, [code]);

  // Re-resolve when the account changes: viewerCanClaim depends on who is looking.
  useEffect(() => { void load(); }, [load, user?.id]);

  const resolved = phase.kind === "ready" ? phase.resolved : null;
  const inviterFirst = resolved?.inviterFirstName ?? resolved?.inviterName ?? "Your friend";
  const screen = phase.kind === "ready" ? phase.screen : null;

  // The claimed guest's own QR (1.20).
  useEffect(() => {
    if (screen?.kind !== "claimed" || resolved?.rsvpId == null || !signedIn) return;
    let cancelled = false;
    setPassError(false);
    fetchRsvpPartyPasses(resolved.rsvpId).then(
      (rows) => {
        if (cancelled) return;
        const own = rows.find((r) => r.entityType === "guest" && r.entityId === resolved.guestId) ??
          rows.find((r) => r.entityType === "guest") ?? null;
        if (own !== null && own.qrCode !== null) setPass({ qr: own.qrCode, name: own.displayName });
        else setPassError(true);
      },
      () => { if (!cancelled) setPassError(true); },
    );
    return () => { cancelled = true; };
  }, [screen?.kind, resolved?.rsvpId, resolved?.guestId, signedIn]);

  const goHome = useCallback((): void => {
    void clearPendingRsvpGuest();
    if (!openShellDestination({ kind: "page", page: "home" })) router.replace("/" as never);
  }, [router]);
  const eventPath = inAppEventPath(resolved?.event?.eventUrl ?? null);
  const goEvent = useCallback((): void => {
    if (eventPath !== null) router.replace(eventPath as never);
    else goHome();
  }, [eventPath, router, goHome]);

  const claim = useCallback(async (): Promise<void> => {
    if (busy !== null || resolved === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("Add your name so the host knows who's coming.");
      return;
    }
    setNameError(null);
    setError(null);
    setBusy("claim");
    const result = await claimRsvpGuestLink(code, trimmed);
    if (!mounted.current) return;
    setBusy(null);
    const next = claimOutcomeScreen(result, resolved.inviterFirstName);
    if (next.kind === "claimed") void clearPendingRsvpGuest();
    if (next.kind === "info" && next.primary === "retry") {
      setError(next.body);
      return;
    }
    setPhase({ kind: "ready", resolved: { ...resolved, rsvpId: result.rsvpId ?? resolved.rsvpId, guestId: result.guestId ?? resolved.guestId }, screen: next });
  }, [busy, resolved, name, code]);

  const signInFirst = useCallback((): void => {
    // Held through install, sign-up and onboarding; the shell reopens this screen.
    void setPendingRsvpGuest(code).then(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/" as never);
    });
  }, [code, router]);

  const release = useCallback(async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("release");
    setError(null);
    try {
      const outcome = await releaseRsvpGuestLink(code);
      if (!mounted.current) return;
      void clearPendingRsvpGuest();
      setPhase({ kind: "released", ...releaseOutcomeMessage(outcome) });
    } catch {
      if (mounted.current) setError("We couldn't reach Mingla. Check your connection and try again.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [busy, code]);

  const typedE164 = useMemo(
    () => resolveUserPhoneE164(phoneRaw, phoneCountry),
    [phoneRaw, phoneCountry],
  );
  const last4 = resolved?.phoneLast4 ?? null;
  const typedMatches = typedE164 !== null && (last4 === null || typedE164.replace(/\D/g, "").endsWith(last4));

  const refusedChannels = useMemo<OtpChannel[]>(
    () => (typedE164 !== null && refused.number === typedE164 ? refused.channels : []),
    [refused, typedE164],
  );
  // #4561: text first; a call once text is refused; nothing once both are.
  const sendChannel = phoneStepSendChannel(refusedChannels);
  const allRefused = sendChannel === null;

  const sendCode = useCallback(async (): Promise<void> => {
    if (busy !== null) return;
    if (typedE164 === null) { setError("Enter the number this invite was sent to."); return; }
    if (!typedMatches) { setError(`That's not the number ending ${last4}. Enter the number the invite was sent to.`); return; }
    if (sendChannel === null) return;
    setBusy("send");
    setError(null);
    const result = sendChannel === "sms" ? await sendOtp(typedE164) : await sendOtp(typedE164, sendChannel);
    if (!mounted.current) return;
    setBusy(null);
    if (!result.success) {
      mixpanelService.track("Phone Code Send Failed", {
        surface: "rsvp_claim",
        channel: sendChannel,
        failure_class: result.code ?? "send_failed",
      });
      if (result.code === "channel_unavailable") {
        const next = withRefusedChannel(refusedChannels, result.channel ?? sendChannel);
        setRefused({ number: typedE164, channels: next });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(phoneStepSendChannel(next) === null ? ALL_REFUSED_TEXT : SMS_REFUSED_TEXT);
        return;
      }
      setError(result.error ?? "We couldn't send the code. Try again.");
      return;
    }
    if (sendChannel !== "sms") {
      mixpanelService.track("Phone Code Fallback Sent", { surface: "rsvp_claim", channel: sendChannel });
    }
    setSentChannel(sendChannel);
    setCodeSentTo(typedE164);
    setOtp("");
  }, [busy, typedE164, typedMatches, last4, sendChannel, refusedChannels]);

  const emailSupport = useCallback((): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(SUPPORT_MAILTO).catch((e: unknown) => {
      // The address is printed under the button for phones with no mail app.
      logger.error("[RsvpGuestClaim] support email could not open", { error: String(e) });
    });
  }, []);

  const verifyAndClaim = useCallback(async (): Promise<void> => {
    if (busy !== null || codeSentTo === null) return;
    if (!/^\d{6}$/.test(otp.trim())) {
      setError(sentChannel === "call" ? CALL_CODE_PROMPT : "Enter the 6-digit code we texted you.");
      return;
    }
    setBusy("verify");
    setError(null);
    const result = await verifyOtp(codeSentTo, otp.trim());
    if (!mounted.current) return;
    setBusy(null);
    if (!result.success) { setError(result.error ?? "That code didn't work. Check it and try again."); return; }
    await claim();
  }, [busy, codeSentTo, otp, claim, sentChannel]);

  // ── render ──
  if (phase.kind === "loading") {
    return <ProgramScreen title="Your invite" onBack={goHome}><ProgramLoading label="Opening your invite…" /></ProgramScreen>;
  }
  if (phase.kind === "load_error") {
    return (
      <ProgramScreen title="Your invite" onBack={goHome}>
        <ProgramLoadError
          text={phase.rateLimited ? "Too many tries in a row. Wait a minute, then try again." : "Check your connection and try again."}
          onRetry={() => void load()}
        />
      </ProgramScreen>
    );
  }
  if (phase.kind === "released") {
    return (
      <ProgramScreen title="Your invite" onBack={goHome}>
        <ProgramCard>
          <Text style={styles.title}>{phase.title}</Text>
          <Text style={styles.copy}>{phase.body}</Text>
        </ProgramCard>
        <ProgramButton label="Go to Mingla" onPress={goHome} style={styles.gap} />
      </ProgramScreen>
    );
  }

  const r = phase.resolved;
  const when = formatGuestEventWhen(r.event?.startsAt ?? null, r.event?.timezone ?? null);
  const eventCard = r.event !== null ? (
    <ProgramCard>
      <Text style={styles.eventTitle} accessibilityRole="header">{r.event.title}</Text>
      {when ? <Text style={styles.copy}>{when}</Text> : null}
      {r.event.venueLine ? <Text style={styles.copy}>{r.event.venueLine}</Text> : null}
      {r.event.brandName ? <Text style={styles.muted}>{`Hosted by ${r.event.brandName}`}</Text> : null}
    </ProgramCard>
  ) : null;

  if (screen?.kind === "claimed") {
    return (
      <ProgramScreen title="Your pass" onBack={goHome}>
        <Text style={styles.headline} accessibilityRole="header">You're in</Text>
        {screen.friendshipLine ? <Text style={styles.copy}>{screen.friendshipLine}</Text> : null}
        {eventCard}
        <ProgramCard style={styles.gap}>
          {pass !== null ? (
            <View style={styles.qrWrap} accessible accessibilityRole="image" accessibilityLabel={`Your pass QR code for ${pass.name}`}>
              <View style={styles.qrCard}><QRCode value={pass.qr} size={200} /></View>
              <Text style={styles.passName}>{pass.name}</Text>
            </View>
          ) : passError ? (
            <ProgramNotice tone="info" text="Your pass is saved to your account. Open the event to see it." />
          ) : (
            <ProgramLoading label="Loading your pass…" />
          )}
        </ProgramCard>
        <ProgramButton label="Open the event" onPress={goEvent} style={styles.gap} />
      </ProgramScreen>
    );
  }

  if (screen?.kind === "info") {
    const primary = screen.primary === "home" || (screen.primary === "event" && eventPath === null)
      ? { label: "Go to Mingla", onPress: goHome }
      : screen.primary === "retry"
        ? { label: "Try again", onPress: () => void load() }
        : { label: "Open the event", onPress: goEvent };
    return (
      <ProgramScreen title="Your invite" onBack={goHome}>
        <Text style={styles.headline} accessibilityRole="header">{screen.title}</Text>
        <Text style={styles.copy}>{screen.body}</Text>
        {eventCard}
        <ProgramButton label={primary.label} onPress={primary.onPress} style={styles.gap} />
        {primary.label !== "Go to Mingla" ? (
          <ProgramButton label="Go to Mingla" variant="ghost" onPress={goHome} />
        ) : null}
      </ProgramScreen>
    );
  }

  const mode = screen?.kind === "verify_number" ? "confirm_number" : inviteMode(r, signedIn);
  const sentence = r.inviterHasAccount ? friendshipSentence(inviterFirst) : null;

  return (
    // #4508 R2: "Text me a code" sits right under the number field, so the
    // scroll keeps the field AND that button above the keyboard's Done bar.
    <ProgramScreen title="Your invite" onBack={goHome} keyboardBottomOffset={CLAIM_FIELD_BOTTOM_OFFSET}>
      <Text style={styles.headline} accessibilityRole="header">{`${r.inviterName} saved you a spot`}</Text>
      <Text style={styles.copy}>Your pass is in the Mingla app.</Text>
      {eventCard}

      {mode === "sign_in" ? (
        <View style={styles.gap}>
          <Text style={styles.copy}>
            {r.phoneLast4
              ? `Sign in or create your account with the number ending ${r.phoneLast4} to get your pass.`
              : "Sign in or create your account to get your pass."}
          </Text>
          {sentence ? <Text style={styles.muted}>{sentence}</Text> : null}
          <ProgramButton label="Get my pass" onPress={signInFirst} style={styles.gap} />
        </View>
      ) : (
        <View style={styles.gap}>
          <ProgramField
            label="Your name"
            value={name}
            onChangeText={(v: string) => { setName(v); setNameError(null); }}
            placeholder="First and last name"
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
            maxLength={120}
            error={nameError}
            editable={busy === null}
          />
          {mode === "confirm_number" ? (
            <ProgramCard>
              <Text style={styles.label}>Confirm your number</Text>
              <Text style={styles.copy}>
                {r.phoneLast4
                  ? `This invite was sent to the number ending ${r.phoneLast4}. We'll text it a code. It becomes the phone number on your Mingla account.`
                  : "We'll text your number a code. It becomes the phone number on your Mingla account."}
              </Text>
              {codeSentTo === null ? (
                <>
                  <PhoneInput
                    value={phoneRaw}
                    countryCode={phoneCountry}
                    onChangePhone={(v: string) => { setPhoneRaw(v); setError(null); }}
                    onChangeCountry={(iso: string) => setPhoneCountry(iso)}
                    error={null}
                    disabled={busy !== null}
                    theme={PHONE_THEME}
                    testID="issue-4508-claim-phone"
                    phoneInputAccessibilityLabel="The number this invite was sent to"
                    // #4508 R2: one Done bar (the app-wide one), not two.
                    showDoneAccessory={false}
                  />
                  <ProgramButton
                    label={sendChannel === "call" ? "Call me with the code" : "Text me a code"}
                    onPress={() => void sendCode()}
                    busy={busy === "send"}
                    disabled={allRefused || (busy !== null && busy !== "send")}
                    variant="secondary"
                    style={styles.gap}
                  />
                </>
              ) : (
                <>
                  <ProgramField
                    label="Code"
                    value={otp}
                    onChangeText={(v: string) => { setOtp(v.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                    placeholder="6-digit code"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    hint={`Sent to the number ending ${codeSentTo.replace(/\D/g, "").slice(-4)}`}
                    editable={busy === null}
                  />
                  <ProgramButton
                    label="Use a different number"
                    variant="ghost"
                    onPress={() => { setCodeSentTo(null); setOtp(""); setError(null); }}
                    disabled={busy !== null}
                  />
                </>
              )}
            </ProgramCard>
          ) : null}
          {sentence ? <Text style={[styles.muted, styles.gap]}>{sentence}</Text> : null}
          {error ? <ProgramNotice tone="error" text={error} /> : null}
          {mode === "confirm_number" && codeSentTo === null && allRefused ? (
            <View>
              <ProgramButton
                label="Email support"
                icon="mail"
                variant="secondary"
                onPress={emailSupport}
                style={styles.gap}
              />
              <Text style={[styles.muted, styles.supportAddress]} selectable>{SUPPORT_EMAIL}</Text>
            </View>
          ) : null}
          <ProgramButton
            label="Get my pass"
            onPress={() => void (mode === "one_tap" ? claim() : verifyAndClaim())}
            busy={busy === "claim" || busy === "verify"}
            disabled={(mode === "confirm_number" && codeSentTo === null) || (busy !== null && busy !== "claim" && busy !== "verify")}
            style={styles.gap}
          />
        </View>
      )}

      <ProgramButton
        label="This isn't me"
        variant="ghost"
        onPress={() => void release()}
        busy={busy === "release"}
        disabled={busy !== null && busy !== "release"}
        accessibilityLabel="This isn't me. Give the spot back"
        style={styles.gap}
      />
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  headline: { color: C.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.4, marginBottom: 6 },
  title: { color: C.text, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  eventTitle: { color: C.text, fontSize: 18, fontWeight: "800", marginBottom: 4 },
  label: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  copy: { color: C.muted, fontSize: 15, lineHeight: 21, marginBottom: 6 },
  muted: { color: C.faint, fontSize: 13, lineHeight: 19 },
  gap: { marginTop: CLAIM_BUTTON_GAP },
  qrWrap: { alignItems: "center", gap: 10, paddingVertical: 8 },
  qrCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14 },
  passName: { color: C.text, fontSize: 15, fontWeight: "700" },
  supportAddress: { marginTop: 8, textAlign: "center" },
});

export default RsvpGuestClaimScreen;
