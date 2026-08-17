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
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { usePublicTicketCheckoutRouteAccess } from "../../hooks/usePublicTicketCheckoutRouteAccess";

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
    return (
      <View
        style={styles.host}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={`${testID}-error`}
      >
        <Text style={styles.title}>We couldn&rsquo;t check this sale</Text>
        <Text style={styles.body}>
          Buying is paused until we can confirm access. Check your connection
          and try again.
        </Text>
        <Pressable
          onPress={access.retry}
          accessibilityRole="button"
          accessibilityLabel="Try checking this sale again"
          style={styles.retry}
          testID={`${testID}-retry`}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
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
    borderWidth: 1,
    borderColor: accent.warm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: "800",
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  retry: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: accent.warm,
  },
  retryText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
});
