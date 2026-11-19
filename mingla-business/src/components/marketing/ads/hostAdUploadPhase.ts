/**
 * #4238 B7 — how an upload lane stage reads on an ad media tile. Its own module
 * because the upload slot loads with the video runtime: sharing the media queue
 * with it would hoist the queue into the boot bundle.
 */
export type HostAdUploadPhase = "uploading" | "preparing" | "ready" | "failed";

/** How a lane stage reads on a tile. */
export function hostAdUploadPhaseFor(stage: {
  phase: string;
  percent: number | null;
  canRetry?: boolean;
}): { phase: HostAdUploadPhase; percent: number | null; canRetry: boolean } {
  switch (stage.phase) {
    case "ready":
    case "applying":
    case "applied":
      return { phase: "ready", percent: 100, canRetry: false };
    case "processing":
      return { phase: "preparing", percent: null, canRetry: false };
    case "error":
      return { phase: "failed", percent: null, canRetry: stage.canRetry !== false };
    case "detached":
      return { phase: "failed", percent: null, canRetry: true };
    case "uploading":
    case "compressing":
      return {
        phase: "uploading",
        percent: typeof stage.percent === "number" ? Math.max(0, Math.min(99, Math.round(stage.percent))) : null,
        canRetry: false,
      };
    default:
      return { phase: "uploading", percent: 0, canRetry: false };
  }
}
