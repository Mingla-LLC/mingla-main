import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  detectClientPlatform,
  openAppScheme,
  openExternal,
  resolveClaimPageTarget,
  type Platform as ClientPlatform,
} from "../../src/services/guestFunnelLink";
import { accent, canvas, glass, spacing, text as textTokens } from "../../src/constants/designSystem";
import {
  consumeAttendanceClaimFragment,
  createAttendanceClaimFragmentScrubber,
  // STATIC, deliberately: this runs inside a tap handler and a browser only
  // honours a navigation while the gesture is live. A dynamic import here would
  // put an await in front of the deep link and silently break #2326's ordering.
  openAttendanceClaimWithFallback,
  type ParsedAttendanceClaimFragment,
} from "../../src/utils/attendanceClaimDeepLink";

/**
 * The email's landing page — issue #3524.
 *
 * WHAT THIS PAGE USED TO DO, AND WHY IT WAS A DEAD END. On mount, with no tap
 * anywhere, it called `Linking.openURL("com.mingla.app.v2://…")`, which on
 * react-native-web is `window.open(url, "_blank", "noopener")`. A browser blocks
 * a pop-up nobody asked for, and a new tab pointed at a scheme no app claims is a
 * dead tab. The sibling confirmation card (`DownloadMinglaCta`) had the identical
 * bug, it was measured on a real iPhone and a real Galaxy A72 in #2326, and it
 * was fixed there. This page never got the fix.
 *
 * THREE RULES THIS FILE NOW OBEYS.
 *
 *  1. NOTHING HERE NAVIGATES OUTSIDE A USER GESTURE. Ever. The auto-attempt
 *     effect is deleted, not guarded.
 *  2. `Linking.openURL` APPEARS NOWHERE IN THIS FILE. Every navigation goes
 *     through mingla-business's single owner — `openExternal` for http(s),
 *     `openAppScheme` for the app scheme — which is what keeps the banned
 *     null-returning `window.open` feature string from re-entering through a
 *     library instead of a call site.
 *  3. THE PLATFORM IS RESOLVED FROM THE BROWSER, not from `Platform.OS` (which is
 *     `'web'` for every visitor here, so an `OS` branch would be three dead arms).
 *     Detection is a GUESS, so both phone branches say which platform they
 *     detected and offer the other one.
 *
 * The fragment-scrub bootstrap below is #871/#2979's protection and is UNCHANGED.
 * Do not refactor it while working nearby: it has its own adversarial suite and
 * it is the reason the claim credential never reaches a Referer header or the
 * browser's history.
 */

// The desktop scan sheet is lazily imported so `react-qr-code` and the sheet's
// own bulk never enter the eager boot chunk. The business-web boot-payload
// budget gate is real and REPORTS.md records it biting repeatedly.
const ContinueOnPhoneSheet = React.lazy(() =>
  import("../../src/components/attendance/ContinueOnPhoneSheet")
);

// #871 compatibility contract: `window.history.replaceState` is now owned by
// the injected pre-Router bootstrap and the shared scrub helper. The route's
// first effect must not call it directly or Router can restore the credential.
export default function AttendanceClaimLanding(): React.ReactElement | null {
  const [parsed, setParsed] = useState(false);
  const [claim, setClaim] = useState<ParsedAttendanceClaimFragment | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  // `null` until the effect resolves it. The page must NOT render a
  // platform-specific call to action it may have to swap a frame later.
  const [clientPlatform, setClientPlatform] = useState<ClientPlatform | null>(null);
  // Detection is a guess. This is the guest's override, per Seth's decision 5
  // point 3: a wrong guess must be recoverable by the person, not a dead end.
  const [platformOverride, setPlatformOverride] = useState<ClientPlatform | null>(null);
  const scheduleFinalUrlRestoreRef = React.useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setParsed(true);
      return;
    }
    let active = true;
    const raw = window.location.hash.replace(/^#/, "");
    const handoff = consumeAttendanceClaimFragment(window, raw);
    const capturedRaw = handoff.fragment;
    const scrubAttendanceClaimFragment =
      createAttendanceClaimFragmentScrubber(handoff);
    // The head bootstrap captured the credential, launch URL, and Router state
    // before Router could alter them. This defense helper retains only that
    // clean URL/state for the final bounded lifecycle restore.
    scheduleFinalUrlRestoreRef.current = scrubAttendanceClaimFragment(
      window.location,
      window.history,
      window.requestAnimationFrame.bind(window),
    );
    // `detectClientPlatform` reads `navigator`, so it is resolved HERE and never
    // at module load.
    setClientPlatform(detectClientPlatform());
    void import("../../src/utils/attendanceClaimDeepLink").then(
      ({ attendanceAppUrlFromFragment, attendanceClaimFromFragment: parse }) => {
        if (!active) return;
        setAppUrl(attendanceAppUrlFromFragment(capturedRaw));
        setClaim(parse(capturedRaw));
        setParsed(true);
      },
      () => {
        if (active) setParsed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !parsed) return;
    scheduleFinalUrlRestoreRef.current?.();
  }, [parsed]);

  const effectivePlatform: ClientPlatform | null =
    platformOverride ?? clientPlatform;

  /**
   * The store / OneLink destination for the platform in play.
   *
   * The claim page's resolver, NOT the confirmation screen's: for a desktop it
   * returns the smart download page on BOTH the live and the dark arm, so a
   * desktop guest can never be handed a mobile store listing whatever the
   * OneLink flag says.
   *
   * The entity slugs are not knowable from a claim fragment (it carries ids, not
   * slugs) and they do not need to be: this page's job is to get the app onto the
   * device, and #2217's identity rail reconnects the order afterwards from the
   * account's own verified email or phone. Empty slugs keep the OneLink grammar
   * well-formed without inventing a per-order value for an email link.
   */
  const target = effectivePlatform === null
    ? null
    : resolveClaimPageTarget(
      { entityType: "event", brandSlug: "", entitySlug: "" },
      effectivePlatform,
    );

  /**
   * #2326's gesture rule, applied to the file the EMAIL actually points at.
   *
   * A non-http destination is the app scheme and must be assigned to the CURRENT
   * tab: `openAttendanceClaimWithFallback` decides "the app took the navigation"
   * from this page's own `visibilitychange`, so handing the scheme to a new tab
   * makes the 1200 ms store fallback fire even on the success path.
   *
   * MUST stay synchronous. Nothing may return to the event loop between the tap
   * and the navigation — no `await`, no `import()` — or the browser stops
   * honouring it.
   */
  const navigateFromTap = useCallback((url: string): Promise<unknown> => {
    if (!/^https?:/i.test(url)) {
      openAppScheme(url);
      return Promise.resolve();
    }
    openExternal(url);
    return Promise.resolve();
  }, []);

  /**
   * ANDROID WEB. Try the app, and let the SAME tap continue to the store when
   * the app demonstrably did not take it. Measured working on a real Galaxy A72
   * in #2326: Chrome silently ignores an unhandled scheme, the page stays put,
   * and the guarded 1200 ms fallback carries the tap onward.
   */
  const openOnAndroid = useCallback((): void => {
    if (appUrl === null || target === null || opening) return;
    setOpening(true);
    void openAttendanceClaimWithFallback(
      {
        appClaimUrl: appUrl,
        webClaimUrl: target.ctaUrl,
        fallbackUrl: target.ctaUrl,
      },
      navigateFromTap,
    ).finally(() => setTimeout(() => setOpening(false), 800));
  }, [appUrl, target, opening, navigateFromTap]);

  /**
   * iOS WEB. The scheme is NOT attempted. Measured on iOS 26.5 Safari (#2326):
   * navigating to an unhandled custom scheme raises a blocking system alert
   * ("Safari cannot open the page because the address is invalid"), and this
   * page's audience is, by construction, a device whose OS did not intercept the
   * Universal Link — most often one without the app. So the tap goes to the
   * store, and after install the identity rail reconnects the ticket.
   */
  const openOnIos = useCallback((): void => {
    if (target === null || opening) return;
    setOpening(true);
    void navigateFromTap(target.ctaUrl);
    setTimeout(() => setOpening(false), 800);
  }, [target, opening, navigateFromTap]);

  useEffect(() => {
    if (Platform.OS !== "web" || !parsed || typeof document === "undefined") return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = document.querySelector('[data-testid="attendance-claim-primary"]');
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        window.history.back();
        return;
      }
      if (event.key !== "Tab") return;
      const candidates = Array.from(document.querySelectorAll(
        '[data-testid="attendance-claim-card"] button, [data-testid="attendance-claim-card"] [role="link"]',
      )).filter((node): node is HTMLElement => node instanceof HTMLElement);
      if (candidates.length === 0) return;
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prior?.focus();
    };
  }, [parsed]);

  if (!parsed) return null;

  const isDesktop = effectivePlatform === "other";
  const isIos = effectivePlatform === "ios";
  const usable = appUrl !== null;
  // The desktop sheet needs the token itself to ask for a handoff code. It is
  // only ever the emailed `token` form: a handoff code cannot mint another
  // handoff code, which would be a credential that renews itself past its own
  // ten-minute window.
  const canOfferScanSheet = isDesktop && claim !== null &&
    claim.credentialKey === "token";

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      {/*
        #2211 — this region SCROLLS. `host` was `flex: 1` + `minHeight: 600` +
        `justifyContent: "center"` with no scroll container, around a card whose
        title is a hard-coded 26/32. `minHeight: 600` alone put the card past a
        375x667 device's safe area before the text scaled at all; at
        accessibility sizes the "Open Mingla" button and the two store links
        below it were unreachable.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      <View
        style={styles.card}
        role="dialog"
        accessibilityLabel="Connect attendance in Mingla"
        testID="attendance-claim-card"
      >
        <View style={styles.iconDisk} accessibilityElementsHidden>
          <Icon name="link" size={26} color={canvas.discover} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {isDesktop && usable
            ? "Open Mingla on your phone to connect your attendance"
            : "Open Mingla to connect your attendance"}
        </Text>
        <Text style={styles.body}>{usable
          ? "Your RSVP or ticket connects securely in the Mingla app."
          : "This attendance link can’t be used. Request a new link from your confirmation."}</Text>

        {/* DESKTOP — no scheme, no store listing. The continue-on-phone sheet. */}
        {usable && canOfferScanSheet && claim !== null ? (
          <Suspense
            fallback={<Text style={styles.body}>Preparing your code…</Text>}
          >
            <ContinueOnPhoneSheet
              kind={claim.kind}
              eventId={claim.eventId}
              sourceId={claim.sourceId}
              token={claim.credential}
            />
          </Suspense>
        ) : null}

        {/* PHONE — one primary button per platform, and nothing fires on mount. */}
        {usable && !isDesktop && effectivePlatform !== null ? (
          <>
            <Button
              label={opening
                ? "Opening Mingla…"
                : isIos
                  ? "Get Mingla"
                  : "Open Mingla"}
              onPress={isIos ? openOnIos : openOnAndroid}
              disabled={opening}
              fullWidth
              accessibilityLabel={isIos
                ? "Get Mingla from the App Store"
                : "Open Mingla on this Android phone"}
              testID="attendance-claim-primary"
            />
            {isIos ? (
              <Text style={styles.hint}>
                Already have Mingla? Open this link in Safari.
              </Text>
            ) : null}
            {/*
              Seth's decision 5 point 3 — state the platform we detected and
              offer the other, because detection is a guess and a wrong guess
              must be recoverable by the person.
            */}
            <View style={styles.switchRow}>
              <Text style={styles.hint} testID="attendance-claim-platform-note">
                {isIos
                  ? "Looks like you’re on iPhone."
                  : "Looks like you’re on Android."}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isIos
                  ? "I’m on Android instead — switch to the Google Play link"
                  : "I’m on iPhone instead — switch to the App Store link"}
                onPress={() => setPlatformOverride(isIos ? "android" : "ios")}
                style={styles.switchControl}
                testID="attendance-claim-platform-switch"
              >
                <Text style={styles.switchText}>
                  {isIos ? "On Android instead?" : "On iPhone instead?"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/*
          A desktop with a fragment we cannot mint against still gets a truthful
          way forward — the identity rail, which needs no link at all.
        */}
        {usable && isDesktop && !canOfferScanSheet ? (
          <Text style={styles.body}>
            Open Mingla on your phone and sign in with the email or phone you
            used at checkout — your ticket will be waiting.
          </Text>
        ) : null}
      </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  // #2211 — `host` keeps only the frame; `minHeight: 600` is DELETED (a hard
  // floor near the height of a small phone's safe area is what forced the
  // overflow) and the centring moved to `scrollContent`.
  host: { flex: 1, backgroundColor: canvas.discover },
  scroll: { flex: 1, overflow: "hidden" },
  // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
  scrollContent: {
    flexGrow: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg, paddingVertical: 32,
  },
  card: {
    width: "100%", maxWidth: 480, padding: spacing.lg, borderRadius: 24,
    backgroundColor: glass.tint.profileElevated, alignItems: "center",
  },
  iconDisk: {
    width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
    backgroundColor: accent.warm,
  },
  title: { color: textTokens.primary, fontSize: 26, lineHeight: 32, fontWeight: "700", marginTop: 16, textAlign: "center" },
  body: { color: textTokens.secondary, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 24, textAlign: "center" },
  hint: { color: textTokens.secondary, fontSize: 13, lineHeight: 19, marginTop: 10, textAlign: "center" },
  switchRow: {
    marginTop: 4, flexDirection: "row", flexWrap: "wrap",
    justifyContent: "center", alignItems: "center", gap: 8,
  },
  switchControl: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: 8,
    borderWidth: 2, borderColor: accent.border, borderRadius: 8,
  },
  switchText: { color: textTokens.primary, fontSize: 14, lineHeight: 20, textDecorationLine: "underline", fontWeight: "700" },
});
