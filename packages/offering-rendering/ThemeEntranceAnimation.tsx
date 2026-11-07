// issue #1023 — theme entrance motion, NATIVE (iOS / Android).
//
// Every mount (every visit) plays the brand-tinted entrance once, then
// crossfades into a seamless ambient loop that runs while the layer is
// mounted. There is no play-once memory any more: the module-level
// `playedSessionKeys` Set is gone. `sessionKey` / `replayOnMount` are kept for
// callers: a new `sessionKey` restarts the entrance (the Theme sheet's Replay).
//
// - Paused: one per-device choice (AsyncStorage), shared with the pause button.
// - Reduce Motion: a single still frame of the loop, no playback, no button.
// - Backgrounded app: paused until it returns.
// - Text-safe zone: synchronised copies of the animation clipped into
//   horizontal bands (computeSafeZoneBands) — no masking native module needed.
// - The layer ignores touches and is hidden from screen readers; only the
//   pause button is reachable.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import LottieView from "lottie-react-native";
import {
  THEME_MOTION_TIMING,
  buildThemeMotionPalette,
  loadThemeLottie,
  peekThemeLottie,
  tintLottie,
  type ThemeMotionPhase,
  type ThemeMotionSlug,
} from "@mingla/theme-animations";

import type { ResolvedTheme } from "./designTokens";
import {
  SAFE_ZONE_OPACITY,
  computeFollowBands,
  computeSafeZoneBands,
  resolveTextSafeZone,
  type SafeZoneBand,
  type TextSafeZoneProp,
} from "./themeMotion";
import { ThemeMotionPauseButton, useMotionPaused } from "./ThemeMotionPauseButton";
import { motionPauseStore } from "./themeMotionPauseStore";
import { useReduceMotionPreference } from "./useReduceMotionPreference";
import { useThemeMotionReplayKey, useThemeMotionSlug } from "./useThemeMotionSlug";

export interface ThemeEntranceAnimationProps {
  theme: ResolvedTheme;
  /** Kept for callers; a CHANGE of key restarts the entrance. */
  sessionKey: string;
  /** Kept for compatibility: every mount now plays the entrance. */
  replayOnMount?: boolean;
  /**
   * Where on-cover text sits, relative to this layer. Omit when nothing is
   * written on the animation; "default" = the reference zone (47% down, 6%
   * gutters) for text that has not been measured.
   */
  textSafeZone?: TextSafeZoneProp;
  /**
   * "inline" (default) draws the pause button in the layer's top-right.
   * "none" when the host renders <ThemeMotionPauseButton> somewhere
   * reachable (a cover pinned behind a scroll view cannot take touches).
   */
  pauseButton?: "inline" | "none";
  /** Top offset of the inline pause button (clears floating chrome). */
  pauseButtonTop?: number;
  /**
   * "pauseButton" renders ONLY the pause control (no animation), for hosts
   * whose cover sits behind a scroll view: they mount the layer with
   * pauseButton="none" on the cover and this part where it can be tapped.
   * Same component (not a second export) so suites that stub
   * ThemeEntranceAnimation stub both halves.
   */
  part?: "layer" | "pauseButton";
  /** A still frame of the loop and no button (picker tiles). */
  still?: boolean;
  /**
   * NATIVE full-screen overlay: the on-screen y of the page's details sheet
   * top edge, as an Animated value the host updates as the page scrolls. The
   * motion fades below that edge (the sheet's text, chips and Buy button).
   * Wins over `textSafeZone`. Ignored on web (see `textZoneRef`).
   */
  textZoneTop?: Animated.Value | Animated.AnimatedInterpolation<number>;
  /**
   * WEB full-screen overlay: the element holding the page text; its live
   * on-screen rect is the zone (with full strength in the side gutters).
   * Ignored on native.
   */
  textZoneRef?: React.RefObject<unknown>;
}

/** Mid-loop still for Reduce Motion (progress 0..1). */
export const REDUCED_MOTION_PROGRESS = 0.5;

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = ({
  theme,
  sessionKey,
  textSafeZone,
  textZoneTop,
  pauseButton = "inline",
  pauseButtonTop = 64,
  part = "layer",
  still = false,
}) => {
  const themed = useThemeMotionSlug(theme.animation);
  // a picker tile shows ITS slug, never the dev preview override
  const slug = still ? theme.animation : themed;
  const reduceMotion = useReduceMotionPreference() || still;
  const replayKey = useThemeMotionReplayKey();
  if (slug === "none") return null;
  if (part === "pauseButton") return <ThemeMotionPauseButton theme={theme} />;
  return (
    <View pointerEvents="box-none" style={styles.wrap} testID="theme-entrance-animation">
      <MotionLayers
        key={`${sessionKey}:${slug}:${reduceMotion ? "still" : "play"}:${replayKey}`}
        slug={slug}
        color={theme.color}
        color2={theme.color2 ?? null}
        reduceMotion={reduceMotion}
        textSafeZone={textSafeZone}
        textZoneTop={textZoneTop}
      />
      {pauseButton === "inline" && !still ? (
        <ThemeMotionPauseButton theme={theme} style={[styles.pause, { top: pauseButtonTop }]} />
      ) : null}
    </View>
  );
};

interface MotionLayersProps {
  slug: ThemeMotionSlug;
  color: string;
  /** issue #1023 wave 2 — the gradient's second colour (one unit with `color`). */
  color2: string | null;
  reduceMotion: boolean;
  textSafeZone: TextSafeZoneProp;
  textZoneTop?: ThemeEntranceAnimationProps["textZoneTop"];
}

type Stage = "intro" | "crossfade" | "loop";

function useThemeLottie(
  slug: ThemeMotionSlug,
  phase: ThemeMotionPhase,
  enabled: boolean,
): object | null {
  const [json, setJson] = useState<object | null>(() =>
    enabled ? peekThemeLottie(slug, phase) : null,
  );
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loadThemeLottie(slug, phase)
      .then((data) => {
        if (alive) setJson(data);
      })
      .catch((error: unknown) => {
        // Decorative layer: a load failure shows no motion, never an error UI.
        console.warn(`[theme-motion] could not load ${slug}.${phase}`, error);
      });
    return () => {
      alive = false;
    };
  }, [slug, phase, enabled]);
  return json;
}

const MotionLayers: React.FC<MotionLayersProps> = ({
  slug,
  color,
  color2,
  reduceMotion,
  textSafeZone,
  textZoneTop,
}) => {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<Stage>(reduceMotion ? "loop" : "intro");
  const stageRef = useRef<Stage>(stage);
  const paused = useMotionPaused();
  const [appActive, setAppActive] = useState<boolean>(AppState.currentState !== "background");
  const introOpacity = useRef(new Animated.Value(1)).current;
  const loopOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const introRefs = useRef<Array<LottieView | null>>([]);
  const loopRefs = useRef<Array<LottieView | null>>([]);

  useEffect(() => {
    void motionPauseStore.hydrate();
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);

  const palette = useMemo(
    () => buildThemeMotionPalette(color, color2),
    [color, color2],
  );
  const introRaw = useThemeLottie(slug, "intro", !reduceMotion);
  const loopRaw = useThemeLottie(slug, "loop", true);
  const intro = useMemo(() => (introRaw ? tintLottie(introRaw, palette) : null), [introRaw, palette]);
  const loop = useMemo(() => (loopRaw ? tintLottie(loopRaw, palette) : null), [loopRaw, palette]);

  const zone = size ? resolveTextSafeZone(textSafeZone, size.w, size.h) : null;
  const introBands = size ? computeSafeZoneBands(size.h, zone, SAFE_ZONE_OPACITY.intro) : [];
  const loopBands = size ? computeSafeZoneBands(size.h, zone, SAFE_ZONE_OPACITY.loop) : [];

  const running = !paused && appActive && !reduceMotion;

  // Pause / resume every copy together so the bands stay in step.
  useEffect(() => {
    for (const view of [...introRefs.current, ...loopRefs.current]) {
      if (view === null) continue;
      if (running) view.resume();
      else view.pause();
    }
  }, [running, stage]);

  const onIntroFinish = (cancelled: boolean): void => {
    if (cancelled || stageRef.current !== "intro") return;
    stageRef.current = "crossfade";
    setStage("crossfade");
    Animated.parallel([
        Animated.timing(introOpacity, {
          toValue: 0,
          duration: THEME_MOTION_TIMING.crossfadeMs,
          useNativeDriver: true,
        }),
        Animated.timing(loopOpacity, {
          toValue: 1,
          duration: THEME_MOTION_TIMING.crossfadeMs,
          useNativeDriver: true,
        }),
    ]).start(() => {
      stageRef.current = "loop";
      setStage("loop");
    });
  };

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) =>
      prev && Math.abs(prev.w - width) <= 0.5 && Math.abs(prev.h - height) <= 0.5
        ? prev
        : { w: width, h: height },
    );
  };

  // Full-screen overlay: bands ride the sheet's top edge (one Animated value,
  // transforms only — no re-render or layout per scroll frame).
  const renderFollowBands = (
    json: object,
    phase: ThemeMotionPhase,
    refs: React.MutableRefObject<Array<LottieView | null>>,
  ): React.ReactNode => {
    if (size === null || textZoneTop === undefined) return null;
    const inside = phase === "intro" ? SAFE_ZONE_OPACITY.intro : SAFE_ZONE_OPACITY.loop;
    return computeFollowBands(size.h, inside).map((band, index) => {
      const shift = Animated.add(textZoneTop, band.from);
      return (
        <Animated.View
          key={`${phase}-follow-${index}`}
          testID={`theme-entrance-follow-band-${phase}-${index}`}
          style={[
            styles.band,
            { top: 0, height: band.height, opacity: band.opacity, transform: [{ translateY: shift }] },
          ]}
        >
          <Animated.View
            style={[
              styles.lottieShift,
              { width: size.w, height: size.h, transform: [{ translateY: Animated.multiply(shift, -1) }] },
            ]}
          >
            <LottieView
              ref={(view: LottieView | null) => {
                refs.current[index] = view;
              }}
              source={json}
              autoPlay={running}
              loop={phase === "loop"}
              progress={reduceMotion ? REDUCED_MOTION_PROGRESS : undefined}
              resizeMode={motionResizeMode(json)}
              cacheComposition
              style={{ width: size.w, height: size.h }}
              onAnimationFinish={phase === "intro" && index === 0 ? onIntroFinish : undefined}
              testID={`theme-entrance-${phase}`}
            />
          </Animated.View>
        </Animated.View>
      );
    });
  };

  const renderBands = (
    json: object,
    bands: SafeZoneBand[],
    phase: ThemeMotionPhase,
    refs: React.MutableRefObject<Array<LottieView | null>>,
  ): React.ReactNode =>
    bands.map((band, index) => (
      <View
        key={`${phase}-${index}`}
        style={[styles.band, { top: band.top, height: band.height, opacity: band.opacity }]}
      >
        <LottieView
          ref={(view: LottieView | null) => {
            refs.current[index] = view;
          }}
          source={json}
          autoPlay={running}
          loop={phase === "loop"}
          progress={reduceMotion ? REDUCED_MOTION_PROGRESS : undefined}
          resizeMode={motionResizeMode(json)}
          cacheComposition
          style={[
            styles.lottie,
            { top: -band.top, width: size?.w ?? 0, height: size?.h ?? 0 },
          ]}
          onAnimationFinish={phase === "intro" && index === 0 ? onIntroFinish : undefined}
          testID={`theme-entrance-${phase}`}
        />
      </View>
    ));

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
    >
      {size && intro && stage !== "loop" ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: introOpacity }]}>
          {textZoneTop !== undefined
            ? renderFollowBands(intro, "intro", introRefs)
            : renderBands(intro, introBands, "intro", introRefs)}
        </Animated.View>
      ) : null}
      {size && loop && stage !== "intro" ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: loopOpacity }]}>
          {textZoneTop !== undefined
            ? renderFollowBands(loop, "loop", loopRefs)
            : renderBands(loop, loopBands, "loop", loopRefs)}
        </Animated.View>
      ) : null}
    </View>
  );
};

/** "contain" for centrepiece looks (meta.fit), else "cover". */
const motionResizeMode = (json: object): "contain" | "cover" =>
  (json as { meta?: { fit?: string } }).meta?.fit === "contain" ? "contain" : "cover";

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  lottieShift: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    elevation: 6,
  },
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  lottie: {
    position: "absolute",
    left: 0,
  },
  pause: {
    position: "absolute",
    right: 12,
  },
});
