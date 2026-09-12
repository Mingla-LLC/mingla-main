/**
 * SignedInNotFoundNotice — the signed-in identity block for screens that cannot
 * show the thing the user asked for (#3259 [wrong account reads as a crash]).
 *
 * WHAT WAS BROKEN: Seth was signed in as one account, was returned from Stripe
 * onboarding to a route that account cannot resolve, and got the generic 404:
 * "Hmm, that's not a real page." / "Maybe a typo? Or it moved?". On WEB that
 * screen is SIGNED-IN-ONLY — a signed-out visitor is intercepted upstream
 * (`app/_layout.tsx` via `shouldRedirectToSignInFromRoute`) and sent to `/`. So
 * the one population whose identity the product could name was the population
 * it sent hunting for a typo instead.
 *
 * WHAT THIS IS: the reusable half of the fix — the block that names the session
 * and offers a real way out. It states a POSSIBILITY and never a diagnosis:
 *
 *   `missing`    — the route resolved to nothing. True for `+not-found`, which
 *                  is a pure routing outcome and receives no status, no error
 *                  and no props: it can NEVER be an authorisation failure, so
 *                  this copy must never claim one.
 *   `restricted` — an authed detail row came back empty. The client genuinely
 *                  CANNOT tell "deleted" from "filtered by RLS": PostgREST
 *                  `.maybeSingle()` returns `{data: null, error: null}` for
 *                  both. So the copy names both possibilities and asserts
 *                  neither. Naming the signed-in account needs no discriminator
 *                  and leaks nothing — it is the viewer's own address.
 *
 * PROPS, NOT `useAuth()` (deliberate). Two reasons: the default jest config is
 * `testEnvironment: "node"` and calls screens as plain functions, where a
 * context read throws; and the public buyer routes (`/checkout/`, `/e/`, `/b/`,
 * `/t/`) are anon-tolerant and MUST NOT reach `useAuth` (Engineering Handbook
 * §5). A props-only component physically cannot pull auth in behind their back.
 *
 * RENDERS NOTHING when there is no signed-in email — a signed-out viewer, or a
 * session that has not resolved yet, sees the host screen exactly as it was.
 * Callers pass `null` until `isAuthReady`, so there is no flash of a
 * half-resolved identity.
 *
 * Visual language is `src/components/invite/WrongAccountRecovery.tsx` (the
 * shipped ORCH-1404 wrong-account screen) — same card, same "You're signed in
 * as …" line. That file is NOT forked; this is the smaller, embeddable sibling.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../ui/Button";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export type SignedInNotFoundVariant = "missing" | "restricted";

/**
 * The body copy per variant. Exported so callers and gates can assert the exact
 * sentence without re-typing it, and so the honesty contract lives in ONE place.
 *
 * Neither line claims a permission denial, neither blames the reader for a
 * typo, and neither asserts the thing exists.
 */
export const SIGNED_IN_NOT_FOUND_COPY: Record<SignedInNotFoundVariant, string> =
  {
    missing:
      "If the link was meant for a different account, switch accounts and open it again.",
    restricted:
      "It may have been deleted, or it may not be visible to this account.",
  };

/** The recovery action's label — one string, used as both label and a11y label. */
export const SWITCH_ACCOUNT_LABEL = "Switch account";

export interface SignedInNotFoundNoticeProps {
  /** Which honest possibility this host screen is in. */
  variant: SignedInNotFoundVariant;
  /**
   * The signed-in account's email, or null when signed out OR when auth has not
   * resolved yet. Null renders NOTHING.
   */
  signedInEmail: string | null;
  /**
   * Signs the current user out and sends them to sign-in. The caller MUST await
   * the sign-out before navigating — see the callers for why that ordering is
   * load-bearing.
   */
  onSwitchAccount: () => void | Promise<void>;
  testID?: string;
}

export function SignedInNotFoundNotice({
  variant,
  signedInEmail,
  onSwitchAccount,
  testID,
}: SignedInNotFoundNoticeProps): React.ReactElement | null {
  // No session to name → render nothing at all. A signed-out visitor must see
  // the host screen's original copy, byte for byte.
  if (signedInEmail === null || signedInEmail.length === 0) return null;

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.copy}>{SIGNED_IN_NOT_FOUND_COPY[variant]}</Text>
      <Text style={styles.context}>You're signed in as {signedInEmail}.</Text>
      <Button
        label={SWITCH_ACCOUNT_LABEL}
        onPress={onSwitchAccount}
        variant="secondary"
        size="md"
        accessibilityLabel={SWITCH_ACCOUNT_LABEL}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: 480,
    width: "100%",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  copy: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
    textAlign: "left",
  },
  context: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    textAlign: "left",
  },
});

export default SignedInNotFoundNotice;
