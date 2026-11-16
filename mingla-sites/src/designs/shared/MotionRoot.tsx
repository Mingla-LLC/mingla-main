"use client";

import { useEffect } from "react";
import { startMotion } from "./motion";

/** #4453 §3.5 — runs the motion module once for the page it sits in (renders nothing). */
export function MotionRoot({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    return root ? startMotion(root) : undefined;
  }, [rootId]);
  return null;
}
