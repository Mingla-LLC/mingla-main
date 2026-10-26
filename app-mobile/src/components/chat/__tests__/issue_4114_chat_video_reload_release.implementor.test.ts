// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 4 rework — the chat video player takes part in the #2107
// restart release: it registers its expo-video player with
// registerVideoPlayerForReload(player) and never pauses a player the restart
// already released.
//
// FAILS-ON-REVERT: delete the registerVideoPlayerForReload effect or the
// released-player guard in the close cleanup of ChatVideoPlayerModal.tsx.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = Deno.readTextFileSync(new URL("../ChatVideoPlayerModal.tsx", import.meta.url));

Deno.test("#4114 chat video: the player registers for the restart release", () => {
  assert(source.includes("useVideoPlayer("), "the modal owns an expo-video player");
  assert(
    source.includes('from "@mingla/offering-rendering/videoPlayerReloadRelease"'),
    "imports the shared reload registry",
  );
  assert(
    source.includes("useEffect(() => registerVideoPlayerForReload(player), [player]);"),
    "registers the player (and unregisters on unmount via the returned cleanup)",
  );
});

Deno.test("#4114 chat video: a released player is never paused on close", () => {
  const cleanup = source.slice(source.indexOf("subscription.remove();"));
  const guard = cleanup.indexOf("if (isVideoPlayerReleasedForReload(player)) return;");
  const pause = cleanup.indexOf("player.pause()");
  assert(guard >= 0 && pause > guard, "the close cleanup checks for a released player before pausing");
});
