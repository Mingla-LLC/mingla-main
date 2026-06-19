// ORCH-1167-R6 [event-page-canonical] — WebKit-robust muted inline cover-video
// autoplay (implementor-owned happy-path; fails-on-revert proven by true line
// deletion of the retry loop).
//
// THE BUG (proven with Playwright on the live page): on WebKit/Safari the muted
// inline cover <video> LOADS (readyState 4) but its FIRST play() promise REJECTS
// (NotAllowedError) and the element stays `paused` forever — Safari paints its
// native play-button overlay on the paused inline video. The R5 code did a single
// `video.play().catch(() => undefined)` with NO retry, so the rejection was
// swallowed and the cover never started.
//
// FAILS-ON-REVERT: this test mounts a FAKE WebKit element whose first play()
// REJECTS and which only becomes playable after a late `canplay` event. With the
// retry driver in place the element ends `paused === false`. Delete the readiness
// re-attempt + backoff in coverWebVideoAutoplay.driveMutedAutoplay (revert to a
// single swallowed attempt) and the element stays `paused === true` → the
// playing/never-pauses assertions FAIL.

import {
  driveMutedAutoplay,
  COVER_AUTOPLAY_READY_EVENTS,
  type MutedAutoplayVideoLike,
} from "../coverWebVideoAutoplay";

// A controllable fake that mimics a WebKit cover <video>: play() rejects until
// `becomePlayable()` is called (i.e. the element is truly eligible), at which
// point a subsequent play() resolves and flips `paused` to false.
function createWebKitFakeVideo() {
  const listeners = new Map<string, Set<() => void>>();
  let playable = false;
  let playCalls = 0;
  let mutedPinsBeforePlay = 0;

  const fake: MutedAutoplayVideoLike & {
    becomePlayable: () => void;
    fire: (type: string) => void;
    playCalls: () => number;
    loadCalls: () => number;
  } = {
    muted: false,
    paused: true,
    play() {
      playCalls += 1;
      if (fake.muted) mutedPinsBeforePlay += 1;
      if (!playable) {
        // WebKit NotAllowedError on the first (ineligible) attempts.
        return Promise.reject(new Error("NotAllowedError"));
      }
      fake.paused = false;
      return Promise.resolve();
    },
    load() {
      (fake as unknown as { _loadCalls: number })._loadCalls =
        ((fake as unknown as { _loadCalls?: number })._loadCalls ?? 0) + 1;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    becomePlayable() {
      playable = true;
    },
    fire(type) {
      for (const l of [...(listeners.get(type) ?? [])]) l();
    },
    playCalls() {
      return playCalls;
    },
    loadCalls() {
      return (fake as unknown as { _loadCalls?: number })._loadCalls ?? 0;
    },
  };
  // expose for the muted-pin assertion
  (fake as unknown as { mutedPinsBeforePlay: () => number }).mutedPinsBeforePlay =
    () => mutedPinsBeforePlay;
  return fake;
}

// Synchronous fake schedulers so the test drives retries deterministically
// without real timers. setTimeout returns an incrementing id; rAF fires next.
function syncSchedulers() {
  const pendingTimeouts = new Map<number, () => void>();
  let nextId = 1;
  return {
    setTimeoutFn: (cb: () => void): number => {
      const id = nextId++;
      pendingTimeouts.set(id, cb);
      return id;
    },
    clearTimeoutFn: (id: unknown): void => {
      pendingTimeouts.delete(id as number);
    },
    // requestAnimationFrame: fire immediately on a microtask-free path is fine —
    // we run it manually via flush.
    requestAnimationFrameFn: (cb: () => void): number => {
      const id = nextId++;
      pendingTimeouts.set(id, cb);
      return id;
    },
    cancelAnimationFrameFn: (id: unknown): void => {
      pendingTimeouts.delete(id as number);
    },
    // Run every currently-pending scheduled callback once (drains one wave).
    flush(): void {
      const wave = [...pendingTimeouts.entries()];
      pendingTimeouts.clear();
      for (const [, cb] of wave) cb();
    },
    pendingCount: (): number => pendingTimeouts.size,
  };
}

// Let queued promise rejection handlers run.
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ORCH-1167-R6 driveMutedAutoplay — WebKit-robust muted autoplay", () => {
  it("retries until the element actually starts (WebKit late-eligibility)", async () => {
    const video = createWebKitFakeVideo();
    const sched = syncSchedulers();

    const cleanup = driveMutedAutoplay(video, {
      setTimeoutFn: sched.setTimeoutFn,
      clearTimeoutFn: sched.clearTimeoutFn,
      requestAnimationFrameFn: sched.requestAnimationFrameFn,
      cancelAnimationFrameFn: sched.cancelAnimationFrameFn,
    });

    // First attempt happened synchronously and REJECTED (still paused).
    expect(video.playCalls()).toBeGreaterThanOrEqual(1);
    expect(video.paused).toBe(true);

    // The element becomes eligible (as WebKit fires readiness late), THEN a
    // readiness event re-drives the attempt → now play() resolves and it plays.
    await flushMicrotasks();
    video.becomePlayable();
    video.fire("canplay");

    expect(video.paused).toBe(false);
    cleanup();
  });

  it("re-pins muted=true before every play() attempt (autoplay eligibility)", async () => {
    const video = createWebKitFakeVideo();
    video.muted = false; // start UNMUTED to prove the driver forces it true
    const sched = syncSchedulers();

    const cleanup = driveMutedAutoplay(video, {
      setTimeoutFn: sched.setTimeoutFn,
      clearTimeoutFn: sched.clearTimeoutFn,
      requestAnimationFrameFn: sched.requestAnimationFrameFn,
      cancelAnimationFrameFn: sched.cancelAnimationFrameFn,
    });

    // The first synchronous attempt must have pinned muted=true before play().
    expect(video.muted).toBe(true);
    const pins = (
      video as unknown as { mutedPinsBeforePlay: () => number }
    ).mutedPinsBeforePlay();
    expect(pins).toBeGreaterThanOrEqual(1);
    cleanup();
  });

  it("calls load() once before the first attempt to nudge WebKit eligibility", () => {
    const video = createWebKitFakeVideo();
    const sched = syncSchedulers();
    const cleanup = driveMutedAutoplay(video, {
      setTimeoutFn: sched.setTimeoutFn,
      clearTimeoutFn: sched.clearTimeoutFn,
      requestAnimationFrameFn: sched.requestAnimationFrameFn,
      cancelAnimationFrameFn: sched.cancelAnimationFrameFn,
    });
    expect(video.loadCalls()).toBe(1);
    cleanup();
  });

  it("stops retrying once playing and cleans up all listeners (no leak)", async () => {
    const video = createWebKitFakeVideo();
    const sched = syncSchedulers();
    const cleanup = driveMutedAutoplay(video, {
      setTimeoutFn: sched.setTimeoutFn,
      clearTimeoutFn: sched.clearTimeoutFn,
      requestAnimationFrameFn: sched.requestAnimationFrameFn,
      cancelAnimationFrameFn: sched.cancelAnimationFrameFn,
    });

    await flushMicrotasks();
    video.becomePlayable();
    video.fire("canplay");
    expect(video.paused).toBe(false);

    const callsAfterPlaying = video.playCalls();
    // Cleanup removes all readiness listeners; further events do nothing.
    cleanup();
    for (const evt of COVER_AUTOPLAY_READY_EVENTS) video.fire(evt);
    expect(video.playCalls()).toBe(callsAfterPlaying);
  });

  it("is bounded — a permanently-ineligible element stops after maxAttempts", async () => {
    const video = createWebKitFakeVideo();
    // never becomePlayable() → every play() rejects forever.
    const sched = syncSchedulers();
    const cleanup = driveMutedAutoplay(video, {
      maxAttempts: 4,
      setTimeoutFn: sched.setTimeoutFn,
      clearTimeoutFn: sched.clearTimeoutFn,
      requestAnimationFrameFn: sched.requestAnimationFrameFn,
      cancelAnimationFrameFn: sched.cancelAnimationFrameFn,
    });

    // Drain the backoff waves; each rejected attempt schedules at most one retry.
    for (let i = 0; i < 20; i += 1) {
      await flushMicrotasks();
      if (sched.pendingCount() === 0) break;
      sched.flush();
    }
    await flushMicrotasks();

    // Bounded: it gave up — never an infinite loop. play() called a small,
    // capped number of times, and the element is still paused (correctly).
    expect(video.paused).toBe(true);
    expect(video.playCalls()).toBeLessThanOrEqual(8); // cap + sync + rAF slack
    cleanup();
  });
});
