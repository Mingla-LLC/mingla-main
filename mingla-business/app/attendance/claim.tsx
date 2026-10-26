import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BuyerClaimCard } from "../../src/components/checkout/DownloadMinglaCta";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { BUYER_CLAIM_COPY } from "../../src/constants/buyerClaimCopy";
import { mintAttendanceClaimHandoff } from "../../src/services/attendanceClaimHandoffService";
import {
  detectClientPlatform,
  openExternal,
  resolveClaimPageTarget,
  type Platform as ClientPlatform,
} from "../../src/services/guestFunnelLink";
import {
  consumeAttendanceClaimFragment,
  createAttendanceClaimFragmentScrubber,
  type ParsedAttendanceClaimFragment,
} from "../../src/utils/attendanceClaimDeepLink";

/**
 * Legacy email claim landing page.
 *
 * The fragment remains a bearer credential, so the pre-Router capture and
 * bounded scrub from #871/#2979 stay intact. The credential is never put into
 * the phone CTA: phones receive only the platform download target. A desktop
 * may exchange an emailed token for the existing one-use handoff QR.
 */
export default function AttendanceClaimLanding(): React.ReactElement | null {
  const nativePlatform: ClientPlatform | null =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : null;
  const [parsed, setParsed] = useState(false);
  const [claim, setClaim] = useState<ParsedAttendanceClaimFragment | null>(
    null,
  );
  const [clientPlatform, setClientPlatform] = useState<ClientPlatform | null>(
    nativePlatform,
  );
  const scheduleFinalUrlRestoreRef = React.useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setParsed(true);
      return;
    }
    let active = true;
    const raw = window.location.hash.replace(/^#/, "");
    const fragmentHandoff = consumeAttendanceClaimFragment(window, raw);
    const scrubAttendanceClaimFragment =
      createAttendanceClaimFragmentScrubber(fragmentHandoff);
    scheduleFinalUrlRestoreRef.current = scrubAttendanceClaimFragment(
      window.location,
      window.history,
      window.requestAnimationFrame.bind(window),
    );
    setClientPlatform(detectClientPlatform());
    void import("../../src/utils/attendanceClaimDeepLink").then(
      ({ attendanceClaimFromFragment }) => {
        if (!active) return;
        setClaim(attendanceClaimFromFragment(fragmentHandoff.fragment));
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

  const kind = claim?.kind === "rsvp" ? "pass" : "ticket";
  const title =
    kind === "pass"
      ? BUYER_CLAIM_COPY.pass.genericTitle
      : BUYER_CLAIM_COPY.order.genericTitle;
  const fallbackEntity = useMemo(
    () => ({
      entityType: kind === "pass" ? ("rsvp" as const) : ("event" as const),
      brandSlug: "mingla",
      entitySlug: "legacy-claim",
    }),
    [kind],
  );
  const target = useMemo(
    () =>
      clientPlatform === null
        ? null
        : resolveClaimPageTarget(fallbackEntity, clientPlatform),
    [clientPlatform, fallbackEntity],
  );
  const handoff = useMemo(() => {
    if (claim === null || claim.credentialKey !== "token") return null;
    return {
      mint: async () => {
        const result = await mintAttendanceClaimHandoff({
          version: 1,
          kind: claim.kind,
          eventId: claim.eventId,
          sourceId: claim.sourceId,
          token: claim.credential,
        });
        if (result.ok) {
          return {
            ok: true as const,
            handoffUrl: result.handoffUrl,
            expiresAt: new Date(
              Date.now() + result.expiresInSeconds * 1000,
            ).toISOString(),
          };
        }
        return {
          ok: false as const,
          reason:
            result.reason === "rate"
              ? ("rate_limited" as const)
              : result.reason === "network"
                ? ("network" as const)
                : ("invalid" as const),
          retryAfterSeconds: result.retryAfterSeconds,
        };
      },
    };
  }, [claim]);

  const openFromTap = useCallback((): void => {
    if (target === null) return;
    openExternal(target.ctaUrl);
  }, [target]);

  useEffect(() => {
    if (Platform.OS !== "web" || !parsed || typeof document === "undefined")
      return undefined;
    const prior =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTarget = document.querySelector(
      '[data-testid="attendance-claim-primary"]',
    );
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.history.back();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prior?.focus();
    };
  }, [parsed]);

  if (!parsed) return null;

  const canMintDesktopHandoff =
    clientPlatform === "other" && handoff !== null;

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {canMintDesktopHandoff ? (
          <BuyerClaimCard
            kind={kind}
            email={null}
            phoneLast4={null}
            shortUrl={target?.ctaUrl ?? null}
            handoff={handoff}
            textSent={false}
            variant="desktop"
            analyticsSurface="legacy_attendance_claim"
            fallbackEntity={fallbackEntity}
            waitingOverride={title}
            signInOverride={BUYER_CLAIM_COPY.signInGeneric}
          />
        ) : (
          <View
            style={styles.card}
            accessibilityRole="summary"
            accessibilityLabel={title}
            testID="attendance-claim-card"
          >
            <Text style={styles.brand}>Mingla</Text>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.body}>{BUYER_CLAIM_COPY.signInGeneric}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${BUYER_CLAIM_COPY.button[kind]}, opens the app store`}
              disabled={target === null}
              onPress={openFromTap}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                target === null && styles.buttonDisabled,
              ]}
              testID="attendance-claim-primary"
            >
              <Text style={styles.buttonText}>
                {BUYER_CLAIM_COPY.button[kind]}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1, overflow: "hidden" },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.12)",
    borderRadius: 24,
    backgroundColor: "#15181f",
    padding: 24,
  },
  brand: { color: "#ff6b2c", fontSize: 24, fontWeight: "900" },
  title: {
    color: "#fff",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    color: "rgba(255,255,255,.72)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  button: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#ff6b2c",
    paddingHorizontal: 18,
  },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#0c0e12", fontSize: 15, fontWeight: "900" },
});
