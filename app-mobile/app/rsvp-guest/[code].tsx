// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * issue #4508 1.16-1.21 — /rsvp-guest/{code}: "{Inviter} saved you a spot".
 * Opened by the shell when a usemingla.com/c/<code> (or app-scheme) link is an
 * RSVP guest link, by deep_link_value=rsvp_guest after install, and by the
 * held code once the person has signed in and finished onboarding.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { RsvpGuestClaimScreen } from "../../src/components/rsvpGuest/RsvpGuestClaimScreen";

export default function RsvpGuestRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  return <RsvpGuestClaimScreen code={typeof code === "string" ? code : ""} />;
}
