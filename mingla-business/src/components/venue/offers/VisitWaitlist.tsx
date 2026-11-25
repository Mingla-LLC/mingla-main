/**
 * #4490 P5-3 — `/visit/waitlist/<id>`: the guest's waitlist place, no account.
 *
 * States: loading · waiting ("You're number 2", the party, the range, About
 * N minutes) · a table is ready (the time they were offered and "Book this
 * table") · seated · left · ended · not found (wrong or missing link, never a
 * hint that the entry exists) · couldn't load (Try again). "Leave the
 * waitlist" asks once. The page refreshes itself every 30 seconds while the
 * guest waits, so "A table is ready" appears without a reload.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, radius, space, type } from "../../../constants/designSystem";
import {
  getGuestWaitlist,
  GuestWaitlistError,
  leaveGuestWaitlist,
  type GuestWaitlistEntry,
} from "../../../services/venueTableGuestService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Button } from "../../ui/Button";
import { readWaitlistToken, saveWaitlistToken } from "./tablePendingReturn";
import { dayWords, tableGuestErrorCopy, waitlistStateCopy } from "./tablePickModel";
import { VenueClaimCard, parseVenueHandoff } from "./VenueAppHandoff";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

/** Read `#t=` once, keep it on this device, and scrub it from the address. */
export function adoptWaitlistToken(waitlistId: string): string | null {
  if (typeof window === "undefined" || typeof window.location === "undefined") return readWaitlistToken(waitlistId);
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fromHash = params.get("t");
  if (fromHash !== null && TOKEN.test(fromHash)) {
    saveWaitlistToken(waitlistId, fromHash);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    } catch {
      // the address keeps its fragment; nothing breaks
    }
    return fromHash;
  }
  return readWaitlistToken(waitlistId);
}

function clockIn(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function dayIn(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export interface VisitWaitlistProps {
  waitlistId: string | null;
  safeTop: number;
  safeBottom: number;
}

export function VisitWaitlist({ waitlistId, safeTop, safeBottom }: VisitWaitlistProps): React.ReactElement {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [entry, setEntry] = useState<GuestWaitlistEntry | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet: boolean, t: string | null): Promise<void> => {
      if (waitlistId === null) {
        setState("not_found");
        return;
      }
      if (!quiet) setState("loading");
      try {
        const next = await getGuestWaitlist({ waitlistId, token: t });
        setEntry(next);
        setState("ready");
      } catch (e) {
        const code = e instanceof GuestWaitlistError ? e.code : "waitlist_request_failed";
        if (code === "waitlist_not_found" || code === "waitlist_token_required") setState("not_found");
        else if (!quiet) setState("error");
      }
    },
    [waitlistId],
  );

  useEffect(() => {
    const t = waitlistId === null ? null : adoptWaitlistToken(waitlistId);
    setToken(t);
    void load(false, t);
  }, [load, waitlistId]);

  // Keep an eye out while the guest waits (a table is ready / an opening).
  useEffect(() => {
    if (entry === null || entry.status !== "waiting") return undefined;
    const timer = setInterval(() => void load(true, token), 30_000);
    return () => clearInterval(timer);
  }, [entry, load, token]);

  const leave = async (): Promise<void> => {
    if (waitlistId === null) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      setEntry(await leaveGuestWaitlist({ waitlistId, token }));
      setConfirmLeave(false);
    } catch (e) {
      const code = e instanceof GuestWaitlistError ? e.code : "waitlist_request_failed";
      setLeaveError(tableGuestErrorCopy(code) ?? "We couldn't take you off. Try again.");
    } finally {
      setLeaving(false);
    }
  };

  const venuePath =
    entry !== null && entry.venue.brandSlug !== null && entry.venue.slug !== null
      ? `/b/${entry.venue.brandSlug}/v/${entry.venue.slug}`
      : null;

  let body: React.ReactNode;
  if (state === "loading") {
    body = (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.body}>Finding your place…</Text>
      </View>
    );
  } else if (state === "not_found") {
    body = (
      <View style={styles.card} testID="visit-waitlist-not-found">
        <Text style={styles.title}>We couldn't find this waitlist place</Text>
        <Text style={styles.body}>Open the page from the link we sent you, on the device you joined with. The place may also have ended.</Text>
      </View>
    );
  } else if (state === "error" || entry === null) {
    body = (
      <View style={styles.card} testID="visit-waitlist-error">
        <Text style={styles.title}>We couldn't load your place</Text>
        <Text style={styles.body}>Check your connection and try again.</Text>
        <Button label="Try again" variant="secondary" size="md" onPress={() => void load(false, token)} />
      </View>
    );
  } else {
    const copy = waitlistStateCopy(entry, (iso) => clockIn(iso, entry.venue.timezone), dayIn(new Date().toISOString(), entry.venue.timezone));
    const offered = entry.status === "notified" && entry.offeredSlotAt !== null ? entry.offeredSlotAt : null;
    const bookPath =
      venuePath === null || entry.status !== "notified"
        ? null
        : offered !== null
          ? `${venuePath}?tab=reservations&date=${dayIn(offered, entry.venue.timezone)}&time=${clockIn(offered, entry.venue.timezone)}&party=${entry.partySize}`
          : entry.desiredDate !== null
            ? `${venuePath}?tab=reservations&date=${entry.desiredDate}&party=${entry.partySize}${entry.desiredFrom !== null ? `&time=${entry.desiredFrom.slice(0, 5)}` : ""}`
            : null;
    body = (
      <View style={[styles.card, entry.status === "notified" ? styles.cardReady : null]} testID={`visit-waitlist-${entry.status}`}>
        <Text style={styles.eyebrow}>{entry.venue.name}</Text>
        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <View style={styles.facts}>
          <Text style={styles.fact}>{`Party of ${entry.partySize}`}</Text>
          {entry.desiredDate !== null ? <Text style={styles.fact}>{dayWords(entry.desiredDate)}</Text> : null}
          {entry.guestName !== null ? <Text style={styles.fact}>{entry.guestName}</Text> : null}
        </View>
        {entry.status === "notified" && entry.expiresAt !== null ? (
          <Text style={styles.body}>{`Held for you until ${clockIn(entry.expiresAt, entry.venue.timezone)}.`}</Text>
        ) : null}
        {bookPath !== null ? (
          <Button label="Book this table" variant="primary" size="lg" onPress={() => router.push(bookPath as never)} testID="visit-waitlist-book" />
        ) : null}
        {entry.status === "waiting" || entry.status === "notified" ? (
          <Button label="Leave the waitlist" variant="secondary" size="md" onPress={() => setConfirmLeave(true)} testID="visit-waitlist-leave" />
        ) : null}
        {venuePath !== null ? (
          <Button label={`Back to ${entry.venue.name}`} variant="ghost" size="md" onPress={() => router.push(venuePath as never)} testID="visit-waitlist-venue" />
        ) : null}
        {entry.status === "waiting" ? <Text style={styles.caption}>This page checks for news every 30 seconds.</Text> : null}
      </View>
    );
    // #4490 Explorer W1: the app handoff for an open place in line.
    if (entry.status === "waiting" || entry.status === "notified") {
      body = (
        <>
          {body}
          <VenueClaimCard
            handoff={parseVenueHandoff({ claim: entry.claim })}
            kind="booking"
            email={null}
            phone={null}
            analyticsSurface="venue_visit_waitlist"
            brandSlug={entry.venue.brandSlug}
            venueSlug={entry.venue.slug}
          />
        </>
      );
    }
  }

  return (
    <View style={[styles.host, { paddingTop: safeTop }]} testID="visit-waitlist">
      <ScrollView style={styles.host} contentContainerStyle={[styles.content, { paddingBottom: safeBottom + space[8] }]}>
        {body}
      </ScrollView>
      {confirmLeave ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setConfirmLeave(false)}
            onConfirm={() => leave()}
            title="Leave the waitlist?"
            description="The venue won't contact you about a table. You can join again later if there's room."
            confirmLabel="Leave the waitlist"
            destructive
            confirmLoading={leaving}
            errorMessage={leaveError}
            testID="visit-waitlist-leave-confirm"
          />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  content: { width: "100%", maxWidth: 560, alignSelf: "center", padding: space[5], gap: space[4] },
  center: { alignItems: "center", gap: space[3], paddingTop: space[8] },
  card: { gap: space[3], padding: space[5], borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  cardReady: { borderColor: color.success, borderWidth: 2 },
  eyebrow: { ...type.label, color: color.text2 },
  title: { ...type.title, color: color.text1 },
  body: { ...type.body, color: color.text2 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  fact: { ...type.small, color: color.text1 },
  caption: { ...type.caption, color: color.text3 },
});
