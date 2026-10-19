// #2107 — the network fence a restart closes before it calls reloadAsync.
//
// Two layers, both closed only by safeReload and reopened only if the restart
// did not happen:
//
//   * The APP fence wraps the Supabase client's fetch. It counts requests that
//     are on the wire (so safeReload can let a write the person just made
//     finish) and, while closed, HOLDS new ones instead of sending them. A held
//     request is sent normally if the fence reopens; if the restart happens, the
//     process ends and it never leaves. Nothing is rejected, so no caller sees a
//     spurious error.
//   * The XHR LOCKDOWN patches XMLHttpRequest.prototype.send for the last
//     moments before the restart. React Native's fetch is whatwg-fetch on top of
//     XMLHttpRequest, so this holds every remaining JS-initiated HTTP send —
//     analytics, direct fetch() calls, anything outside the Supabase client.
//     It is installed only while a restart is in progress and removed on
//     restore; it is never active during normal use.
//
// The in-flight count is EXACT for the Supabase client (every request it makes
// goes through createTrackedFetch). It does not see requests made outside the
// Supabase client that were already on the wire when the fence closed; those
// are covered only by the settle cap, not by the count.
//
// Byte-identical in app-mobile and mingla-business. Imports nothing.

type Held = () => void;

let inFlight = 0;
let fenceClosed = false;
let lockdownActive = false;
let held: Held[] = [];
let idleWaiters: Array<() => void> = [];
let restoreXhr: (() => void) | null = null;

function notifyIfIdle(): void {
  if (inFlight !== 0) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
}

function finished(): void {
  inFlight = Math.max(0, inFlight - 1);
  notifyIfIdle();
}

/**
 * Starts `start` now, or holds it until the fence reopens. Counts it while it
 * is on the wire. Never rejects on its own: the caller's own error is
 * propagated unchanged.
 */
export function trackNetworkRequest<T>(start: () => Promise<T>): Promise<T> {
  if (fenceClosed) {
    return new Promise<void>((resolve) => {
      held.push(resolve);
    }).then(() => trackNetworkRequest(start));
  }
  inFlight += 1;
  let request: Promise<T>;
  try {
    request = start();
  } catch (error: unknown) {
    finished();
    return Promise.reject(error);
  }
  return Promise.resolve(request).then(
    (value) => {
      finished();
      return value;
    },
    (error: unknown) => {
      finished();
      throw error;
    },
  );
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A fetch for the Supabase client's `global.fetch`. `getFetch` is read at call
 * time, exactly like supabase-js's own default.
 */
export function createTrackedFetch(getFetch: () => FetchLike): FetchLike {
  return (input, init) => trackNetworkRequest(() => getFetch()(input, init));
}

export function inFlightNetworkRequests(): number {
  return inFlight;
}

/** Resolves as soon as no tracked request is on the wire. */
export function waitForNetworkIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
}

export function isNetworkFenceClosed(): boolean {
  return fenceClosed;
}

export function closeNetworkFence(): void {
  fenceClosed = true;
}

interface XhrPrototypeLike {
  send: (...args: unknown[]) => unknown;
}

/**
 * Holds every new XMLHttpRequest send until openNetworkFence(). Returns false
 * when there is no XMLHttpRequest to hold (web SSR, tests without one).
 */
export function lockDownXhrSends(prototype: XhrPrototypeLike | null | undefined): boolean {
  if (prototype === null || prototype === undefined || typeof prototype.send !== "function") {
    return false;
  }
  if (lockdownActive) return true;
  const originalSend = prototype.send;
  lockdownActive = true;
  prototype.send = function heldSend(this: unknown, ...args: unknown[]): unknown {
    if (!lockdownActive) return originalSend.apply(this, args);
    held.push(() => {
      try {
        originalSend.apply(this, args);
      } catch (error: unknown) {
        console.warn(
          `[OTA] held request could not be sent after restore: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
    return undefined;
  };
  restoreXhr = () => {
    prototype.send = originalSend;
  };
  return true;
}

/** Removes the lockdown, reopens the fence and sends everything held, in order. */
export function openNetworkFence(): void {
  fenceClosed = false;
  lockdownActive = false;
  if (restoreXhr !== null) {
    const restore = restoreXhr;
    restoreXhr = null;
    restore();
  }
  const release = held;
  held = [];
  for (const send of release) send();
}

export function heldNetworkRequests(): number {
  return held.length;
}

/** Test-only reset of module state. */
export function resetNetworkFenceForTests(): void {
  openNetworkFence();
  inFlight = 0;
  idleWaiters = [];
}
