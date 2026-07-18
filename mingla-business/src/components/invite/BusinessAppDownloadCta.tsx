/**
 * BusinessAppDownloadCta — ORCH-1378 [business invite download CTA].
 *
 * Shown on a SUCCESSFUL brand-invite accept (both success surfaces: the inline
 * card in `accept-brand-invitation.tsx` and the `success.tsx` celebration
 * screen). The invitee's membership is ALREADY granted server-side at this
 * point, so this CTA is purely "now get the app" — it can never strand anyone.
 *
 * ─── WHY SUCCESS-ONLY, AND NOT ON THE LOGGED-OUT SCREEN (ORCH-1373 OQ-1) ───
 * There is NO deferred deep-link continuity: an invitee who installs BEFORE
 * accepting cannot resume the invite inside the app. A pre-sign-in download
 * button would therefore send them AWAY from the only flow that works and lose
 * them. The CTA belongs after the accept has landed. (Flagged to Seth as OQ-1.)
 *
 * ─── ATTRIBUTION ───────────────────────────────────────────────────────────
 * ONE URL for every platform — the OneLink itself does the per-platform 301
 * (curl-verified 2026-07-15: Android → market://…&referrer=af_tranid…, iOS →
 * apps.apple.com/US/app/id6768737367). `referrer=af_tranid` IS the attribution;
 * it rides the Play Install Referrer into the install. So there is deliberately
 * NO client-side branching to store URLs here — branching would DESTROY the
 * attribution the OneLink exists to carry. Desktop is a legitimate target (it
 * 301s to the App Store listing) and is not special-cased.
 *
 * Attribution does NOT depend on this PR's artifact: the app an invitee installs
 * is whatever is already live in the store (1.1.2), and it already carries the
 * AppsFlyer SDK (ORCH-1378 F-10).
 *
 * ─── WEB-ONLY ──────────────────────────────────────────────────────────────
 * Renders on web only. On business native the user demonstrably ALREADY HAS the
 * app — an install CTA there is nonsense.
 */

import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Button } from "../ui/Button";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
// ORCH-1382 — the ONE business-side owner of "open an external destination".
// Do NOT re-roll window.open here: a `noopener`/`noreferrer` feature string makes
// open() return null EVEN ON SUCCESS, so a `if (!win)` fallback fires on every
// tap and the invite page navigates away as well as opening the tab. That bug was
// live in this very module until ORCH-1382.
//
// NOTE — no platform DETECTION is imported, deliberately. SPEC §4.4.5 asks for
// "device-aware … reuse detectClientPlatform()" AND for "One URL, no
// client-side branching to store URLs" — and the second clause leaves the first
// with nothing to decide: the OneLink's own 301 IS the device-awareness, and
// branching client-side to a store URL would DESTROY the af_tranid attribution
// (that is precisely why §4.4.4 replaces success.tsx's hand-rolled
// iOS/Android button pair). Calling detectClientPlatform() and discarding the
// result would be dead code (Constitution #8). Web-vs-native gating uses
// Platform.OS below, which is the correct tool for a render gate.
import {
  buildBusinessInviteDownloadUrl,
  openExternal,
} from "../../services/guestFunnelLink";

/**
 * The exact destination this CTA opens. Composed in the PURE guestFunnelLink
 * module (not inline here) so it is unit-testable under the node/ts-jest
 * harness — this component imports react-native and cannot be loaded there.
 */
export const BUSINESS_INVITE_CTA_URL = buildBusinessInviteDownloadUrl();

export interface BusinessAppDownloadCtaProps {
  testID?: string;
}

export function BusinessAppDownloadCta({
  testID,
}: BusinessAppDownloadCtaProps): React.ReactElement | null {
  const handlePress = useCallback((): void => {
    openExternal(BUSINESS_INVITE_CTA_URL);
  }, []);

  // Web-only by design (§4.4.5).
  if (Platform.OS !== "web") return null;

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.title}>Get the Mingla Business app</Text>
      <Text style={styles.body}>
        Manage your brand, sell tickets, and scan guests in from your phone.
      </Text>
      <Button
        label="Download the app"
        onPress={handlePress}
        variant="secondary"
        size="lg"
        fullWidth
        accessibilityLabel="Download the Mingla Business app"
      />
    </View>
  );
}

export default BusinessAppDownloadCta;

const styles = StyleSheet.create({
  host: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    borderRadius: radiusTokens.lg,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
});
