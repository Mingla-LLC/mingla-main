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

// ORCH-1167-R8 — the React-owned container <div> that hosts the IMPERATIVELY
// created DOM <video> (see EventCoverWebVideo). React reconciles only this div;
// the <video> is appended via document.createElement so WebKit grants it inline
// muted autoplay (the React-reconciled <video> is permanently denied autoplay).
const WEB_VIDEO_CONTAINER_STYLE: React.CSSProperties = {
  backgroundColor: "#000000",
  height: "100%",
  inset: 0,
  overflow: "hidden",
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
  // ORCH-1167-R8 — IMPERATIVE DOM `<video>` (NO React JSX / NO
  // React.createElement). ROOT CAUSE (orchestrator, exhaustive Playwright
  // forensics on the LIVE page, headless WebKit): R5/R6/R7's React-RENDERED
  // `<video>` is PERMANENTLY DENIED inline-muted autoplay by WebKit — it shows
  // the native play button and never autoplays on desktop Safari/WebKit. The
  // decisive proof: EVERY video created via `document.createElement('video')`
  // (raw DOM) and appended on the EXACT live page AUTOPLAYS, while the
  // component's React-reconciled `<video>` stays poisoned. So React's
  // rendering/reconciliation of the `<video>` node is itself the poison.
  //
  // THE FIX: render a plain `<div>` container that React owns, and in a
  // useEffect create the `<video>` with `document.createElement('video')`,
  // mirror the proven-working bare element (autoplay + muted + playsinline
  // ATTRIBUTES, NO manual play() required), and append it into the container.
  // React must NEVER own/reconcile the `<video>` node. The existing features —
  // mute toggle, aspect-ratio report, error→fallback, reduce-motion freeze
  // (via the autoplay prop), lazy-mount gating — are wired through to the
  // imperative element below. The NATIVE (expo-video) path is UNCHANGED.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlay = autoplay && playbackActive;

  // ORCH-1167-R5 — web autoplay was still showing the browser's native PLAY
  // BUTTON because the FIRST autoplay attempt could fire while the `<video>` was
  // not yet guaranteed-muted at the element level. Browsers ONLY permit inline
  // autoplay without a user gesture when the video is MUTED at play() time; a
  // single unmuted play() rejection paints the native control overlay. We track
  // whether the user has unmuted yet: until they do, EVERY autoplay attempt is
  // forced muted (so the browser always permits it and NO play button shows).
  // Once the chrome Mute toggle unmutes (a real user gesture, which the browser
  // honors), we follow the live `muted` prop. Re-muting works too. `hasUnmuted`
  // is a ref so flipping it never re-triggers the create effect mid-play.
  const hasUnmutedRef = useRef<boolean>(false);
  if (!muted) hasUnmutedRef.current = true;
  // The mute value actually applied to the element: hard-muted for the initial
  // ambient autoplay, then the prop once the user has taken over.
  const effectiveMuted = hasUnmutedRef.current ? muted : true;

  // Keep the latest callbacks/flags in refs so the create effect can read them
  // WITHOUT re-running (which would tear down + recreate the element and lose
  // its autoplay eligibility). The create effect re-runs ONLY on uri change.
  const onAspectRatioRef = useRef(onAspectRatio);
  onAspectRatioRef.current = onAspectRatio;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  // Create the imperative DOM <video> exactly like the proven-working bare
  // element. Re-runs only when the source url changes; fully torn down on
  // unmount / src change. NO manual play() is required for autoplay — the
  // attributes drive it (that is the WebKit-granted path; the React-reconciled
  // node is the poison, NOT a missing play()).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (typeof document === "undefined") return;

    const video = document.createElement("video");
    videoRef.current = video;

    // Mirror the bare element that autoplays on the live page. `muted` must be
    // both the PROPERTY and the ATTRIBUTE before the browser evaluates autoplay
    // eligibility (iOS/WebKit only grant inline muted autoplay when the
    // muted + playsinline ATTRIBUTES are present at the element level).
    video.muted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.playsInline = true;
    video.autoplay = shouldPlayRef.current;
    video.loop = loopRef.current;
    video.controls = false;
    video.preload = "auto";
    // Cover styles (objectFit cover/contain, fill the container).
    Object.assign(video.style, {
      backgroundColor: "#000000",
      height: "100%",
      inset: "0",
      objectFit: contentFit,
      position: "absolute",
      width: "100%",
    } as Partial<CSSStyleDeclaration>);

    // ORCH-0992: report intrinsic aspect ratio once metadata is known. The
    // listener covers the cached-metadata case (event already fired). Reads the
    // latest callback via ref so this effect never re-runs for a callback swap.
    const reportAspectRatio = (): void => {
      const cb = onAspectRatioRef.current;
      if (cb === undefined) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cb(video.videoWidth / video.videoHeight);
      }
    };
    // Error → fallback (EventCover placeholder shows).
    const handleError = (): void => {
      onErrorRef.current();
    };
    // Loop manually too (belt-and-suspenders with the loop attribute) so the
    // ambient cover keeps cycling; never forces play when we should be paused.
    const handleEnded = (): void => {
      if (!loopRef.current || !shouldPlayRef.current) return;
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    };

    video.addEventListener("loadedmetadata", reportAspectRatio);
    video.addEventListener("error", handleError);
    video.addEventListener("ended", handleEnded);

    // Set src LAST, after attributes are pinned, then append — matching the
    // proven bare element's construction order so the very first autoplay
    // eligibility check sees a muted, playsinline, autoplay element.
    video.src = uri;
    container.appendChild(video);
    reportAspectRatio();

    return () => {
      video.removeEventListener("loadedmetadata", reportAspectRatio);
      video.removeEventListener("error", handleError);
      video.removeEventListener("ended", handleEnded);
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.removeAttribute("src");
      if (video.parentNode !== null) video.parentNode.removeChild(video);
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [uri, contentFit]);

  // Follow prop changes on the EXISTING element WITHOUT recreating it. Mute /
  // unmute toggle: when the parent `muted` prop changes we update
  // `video.muted` — unmute is a real user gesture the browser honors. The R5
  // contract holds: the FIRST autoplay is hard-muted (effectiveMuted), and we
  // only follow the live prop once the user has unmuted (hasUnmutedRef). Also
  // keeps loop + the play/pause state in sync with playbackActive/autoplay.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    video.loop = loop;
    video.muted = effectiveMuted;
    if (effectiveMuted) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
    video.autoplay = shouldPlay;

    if (!shouldPlay) {
      try {
        video.pause();
      } catch {
        // ignore
      }
      return;
    }

    if (effectiveMuted) {
      // Hard-muted ambient autoplay is driven by the ATTRIBUTES alone (the
      // proven-working path). We do NOT call play() here — a gesture-less
      // play() is unnecessary for the imperative element and was the R7
      // poison theory. A single GUARDED late recovery covers the rare case
      // where the autoplay attribute didn't kick it off: play() ONCE, only
      // when the media is genuinely ready (readyState >= 3) AND still paused.
      let recovered = false;
      const recover = (): void => {
        if (recovered) return;
        if (video.readyState < 3 || !video.paused) return;
        recovered = true;
        video.muted = true;
        void video.play().catch(() => undefined);
      };
      video.addEventListener("canplaythrough", recover);
      return () => video.removeEventListener("canplaythrough", recover);
    }

    // User has unmuted (a real gesture the browser honors): follow the live
    // prop with a single play() attempt; no hard-muted retry loop.
    void video.play().catch(() => undefined);
    return;
  }, [shouldPlay, effectiveMuted, loop]);

  // React owns ONLY this container <div>; it never owns/reconciles the <video>.
  return React.createElement("div", {
    ref: containerRef,
    style: WEB_VIDEO_CONTAINER_STYLE,
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
  // ORCH-1167-R5 — a VIDEO cover must AUTOPLAY MUTED by default on web so the
  // browser permits inline autoplay and never paints its native play button. The
  // INITIAL mute state is forced true on web when autoplaying (ambient muted
  // loop), matching native. After first paint we follow the parent `muted` prop
  // so the chrome Mute/Unmute toggle (a user gesture) can unmute and re-mute.
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

  // ORCH-1167-R5 — follow the parent `muted` prop on every change so the chrome
  // Mute/Unmute toggle (which flips the parent state) actually reaches the cover
  // video. A NEW media url resets to the web autoplay-muted default so the next
  // cover's first inline autoplay is permitted; an in-place prop change (the
  // user toggling sound) passes straight through. The web `<video>` separately
  // hard-mutes its FIRST autoplay attempt (hasUnmutedRef) so dropping the old
  // "force muted on web" here can never reintroduce the native play button.
  const mediaUrlRef = useRef(mediaUrl);
  useEffect(() => {
    const isNewMedia = mediaUrlRef.current !== mediaUrl;
    mediaUrlRef.current = mediaUrl;
    if (isNewMedia) {
      setIsMuted(Platform.OS === "web" && autoplay ? true : muted);
      return;
    }
    setIsMuted(muted);
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
