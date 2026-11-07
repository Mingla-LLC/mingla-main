// issue #1023 — theme entrance motion, WEB implementation (loaded lazily by
// ThemeEntranceAnimation.web.tsx; buyer web + business web).
//
// Same contract as the native file: every visit plays the brand-tinted
// entrance once, then crossfades into the seamless loop. Rendered with
// lottie-web's canvas-only "light" build (no expressions, no SVG/HTML
// renderers), loaded with `import()` so neither the player nor any animation
// file is part of the eager page bundle (ORCH-1083 bundle budget).
//
// - Paused: one per-device choice in localStorage, shared with the button.
// - prefers-reduced-motion: one still frame of the loop, no playback, no button.
// - Hidden tab (visibilitychange) or layer scrolled off screen: paused.
// - Text-safe zone: a soft-edged CSS mask (buildSafeZoneMaskUrl).
// - The layer ignores pointer events and is aria-hidden; only the pause
//   button is reachable.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import {
  THEME_MOTION_TIMING,
  buildThemeMotionPalette,
  loadThemeLottie,
  tintLottie,
  type ThemeMotionSlug,
} from "@mingla/theme-animations";

import type { ResolvedTheme } from "./designTokens";
import {
  SAFE_ZONE_OPACITY,
  buildSafeZoneMaskUrl,
  resolveTextSafeZone,
  type TextSafeZoneProp,
} from "./themeMotion";
import { ThemeMotionPauseButton, useMotionPaused } from "./ThemeMotionPauseButton";
import { motionPauseStore } from "./themeMotionPauseStore";
import { useReduceMotionPreference } from "./useReduceMotionPreference";
import { useThemeMotionSlug } from "./useThemeMotionSlug";

export interface ThemeEntranceAnimationProps {
  theme: ResolvedTheme;
  /** Kept for callers; a CHANGE of key restarts the entrance. */
  sessionKey: string;
  /** Kept for compatibility: every mount now plays the entrance. */
  replayOnMount?: boolean;
  textSafeZone?: TextSafeZoneProp;
  pauseButton?: "inline" | "none";
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
}

/** The subset of lottie-web's AnimationItem this file uses. */
interface WebLottieAnimation {
  play: () => void;
  pause: () => void;
  goToAndStop: (value: number, isFrame?: boolean) => void;
  resize: () => void;
  destroy: () => void;
  addEventListener: (name: "complete", cb: () => void) => void;
  totalFrames: number;
}

interface WebLottiePlayer {
  loadAnimation: (params: {
    container: HTMLElement;
    renderer: "canvas";
    loop: boolean;
    autoplay: boolean;
    animationData: object;
    rendererSettings?: { preserveAspectRatio?: string; clearCanvas?: boolean; dpr?: number };
  }) => WebLottieAnimation;
}

let playerPromise: Promise<WebLottiePlayer> | null = null;
/** lottie-web's canvas-only build, fetched on first use and then shared. */
export function loadWebLottiePlayer(): Promise<WebLottiePlayer> {
  if (playerPromise === null) {
    playerPromise = import("lottie-web/build/player/lottie_light_canvas")
      .then((mod: unknown) => {
        const m = mod as { default?: WebLottiePlayer } & Partial<WebLottiePlayer>;
        const player = m.default ?? (m as WebLottiePlayer);
        if (typeof player.loadAnimation !== "function") {
          throw new Error("lottie-web did not load");
        }
        return player;
      })
      .catch((error: unknown) => {
        playerPromise = null;
        throw error;
      });
  }
  return playerPromise;
}

/** Mid-loop still for prefers-reduced-motion (progress 0..1). */
export const REDUCED_MOTION_PROGRESS = 0.5;

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = ({
  theme,
  sessionKey,
  textSafeZone,
  pauseButton = "inline",
  pauseButtonTop = 64,
  part = "layer",
  still = false,
}) => {
  const themed = useThemeMotionSlug(theme.animation);
  // a picker tile shows ITS slug, never the dev preview override
  const slug = still ? theme.animation : themed;
  const reduceMotion = useReduceMotionPreference() || still;
  if (slug === "none") return null;
  if (part === "pauseButton") return <ThemeMotionPauseButton theme={theme} />;
  return (
    <View pointerEvents="box-none" style={styles.wrap} testID="theme-entrance-animation">
      <WebMotion
        key={`${sessionKey}:${slug}:${reduceMotion ? "still" : "play"}`}
        slug={slug}
        color={theme.color}
        reduceMotion={reduceMotion}
        textSafeZone={textSafeZone}
      />
      {pauseButton === "inline" && !still ? (
        <ThemeMotionPauseButton theme={theme} style={[styles.pause, { top: pauseButtonTop }]} />
      ) : null}
    </View>
  );
};

interface WebMotionProps {
  slug: ThemeMotionSlug;
  color: string;
  reduceMotion: boolean;
  textSafeZone: TextSafeZoneProp;
}

const cloneForPlayer = (json: object): object =>
  // lottie-web completes (mutates) the data it is given; the tinted object is
  // memoised and shared, so every player gets its own copy.
  typeof structuredClone === "function"
    ? (structuredClone(json) as object)
    : (JSON.parse(JSON.stringify(json)) as object);

const WebMotion: React.FC<WebMotionProps> = ({ slug, color, reduceMotion, textSafeZone }) => {
  const hostRef = useRef<View>(null);
  const introRef = useRef<HTMLDivElement | null>(null);
  const loopRef = useRef<HTMLDivElement | null>(null);
  const introAnim = useRef<WebLottieAnimation | null>(null);
  const loopAnim = useRef<WebLottieAnimation | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<"loading" | "intro" | "loop">("loading");
  const [pageVisible, setPageVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const paused = useMotionPaused();
  const palette = useMemo(() => buildThemeMotionPalette(color), [color]);
  const running = !paused && pageVisible && onScreen && !reduceMotion;
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    void motionPauseStore.hydrate();
    if (typeof document === "undefined") return undefined;
    const onVisibility = (): void => setPageVisible(document.visibilityState !== "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Pause while the cover is scrolled out of view.
  useEffect(() => {
    const node = hostRef.current as unknown as Element | null;
    if (node === null || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) setOnScreen(entry.isIntersecting);
    });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Load the player + both files, then build the players once.
  useEffect(() => {
    let alive = true;
    const phases = reduceMotion ? (["loop"] as const) : (["intro", "loop"] as const);
    Promise.all([loadWebLottiePlayer(), ...phases.map((phase) => loadThemeLottie(slug, phase))])
      .then(([player, ...files]) => {
        if (!alive) return;
        const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
        const settings = { preserveAspectRatio: "xMidYMid slice", clearCanvas: true, dpr };
        const loopJson = files[files.length - 1] as object;
        if (loopRef.current !== null) {
          loopAnim.current = player.loadAnimation({
            container: loopRef.current,
            renderer: "canvas",
            loop: true,
            autoplay: false,
            animationData: cloneForPlayer(tintLottie(loopJson, palette)),
            rendererSettings: settings,
          });
        }
        if (reduceMotion) {
          const anim = loopAnim.current;
          if (anim !== null) anim.goToAndStop(Math.floor(anim.totalFrames * REDUCED_MOTION_PROGRESS), true);
          setStage("loop");
          return;
        }
        if (introRef.current !== null) {
          const anim = player.loadAnimation({
            container: introRef.current,
            renderer: "canvas",
            loop: false,
            autoplay: runningRef.current,
            animationData: cloneForPlayer(tintLottie(files[0] as object, palette)),
            rendererSettings: settings,
          });
          anim.addEventListener("complete", () => {
            if (!alive) return;
            setStage("loop");
            if (runningRef.current) loopAnim.current?.play();
          });
          introAnim.current = anim;
        }
        setStage("intro");
      })
      .catch((error: unknown) => {
        console.warn(`[theme-motion] could not start ${slug}`, error);
      });
    return () => {
      alive = false;
      introAnim.current?.destroy();
      loopAnim.current?.destroy();
      introAnim.current = null;
      loopAnim.current = null;
    };
  }, [slug, palette, reduceMotion]);

  // Pause/resume the player that is on stage.
  useEffect(() => {
    const active = stage === "intro" ? introAnim.current : stage === "loop" ? loopAnim.current : null;
    if (active === null || reduceMotion) return;
    if (running) active.play();
    else active.pause();
  }, [running, stage, reduceMotion]);

  // Keep the canvases sharp when the cover resizes.
  useEffect(() => {
    introAnim.current?.resize();
    loopAnim.current?.resize();
  }, [size]);

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) =>
      prev && Math.abs(prev.w - width) <= 0.5 && Math.abs(prev.h - height) <= 0.5
        ? prev
        : { w: width, h: height },
    );
  };

  const zone = size ? resolveTextSafeZone(textSafeZone, size.w, size.h) : null;
  const introMask = size ? buildSafeZoneMaskUrl(size.w, size.h, zone, SAFE_ZONE_OPACITY.intro) : null;
  const loopMask = size ? buildSafeZoneMaskUrl(size.w, size.h, zone, SAFE_ZONE_OPACITY.loop) : null;
  const fade = `opacity ${THEME_MOTION_TIMING.crossfadeMs}ms ease`;
  const layerStyle = (mask: string | null, visible: boolean): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    opacity: visible ? 1 : 0,
    transition: fade,
    pointerEvents: "none",
    ...(mask !== null
      ? {
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }
      : {}),
  });

  return (
    <View
      ref={hostRef}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      aria-hidden
      onLayout={onLayout}
      testID="theme-entrance-web-player"
    >
      {React.createElement("div", {
        ref: introRef,
        "data-phase": "intro",
        style: layerStyle(introMask, stage !== "loop" && !reduceMotion),
      })}
      {React.createElement("div", {
        ref: loopRef,
        "data-phase": "loop",
        "data-loop": "true",
        style: layerStyle(loopMask, stage === "loop"),
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  pause: {
    position: "absolute",
    right: 12,
  },
});
