/**
 * Issue #4114 Wave 2a — the one avatar for the Chats screen.
 *
 * Replaces the copy-pasted initials avatars in ChatListItem,
 * PendingSessionInviteRow and the old archived block. Shape says who it is:
 * a circle for a person, two stacked circles for a group, a rounded square for
 * an event or trip cover. The orange deck badge means "collaborating".
 */
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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
  /** "circle" person, "group" stacked circles, "square" event/trip cover. */
  shape: "circle" | "group" | "square";
  /** Fallback initials source when there is no image (group/event name). */
  label: string;
  coverUrl?: string | null;
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
  const [failed, setFailed] = useState(false);
  const radius = size / 2;
  const circle = { width: size, height: size, borderRadius: radius };
  const ringStyle = ring ? styles.ring : null;
  if (person?.avatarUrl && !failed) {
    return (
      <Image
        source={{ uri: person.avatarUrl }}
        style={[circle, styles.image, ringStyle]}
        onError={() => setFailed(true)}
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
  coverUrl,
  deckBadge = false,
  size = CHAT_AVATAR_SIZE,
}: ChatAvatarProps): React.ReactElement {
  const [coverFailed, setCoverFailed] = useState(false);
  const box = { width: size, height: size };

  let body: React.ReactElement;
  if (shape === "square") {
    const squareRadius = Math.round(size * 0.29);
    body = coverUrl && !coverFailed ? (
      <Image
        source={{ uri: coverUrl }}
        style={[box, styles.image, { borderRadius: squareRadius }]}
        resizeMode="cover"
        onError={() => setCoverFailed(true)}
      />
    ) : (
      <View style={[box, styles.fallback, { borderRadius: squareRadius }]}>
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.29) }]} allowFontScaling={false}>
          {getInitials(label)}
        </Text>
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
