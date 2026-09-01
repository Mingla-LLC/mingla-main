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
import type { PressableStateCallbackType, ViewStyle } from "react-native";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import {
  detectClientPlatform,
  openAppScheme,
  openExternal,
  resolveConfirmationAppTarget,
  type Platform as DevicePlatform,
} from "../../services/guestFunnelLink";
// issue #2326 — STATIC import, deliberately. This module used to be pulled in
// with a dynamic `import()` from inside the tap handler; see `open()` below for
// why that must never come back.
import { openAttendanceClaimWithFallback } from "../../utils/attendanceClaimDeepLink";
import { Icon } from "../ui/Icon";

export type DownloadMinglaClaimPhase =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable"
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

type WebTransitionStyle = ViewStyle & {
  transitionProperty: "opacity";
  transitionDuration: "0ms" | "150ms";
};

const webTransitionStyle = (reducedMotion: boolean): WebTransitionStyle => ({
  transitionProperty: "opacity",
  transitionDuration: reducedMotion ? "0ms" : "150ms",
});

const useReducedMotionOnWeb = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(() =>
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return undefined;
    const update = (): void => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return (): void => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
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
  const reducedMotion = useReducedMotionOnWeb();
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

  /**
   * issue #2326 — the tap MUST reach a destination.
   *
   * Two things were wrong here and both are fixed above and below.
   *
   * 1. `Linking.openURL`. On buyer-web react-native-web turns that into
   *    `window.open(url, '_blank', 'noopener')` — the exact null-returning
   *    feature string ORCH-1381/1382 banned from this repo, re-entering
   *    through a library instead of a call site, and with NO popup-blocked
   *    fallback at all, so a blocked open is a completely silent dead tap.
   *    Everything now goes through this package's ONE owner
   *    (`openExternal` / `openAppScheme` in guestFunnelLink.ts), which drops
   *    the feature string, severs `opener`, and falls back to an in-place
   *    assign when the popup is genuinely blocked.
   *
   * 2. A dynamic `import()` inside the handler. It happens to survive on
   *    Chrome (measured on a real Galaxy A72: a `window.open` after a 236 ms
   *    dynamic import still returned a live window, because Chrome's transient
   *    activation is a 5 s timer), but WebKit is not Chrome and a navigation
   *    that depends on a network round-trip completing first is a navigation
   *    that can be refused. It is also simply unnecessary: the module is a
   *    pure ~40-line helper.
   *
   *    NOTHING may return to the event loop between the gesture and the
   *    navigation. `openAttendanceClaimWithFallback` is `async`, but its body
   *    runs synchronously up to its first `await` — and the deep-link
   *    `openUrl(appClaimUrl)` call is BEFORE that await, so the app is reached
   *    inside the gesture. `issue2326CtaGesture.render.test.tsx`
   *    fails if an `await` or an `import()` is ever put back in front of it.
   */
  const navigateFromTap = (url: string): Promise<unknown> => {
    if (Platform.OS !== "web") return Linking.openURL(url);
    // A non-http destination is the app scheme: same tab, never a new one.
    if (!/^https?:/i.test(url)) {
      openAppScheme(url);
      return Promise.resolve();
    }
    openExternal(url);
    return Promise.resolve();
  };

  /**
   * issue #2326 — MEASURED ON WEBKIT (iOS 26.5 Safari, real tap):
   * navigating to an unhandled custom scheme raises a blocking system alert,
   *
   *     "Safari cannot open the page because the address is invalid."
   *
   * and this card's whole audience is a guest who has just been told to GET the
   * app — i.e. mostly does not have it yet. The pre-#2326 shape was worse
   * (`window.open(scheme,'_blank')` raised the same alert AND left a dead tab
   * behind), but "worse before" is not a reason to keep it.
   *
   * Chrome does not do this: on a real Galaxy A72 the unhandled scheme was
   * silently ignored, the page stayed put, and the 1200 ms fallback took the
   * SAME tap to the Play Store. So the deep link is attempted on Android and
   * skipped on iOS-web, where the tap goes straight to the App Store instead.
   *
   * NOTHING IS LOST. The deep link is an optimisation, never the mechanism
   * (#2217): the ticket is reconnected after install by
   * `attendance-claim-identity`, matching the account's own provider-verified
   * email or phone against the order — which is exactly what #2323 restored by
   * arming free orders again. An iPhone owner who already has Mingla lands on
   * an App Store page whose button reads OPEN.
   *
   * THIS IS TEMPORARY BY DESIGN. When Seth flips `GUEST_FUNNEL_ONELINK_URL`
   * the destination becomes a UNIVERSAL link, which iOS routes to the app with
   * no alert and no scheme, and this branch stops mattering.
   *
   * Native is unaffected: `Linking.openURL` on a real build resolves schemes
   * through the OS, not through a browser.
   */
  const appSchemeIsSafeHere = Platform.OS !== "web" || platform !== "ios";

  const open = (): void => {
    if (claimAppUrl === null || !appSchemeIsSafeHere) {
      void navigateFromTap(target.ctaUrl);
      return;
    }
    // The claim deep link first; the SAME tap continues to the store when the
    // app does not take the navigation. `fallbackUrl` (#2217) redirects that
    // fallback away from the two-store interstitial.
    void openAttendanceClaimWithFallback(
      { appClaimUrl: claimAppUrl, webClaimUrl: target.ctaUrl, fallbackUrl: target.ctaUrl },
      navigateFromTap,
    );
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
          style={(
            {
              pressed,
              hovered,
              focused,
            }: PressableStateCallbackType & {
              hovered?: boolean;
              focused?: boolean;
            },
          ) => [
            styles.primaryBadge,
            Platform.OS === "web" ? webTransitionStyle(reducedMotion) : null,
            hovered && !pressed ? styles.primaryBadgeHovered : null,
            pressed ? styles.primaryBadgePressed : null,
            focused ? styles.primaryBadgeFocused : null,
          ]}
          testID="confirm-app-cta-primary"
          onPress={open}
        >
          <Icon name="externalLink" size={18} color={textTokens.inverse} />
          <Text style={styles.primaryBadgeText}>Open in Mingla</Text>
        </Pressable>
      </View>
      {claimPhase === "unavailable" ? (
        <Text
          style={styles.claimNote}
          accessibilityLiveRegion="polite"
          role="status"
        >
          Your tickets are confirmed. You can open the app and sign in with your checkout email or phone.
        </Text>
      ) : claimPhase === "error" ? (
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
      ) : claimPhase === "loading" ? (
        // issue #2326 — "Preparing your Mingla link…" used to render in the
        // `idle` phase too, which on a free order was FOREVER: nothing ever
        // minted the link, so the card promised a link that was never coming
        // while the button beside it went to the store. `idle` now says
        // nothing; the button is already honest about where it goes.
        <Text style={styles.claimNote}>Preparing your Mingla link…</Text>
      ) : null}
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
    alignSelf: "stretch",
  },
  primaryBadge: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: accent.warm,
  },
  primaryBadgeHovered: {
    opacity: 0.94,
  },
  primaryBadgePressed: {
    opacity: 0.88,
  },
  primaryBadgeFocused: {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: accent.warm,
    outlineOffset: 2,
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
