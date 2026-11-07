/**
 * #4304 — media speed (D), native. A first-frame still for the sender's own
 * just-sent video, made on the device with expo-video's thumbnail API, so the
 * bubble has a poster before Google Drive makes one. Never blocks the upload:
 * the caller fires it and forgets; a failure just leaves the play-icon tile.
 * expo-video is resolved at use (no module-scope expo import). The short-lived
 * player is registered for the #2107 restart release and released here.
 */
import {
  isVideoPlayerReleasedForReload,
  registerVideoPlayerForReload,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";

type PosterPlayer = {
  status: string;
  addListener: (event: "statusChange", listener: (payload: { status: string }) => void) => { remove: () => void };
};

function waitUntilReady(player: PosterPlayer, timeoutMs: number): Promise<void> {
  if (player.status === "readyToPlay") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error("video_poster_timeout"));
    }, timeoutMs);
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      } else if (status === "error") {
        clearTimeout(timer);
        subscription.remove();
        reject(new Error("video_poster_unreadable"));
      }
    });
  });
}

export async function generateBrandGroupVideoPoster(uri: string): Promise<object | null> {
  const { createVideoPlayer } = await import("expo-video");
  const player = createVideoPlayer({ uri });
  const unregister = registerVideoPlayerForReload(player);
  try {
    // Asking before the clip has loaded returns an empty list on iOS, so wait
    // for readyToPlay first (bounded: a poster must never hang around).
    await waitUntilReady(player as unknown as PosterPlayer, 5000);
    const [poster] = await player.generateThumbnailsAsync([0], { maxWidth: 640, maxHeight: 640 });
    return poster ?? null;
  } finally {
    unregister();
    if (!isVideoPlayerReleasedForReload(player)) {
      try {
        player.release();
      } catch {
        // Already released by the runtime.
      }
    }
  }
}
