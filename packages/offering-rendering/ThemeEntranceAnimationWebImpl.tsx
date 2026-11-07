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
  REDUCED_MOTION_PROGRESS,
  SAFE_ZONE_OPACITY,
  buildSafeZoneMaskUrl,
  resolveTextSafeZone,
  zoneFromRects,
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
  /** Native only (the sheet's top edge as an Animated value). Ignored here. */
  textZoneTop?: unknown;
  /**
   * Full-screen overlay: the element holding the page text. Its LIVE on-screen
   * rect (tracked through scroll and resize) is the text-safe zone; the side
   * gutters beside it stay full strength. Wins over `textSafeZone`.
   */
  textZoneRef?: React.RefObject<unknown>;
}

/** The subset of lottie-web's AnimationItem this file uses. */
interface WebLottieAnimation {
  play: () => void;
  pause: () => void;
  goToAndStop: (value: number, isFrame?: boolean) => void;
  resize: () => void;
  destroy: () => void;
  addEventListener: (name: "complete" | "enterFrame", cb: () => void) => void;
  totalFrames: number;
  currentFrame: number;
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
export { REDUCED_MOTION_PROGRESS };

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = ({
  theme,
  sessionKey,
  textSafeZone,
  textZoneRef,
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
      <WebMotion
        key={`${sessionKey}:${slug}:${reduceMotion ? "still" : "play"}:${replayKey}`}
        slug={slug}
        color={theme.color}
        color2={theme.color2 ?? null}
        reduceMotion={reduceMotion}
        textSafeZone={textSafeZone}
        textZoneRef={textZoneRef}
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
  /** issue #1023 wave 2 — the gradient's second colour (one unit with `color`). */
  color2: string | null;
  reduceMotion: boolean;
  textSafeZone: TextSafeZoneProp;
  textZoneRef?: React.RefObject<unknown>;
}

/** "contain" for centrepiece looks, else "cover" (from the generator's meta). */
export const motionFit = (json: object): "contain" | "cover" =>
  (json as { meta?: { fit?: string } }).meta?.fit === "contain" ? "contain" : "cover";

const cloneForPlayer = (json: object): object =>
  // lottie-web completes (mutates) the data it is given; the tinted object is
  // memoised and shared, so every player gets its own copy.
  typeof structuredClone === "function"
    ? (structuredClone(json) as object)
    : (JSON.parse(JSON.stringify(json)) as object);

const WebMotion: React.FC<WebMotionProps> = ({
  slug,
  color,
  color2,
  reduceMotion,
  textSafeZone,
  textZoneRef,
}) => {
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
  const palette = useMemo(
    () => buildThemeMotionPalette(color, color2),
    [color, color2],
  );
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
        const loopJson = files[files.length - 1] as object;
        // centrepiece looks (love burst, neon pulse) ship `meta.fit: "contain"`
        // so a wide desktop hero shows them whole instead of a cropped zoom
        const fit = motionFit(loopJson);
        const settings = {
          preserveAspectRatio: fit === "contain" ? "xMidYMid meet" : "xMidYMid slice",
          clearCanvas: true,
          dpr,
        };
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
          // Hand over to the loop ONCE, from whichever signal arrives first:
          // lottie's "complete", or the last frame seen on "enterFrame" (a
          // pause landing on the final frame can swallow "complete").
          let handedOver = false;
          const handOver = (): void => {
            if (!alive || handedOver) return;
            handedOver = true;
            setStage("loop");
            if (runningRef.current) loopAnim.current?.play();
          };
          anim.addEventListener("complete", handOver);
          anim.addEventListener("enterFrame", () => {
            if (anim.currentFrame >= anim.totalFrames - 1) handOver();
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

  // Follow the page text: recompute the zone from live rects on scroll
  // (capture: inner scroll containers too) and resize, and write the masks
  // straight to the two layers — no React render per scroll frame.
  useEffect(() => {
    if (textZoneRef === undefined || typeof window === "undefined") return undefined;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const host = hostRef.current as unknown as Element | null;
      const target = textZoneRef.current as unknown as Element | null;
      if (host === null || target === null || typeof host.getBoundingClientRect !== "function") return;
      const o = host.getBoundingClientRect();
      const z = zoneFromRects(target.getBoundingClientRect(), o);
      const masks: Array<[HTMLDivElement | null, number]> = [
        [introRef.current, SAFE_ZONE_OPACITY.intro],
        [loopRef.current, SAFE_ZONE_OPACITY.loop],
      ];
      for (const [el, inside] of masks) {
        if (el === null) continue;
        const mask = buildSafeZoneMaskUrl(o.width, o.height, z, inside) ?? "none";
        el.style.setProperty("mask-image", mask);
        el.style.setProperty("-webkit-mask-image", mask);
        el.style.setProperty("mask-size", "100% 100%");
        el.style.setProperty("-webkit-mask-size", "100% 100%");
        el.style.setProperty("mask-repeat", "no-repeat");
        el.style.setProperty("-webkit-mask-repeat", "no-repeat");
      }
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [textZoneRef, size, stage]);

  const zone = size && textZoneRef === undefined ? resolveTextSafeZone(textSafeZone, size.w, size.h) : null;
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
