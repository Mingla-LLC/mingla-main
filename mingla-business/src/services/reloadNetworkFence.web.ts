// #2107 — web never restarts through reloadAsync, so there is nothing to fence.
// A plain pass-through keeps the fence's counter and XHR lockdown out of the
// web boot payload. Native resolves reloadNetworkFence.ts.

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createTrackedFetch(getFetch: () => FetchLike): FetchLike {
  return (input, init) => getFetch()(input, init);
}

// I-1378: the web shim exports everything its native twin exports. On web the
// fence never closes, nothing is ever held, and nothing is ever in flight
// through it, so each export is the value or no-op that describes that.
export const BODY_READ_GRACE_MS = 250;
export const BODY_HOLD_CEILING_MS = 1_500;

export function trackNetworkRequest<T>(start: () => Promise<T>): Promise<T> {
  return start();
}

export function inFlightNetworkRequests(): number {
  return 0;
}

export function waitForNetworkIdle(): Promise<void> {
  return Promise.resolve();
}

export function isNetworkFenceClosed(): boolean {
  return false;
}

export function closeNetworkFence(): void {
  // Web never restarts through the native reload, so there is nothing to fence.
}

export function lockDownXhrSends(_prototype: unknown): boolean {
  return false;
}

export function openNetworkFence(): void {
  // Nothing was held on web.
}

export function heldNetworkRequests(): number {
  return 0;
}

export function resetNetworkFenceForTests(): void {
  // No web state to reset.
}
