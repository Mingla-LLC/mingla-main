import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type ImageErrorEventData,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import Svg, { Path, Line } from "react-native-svg";

import type { EventCoverMediaType } from "./types";
import { resolveEventCoverMediaPresentation } from "./coverMediaPresentation";
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
  playbackActive?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  loop?: boolean;
  showAudioControl?: boolean;
  audioControlLabel?: string;
  audioControlPosition?: "topLeft" | "topRight" | "bottomRight";
  audioControlTopOffset?: number;
  children?: React.ReactNode;
  onMediaError?: (event: EventCoverMediaErrorEvent) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export interface EventCoverMediaErrorEvent {
  mediaType: EventCoverMediaType | null;
  mediaUrl: string;
  surface: "image" | "video";
  nativeEvent?: unknown;
}

const WEB_VIDEO_STYLE: React.CSSProperties = {
  backgroundColor: "#000000",
  height: "100%",
  inset: 0,
  objectFit: "cover",
  position: "absolute",
  width: "100%",
};

// Inline volume glyphs (replaces the app-level Icon component so this stays
// package-isolated per I-MOR-0827-PACKAGE-ISOLATION).
const VolumeGlyph: React.FC<{ muted: boolean; size?: number }> = ({
  muted,
  size = 16,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M11 5 6 9H2v6h4l5 4V5z"
      fill="#FFFFFF"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinejoin="round"
    />
    {muted ? (
      <>
        <Line x1={16} y1={9} x2={22} y2={15} stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
        <Line x1={22} y1={9} x2={16} y2={15} stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
      </>
    ) : (
      <Path
        d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
    )}
  </Svg>
);

const isDisposedNativeVideoPlayerError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("NativeSharedObjectNotFoundException") ||
    message.includes("Unable to find the native shared object")
  );
};

const callNativeVideoPlayer = (action: () => void): void => {
  try {
    action();
  } catch (error) {
    if (!isDisposedNativeVideoPlayerError(error)) throw error;
  }
};

const EventCoverWebVideo: React.FC<{
  uri: string;
  autoplay: boolean;
  playbackActive: boolean;
  muted: boolean;
  loop: boolean;
  onError: () => void;
}> = ({ uri, autoplay, playbackActive, muted, loop, onError }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlay = autoplay && playbackActive;

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    if (shouldPlay) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
  }, [shouldPlay, uri]);

  return React.createElement("video", {
    ref: videoRef,
    autoPlay: shouldPlay,
    controls: false,
    loop,
    muted,
    onCanPlay: (event: React.SyntheticEvent<HTMLVideoElement>): void => {
      if (!shouldPlay) return;
      void event.currentTarget.play().catch(() => undefined);
    },
    onEnded: (event: React.SyntheticEvent<HTMLVideoElement>): void => {
      if (!loop || !shouldPlay) return;
      event.currentTarget.currentTime = 0;
      void event.currentTarget.play().catch(() => undefined);
    },
    onError,
    playsInline: true,
    preload: "auto",
    src: uri,
    style: WEB_VIDEO_STYLE,
  });
};

const EventCoverNativeVideo: React.FC<{
  uri: string;
  autoplay: boolean;
  playbackActive: boolean;
  muted: boolean;
  loop: boolean;
  onError: () => void;
}> = ({ uri, autoplay, playbackActive, muted, loop, onError }) => {
  const shouldPlay = autoplay && playbackActive;
  const player = useVideoPlayer(uri, (nextPlayer) => {
    nextPlayer.loop = loop;
    nextPlayer.muted = muted;
    nextPlayer.volume = muted ? 0 : 1;
    nextPlayer.staysActiveInBackground = false;
    nextPlayer.showNowPlayingNotification = false;
    if (shouldPlay) callNativeVideoPlayer(() => nextPlayer.play());
  });

  useEffect(() => {
    const sub = player.addListener("statusChange", (payload) => {
      if (payload.status === "error") onError();
      if (payload.status === "readyToPlay" && shouldPlay) {
        callNativeVideoPlayer(() => player.play());
      }
    });
    return () => sub.remove();
  }, [onError, player, shouldPlay]);

  useEffect(() => {
    player.loop = loop;
  }, [loop, player]);

  useEffect(() => {
    player.muted = muted;
    player.volume = muted ? 0 : 1;
  }, [muted, player]);

  useEffect(() => {
    if (shouldPlay) {
      callNativeVideoPlayer(() => player.play());
      return;
    }
    callNativeVideoPlayer(() => player.pause());
  }, [player, shouldPlay]);

  useEffect(() => {
    const playToEndSub = player.addListener("playToEnd", () => {
      if (!loop || !shouldPlay) return;
      callNativeVideoPlayer(() => {
        player.replay();
        player.play();
      });
    });
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active" && shouldPlay) {
        callNativeVideoPlayer(() => player.play());
        return;
      }
      if (state === "inactive" || state === "background") {
        callNativeVideoPlayer(() => player.pause());
      }
    });
    return () => {
      playToEndSub.remove();
      appStateSub.remove();
    };
  }, [loop, player, shouldPlay]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      playsInline
    />
  );
};

const EventCoverVideo: React.FC<{
  uri: string;
  autoplay: boolean;
  playbackActive: boolean;
  muted: boolean;
  loop: boolean;
  onError: () => void;
}> = (props) =>
  Platform.OS === "web" ? (
    <EventCoverWebVideo {...props} />
  ) : (
    <EventCoverNativeVideo {...props} />
  );

export const EventCoverMedia: React.FC<EventCoverMediaProps> = ({
  hue = 25,
  mediaUrl = null,
  mediaType = null,
  radius = 16,
  label = "Cover",
  height = "100%",
  width = "100%",
  autoplay = true,
  playbackActive = true,
  muted = true,
  onMutedChange,
  loop = true,
  showAudioControl = false,
  audioControlLabel = "cover video audio",
  audioControlPosition = "bottomRight",
  audioControlTopOffset,
  children,
  onMediaError,
  testID,
  style,
}) => {
  const [hasMediaError, setHasMediaError] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const initialMuted = Platform.OS === "web" && autoplay ? true : muted;
  const [isMuted, setIsMuted] = useState(initialMuted);

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

  useEffect(() => {
    setIsMuted(Platform.OS === "web" && autoplay ? true : muted);
  }, [autoplay, mediaUrl, muted]);

  const presentation = resolveEventCoverMediaPresentation({
    mediaUrl,
    mediaType,
    hasMediaError,
    reduceMotion,
  });

  const handleMediaError = (
    surface: "image" | "video",
    nativeEvent?: unknown,
  ): void => {
    if (mediaUrl !== null) {
      onMediaError?.({
        mediaType,
        mediaUrl,
        nativeEvent,
        surface,
      });
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[EventCoverMedia] media render failed", {
          mediaType,
          mediaUrl,
          nativeEvent,
          surface,
        });
      }
    }
    setHasMediaError(true);
  };

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
      style={[styles.container, { height, width, borderRadius: radius }, style]}
    >
      {presentation === "video" || presentation === "video_still" ? (
        <EventCoverVideo
          uri={mediaUrl}
          autoplay={presentation === "video" ? autoplay : false}
          playbackActive={playbackActive}
          muted={isMuted}
          loop={presentation === "video" ? loop : false}
          onError={() => handleMediaError("video")}
        />
      ) : (
        <Image
          source={{ uri: mediaUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={(event: NativeSyntheticEvent<ImageErrorEventData>) =>
            handleMediaError("image", event.nativeEvent)
          }
        />
      )}
      {showAudioControl &&
      mediaType === "video" &&
      presentation === "video" ? (
        <Pressable
          onPress={() =>
            setIsMuted((prev) => {
              const next = !prev;
              onMutedChange?.(next);
              return next;
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`${isMuted ? "Turn on" : "Mute"} ${audioControlLabel}`}
          style={({ pressed }) => [
            styles.audioControl,
            audioControlPosition === "topLeft" && styles.audioControlTopLeft,
            audioControlPosition === "topRight" && styles.audioControlTopRight,
            audioControlPosition === "bottomRight" &&
              styles.audioControlBottomRight,
            (audioControlPosition === "topLeft" ||
              audioControlPosition === "topRight") &&
              typeof audioControlTopOffset === "number" && {
                top: audioControlTopOffset,
              },
            pressed && styles.audioControlPressed,
          ]}
        >
          <VolumeGlyph muted={isMuted} size={16} />
          <Text style={styles.audioControlText}>
            {isMuted ? "Sound" : "Mute"}
          </Text>
        </Pressable>
      ) : null}
      {children !== undefined ? (
        <View style={styles.overlay}>{children}</View>
      ) : null}
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
  audioControl: {
    position: "absolute",
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    zIndex: 3,
  },
  audioControlTopLeft: {
    left: 14,
    top: 14,
  },
  audioControlTopRight: {
    right: 14,
    top: 14,
  },
  audioControlBottomRight: {
    right: 14,
    bottom: 14,
  },
  audioControlPressed: {
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },
  audioControlText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});

export default EventCoverMedia;
