/**
 * /accept-brand-invitation — landing route for brand-team invite links
 * (ORCH-1050).
 *
 * URL: https://business.usemingla.com/accept-brand-invitation?token=<raw>
 *
 * ─── ORCH-1373 [accept-invite-infinite-loader] — WHAT WAS BROKEN ───────────
 * Every logged-out invitee — i.e. essentially EVERY invitee, since an invitee is
 * by definition someone clicking a link in an email — hit an infinite
 * "Accepting your invitation…" spinner. It never accepted, never errored, never
 * said anything. Lifetime funnel: 0 accepted of 1 sent.
 *
 * THE CAUSE, and the trap for whoever edits this next:
 *
 *     if (!isAuthReady) return;                              // ← fired forever
 *     …
 *     if (user === null) { router.replace('/auth?next=…') }  // ← UNREACHABLE
 *
 * `isBusinessAuthReady` is true ONLY for `authStatus === "signed_in_ready"`
 * (authReadiness.ts:108-112), and a logged-out visitor is terminally
 * `signed_out` (:85-106). The two are MUTUALLY EXCLUSIVE — 0 of 12 exhaustive
 * combinations could reach that redirect. It had never executed in production.
 *
 * ⚠️ THE RULE THAT FOLLOWS: `!isAuthReady` is **NOT** "still loading". For a
 * logged-out user it is a TERMINAL state. Any `user === null` branch beneath an
 * `if (!isAuthReady) return;` is DEAD CODE. Branch on `authStatus`, never on the
 * boolean. (I-PROPOSED-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE; proven by
 * src/utils/__tests__/orch_1373_mutual_exclusivity.test.ts against the real
 * shipped module.)
 *
 * ─── THE SHAPE NOW: TWO INDEPENDENT AXES, NEVER ONE SPINNER ────────────────
 *   Axis 1 — auth resolution: bootstrapping (transient) vs RESOLVED
 *            (signed_out | signed_in_ready | error).
 *   Axis 2 — invite outcome: unknown vs resolved(success|error).
 * A spinner is legitimate ONLY while Axis 1 is genuinely transient, or while an
 * accept call is actually in flight. `signed_out` is TERMINAL and ACTIONABLE —
 * it renders a real screen.
 *
 * Flow:
 *   1. Read `token` from the URL.
 *   2. Logged out → render "You're invited" + Sign in (which RESUMES back here
 *      via ?next= — ORCH-1375; without that resume this fix would convert the
 *      spinner into a SILENT TOKEN DROP, which is worse).
 *   3. Signed in → POST { token } to the accept-brand-invitation edge fn.
 *   4. Success → inline card (+ download CTA) or, for partner-setup ownership
 *      transfers, the celebration screen.
 *   5. Error → friendly copy per mapped code. Every code has copy.
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
import { BusinessAppDownloadCta } from "../src/components/invite/BusinessAppDownloadCta";
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

type Phase =
  | { kind: "loading" }
  | { kind: "success"; result: AcceptBrandInvitationResult }
  | { kind: "error"; code: string; status: number };

export default function AcceptBrandInvitationRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  // ORCH-1373 C-1373-A — branch on `authStatus`, NOT on `isAuthReady`. Deriving
  // the spinner from the boolean is the bug.
  const { authStatus } = useAuth();
  const { mutateAsync: acceptAsync } = useAcceptBrandInvitation();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [hasRun, setHasRun] = useState<boolean>(false);

  useEffect(() => {
    // Axis 1 still genuinely transient — wait (this is the ONLY legitimate wait).
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
        // ORCH-1373 C-1373-D — the 10×150ms getSession() retry loop that used to
        // sit here is DELETED, not preserved. It was dead: reaching it required
        // isAuthReady === true, which ALREADY requires hasUsableBusinessSession
        // (a non-empty access_token — authReadiness.ts:37-41, 108-112). ORCH-1377
        // F-2 additionally measured getSession() at ZERO network calls on this
        // path. It could only ever spin on a storage-flush race the gate already
        // closes, while costing up to 1.5s on every accept.
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
  }, [authStatus, token, hasRun, acceptAsync]);

  const handleGoToTeam = useCallback((): void => {
    if (phase.kind !== "success") return;
    router.replace(`/brand/${phase.result.brandId}/team` as never);
  }, [phase, router]);

  const handleSignIn = useCallback((): void => {
    // ORCH-1375 — the resume. `/auth` now READS this (it had 4 writers and 0
    // readers), and the sessionStorage handoff carries it across the OAuth
    // round-trip that destroys the URL. Without that, this button would be a
    // silent token drop dressed as success.
    const next = encodeURIComponent(`/accept-brand-invitation?token=${token}`);
    router.replace(`/auth?next=${next}` as never);
  }, [router, token]);

  const handleRetryAuth = useCallback((): void => {
    // A hard reload is the honest retry for a failed auth bootstrap: it re-runs
    // the whole bootstrap rather than pretending we can recover in place.
    if (typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    router.replace(`/accept-brand-invitation?token=${token}` as never);
  }, [router, token]);

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

  // ─── RENDER ──────────────────────────────────────────────────────────────
  // ORCH-1373 C-1373-C — PRECEDENCE IS STRICTLY: resolved `phase` > auth axis.
  // Once the outcome has resolved, rendering is a PURE FUNCTION OF `phase` and
  // MUST NOT consult auth state. The old gate (`!isAuthReady || phase.kind ===
  // "loading"`) let a late auth change re-mask an ALREADY-RESOLVED outcome — the
  // page returned to the spinner AFTER the accept had already succeeded.

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
          {/* ORCH-1378 — membership is already granted server-side by here, so
              this CTA can never strand anyone. Web-only by design. */}
          <BusinessAppDownloadCta />
        </View>
      </View>
    );
  }

  if (phase.kind === "error") {
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

  // `phase` is still unresolved → the auth axis decides what the user sees.

  // THE FIX. This branch is what every logged-out invitee gets instead of an
  // infinite spinner. It is provably REACHABLE for authStatus === "signed_out"
  // (orch_1373_mutual_exclusivity.test.ts, against the real authReadiness.ts).
  if (authStatus === "signed_out") {
    return (
      <View style={styles.host}>
        <View style={styles.card}>
          <Text style={styles.title}>You're invited</Text>
          <Text style={styles.copy}>
            Sign in to accept this invitation. We'll bring you right back.
          </Text>
          <Button
            label="Sign in"
            onPress={handleSignIn}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>
    );
  }

  if (authStatus === "error") {
    return (
      <View style={styles.host}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.copy}>
            We couldn't check your sign-in. Try again in a moment.
          </Text>
          <Button
            label="Try again"
            onPress={handleRetryAuth}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </View>
    );
  }

  // The ONLY legitimate spinners: auth genuinely transient, or the accept call
  // genuinely in flight.
  return (
    <View style={styles.host}>
      <ActivityIndicator size="large" color={accent.warm} />
      <Text style={styles.copy}>
        {authStatus === "signed_in_ready"
          ? "Accepting your invitation…"
          : "Checking your invitation…"}
      </Text>
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
    // ORCH-1373 §4.1.4 — the edge fn (accept-brand-invitation/index.ts:96-116)
    // returns SEVEN codes; this map handled five. The two below fell through to
    // `default`, which says "Try again in a moment." — actively WRONG: both are
    // PERMANENT, non-retryable states, and currency_mismatch is ACTIONABLE.
    // Copy is lifted verbatim from the approved sibling
    // src/components/team/InvitePendingSheet.tsx:159-166, not invented.
    case "invite_declined":
      return {
        title: "Invitation declined",
        body: "This invitation was declined. Ask the brand owner to send a new one.",
      };
    case "invite_currency_mismatch":
      return {
        title: "Connect your bank first",
        body: "Connect your bank to accept this brand.",
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
