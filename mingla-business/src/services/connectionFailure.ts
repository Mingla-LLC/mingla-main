/**
 * connectionFailure — #4518: the ONE classifier of "this request never got an
 * answer" for buyer pages and checkout.
 *
 * A connection failure is a request the server never answered: a thrown fetch
 * (`TypeError: Failed to fetch`), an abort or time-out, the edge-function lane's
 * `FunctionsFetchError`, or a PostgREST-shaped error with no code (supabase-js
 * reports a thrown fetch as `{ code: "", message: "TypeError: ..." }`).
 *
 * An HTTP answer from the server (any status, any code) is NEVER a connection
 * failure: the server was reached and said something of its own.
 *
 * Zero imports on purpose: it sits on the buyer boot path.
 */

const CONNECTION_ERROR_NAMES: ReadonlySet<string> = new Set([
  "AbortError",
  "TimeoutError",
  "FunctionsFetchError",
]);

const FETCH_TYPE_ERROR = /failed to fetch|load failed|networkerror|network request failed/i;
/**
 * An Error re-thrown with a transport message and no HTTP status: the
 * checkout service wraps the edge lane's "Failed to send a request to the
 * Edge Function" (and its own time limit) this way, keeping the message.
 */
const TRANSPORT_MESSAGE =
  /failed to fetch|load failed|networkerror|network request failed|failed to send a request to the edge function|checkout_request_timed_out/i;

const readString = (value: unknown, key: string): string | null | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return typeof raw === "string" ? raw : String(raw);
};

export const isConnectionFailure = (error: unknown): boolean => {
  if (error === null || error === undefined) return false;
  if (typeof error !== "object") return false;
  // fetch() rejects with a TypeError when the request never got an answer
  // (Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError
  // when attempting to fetch resource.", React Native "Network request
  // failed"). A TypeError from a program bug is NOT a connection failure.
  if (error instanceof TypeError) return FETCH_TYPE_ERROR.test(error.message);
  const name = readString(error, "name");
  if (typeof name === "string" && CONNECTION_ERROR_NAMES.has(name)) return true;
  // An HTTP response object (or an error carrying one) is the server's answer.
  const status = (error as Record<string, unknown>).status;
  if (typeof status === "number" && status > 0) return false;
  // An Error carries a transport message, or it is a program error.
  if (error instanceof Error) return TRANSPORT_MESSAGE.test(error.message);
  // PostgREST-shaped `{ code, message }` with no code: transport failure.
  if (!("message" in error) && !("code" in error)) return false;
  const code = readString(error, "code");
  return code === undefined || code === null || code === "";
};
