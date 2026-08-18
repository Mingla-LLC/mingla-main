/**
 * DownloadMinglaCta — the ONE app card on the ticket confirmation screen.
 *
 * ISSUE #2217 rebuilt this. What it replaced, and why each part was wrong:
 *
 *  1. TWO BUTTONS. The card rendered "Open in Mingla" beside a hardcoded
 *     "Google Play" badge. The primary destination branched on
 *     `Platform.OS === 'ios' | 'android'` — but this screen is served to buyers
 *     as WEB (react-native-web), where `Platform.OS` is `'web'` for an iPhone
 *     and an Android alike. Both device arms were therefore DEAD CODE on the
 *     only surface that renders this card, the primary fell through to a
 *     universal link, and the secondary badge offered an iPhone the Play Store.
 *     Device-awareness now comes from `detectClientPlatform()` — the reviewed
 *     ORCH-1319 UA/platform/maxTouchPoints trio (incl. the iPad-as-Mac catch) —
 *     resolved through the same `resolveConfirmationAppTarget` SSOT that flips
 *     to a single OneLink at guest-funnel go-live.
 *
 *  2. A SEPARATE "See who's going in Mingla" CARD sat above it, owning the
 *     `attendance-claim-link` authority. #2217 deletes that card and folds its
 *     authority in here, so ONE card owns "get the app AND connect this ticket".
 *
 * WHAT THE ONE BUTTON DOES, in order:
 *   - app installed  → the `com.mingla.app.v2://attendance-claim#…` deep link
 *     opens Mingla with the single-use possession token, and the ticket binds
 *     to whichever account signs in there.
 *   - app NOT installed → the deep link does not take the navigation, and after
 *     the existing 1200ms window the SAME tap lands on the device's store.
 *     Nothing secret rides that URL: the ticket is reconnected after install by
 *     `attendance-claim-identity`, which matches the account's OWN
 *     provider-verified email/phone against the order. See the migration for
 *     why that is possession rather than knowledge.
 *
 * The claim link is an ENHANCEMENT, never a gate: while it is loading, errored,
 * rate-limited or terminally ineligible the button still renders and still
 * reaches the right store. A guest who never installs is unaffected either way.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import {
  detectClientPlatform,
  resolveConfirmationAppTarget,
  type Platform as DevicePlatform,
} from "../../services/guestFunnelLink";
import { Icon } from "../ui/Icon";

export type DownloadMinglaClaimPhase =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "terminal"
  | "rate";

interface DownloadMinglaCtaProps {
  eventName: string;
  eventType: "event" | "trip" | "experience";
  brandSlug: string;
  entitySlug: string;
  /** Phase of the `attendance-claim-link` mint owned by the confirm screen. */
  claimPhase: DownloadMinglaClaimPhase;
  /** The minted app deep link, or null in every non-ready phase. */
  claimAppUrl: string | null;
  /** Re-mint after a transient failure. */
  onRetryClaim: () => void;
}

/**
 * `detectClientPlatform` reads `navigator`, so it must not run during the web
 * SSR/hydration pass. Native has no navigator at all and resolves from
 * `Platform.OS`, which IS correct on a native build.
 */
const useDevicePlatform = (): DevicePlatform => {
  const nativePlatform: DevicePlatform | null =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
  const [platform, setPlatform] = useState<DevicePlatform>(nativePlatform ?? "other");
  useEffect(() => {
    if (nativePlatform !== null) return;
    setPlatform(detectClientPlatform());
  }, [nativePlatform]);
  return platform;
};

export const DownloadMinglaCta: React.FC<DownloadMinglaCtaProps> = ({
  eventName,
  eventType,
  brandSlug,
  entitySlug,
  claimPhase,
  claimAppUrl,
  onRetryClaim,
}) => {
  const platform = useDevicePlatform();
  const noun = eventType === "trip" ? "trip" : eventType === "experience" ? "experience" : "event";
  const target = useMemo(
    () =>
      resolveConfirmationAppTarget(
        { entityType: eventType, brandSlug, entitySlug },
        platform,
      ),
    [eventType, brandSlug, entitySlug, platform],
  );

  // ONE destination string, named per device so a screen reader hears where the
  // single button actually goes.
  const destinationLabel =
    target.mode === "onelink"
      ? "Open in Mingla, or install it"
      : platform === "ios"
        ? "Open in Mingla, or get it on the App Store"
        : platform === "android"
          ? "Open in Mingla, or get it on Google Play"
          : "Open in Mingla, or get the app";

  const open = (): void => {
    if (claimAppUrl === null) {
      void Linking.openURL(target.ctaUrl);
      return;
    }
    // The claim deep link first; the SAME tap continues to the store when the
    // app does not take the navigation. `fallbackUrl` (#2217) redirects that
    // fallback away from the two-store interstitial.
    void import("../../utils/attendanceClaimDeepLink").then(
      ({ openAttendanceClaimWithFallback }) =>
        openAttendanceClaimWithFallback(
          { appClaimUrl: claimAppUrl, webClaimUrl: target.ctaUrl, fallbackUrl: target.ctaUrl },
          Linking.openURL,
        ),
    ).catch(() => {
      void Linking.openURL(target.ctaUrl);
    });
  };

  return (
    <View style={styles.card} testID="confirm-app-cta">
      <View style={styles.iconWrap}>
        <Icon name="chat" size={20} color={accent.warm} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        Join your {noun} chat in the Mingla app
      </Text>
      <Text style={styles.body} numberOfLines={3}>
        Get updates, ask questions, and message other guests for {eventName}. Sign in
        with the email or phone you used here and this ticket is already waiting.
      </Text>
      <View style={styles.badgeRow}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={destinationLabel}
          style={styles.primaryBadge}
          testID="confirm-app-cta-primary"
          onPress={open}
        >
          <Icon name="download" size={16} color={textTokens.inverse} />
          <Text style={styles.primaryBadgeText}>Open in Mingla</Text>
        </Pressable>
      </View>
      {claimPhase === "error" ? (
        <View style={styles.claimNoteRow}>
          <Text style={styles.claimNote}>
            Your tickets are confirmed. We couldn’t prepare the Mingla link.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try preparing the Mingla link again"
            style={styles.secondaryBadge}
            testID="confirm-app-cta-retry"
            onPress={onRetryClaim}
          >
            <Text style={styles.secondaryBadgeText}>Try again</Text>
          </Pressable>
        </View>
      ) : claimPhase === "terminal" ? (
        <Text style={styles.claimNote}>
          Your tickets are confirmed. Guest-list access isn’t available for this order.
        </Text>
      ) : claimPhase === "rate" ? (
        <Text style={styles.claimNote}>
          Your tickets are confirmed. Try the Mingla link again in a few minutes.
        </Text>
      ) : claimPhase === "ready" ? null : (
        <Text style={styles.claimNote}>Preparing your Mingla link…</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  badgeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  primaryBadge: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  primaryBadgeText: {
    color: textTokens.inverse,
    fontWeight: "700",
  },
  claimNoteRow: {
    gap: spacing.sm,
  },
  claimNote: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  secondaryBadge: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  secondaryBadgeText: {
    color: textTokens.primary,
    fontWeight: "700",
  },
});

export default DownloadMinglaCta;
