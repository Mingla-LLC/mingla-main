/**
 * /accept-scanner-invitation — landing route for scanner-invite links
 * (ORCH-1051).
 *
 * URL: https://host.usemingla.com/accept-scanner-invitation?token=<raw>
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
 *
 * ─── ORCH-1374 [accept-scanner-invite-infinite-loader] ─────────────────────
 * This route was a LINE-FOR-LINE CLONE of accept-brand-invitation.tsx's dead
 * auth gate: `if (!isAuthReady) return;` sitting ABOVE `if (user === null) {
 * router.replace('/auth?next=…') }`. Those are MUTUALLY EXCLUSIVE
 * (`isBusinessAuthReady` is true ONLY for authStatus === "signed_in_ready";
 * a logged-out visitor is terminally `signed_out`), so the redirect was DEAD
 * CODE and a logged-out scanner would have spun forever.
 *
 * A LOADED LANDMINE, NOT A LIVE FIRE: production `scanner_invitations` = 0 rows,
 * so this has never actually burned anyone. Fixed now because the shared-module
 * fix makes it nearly free — and because the day the first scanner invite is
 * sent is a bad day to discover it.
 *
 * ⚠️ `!isAuthReady` is NOT "still loading" — for a logged-out user it is
 * TERMINAL. Branch on `authStatus`. (I-PROPOSED-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE)
 *
 * DELIBERATE DIFFERENCES from the brand route (all three are binding):
 *  - No getSession() retry loop to remove — this route never had one.
 *  - No `invite_declined` / `invite_currency_mismatch` copy: the scanner edge fn
 *    (accept-scanner-invitation/index.ts:57-65) returns only FIVE codes and
 *    neither of those. Adding them here would be DEAD COPY.
 *  - No download CTA: a scanner accepting at a door is not a business-app
 *    install target.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — every render path goes through InviteScreenShell, which wraps in SafeAreaView (#2211)
// orch-strict-grep-allow fullscreen-route-must-scroll — every render path goes through InviteScreenShell, whose content region is a ScrollView (#2211)
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button } from "../src/components/ui/Button";
// #2211 — the scroll host + pinned-action shell. Before it, all five branches
// below were a `flex: 1` + `justifyContent: "center"` View with no scroll
// container, so at the largest Dynamic Type setting the heading measured at
// [65,-103] (off the TOP of the screen) and the only Button was absent from
// the accessibility tree with no gesture that recovered it.
import { InviteScreenShell } from "../src/components/invite/InviteScreenShell";
import {
  accent,
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

  // ORCH-1374 — branch on authStatus, never on the isAuthReady boolean.
  const { authStatus } = useAuth();
  const { mutateAsync: acceptAsync } = useAcceptScannerInvitation();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [hasRun, setHasRun] = useState<boolean>(false);

  useEffect(() => {
    // The ONLY legitimate wait: auth genuinely transient.
    if (authStatus === "bootstrapping" || authStatus === "refreshing") return;
    if (token.length === 0) {
      setPhase({ kind: "error", code: "validation", status: 400 });
      return;
    }
    // Terminal, actionable auth states render screens — they do NOT accept.
    if (authStatus === "signed_out" || authStatus === "error") return;
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
  }, [authStatus, token, hasRun, acceptAsync]);

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

  const handleSignIn = useCallback((): void => {
    // ORCH-1375 — /auth now READS this and the sessionStorage handoff carries it
    // across the OAuth round-trip that destroys the URL.
    const next = encodeURIComponent(`/accept-scanner-invitation?token=${token}`);
    router.replace(`/auth?next=${next}` as never);
  }, [router, token]);

  const handleRetryAuth = useCallback((): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    router.replace(`/accept-scanner-invitation?token=${token}` as never);
  }, [router, token]);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  // ORCH-1374 (C-1373-C) — PRECEDENCE: resolved `phase` > auth axis. Once the
  // outcome resolves, rendering is a pure function of `phase` and must never be
  // re-masked by a later auth change.

  if (phase.kind === "success") {
    const isBrand = phase.result.scope === "brand";
    return (
      <InviteScreenShell
        actions={
          <Button
            label={isBrand ? "Go to Mingla" : "Open scanner"}
            onPress={handleGoToScanner}
            variant="primary"
            size="lg"
            fullWidth
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {isBrand ? "You're a brand scanner" : "You're a scanner"}
          </Text>
          <Text style={styles.copy}>
            {isBrand
              ? "You can scan tickets at every event on this brand — now and later."
              : "You can scan tickets at this event. Open the scanner when you're at the door."}
          </Text>
        </View>
      </InviteScreenShell>
    );
  }

  if (phase.kind === "error") {
    const { title, body } = errorCopyFor(phase.code, phase.status);
    return (
      <InviteScreenShell
        actions={
          <Button
            label="Back to Mingla"
            onPress={handleGoHome}
            variant="primary"
            size="lg"
            fullWidth
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.copy}>{body}</Text>
        </View>
      </InviteScreenShell>
    );
  }

  // `phase` unresolved → the auth axis decides.

  // THE FIX — provably reachable for authStatus === "signed_out" (the branch the
  // old `if (!isAuthReady) return;` made unreachable).
  if (authStatus === "signed_out") {
    return (
      <InviteScreenShell
        actions={
          <Button
            label="Sign in"
            onPress={handleSignIn}
            variant="primary"
            size="lg"
            fullWidth
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.title}>You're invited</Text>
          <Text style={styles.copy}>
            Sign in to accept this scanner invitation. We'll bring you right back.
          </Text>
        </View>
      </InviteScreenShell>
    );
  }

  if (authStatus === "error") {
    return (
      <InviteScreenShell
        actions={
          <Button
            label="Try again"
            onPress={handleRetryAuth}
            variant="primary"
            size="lg"
            fullWidth
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.copy}>
            We couldn't check your sign-in. Try again in a moment.
          </Text>
        </View>
      </InviteScreenShell>
    );
  }

  // The ONLY legitimate spinners.
  return (
    <InviteScreenShell>
      <ActivityIndicator size="large" color={accent.warm} />
      <Text style={styles.copy}>
        {authStatus === "signed_in_ready"
          ? "Accepting your invitation…"
          : "Checking your invitation…"}
      </Text>
    </InviteScreenShell>
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
  // #2211 — `host` is GONE, not merely unused: `flex: 1` +
  // `justifyContent: "center"` with no scroll container is the exact shape that
  // stranded an invited scanner. InviteScreenShell owns the layout host now.
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
