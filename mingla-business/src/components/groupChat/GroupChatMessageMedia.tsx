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
import { peekGroupChatMediaUrl, resolveGroupChatMediaUrl } from "../../services/groupChatService";
import { groupChatMediaKind, type GroupChatMediaMessage } from "../../utils/groupChatMedia";
import { Icon } from "../ui/Icon";

interface GroupChatMessageMediaProps {
  message: GroupChatMediaMessage & { file_name: string | null };
  mine: boolean;
}

export const GroupChatMessageMedia: React.FC<GroupChatMessageMediaProps> = ({ message, mine }) => {
  const kind = groupChatMediaKind(message);
  const needsUrl = kind === "image" || kind === "video";
  const [url, setUrl] = useState<string | null>(() => (needsUrl ? peekGroupChatMediaUrl(message.file_url) : null));
  const [failed, setFailed] = useState(false);

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
        onPress={() => {
          Linking.openURL(url).catch((error: unknown) => {
            console.warn("[GroupChatMessageMedia] could not open the video", error);
          });
        }}
        style={styles.notice}
      >
        <Icon name="play" size={14} color={mine ? textTokens.inverse : textTokens.primary} />
        <Text style={[styles.noticeText, mine && styles.noticeTextMine]}>Video</Text>
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
