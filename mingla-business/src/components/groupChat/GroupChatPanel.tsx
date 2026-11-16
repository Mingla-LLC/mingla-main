import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { showAlert } from "../ui/showAlert";
// Library-recommended primitive for sticky-composer-above-keyboard pattern.
// react-native-keyboard-controller is the canonical Mingla keyboard library
// per I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ORCH-0892-C) — already a project dep.
// orch-strict-grep-allow orch-0892 — chat composer needs sticky-above-keyboard lift
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// #1850 — the composer's lift is budgeted against the DERIVED Done-bar cost, not
// a hand-typed number. See the comment at the KeyboardAvoidingView below.
//
// #2649 — the `ScrollView` this used to also import is GONE, and its removal is
// the point rather than tidying. That specifier resolves to the wrapper's
// re-export of KeyboardAwareScrollView, which appended a `keyboardHeight + 1`
// spacer to this thread's content whenever the keyboard opened — measured at
// 335pt on iOS and 302.9dp on Android, buying nothing, because this screen's
// composer is a SIBLING of the thread, not a child, so there is no focused
// input inside it for the library to keep clear. Worse, that phantom content
// made `scrollToEnd` land ~351pt past the last message in blank space. The
// thread is now an inverted FlatList and needs neither.
import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";
// #1890 C-5 REWORK — the composer's bottom spacer comes from the shared
// occluder budget, which is where the rule "a lifted surface does not also
// budget for the screen edge it is no longer touching" is written down. Both
// platform variants export it, so this never reads `undefined`.
import { liftedBottomSpacer } from "../../wrappers/keyboardClearance";
// #1890 C-5 REWORK — the composer needs to know whether it is LIFTED, and the
// library-backed wrapper is the sanctioned source (orch-0892 forbids a bespoke
// Keyboard.addListener pair). Same hook AriChatScreen uses, and for the same
// reason: `onStart` carries the target height as the keyboard BEGINS moving, so
// the spacer swaps in the same frame the KeyboardAvoidingView starts lifting
// rather than an animation late.
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
import { useRouter } from "expo-router";

import { color, materials, radius, scrim, size, space } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { useEventGroupChat } from "../../hooks/useEventGroupChat";
import { useEventGroupChatModeration } from "../../hooks/useEventGroupChatModeration";
import type { PlannerImageAttachment } from "../../services/groupChatService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { GroupChatModerationSheet } from "./GroupChatModerationSheet";
import { GroupChatMessageMedia } from "./GroupChatMessageMedia";
import { groupChatMediaKind } from "../../utils/groupChatMedia";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../utils/platformImagePicker";

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

  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const sortedMessages = useMemo(
    () => chat.messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [chat.messages],
  );

  // #2649 — the thread is an `inverted` FlatList, which paints data[0] at the
  // frame's bottom edge. Feeding it newest-first is what makes the thread open
  // on the NEWEST message and stay pinned there when the composer grows. Before
  // this, the panel had no scroll of any kind and opened on the OLDEST message
  // in every keyboard state — 692pt from the newest on iPhone 16.
  //
  // Deliberately NOT paired with a scrollToEnd: bottom-anchoring comes from
  // `inverted` alone. See the SmartScrollView import note for the trap that
  // rule exists to avoid.
  const invertedMessages = useMemo(() => sortedMessages.slice().reverse(), [sortedMessages]);

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
      showAlert("Message failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    const { status, granted } = await requestMediaLibraryPermissionsAsync();
    if (status !== "granted" && !granted) {
      showAlert(
        "Photo access needed",
        "Grant Mingla access to your photos in iOS Settings to attach an image.",
        undefined,
        { kind: "warn" },
      );
      return;
    }
    const result = await launchImageLibraryAsync({
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
      showAlert("Could not update chat", result.error);
      return;
    }
    await chat.refresh();
  };

  const handleRemoveParticipant = async (userId: string) => {
    const result = await moderation.removeParticipant(userId);
    if (result.error) showAlert("Could not remove member", result.error);
  };

  const handleDeleteMessage = async (messageId: string) => {
    const result = await moderation.deleteMessage(messageId);
    if (result.error) {
      showAlert("Could not delete message", result.error);
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
          <Icon name="arrowL" size={18} color={color.text1} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {chat.conversation?.event_name ?? "Group chat"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open moderation"
          onPress={() => setModerationOpen(true)}
          style={styles.iconButton}
        >
          <Icon name="moreH" size={18} color={color.text1} />
        </Pressable>
      </View>

      {chat.loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={color.text2} />
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
          {/* #2649 — virtualised and bottom-anchored. The `inverted` prop is the
              whole fix: the newest message is pinned to the frame's bottom edge
              by construction, so the composer can grow as much as the keyboard
              needs and the thread rides up with it. No keyboard height is read
              here, no listener is registered, and no scroll call holds it in
              place — which is why it also survives #1894. */}
          <FlatList
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            inverted
            data={invertedMessages}
            keyExtractor={(message) => message.id}
            renderItem={({ item: message }) => {
              const mine = message.sender_id === currentUserId;
              const blast = message.marketing_campaign_id !== null;
              // #4114 Wave 6: Explorer photos and videos are private-bucket
              // paths (signed in GroupChatMessageMedia); view once is never shown.
              const hasImage = groupChatMediaKind(message) !== "none";
              const hasCaption = message.content.length > 0;
              return (
                <View
                  style={[
                    styles.messageRow,
                    mine ? styles.messageRowMine : styles.messageRowOther,
                    blast && styles.messageRowBlast,
                  ]}
                >
                  {hasImage ? <GroupChatMessageMedia message={message} mine={mine} /> : null}
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
                      <Icon name="trash" size={13} color={mine ? color.textStrong : color.text3} />
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />

          {/* ORCH-1165: lift the composer so the Done bar sits above it.
              #1850 — the literal 42 that used to sit here was KEYBOARD_TOOLBAR_HEIGHT,
              which is the bar's own height, NOT what it occupies above the keyboard.
              #1834 measured the difference on glass: on iOS 26+ the library floats
              the bar 11pt clear of the keyboard's rounded corners, so it occupies 53
              and a 42pt lift left this composer 11pt behind it. DONE_BAR_OCCUPIED is
              derived from the same inputs the library uses, so an OS or library bump
              moves it without anyone editing this line.

              #1890 F-8 read this offset ALONE and called the screen a 23pt
              undershoot — "the field sits behind the bar". Measured on the
              physical Samsung it was a 59.47dp OVERSHOOT, and C-5's first
              attempt (adding MIN_VISIBLE_CLEARANCE here) pushed it 12.09dp
              further away, to 83.56dp against a 12dp contract. The premise was
              inverted because the reply field does NOT sit on this container's
              bottom edge: the composer's own bottom spacer stands between them,
              and THAT is where the overshoot lived. See the composer's
              paddingBottom below.
              So this offset budgets exactly ONE thing — the occluder. The
              promised visible gap is the composer's own bottom spacer while it
              is lifted, so the two terms are added once, in different places,
              instead of one of them twice. */}
          <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED}>
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
                  <Icon name="close" size={14} color={color.text1} />
                </Pressable>
              </View>
            ) : null}
            <View
              style={[
                styles.composer,
                {
                  // #1890 C-5 REWORK — this is the composer's ONE bottom spacer,
                  // and it must stay the only one: `styles.composer` carries
                  // paddingHorizontal/paddingTop only, so this value alone stands
                  // between the controls' bottom edge and the container's.
                  //
                  // At rest it clears the navigation bar / home indicator
                  // (measured 48 + 24 = 72dp on R58R54YV7JT). While the keyboard
                  // is up the KeyboardAvoidingView above has already put that
                  // container edge on the Done bar, so the resting value would be
                  // 72dp of dead space — which is exactly the overshoot #1890
                  // TEST measured. Lifted, the composer owes the promised visible
                  // gap and nothing else.
                  paddingBottom: liftedBottomSpacer(
                    keyboardHeight > 0,
                    Math.max(insets.bottom, 0) + space[6],
                  ),
                },
              ]}
            >
              {/* #4420 round 3 (6, 24): floating composer. Attach sits inside
                  the field; send is an icon-only Paper circle, dimmed until
                  there is a message or a photo to send. */}
              <View style={styles.field}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach image"
                onPress={handlePickImage}
                style={styles.attachButton}
                disabled={sending}
              >
                <Icon name="plus" size={20} color={color.text1} />
              </Pressable>
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder={attachment ? "Add a caption (optional)" : "Write a reply"}
                placeholderTextColor={color.text3}
                style={styles.input}
                multiline
              />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: (composer.trim().length === 0 && attachment === null) || sending, busy: sending }}
                onPress={handleSend}
                disabled={(composer.trim().length === 0 && attachment === null) || sending}
                style={[
                  styles.send,
                  ((composer.trim().length === 0 && attachment === null) || sending) && styles.sendIdle,
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={color.ink} />
                ) : (
                  <Icon
                    name="send"
                    size={20}
                    color={composer.trim().length === 0 && attachment === null ? color.text4 : color.ink}
                  />
                )}
              </Pressable>
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
    backgroundColor: color.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: color.text1,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[6],
  },
  errorText: {
    color: color.text1,
    textAlign: "center",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: space[4],
    gap: space[2],
  },
  messageRow: {
    maxWidth: "84%",
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    backgroundColor: color.card3,
    borderColor: color.lineStrong,
  },
  messageRowOther: {
    alignSelf: "flex-start",
    backgroundColor: color.fill.inset,
    borderColor: color.line,
  },
  messageRowBlast: {
    alignSelf: "center",
    backgroundColor: color.fill.pressed,
  },
  messageText: {
    color: color.text1,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: color.textStrong,
  },
  messageTextWithImage: {
    marginTop: space[2],
  },
  messageMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[2],
    marginTop: space[2],
  },
  messageMeta: {
    fontSize: 10,
    color: color.text3,
  },
  composer: {
    // Floats over the chat list (no top border / backdrop) — bottom inset + extra
    // breathing room is applied inline via insets in the JSX above.
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: size.btn.phone,
    paddingLeft: space[1],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: materials.sheet.solidFill,
  },
  attachButton: {
    width: 40,
    height: size.btn.phone,
    alignItems: "center",
    justifyContent: "center",
  },
  send: {
    width: size.btn.phone,
    height: size.btn.phone,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
  },
  sendIdle: {
    backgroundColor: color.card2,
  },
  attachmentPreview: {
    marginHorizontal: space[4],
    marginTop: space[2],
    width: 120,
    height: 120,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
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
    backgroundColor: scrim.modal,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: size.btn.phone,
    maxHeight: 120,
    paddingHorizontal: space[2],
    paddingTop: 14,
    paddingBottom: 14,
    color: color.text1,
  },
});

export default GroupChatPanel;
