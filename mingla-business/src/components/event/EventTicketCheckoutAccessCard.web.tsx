import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import {
  useBusinessEventTicketCheckoutAccess,
  useMutateEventTicketCheckoutAccess,
} from "../../hooks/useEventTicketCheckoutAccess";
import type { TicketCheckoutAccessMember } from "../../services/eventTicketCheckoutAccessService";
import { Button } from "../ui/Button";

export interface EventTicketCheckoutAccessCardProps {
  eventId: string;
}

const errorCopy = (error: Error): string => {
  if (error.message.includes("STALE_ACCESS_POLICY")) return "This list changed elsewhere. Refresh and try again.";
  if (error.message.includes("ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE")) return "A checkout is still active. Close ticket sales and wait for it to finish before restricting access.";
  if (error.message.includes("BUYER_NOT_AVAILABLE")) return "That username isn't available to add.";
  if (error.message.includes("MAX_ACTIVE_BUYERS")) return "This list already has 20 approved buyers.";
  return "We couldn't update eligible buyers. Check your connection and try again.";
};

const MemberRow: React.FC<{
  member: TicketCheckoutAccessMember;
  disabled: boolean;
  onRemove: () => void;
}> = ({ member, disabled, onRemove }) => (
  <View style={styles.memberRow}>
    <View style={styles.memberCopy}>
      <Text style={styles.memberLabel}>{member.label}</Text>
      {member.username !== null ? <Text style={styles.memberMeta}>@{member.username}</Text> : null}
    </View>
    <Button
      label="Remove"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onPress={onRemove}
      accessibilityLabel={`Remove ${member.label} from eligible buyers`}
    />
  </View>
);

export const EventTicketCheckoutAccessCard: React.FC<
  EventTicketCheckoutAccessCardProps
> = ({ eventId }) => {
  const query = useBusinessEventTicketCheckoutAccess(eventId);
  const revision = query.data?.configRevision ?? 0;
  const mutation = useMutateEventTicketCheckoutAccess(eventId, revision);
  const [username, setUsername] = useState("");
  const [pendingMode, setPendingMode] = useState<"unrestricted" | "named_buyers" | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<TicketCheckoutAccessMember | null>(null);
  const announcement = useMemo(() => {
    if (mutation.isSuccess) return mutation.data.outcome === "changed" ? "Eligible buyers updated." : "No changes were needed.";
    if (mutation.isError) return errorCopy(mutation.error);
    return "";
  }, [mutation.data, mutation.error, mutation.isError, mutation.isSuccess]);

  if (query.isLoading) {
    return <View style={styles.card} testID="eligible-buyers-loading"><ActivityIndicator /><Text style={styles.body}>Loading eligible buyers…</Text></View>;
  }
  if (query.isError || query.data === undefined) {
    return (
      <View style={styles.card} testID="eligible-buyers-error">
        <Text style={styles.title}>Eligible buyers</Text>
        <Text style={styles.error}>We couldn't load this checkout setting.</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={() => void query.refetch()} />
      </View>
    );
  }

  const data = query.data;
  const saving = mutation.isPending;
  return (
    <View style={styles.card} testID="eligible-buyers-card">
      <Text style={styles.title}>Eligible buyers</Text>
      <Text style={styles.body}>
        Keep checkout open to everyone, or approve specific signed-in Mingla accounts. This does not hide the public page.
      </Text>
      <View style={styles.modeRow} accessibilityRole="radiogroup">
        {(["unrestricted", "named_buyers"] as const).map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityState={{ checked: data.mode === mode, disabled: saving }}
            accessibilityLabel={mode === "unrestricted" ? "Anyone can buy" : "Only approved buyers"}
            disabled={saving || data.mode === mode}
            onPress={() => setPendingMode(mode)}
            style={[styles.modeButton, data.mode === mode && styles.modeButtonActive]}
          >
            <Text style={styles.modeText}>{mode === "unrestricted" ? "Anyone" : "Approved buyers"}</Text>
          </Pressable>
        ))}
      </View>

      {pendingMode !== null ? (
        <View style={styles.confirmBox} accessibilityRole="alert">
          <Text style={styles.body}>
            {pendingMode === "unrestricted"
              ? "Allow anyone to buy tickets for this public offering?"
              : "Restrict checkout to the approved accounts below?"}
          </Text>
          <View style={styles.actionRow}>
            <Button label="Cancel" variant="ghost" size="sm" onPress={() => setPendingMode(null)} />
            <Button
              label="Confirm"
              size="sm"
              loading={saving}
              onPress={async () => {
                await mutation.mutateAsync({ kind: "set_mode", mode: pendingMode });
                setPendingMode(null);
              }}
            />
          </View>
        </View>
      ) : null}

      {data.mode === "named_buyers" && data.members.length === 0 ? (
        <Text style={styles.warning} accessibilityRole="alert">No one can check out until you add an approved buyer.</Text>
      ) : null}

      <View style={styles.actionRow}>
        <Button
          label="Add my account"
          variant="secondary"
          size="sm"
          disabled={saving}
          onPress={() => mutation.mutate({ kind: "add_self" })}
        />
      </View>
      <Text style={styles.fieldLabel}>Add exact public username</Text>
      <View style={styles.addRow}>
        <TextInput
          value={username}
          onChangeText={setUsername}
          editable={!saving}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          accessibilityLabel="Exact public username"
          style={styles.input}
          onSubmitEditing={() => {
            if (username.trim().length > 0) mutation.mutate({ kind: "add_username", username });
          }}
        />
        <Button
          label="Add"
          size="sm"
          disabled={saving || username.trim().length === 0}
          onPress={async () => {
            await mutation.mutateAsync({ kind: "add_username", username });
            setUsername("");
          }}
        />
      </View>

      {data.members.map((member) => (
        <MemberRow key={member.membershipId} member={member} disabled={saving} onRemove={() => setPendingRemoval(member)} />
      ))}
      {pendingRemoval !== null ? (
        <View style={styles.confirmBox} accessibilityRole="alert">
          <Text style={styles.body}>Remove {pendingRemoval.label} from checkout access?</Text>
          <View style={styles.actionRow}>
            <Button label="Keep" variant="ghost" size="sm" onPress={() => setPendingRemoval(null)} />
            <Button
              label="Remove"
              variant="destructive"
              size="sm"
              loading={saving}
              onPress={async () => {
                await mutation.mutateAsync({ kind: "remove", membershipId: pendingRemoval.membershipId });
                setPendingRemoval(null);
              }}
            />
          </View>
        </View>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={mutation.isError ? styles.error : styles.srStatus}>
        {announcement}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  title: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.bodySm, color: textTokens.secondary },
  fieldLabel: { ...typography.caption, color: textTokens.secondary },
  modeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  modeButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  modeButtonActive: { borderColor: "#EB7825", backgroundColor: "rgba(235,120,37,0.16)" },
  modeText: { ...typography.bodySm, color: textTokens.primary },
  actionRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", color: textTokens.primary },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  memberCopy: { flex: 1 },
  memberLabel: { ...typography.bodySm, color: textTokens.primary },
  memberMeta: { ...typography.caption, color: textTokens.tertiary },
  confirmBox: { gap: spacing.sm, padding: spacing.md, borderRadius: 12, backgroundColor: "rgba(235,120,37,0.10)" },
  warning: { ...typography.bodySm, color: semantic.warning },
  error: { ...typography.bodySm, color: semantic.error },
  srStatus: { ...typography.caption, color: textTokens.secondary },
});

export default EventTicketCheckoutAccessCard;
