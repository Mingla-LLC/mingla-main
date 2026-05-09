import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

import type { EventCoverMediaType } from "../../store/draftEventStore";
import { resolveEventCoverMediaPresentation } from "../../utils/eventCoverMediaRules";
import { EventCover } from "./EventCover";

export interface EventCoverMediaProps {
  hue?: number;
  mediaUrl?: string | null;
  mediaType?: EventCoverMediaType | null;
  radius?: number;
  label?: string;
  height?: DimensionValue;
  width?: DimensionValue;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const EventCoverVideo: React.FC<{
  uri: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  onError: () => void;
}> = ({ uri, autoplay, muted, loop, onError }) => {
  const player = useVideoPlayer(uri, (nextPlayer) => {
    nextPlayer.loop = loop;
    nextPlayer.muted = muted;
    nextPlayer.staysActiveInBackground = false;
    nextPlayer.showNowPlayingNotification = false;
    if (autoplay) nextPlayer.play();
  });

  useEffect(() => {
    const sub = player.addListener("statusChange", (payload) => {
      if (payload.status === "error") onError();
    });
    return () => sub.remove();
  }, [onError, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
};

export const EventCoverMedia: React.FC<EventCoverMediaProps> = ({
  hue = 25,
  mediaUrl = null,
  mediaType = null,
  radius = 16,
  label = "Cover",
  height = "100%",
  width = "100%",
  autoplay = true,
  muted = true,
  loop = true,
  children,
  testID,
  style,
}) => {
  const [hasMediaError, setHasMediaError] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    setHasMediaError(false);
  }, [mediaUrl]);

  const presentation = resolveEventCoverMediaPresentation({
    mediaUrl,
    mediaType,
    hasMediaError,
    reduceMotion,
  });

  if (presentation === "fallback" || mediaUrl === null) {
    return (
      <EventCover
        hue={hue}
        radius={radius}
        label={label}
        height={height}
        width={width}
        testID={testID}
        style={style}
      >
        {children}
      </EventCover>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        { height, width, borderRadius: radius },
        style,
      ]}
    >
      {presentation === "video" || presentation === "video_still" ? (
        <EventCoverVideo
          uri={mediaUrl}
          autoplay={presentation === "video" ? autoplay : false}
          muted={muted}
          loop={presentation === "video" ? loop : false}
          onError={() => setHasMediaError(true)}
        />
      ) : (
        <Image
          source={{ uri: mediaUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setHasMediaError(true)}
        />
      )}
      {children !== undefined ? <View style={styles.overlay}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  overlay: {
    flex: 1,
  },
});

export default EventCoverMedia;
