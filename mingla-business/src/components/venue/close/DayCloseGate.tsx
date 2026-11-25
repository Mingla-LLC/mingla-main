/**
 * #4490 spec 08 O5 part B — who Close the day acts as.
 *
 * - An owner's or a manager's own phone: as themselves, as everywhere else.
 * - A Till device login: "Who's selling?" first (part A's WhoIsSelling); once
 *   someone with money rights switches in, Close the day acts as them, the
 *   reopen and export ask for the PIN again, and the session locks after the
 *   venue's auto-lock minutes like the Till. The server re-checks the session
 *   on every call. Switching person drops the cached day.
 *
 * The session is the Till's own (memory only, services/tillStaffSession.ts):
 * switching in on the Till or here is the same session.
 */

import React, { useCallback, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useAuth } from "../../../context/AuthContext";
import { venueDayCloseKeys } from "../../../hooks/useVenueDayClose";
import {
  getTillStaffSession,
  noteTillActivity,
  tillSessionEndedReason,
  tillSessionIdle,
  useTillStaffSession,
} from "../../../services/tillStaffSession";
import { endTillPin, fetchTillPinStaff, type TillPinStaff } from "../../../services/venueTillService";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { Spinner } from "../../ui/Spinner";
import { TILL_AUTO_LOCK_TICK_MS, tillPinKeys } from "../till/TillGate";
import { WhoIsSelling } from "../till/WhoIsSelling";
import { approvers, PIN_COPY } from "../till/pinModel";
import { DayCloseScreen } from "./DayCloseScreen";

export function DayCloseGate({ venueId }: { venueId: string }): React.ReactElement {
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

  // Nobody switched in on a Till device: nothing of the last person's day is kept.
  useEffect(() => {
    if (staff?.gated !== true || sessionId !== null) return;
    queryClient.removeQueries({ queryKey: venueDayCloseKeys.all(venueId) });
  }, [queryClient, sessionId, staff?.gated, venueId]);

  // Auto-lock, as on the Till.
  useEffect(() => {
    if (sessionId === null) return undefined;
    const timer = setInterval(() => {
      const s = getTillStaffSession(venueId);
      if (s !== null && tillSessionIdle(s, Date.now())) {
        endTillPin(venueId, "auto_lock").catch((err: unknown) => {
          console.warn("[day-close] auto-lock end failed", err instanceof Error ? err.message : "unknown");
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
      console.warn("[day-close] switch end failed", err instanceof Error ? err.message : "unknown");
    });
    void staffQuery.refetch();
  }, [staffQuery, venueId]);

  if (staffQuery.isLoading) {
    return (
      <View style={styles.center} testID="day-close-gate-loading">
        <Spinner />
      </View>
    );
  }
  if (staffQuery.isError || staff === undefined) {
    return (
      <View style={styles.center}>
        <CenteredState title={PIN_COPY.loadFailed} body={PIN_COPY.loadFailedBody} testID="day-close-gate-error">
          <Button label={PIN_COPY.retry} variant="secondary" onPress={() => void staffQuery.refetch()} testID="day-close-gate-retry" />
        </CenteredState>
      </View>
    );
  }
  if (!staff.gated) return <DayCloseScreen venueId={venueId} approvers={null} />;
  if (session === null) {
    return <WhoIsSelling venueId={venueId} staff={staff} ended={tillSessionEndedReason(venueId)} onClose={close} />;
  }
  return (
    <View
      style={styles.fill}
      onStartShouldSetResponderCapture={() => {
        noteTillActivity(venueId);
        return false;
      }}
      testID="day-close-gate-session"
    >
      <DayCloseScreen
        key={session.token}
        venueId={venueId}
        approvers={approvers(staff.people)}
        sellerSlot={
          <View style={styles.chip} testID="day-close-seller-chip">
            <Text style={styles.chipText} numberOfLines={1}>{PIN_COPY.sellerChip(session.name)}</Text>
            <Button label={PIN_COPY.switchSeller} variant="secondary" size="sm" onPress={switchSeller} testID="day-close-switch-seller" />
          </View>
        }
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
    // #4490 08-O5 fix 6: on a phone the chip has its own row (DayCloseScreen),
    // so the seller's name has the whole width ("T4490 Ma…" at 50%).
    maxWidth: "100%",
    flexShrink: 1,
  },
  chipText: { ...type.caption, color: color.text1, flexShrink: 1 },
});
