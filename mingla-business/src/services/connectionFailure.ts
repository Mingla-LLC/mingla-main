/**
 * connectionFailure — #4518: the ONE classifier of "this request never got an
 * answer" for buyer pages and checkout. Zero imports: it is on the boot path.
 *
 * YES: a fetch TypeError ("Failed to fetch", Safari "Load failed", Firefox
 * "NetworkError…", RN "Network request failed"); an AbortError / TimeoutError
 * / the edge lane's FunctionsFetchError; an Error the checkout service
 * re-threw with a transport message ("Failed to send a request to the Edge
 * Function", its own `checkout_request_timed_out`); a PostgREST-shaped object
 * with no code (supabase-js reports a thrown fetch as `{ code: "" }`).
 * NO: anything with an HTTP status (the server answered), a program error
 * (any other TypeError / Error), a server code.
 */
const TRANSPORT =
  /failed to fetch|load failed|networkerror|network request failed|failed to send a request|request_timed_out/i;

export const isConnectionFailure = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown; code?: unknown };
  if (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "FunctionsFetchError") {
    return true;
  }
  if (typeof e.status === "number" && e.status > 0) return false;
  if (error instanceof Error) return TRANSPORT.test(error.message);
  return ("message" in e || "code" in e) && (e.code == null || e.code === "");
};
