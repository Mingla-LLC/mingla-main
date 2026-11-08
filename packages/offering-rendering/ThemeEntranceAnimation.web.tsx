// issue #1023 — theme entrance motion, WEB entry point.
//
// A thin lazy shell: the player, palette, tinting and loaders live in
// ThemeEntranceAnimationWebImpl and arrive in their own chunk the first time a
// page with motion mounts, so none of it is in the eager boot payload every
// visitor downloads (ORCH-1083 bundle budget). "none" never loads anything.
//
// Motion is decoration: a chunk that fails to load (deploy skew, flaky
// network, a dev server that cannot serve it) renders NOTHING and never
// reaches an error boundary. The failure is forgotten, so the next mount tries
// again — the same contract as LazyOfferingRefundLadder. (React.lazy is not
// used: it caches a rejected import and rethrows it into the boundary.)

import React, { useEffect, useState } from "react";

// Same value export as the native twin (i-1378 web-shim parity). The constant
// lives in designTokens, so exporting it here loads no player or dev code.
export { REDUCED_MOTION_PROGRESS } from "./designTokens";
import type { ThemeEntranceAnimationProps } from "./ThemeEntranceAnimationWebImpl";

export type { ThemeEntranceAnimationProps } from "./ThemeEntranceAnimationWebImpl";

type ImplModule = typeof import("./ThemeEntranceAnimationWebImpl");

let loadedImpl: ImplModule | undefined;
let pendingImpl: Promise<ImplModule> | undefined;

/** Load the player chunk once. A failed load is forgotten, so the next call retries. */
export const loadThemeMotionWebImpl = (): Promise<ImplModule> => {
  if (loadedImpl !== undefined) return Promise.resolve(loadedImpl);
  pendingImpl ??= import("./ThemeEntranceAnimationWebImpl").then(
    (module) => (loadedImpl = module),
    (error: unknown) => {
      pendingImpl = undefined;
      throw error;
    },
  );
  return pendingImpl;
};

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = (props) => {
  const active = props.theme.animation !== "none" || hasDevMotionOverride();
  const [impl, setImpl] = useState<ImplModule | undefined>(loadedImpl);
  useEffect(() => {
    if (!active || impl !== undefined) return undefined;
    let alive = true;
    loadThemeMotionWebImpl().then(
      (module) => {
        if (alive) setImpl(module);
      },
      (error: unknown) => {
        console.warn("[theme-motion] the motion player did not load; showing none", error);
      },
    );
    return () => {
      alive = false;
    };
  }, [active, impl]);
  if (!active || impl === undefined) return null;
  const Impl = impl.ThemeEntranceAnimation;
  return <Impl {...props} />;
};

/** Dev only: `?motion=` or a sheet preview can turn motion on for a theme that has none. */
function hasDevMotionOverride(): boolean {
  if (typeof __DEV__ === "undefined" || __DEV__ !== true) return false;
  // Required here, under __DEV__, so production never bundles the override.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dev = require("./themeMotionDevOverride") as typeof import("./themeMotionDevOverride");
  if (dev.getThemeMotionDevOverride() !== null) return true;
  return typeof window !== "undefined" && /[?&]motion=/.test(window.location?.search ?? "");
}
