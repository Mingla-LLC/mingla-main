import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { APP_STORE_URL, PLAY_STORE_URL } from "../../src/constants/storeLinks";
import { accent, canvas, glass, spacing, text as textTokens } from "../../src/constants/designSystem";
import {
  consumeAttendanceClaimFragment,
  createAttendanceClaimFragmentScrubber,
} from "../../src/utils/attendanceClaimDeepLink";

// #871 compatibility contract: `window.history.replaceState` is now owned by
// the injected pre-Router bootstrap and the shared scrub helper. The route's
// first effect must not call it directly or Router can restore the credential.
export default function AttendanceClaimLanding(): React.ReactElement | null {
  const [parsed, setParsed] = useState(false);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const autoAttemptedRef = React.useRef(false);
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
    void import("../../src/utils/attendanceClaimDeepLink").then(
          ({ attendanceAppUrlFromFragment }) => {
            if (!active) return;
            setAppUrl(attendanceAppUrlFromFragment(capturedRaw));
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

  const openMingla = useCallback(() => {
    if (!appUrl || opening) return;
    setOpening(true);
    void Linking.openURL(appUrl).finally(() => setTimeout(() => setOpening(false), 800));
  }, [appUrl, opening]);

  useEffect(() => {
    if (!parsed || !appUrl || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    openMingla();
  }, [appUrl, parsed]);

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
        <Text style={styles.title} accessibilityRole="header">Open Mingla to connect your attendance</Text>
        <Text style={styles.body}>{appUrl
          ? "Your RSVP or ticket connects securely in the Mingla app."
          : "This attendance link can’t be used. Request a new link from your confirmation."}</Text>
        {appUrl ? (
          <Button
            label={opening ? "Opening Mingla…" : "Open Mingla"}
            onPress={openMingla}
            disabled={opening}
            fullWidth
            testID="attendance-claim-primary"
          />
        ) : null}
        {appUrl ? (
          <View style={styles.fallbackRow}>
            <Text style={styles.fallback}>Don’t have Mingla yet?</Text>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(APP_STORE_URL)} style={styles.storeLink}>
              <Text style={styles.storeLinkText}>App Store</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PLAY_STORE_URL)} style={styles.storeLink}>
              <Text style={styles.storeLinkText}>Google Play</Text>
            </Pressable>
          </View>
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
  fallbackRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8 },
  fallback: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  storeLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6, borderWidth: 2, borderColor: accent.border, borderRadius: 8 },
  storeLinkText: { color: textTokens.primary, fontSize: 14, lineHeight: 20, textDecorationLine: "underline", fontWeight: "700" },
});
