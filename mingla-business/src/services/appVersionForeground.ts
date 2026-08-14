import type { AppStateStatus } from "react-native";

export const VERSION_FOREGROUND_REFRESH_MS = 15 * 60 * 1_000;

export type VersionForegroundDecision = { backgroundDurationMs: number };

/** Consumes one real background cycle while tolerating iOS's inactive bridge. */
export class VersionForegroundStateMachine {
  private backgroundedAtMs: number | null = null;

  transition(
    status: AppStateStatus,
    nowMs: number,
    alreadyRequired: boolean,
  ): VersionForegroundDecision | null {
    if (status === "background") {
      if (this.backgroundedAtMs === null) this.backgroundedAtMs = nowMs;
      return null;
    }
    if (status !== "active" || this.backgroundedAtMs === null) return null;
    const backgroundedAtMs = this.backgroundedAtMs;
    this.backgroundedAtMs = null;
    const backgroundDurationMs = Math.max(0, nowMs - backgroundedAtMs);
    if (
      !alreadyRequired &&
      backgroundDurationMs < VERSION_FOREGROUND_REFRESH_MS
    )
      return null;
    return { backgroundDurationMs };
  }
}
