/**
 * DoorGuestSearchSheet — issue #3827 "Find a guest by name" at the door.
 *
 * Door staff (scanner role, or event manager and above) search the event's
 * ticket holders — guest-list guests AND buyers — and Admit a ticket. Admit is
 * the SAME server check as a QR scan (guest-list `admit` →
 * biz_ticket_admit_by_id → biz_ticket_scan), so a second admit, or scanning
 * the QR afterwards, says "Already checked in".
 *
 * Online only, like QR scanning. Shows names, masked emails and ticket states;
 * never phones, full emails, prices or notes.
 *
 * `DoorGuestSearchPanel` is the content (the web door renders it inline);
 * `DoorGuestSearchSheet` wraps it in a Sheet for the native camera screen.
 * No camera or haptics import here — the native parent adds haptics through
 * `onAdmitted`.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper (keyboard clearance).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { eventOrdersKeys } from "../../hooks/useEventOrders";
import {
  GuestListError,
  admitTicket,
  guestListErrorCopy,
  searchDoorGuests,
  type AdmitResponse,
  type DoorGuest,
  type DoorGuestTicket,
} from "../../services/guestListService";
import { describeScanResult, type ScanResultCopy } from "./scanResultCopy";

import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export const doorGuestSearchKeys = {
  all: ["door-guest-search"] as const,
  search: (eventId: string, query: string) =>
    ["door-guest-search", eventId, query.trim().toLowerCase()] as const,
};

const formatClock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
};

export const ticketStateLabel = (ticket: DoorGuestTicket): string | null => {
  if (ticket.status === "used" || ticket.usedAt !== null) {
    return ticket.usedAt !== null ? `Checked in ${formatClock(ticket.usedAt)}` : "Checked in";
  }
  if (ticket.status === "void") return "Cancelled";
  if (ticket.status === "refunded") return "Refunded";
  if (ticket.status === "transferred") return "Transferred";
  return null; // admissible
};

export interface DoorGuestSearchPanelProps {
  eventId: string;
  /** The offering noun for result copy ("event"). */
  noun: string;
  /** Called after every admit with the door copy, for overlays, haptics and the session log. */
  onAdmitted?: (copy: ScanResultCopy, response: AdmitResponse) => void;
  autoFocus?: boolean;
}

export const DoorGuestSearchPanel: React.FC<DoorGuestSearchPanelProps> = ({
  eventId,
  noun,
  onAdmitted,
  autoFocus = false,
}) => {
  const queryClient = useQueryClient();
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false || network?.isInternetReachable === false;
  const [text, setText] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");
  const [admitting, setAdmitting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScanResultCopy | null>(null);
  const [admitError, setAdmitError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const enabled = debounced.length >= MIN_CHARS && !offline;
  const query = useQuery<{ orders: DoorGuest[]; truncated: boolean }>({
    queryKey: doorGuestSearchKeys.search(eventId, debounced),
    enabled,
    staleTime: 0,
    queryFn: () => searchDoorGuests({ eventId, query: debounced }),
    retry: false,
  });

  const admit = useCallback(
    async (guest: DoorGuest, tickets: DoorGuestTicket[]): Promise<void> => {
      if (admitting !== null || tickets.length === 0) return;
      setAdmitting(guest.orderId);
      setAdmitError(null);
      try {
        let copy: ScanResultCopy | null = null;
        let admitted = 0;
        for (const ticket of tickets) {
          const res = await admitTicket({ eventId, ticketId: ticket.ticketId });
          copy = describeScanResult(
            res.result,
            { buyerName: res.buyerName ?? guest.displayName, ticketName: res.ticketName ?? ticket.ticketName, nextStartAt: res.nextStartAt, lastEndAt: res.lastEndAt },
            noun,
          );
          if (res.result === "success") admitted += 1;
          onAdmitted?.(copy, res);
        }
        if (copy !== null && tickets.length > 1 && admitted > 1) {
          copy = { ...copy, message: `${guest.displayName}: ${admitted} checked in` };
        }
        setLastResult(copy);
      } catch (error) {
        setAdmitError(error instanceof GuestListError ? error.message : guestListErrorCopy("network", "admit"));
      } finally {
        setAdmitting(null);
        void query.refetch();
        void queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
      }
    },
    [admitting, eventId, noun, onAdmitted, query, queryClient],
  );

  const errorCopy = query.error instanceof GuestListError
    ? query.error.code === "network" || query.error.code === "internal"
      ? "Couldn't search. Check your connection and try again."
      : query.error.message
    : query.isError
      ? "Couldn't search. Check your connection and try again."
      : null;

  const results = query.data?.orders ?? [];

  return (
    <View style={styles.panel}>
      <View style={[styles.inputWrap, offline && styles.inputDisabled]}>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            setLastResult(null);
            setAdmitError(null);
          }}
          placeholder="Search name or email"
          placeholderTextColor={textTokens.quaternary}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus={autoFocus}
          editable={!offline}
          maxLength={80}
          style={styles.input}
          accessibilityLabel="Search name or email"
          testID="door-guest-search-input"
        />
      </View>

      {offline ? (
        <View style={[styles.banner, styles.bannerError]} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>You're offline. Connect to search the guest list.</Text>
        </View>
      ) : text.trim().length > 0 && text.trim().length < MIN_CHARS ? (
        <Text style={styles.helper}>Type at least 2 letters.</Text>
      ) : null}

      {lastResult !== null ? (
        <View
          style={[styles.resultCard, lastResult.tone === "success" ? styles.resultOk : lastResult.tone === "warning" ? styles.resultWarn : styles.resultBad]}
          accessibilityLiveRegion="assertive"
          testID="door-guest-admit-result"
        >
          <Text style={styles.resultMessage}>{lastResult.message}</Text>
          {lastResult.detail !== undefined ? <Text style={styles.resultDetail}>{lastResult.detail}</Text> : null}
        </View>
      ) : null}
      {admitError !== null ? (
        <View style={[styles.banner, styles.bannerError]} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>{admitError}</Text>
        </View>
      ) : null}

      {enabled && query.isFetching && query.data === undefined ? (
        <View style={styles.stateRow} accessibilityRole="progressbar" accessibilityLabel="Searching">
          <ActivityIndicator color={textTokens.secondary} />
          <Text style={styles.helper}>Searching…</Text>
        </View>
      ) : null}

      {enabled && errorCopy !== null ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{errorCopy}</Text>
          <Button label="Try again" onPress={() => { void query.refetch(); }} variant="secondary" size="sm" accessibilityLabel="Try the search again" />
        </View>
      ) : null}

      {enabled && query.isSuccess && results.length === 0 ? (
        <Text style={styles.helper}>{`No one called "${debounced}" on this ${noun}'s list.`}</Text>
      ) : null}

      {enabled && results.length > 0 ? (
        <View style={styles.results}>
          {results.map((guest) => {
            const open = guest.tickets.filter((t) => ticketStateLabel(t) === null);
            return (
              <View key={guest.orderId} style={styles.guestRow}>
                <View style={styles.guestHead}>
                  <Text style={styles.guestName} numberOfLines={1}>{guest.displayName}</Text>
                  {guest.isGuestList ? <Pill variant="accent">GUEST LIST</Pill> : null}
                </View>
                <Text style={styles.guestMeta}>{guest.maskedEmail ?? "No email"}</Text>
                {guest.cameWithName !== null ? <Text style={styles.guestMeta}>{`with ${guest.cameWithName}`}</Text> : null}
                {guest.tickets.map((ticket) => {
                  const state = ticketStateLabel(ticket);
                  return (
                    <View
                      key={ticket.ticketId}
                      style={styles.ticketRow}
                      accessible={state !== null}
                      accessibilityLabel={state !== null ? `${guest.displayName}, ${ticket.ticketName}, ${state}` : undefined}
                    >
                      <Text style={styles.ticketName} numberOfLines={1}>{ticket.ticketName}</Text>
                      {state !== null ? (
                        <Text style={styles.ticketState}>{state}</Text>
                      ) : (
                        <Button
                          label="Admit"
                          onPress={() => { void admit(guest, [ticket]); }}
                          variant="primary"
                          size="sm"
                          loading={admitting === guest.orderId}
                          disabled={admitting !== null}
                          accessibilityLabel={`Admit ${guest.displayName}, ${ticket.ticketName}`}
                        />
                      )}
                    </View>
                  );
                })}
                {open.length > 1 ? (
                  <Button
                    label={`Admit all ${open.length}`}
                    onPress={() => { void admit(guest, open); }}
                    variant="secondary"
                    size="sm"
                    disabled={admitting !== null}
                    accessibilityLabel={`Admit all ${open.length} tickets for ${guest.displayName}`}
                  />
                ) : null}
              </View>
            );
          })}
          {query.data?.truncated === true ? (
            <Text style={styles.helper}>More people match. Type more of the name.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export interface DoorGuestSearchSheetProps extends DoorGuestSearchPanelProps {
  visible: boolean;
  onClose: () => void;
}

export const DoorGuestSearchSheet: React.FC<DoorGuestSearchSheetProps> = ({ visible, onClose, ...panel }) => (
  <Sheet visible={visible} onClose={onClose} snapPoint="full">
    <View style={styles.sheetBody}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Find a guest by name</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close guest search" hitSlop={12} style={styles.closeHit}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {visible ? <DoorGuestSearchPanel {...panel} autoFocus /> : null}
      </ScrollView>
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  sheetBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
  },
  closeHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  closeText: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  scrollFlex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  panel: {
    gap: spacing.sm,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  input: {
    fontSize: 16,
    color: textTokens.primary,
    minHeight: 44,
  },
  helper: {
    fontSize: 13,
    color: textTokens.tertiary,
  },
  errorText: {
    fontSize: 13,
    color: semantic.error,
  },
  banner: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    padding: spacing.sm + 2,
  },
  bannerError: {
    borderColor: semantic.error,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  bannerText: {
    fontSize: 13,
    color: textTokens.primary,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stateBlock: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  results: {
    gap: spacing.sm,
  },
  guestRow: {
    gap: 6,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  guestHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  guestName: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
    color: textTokens.primary,
  },
  guestMeta: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: 44,
  },
  ticketName: {
    flex: 1,
    fontSize: 13,
    color: textTokens.secondary,
  },
  ticketState: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  resultCard: {
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    padding: spacing.md,
    alignItems: "center",
    gap: 4,
  },
  resultOk: {
    borderColor: "rgba(52, 199, 89, 0.5)",
    backgroundColor: "rgba(52, 199, 89, 0.14)",
  },
  resultWarn: {
    borderColor: "rgba(235, 120, 37, 0.5)",
    backgroundColor: "rgba(235, 120, 37, 0.14)",
  },
  resultBad: {
    borderColor: "rgba(239, 68, 68, 0.5)",
    backgroundColor: "rgba(239, 68, 68, 0.14)",
  },
  resultMessage: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  resultDetail: {
    fontSize: 13,
    color: textTokens.secondary,
    textAlign: "center",
  },
});

export default DoorGuestSearchSheet;
