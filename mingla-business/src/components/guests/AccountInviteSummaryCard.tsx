// #3682 wave 2 — followers invited through their Mingla account (not in Your
// Book). The host sees names, avatars and whether each was reached; contact
// details never reach this screen.
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useOfferingAccountInvites } from "../../hooks/useOfferingAccountInvites";
import type {
  OfferingAccountInviteRecipient,
  OfferingAccountInvites,
} from "../../services/offeringAccountInvitesService";

const REASON: Record<OfferingAccountInviteRecipient["reason"], string> = {
  follower: "Follows you",
  extended: "Friend of a follower",
};

export function accountInviteStatusLine(row: OfferingAccountInviteRecipient): string {
  const reached = [row.push === "sent" ? "Mingla" : null, row.email === "sent" ? "email" : null]
    .filter(Boolean);
  if (reached.length > 0) return `Reached by ${reached.join(" and ")}`;
  if (row.push === "queued" || row.email === "queued") return "Sending…";
  return "Not reached (their settings or limits)";
}

export function AccountInviteSummaryView({ data }: { data: OfferingAccountInvites }) {
  if (data.counts.invited === 0) return null;
  const { counts } = data;
  return (
    <View style={styles.card} accessibilityRole="summary" testID="account-invite-summary">
      <Text style={styles.title}>Followers invited through Mingla</Text>
      <Text style={styles.body}>
        {`${counts.invited} invited · ${counts.reached} reached` +
          (counts.pending > 0 ? ` · ${counts.pending} sending` : "") +
          (counts.notReached > 0 ? ` · ${counts.notReached} not reached` : "")}
      </Text>
      <Text style={styles.note}>Their contact details stay private.</Text>
      {data.recipients.slice(0, 12).map((row, index) => (
        <View key={`${row.displayName}:${index}`} style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{row.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{row.displayName}</Text>
            <Text style={styles.note} numberOfLines={1}>
              {`${REASON[row.reason]} · ${accountInviteStatusLine(row)}`}
            </Text>
          </View>
        </View>
      ))}
      {data.recipients.length > 12 ? (
        <Text style={styles.note}>{`And ${data.recipients.length - 12} more`}</Text>
      ) : null}
    </View>
  );
}

export function AccountInviteSummaryCard({ eventId }: { eventId: string }) {
  const query = useOfferingAccountInvites(eventId);
  // Optional supplement to the roster: when it cannot load, the roster above
  // still carries the full guest truth, so this card simply stays out.
  if (!query.data) return null;
  return <AccountInviteSummaryView data={query.data} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusTokens.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: { color: textTokens.primary, fontSize: 15, fontWeight: "800" },
  body: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  note: { color: textTokens.secondary, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xs },
  avatar: {
    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: glass.border.profileBase,
  },
  avatarText: { color: textTokens.primary, fontSize: 12, fontWeight: "800" },
  flex: { flex: 1 },
  name: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
});
