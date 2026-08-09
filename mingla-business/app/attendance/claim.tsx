import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { APP_STORE_URL, PLAY_STORE_URL } from "../../src/constants/storeLinks";
import { accent, canvas, glass, spacing, text as textTokens } from "../../src/constants/designSystem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const attendanceAppUrlFromFragment = (raw: string): string | null => {
  const params = new URLSearchParams(raw);
  if ([...params.keys()].some((key) => !["v", "kind", "event", "source", "token"].includes(key))) return null;
  const kind = params.get("kind");
  const event = params.get("event");
  const source = params.get("source");
  const token = params.get("token");
  if (params.get("v") !== "1" || (kind !== "order" && kind !== "rsvp") ||
    event === null || source === null || token === null ||
    !UUID.test(event) || !UUID.test(source) || !TOKEN.test(token)) return null;
  const fragment = new URLSearchParams({ v: "1", kind, event, source, token }).toString();
  return `com.mingla.app.v2://attendance-claim#${fragment}`;
};

export default function AttendanceClaimLanding(): React.ReactElement | null {
  const [parsed, setParsed] = useState(false);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setParsed(true);
      return;
    }
    const raw = window.location.hash.replace(/^#/, "");
    window.history.replaceState(null, "", window.location.pathname);
    setAppUrl(attendanceAppUrlFromFragment(raw));
    setParsed(true);
  }, []);

  const openMingla = useCallback(() => {
    if (!appUrl || opening) return;
    setOpening(true);
    void Linking.openURL(appUrl).finally(() => setTimeout(() => setOpening(false), 800));
  }, [appUrl, opening]);

  useEffect(() => {
    if (!parsed || !appUrl) return;
    openMingla();
  }, [appUrl, openMingla, parsed]);

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
    <View style={styles.host} accessibilityViewIsModal>
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
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1, minHeight: 600, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg, paddingVertical: 32, backgroundColor: canvas.discover,
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
