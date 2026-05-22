import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// Library-recommended primitive for sticky-composer-above-keyboard pattern.
// react-native-keyboard-controller is the canonical Mingla keyboard library
// per I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ORCH-0892-C) — already a project dep.
// orch-strict-grep-allow orch-0892 — chat composer needs sticky-above-keyboard lift
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { useEventGroupChat } from "../../hooks/useEventGroupChat";
import { useEventGroupChatModeration } from "../../hooks/useEventGroupChatModeration";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { GroupChatModerationSheet } from "./GroupChatModerationSheet";

interface GroupChatPanelProps {
  eventId: string;
}

export const GroupChatPanel: React.FC<GroupChatPanelProps> = ({ eventId }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const chat = useEventGroupChat(eventId);
  const moderation = useEventGroupChatModeration(chat.conversation?.id ?? null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const sortedMessages = useMemo(
    () => chat.messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [chat.messages],
  );

  const handleSend = async () => {
    const content = composer.trim();
    if (content.length === 0) return;
    setSending(true);
    try {
      const result = await chat.postMessage(content);
      if (result.error) throw new Error(result.error);
      setComposer("");
    } catch (err) {
      Alert.alert("Message failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const handleToggleBroadcast = async (value: boolean) => {
    const result = await moderation.setBroadcastOnly(value);
    if (result.error) {
      Alert.alert("Could not update chat", result.error);
      return;
    }
    await chat.refresh();
  };

  const handleRemoveParticipant = async (userId: string) => {
    const result = await moderation.removeParticipant(userId);
    if (result.error) Alert.alert("Could not remove member", result.error);
  };

  const handleDeleteMessage = async (messageId: string) => {
    const result = await moderation.deleteMessage(messageId);
    if (result.error) {
      Alert.alert("Could not delete message", result.error);
      return;
    }
    await chat.refresh();
  };

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {chat.conversation?.event_name ?? "Group chat"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Read, reply, and moderate buyer chat
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open moderation"
          onPress={() => setModerationOpen(true)}
          style={styles.iconButton}
        >
          <Icon name="moreH" size={18} color={textTokens.primary} />
        </Pressable>
      </View>

      {chat.loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={accent.warm} />
        </View>
      ) : chat.error ? (
        <View style={styles.state}>
          <Text style={styles.errorText}>{chat.error}</Text>
          <Button label="Retry" onPress={() => void chat.refresh()} variant="secondary" />
        </View>
      ) : chat.conversation === null ? (
        <View style={styles.state}>
          <Text style={styles.errorText}>No group chat exists for this event yet.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {sortedMessages.map((message) => {
              const mine = message.sender_id === currentUserId;
              const blast = message.marketing_campaign_id !== null;
              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageRow,
                    mine ? styles.messageRowMine : styles.messageRowOther,
                    blast && styles.messageRowBlast,
                  ]}
                >
                  <Text style={[styles.messageText, mine && styles.messageTextMine]}>
                    {message.content}
                  </Text>
                  <View style={styles.messageMetaRow}>
                    <Text style={styles.messageMeta}>
                      {new Date(message.created_at).toLocaleString()}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Delete message"
                      onPress={() => void handleDeleteMessage(message.id)}
                    >
                      <Icon name="trash" size={13} color={mine ? textTokens.inverse : textTokens.tertiary} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
            <View
              style={[
                styles.composer,
                { paddingBottom: Math.max(insets.bottom, 0) + spacing.lg },
              ]}
            >
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder="Write a reply"
                placeholderTextColor={textTokens.tertiary}
                style={styles.input}
                multiline
              />
              <Button
                label="Send"
                leadingIcon="send"
                onPress={handleSend}
                loading={sending}
                disabled={composer.trim().length === 0 || sending}
              />
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      <GroupChatModerationSheet
        visible={moderationOpen}
        onClose={() => setModerationOpen(false)}
        broadcastOnly={chat.conversation?.is_broadcast_only ?? false}
        participants={moderation.participants}
        loading={moderation.loading}
        onToggleBroadcastOnly={handleToggleBroadcast}
        onRemoveParticipant={handleRemoveParticipant}
      />
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#111318",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  errorText: {
    color: textTokens.primary,
    textAlign: "center",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  messageRow: {
    maxWidth: "84%",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  messageRowOther: {
    alignSelf: "flex-start",
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  messageRowBlast: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  messageText: {
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: textTokens.inverse,
  },
  messageMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  messageMeta: {
    fontSize: 10,
    color: textTokens.tertiary,
  },
  composer: {
    // Floats over the chat list (no top border / backdrop) — bottom inset + extra
    // breathing room is applied inline via insets in the JSX above.
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
});

export default GroupChatPanel;
