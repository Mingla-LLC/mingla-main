/**
 * #4389 — the interruption states of brand setup (design v11, Interruptions
 * lane): F1 discard on Back, F1 session expired, F2 changed on another
 * device, F3 finishing on your other device. The rules are pure so they are
 * tested without a device; the views are small so they render in node tests.
 */
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { accent, radius, spacing, text as textTokens, typography } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { BRAND_SETUP_COPY as C } from "./brandSetupCopy";

// ── rules ────────────────────────────────────────────────────────────────

/** F1 Back asks "Discard this brand name?" only when a name is typed but not saved. */
export function shouldConfirmNameDiscard(typedName: string, saving: boolean): boolean {
  return !saving && typedName.trim().length > 0;
}

/**
 * R-12 — the create call failed because the sign-in ran out (expired or
 * missing JWT, 401). Network and server errors are not this state.
 */
export function isSessionExpiredError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as { message?: unknown; code?: unknown; status?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  return (
    e.status === 401 ||
    e.code === "PGRST301" ||
    e.code === "PGRST303" ||
    /jwt expired|invalid jwt|jwt.*(missing|malformed)|not authenticated|auth session missing|refresh token/i.test(message)
  );
}

/**
 * R-12 "Your brand name is kept." — the typed name survives the sign-out that
 * "Sign in" starts, in memory only (never persisted, gone when the app quits),
 * and the next F1 takes it once.
 */
let keptBrandName = "";
export function keepBrandNameForSignIn(name: string): void {
  keptBrandName = name.trim().slice(0, 60);
}
export function takeKeptBrandName(): string {
  const name = keptBrandName;
  keptBrandName = "";
  return name;
}

/**
 * F2 conflict — the server's bank country changed under this screen (another
 * device saved a different one) while the host had picked something else
 * here. Returns the server's new country, or null when there is no conflict.
 */
export function countryConflict(input: {
  previousServer: string | null;
  server: string | null;
  selected: string | null;
}): string | null {
  const { previousServer, server, selected } = input;
  if (server === null || server === previousServer) return null;
  // The first read (no earlier server value) is not a change elsewhere.
  if (previousServer === null) return null;
  if (selected === null || selected === server) return null;
  return server;
}

/** The server's payments-setup stamp holds for 15 minutes (R-2, R-3). */
export const PAYMENTS_SETUP_HOLD_MS = 15 * 60 * 1000;

/** Brands whose secure setup was started from THIS device this session. */
const startedOnThisDevice = new Set<string>();
export function markPaymentsStartedHere(brandId: string): void {
  startedOnThisDevice.add(brandId);
}
export function paymentsStartedHere(brandId: string): boolean {
  return startedOnThisDevice.has(brandId);
}

/**
 * R-4 — another device has started the secure setup in the last 15 minutes
 * and no account exists yet: "Finishing on your other device…".
 */
export function finishingOnOtherDevice(input: {
  startedAt: string | null;
  stripeState: string;
  startedHere: boolean;
  now: number;
}): boolean {
  if (input.startedHere || input.startedAt === null || input.stripeState !== "none") return false;
  const at = Date.parse(input.startedAt);
  if (!Number.isFinite(at)) return false;
  return input.now - at >= 0 && input.now - at < PAYMENTS_SETUP_HOLD_MS;
}

/** The owner's display name from the team directory, else the generic words. */
export function ownerDisplayName(
  members: ReadonlyArray<{ role: string | null; displayName: string | null }> | undefined,
  fallback: string,
): string {
  const owner = members?.find((m) => m.role === "brand_owner" && (m.displayName ?? "").trim().length > 0);
  return owner?.displayName?.trim() ?? fallback;
}

// ── views ────────────────────────────────────────────────────────────────

export const NameDiscardSheet: React.FC<{
  visible: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}> = ({ visible, onKeepEditing, onDiscard }) => (
  <Sheet visible={visible} onClose={onKeepEditing} snapPoint="half">
    <View style={styles.sheetBody} testID="brand-setup-f1-discard">
      <Text style={styles.h3} accessibilityRole="header">{C.f1.discardTitle}</Text>
      <Text style={styles.sub}>{C.f1.discardBody}</Text>
      <Button testID="brand-setup-f1-keep-editing" label={C.f1.keepEditing} onPress={onKeepEditing} variant="secondary" size="lg" fullWidth />
      <View style={styles.gap8} />
      <Button testID="brand-setup-f1-discard-confirm" label={C.f1.discard} onPress={onDiscard} variant="destructive" size="lg" fullWidth />
    </View>
  </Sheet>
);

export const SessionExpiredSheet: React.FC<{
  visible: boolean;
  busy: boolean;
  onSignIn: () => void;
  onClose: () => void;
}> = ({ visible, busy, onSignIn, onClose }) => (
  <Sheet visible={visible} onClose={onClose} snapPoint="half">
    <View style={styles.sheetBody} testID="brand-setup-session-expired">
      <Text style={styles.h3} accessibilityRole="header">{C.f1.sessionTitle}</Text>
      <Text style={styles.sub}>{C.f1.sessionBody}</Text>
      <Button testID="brand-setup-sign-in" label={C.f1.signIn} onPress={onSignIn} variant="primary" size="lg" fullWidth loading={busy} />
    </View>
  </Sheet>
);

export const CountryConflictBanner: React.FC<{
  countryName: string;
  onKeep: () => void;
  onChange: () => void;
}> = ({ countryName, onKeep, onChange }) => (
  <View style={styles.banner} testID="brand-setup-country-conflict">
    <Text style={styles.bannerText} accessibilityRole="alert">{C.f2.conflict(countryName)}</Text>
    <View style={styles.row}>
      <View style={styles.flex}>
        <Button testID="brand-setup-conflict-keep" label={C.f2.keep} onPress={onKeep} variant="secondary" size="md" fullWidth />
      </View>
      <View style={styles.flex}>
        <Button testID="brand-setup-conflict-change" label={C.f2.change} onPress={onChange} variant="secondary" size="md" fullWidth />
      </View>
    </View>
  </View>
);

export const ForbiddenBanner: React.FC<{ message: string }> = ({ message }) => (
  <View style={styles.banner} testID="brand-setup-forbidden">
    <Text style={styles.bannerText} accessibilityRole="alert">{message}</Text>
  </View>
);

export const OtherDeviceBanner: React.FC<{ refreshing: boolean; onRefresh: () => void }> = ({ refreshing, onRefresh }) => (
  <View style={[styles.banner, styles.bannerRow]} testID="brand-setup-other-device">
    <ActivityIndicator color={accent.warm} />
    <Text style={[styles.bannerText, styles.flex]} accessibilityRole="alert">{C.f3.otherDevice}</Text>
    <Button testID="brand-setup-other-device-refresh" label={C.f3.refresh} onPress={onRefresh} variant="ghost" size="sm" loading={refreshing} />
  </View>
);

const styles = StyleSheet.create({
  sheetBody: { padding: spacing.lg, gap: spacing.sm },
  h3: { ...typography.h3, color: textTokens.primary },
  sub: { ...typography.body, color: textTokens.secondary },
  gap8: { height: spacing.sm },
  banner: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" },
  bannerRow: { flexDirection: "row", alignItems: "center" },
  bannerText: { ...typography.bodySm, color: textTokens.primary },
  row: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
});
