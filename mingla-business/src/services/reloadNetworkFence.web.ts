// #2107 — web never restarts through reloadAsync, so there is nothing to fence.
// A plain pass-through keeps the fence's counter and XHR lockdown out of the
// web boot payload. Native resolves reloadNetworkFence.ts.

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createTrackedFetch(getFetch: () => FetchLike): FetchLike {
  return (input, init) => getFetch()(input, init);
}
