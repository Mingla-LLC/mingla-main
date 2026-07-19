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
 * LIMITATION (ORCH-1404 OQ-1): only the SIGNED-IN email is shown. The web 403
 * body is `{ error: "invite_email_mismatch" }` and carries NO invited address —
 * the edge fn deliberately does not leak it to a token holder. Showing the
 * invited email would require an out-of-scope edge-fn change.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../ui/Button";
import {
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export interface WrongAccountRecoveryProps {
  /** The email of the account currently signed in, or null when unknown. */
  signedInEmail: string | null;
  /** Signs the current user out and resumes the invite as a different account. */
  onSwitchAccount: () => void | Promise<void>;
  /** Secondary action — leave the flow. */
  onGoHome: () => void;
}

export function WrongAccountRecovery({
  signedInEmail,
  onSwitchAccount,
  onGoHome,
}: WrongAccountRecoveryProps): React.ReactElement {
  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Text style={styles.title}>Wrong account</Text>
        <Text style={styles.copy}>
          This invitation was sent to a different email. Sign in with the email
          that received the invite.
        </Text>
        {signedInEmail !== null ? (
          <Text style={styles.context}>You're signed in as {signedInEmail}.</Text>
        ) : null}
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
      </View>
    </View>
  );
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
  context: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
});

export default WrongAccountRecovery;
