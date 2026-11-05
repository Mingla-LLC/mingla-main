/**
 * Issue #4261 Wave B1 — the "{name} wants to join" card in a group chat
 * (prototype Main.dc.html, `item.isReq`). Rendered by MessageInterface (Wave
 * B2 wires it) for a system row whose card_payload is
 * `{kind:'group_event', event:'join_request', requestId}`.
 *
 * The card re-renders from the live request row (no chat line on a decision):
 * pending → Decline / Let them in (any member can answer); approved →
 * "{name} joined"; declined → "{name} was not let in". Until the row loads it
 * shows the server's own line, with no buttons.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { chatTokens } from "../../constants/chatTokens";
import { useDecideJoinRequest, useGroupJoinRequests } from "../../hooks/useGroupLink";

interface GroupJoinRequestCardProps {
  conversationId: string;
  requestId: string;
  groupName: string;
  /** The system message's content ("Ada wants to join"), for old rows / loading. */
  fallbackText: string;
}

export function GroupJoinRequestCard({
  conversationId,
  requestId,
  groupName,
  fallbackText,
}: GroupJoinRequestCardProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const requests = useGroupJoinRequests(conversationId);
  const decide = useDecideJoinRequest(conversationId, groupName);
  const request = requests.data?.find((r) => r.id === requestId) ?? null;

  const name = request?.userName ?? null;
  const title = !request || !name
    ? fallbackText
    : request.status === "pending"
      ? t("chat:group_join_wants", { name })
      : request.status === "approved"
        ? t("chat:group_join_joined", { name })
        : t("chat:group_join_declined", { name });
  const sub = !request
    ? null
    : request.status === "pending"
      ? request.sharerName
        ? t("chat:group_join_sub_pending", { sharer: request.sharerName })
        : null
      : request.status === "approved"
        ? t("chat:group_join_sub_in")
        : t("chat:group_join_sub_out");
  const initial = (name ?? fallbackText).trim().slice(0, 1).toUpperCase() || "?";
  const busy = decide.isPending;

  const answer = (approve: boolean) => {
    if (!request || busy) return;
    decide.mutate({ requestId: request.id, approve, joinerId: request.user_id });
  };

  return (
    <View style={styles.card} testID="group-join-request-card" accessibilityLiveRegion="polite">
      <View style={styles.top}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>{title}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
        {requests.isLoading ? <ActivityIndicator size="small" color={chatTokens.textMuted} /> : null}
      </View>
      {request?.status === "pending" ? (
        <View style={styles.buttons}>
          <Pressable
            onPress={() => answer(false)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("chat:group_join_decline")}
            accessibilityState={{ disabled: busy, busy: busy && decide.variables?.approve === false }}
            style={({ pressed }) => [styles.button, styles.decline, pressed || busy ? styles.pressed : null]}
          >
            <Text style={styles.declineText}>{t("chat:group_join_decline")}</Text>
          </Pressable>
          <Pressable
            onPress={() => answer(true)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("chat:group_join_let_in")}
            accessibilityState={{ disabled: busy, busy: busy && decide.variables?.approve === true }}
            style={({ pressed }) => [styles.button, styles.letIn, pressed || busy ? styles.pressed : null]}
          >
            {busy && decide.variables?.approve === true ? (
              <ActivityIndicator size="small" color={chatTokens.textPrimary} />
            ) : (
              <Text style={styles.letInText}>{t("chat:group_join_let_in")}</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatTokens.hairline,
    backgroundColor: chatTokens.surface,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: chatTokens.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  sub: {
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  buttons: {
    flexDirection: "row",
    gap: 6,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  decline: {
    borderWidth: 1,
    borderColor: chatTokens.hairline,
  },
  declineText: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  letIn: {
    backgroundColor: chatTokens.accent,
  },
  letInText: {
    fontSize: 14,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  pressed: {
    opacity: 0.6,
  },
});
