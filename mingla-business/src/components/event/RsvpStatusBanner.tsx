/**
 * RsvpStatusBanner — the pill at the top of a public RSVP page while the event
 * can still take replies: a countdown to the start ("Starts in 11 days",
 * "Starts in 5 hours", "Starting soon"), "Happening now", "Ended", or the
 * guest-list-full wording.
 *
 * It replaces the ticket banner on RSVP events. That banner came from the
 * ticket state machine, which has no tickets to look at on an RSVP row and so
 * told every guest "Not on sale yet" on a free event that was open for replies.
 *
 * The copy is owned by the pure `resolveRsvpStatusBanner` (absolute instants
 * only, so every viewer sees the same countdown whatever their device
 * timezone). This component only re-renders itself when the copy can change,
 * so the rest of the page does not re-render every minute.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";
import {
  resolveRsvpStatusBanner,
  rsvpStatusBannerRefreshDelayMs,
} from "@mingla/offering-rendering/rsvpStatusBanner";

export interface RsvpStatusBannerProps {
  palette: ThemePalette;
  startAtUtc: string | null | undefined;
  endAtUtc: string | null | undefined;
  capacityFull: boolean;
  waitlistEnabled: boolean;
  manualApproval: boolean;
  /** Test seam: the clock. Defaults to Date.now. */
  now?: () => number;
  testID?: string;
}

export const RsvpStatusBanner: React.FC<RsvpStatusBannerProps> = ({
  palette,
  startAtUtc,
  endAtUtc,
  capacityFull,
  waitlistEnabled,
  manualApproval,
  now = Date.now,
  testID = "rsvp-status-banner",
}) => {
  const [nowMs, setNowMs] = useState<number>(() => now());

  useEffect(() => {
    const delay = rsvpStatusBannerRefreshDelayMs({ startAtUtc, endAtUtc, nowMs });
    const timer = setTimeout(() => setNowMs(now()), delay);
    return () => clearTimeout(timer);
  }, [endAtUtc, now, nowMs, startAtUtc]);

  const banner = resolveRsvpStatusBanner({
    startAtUtc,
    endAtUtc,
    nowMs,
    capacityFull,
    waitlistEnabled,
    manualApproval,
  });
  if (banner === null) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: palette.card }]}
      testID={testID}
    >
      <Text
        style={[styles.bannerText, { color: palette.secondaryText }]}
        testID={`${testID}-label`}
      >
        {banner.label}
      </Text>
    </View>
  );
};

// Same pill as the page's ticket-state banner (PublicEventPage styles.banner).
const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});

export default RsvpStatusBanner;
