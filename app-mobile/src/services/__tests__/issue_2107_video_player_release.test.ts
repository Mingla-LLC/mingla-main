// #2107 — an in-app restart releases every live video player first.
//
// Updates.reloadAsync() can crash iOS with a use-after-free in expo-modules-core
// SharedObjectRegistry.clear() -> -[EXJavaScriptWeakObject .cxx_destruct]: an
// expo-video player (a shared object) is still registered when the runtime is
// torn down, because React unmount cleanup never runs on a reload. So the
// safeReload pause list has a video_players step that pauses and releases every
// registered player while the runtime is alive, then yields so the native
// registry delete lands before reloadAsync.
//
// MINGLA-INVARIANT: I-2107-RELEASE-VIDEO-BEFORE-RELOAD | issue #2107 | Every in-app restart pauses and releases every mounted expo-video player (best-effort, each guarded) before reloadAsync, and a released player is never called again.
//
// The component half (owners register, never touch a released player, keep the
// poster) is proven by the render suites named in the #2107 issue comment.

import { createSafeReload } from "../safeReload";
import { resetNetworkFenceForTests } from "../reloadNetworkFence";
import {
  isVideoPlayerReleasedForReload,
  liveVideoPlayerCountForReload,
  registerVideoPlayerForReload,
  resetVideoPlayerReloadRegistryForTests,
  VIDEO_PLAYER_RELEASE_YIELD_MS,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";

const mockRealtime = { removeAllChannels: jest.fn(async (): Promise<unknown[]> => []) };
const mockPostHog = { flush: jest.fn(async (): Promise<void> => undefined) };

jest.mock("../../config/queryClient", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { QueryClient } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("../supabase", () => ({ supabase: mockRealtime }));
jest.mock("../postHogService", () => ({
  postHogService: { getClient: () => mockPostHog },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSafeReloadDependencies } = require("../safeReloadRuntime") as typeof import("../safeReloadRuntime");

type Call = string;

/** A stand-in expo-video player that records every call into one shared log. */
function fakePlayer(name: string, log: Call[], options?: { releaseThrows?: boolean; pauseThrows?: boolean }) {
  return {
    pause: jest.fn(() => {
      log.push(`${name}.pause`);
      if (options?.pauseThrows) throw new Error(`${name} pause boom`);
    }),
    release: jest.fn(() => {
      log.push(`${name}.release`);
      if (options?.releaseThrows) throw new Error(`${name} release boom`);
    }),
  };
}

function restart(log: Call[], reload?: () => Promise<void>) {
  const warnings: string[] = [];
  const dependencies = {
    ...buildSafeReloadDependencies(
      reload ??
        (async () => {
          log.push("reload");
        }),
    ),
    restoreAfterMs: 0,
    warn: (message: string) => warnings.push(message),
  };
  return { safeReload: createSafeReload(dependencies), warnings };
}

beforeEach(() => {
  resetVideoPlayerReloadRegistryForTests();
  resetNetworkFenceForTests();
});

afterEach(async () => {
  // Let the 0 ms restore timer reopen the network before the next case.
  await new Promise((resolve) => setTimeout(resolve, 10));
  resetNetworkFenceForTests();
});

describe("#2107 safeReload — video players are released before the restart", () => {
  it("happy: every registered player is paused then released before reloadAsync", async () => {
    const log: Call[] = [];
    const a = fakePlayer("a", log);
    const b = fakePlayer("b", log);
    registerVideoPlayerForReload(a);
    registerVideoPlayerForReload(b);
    let releasedAtReload: boolean[] = [];
    const { safeReload } = restart(log, async () => {
      releasedAtReload = [isVideoPlayerReleasedForReload(a), isVideoPlayerReleasedForReload(b)];
      log.push("reload");
    });

    await safeReload();

    expect(log).toEqual(["a.pause", "a.release", "b.pause", "b.release", "reload"]);
    expect(releasedAtReload).toEqual([true, true]);
    expect(liveVideoPlayerCountForReload()).toBe(0);
  });

  it("happy: the step yields so the native registry delete lands before reloadAsync", async () => {
    const log: Call[] = [];
    let releasedAt = 0;
    registerVideoPlayerForReload({
      pause: () => undefined,
      release: () => {
        releasedAt = Date.now();
      },
    });
    let reloadAt = 0;
    const { safeReload } = restart(log, async () => {
      reloadAt = Date.now();
    });

    await safeReload();

    expect(releasedAt).toBeGreaterThan(0);
    // Allow a little timer slack below the nominal yield.
    expect(reloadAt - releasedAt).toBeGreaterThanOrEqual(VIDEO_PLAYER_RELEASE_YIELD_MS - 10);
  });

  it("adversarial: release() throws -> the other players are still released and the reload still happens", async () => {
    const log: Call[] = [];
    const broken = fakePlayer("broken", log, { releaseThrows: true, pauseThrows: true });
    const fine = fakePlayer("fine", log);
    registerVideoPlayerForReload(broken);
    registerVideoPlayerForReload(fine);
    const { safeReload } = restart(log);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    let messages: string[] = [];
    try {
      await safeReload();
      messages = warn.mock.calls.map((args) => String(args[0]));
    } finally {
      warn.mockRestore();
    }

    expect(log).toEqual(["broken.pause", "broken.release", "fine.pause", "fine.release", "reload"]);
    // A player whose release threw is still never touched again.
    expect(isVideoPlayerReleasedForReload(broken)).toBe(true);
    // Each failure is reported, never swallowed silently.
    expect(messages.some((message) => message.includes("broken release boom"))).toBe(true);
    expect(messages.some((message) => message.includes("broken pause boom"))).toBe(true);
  });

  it("adversarial: a player unregistered on unmount is never released by the restart (no double release)", async () => {
    const log: Call[] = [];
    const unmounted = fakePlayer("unmounted", log);
    const unregister = registerVideoPlayerForReload(unmounted);
    unregister(); // the owner unmounted; expo-video already released it

    const { safeReload } = restart(log);
    await safeReload();

    expect(unmounted.pause).not.toHaveBeenCalled();
    expect(unmounted.release).not.toHaveBeenCalled();
    expect(log).toEqual(["reload"]);
  });

  it("adversarial: a second restart after a failed one does not release the same player again", async () => {
    const log: Call[] = [];
    const player = fakePlayer("p", log);
    const unregister = registerVideoPlayerForReload(player);
    let attempts = 0;
    const { safeReload } = restart(log, async () => {
      attempts += 1;
      log.push(`reload#${attempts}`);
      if (attempts === 1) throw new Error("restart did not happen");
    });

    await expect(safeReload()).rejects.toThrow("restart did not happen");
    // Re-registering a released player (e.g. an effect re-run) is refused.
    registerVideoPlayerForReload(player);
    await safeReload();
    unregister(); // the late unmount is harmless

    expect(player.release).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["p.pause", "p.release", "reload#1", "reload#2"]);
  });

  it("no players registered -> no yield, no calls, the restart is not delayed", async () => {
    const log: Call[] = [];
    const { safeReload } = restart(log);
    const started = Date.now();
    await safeReload();
    expect(log).toEqual(["reload"]);
    expect(Date.now() - started).toBeLessThan(VIDEO_PLAYER_RELEASE_YIELD_MS);
  });
});

describe("#2107 every expo-video player owner registers for the restart release", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const repoRoot = path.resolve(__dirname, "../../../..");
  const roots = ["app-mobile/src", "app-mobile/app", "mingla-business/src", "mingla-business/app", "packages"];

  function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
    }
  }

  const owners = (() => {
    const files: string[] = [];
    for (const root of roots) walk(path.join(repoRoot, root), files);
    return files
      .filter((file) => /\b(useVideoPlayer|createVideoPlayer)\(/.test(fs.readFileSync(file, "utf8")))
      // A web build never calls reloadAsync, so web-only players are exempt.
      .filter((file) => !/\.web\.tsx?$/.test(file))
      .map((file) => path.relative(repoRoot, file))
      .sort();
  })();

  it("finds the known owners (so the scan itself is not empty)", () => {
    expect(owners).toEqual(
      expect.arrayContaining([
        "app-mobile/src/components/signIn/WelcomeVideoBackground.tsx",
        "mingla-business/src/components/auth/WelcomeVideoBackground.native.tsx",
        "mingla-business/src/components/messages/BrandGroupFilePreviewModal.tsx",
        "mingla-business/src/components/support/GuidePlayerModal.tsx",
        "mingla-business/src/components/ui/FullScreenVideoViewer.tsx",
        "packages/offering-rendering/EventCoverMedia.tsx",
      ]),
    );
  });

  it("every native player owner registers its player with the restart release", () => {
    const unregistered = owners.filter(
      (file) => !fs.readFileSync(path.join(repoRoot, file), "utf8").includes("registerVideoPlayerForReload(player)"),
    );
    expect(unregistered).toEqual([]);
  });

  it("the shared event cover never hands a released player to a VideoView", () => {
    const cover = fs.readFileSync(path.join(repoRoot, "packages/offering-rendering/EventCoverMedia.tsx"), "utf8");
    expect(cover).toContain("{!isVideoPlayerReleasedForReload(player) ? (\n        <VideoView");
    // Every effect / listener that calls the player checks first.
    expect((cover.match(/isVideoPlayerReleasedForReload\(player\)/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
});
