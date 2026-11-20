/**
 * TicketCheckoutAccessNotice (web / DEFAULT half) — issue #2101
 * [named-buyer checkout]. Amendment 1 §A7 as respelled by Amendment 8 §A8.1.
 *
 * Platform isolation is filename-enforced by the `.native` OVERRIDE (Metro
 * resolves `X.native.tsx` before `X.tsx` on iOS/Android).
 *
 * The SOLE public explanatory UI for a restricted ticket sale. It is advisory:
 * the server decides, and a buyer who bypasses every client control still gets
 * 401/403 from `ticket-checkout-create` with zero provider side effects.
 *
 * PRIVACY (original SPEC §3/§4). This component renders NO membership fact —
 * no member UUID, username, display name, avatar, member count, config
 * revision or epoch — and it draws NO distinction between an absent, private,
 * inactive and blocked account. Every non-allowed authenticated buyer sees the
 * same generic explanation.
 *
 * It renders NOTHING when the sale is unrestricted or the viewer is allowed, so
 * an ordinary public offering is byte-identical to today.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { usePublicTicketCheckoutRouteAccess } from "../../hooks/usePublicTicketCheckoutRouteAccess";
import { BuyerConnectionNotice } from "../buyer/BuyerConnectionNotice";

export interface TicketCheckoutAccessNoticeProps {
  /** The offering's canonical events-row UUID. */
  eventId: string;
  testID?: string;
}

export const TicketCheckoutAccessNotice: React.FC<
  TicketCheckoutAccessNoticeProps
> = ({ eventId, testID = "issue-2101-checkout-access-notice" }) => {
  const access = usePublicTicketCheckoutRouteAccess(eventId);

  if (access.state === "unrestricted" || access.state === "allowed") return null;

  if (access.state === "loading") {
    return (
      <View
        style={styles.host}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        testID={`${testID}-loading`}
      >
        <Text style={styles.title}>Checking this sale</Text>
        <Text style={styles.body}>
          One moment — we&rsquo;re confirming whether this sale is open to you.
        </Text>
      </View>
    );
  }

  if (access.state === "error") {
    // #4518 — the one connection notice (inline). testIDs kept: the
    // wrapper is `…-error` (one node) and its Try again is `…-retry`; Buy stays paused
    // while access is unknown (fail-closed, unchanged).
    return (
      <View testID={`${testID}-error`}>
        <BuyerConnectionNotice
          variant="accessCheck"
          onRetry={access.retry}
          testID={`${testID}-error-notice`}
          retryTestID={`${testID}-retry`}
        />
      </View>
    );
  }

  if (access.state === "sign_in_required") {
    return (
      <View
        style={styles.host}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        testID={`${testID}-sign-in`}
      >
        <Text style={styles.title}>Restricted sale</Text>
        <Text style={styles.body}>
          Sign in with an approved Mingla account to continue.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.host}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      testID={`${testID}-restricted`}
    >
      <Text style={styles.title}>Restricted sale</Text>
      <Text style={styles.body}>
        The organizer has limited this sale to specific Mingla accounts. This
        account isn&rsquo;t able to buy here.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    borderRadius: radiusTokens.md,
    // issue #4420 — the notice floats over the page (absolute wrap), so it
    // needs its own opaque surface: without one its text sat on top of the
    // event copy scrolling beneath it.
    backgroundColor: color.card2,
    borderWidth: 1,
    borderColor: color.lineStrong,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: 4,
  },
  title: {
    fontSize: type.body.fontSize,
    fontWeight: "800",
    color: color.text1,
  },
  body: {
    fontSize: type.caption.fontSize,
    lineHeight: 18,
    color: color.text2,
  },
});
