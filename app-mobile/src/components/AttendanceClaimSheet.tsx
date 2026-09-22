import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// `BottomSheetTextInput` is re-exported by the primitive on purpose: a
// strict-grep gate forbids any other app-mobile file importing @gorhom directly,
// and a raw RN input inside a sheet sits under the keyboard.
import { BaseBottomSheet, BottomSheetTextInput } from "./ui/BaseBottomSheet";
import { Icon } from "./ui/Icon";
import { colors } from "../constants/designSystem";
import { postHogService } from "../services/postHogService";
import {
  claimAttendance,
  AttendanceClaimError,
  probeAttendanceRoster,
  clearAttendanceClaimIntent,
  saveAttendanceClaimHandoffMarker,
  clearAttendanceClaimHandoffMarker,
  type AttendanceClaimIntent,
} from "../services/attendanceClaimService";
import { createAttendanceClaimSingleFlight } from "../utils/attendanceClaimDeepLink";
// ONE writer for the emailed code. This sheet does not open a second OTP path.
import {
  sendEmailSignInCode,
  verifyEmailSignInCode,
} from "../services/emailOtpService";

/**
 * #3524 — THE SHEET NOW NAMES THE ACCOUNT, AND TELLS THE TRUTH ABOUT THE CHAT.
 *
 * Three defects this replaces:
 *
 *  1. IT NEVER SAID WHOSE ACCOUNT IT WAS ABOUT TO USE. "Connect this RSVP or
 *     ticket to your account?" with no email, no avatar, no identifier anywhere,
 *     and no way to say "that's not me". Signed in as the wrong person, the sheet
 *     looked identical and the claim SUCCEEDED. Seth's decision 1 requires the
 *     opposite: show who is signed in and ask.
 *  2. THE "Sign in" BUTTON ONLY CLOSED THE SHEET. It did not navigate anywhere.
 *     A dead-looking button at the exact moment of activation.
 *  3. IT PROMISED A CHAT IT HAD NOT JOINED. The email route linked the ticket and
 *     never added the guest to the event chat, which is half of what connecting
 *     means. Now the server reports `chatJoined` and this sheet renders the chat
 *     sentence ONLY when it is true — an `experience` order legitimately has no
 *     chat, and saying so is better than lying.
 *
 * THE CLIENT DOES NOT DECIDE THE MISMATCH. There is no email comparison in this
 * file. It calls `claim-attendance` exactly as before and the SERVER answers
 * `claim_identity_mismatch` with an already-masked hint. One authority, and it is
 * the RPC.
 */
type Phase =
  | "ready"
  | "submitting"
  | "success"
  | "no_chat"
  | "mismatch"
  // #3524 — the rightful buyer, one proof short. Both are NON-TERMINAL: neither
  // clears the pending intent, because the server consumed nothing and the same
  // link must still work afterwards.
  | "confirm_inbox"
  | "code"
  | "expired"
  | "private"
  | "network"
  | "invalid"
  | "rate"
  | "route_error";

export function AttendanceClaimSheet({
  visible, intent, initialInvalid = false, signedIn, signedInIdentifier = null,
  onClose, onSignIn, onSeeGuestList, onUseDifferentAccount, onOpenChat,
  onClaimSettled,
}: {
  visible: boolean;
  intent: AttendanceClaimIntent | null;
  initialInvalid?: boolean;
  signedIn: boolean;
  /** The signed-in account's email, or its E.164 phone when there is no email.
   * `null` when neither is resolvable — the copy then falls back. */
  signedInIdentifier?: string | null;
  onClose: () => void;
  onSignIn: () => void;
  onSeeGuestList: (eventId: string) => Promise<boolean>;
  onUseDifferentAccount: () => void;
  onOpenChat: (conversationId: string) => Promise<boolean>;
  /**
   * #3524 — THE CLAIM IS OVER, WHATEVER THE OUTCOME.
   *
   * This sheet deletes the SecureStore handoff marker on every path R-2 names,
   * but the decision that actually reads it is an in-memory ref in the shell,
   * and the sheet cannot reach that ref. Without this callback the flag stayed
   * true for the rest of the app session — outliving the claim AND the marker's
   * own 30 minutes — so the next, unrelated account change took "preserve"
   * where the table says "clear". The identity predicate still stopped the
   * ticket landing on the wrong account; what it did not stop was a stranger's
   * pending claim, and the masked purchase address on it, being shown to
   * whoever signed in next.
   *
   * Called wherever the marker is deleted, so the two never disagree.
   */
  onClaimSettled: () => void;
}): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("ready");
  const [claimedEventId, setClaimedEventId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [maskedContact, setMaskedContact] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const singleFlightRef = useRef(createAttendanceClaimSingleFlight());

  useEffect(() => {
    if (visible && (intent || initialInvalid)) {
      setPhase(initialInvalid ? "invalid" : "ready");
      setClaimedEventId(null);
      setConversationId(null);
      setMaskedContact(null);
      setCode("");
      setCodeBusy(false);
      setCodeError(null);
      setResendAt(0);
    }
  }, [initialInvalid, intent, visible]);

  const submit = useCallback(async (): Promise<void> => {
    if (!intent) return;
    await singleFlightRef.current.run(async () => {
      setPhase("submitting");
      postHogService.capture("attendance_claim_started", {
        claim_kind: intent.kind,
        surface: "consumer_app",
        authenticated: true,
      });
      try {
        const result = await claimAttendance(intent);
        postHogService.capture("attendance_claim_completed", {
          claim_kind: intent.kind,
          surface: "consumer_app",
          outcome: result.status === "claimed" ? "success" : "idempotent_success",
          authenticated: true,
          chat_joined: result.chatJoined,
        });
        await clearAttendanceClaimIntent();
        // The claim landed, so whatever account handoff got us here is finished.
        await clearAttendanceClaimHandoffMarker();
        onClaimSettled();
        setClaimedEventId(result.eventId);
        setConversationId(result.conversationId);
        if (result.chatJoined && result.conversationId !== null) {
          setPhase("success");
          AccessibilityInfo.announceForAccessibility(
            "Attendance connected. You joined the event chat.",
          );
          return;
        }
        // No chat. It may be legitimate (an `experience` has none), so the guest
        // is offered the guest list instead — and never told they joined a chat.
        const rosterState = await probeAttendanceRoster(result.eventId);
        setPhase(
          rosterState === "authorized"
            ? "no_chat"
            : rosterState === "private"
            ? "private"
            : "route_error",
        );
        AccessibilityInfo.announceForAccessibility("Attendance connected.");
      } catch (error) {
        const outcome = error instanceof AttendanceClaimError
          ? error.code === "claim_rate_limited" ? "rate_limited"
          : error.code === "claim_ineligible" ? "ineligible"
          : error.code === "claim_identity_mismatch" ? "identity_mismatch"
          // #3524 — its own funnel outcome. Folded into "network" it would read
          // as a fault, and the one refusal worth measuring separately is the
          // one the guest can act on.
          : error.code === "claim_contact_unproved" ? "contact_unproved"
          : error.code === "claim_expired" ? "expired"
          : error.code === "claim_invalid" ? "invalid"
          : "network"
          : "network";
        postHogService.capture("attendance_claim_completed", {
          claim_kind: intent.kind,
          surface: "consumer_app",
          outcome,
          authenticated: true,
        });
        if (error instanceof AttendanceClaimError) {
          // #3524 — NEITHER OF THESE CLEARS THE INTENT. The server did not
          // consume the token on either, so the SAME link still works for the
          // rightful account and the guest can retry after signing in correctly.
          if (error.code === "claim_identity_mismatch") {
            setMaskedContact(error.contactMasked);
            setPhase("mismatch");
            return;
          }
          // #3524 — the address on this account IS the one on the order; only
          // the proof is missing. Offer to send one, here, rather than the
          // sign-out that would bring them straight back to this wall. The
          // intent is deliberately NOT cleared.
          if (error.code === "claim_contact_unproved") {
            setMaskedContact(error.contactMasked);
            setPhase("confirm_inbox");
            return;
          }
          if (error.code === "claim_expired") {
            setPhase("expired");
            return;
          }
          if (error.code === "claim_rate_limited") {
            await clearAttendanceClaimIntent();
            setPhase("rate");
            return;
          }
          if (error.code !== "network") {
            await clearAttendanceClaimIntent();
            setPhase("invalid");
            return;
          }
        }
        setPhase("network");
      }
    });
  }, [intent, onClaimSettled]);

  const terminalDone = useCallback((): void => {
    void clearAttendanceClaimIntent();
    void clearAttendanceClaimHandoffMarker();
    // The in-memory twin of that marker, which lives in the shell.
    onClaimSettled();
    onClose();
  }, [onClaimSettled, onClose]);

  /**
   * "Use a different account" / "Sign out and continue".
   *
   * ORDER MATTERS AND THERE IS NO AWAIT BETWEEN THE MARKER AND THE SIGN-OUT. The
   * marker is what tells `attendanceClaimAuthAction` that THIS FLOW caused the
   * account change, so the pending claim is preserved rather than cleared. Write
   * it after the sign-out and the auth listener has already fired and destroyed
   * the claim — which is exactly the bug this handles.
   */
  const handoffToAnotherAccount = useCallback((): void => {
    void saveAttendanceClaimHandoffMarker(maskedContact);
    onUseDifferentAccount();
  }, [maskedContact, onUseDifferentAccount]);

  /**
   * #3524 — SEND THE CODE.
   *
   * The address used is `signedInIdentifier`, the account's OWN email. That is
   * sound precisely because the server answered `contact_unproved`, which says
   * the order's address and this account's address are the same one — so the
   * client never needs, and never receives, the unmasked purchase contact. The
   * masked hint is for the eye only and is never sent anywhere.
   */
  const sendCode = useCallback(async (): Promise<void> => {
    if (signedInIdentifier === null || codeBusy) return;
    setCodeBusy(true);
    setCodeError(null);
    const result = await sendEmailSignInCode(signedInIdentifier);
    setCodeBusy(false);
    if (!result.ok) {
      setCodeError(result.error ?? "We couldn’t send the code. Try again.");
      return;
    }
    // 30s before "Send it again" arms, so the control cannot be hammered.
    setResendAt(Date.now() + 30_000);
    setCode("");
    setPhase("code");
    AccessibilityInfo.announceForAccessibility("We sent you a code.");
  }, [codeBusy, signedInIdentifier]);

  /**
   * Confirm, then fall through to the ORDINARY claim path — `submit()` — so the
   * success and no-chat states, and the chat join itself, are reached exactly as
   * they are on every other route. Nothing about them is special-cased here.
   */
  const confirmCode = useCallback(async (): Promise<void> => {
    if (signedInIdentifier === null || codeBusy) return;
    const entered = code.trim();
    if (entered.length !== 6) {
      setCodeError("Enter the 6-digit code.");
      return;
    }
    setCodeBusy(true);
    setCodeError(null);
    const result = await verifyEmailSignInCode(signedInIdentifier, entered);
    setCodeBusy(false);
    if (!result.ok) {
      setCodeError(result.error ?? "That code didn’t work. Try again.");
      return;
    }
    await submit();
  }, [code, codeBusy, signedInIdentifier, submit]);

  const submitting = phase === "submitting";
  // The primary is busy while the claim is in flight OR while the emailed-code
  // round-trip is. Two different waits, one disabled state.
  const busy = submitting || codeBusy;
  // Back / swipe-down / backdrop are all a NO-OP while submitting. There is no
  // BackHandler listener to add: `wrapInRNModal` short-circuits the sheet's own
  // listener and RN's <Modal onRequestClose> reaches this same handler.
  const dismiss = submitting || codeBusy ? () => undefined : onClose;

  const readyBody = signedInIdentifier !== null
    ? `Connect this ticket to ${signedInIdentifier}?`
    : "Connect this RSVP or ticket to your account?";

  const body = !signedIn
    ? "Sign in to connect this ticket to your Mingla account. Use the email or phone you used at checkout."
    : phase === "success"
    ? "You’re in. Your ticket is on your account and you’ve joined the event chat."
    : phase === "no_chat"
    ? "Your ticket is on your account. This one doesn’t have a group chat."
    : phase === "expired"
    ? "This link has expired. Sign in with the email or phone you used at checkout and your ticket will be waiting."
    : phase === "private" ? "You’re connected, but the organizer has made this guest list private."
    : phase === "network" ? "We couldn’t connect your attendance."
    : phase === "route_error"
    ? (conversationId !== null
      ? "You’re connected, but we couldn’t open the chat."
      : "You’re connected, but we couldn’t open the guest list.")
    : phase === "invalid" ? "This attendance link can’t be used. Request a new link from your confirmation."
    : phase === "rate" ? "Too many attempts. Try again in a few minutes."
    : submitting ? "Connecting your attendance…"
    : readyBody;

  const label = !signedIn ? "Sign in"
    : phase === "confirm_inbox" ? "Email me a code"
    : phase === "code" ? "Confirm and connect"
    : phase === "success" ? "Open the chat"
    : phase === "no_chat" ? "See who’s going"
    : phase === "mismatch" ? "Sign out and continue"
    : phase === "private" || phase === "invalid" || phase === "rate" ||
        phase === "expired"
    ? "Done"
    : phase === "network" || phase === "route_error" ? "Try again"
    : "Connect attendance";

  const iconName = phase === "success" || phase === "no_chat"
    ? "checkmark-circle"
    : phase === "private" ? "lock-closed"
    : phase === "mismatch" ? "person-circle"
    : phase === "confirm_inbox" || phase === "code" ? "mail"
    : phase === "invalid" || phase === "rate" || phase === "network" ||
        phase === "route_error" || phase === "expired"
    ? "alert-circle"
    : "link";

  const action = async (): Promise<void> => {
    if (!signedIn) {
      onSignIn();
      return;
    }
    if (phase === "mismatch") {
      handoffToAnotherAccount();
      return;
    }
    if (phase === "confirm_inbox") {
      await sendCode();
      return;
    }
    if (phase === "code") {
      await confirmCode();
      return;
    }
    if (phase === "success") {
      if (conversationId === null) {
        setPhase("route_error");
        return;
      }
      try {
        if (!(await onOpenChat(conversationId))) setPhase("route_error");
      } catch {
        setPhase("route_error");
      }
      return;
    }
    if (phase === "no_chat" || phase === "route_error") {
      if (!claimedEventId) return;
      // A route_error reached from the chat arm retries the chat; from the guest
      // list arm it retries the guest list. Either way the claim is already
      // durable in the database — a routing failure must never look like a claim
      // failure.
      if (phase === "route_error" && conversationId !== null) {
        try {
          if (!(await onOpenChat(conversationId))) setPhase("route_error");
        } catch {
          setPhase("route_error");
        }
        return;
      }
      try {
        if (!(await onSeeGuestList(claimedEventId))) setPhase("route_error");
      } catch {
        setPhase("route_error");
      }
      return;
    }
    if (
      phase === "private" || phase === "invalid" || phase === "rate" ||
      phase === "expired"
    ) {
      terminalDone();
      return;
    }
    await submit();
  };

  /**
   * The mismatch body, rendered as three separate lines so a screen reader pauses
   * between them and the two identifiers do not run together.
   *
   * `maskedContact` ARRIVES ALREADY MASKED FROM THE SERVER. This component never
   * receives or renders an unmasked purchase contact, and it does not log one.
   */
  /**
   * #3524 — CONFIRM THE INBOX. Two lines, so a screen reader pauses between the
   * address and the ask. Says what is needed and nothing about what happens
   * next time: this proof is durable, not permanent, and copy that implied
   * otherwise would be a promise the rule does not make.
   */
  const confirmInboxBody = (
    <>
      <Text style={styles.copy}>
        This ticket was bought with{" "}
        <Text style={styles.copyStrong}>{maskedContact ?? "this address"}</Text>
        {" "}— the address on this account.
      </Text>
      <Text style={styles.copy}>
        We just need to check you can open that inbox.
      </Text>
      {codeError !== null
        ? <Text style={styles.error} accessibilityLiveRegion="polite">{codeError}</Text>
        : null}
    </>
  );

  /** The code step, INSIDE the sheet: the person never leaves the ticket they
   * are connecting. `BottomSheetTextInput` coordinates with the sheet so the
   * keyboard cannot cover the field. */
  const codeBody = (
    <>
      <Text style={styles.copy}>
        Enter the 6-digit code we sent to{" "}
        <Text style={styles.copyStrong}>{maskedContact ?? "your inbox"}</Text>.
      </Text>
      <BottomSheetTextInput
        value={code}
        onChangeText={(next: string) => {
          setCode(next.replace(/[^0-9]/g, "").slice(0, 6));
          setCodeError(null);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!codeBusy}
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor="rgba(255,255,255,.35)"
        accessibilityLabel="Six digit code"
        testID="attendance-claim-code-input"
      />
      {codeError !== null
        ? <Text style={styles.error} accessibilityLiveRegion="polite">{codeError}</Text>
        : null}
    </>
  );

  const mismatchBody = (
    <>
      <Text style={styles.copy}>
        This ticket was bought with{" "}
        <Text style={styles.copyStrong}>{maskedContact ?? "another address"}</Text>.
      </Text>
      <Text style={styles.copy}>
        You’re signed in as{" "}
        <Text style={styles.copyStrong}>{signedInIdentifier ?? "this account"}</Text>.
      </Text>
      <Text style={styles.copy}>
        To put the ticket on the right account, sign out and sign in with that
        address.
      </Text>
    </>
  );

  const header = (
    <View style={styles.header} accessibilityRole="header">
      <View style={styles.headerIcon} accessibilityElementsHidden>
        <Icon name={iconName} size={22} color="#111827" />
      </View>
      <Text style={styles.title}>Connect attendance</Text>
      {!(submitting || codeBusy) ? (
        <Pressable
          onPress={dismiss}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close attendance connection"
        >
          <Icon name="close" size={20} color="#ffffff" />
        </Pressable>
      ) : <View style={styles.close} />}
    </View>
  );

  // The always-present escape hatch on the ready state, and the Cancel on the
  // mismatch. Both are their OWN Pressable siblings of the primary button, never
  // nested inside it — a nested Pressable flattens the accessibility subtree.
  const resendArmed = Date.now() >= resendAt;
  const secondary = phase === "confirm_inbox"
    ? (
      <Pressable
        onPress={onClose}
        disabled={codeBusy}
        accessibilityRole="button"
        accessibilityLabel="Cancel and keep this ticket for later"
        accessibilityState={{ disabled: codeBusy }}
        style={styles.secondary}
        testID="attendance-claim-confirm-inbox-cancel"
      >
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    )
    : phase === "code"
    ? (
      <Pressable
        onPress={() => void sendCode()}
        disabled={codeBusy || !resendArmed}
        accessibilityRole="button"
        accessibilityLabel="Send the code again"
        accessibilityState={{ disabled: codeBusy || !resendArmed }}
        style={styles.secondary}
        testID="attendance-claim-code-resend"
      >
        <Text
          style={[styles.secondaryText, !resendArmed ? styles.secondaryMuted : null]}
        >
          Send it again
        </Text>
      </Pressable>
    )
    : phase === "mismatch"
    ? (
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel and keep this ticket for later"
        style={styles.secondary}
        testID="attendance-claim-cancel"
      >
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    )
    : signedIn && (phase === "ready" || phase === "submitting")
    ? (
      <Pressable
        onPress={handoffToAnotherAccount}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Use a different Mingla account for this ticket"
        accessibilityState={{ disabled: submitting }}
        style={styles.secondary}
        testID="attendance-claim-use-different-account"
      >
        <Text style={styles.secondaryText}>Use a different account</Text>
      </Pressable>
    )
    : null;

  const footer = (
    <View style={styles.footer}>
      <Pressable
        onPress={() => void action()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [
          styles.button,
          busy ? styles.buttonDisabled : null,
          pressed && !busy ? styles.buttonPressed : null,
        ]}
        testID="attendance-claim-primary"
      >
        {busy
          ? <ActivityIndicator color="#111827" accessibilityLabel="Connecting attendance" />
          : <Text style={styles.buttonText}>{label}</Text>}
      </Pressable>
      {secondary}
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={dismiss}
      snapPoints={["50%", "90%"]}
      initialIndex={0}
      enableDynamicSizing={false}
      enablePanDownToClose={!(submitting || codeBusy)}
      backdropPressBehavior={submitting || codeBusy ? "none" : "close"}
      wrapInRNModal
      theme="dark"
      backgroundStyle={styles.sheet}
      header={header}
      scrollMode="scroll"
      accessibilityLabel="Connect attendance"
    >
      <View style={styles.body} onAccessibilityEscape={dismiss}>
        <View style={styles.stateIcon} accessibilityElementsHidden>
          {submitting
            ? <ActivityIndicator color={colors.primary[500]} />
            : <Icon name={iconName} size={28} color={colors.primary[500]} />}
        </View>
        {signedIn && phase === "mismatch"
          ? mismatchBody
          : signedIn && phase === "confirm_inbox"
          ? confirmInboxBody
          : signedIn && phase === "code"
          ? codeBody
          : <Text style={styles.copy}>{body}</Text>}
      </View>
      {footer}
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: "#111418", borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  header: {
    minHeight: 64, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18,
    flexDirection: "row", alignItems: "center", gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,.08)",
  },
  headerIcon: {
    width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primary[500],
  },
  title: { flex: 1, minWidth: 0, color: "#fff", fontSize: 20, lineHeight: 32, fontWeight: "700" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, alignItems: "center", gap: 6 },
  stateIcon: {
    width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(249,115,22,.12)", marginBottom: 16,
  },
  copy: { color: "rgba(255,255,255,.72)", fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 360 },
  copyStrong: { color: "#ffffff", fontWeight: "700" },
  footer: { paddingHorizontal: 20, paddingTop: 16 },
  button: {
    minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primary[500], paddingHorizontal: 20,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  buttonText: { color: "#111827", fontSize: 16, lineHeight: 24, fontWeight: "700", textAlign: "center" },
  // 44pt minimum, per the target-size rule. A borderless text control still has
  // to be reachable by a thumb.
  secondary: {
    minHeight: 44, marginTop: 10, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 16,
  },
  error: {
    color: "#fca5a5", fontSize: 13, lineHeight: 19, textAlign: "center",
    maxWidth: 360, marginTop: 4,
  },
  codeInput: {
    marginTop: 16, minHeight: 56, width: "100%", maxWidth: 260,
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,.18)",
    backgroundColor: "rgba(255,255,255,.06)", color: "#ffffff",
    fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: 6,
    textAlign: "center", paddingHorizontal: 16,
  },
  secondaryMuted: { opacity: 0.5, textDecorationLine: "none" },
  secondaryText: {
    color: "rgba(255,255,255,.82)", fontSize: 15, lineHeight: 22,
    fontWeight: "600", textDecorationLine: "underline", textAlign: "center",
  },
});
