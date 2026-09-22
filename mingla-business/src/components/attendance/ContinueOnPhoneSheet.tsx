/**
 * ContinueOnPhoneSheet — issue #3524.
 *
 * WHAT A DESKTOP RECIPIENT USED TO GET. The confirmation email's "Connect
 * attendance" link opened `/attendance/claim`, which tried to launch a phone app
 * that is not there, and offered two store badges for two operating systems the
 * guest is not holding. Seth's decision 5: "device aware link which opens up the
 * sheet to scan to continue on phone".
 *
 * WHAT THE CODE IS, AND IS NOT. It is NOT the claim token. Decision 5 point 4
 * forbids that outright: the claim token is a bearer credential, so a QR of it is
 * a ticket anyone can photograph off a screen. The server mints a separate
 * exchange code good for TEN MINUTES and ONE USE, and redeeming it on the phone
 * still runs the identity predicate — so a photograph is worth nothing to
 * somebody who cannot also receive mail at the purchase address.
 *
 * THE COUNTDOWN DOES NOT DECIDE VALIDITY. The server does. But the sheet must
 * not keep showing a code it knows is dead, so at zero it stops rendering the QR
 * and offers a fresh one.
 *
 * THIS IS THE ONE PLACE ON THIS ROUTE THAT CALLS THE NETWORK WITHOUT A TAP, and
 * that is allowed because it initiates NO NAVIGATION. The auto-navigation on
 * mount is exactly the defect #3524 is about.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GateQr } from "../event/GateQr";
import {
  accent,
  canvas,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  mintAttendanceClaimHandoff,
} from "../../services/attendanceClaimHandoffService";
import { openExternal } from "../../services/guestFunnelLink";
import { APP_STORE_URL, PLAY_STORE_URL } from "../../constants/storeLinks";

export type ContinueOnPhoneSheetProps = {
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  /** The claim token from the email fragment. Sent to the server to mint a code;
   * never rendered, never encoded into the QR. */
  token: string;
};

type Phase = "loading" | "ready" | "expired" | "error" | "rate";

/** Minimum 200 CSS px so a phone camera can resolve it across a desk. */
const QR_SIZE = 200;

const mmss = (totalSeconds: number): string => {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** Announced politely once per MINUTE, not once per second: a screen reader
 * reciting a ticking clock drowns out everything else on the page. */
const politeRemaining = (totalSeconds: number): string => {
  const minutes = Math.ceil(Math.max(0, totalSeconds) / 60);
  if (minutes <= 0) return "This code has expired.";
  if (minutes === 1) return "This code expires in about a minute.";
  return `This code expires in about ${minutes} minutes.`;
};

export const ContinueOnPhoneSheet: React.FC<ContinueOnPhoneSheetProps> = ({
  kind,
  eventId,
  sourceId,
  token,
}) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const mint = useCallback(async (): Promise<void> => {
    setPhase("loading");
    setHandoffUrl(null);
    const result = await mintAttendanceClaimHandoff({
      version: 1,
      kind,
      eventId,
      sourceId,
      token,
    });
    if (!activeRef.current) return;
    if (result.ok) {
      setHandoffUrl(result.handoffUrl);
      setRemaining(result.expiresInSeconds);
      setPhase("ready");
      return;
    }
    if (result.reason === "rate") {
      setPhase("rate");
      return;
    }
    if (result.reason === "expired") {
      setPhase("expired");
      return;
    }
    setPhase("error");
  }, [kind, eventId, sourceId, token]);

  useEffect(() => {
    void mint();
  }, [mint]);

  useEffect(() => {
    if (phase !== "ready") return;
    const handle = setInterval(() => {
      setRemaining((prior) => {
        if (prior <= 1) {
          setPhase("expired");
          setHandoffUrl(null);
          return 0;
        }
        return prior - 1;
      });
    }, 1000);
    return () => clearInterval(handle);
  }, [phase]);

  const openStore = useCallback((url: string): void => {
    if (Platform.OS !== "web") return;
    openExternal(url);
  }, []);

  const storeBadges = (
    <View style={styles.badgeRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Get Mingla on the App Store"
        onPress={() => openStore(APP_STORE_URL)}
        style={styles.badge}
      >
        <Text style={styles.badgeText}>App Store</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Get Mingla on Google Play"
        onPress={() => openStore(PLAY_STORE_URL)}
        style={styles.badge}
      >
        <Text style={styles.badgeText}>Google Play</Text>
      </Pressable>
    </View>
  );

  return (
    <View
      style={styles.sheet}
      role="dialog"
      accessibilityLabel="Continue on your phone"
      testID="attendance-continue-on-phone"
    >
      <Text style={styles.title} accessibilityRole="header">
        Continue on your phone
      </Text>

      {phase === "loading" ? (
        <Text style={styles.body} testID="continue-on-phone-loading">
          Preparing your code…
        </Text>
      ) : null}

      {phase === "ready" && handoffUrl !== null ? (
        <>
          <Text style={styles.body}>
            Scan this with your phone to open Mingla and connect your ticket.
          </Text>
          {/*
            Reuses the existing GateQr, which already carries the Metro platform
            split (`.web.tsx` renders `react-qr-code`, the native sibling is a
            null stub) AND the React.lazy dynamic import that keeps the library
            out of the eager boot chunk. A second QR component here would put
            `react-qr-code` into the native bundles and past the boot-payload
            budget — the two things #1083 and the budget gate exist to stop.

            The value is the server's handoffUrl and nothing else: never the
            claim token, never the confirmation fragment, never an app scheme.
            The URL is deliberately NOT rendered as visible text.
          */}
          <View style={styles.qrCard}>
            <GateQr value={handoffUrl} size={QR_SIZE} />
          </View>
          <Text style={styles.body} testID="continue-on-phone-countdown">
            This code works for the next {mmss(remaining)} and can only be used
            once.
          </Text>
          <Text
            style={styles.srOnly}
            accessibilityLiveRegion="polite"
            testID="continue-on-phone-polite"
          >
            {politeRemaining(remaining)}
          </Text>
          <Button
            label="Get a new code"
            onPress={() => void mint()}
            variant="secondary"
            fullWidth
            testID="continue-on-phone-refresh"
          />
          {storeBadges}
        </>
      ) : null}

      {phase === "expired" ? (
        <>
          <Text style={styles.body}>That code has expired.</Text>
          <Button
            label="Get a new code"
            onPress={() => void mint()}
            fullWidth
            testID="continue-on-phone-refresh"
          />
        </>
      ) : null}

      {phase === "error" ? (
        <>
          <Text style={styles.body}>
            We couldn’t prepare a code. Your ticket is safe — open Mingla on your
            phone and sign in with the email or phone you used at checkout.
          </Text>
          <Button
            label="Try again"
            onPress={() => void mint()}
            fullWidth
            testID="continue-on-phone-retry"
          />
          {storeBadges}
        </>
      ) : null}

      {phase === "rate" ? (
        <>
          <Text style={styles.body}>
            Too many codes for this ticket. Try again in a few minutes.
          </Text>
          {storeBadges}
        </>
      ) : null}

      {/*
        The way out that needs no phone camera at all, and it is TRUE: the
        identity rail (#2217) reconnects the order to whichever account proves it
        owns the purchase email or phone, with no link and no code.
      */}
      <Text style={styles.footnote}>
        Or sign in to Mingla on your phone later with the email or phone you used
        at checkout — your ticket will be waiting.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { width: "100%", alignItems: "center", gap: 12 },
  title: {
    color: textTokens.primary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: textTokens.secondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  // Solid white behind the code: near-black-on-white is a scanner hardware
  // requirement, not a style choice.
  qrCard: {
    backgroundColor: "#FFFFFF",
    padding: spacing.sm,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderWidth: 2,
    borderColor: accent.border,
    borderRadius: 8,
    backgroundColor: canvas.discover,
  },
  badgeText: {
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  footnote: {
    color: textTokens.secondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 4,
  },
  // Present for assistive tech, 1x1 and transparent for everyone else. The
  // countdown is already visible above; this is the per-minute announcement.
  srOnly: { height: 1, width: 1, opacity: 0, fontSize: 1, lineHeight: 1 },
});

export default ContinueOnPhoneSheet;
