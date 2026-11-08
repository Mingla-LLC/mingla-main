// issue #1023 — the Theme sheet, loaded ON INTENT.
//
// Every host editor mounts <ThemeSheet visible={…} />, so a static import put
// the whole picker (colour and font tabs, motion grid, preview band, presets)
// in the eager shared chunk every visitor downloads (#3493 movement gate). This
// wrapper renders nothing and loads nothing until the sheet is first opened;
// then it loads the real sheet once and keeps it mounted so its close
// animation and state behave exactly as before.
//
// A failed load (deploy skew, flaky network) is forgotten so the next open
// tries again, and it never reaches an error boundary: the editor stays usable
// and the row simply does not open the sheet that time.
import React, { useEffect, useState } from "react";

import type { ThemeSheetProps } from "./ThemeSheet";

type ImplModule = typeof import("./ThemeSheet");

let loadedImpl: ImplModule | undefined;
let pendingImpl: Promise<ImplModule> | undefined;

/** Load the sheet chunk once. A failed load is forgotten, so the next call retries. */
export const loadThemeSheet = (): Promise<ImplModule> => {
  if (loadedImpl !== undefined) return Promise.resolve(loadedImpl);
  pendingImpl ??= import("./ThemeSheet").then(
    (module) => (loadedImpl = module),
    (error: unknown) => {
      pendingImpl = undefined;
      throw error;
    },
  );
  return pendingImpl;
};

export type { ThemeSheetProps };

export const ThemeSheet: React.FC<ThemeSheetProps> = (props) => {
  const [impl, setImpl] = useState<ImplModule | undefined>(loadedImpl);
  const wanted = props.visible || impl !== undefined;
  useEffect(() => {
    if (!props.visible || impl !== undefined) return undefined;
    let alive = true;
    loadThemeSheet().then(
      (module) => {
        if (alive) setImpl(module);
      },
      (error: unknown) => {
        console.warn("[theme-sheet] the Theme sheet did not load", error);
      },
    );
    return () => {
      alive = false;
    };
  }, [props.visible, impl]);
  if (!wanted || impl === undefined) return null;
  const Impl = impl.ThemeSheet;
  return <Impl {...props} />;
};
