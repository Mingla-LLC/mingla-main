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

export async function generateBrandGroupVideoPoster(uri: string): Promise<object | null> {
  const { createVideoPlayer } = await import("expo-video");
  const player = createVideoPlayer({ uri });
  const unregister = registerVideoPlayerForReload(player);
  try {
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
