/**
 * WrongAccountRecovery — the recoverable "wrong account" screen for the brand
 * accept-invite flow (ORCH-1404 [accept-invite-web-error-recovery], F-1).
 *
 * WHAT WAS BROKEN: when an invite was sent to a different email than the one
 * signed in (edge fn → 403 `invite_email_mismatch`), the accept page showed a
 * single "Back to Mingla" button — a DEAD END. The invitee, simply signed in as
 * the wrong account, had no way to fix it.
 *
 * THE FIX: this screen offers a real "Sign in with a different email" action.
 * The route's `handleSwitchAccount` signs the current user OUT and resumes the
 * invite via the ORCH-1373/1375 `?next=` path (validated by `sanitizeNextRoute`).
 * "Back to Mingla" stays as the secondary action.
 *
 * PRESENTATIONAL ONLY. All navigation/sign-out lives in the route handler passed
 * as `onSwitchAccount`; extracting the screen makes the interactive recovery
 * action runtime-testable in isolation (interactive-elements-must-fire rule)
 * without mounting the whole expo-router + auth + query route.
 *
 * BOTH ADDRESSES (#3259): when the accept 403 names the invited address
 * (`invited_email`, token path only), the screen shows it beside the signed-in
 * one so the invitee knows which account to switch to. When the server does not
 * name it, the original copy with only the signed-in email is kept — the
 * invited address is never guessed.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../ui/Button";
// #2211 — the scroll host + pinned-action shell shared with both invitation
// routes. This screen has TWO full-width CTAs, so it overflowed a centred,
// non-scrolling root sooner than the screens it recovers from.
import { InviteScreenShell } from "./InviteScreenShell";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export interface WrongAccountRecoveryProps {
  /** The email of the account currently signed in, or null when unknown. */
  signedInEmail: string | null;
  /** The email the invitation was sent to, or null when the server did not say. */
  invitedEmail?: string | null;
  /** Signs the current user out and resumes the invite as a different account. */
  onSwitchAccount: () => void | Promise<void>;
  /** Secondary action — leave the flow. */
  onGoHome: () => void;
}

export function WrongAccountRecovery({
  signedInEmail,
  invitedEmail = null,
  onSwitchAccount,
  onGoHome,
}: WrongAccountRecoveryProps): React.ReactElement {
  return (
    <InviteScreenShell
      actions={
        <>
          <Button
            label="Sign in with a different email"
            onPress={onSwitchAccount}
            variant="primary"
            size="lg"
            fullWidth
          />
          <Button
            label="Back to Mingla"
            onPress={onGoHome}
            variant="ghost"
            size="lg"
            fullWidth
          />
        </>
      }
    >
      <View style={styles.card}>
        <Text style={styles.title}>Wrong account</Text>
        {invitedEmail !== null ? (
          <>
            <Text style={styles.copy}>
              This invitation was sent to a different email than the one
              you're signed in with.
            </Text>
            <View style={styles.rows}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Invited</Text>
                <Text style={styles.rowValue}>{invitedEmail}</Text>
              </View>
              {signedInEmail !== null ? (
                <View style={[styles.row, styles.rowDivided]}>
                  <Text style={styles.rowLabel}>Signed in as</Text>
                  <Text style={styles.rowValue}>{signedInEmail}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.copy}>
              Sign in with {invitedEmail} to accept it.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.copy}>
              This invitation was sent to a different email. Sign in with the
              email that received the invite.
            </Text>
            {signedInEmail !== null ? (
              <Text style={styles.context}>
                You're signed in as {signedInEmail}.
              </Text>
            ) : null}
          </>
        )}
      </View>
    </InviteScreenShell>
  );
}

const styles = StyleSheet.create({
  // #2211 — `host` is GONE. This screen carried TWO full-width CTAs inside a
  // centred, non-scrolling `flex: 1` root, so it overflowed sooner than the
  // single-CTA invitation screens it recovers from. InviteScreenShell owns the
  // layout host now; both CTAs live in its pinned footer.
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
  rows: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
  },
  row: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.secondary,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  rowValue: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
    lineHeight: 21,
  },
  context: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
});

export default WrongAccountRecovery;
