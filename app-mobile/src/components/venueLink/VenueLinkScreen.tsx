/**
 * #4490 Explorer W1 — the app side of a venue web link (design claim:nolink).
 * Owned: opens the item in Purchases. A link with its booking token (#t=, kept
 * in this screen's memory only): shows the booking read-only; the server sends
 * no pass QR to a token read while VENUE_PASS_APP_ONLY is on. A payment return
 * with nothing to read: "Payment received". Anything else: the same page on
 * the web in the in-app browser. Never a blank screen.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";

import { colors, radius, spacing, typography } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { runClaimSweep } from "../../services/claimSweep";
import { useOpenInMingla } from "../InAppBrowserProvider";
import {
  decideVenueLink,
  tokenFromFragment,
  VENUE_LINK_COPY,
  type VenueLinkKind,
} from "./venueLinkModel";

type Booking = { venueName: string; when: string | null; guests: number | null; emailMasked: string | null };
type State =
  | { phase: "loading" }
  | { phase: "booking"; booking: Booking; underOther: string | null }
  | { phase: "paid_no_link" }
  | { phase: "error" };

function mask(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}

async function read(kind: VenueLinkKind, id: string, token: string | null): Promise<Record<string, unknown> | null> {
  const fn = kind === "waitlist" ? "venue-waitlist" : "venue-offers";
  const body = kind === "waitlist"
    ? { action: "get", waitlistId: id, ...(token ? { token } : {}) }
    : { action: "get", groupId: id, ...(token ? { token } : {}) };
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error || !data || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") return null;
  const row = (data as { data?: unknown }).data;
  return row !== null && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function toBooking(row: Record<string, unknown>): Booking {
  const venue = (row.venue ?? {}) as Record<string, unknown>;
  const win = (row.window ?? {}) as Record<string, unknown>;
  const guest = (row.guest ?? {}) as Record<string, unknown>;
  return {
    venueName: typeof venue.name === "string" ? venue.name : "Your booking",
    when: typeof win.localDate === "string" ? win.localDate : typeof row.desiredDate === "string" ? row.desiredDate : null,
    guests: typeof row.partySize === "number" ? row.partySize : null,
    emailMasked: mask(typeof guest.email === "string" ? guest.email : null),
  };
}

export function VenueLinkScreen({
  kind,
  id,
  webPath,
}: {
  kind: VenueLinkKind;
  id: string | null;
  webPath: string;
}): React.ReactElement {
  const router = useRouter();
  // I-4261-LINKS-OPEN-IN-MINGLA: a web page opens in Mingla's own in-app browser (the provider's
  // overlay stays above the Purchases screen this route moves to).
  const { open: openInMingla } = useOpenInMingla();
  const url = Linking.useURL();
  const [state, setState] = useState<State>({ phase: "loading" });

  const run = useCallback(async (): Promise<void> => {
    setState({ phase: "loading" });
    const hash = url !== null && url.includes("#") ? url.slice(url.indexOf("#")) : null;
    const token = tokenFromFragment(hash);
    const paidReturn = url !== null && /[?&]paid=1\b/.test(url);
    const webUrl = `https://host.usemingla.com${webPath}${hash ?? ""}`;
    try {
      let owned = false;
      if (id !== null && kind !== "reserve_manage" && kind !== "order") owned = (await read(kind, id, null)) !== null;
      const decision = decideVenueLink({ kind, id, webUrl, owned, token, paidReturn });
      if (decision.kind === "purchases") {
        router.replace(decision.path as never);
        return;
      }
      if (decision.kind === "web") {
        openInMingla(decision.url);
        router.replace("/purchases" as never);
        return;
      }
      if (decision.kind === "paid_no_link") {
        setState({ phase: "paid_no_link" });
        return;
      }
      const row = id !== null ? await read(kind, id, token) : null;
      if (row === null) {
        setState({ phase: "error" });
        return;
      }
      // Not this account's yet: look once for a match (same email or phone).
      const userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      if (userId !== null) await runClaimSweep(userId, "claim_link").catch(() => null);
      const nowOwned = id !== null ? (await read(kind, id, null)) !== null : false;
      if (nowOwned) {
        const after = decideVenueLink({ kind, id, webUrl, owned: true, token, paidReturn });
        if (after.kind === "purchases") {
          router.replace(after.path as never);
          return;
        }
      }
      const booking = toBooking(row);
      setState({
        phase: "booking",
        booking,
        underOther: booking.emailMasked !== null ? VENUE_LINK_COPY.underOther(booking.emailMasked) : null,
      });
    } catch {
      setState({ phase: "error" });
    }
  }, [id, kind, openInMingla, router, url, webPath]);

  useEffect(() => {
    void run();
  }, [run]);

  if (state.phase === "loading") {
    return (
      <View style={styles.center} testID="venue-link-loading">
        <ActivityIndicator color={colors.primary[500]} />
      </View>
    );
  }
  if (state.phase === "paid_no_link") {
    return (
      <View style={styles.center} testID="venue-link-paid">
        <Text style={styles.title} accessibilityRole="header">{VENUE_LINK_COPY.paidTitle}</Text>
        <Text style={styles.body}>{VENUE_LINK_COPY.paidBody}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={VENUE_LINK_COPY.paidButton}
          style={styles.button}
          onPress={() => router.replace("/purchases" as never)}
        >
          <Text style={styles.buttonText}>{VENUE_LINK_COPY.paidButton}</Text>
        </Pressable>
      </View>
    );
  }
  if (state.phase === "error") {
    return (
      <View style={styles.center} testID="venue-link-error">
        <Text style={styles.body}>{VENUE_LINK_COPY.loadFailed}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={VENUE_LINK_COPY.retry} style={styles.button} onPress={() => void run()}>
          <Text style={styles.buttonText}>{VENUE_LINK_COPY.retry}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.center} testID="venue-link-booking">
      <Text style={styles.title} accessibilityRole="header">{state.booking.venueName}</Text>
      {state.booking.when !== null ? <Text style={styles.body}>{state.booking.when}</Text> : null}
      {state.underOther !== null ? <Text style={styles.body}>{state.underOther}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={VENUE_LINK_COPY.paidButton}
        style={styles.button}
        onPress={() => router.replace("/purchases" as never)}
      >
        <Text style={styles.buttonText}>{VENUE_LINK_COPY.paidButton}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background.primary },
  title: { ...typography.lg, fontWeight: "700", color: colors.text.primary, textAlign: "center" },
  body: { ...typography.md, color: colors.text.secondary, textAlign: "center" },
  button: { marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary[500] },
  buttonText: { ...typography.md, fontWeight: "600", color: colors.text.inverse },
});
