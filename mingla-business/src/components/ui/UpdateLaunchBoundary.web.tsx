// #2107 (U1) — web never runs expo-updates, so there is no update to report or
// roll back. Pass-through stub: it imports nothing but React types, so the
// launch guard never reaches a web boot payload.
import type React from "react";

export function LaunchErrorRestartScreen(): null {
  return null;
}

export function UpdateLaunchBoundary({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return children;
}
