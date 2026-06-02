/**
 * /accept-scanner-invitation — landing route for scanner-invite links
 * (ORCH-1051).
 *
 * URL: https://business.usemingla.com/accept-scanner-invitation?token=<raw>
 *
 * Flow:
 *   1. Read `token` from the URL.
 *   2. If the user isn't authenticated, send them to /auth and preserve the
 *      token via the `next` query param so /auth/callback can resume.
 *   3. POST { token } to the accept-scanner-invitation edge fn (via
 *      acceptScannerInvitation service).
 *   4. On success → distinguish scope=event ("You can scan tickets at <event>")
 *      vs scope=brand ("You can scan tickets at every <brand> event"). Navigate
 *      back to /event/<id>/scanner when scope=event so the camera is one tap
 *      away; for scope=brand send them to the Home tab.
 *   5. On error → friendly error state per mapped status code (404/410/403).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button } from "../src/components/ui/Button";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../src/constants/designSystem";
import { useAuth } from "../src/context/AuthContext";
import { useAcceptScannerInvitation } from "../src/hooks/useScannerInvitations";
import {
  ScannerInvitationServiceError,
  type AcceptScannerInvitationResult,
} from "../src/services/scannerInvitationsService";

type Phase =
  | { kind: "loading" }
  | { kind: "success"; result: AcceptScannerInvitationResult }
  | { kind: "error"; code: string; status: number };

export default function AcceptScannerInvitationRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  const { isAuthReady, user } = useAuth();
  const { mutateAsync: acceptAsync } = useAcceptScannerInvitation();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [hasRun, setHasRun] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthReady) return;
    if (token.length === 0) {
      setPhase({ kind: "error", code: "validation", status: 400 });
      return;
    }
    if (user === null) {
      const next = encodeURIComponent(
        `/accept-scanner-invitation?token=${token}`,
      );
      router.replace(`/auth?next=${next}` as never);
      return;
    }
    if (hasRun) return;
    setHasRun(true);
    void (async () => {
      try {
        const result = await acceptAsync(token);
        setPhase({ kind: "success", result });
      } catch (err) {
        if (err instanceof ScannerInvitationServiceError) {
          setPhase({ kind: "error", code: err.code, status: err.status });
        } else {
          setPhase({ kind: "error", code: "server", status: 500 });
        }
      }
    })();
  }, [isAuthReady, user, token, hasRun, acceptAsync, router]);

  const handleGoToScanner = useCallback((): void => {
    if (phase.kind !== "success") return;
    if (phase.result.scope === "event" && phase.result.eventId) {
      router.replace(`/event/${phase.result.eventId}/scanner` as never);
    } else {
      router.replace("/(tabs)/home" as never);
    }
  }, [phase, router]);

  const handleGoHome = useCallback((): void => {
    router.replace("/(tabs)/home" as never);
  }, [router]);

  if (!isAuthReady || phase.kind === "loading") {
    return (
      <View style={styles.host}>
        <ActivityIndicator size="large" color={accent.warm} />
        <Text style={styles.copy}>Accepting your invitation…</Text>
      </View>
    );
  }

  if (phase.kind === "success") {
    const isBrand = phase.result.scope === "brand";
    return (
      <View style={styles.host}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {isBrand ? "You're a brand scanner" : "You're a scanner"}
          </Text>
          <Text style={styles.copy}>
            {isBrand
              ? "You can scan tickets at every event on this brand — now and later."
              : "You can scan tickets at this event. Open the scanner when you're at the door."}
          </Text>
          <Button
            label={isBrand ? "Go to Mingla" : "Open scanner"}
            onPress={handleGoToScanner}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>
    );
  }

  const { title, body } = errorCopyFor(phase.code, phase.status);
  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{body}</Text>
        <Button
          label="Back to Mingla"
          onPress={handleGoHome}
          variant="primary"
          size="lg"
          fullWidth
        />
      </View>
    </View>
  );
}

function errorCopyFor(
  code: string,
  status: number,
): { title: string; body: string } {
  switch (code) {
    case "invite_not_found":
      return {
        title: "Invitation not found",
        body: "This invitation link isn't valid. Ask the inviter to send a fresh one.",
      };
    case "invite_already_used":
      return {
        title: "Already accepted",
        body: "This invitation has already been used. If that wasn't you, contact the brand owner.",
      };
    case "invite_expired":
      return {
        title: "Invitation expired",
        body: "This invitation has expired. Ask the brand to send a new one (links are valid for 7 days).",
      };
    case "invite_email_mismatch":
      return {
        title: "Wrong account",
        body:
          "This invitation was sent to a different email. Sign in with the email that received the invite.",
      };
    case "invite_revoked":
      return {
        title: "Invitation revoked",
        body: "This invitation was withdrawn. Ask the brand to send a new one.",
      };
    case "validation":
      return {
        title: "Invalid link",
        body: "The invitation link is malformed. Open the email and click the button again.",
      };
    default:
      return {
        title: "Something went wrong",
        body: `We couldn't accept this invitation right now (status ${status}). Try again in a moment.`,
      };
  }
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  card: {
    maxWidth: 480,
    width: "100%",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  copy: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
  },
});
