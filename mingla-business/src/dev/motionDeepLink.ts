// issue #1023 — DEV-ONLY: switch the theme entrance motion from OUTSIDE the
// app, so every animation can be watched live on a simulator:
//
//   xcrun simctl openurl booted "mingla-business://e/<brand>/<event>?motion=love_burst"
//   …?motion=none   or   …?motion=     → clear the override (back to the theme)
//
// Any incoming link (cold start or while running) carrying `motion=` sets the
// shared override in @mingla/offering-rendering; the public page's entrance
// replays because the layer is keyed on the override's version. A strict
// no-op when __DEV__ is false: production links ignore `motion=` entirely.
import { useEffect } from "react";
import { Linking } from "react-native";

import { isPreviewableMotionSlug, setThemeMotionDevOverride } from "@mingla/offering-rendering/themeMotionDevOverride";
import type { ThemeAnimationSlug } from "@mingla/offering-rendering/designTokens";

export type MotionLinkAction =
  | { kind: "set"; slug: ThemeAnimationSlug }
  | { kind: "clear" };

/** `motion=<slug>` → set; `motion=none` or `motion=` → clear; else nothing. */
export function parseMotionLink(url: string | null | undefined): MotionLinkAction | null {
  if (typeof url !== "string") return null;
  const match = /[?&]motion=([^&#]*)/.exec(url);
  if (match === null) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
  } catch {
    return null; // malformed escape: ignore the link, never crash on it
  }
  if (value === "" || value === "none") return { kind: "clear" };
  return isPreviewableMotionSlug(value) ? { kind: "set", slug: value } : null;
}

/** Applies a link's motion override. Returns whether it did anything. */
export function applyMotionLink(url: string | null | undefined, isDev: boolean): boolean {
  if (!isDev) return false;
  const action = parseMotionLink(url);
  if (action === null) return false;
  setThemeMotionDevOverride(action.kind === "set" ? action.slug : null, true);
  return true;
}

const isDevBuild = (): boolean => typeof __DEV__ !== "undefined" && __DEV__ === true;

/** Mounted once from app/_layout.tsx. Does nothing outside dev builds. */
export function useMotionDeepLink(): void {
  useEffect(() => {
    if (!isDevBuild()) return undefined;
    Linking.getInitialURL()
      .then((url) => {
        applyMotionLink(url, isDevBuild());
      })
      .catch((error: unknown) => {
        console.warn("[theme-motion] could not read the launch link", error);
      });
    const sub = Linking.addEventListener("url", ({ url }) => {
      applyMotionLink(url, isDevBuild());
    });
    return () => sub.remove();
  }, []);
}
