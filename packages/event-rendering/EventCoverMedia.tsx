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
import {
  resolveEventCoverMediaPresentation,
  shouldFreezeCoverForReduceMotion,
} from "./coverMediaPresentation";
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
  // ORCH-0992: how the cover VIDEO fills its box. "cover" (default) crops to
  // fill — right for list/grid cards. "contain" shows the entire frame
  // (letterboxed on the player's black background). Images are unaffected
  // (always "cover").
  videoContentFit?: "cover" | "contain";
  // ORCH-0992: optional callback fired once the media's intrinsic size is
  // known, with its aspect ratio (width / height). The event-page hero uses
  // this to size its box to the media's shape so a 16:9 / square / vertical
  // cover fills the hero with NO crop AND NO letterbox bars. List/grid cards
  // omit it (no-op) and keep their fixed-shape "cover" fill.
  onAspectRatio?: (ratio: number) => void;
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
  contentFit: "cover" | "contain";
  onAspectRatio?: (ratio: number) => void;
  onError: () => void;
}> = ({
  uri,
  autoplay,
  playbackActive,
  muted,
  loop,
  contentFit,
  onAspectRatio,
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlay = autoplay && playbackActive;

  // ORCH-0992: report the video's intrinsic aspect ratio once metadata loads,
  // so a hero can size its box to the video's shape. videoWidth/videoHeight are
  // 0 until metadata is available; the loadedmetadata listener covers the case
  // where metadata is already cached (the effect runs after the event fired).
  useEffect(() => {
    if (onAspectRatio === undefined) return;
    const video = videoRef.current;
    if (video === null) return;
    const report = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onAspectRatio(video.videoWidth / video.videoHeight);
      }
    };
    report();
    video.addEventListener("loadedmetadata", report);
    return () => video.removeEventListener("loadedmetadata", report);
  }, [onAspectRatio, uri]);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    // iOS Safari only treats a video as eligible for inline muted autoplay when
    // the `muted` + `playsinline` ATTRIBUTES are present at the element level.
    // React 19 sets `muted` as a DOM property only (no attribute), so iOS refuses
    // to autoplay and shows its native play button. Set the attributes + property
    // imperatively, then play(). (Desktop works on the property alone.)
    video.muted = muted;
    if (muted) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    if (shouldPlay) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
  }, [shouldPlay, uri, muted]);

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
    style: { ...WEB_VIDEO_STYLE, objectFit: contentFit },
  });
};

const EventCoverNativeVideo: React.FC<{
  uri: string;
  autoplay: boolean;
  playbackActive: boolean;
  muted: boolean;
  loop: boolean;
  contentFit: "cover" | "contain";
  onAspectRatio?: (ratio: number) => void;
  onError: () => void;
}> = ({
  uri,
  autoplay,
  playbackActive,
  muted,
  loop,
  contentFit,
  onAspectRatio,
  onError,
}) => {
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

  // ORCH-0992: report intrinsic aspect ratio from expo-video's video track
  // (sourceLoad fires once the track is known) so a hero can size to the
  // video's shape. Guarded so list/grid cards (no callback) pay nothing.
  useEffect(() => {
    if (onAspectRatio === undefined) return;
    const emit = (size: { width: number; height: number } | undefined): void => {
      if (size !== undefined && size.width > 0 && size.height > 0) {
        onAspectRatio(size.width / size.height);
      }
    };
    emit(player.videoTrack?.size);
    const sub = player.addListener("sourceLoad", (payload) => {
      emit(payload.availableVideoTracks[0]?.size);
    });
    return () => sub.remove();
  }, [onAspectRatio, player]);

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
      contentFit={contentFit}
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
  contentFit: "cover" | "contain";
  onAspectRatio?: (ratio: number) => void;
  onError: () => void;
}> = (props) =>
  Platform.OS === "web" ? (
    <EventCoverWebVideo {...props} />
  ) : (
    <EventCoverNativeVideo {...props} />
  );

// ORCH-0964: on WEB, only mount the heavy cover media (video / animated image)
// once the card is at/near the viewport. A brand page renders many cards; if
// all their covers (e.g. 12 animated GIFs + a video) decode at once, the mobile
// renderer balloons past ~1GB and the WebContent process crashes ("Can't open
// this page"). Lazy-mounting bounds concurrent decodes to what's visible.
// One-way (load when first visible, then keep) to avoid scroll flicker. Native
// is unaffected (always true) — no IntersectionObserver, native handles memory.
function useInViewport(ref: React.RefObject<unknown>): boolean {
  const [inView, setInView] = useState<boolean>(Platform.OS !== "web");
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const node = ref.current as unknown as Element | null;
    if (node === null) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

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
  videoContentFit = "cover",
  onAspectRatio,
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
  const containerRef = useRef<View | null>(null);
  const inView = useInViewport(containerRef);

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

  // ORCH-0992: a muted-autoplay-loop cover is ambient motion (like a GIF cover,
  // never frozen). Only freeze non-ambient covers (sound-on / tap-to-play) for
  // reduce-motion. See shouldFreezeCoverForReduceMotion for the full rationale.
  const freezeForReduceMotion = shouldFreezeCoverForReduceMotion({
    reduceMotion,
    autoplay,
    muted,
    loop,
  });
  const presentation = resolveEventCoverMediaPresentation({
    mediaUrl,
    mediaType,
    hasMediaError,
    reduceMotion: freezeForReduceMotion,
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

  // Render heavy media only when there IS media AND (native OR the card is at/
  // near the viewport on web). Off-screen web cards show the lightweight
  // EventCover placeholder until scrolled into view — bounding concurrent
  // decodes so a media-dense brand page can't OOM the mobile renderer.
  const renderMedia =
    presentation !== "fallback" &&
    mediaUrl !== null &&
    (Platform.OS !== "web" || inView);

  if (!renderMedia) {
    return (
      <View
        ref={containerRef}
        collapsable={false}
        style={[{ height, width }, style]}
      >
        <EventCover
          hue={hue}
          radius={radius}
          label={label}
          height="100%"
          width="100%"
          testID={testID}
        >
          {children}
        </EventCover>
      </View>
    );
  }

  return (
    <View
      ref={containerRef}
      collapsable={false}
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
          contentFit={videoContentFit}
          onAspectRatio={onAspectRatio}
          onError={() => handleMediaError("video")}
        />
      ) : (
        <Image
          source={{ uri: mediaUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          // ORCH-0992: report image aspect ratio so an adaptive hero fits
          // square / vertical image covers the same way it fits videos.
          onLoad={
            onAspectRatio === undefined
              ? undefined
              : (event) => {
                  const src = event.nativeEvent?.source;
                  if (
                    src !== undefined &&
                    src.width > 0 &&
                    src.height > 0
                  ) {
                    onAspectRatio(src.width / src.height);
                  }
                }
          }
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
    // ORCH-1132 — 16 → 24 (spacing.lg): VISIBLE right-edge breathing room.
    // ORCH-1131 aligned the pill to the public-event floating chrome column
    // (X / share at right: spacing.md = 16), but that 2px nudge read cramped to
    // Seth. 24 (= spacing.lg) is +8px (a perceptible 50% increase in inset) and
    // a real token, so the pill sits one deliberate step further from the edge
    // than the chrome — a legible offset, not a misalignment. Shared style:
    // also moves the consumer expandedCard + business authoring-preview pills
    // by +8px (safe; no consumer relies on 16). Raw literal matches this file's
    // convention (topLeft/topRight all use raw numbers).
    right: 24,
    // ORCH-1133 — 22 → 40: round-3 clearance from the public-event details panel.
    // The blue details panel (PublicEventPage `bodyContent`, marginTop:-28) sits
    // 28px above the hero bottom; at bottom:22 the pill overlapped the panel top
    // by 6px (measured on buyer web). bottom:40 = 28 + 12px visible gap (live-
    // verified +12.0px on /e/leggothis/vibes-and-stuff & /a-life-in-vegas).
    // Shared style → also lifts the consumer gallery + authoring-preview pills
    // +18px on their full-bleed covers (benign; ≥200px boxes, no panel below).
    bottom: 40,
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
