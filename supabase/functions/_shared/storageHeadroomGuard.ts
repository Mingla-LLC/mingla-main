// Issue #1644 — Stage 0 storage guardrail.
//
// WHY THIS EXISTS
// ---------------
// Supabase Storage sits at ~78.21 GiB of a 100 GiB quota (21.79 GiB headroom),
// and the spend cap is ARMED. Crossing 100 GiB is therefore NOT a bill — it
// triggers a Fair-Use restriction that can put the database into READ-ONLY mode
// org-wide. Organic growth is ~16.6 MiB/week and harmless, but the May–June
// place-photo/collage backfill burst was measured at 29.3 GiB/week: a re-run
// over a new city would consume the entire remaining headroom in about FIVE
// DAYS. The realistic path to an outage is a backfill re-run, not organic
// growth, so the backfill entry points refuse to start when storage is high.
//
// FAIL-CLOSED CONTRACT
// --------------------
// If usage cannot be measured, the guard REFUSES. A guard that fails open is
// worse than no guard, because it creates false confidence precisely when the
// measurement path is broken. Callers MUST treat `ok: false` as "do not write".
//
// NO-OP PATHS MUST STAY QUIET
// ---------------------------
// `kick_pending_thumb_backfill` fires every 10 minutes against an empty queue
// and must keep no-opping silently. Callers therefore consult this guard ONLY
// once they know there is real work to do — never on the empty-queue path.
// See the call sites in backfill-place-photo-thumbs / backfill-place-photos /
// run-place-intelligence-trial.
//
// COST (MEASURED, not estimated — production `gqnoajqerqhnvulmnyvv`, 2026-08-05)
// -----------------------------------------------------------------------------
//   EXPLAIN (ANALYZE, BUFFERS) SELECT sum((metadata->>'size')::bigint)
//     FROM storage.objects;
//   -> Parallel Seq Scan, 420,010 rows, shared read=27,375 buffers (~214 MiB)
//   -> cold  854.681 ms   warm  117.593 ms
// There is no index that can serve it (the size lives inside a jsonb column),
// so every call is a full scan of a 385 MB table. That is too expensive to run
// per place or per batch, hence the short in-isolate cache below.

/** Default ceiling: 85 GiB of the 100 GiB quota, leaving 15 GiB of margin. */
export const STORAGE_HEADROOM_DEFAULT_MAX_BYTES = 85 * 1024 * 1024 * 1024; // 91,268,055,040

/**
 * Operator override, so the ceiling can be raised (or lowered) WITHOUT a
 * redeploy. Accepts a plain byte count. Unset is the normal state — the
 * default above already protects us, so this consumes no Supabase secret slot
 * unless it is actually needed (secret capacity is ~90/100, see COMMS-0122).
 */
export const STORAGE_HEADROOM_MAX_BYTES_ENV = "STORAGE_BACKFILL_MAX_BYTES";

/** `public` RPC that sums `(metadata->>'size')::bigint` over `storage.objects`. */
export const STORAGE_TOTAL_BYTES_RPC = "issue_1644_storage_total_bytes";

/** How long a successful measurement is reused within a single isolate. */
export const STORAGE_HEADROOM_CACHE_TTL_MS = 60_000;

const GIB = 1024 * 1024 * 1024;

export type StorageHeadroomVerdict =
  | { ok: true; totalBytes: number; thresholdBytes: number; cached: boolean }
  | {
    ok: false;
    reason: "over_threshold" | "unmeasurable";
    message: string;
    totalBytes: number | null;
    thresholdBytes: number;
  };

/** Minimal structural type — avoids coupling to a specific supabase-js version. */
export type StorageHeadroomDb = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type EnvGetter = (name: string) => string | undefined;

function defaultGetEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function formatGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(2)} GiB`;
}

/**
 * Resolve the active ceiling.
 *
 * An UNPARSEABLE or non-positive override falls back to the default rather than
 * being honoured or throwing. That is deliberate: a typo'd override must not
 * silently disable the guardrail, and the default is the more conservative of
 * the two possible outcomes.
 */
export function resolveStorageHeadroomThreshold(getEnv: EnvGetter = defaultGetEnv): number {
  const raw = getEnv(STORAGE_HEADROOM_MAX_BYTES_ENV);
  if (raw === undefined || raw.trim() === "") return STORAGE_HEADROOM_DEFAULT_MAX_BYTES;

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[storageHeadroomGuard] ${STORAGE_HEADROOM_MAX_BYTES_ENV}="${raw}" is not a positive ` +
        `integer byte count; falling back to the default ceiling of ` +
        `${formatGiB(STORAGE_HEADROOM_DEFAULT_MAX_BYTES)}.`,
    );
    return STORAGE_HEADROOM_DEFAULT_MAX_BYTES;
  }
  return parsed;
}

// ── In-isolate measurement cache ────────────────────────────────────────────
// Only SUCCESSFUL measurements are cached. Failures are never cached, so a
// transient database blip does not pin the guard closed for a full TTL.
let cachedTotalBytes: number | null = null;
let cachedAtMs = 0;

/** Test-only: drop the memoised measurement. */
export function resetStorageHeadroomCache(): void {
  cachedTotalBytes = null;
  cachedAtMs = 0;
}

/**
 * Sum every object's `metadata->>'size'`, memoised for
 * STORAGE_HEADROOM_CACHE_TTL_MS. Returns null when the value cannot be
 * measured (RPC error, missing function, or a non-numeric payload).
 */
export async function measureStorageTotalBytes(
  db: StorageHeadroomDb,
  opts: { nowMs?: number } = {},
): Promise<{ totalBytes: number | null; cached: boolean; error?: string }> {
  const now = opts.nowMs ?? Date.now();
  if (cachedTotalBytes !== null && now - cachedAtMs < STORAGE_HEADROOM_CACHE_TTL_MS) {
    return { totalBytes: cachedTotalBytes, cached: true };
  }

  let data: unknown;
  let error: { message: string } | null;
  try {
    ({ data, error } = await db.rpc(STORAGE_TOTAL_BYTES_RPC));
  } catch (err) {
    return { totalBytes: null, cached: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (error) return { totalBytes: null, cached: false, error: error.message };

  // The RPC returns bigint; PostgREST may render it as a number OR a string.
  const numeric = typeof data === "string" ? Number(data) : data;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) {
    return {
      totalBytes: null,
      cached: false,
      error: `unexpected payload from ${STORAGE_TOTAL_BYTES_RPC}: ${JSON.stringify(data)}`,
    };
  }

  cachedTotalBytes = numeric;
  cachedAtMs = now;
  return { totalBytes: numeric, cached: false };
}

/**
 * The guardrail. Call this ONLY once you know there is real work to do —
 * calling it on an empty-queue tick would turn a quiet no-op into error spam.
 *
 * @param label short caller name used in the operator-facing message
 */
export async function checkStorageHeadroom(
  db: StorageHeadroomDb,
  label: string,
  opts: { getEnv?: EnvGetter; nowMs?: number } = {},
): Promise<StorageHeadroomVerdict> {
  const thresholdBytes = resolveStorageHeadroomThreshold(opts.getEnv ?? defaultGetEnv);
  const measured = await measureStorageTotalBytes(db, { nowMs: opts.nowMs });

  if (measured.totalBytes === null) {
    // FAIL CLOSED. We could not prove there is headroom, so we do not write.
    return {
      ok: false,
      reason: "unmeasurable",
      totalBytes: null,
      thresholdBytes,
      message:
        `[#1644] ${label} refused to start: current Supabase Storage usage could not be measured ` +
        `(${measured.error ?? "unknown error"}). This guard fails CLOSED because storage is near a ` +
        `100 GiB quota with the spend cap ARMED, and an overage triggers a Fair-Use restriction ` +
        `that can put the database into read-only mode. ` +
        `TO FIX: confirm the '${STORAGE_TOTAL_BYTES_RPC}' function exists and is EXECUTE-able by ` +
        `service_role (migration 20270219001644_issue_1644_storage_backfill_guard.sql), then retry. ` +
        `TO OVERRIDE: raise ${STORAGE_HEADROOM_MAX_BYTES_ENV} only after verifying real headroom.`,
    };
  }

  if (measured.totalBytes >= thresholdBytes) {
    const headroom = thresholdBytes - measured.totalBytes;
    return {
      ok: false,
      reason: "over_threshold",
      totalBytes: measured.totalBytes,
      thresholdBytes,
      message:
        `[#1644] ${label} refused to start: Supabase Storage is at ` +
        `${formatGiB(measured.totalBytes)} (${measured.totalBytes} bytes), at or above the ` +
        `${formatGiB(thresholdBytes)} backfill ceiling (${thresholdBytes} bytes) — ` +
        `${formatGiB(Math.abs(headroom))} ${headroom < 0 ? "over" : "under"}. ` +
        `A full place-photo/collage backfill writes ~29.3 GiB/week and would cross the 100 GiB ` +
        `quota; with the spend cap ARMED that is a Fair-Use restriction, not a bill, and can put ` +
        `the database into read-only mode org-wide. ` +
        `TO FIX: reclaim storage first (issue #1644 — re-encoding the place-collages PNGs to WebP ` +
        `frees ~30 GiB without deleting a single asset), then retry. ` +
        `TO OVERRIDE deliberately: set ${STORAGE_HEADROOM_MAX_BYTES_ENV} to a higher byte count ` +
        `(no redeploy required) — but only once you have confirmed the run fits in the headroom.`,
    };
  }

  return {
    ok: true,
    totalBytes: measured.totalBytes,
    thresholdBytes,
    cached: measured.cached,
  };
}
