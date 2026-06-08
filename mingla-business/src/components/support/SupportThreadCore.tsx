/**
 * SupportThreadCore — META-ORCH-1104 Phase 1 (business requester).
 *
 * The shared, platform-agnostic support chat thread. Reuses the existing
 * conversation-id-driven chat substrate UNCHANGED — `listMessages` +
 * `postPlannerMessage` from `groupChatService`, and the web-safe
 * `conversation:{id}` realtime channel (pure Supabase JS SDK — works identically
 * on native + web, SPEC §2.10). The ONLY native-only primitive — the keyboard
 * wrapper — is injected via the `KeyboardWrap` prop so THIS file never imports
 * `react-native-keyboard-controller` (I-1104-NO-KBC-ON-WEB).
 *
 *   - SupportThread.native.tsx → passes the keyboard-controller wrapper.
 *   - SupportThread.tsx (web)  → passes a Fragment passthrough (browser handles
 *                                the soft keyboard; no library needed).
 *
 * Per SPEC §5.1 + §2.10 quarantine option (b).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import {
  getOwnSupportTicket,
  type SupportTicket,
} from "../../services/supportService";
import {
  listMessages,
  postPlannerMessage,
  type EventGroupMessage,
} from "../../services/groupChatService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { ScrollView } from "../../wrappers/SmartScrollView";

/**
 * Platform-injected keyboard wrapper. On native this is the
 * react-native-keyboard-controller KeyboardAvoidingView; on web it is a
 * passthrough Fragment. Typed minimally so neither platform leaks the native
 * module type into the shared core.
 */
export interface KeyboardWrapProps {
  children: React.ReactNode;
}
export type KeyboardWrapComponent = React.ComponentType<KeyboardWrapProps>;

interface SupportThreadCoreProps {
  ticketId: string;
  KeyboardWrap: KeyboardWrapComponent;
}

export const SupportThreadCore: React.FC<SupportThreadCoreProps> = ({
  ticketId,
  KeyboardWrap,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<EventGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const row = await getOwnSupportTicket(ticketId);
      if (row === null) {
        // RLS-hidden / not-found — surface a not-found state, never a crash
        // (SPEC T-1.7 adversarial: a deep-link to a foreign ticket).
        setTicket(null);
        setMessages([]);
        setError(null);
        return;
      }
      setTicket(row);
      const result = await listMessages(row.conversation_id);
      if (result.error !== null) throw new Error(result.error);
      setMessages(result.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this chat.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime — pure JS SDK channel (web-safe, SPEC §2.10). Re-list on any
  // message change in this ticket's conversation.
  const conversationId = ticket?.conversation_id ?? null;
  useEffect(() => {
    if (conversationId === null) return;
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refresh]);

  const sortedMessages = useMemo(
    () =>
      messages
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages],
  );

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/account/support" as never);
  }, [router]);

  const handleSend = useCallback(async (): Promise<void> => {
    const content = composer.trim();
    if (content.length === 0 || conversationId === null) return;
    setSending(true);
    try {
      const result = await postPlannerMessage(conversationId, content, null);
      if (result.error !== null) throw new Error(result.error);
      setComposer("");
      await refresh();
    } catch (err) {
      // Native shows retry; the message is NOT silently dropped (SPEC T-1.2).
      Alert.alert(
        "Message not sent",
        err instanceof Error ? err.message : "Tap Send to try again.",
      );
    } finally {
      setSending(false);
    }
  }, [composer, conversationId, refresh]);

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to support"
          onPress={handleBack}
          style={styles.iconButton}
        >
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {ticket?.subject ?? "Support"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Mingla support · we reply here
          </Text>
        </View>
        <View style={styles.iconButton} />
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={accent.warm} />
        </View>
      ) : error !== null ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Button label="Retry" onPress={() => void refresh()} variant="secondary" />
        </View>
      ) : ticket === null ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>
            We couldn&apos;t find this support chat. It may have been closed or
            belongs to another account.
          </Text>
          <Button
            label="Back to support"
            onPress={handleBack}
            variant="secondary"
          />
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {sortedMessages.length === 0 ? (
              <View style={styles.threadEmpty}>
                <Text style={styles.threadEmptyText}>
                  You&apos;re connected. Send a message and our team will reply
                  here — you don&apos;t have to wait around.
                </Text>
              </View>
            ) : (
              sortedMessages.map((message) => {
                const mine = message.sender_id === currentUserId;
                const hasContent = message.content.length > 0;
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageRow,
                      mine ? styles.messageRowMine : styles.messageRowOther,
                    ]}
                  >
                    {hasContent ? (
                      <Text
                        style={[
                          styles.messageText,
                          mine && styles.messageTextMine,
                        ]}
                      >
                        {message.content}
                      </Text>
                    ) : null}
                    <Text style={styles.messageMeta}>
                      {new Date(message.created_at).toLocaleString()}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          <KeyboardWrap>
            <View
              style={[
                styles.composer,
                { paddingBottom: Math.max(insets.bottom, 0) + spacing.lg },
              ]}
            >
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder="Write a message"
                placeholderTextColor={textTokens.tertiary}
                style={styles.input}
                multiline
                editable={!sending}
                accessibilityLabel="Message"
              />
              <Button
                label="Send"
                leadingIcon="send"
                onPress={handleSend}
                loading={sending}
                disabled={composer.trim().length === 0 || sending}
              />
            </View>
          </KeyboardWrap>
        </>
      )}
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
    overflow: "hidden",
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
  stateText: {
    color: textTokens.primary,
    textAlign: "center",
    lineHeight: 20,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  threadEmpty: {
    padding: spacing.lg,
  },
  threadEmptyText: {
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
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
  messageText: {
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: textTokens.inverse,
  },
  messageMeta: {
    marginTop: spacing.sm,
    fontSize: 10,
    color: textTokens.tertiary,
  },
  composer: {
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
    overflow: "hidden",
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
});

export default SupportThreadCore;
