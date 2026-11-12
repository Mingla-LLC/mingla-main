/**
 * #4389 addendum 2 — an offering row's clip plays only while that ROW is on
 * screen (not merely while the app is open). Each row measures itself in the
 * window on a light timer while the app is in the foreground; a row counts as
 * on screen when at least a third of it is inside the window. Web shows the
 * poster only, so it never measures.
 */
import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Platform, StyleSheet, View } from "react-native";

import { OfferingClip } from "./OfferingClip";

/** How often a mounted row re-checks its place in the window. */
export const ROW_VISIBILITY_POLL_MS = 400;
/** The share of the row that must be inside the window. */
export const ROW_VISIBLE_SHARE = 1 / 3;

/** Pure: is a row (top, height in window points) on a screen of `windowHeight`? */
export function rowOnScreen(top: number, height: number, windowHeight: number): boolean {
  if (!(height > 0) || !(windowHeight > 0) || !Number.isFinite(top)) return false;
  const visible = Math.min(top + height, windowHeight) - Math.max(top, 0);
  return visible >= height * ROW_VISIBLE_SHARE;
}

export const OfferingRowClip: React.FC<{ video: number; poster: number; appActive: boolean }> = ({
  video,
  poster,
  appActive,
}) => {
  const ref = useRef<View>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web" || !appActive) {
      setOnScreen(false);
      return undefined;
    }
    let alive = true;
    const check = (): void => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        if (alive) setOnScreen(rowOnScreen(y, h, Dimensions.get("window").height));
      });
    };
    check();
    const timer = setInterval(check, ROW_VISIBILITY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [appActive]);
  return (
    <View ref={ref} style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
      <OfferingClip video={video} poster={poster} active={appActive && onScreen} />
    </View>
  );
};
