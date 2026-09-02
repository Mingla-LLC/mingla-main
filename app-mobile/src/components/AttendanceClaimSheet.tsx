import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import { Icon } from "./ui/Icon";
import { colors } from "../constants/designSystem";
import { postHogService } from "../services/postHogService";
import {
  claimAttendance,
  AttendanceClaimError,
  probeAttendanceRoster,
  clearAttendanceClaimIntent,
  type AttendanceClaimIntent,
} from "../services/attendanceClaimService";
import { createAttendanceClaimSingleFlight } from "../utils/attendanceClaimDeepLink";

type Phase = "ready" | "submitting" | "success" | "private" | "network" |
  "invalid" | "rate" | "route_error";

export function AttendanceClaimSheet({
  visible, intent, initialInvalid = false, signedIn, onClose, onSignIn, onSeeGuestList,
}: {
  visible: boolean;
  intent: AttendanceClaimIntent | null;
  initialInvalid?: boolean;
  signedIn: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSeeGuestList: (eventId: string) => Promise<boolean>;
}): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("ready");
  const [claimedEventId, setClaimedEventId] = useState<string | null>(null);
  const singleFlightRef = useRef(createAttendanceClaimSingleFlight());

  useEffect(() => {
    if (visible && (intent || initialInvalid)) {
      setPhase(initialInvalid ? "invalid" : "ready");
      setClaimedEventId(null);
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
        });
        await clearAttendanceClaimIntent();
        setClaimedEventId(result.eventId);
        const rosterState = await probeAttendanceRoster(result.eventId);
        setPhase(
          rosterState === "authorized"
            ? "success"
            : rosterState === "private"
            ? "private"
            : "route_error",
        );
        AccessibilityInfo.announceForAccessibility("Attendance connected.");
      } catch (error) {
        const outcome = error instanceof AttendanceClaimError
          ? error.code === "claim_rate_limited" ? "rate_limited"
          : error.code === "claim_ineligible" ? "ineligible"
          : error.code === "claim_invalid" ? "invalid"
          : "network"
          : "network";
        postHogService.capture("attendance_claim_completed", {
          claim_kind: intent.kind,
          surface: "consumer_app",
          outcome,
          authenticated: true,
        });
        if (error instanceof AttendanceClaimError && error.code === "claim_rate_limited") {
          await clearAttendanceClaimIntent();
          setPhase("rate");
        } else if (error instanceof AttendanceClaimError && error.code !== "network") {
          await clearAttendanceClaimIntent();
          setPhase("invalid");
        } else {
          setPhase("network");
        }
      }
    });
  }, [intent]);

  const terminalDone = useCallback((): void => {
    void clearAttendanceClaimIntent();
    onClose();
  }, [onClose]);

  const submitting = phase === "submitting";
  const dismiss = submitting ? () => undefined : onClose;
  const body = !signedIn
    ? "Sign in to connect this RSVP or ticket to your Mingla account."
    : phase === "success" ? "You’re connected. You can now see who’s going."
    : phase === "private" ? "You’re connected, but the organizer has made this guest list private."
    : phase === "network" ? "We couldn’t connect your attendance."
    : phase === "route_error" ? "You’re connected, but we couldn’t open the guest list."
    : phase === "invalid" ? "This attendance link can’t be used. Request a new link from your confirmation."
    : phase === "rate" ? "Too many attempts. Try again in a few minutes."
    : submitting ? "Connecting your attendance…"
    : "Connect this RSVP or ticket to your account?";
  const label = !signedIn ? "Sign in"
    : phase === "success" ? "See who’s going"
    : phase === "private" || phase === "invalid" || phase === "rate" ? "Done"
    : phase === "network" || phase === "route_error" ? "Try again"
    : "Connect attendance";
  const iconName = phase === "success" ? "checkmark-circle"
    : phase === "private" ? "lock-closed"
    : phase === "invalid" || phase === "rate" || phase === "network" || phase === "route_error"
    ? "alert-circle"
    : "link";

  const action = async (): Promise<void> => {
    if (!signedIn) {
      onSignIn();
      return;
    }
    if (phase === "success" || phase === "route_error") {
      if (!claimedEventId) return;
      try {
        if (!(await onSeeGuestList(claimedEventId))) setPhase("route_error");
      } catch {
        setPhase("route_error");
      }
      return;
    }
    if (phase === "private" || phase === "invalid" || phase === "rate") {
      terminalDone();
      return;
    }
    await submit();
  };

  const header = (
    <View style={styles.header} accessibilityRole="header">
      <View style={styles.headerIcon} accessibilityElementsHidden>
        <Icon name={iconName} size={22} color="#111827" />
      </View>
      <Text style={styles.title}>Connect attendance</Text>
      {!submitting ? (
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
  const footer = (
    <View style={styles.footer}>
      <Pressable
        onPress={() => void action()}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting, busy: submitting }}
        style={({ pressed }) => [
          styles.button,
          submitting ? styles.buttonDisabled : null,
          pressed && !submitting ? styles.buttonPressed : null,
        ]}
      >
        {submitting
          ? <ActivityIndicator color="#111827" accessibilityLabel="Connecting attendance" />
          : <Text style={styles.buttonText}>{label}</Text>}
      </Pressable>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={dismiss}
      snapPoints={["50%", "90%"]}
      initialIndex={0}
      enableDynamicSizing={false}
      enablePanDownToClose={!submitting}
      backdropPressBehavior={submitting ? "none" : "close"}
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
        <Text style={styles.copy}>{body}</Text>
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
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, alignItems: "center" },
  stateIcon: {
    width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(249,115,22,.12)", marginBottom: 16,
  },
  copy: { color: "rgba(255,255,255,.72)", fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 360 },
  footer: { paddingHorizontal: 20, paddingTop: 16 },
  button: {
    minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primary[500], paddingHorizontal: 20,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  buttonText: { color: "#111827", fontSize: 16, lineHeight: 24, fontWeight: "700", textAlign: "center" },
});
