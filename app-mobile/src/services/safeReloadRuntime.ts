// #2107 — this app's wiring for the pure safeReload core.
//
// The ONLY reloadAsync call in this app lives in otaUpdateRuntime.ts and goes
// through runSafeReload() below. Both the optional "tap to refresh" banner
// (useOtaUpdates) and the critical-update restart (otaUpdatePolicy via the
// bridge) reach it that way; .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs
// fails the build if any other file calls reloadAsync or bypasses this.
//
// Every app module below is required LAZILY, inside the step that uses it, so
// importing this file pulls nothing new into boot and a module that fails to
// load only skips its own step.

import {
  createSafeReload,
  type SafeReloadDependencies,
  type SafeReloadStep,
} from "./safeReload";
import {
  closeNetworkFence,
  lockDownXhrSends,
  openNetworkFence,
  waitForNetworkIdle,
} from "./reloadNetworkFence";

type OnlineManagerLike = {
  isOnline: () => boolean;
  setOnline: (online: boolean) => void;
};
type QueryClientLike = { cancelQueries: () => Promise<void> };
type SupabaseLike = { removeAllChannels: () => Promise<unknown> };
type PostHogClientLike = { flush?: () => Promise<unknown> | void };

function appFenceStep(): SafeReloadStep {
  return {
    name: "app_network_fence",
    pause: () => closeNetworkFence(),
    resume: () => openNetworkFence(),
  };
}

function reactQueryStep(): SafeReloadStep {
  let wasOnline: boolean | null = null;
  return {
    name: "react_query",
    pause: async () => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { onlineManager } = require("@tanstack/react-query") as {
        onlineManager: OnlineManagerLike;
      };
      const { queryClient } = require("../config/queryClient") as {
        queryClient: QueryClientLike;
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
      wasOnline = onlineManager.isOnline();
      // Offline pauses new query fetches and keeps mutations from starting
      // (networkMode "online"). A mutation already on the wire is not touched:
      // the settle step lets it finish.
      onlineManager.setOnline(false);
      await queryClient.cancelQueries();
    },
    resume: () => {
      if (wasOnline === null) return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { onlineManager } = require("@tanstack/react-query") as {
        onlineManager: OnlineManagerLike;
      };
      // Going online again resumes paused mutations and refetches paused
      // queries on React Query's own path. NetInfo keeps it honest afterwards.
      onlineManager.setOnline(wasOnline);
    },
  };
}

function realtimeStep(): SafeReloadStep {
  return {
    name: "realtime",
    // Removed, not disconnected: disconnect()+connect() strips channel bindings
    // (I-RT-BIND-01). If the restart does not happen, channels come back on
    // their normal path: a screen re-creates its channel when it next mounts,
    // and Explorer also remounts RealtimeSubscriptions on realtimeEpoch after
    // a long background. A websocket is not RCTNetworking, so this step is
    // about the HTTP work realtime handlers would otherwise trigger.
    pause: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { supabase } = require("./supabase") as { supabase: SupabaseLike };
      await supabase.removeAllChannels();
    },
  };
}

function xhrLockdownStep(): SafeReloadStep {
  return {
    name: "xhr_lockdown",
    pause: () => {
      const xhr = (globalThis as { XMLHttpRequest?: { prototype?: { send: (...args: unknown[]) => unknown } } })
        .XMLHttpRequest;
      lockDownXhrSends(xhr?.prototype);
    },
    resume: () => openNetworkFence(),
  };
}

export function buildSafeReloadDependencies(
  reload: () => Promise<void>,
): SafeReloadDependencies {
  return {
    pause: [appFenceStep(), reactQueryStep(), realtimeStep()],
    flush: [
      {
        name: "posthog",
        run: async () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { postHogService } = require("./postHogService") as {
            postHogService: { getClient: () => PostHogClientLike | null };
          };
          await postHogService.getClient()?.flush?.();
        },
      },
    ],
    lockdown: [xhrLockdownStep()],
    // After the last request (and its body read) finishes, yield one macrotask
    // so the native callbacks that delivered it unwind before the restart.
    // Still inside the settle cap, so it can never hold the reload.
    settle: async () => {
      await waitForNetworkIdle();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
    reload,
  };
}

let safeReloadImpl: (() => Promise<void>) | null = null;
let nativeReload: (() => Promise<void>) | null = null;

/**
 * The one way this app restarts itself. `reload` is the bare native restart;
 * it is called only after the pause, flush, lockdown and settle steps.
 */
export function runSafeReload(reload: () => Promise<void>): Promise<void> {
  nativeReload = reload;
  if (safeReloadImpl === null) {
    safeReloadImpl = createSafeReload(
      buildSafeReloadDependencies(async () => {
        if (nativeReload !== null) await nativeReload();
      }),
    );
  }
  return safeReloadImpl();
}
