/**
 * storageUploadWithRetry — issue #3318.
 *
 * A Supabase Storage upload had no deadline of its own. On 2026-09-14 a photo
 * added under Additional photos never reached the server; the request sat
 * until the platform's default timeout (~60 s on iOS), then failed once and
 * for good, and the picked photo was thrown away.
 *
 * This bounds each attempt and retries ONCE when the failure is the network's,
 * not the server's:
 *
 *   - storage-js 2.103 `upload()` takes no AbortSignal, so each attempt is
 *     RACED against a timeout. The losing request may still be running.
 *   - The retry uses the SAME storage path. Callers generate a random path per
 *     upload and pass `upsert: true`, so a first attempt that lands late is
 *     overwritten with identical bytes. Nothing else can live at that path, and
 *     no second orphan object is created.
 *   - Only a timeout or a no-HTTP-response error (`StorageUnknownError`, which
 *     storage-js raises when `fetch` itself rejects) is retried. An HTTP error
 *     from the storage API (policy, size, auth) is an answer, not a stall, and
 *     retrying it would only double the wait.
 *
 * No React Native imports: this runs under jest as-is.
 */

/**
 * Where a cover-media upload is: reading the local file, sending it to storage,
 * or verifying the public URL serves it. Reported through an optional `onStage`
 * callback so a caller can say which step failed.
 */
export type CoverUploadStage = "read" | "upload" | "verify";

/**
 * Attaches the underlying failure to a service's own error, so a caller that
 * needs to know it was the network (the gallery's copy and telemetry) can,
 * while callers that only read `code` and `message` see nothing new. (The
 * services inline the same one-liner so this module stays out of the boot
 * chunk; this export is for callers and tests.)
 */
export const withStorageCause = <E extends Error>(error: E, cause: unknown): E => {
  (error as E & { cause?: unknown }).cause = cause;
  return error;
};

/**
 * What an upload service accepts to run its storage call: the single attempt
 * (to one fixed path) and the byte count. `createStorageUploadWithRetry()`
 * builds the bounded, retrying one.
 */
export type StorageUploadRunner = (
  attempt: () => Promise<StorageUploadResult>,
  byteLength: number,
) => Promise<void>;

/** The `{ error }` half of a storage-js `upload()` result. */
export type StorageUploadResult = {
  error: { message: string; name?: string } | null;
};

/** Raised when an attempt does not settle before its deadline. */
export class StorageUploadTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Storage upload did not finish within ${Math.round(timeoutMs / 1000)} s.`);
    this.name = "StorageUploadTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Raised when the upload failed. `retryable` says whether the LAST failure was
 * the network's; `timedOut` whether it was specifically a deadline.
 */
export class StorageUploadError extends Error {
  readonly retryable: boolean;
  readonly timedOut: boolean;
  readonly attempts: number;

  constructor(message: string, retryable: boolean, timedOut: boolean, attempts: number) {
    super(message);
    this.name = "StorageUploadError";
    this.retryable = retryable;
    this.timedOut = timedOut;
    this.attempts = attempts;
  }
}

const ONE_MB = 1_000_000;
export const STORAGE_UPLOAD_MIN_TIMEOUT_MS = 20_000;
export const STORAGE_UPLOAD_MAX_TIMEOUT_MS = 90_000;
const STORAGE_UPLOAD_MS_PER_MB = 2_000;

/**
 * The deadline for ONE attempt: 20 s plus 2 s per MB, clamped to 20–90 s. A
 * 3 MB photo gets 26 s; the 30 MB event-cover maximum gets 80 s.
 */
export const storageUploadTimeoutMs = (byteLength: number | null | undefined): number => {
  const bytes = typeof byteLength === "number" && Number.isFinite(byteLength) && byteLength > 0
    ? byteLength
    : 0;
  const scaled = STORAGE_UPLOAD_MIN_TIMEOUT_MS + Math.ceil(bytes / ONE_MB) * STORAGE_UPLOAD_MS_PER_MB;
  return Math.min(STORAGE_UPLOAD_MAX_TIMEOUT_MS, Math.max(STORAGE_UPLOAD_MIN_TIMEOUT_MS, scaled));
};

/** True when the failure is the network's: a timeout, or no HTTP response at all. */
export const isRetryableStorageFailure = (failure: unknown): boolean => {
  if (failure instanceof StorageUploadTimeoutError) return true;
  if (failure === null || typeof failure !== "object") return false;
  return (failure as { name?: unknown }).name === "StorageUnknownError";
};

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const withTimeout = <T,>(work: Promise<T>, timeoutMs: number, timers: Timers): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const handle = timers.setTimeout(() => reject(new StorageUploadTimeoutError(timeoutMs)), timeoutMs);
    work.then(
      (value) => {
        timers.clearTimeout(handle);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(handle);
        reject(error);
      },
    );
  });

export type UploadToStorageWithRetryOptions = {
  /** One upload attempt to the SAME path. Called once, or twice on a network failure. */
  attempt: () => Promise<StorageUploadResult>;
  timeoutMs: number;
  /** Automatic retries after the first attempt. Default 1. */
  retries?: number;
  /** Test seam. */
  timers?: Timers;
};

/**
 * The runner an upload service takes as `uploadWithRetry`: a size-scaled
 * deadline per attempt and one retry on a network failure.
 *
 * Opt-in per caller, deliberately. The upload services sit in business-web's
 * eager `__common` chunk (ORCH-1083 boot budget); a static import from them
 * would put this module in the boot payload. Callers that opt in (the Cover
 * sheet's Additional photos path) import it from their own lazy chunk.
 */
export const createStorageUploadWithRetry = (
  options: Pick<UploadToStorageWithRetryOptions, "retries" | "timers"> = {},
): StorageUploadRunner =>
  (attempt, byteLength) =>
    uploadToStorageWithRetry({ ...options, attempt, timeoutMs: storageUploadTimeoutMs(byteLength) });

/**
 * Runs `attempt` with a deadline, retrying on a network failure. Resolves when
 * an attempt reports no error; rejects with `StorageUploadError` otherwise.
 */
export const uploadToStorageWithRetry = async ({
  attempt,
  timeoutMs,
  retries = 1,
  timers = defaultTimers,
}: UploadToStorageWithRetryOptions): Promise<void> => {
  const maxAttempts = 1 + Math.max(0, retries);
  let lastMessage = "Storage upload failed.";
  let lastRetryable = false;
  let lastTimedOut = false;
  let attemptsMade = 0;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    attemptsMade = attemptNumber;
    let failure: unknown;
    try {
      const { error } = await withTimeout(attempt(), timeoutMs, timers);
      if (error === null) return;
      failure = error;
    } catch (thrown) {
      failure = thrown;
    }
    lastRetryable = isRetryableStorageFailure(failure);
    lastTimedOut = failure instanceof StorageUploadTimeoutError;
    lastMessage = failure !== null && typeof failure === "object" && "message" in failure
      ? String((failure as { message: unknown }).message)
      : String(failure);
    if (!lastRetryable) break;
  }
  throw new StorageUploadError(lastMessage, lastRetryable, lastTimedOut, attemptsMade);
};
