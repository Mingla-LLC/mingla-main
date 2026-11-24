/**
 * #4490 spec 08 O5 part A — what the Till route shows first.
 *
 * - An account that is not a Till device (an owner's or a manager's own
 *   phone) never enters shared mode: the Till opens exactly as before.
 * - A Till device login always opens on "Who's selling?"; once someone
 *   switches in, the Till acts as them (the server checks every call) with a
 *   "{name} is selling · Switch" chip, and locks itself after the venue's
 *   auto-lock minutes without a touch, after which Who's selling shows again.
 *
 * The PIN session lives in memory only (services/tillStaffSession.ts); the
 * list of who may switch in is read fresh (never persisted). Switching person
 * remounts the Till and drops its cached reads, so nothing one person saw is
 * shown as another's.
 */

import React, { useCallback, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useAuth } from "../../../context/AuthContext";
import { venueTillKeys } from "../../../hooks/useVenueTill";
import {
  noteTillActivity,
  tillSessionEndedReason,
  tillSessionIdle,
  useTillStaffSession,
  getTillStaffSession,
} from "../../../services/tillStaffSession";
import { endTillPin, fetchTillPinStaff, type TillPinStaff } from "../../../services/venueTillService";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { Spinner } from "../../ui/Spinner";
import { TillScreen, type TillScreenProps } from "./TillScreen";
import { TillSoldOutHost } from "./TillSoldOut";
import { WhoIsSelling } from "./WhoIsSelling";
import { PIN_COPY, approvers } from "./pinModel";

/** How often the auto-lock clock is looked at. */
export const TILL_AUTO_LOCK_TICK_MS = 15_000;

export const tillPinKeys = {
  staff: (venueId: string) => ["venueTill", venueId, "pinStaff"] as const,
};

export function TillGate(props: TillScreenProps & { startSigningOut?: boolean }): React.ReactElement {
  const { venueId, startSigningOut = false, ...screenProps } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthReady } = useAuth();
  const session = useTillStaffSession(venueId);
  const staffQuery = useQuery<TillPinStaff>({
    queryKey: tillPinKeys.staff(venueId),
    enabled: isAuthReady,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => fetchTillPinStaff(venueId),
  });
  const staff = staffQuery.data;
  const sessionId = session?.token ?? null;

  // Nobody switched in: nothing cached from the last person is kept for the next.
  useEffect(() => {
    if (staff?.gated !== true || sessionId !== null) return;
    queryClient.removeQueries({
      queryKey: venueTillKeys.all(venueId),
      predicate: (q) => q.queryKey[2] !== "pinStaff",
    });
  }, [queryClient, sessionId, staff?.gated, venueId]);

  // Auto-lock: no touch for the venue's minutes ends the session.
  useEffect(() => {
    if (sessionId === null) return undefined;
    const timer = setInterval(() => {
      const s = getTillStaffSession(venueId);
      if (s !== null && tillSessionIdle(s, Date.now())) {
        endTillPin(venueId, "auto_lock").catch((err: unknown) => {
          // The session is already gone here; the server's idle lock ends it there too.
          console.warn("[till-pin] auto-lock end failed", err instanceof Error ? err.message : "unknown");
        });
      }
    }, TILL_AUTO_LOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [sessionId, venueId]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/venue/${venueId}` as never);
  }, [router, venueId]);

  const switchSeller = useCallback(() => {
    endTillPin(venueId).catch((err: unknown) => {
      console.warn("[till-pin] switch end failed", err instanceof Error ? err.message : "unknown");
    });
    void staffQuery.refetch();
  }, [staffQuery, venueId]);

  if (staffQuery.isLoading) {
    return (
      <View style={styles.center} testID="till-gate-loading">
        <Spinner />
      </View>
    );
  }
  if (staffQuery.isError || staff === undefined) {
    return (
      <View style={styles.center}>
        <CenteredState title={PIN_COPY.loadFailed} body={PIN_COPY.loadFailedBody} tone="error" testID="till-gate-error">
          <Button label={PIN_COPY.retry} variant="secondary" onPress={() => void staffQuery.refetch()} testID="till-gate-retry" />
        </CenteredState>
      </View>
    );
  }
  if (!staff.gated) return <TillScreen venueId={venueId} {...screenProps} soldOutSlot={<TillSoldOutHost venueId={venueId} />} />;
  // #4490 O5 part B: Account › Sign out on a Till device lands here on the
  // same "Who's signing this Till out?" step (one sign-out flow).
  if (session === null || startSigningOut) {
    return <WhoIsSelling venueId={venueId} staff={staff} ended={tillSessionEndedReason(venueId)} onClose={close}
      startSigningOut={startSigningOut} />;
  }
  return (
    <View
      style={styles.fill}
      onStartShouldSetResponderCapture={() => {
        noteTillActivity(venueId);
        return false;
      }}
      testID="till-gate-session"
    >
      <TillScreen
        key={session.token}
        venueId={venueId}
        {...screenProps}
        sellerSlot={
          <View style={styles.chip} testID="till-seller-chip">
            <Text style={styles.chipText} numberOfLines={1}>{PIN_COPY.sellerChip(session.name)}</Text>
            <Button label={PIN_COPY.switchSeller} variant="secondary" size="sm" onPress={switchSeller} testID="till-switch-seller" />
          </View>
        }
        stepUpApprovers={approvers(staff.people)}
        soldOutSlot={<TillSoldOutHost venueId={venueId} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas, padding: space[4] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: space[3],
    borderRadius: radius.full,
    backgroundColor: color.card2,
    // #4490 08-O5 fix 5: in the wrapping header row the chip may use the whole width.
    maxWidth: "100%",
    flexShrink: 1,
  },
  chipText: { ...type.caption, color: color.text1, flexShrink: 1 },
});
