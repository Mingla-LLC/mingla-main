/**
 * /accept-brand-invitation — landing route for brand-team invite links
 * (ORCH-1050).
 *
 * URL: https://business.usemingla.com/accept-brand-invitation?token=<raw>
 *
 * Flow:
 *   1. Read `token` from the URL.
 *   2. If the user isn't authenticated, send them to /auth and preserve the
 *      token via the `next` query param so /auth/callback can resume.
 *   3. POST { token } to the accept-brand-invitation edge fn (via
 *      acceptBrandInvitation service).
 *   4. On success → navigate to /brand/<brand_id>/team with a success banner.
 *      Distinguishes ownership transfer ("You're now the brand owner of …")
 *      from standard membership ("You're now on the … team").
 *   5. On error → render a friendly error state with the right copy per
 *      mapped status code (404/410/403).
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
import { useAcceptBrandInvitation } from "../src/hooks/useBrandInvitations";
import {
  BrandInvitationServiceError,
  type AcceptBrandInvitationResult,
} from "../src/services/brandInvitationsService";
import { supabase } from "../src/services/supabase";

type Phase =
  | { kind: "loading" }
  | { kind: "success"; result: AcceptBrandInvitationResult }
  | { kind: "error"; code: string; status: number };

export default function AcceptBrandInvitationRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  const { isAuthReady, user } = useAuth();
  const { mutateAsync: acceptAsync } = useAcceptBrandInvitation();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [hasRun, setHasRun] = useState<boolean>(false);

  useEffect(() => {
    if (!isAuthReady) return;
    if (token.length === 0) {
      setPhase({ kind: "error", code: "validation", status: 400 });
      return;
    }
    if (user === null) {
      const next = encodeURIComponent(`/accept-brand-invitation?token=${token}`);
      router.replace(`/auth?next=${next}` as never);
      return;
    }
    if (hasRun) return;
    setHasRun(true);
    void (async () => {
      try {
        // ORCH-1081 hotfix: AuthContext can report `user` as soon as the auth
        // event fires, but supabase-js's storage might not have flushed the
        // session yet — the next supabase.functions.invoke call would attach
        // the anon key as bearer and the edge fn would 401. Explicitly wait
        // for getSession() to return a real access_token before firing the
        // accept call.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (
            sessionData.session?.access_token &&
            sessionData.session.access_token.length > 0
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const result = await acceptAsync(token);
        setPhase({ kind: "success", result });
      } catch (err) {
        if (err instanceof BrandInvitationServiceError) {
          setPhase({ kind: "error", code: err.code, status: err.status });
        } else {
          setPhase({ kind: "error", code: "server", status: 500 });
        }
      }
    })();
  }, [isAuthReady, user, token, hasRun, acceptAsync, router]);

  const handleGoToTeam = useCallback((): void => {
    if (phase.kind !== "success") return;
    router.replace(`/brand/${phase.result.brandId}/team` as never);
  }, [phase, router]);

  // ORCH-1081 — once accept succeeds AND the brand was a partner setup, route
  // immediately to the celebration screen instead of staying on the inline
  // success card. This is the path most new owners take (link from email →
  // sign in → accept → celebration). For non-partner-setup accepts, we keep
  // the existing inline success card.
  useEffect(() => {
    if (phase.kind !== "success") return;
    if (!phase.result.partnerSetup) return;
    if (!phase.result.transferred) return;
    const params = new URLSearchParams();
    params.set("brand_id", phase.result.brandId);
    if (phase.result.brandSlug) params.set("brand", phase.result.brandSlug);
    if (phase.result.newOwnerFirstName) {
      params.set("owner_name", phase.result.newOwnerFirstName);
    }
    router.replace(
      `/accept-brand-invitation/success?${params.toString()}` as never,
    );
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
    const transferred = phase.result.transferred;
    return (
      <View style={styles.host}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {transferred ? "Ownership transferred" : "You're on the team"}
          </Text>
          <Text style={styles.copy}>
            {transferred
              ? "You're now the brand owner. Manage settings, team, and payouts from the team tab."
              : "You've joined the team. Head to the team tab to see your role."}
          </Text>
          <Button
            label="Go to team"
            onPress={handleGoToTeam}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>
    );
  }

  // Error states — copy keyed off mapped error code.
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
        body: "This invitation has expired. Ask the brand owner to send a new one (links are valid for 7 days).",
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
        body: "This invitation was withdrawn. Ask the brand owner to send a new one.",
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
