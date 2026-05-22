import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from "expo-image-picker";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { useEventGroupChat } from "../../hooks/useEventGroupChat";
import { useEventGroupChatModeration } from "../../hooks/useEventGroupChatModeration";
import type { PlannerImageAttachment } from "../../services/groupChatService";
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
  const [attachment, setAttachment] = useState<PlannerImageAttachment | null>(null);
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
    if (content.length === 0 && attachment === null) return;
    setSending(true);
    try {
      const result = await chat.postMessage(content, attachment);
      if (result.error) throw new Error(result.error);
      setComposer("");
      setAttachment(null);
    } catch (err) {
      Alert.alert("Message failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Photo access needed",
        "Grant Mingla access to your photos in iOS Settings to attach an image.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const ext = asset.uri.split(".").pop()?.toLowerCase() || "jpg";
    setAttachment({
      uri: asset.uri,
      name: asset.fileName ?? `image_${Date.now()}.${ext}`,
      type: asset.mimeType ?? `image/${ext === "jpg" ? "jpeg" : ext}`,
      size: asset.fileSize ?? 0,
    });
  };

  const handleClearAttachment = () => {
    setAttachment(null);
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
              const hasImage = message.message_type === "image" && message.file_url !== null;
              const hasCaption = message.content.length > 0;
              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageRow,
                    mine ? styles.messageRowMine : styles.messageRowOther,
                    blast && styles.messageRowBlast,
                  ]}
                >
                  {hasImage ? (
                    <Image
                      source={{ uri: message.file_url ?? undefined }}
                      style={styles.messageImage}
                      resizeMode="cover"
                      accessibilityLabel={message.file_name ?? "Attached image"}
                    />
                  ) : null}
                  {hasCaption ? (
                    <Text
                      style={[
                        styles.messageText,
                        mine && styles.messageTextMine,
                        hasImage && styles.messageTextWithImage,
                      ]}
                    >
                      {message.content}
                    </Text>
                  ) : null}
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
            {attachment ? (
              <View style={styles.attachmentPreview}>
                <Image
                  source={{ uri: attachment.uri }}
                  style={styles.attachmentPreviewImage}
                  resizeMode="cover"
                  accessibilityLabel="Selected image preview"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove attachment"
                  onPress={handleClearAttachment}
                  style={styles.attachmentRemove}
                >
                  <Icon name="close" size={14} color={textTokens.primary} />
                </Pressable>
              </View>
            ) : null}
            <View
              style={[
                styles.composer,
                { paddingBottom: Math.max(insets.bottom, 0) + spacing.lg },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach image"
                onPress={handlePickImage}
                style={styles.attachButton}
                disabled={sending}
              >
                <Icon name="plus" size={20} color={textTokens.primary} />
              </Pressable>
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder={attachment ? "Add a caption (optional)" : "Write a reply"}
                placeholderTextColor={textTokens.tertiary}
                style={styles.input}
                multiline
              />
              <Button
                label="Send"
                leadingIcon="send"
                onPress={handleSend}
                loading={sending}
                disabled={(composer.trim().length === 0 && attachment === null) || sending}
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
  messageTextWithImage: {
    marginTop: spacing.sm,
  },
  messageImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    backgroundColor: "rgba(0,0,0,0.2)",
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
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  attachmentPreview: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    width: 120,
    height: 120,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  attachmentPreviewImage: {
    width: "100%",
    height: "100%",
  },
  attachmentRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
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
