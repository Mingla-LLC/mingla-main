/**
 * #4114 Wave 6 — one message's photo or video in the host's event chat.
 *
 * Explorer media since #4114 Wave 4 is a private-bucket path: it is signed
 * here (cached per path) before it is shown. A public URL from older messages
 * and host uploads is shown as it is. A view-once photo or video is never
 * shown: the host sees "View once photo" (only the sender may read the file).
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { accent, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import {
  GROUP_CHAT_MEDIA_BUCKET,
  GroupChatSignedUrlCache,
  createGroupChatMediaResolver,
  groupChatMediaKind,
  type GroupChatMediaMessage,
} from "../../utils/groupChatMedia";
import { registerSignOutCleanup } from "../../utils/signOutCleanups";
import { Icon } from "../ui/Icon";

// Lives here (only the event chat panel imports it) so the signing code stays
// out of the shared groupChatService chunk.
const signedUrls = new GroupChatSignedUrlCache(async (path, seconds) => {
  const { data, error } = await supabase.storage.from(GROUP_CHAT_MEDIA_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw error ?? new Error("sign_failed");
  return data.signedUrl;
});
// Signed links belong to the signed-in host: sign-out drops them (Constitution #6).
registerSignOutCleanup(() => signedUrls.clear());
const media = createGroupChatMediaResolver(signedUrls);
const resolveGroupChatMediaUrl = media.resolve;
const peekGroupChatMediaUrl = media.peek;

interface GroupChatMessageMediaProps {
  message: GroupChatMediaMessage & { file_name: string | null };
  mine: boolean;
}

export const GroupChatMessageMedia: React.FC<GroupChatMessageMediaProps> = ({ message, mine }) => {
  const kind = groupChatMediaKind(message);
  const needsUrl = kind === "image" || kind === "video";
  const [url, setUrl] = useState<string | null>(() => (needsUrl ? peekGroupChatMediaUrl(message.file_url) : null));
  const [failed, setFailed] = useState(false);
  // A video that would not open says so inline (no silent failure) and stays tappable.
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    if (!needsUrl) return;
    const cached = peekGroupChatMediaUrl(message.file_url);
    if (cached) {
      setUrl(cached);
      setFailed(false);
      return;
    }
    let active = true;
    setFailed(false);
    resolveGroupChatMediaUrl(message.file_url)
      .then((resolved) => {
        if (!active) return;
        setUrl(resolved);
        setFailed(resolved === null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.warn("[GroupChatMessageMedia] could not get a link for chat media", error);
        setUrl(null);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [message.file_url, needsUrl]);

  if (kind === "none") return null;

  if (kind === "view_once_photo" || kind === "view_once_video") {
    const label = kind === "view_once_video" ? "View once video" : "View once photo";
    return (
      <View style={styles.notice} accessibilityRole="text" accessibilityLabel={label} testID="group-chat-view-once">
        <Icon name="eye" size={14} color={mine ? textTokens.inverse : textTokens.secondary} />
        <Text style={[styles.noticeText, mine && styles.noticeTextMine]}>{label}</Text>
      </View>
    );
  }

  if (failed) {
    const label = kind === "video" ? "Video unavailable" : "Photo unavailable";
    return (
      <View style={styles.notice} accessibilityRole="text" accessibilityLabel={label}>
        <Text style={[styles.noticeText, mine && styles.noticeTextMine]}>{label}</Text>
      </View>
    );
  }

  if (!url) {
    return (
      <View style={styles.placeholder} accessibilityRole="progressbar" accessibilityLabel="Loading attachment">
        <ActivityIndicator color={accent.warm} />
      </View>
    );
  }

  if (kind === "video") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={message.file_name ? `Play video ${message.file_name}` : "Play video"}
        accessibilityHint={openFailed ? "The video did not open. Tap to try again." : undefined}
        onPress={() => {
          setOpenFailed(false);
          // A fresh link (the cached one is re-signed shortly before it expires).
          resolveGroupChatMediaUrl(message.file_url)
            .then((fresh) => Linking.openURL(fresh ?? url))
            .catch((error: unknown) => {
              console.warn("[GroupChatMessageMedia] could not open the video", error);
              setOpenFailed(true);
            });
        }}
        style={styles.notice}
        testID="group-chat-video"
      >
        <Icon name="play" size={14} color={mine ? textTokens.inverse : textTokens.primary} />
        <Text style={[styles.noticeText, mine && styles.noticeTextMine]}>
          {openFailed ? "Couldn't open the video. Tap to try again." : "Video"}
        </Text>
      </Pressable>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={styles.image}
      resizeMode="cover"
      accessibilityLabel={message.file_name ?? "Attached image"}
    />
  );
};

const styles = StyleSheet.create({
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  placeholder: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  noticeText: {
    fontSize: 14,
    fontStyle: "italic",
    color: textTokens.secondary,
  },
  noticeTextMine: {
    color: textTokens.inverse,
  },
});
