/**
 * /accept-brand-invitation — landing route for brand-team invite links
 * (ORCH-1050).
 *
 * URL: https://host.usemingla.com/accept-brand-invitation?token=<raw>
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
 *   4. Success → payments-capable partner setups that still need a bank go
 *      directly to /brand/:id/connect; standard team joins stay inline.
 *   5. Error → friendly copy per mapped code. Every code has copy.
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
import { BusinessAppDownloadCta } from "../src/components/invite/BusinessAppDownloadCta";
// ORCH-1404 [accept-invite-web-error-recovery] — the recoverable wrong-account
// screen (F-1) + the ONE `?next=` validator it routes through (reused, unchanged).
import { WrongAccountRecovery } from "../src/components/invite/WrongAccountRecovery";
// #2211 — the scroll host + pinned-action shell every invite surface renders
// into. Before it, all four branches below were a `flex: 1` +
// `justifyContent: "center"` View with no scroll container, so at the largest
// Dynamic Type setting the heading clipped off the TOP and the only Button
// left the accessibility tree with no gesture that recovered it.
import { InviteScreenShell } from "../src/components/invite/InviteScreenShell";
import { sanitizeNextRoute } from "../src/utils/nextRoute";
import {
  accent,
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
import {
  decideBankFirstInviteNext,
  withInviteFunnelParam,
} from "../src/utils/bankFirstPartnerInvite";

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
  // ORCH-1404 — `user` + `signOut` power the wrong-account recovery (see
  // handleSwitchAccount): show the signed-in email + sign out before resuming.
  const { authStatus, user, signOut } = useAuth();
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

  // #948 W3 — once accept succeeds, a payments-capable partner setup that does
  // not already have a payout rail goes straight to the one-hop bank route.
  // Transfer status is deliberately irrelevant: partner setups that did not
  // transfer still need the same bank step. D5 already-connected partners skip
  // bank and advance to the web get-app step; standard team/scanner joins stay
  // inline without that secondary.
  useEffect(() => {
    if (phase.kind !== "success") return;
    const decision = decideBankFirstInviteNext(phase.result);
    if (decision.kind !== "connect") return;
    // #948 W4 [web-skip-download] — tag the bank screen as invite-funnel so it
    // hides its top Back and offers Skip → {Download app | Continue on web}.
    router.replace(withInviteFunnelParam(decision.href) as never);
  }, [phase, router]);

  const handleGoHome = useCallback((): void => {
    router.replace("/(tabs)/home" as never);
  }, [router]);

  // ORCH-1404 [accept-invite-web-error-recovery] F-1 — the wrong-account escape.
  // Sign the current (wrong) user OUT, THEN resume the invite as a different
  // account via the ORCH-1373/1375 `?next=` path.
  //
  // WHY sign out FIRST (load-bearing): `/auth`'s STEP-2 resume effect fires
  // whenever `!loading && user`, so navigating to `/auth?next=` while still
  // signed in as the wrong account would immediately bounce back here and
  // re-fail as the same account (a loop). Signing out makes `user` null, so
  // `/auth` renders the sign-in screen and CAPTURES `next`; after the user signs
  // in as the correct account, the resume fires. Security is enforced by
  // `sanitizeNextRoute` inside buildSwitchAccountResume AND again at `/auth`.
  const handleSwitchAccount = useCallback(async (): Promise<void> => {
    if (token.length === 0) return;
    await signOut();
    router.replace(buildSwitchAccountResume(token) as never);
  }, [token, signOut, router]);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  // ORCH-1373 C-1373-C — PRECEDENCE IS STRICTLY: resolved `phase` > auth axis.
  // Once the outcome has resolved, rendering is a PURE FUNCTION OF `phase` and
  // MUST NOT consult auth state. The old gate (`!isAuthReady || phase.kind ===
  // "loading"`) let a late auth change re-mask an ALREADY-RESOLVED outcome — the
  // page returned to the spinner AFTER the accept had already succeeded.

  if (phase.kind === "success") {
    const transferred = phase.result.transferred;
    const decision = decideBankFirstInviteNext(phase.result);
    return (
      <InviteScreenShell
        actions={
          <>
            <Button
              label="Go to team"
              onPress={handleGoToTeam}
              variant="primary"
              size="lg"
              fullWidth
            />
            {decision.kind === "download" ? <BusinessAppDownloadCta /> : null}
          </>
        }
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {transferred ? "Ownership transferred" : "You're on the team"}
          </Text>
          <Text style={styles.copy}>
            {transferred
              ? "You're now the brand owner. Manage settings, team, and payouts from the team tab."
              : "You've joined the team. Head to the team tab to see your role."}
          </Text>
        </View>
      </InviteScreenShell>
    );
  }

  if (phase.kind === "error") {
    // ORCH-1404 F-1 — the wrong-account case is recoverable, not a dead end.
    // Every OTHER code keeps the existing single "Back to Mingla" card.
    if (phase.code === "invite_email_mismatch") {
      return (
        <WrongAccountRecovery
          signedInEmail={user?.email ?? null}
          onSwitchAccount={handleSwitchAccount}
          onGoHome={handleGoHome}
        />
      );
    }
    const { title, body } = errorCopyFor(phase.code);
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

  // `phase` is still unresolved → the auth axis decides what the user sees.

  // THE FIX. This branch is what every logged-out invitee gets instead of an
  // infinite spinner. It is provably REACHABLE for authStatus === "signed_out"
  // (orch_1373_mutual_exclusivity.test.ts, against the real authReadiness.ts).
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
            Sign in to accept this invitation. We'll bring you right back.
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

  // The ONLY legitimate spinners: auth genuinely transient, or the accept call
  // genuinely in flight.
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

/**
 * ORCH-1404 — the `?next=` resume target for the wrong-account recovery, built
 * through the ONE validator (`sanitizeNextRoute`). Exported + pure so the
 * routing is deterministically testable without a full-route render.
 *
 * The path prefix `/accept-brand-invitation` is hardcoded (only the token value
 * varies) and is on the NEXT_ROUTE_ALLOWLIST, so a well-formed token returns a
 * validated `/auth?next=<encoded>`; a value that fails validation falls back to
 * a bare `/auth` (still recoverable, never an unvalidated redirect).
 */
export function buildSwitchAccountResume(token: string): string {
  const candidate = `/accept-brand-invitation?token=${token}`;
  const safe = sanitizeNextRoute(candidate);
  if (safe === null) return "/auth";
  return `/auth?next=${encodeURIComponent(safe)}`;
}

export function errorCopyFor(code: string): { title: string; body: string } {
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
    // ORCH-1404 §4.3.1 — the JWT expired mid-flow (edge fn 401). Previously fell
    // through to `default`; now has its own copy.
    case "unauthenticated":
      return {
        title: "Sign in to continue",
        body: "Your session ended. Sign in again to accept this invitation.",
      };
    default:
      // ORCH-1404 OQ-3 — the generic branch is now reached ONLY by a truly
      // unknown or network error. Drop the raw "(status N)" number for users.
      return {
        title: "Something went wrong",
        body: "We couldn't accept this invitation right now. Try again in a moment.",
      };
  }
}

const styles = StyleSheet.create({
  // #2211 — `host` is GONE, not merely unused. It was `flex: 1` +
  // `justifyContent: "center"` with no scroll container: the exact shape that
  // clipped the heading off the top of the screen and pushed the only Button
  // out of the accessibility tree. InviteScreenShell owns the layout host now,
  // and deleting this entry means the broken shape cannot be reintroduced by
  // copying it.
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
