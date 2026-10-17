import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandGroupSignalModal } from "../../src/components/messages/BrandGroupSignalModal";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import {
  listBrandGroupMessages,
  markBrandGroupRead,
  sendBrandGroupMessage,
  setBrandGroupWatch,
  type BrandGroupMessage,
} from "../../src/services/brandGroupsService";
import { supabase } from "../../src/services/supabase";

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" && item.length ? item : null;
}

export default function BrandGroupThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; mode?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const requestedMode = first(params.mode);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const staff = useSupportStaff();
  const { groups, refresh: refreshGroups } = useBrandGroups();
  const group = groups.find((item) => item.conversation_id === conversationId) ?? null;
  const canBrand = group?.access_kind === "brand";
  const canSupport = staff.isStaff;
  const [actorMode, setActorMode] = useState<"brand" | "support">(
    requestedMode === "support" ? "support" : "brand",
  );
  const [messages, setMessages] = useState<BrandGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<BrandGroupMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [watching, setWatching] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [signalSourceId, setSignalSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    setWatching(group.push_enabled);
    if (group.access_kind === "support") setActorMode("support");
    else if (!canSupport) setActorMode("brand");
  }, [canSupport, group]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setError("We couldn't open this Brand group.");
      setLoading(false);
      return;
    }
    try {
      const result = await listBrandGroupMessages(conversationId);
      if (result.error) throw new Error(result.error);
      setMessages(result.messages);
      setError(null);
      await markBrandGroupRead(conversationId);
      await refreshGroups();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load this Brand group");
    } finally {
      setLoading(false);
    }
  }, [conversationId, refreshGroups]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`brand-group:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, refresh]);

  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedIds.includes(message.id)),
    [messages, selectedIds],
  );

  async function send(): Promise<void> {
    if (!conversationId || !composer.trim() || sending) return;
    setSending(true);
    try {
      await sendBrandGroupMessage({
        conversationId,
        content: composer.trim(),
        replyToId: replyTo?.id,
        relatedMessageIds: selectedIds,
        actorMode,
      });
      setComposer("");
      setReplyTo(null);
      setSelectedIds([]);
      await refresh();
    } catch (cause) {
      Alert.alert("Message not sent", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setSending(false);
    }
  }

  async function toggleWatch(): Promise<void> {
    if (!conversationId || watchBusy) return;
    setWatchBusy(true);
    try {
      const enabled = await setBrandGroupWatch(conversationId, !watching);
      setWatching(enabled);
      setNotice(enabled ? "Push notifications are on for this Brand group." : "You will still see unread badges, without ordinary push alerts.");
    } catch (cause) {
      Alert.alert("Couldn't update notifications", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setWatchBusy(false);
    }
  }

  function toggleSelected(id: string): void {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <SafeScreen edges={["top"]} style={styles.screen} testID="brand-group-thread">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Messages" onPress={() => router.back()} style={styles.iconButton}>
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>{group?.brand_name || "Brand group"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{group ? `${group.member_count} brand teammates · Mingla Support can help here` : "Official Brand group"}</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: watching, busy: watchBusy }}
          accessibilityLabel={watching ? "Turn off ordinary Brand group push notifications" : "Turn on Brand group push notifications"}
          onPress={() => void toggleWatch()}
          style={[styles.watchButton, watching && styles.watchButtonActive]}
        >
          <Text style={[styles.watchText, watching && styles.watchTextActive]}>{watching ? "Watching" : "Watch"}</Text>
        </Pressable>
      </View>

      {canBrand && canSupport ? (
        <View style={styles.actorBar}>
          <Text style={styles.actorLabel}>Replying as</Text>
          <Pressable onPress={() => setActorMode("brand")} style={[styles.actorChoice, actorMode === "brand" && styles.actorChoiceActive]}>
            <Text style={[styles.actorChoiceText, actorMode === "brand" && styles.actorChoiceTextActive]}>Brand team</Text>
          </Pressable>
          <Pressable onPress={() => setActorMode("support")} style={[styles.actorChoice, actorMode === "support" && styles.actorChoiceActive]}>
            <Text style={[styles.actorChoiceText, actorMode === "support" && styles.actorChoiceTextActive]}>Mingla Support</Text>
          </Pressable>
        </View>
      ) : null}

      {notice ? <Pressable onPress={() => setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></Pressable> : null}

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void refresh()} />
        </View>
      ) : (
        <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={styles.empty}><Text style={styles.stateText}>This is the official Brand group. Start the first conversation here.</Text></View>
          ) : messages.map((message) => {
            const mine = message.sender_id === user?.id;
            const selected = selectedIds.includes(message.id);
            const supportIdentity = message.sender_role === "Mingla Support";
            return (
              <View key={message.id} style={[styles.messageWrap, mine ? styles.messageWrapMine : styles.messageWrapOther]}>
                {!mine ? <Text style={styles.sender}>{message.sender_display_name}{supportIdentity ? " · Mingla Support" : ""}</Text> : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, selected && styles.bubbleSelected]}>
                  {message.reply_content ? (
                    <View style={styles.quote}>
                      <Text style={styles.quoteName}>{message.reply_sender_display_name || "Message"}</Text>
                      <Text style={styles.quoteText} numberOfLines={2}>{message.reply_content}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.content}</Text>
                  <Text style={styles.time}>{new Date(message.created_at).toLocaleString()}</Text>
                </View>
                <View style={[styles.actions, mine && styles.actionsMine]}>
                  <Pressable onPress={() => setReplyTo(message)}><Text style={styles.actionText}>Reply</Text></Pressable>
                  <Pressable onPress={() => toggleSelected(message.id)}><Text style={styles.actionText}>{selected ? "Unselect" : "Select"}</Text></Pressable>
                  {canSupport ? <Pressable onPress={() => setSignalSourceId(message.id)}><Text style={styles.actionText}>Create product signal</Text></Pressable> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {replyTo ? (
          <View style={styles.composerContext}>
            <View style={styles.headerCopy}><Text style={styles.contextTitle}>Replying to {replyTo.sender_display_name}</Text><Text style={styles.contextText} numberOfLines={1}>{replyTo.content}</Text></View>
            <Pressable onPress={() => setReplyTo(null)}><Text style={styles.actionText}>Clear</Text></Pressable>
          </View>
        ) : null}
        {selectedMessages.length ? <Text style={styles.selectedNote}>{selectedMessages.length} related message{selectedMessages.length === 1 ? "" : "s"} selected</Text> : null}
        <View style={styles.composerLine}>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder={actorMode === "support" ? "Reply as Mingla Support" : "Message your Brand group"}
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
            multiline
            editable={!sending && !loading && !error}
            accessibilityLabel="Brand group message"
          />
          <Button label="Send" leadingIcon="send" loading={sending} disabled={!composer.trim() || sending} onPress={() => void send()} />
        </View>
      </View>

      <BrandGroupSignalModal
        visible={signalSourceId !== null}
        brandName={group?.brand_name || "Brand group"}
        messages={messages}
        sourceMessageId={signalSourceId}
        relatedMessageIds={selectedIds}
        onClose={() => setSignalSourceId(null)}
        onCreated={() => {
          setNotice("Product signal created privately and linked to this conversation.");
          setSelectedIds([]);
        }}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: canvas.profile },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  subtitle: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  watchButton: { minHeight: 44, minWidth: 66, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: glass.border.profileElevated },
  watchButtonActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.1)" },
  watchText: { color: textTokens.secondary, fontSize: 12, fontWeight: "700" },
  watchTextActive: { color: accent.warm },
  actorBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  actorLabel: { color: textTokens.tertiary, fontSize: 12 },
  actorChoice: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: glass.border.profileElevated },
  actorChoiceActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.1)" },
  actorChoiceText: { color: textTokens.secondary, fontSize: 12 },
  actorChoiceTextActive: { color: accent.warm, fontWeight: "700" },
  notice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: "rgba(235,120,37,0.08)", borderBottomWidth: 1, borderBottomColor: "rgba(235,120,37,0.25)" },
  noticeText: { color: textTokens.secondary, fontSize: 12, textAlign: "center" },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  messages: { flex: 1 },
  messagesContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  empty: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  messageWrap: { maxWidth: "84%", gap: 5 },
  messageWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageWrapOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { color: textTokens.tertiary, fontSize: 11, fontWeight: "700", marginHorizontal: spacing.sm },
  bubble: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1 },
  bubbleMine: { backgroundColor: accent.warm, borderColor: accent.warm },
  bubbleOther: { backgroundColor: glass.tint.profileElevated, borderColor: glass.border.profileElevated },
  bubbleSelected: { borderColor: "#b995ff", borderWidth: 2 },
  quote: { paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: "rgba(255,255,255,0.55)", gap: 2 },
  quoteName: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700" },
  quoteText: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  messageText: { color: textTokens.primary, fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: "#101216" },
  time: { color: textTokens.tertiary, fontSize: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.sm },
  actionsMine: { justifyContent: "flex-end" },
  actionText: { color: accent.warm, fontSize: 12, fontWeight: "700" },
  composer: { borderTopWidth: 1, borderTopColor: glass.border.profileBase, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, backgroundColor: "rgba(12,14,18,0.96)" },
  composerContext: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: glass.tint.profileBase },
  contextTitle: { color: textTokens.primary, fontSize: 12, fontWeight: "700" },
  contextText: { color: textTokens.secondary, fontSize: 11 },
  selectedNote: { color: "#b995ff", fontSize: 12, fontWeight: "700" },
  composerLine: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated, color: textTokens.primary },
});
