/**
 * Issue #4114 Wave 2a — the one avatar for the Chats screen.
 *
 * Replaces the copy-pasted initials avatars in ChatListItem,
 * PendingSessionInviteRow and the old archived block. Shape says who it is:
 * a circle for a person, a cluster of the other members' photos for a group
 * (two overlapping, a triangle of three, or two plus "+N"), a rounded square
 * for an event cover or brand logo. The orange deck badge means "collaborating".
 *
 * Issue #4114: photos load through expo-image (memory + disk cache, as the
 * deck does); a broken URL falls back to the next image, then to initials.
 * What each chat kind shows is decided by `chatAvatarSpec` (chatListModel).
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { CHAT_AVATAR_SIZE, getInitials } from "./chatListModel";

const t = glass.discover.chatList;

export interface ChatAvatarPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface ChatAvatarProps {
  /** Who the avatar shows. One person for a circle, two for the stacked group. */
  people: ChatAvatarPerson[];
  /** "circle" person, "group" photo cluster, "square" event cover / brand logo. */
  shape: "circle" | "group" | "square";
  /** Fallback initials source when there is no image (group/event name). */
  label: string;
  /** Square only: images tried in order (cover, then logo) before the initials. */
  coverUrls?: readonly string[];
  /** Group only: members beyond those shown, as a "+N" bubble. */
  extraCount?: number;
  deckBadge?: boolean;
  size?: number;
}

function PersonCircle({
  person,
  size,
  ring,
}: {
  person: ChatAvatarPerson | null;
  size: number;
  ring: boolean;
}): React.ReactElement {
  // Keyed by URL so a recycled row with a new photo tries it again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const radius = size / 2;
  const circle = { width: size, height: size, borderRadius: radius };
  const ringStyle = ring ? styles.ring : null;
  const avatarUrl = person?.avatarUrl ?? null;
  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[circle, styles.image, ringStyle]}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={avatarUrl}
        onError={() => setFailedUrl(avatarUrl)}
      />
    );
  }
  return (
    <View style={[circle, styles.fallback, ringStyle]}>
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.35) }]} allowFontScaling={false}>
        {getInitials(person?.name)}
      </Text>
    </View>
  );
}

export function ChatAvatar({
  people,
  shape,
  label,
  coverUrls,
  extraCount = 0,
  deckBadge = false,
  size = CHAT_AVATAR_SIZE,
}: ChatAvatarProps): React.ReactElement {
  // Covers that failed to load; the first one left is shown, none left means initials.
  const [failedCovers, setFailedCovers] = useState<readonly string[]>([]);
  const box = { width: size, height: size };

  let body: React.ReactElement;
  if (shape === "square") {
    const squareRadius = Math.round(size * 0.29);
    const coverUrl = (coverUrls ?? []).find((url) => !failedCovers.includes(url)) ?? null;
    body = coverUrl ? (
      <Image
        key={coverUrl}
        source={{ uri: coverUrl }}
        style={[box, styles.image, { borderRadius: squareRadius }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={coverUrl}
        onError={() => setFailedCovers((failed) => [...failed, coverUrl])}
      />
    ) : (
      <View style={[box, styles.fallback, { borderRadius: squareRadius }]}>
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.29) }]} allowFontScaling={false}>
          {getInitials(label)}
        </Text>
      </View>
    );
  } else if (shape === "group" && (people.length >= 3 || (people.length === 2 && extraCount > 0))) {
    // Triangle: one on top, two below; the third corner is "+N" when more.
    const face = Math.round(size * 0.58);
    const topLeft = Math.round((size - face) / 2);
    const lowTop = size - face;
    body = (
      <View style={box}>
        <View style={[styles.slot, { top: 0, left: topLeft }]}>
          <PersonCircle person={people[0] ?? null} size={face} ring />
        </View>
        <View style={[styles.slot, { top: lowTop, left: 0 }]}>
          <PersonCircle person={people[1] ?? null} size={face} ring />
        </View>
        <View style={[styles.slot, { top: lowTop, right: 0 }]}>
          {extraCount > 0 ? (
            <View
              style={[styles.fallback, styles.ring, styles.extra, { width: face, height: face, borderRadius: face / 2 }]}
            >
              <Text style={[styles.initials, { fontSize: Math.round(face * 0.36) }]} allowFontScaling={false}>
                {`+${extraCount > 99 ? 99 : extraCount}`}
              </Text>
            </View>
          ) : (
            <PersonCircle person={people[2] ?? null} size={face} ring />
          )}
        </View>
      </View>
    );
  } else if (shape === "group") {
    const small = Math.round(size * 0.69);
    const first = people[0] ?? { id: "group", name: label };
    const second = people[1] ?? null;
    body = (
      <View style={box}>
        <View style={styles.groupFirst}>
          <PersonCircle person={first} size={small} ring />
        </View>
        {second ? (
          <View style={styles.groupSecond}>
            <PersonCircle person={second} size={small} ring />
          </View>
        ) : null}
      </View>
    );
  } else {
    body = <PersonCircle person={people[0] ?? { id: "person", name: label }} size={size} ring={false} />;
  }

  return (
    <View style={box} accessible={false}>
      {body}
      {deckBadge ? (
        <View style={styles.deckBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name="albums-outline" size={11} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: t.skeletonBlockStrong,
  },
  fallback: {
    backgroundColor: t.avatarFallbackBg,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  ring: {
    borderWidth: 2,
    borderColor: t.avatarRing,
  },
  slot: {
    position: "absolute",
  },
  extra: {
    backgroundColor: t.avatarFallbackBg,
  },
  groupFirst: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  groupSecond: {
    position: "absolute",
    right: 0,
    bottom: 0,
  },
  deckBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: t.accent,
    borderWidth: 2.5,
    borderColor: t.avatarRing,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
});
