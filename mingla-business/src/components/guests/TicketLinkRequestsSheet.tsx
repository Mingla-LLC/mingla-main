import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import type { TicketLinkRequest } from "../../services/ticketLinksService";
import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { Sheet } from "../ui/Sheet";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";

const loadLinks = () => import("../../services/ticketLinksService");
const requestId = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 3) | 8).toString(16);
});

export const TicketLinkRequestsSheet: React.FC<{
  visible: boolean;
  eventId: string;
  onClose(): void;
  onChanged(): void;
}> = ({ visible, eventId, onClose, onChanged }) => {
  const [requests, setRequests] = useState<TicketLinkRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await (await loadLinks()).listTicketLinkRequests(eventId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't load requests.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { if (visible) void refresh(); }, [refresh, visible]);

  const decide = useCallback(async (request: TicketLinkRequest, decision: "approve" | "decline") => {
    setBusy(request.id);
    setMessage(null);
    try {
      const result = await (await loadLinks()).decideTicketLinkRequest({ signupId: request.id, decision, clientRequestId: requestId() });
      const lead = request.members[0]?.name ?? "Guest";
      setMessage(decision === "approve"
        ? `${lead} approved. ${result.issuedCount === 1 ? "Ticket" : "Tickets"} emailed.`
        : `${lead}'s request declined.`);
      await refresh();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't decide this request.");
    } finally {
      setBusy(null);
    }
  }, [onChanged, refresh]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full" dismissDisabled={busy !== null} testID="ticket-link-requests-sheet">
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.title}>Waiting for approval</Text>
          <Text style={styles.muted}>{requests.length} {requests.length === 1 ? "group asked" : "groups asked"} to join through your links.</Text>
        </View>
        <IconChrome icon="close" size={36} onPress={onClose} accessibilityLabel="Close" />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {loading && requests.length === 0 ? <Text style={styles.muted}>Loading requests…</Text> : null}
        {!loading && requests.length === 0 ? <Text style={styles.muted}>No requests are waiting.</Text> : null}
        {requests.map((request) => (
          <View key={request.id} style={styles.card}>
            <Text style={styles.cardTitle}>{request.members[0]?.name ?? "Guest"} · {request.memberCount} {request.memberCount === 1 ? "person" : "people"}</Text>
            <Text style={styles.muted}>{request.linkLabel} · {request.ticketTypeName}</Text>
            {(request.dates?.length ?? 0) > 0 ? (
              <Text style={styles.muted} testID={`ticket-link-request-dates-${request.id}`}>
                {(request.dates ?? [])
                  .map((date) => formatOccurrenceLine(date, date.timezone) ?? "Date to be confirmed")
                  .join(" · ")}
              </Text>
            ) : null}
            {request.members.map((member) => (
              <View key={member.position} style={styles.person}>
                <Text style={styles.personName}>{member.position === 0 ? `${member.name} (lead)` : member.name}</Text>
                <Text style={styles.muted}>{member.email} · {member.phone}{member.alreadyOnList ? " · Already on the list" : ""}</Text>
              </View>
            ))}
            <View style={styles.actions}>
              <Button label="Approve group" loading={busy === request.id} disabled={busy !== null} onPress={() => { void decide(request, "approve"); }} />
              <Button label="Decline" variant="destructiveOutline" disabled={busy !== null} onPress={() => { void decide(request, "decline"); }} />
            </View>
          </View>
        ))}
      </ScrollView>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  heading: { flex: 1, gap: 4 },
  title: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  muted: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: 120 },
  card: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase, gap: spacing.sm },
  cardTitle: { color: textTokens.primary, fontSize: 16, fontWeight: "700" },
  person: { gap: 2 },
  personName: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  message: { color: textTokens.primary, textAlign: "center", margin: spacing.md },
});

export default TicketLinkRequestsSheet;
