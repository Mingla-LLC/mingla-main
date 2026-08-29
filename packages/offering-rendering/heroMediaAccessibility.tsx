// @ts-expect-error shared package React resolves through each app workspace.
import React from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text } from "react-native";

import type { EventCoverMediaType } from "./types";

const MAX_DESCRIPTION_CODE_POINTS = 300;

export const normalizeHeroMediaText = (
  value: unknown,
  maximumCodePoints: number = MAX_DESCRIPTION_CODE_POINTS,
): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return null;
  return Array.from(normalized).slice(0, maximumCodePoints).join("");
};

export interface HeroMediaAccessibleLabelInput {
  subject: string | null | undefined;
  mediaType: EventCoverMediaType | null | undefined;
  position: number;
  total: number;
  description?: string | null;
}

export const buildHeroMediaAccessibleLabel = ({
  subject,
  mediaType,
  position,
  total,
  description,
}: HeroMediaAccessibleLabelInput): string | null => {
  const normalizedSubject = normalizeHeroMediaText(subject);
  if (normalizedSubject === null || total < 1 || position < 1 || position > total) {
    return null;
  }
  const kind = mediaType === "video" ? "Video cover" : "Photo";
  const base = `${kind} ${position} of ${total} for ${normalizedSubject}`;
  const normalizedDescription = normalizeHeroMediaText(description);
  return normalizedDescription === null ? base : `${base}: ${normalizedDescription}`;
};

const useHeroMediaChangeAnnouncement = (
  activeIndex: number,
  accessibleLabel: string | null,
): string => {
  const previousIndexRef = React.useRef(activeIndex);
  const [webMessage, setWebMessage] = React.useState("");

  React.useEffect(() => {
    const previousIndex = previousIndexRef.current;
    previousIndexRef.current = activeIndex;
    if (previousIndex === activeIndex || accessibleLabel === null) return;
    const message = `Now showing ${accessibleLabel}`;
    if (Platform.OS === "web") {
      setWebMessage(message);
      return;
    }
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }, [accessibleLabel, activeIndex]);

  return webMessage;
};

export interface HeroMediaChangeAnnouncerProps {
  activeIndex: number;
  accessibleLabel: string | null;
  testID?: string;
}

export const HeroMediaChangeAnnouncer = (
  props: HeroMediaChangeAnnouncerProps,
) => {
  const { activeIndex, accessibleLabel, testID } = props;
  const message = useHeroMediaChangeAnnouncement(activeIndex, accessibleLabel);
  if (Platform.OS !== "web") return null;
  return (
    <Text
      aria-live="polite"
      aria-atomic={true}
      style={styles.visuallyHidden}
      testID={testID}
    >
      {message}
    </Text>
  );
};

const styles = StyleSheet.create({
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
