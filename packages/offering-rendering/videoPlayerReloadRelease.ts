// #2107 — release every live expo-video player before an in-app restart.
//
// WHY: Updates.reloadAsync() can crash iOS with a use-after-free in
// expo-modules-core's SharedObjectRegistry.clear() -> -[EXJavaScriptWeakObject
// .cxx_destruct]. A video player is a shared object; when one is still
// registered at teardown, its registry entry is freed off the JS thread after
// the runtime is gone. React unmount cleanup (where expo-video releases the
// player) never runs on a reload, so nothing removes the entry in time.
//
// So every component that owns a player registers it here while mounted, and
// the app's safeReload pause step calls releaseVideoPlayersForReload() while the
// runtime is still alive: each player is paused and released (its registry
// entry deleted), best-effort, then we yield briefly so the native delete lands
// before reloadAsync.
//
// After a release the player must never be touched again. If the restart does
// not happen, the owning component keeps its poster / still frame: it checks
// isVideoPlayerReleasedForReload() before every play / pause / replace / setter
// and before rendering a VideoView.
//
// This module imports nothing: it is safe in every bundle, including web, and
// it is shared by both apps and @mingla/offering-rendering. State lives on
// globalThis so a second module instance (never expected) still shares one
// registry.

/** The two player methods the release step needs. expo-video's VideoPlayer has both. */
export interface ReloadReleasableVideoPlayer {
  pause(): void;
  release(): void;
}

/** How long the release step waits after releasing, so the native delete lands. */
export const VIDEO_PLAYER_RELEASE_YIELD_MS = 50;

interface VideoPlayerReloadRegistry {
  live: Set<ReloadReleasableVideoPlayer>;
  released: WeakSet<ReloadReleasableVideoPlayer>;
}

const REGISTRY_KEY = "__minglaVideoPlayerReloadRegistry__";

function registry(): VideoPlayerReloadRegistry {
  const holder = globalThis as unknown as Record<string, VideoPlayerReloadRegistry | undefined>;
  let current = holder[REGISTRY_KEY];
  if (current === undefined) {
    current = { live: new Set(), released: new WeakSet() };
    holder[REGISTRY_KEY] = current;
  }
  return current;
}

/**
 * Registers a mounted player so a restart releases it first. Returns the
 * unregister function: call it on unmount (expo-video releases the player
 * itself then). A player already released for a restart is never re-added.
 */
export function registerVideoPlayerForReload(
  player: ReloadReleasableVideoPlayer | null | undefined,
): () => void {
  if (player === null || player === undefined) return () => undefined;
  const state = registry();
  if (state.released.has(player)) return () => undefined;
  state.live.add(player);
  return () => {
    state.live.delete(player);
  };
}

/** True once a restart has released this player. Never call its methods then. */
export function isVideoPlayerReleasedForReload(
  player: ReloadReleasableVideoPlayer | null | undefined,
): boolean {
  if (player === null || player === undefined) return false;
  return registry().released.has(player);
}

/** How many players are registered right now. Diagnostic and tests only. */
export function liveVideoPlayerCountForReload(): number {
  return registry().live.size;
}

/**
 * Pauses and releases every registered player, each in its own try/catch, then
 * yields `yieldMs` so the native registry deletes land while the runtime is
 * alive. Never rejects. Resolves with how many players were released.
 *
 * Written without async/await and without spread on purpose: then no Babel
 * runtime helper is injected, so this file loads from the shared package in
 * every app's bundle and test runner alike.
 */
export function releaseVideoPlayersForReload(options?: {
  yieldMs?: number;
  warn?: (message: string) => void;
}): Promise<number> {
  const state = registry();
  const warn = options?.warn ?? ((message: string) => console.warn(message));
  const players = Array.from(state.live);
  state.live.clear();
  let released = 0;
  for (const player of players) {
    // Marked first: whatever happens below, no owner may touch it again.
    state.released.add(player);
    try {
      player.pause();
    } catch (error: unknown) {
      warn(`[OTA] video player pause before restart failed: ${describe(error)}`);
    }
    try {
      player.release();
      released += 1;
    } catch (error: unknown) {
      warn(`[OTA] video player release before restart failed: ${describe(error)}`);
    }
  }
  if (players.length === 0) return Promise.resolve(released);
  const yieldMs = options?.yieldMs ?? VIDEO_PLAYER_RELEASE_YIELD_MS;
  return new Promise<number>((resolve) => {
    setTimeout(() => resolve(released), yieldMs);
  });
}

/** Test-only: forget every registered and released player. */
export function resetVideoPlayerReloadRegistryForTests(): void {
  const holder = globalThis as unknown as Record<string, VideoPlayerReloadRegistry | undefined>;
  holder[REGISTRY_KEY] = undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
