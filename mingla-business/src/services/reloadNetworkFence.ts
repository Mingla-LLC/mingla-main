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
// A request stays counted until its RESPONSE BODY is read, not just until its
// fetch promise resolves. Reading the body (`text()` / `json()`) is still
// native network work: on iOS it goes through RCTFileReaderModule readAsText,
// and a restart that tears the bridge down mid-read crashes there. So a
// resolved Response keeps its slot while any body read is running, and gives
// it up when the read settles (success or throw). A body nobody reads gives
// the slot up after BODY_READ_GRACE_MS, and no body hold outlives
// BODY_HOLD_CEILING_MS, so a forgotten or hung read never blocks a restart
// (the settle cap bounds it anyway).
//
// Byte-identical in app-mobile and mingla-business. Imports nothing.

type Held = () => void;

/** A resolved Response nobody starts reading gives its slot up after this. */
export const BODY_READ_GRACE_MS = 250;
/** No body hold outlives this, read or not. Matches the settle cap. */
export const BODY_HOLD_CEILING_MS = 1_500;

const BODY_READERS = ["json", "text", "arrayBuffer", "blob", "formData"] as const;

let inFlight = 0;
let fenceClosed = false;
let lockdownActive = false;
let held: Held[] = [];
let idleWaiters: Array<() => void> = [];
let restoreXhr: (() => void) | null = null;
// Bumped by the test reset so a body hold from before it never touches the count.
let generation = 0;

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

type BodyReader = (...args: unknown[]) => unknown;

function isResponseLike(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.text === "function" || typeof candidate.json === "function";
}

/**
 * Keeps one in-flight slot for `response` until its body is read (or the read
 * throws), or until nobody has started reading it after BODY_READ_GRACE_MS,
 * capped at BODY_HOLD_CEILING_MS. Best-effort: if the body readers cannot be
 * wrapped, the slot is still released by the timers. Never changes what a
 * reader returns or throws.
 */
function holdUntilBodyRead(response: Record<string, unknown>): void {
  inFlight += 1;
  const heldIn = generation;
  let released = false;
  let reading = 0;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null;
  const release = (): void => {
    if (released) return;
    released = true;
    if (graceTimer !== null) clearTimeout(graceTimer);
    if (ceilingTimer !== null) clearTimeout(ceilingTimer);
    if (heldIn === generation) finished();
  };
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (reading === 0) release();
  }, BODY_READ_GRACE_MS);
  ceilingTimer = setTimeout(release, BODY_HOLD_CEILING_MS);
  for (const name of BODY_READERS) {
    const original = response[name];
    if (typeof original !== "function") continue;
    const reader = original as BodyReader;
    try {
      response[name] = function trackedBodyRead(this: unknown, ...args: unknown[]): unknown {
        reading += 1;
        const done = (): void => {
          reading -= 1;
          release();
        };
        let result: unknown;
        try {
          result = reader.apply(this === undefined ? response : this, args);
        } catch (error: unknown) {
          done();
          throw error;
        }
        Promise.resolve(result).then(done, done);
        return result;
      };
    } catch {
      // A frozen Response cannot be wrapped; the timers still release the slot.
    }
  }
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
      // Take the body slot BEFORE giving up the request slot, so the count
      // never touches zero between "headers arrived" and "body read".
      if (isResponseLike(value)) holdUntilBodyRead(value);
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
  generation += 1;
  inFlight = 0;
  idleWaiters = [];
}
