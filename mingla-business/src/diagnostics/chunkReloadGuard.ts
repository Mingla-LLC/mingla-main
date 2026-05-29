// ORCH-0964: web-only chunk-load resilience.
//
// mingla-business web is a single-output Expo Router SPA with code-split JS
// chunks. A transient failed chunk fetch — CDN hiccup, flaky network, or a
// stale index.html (served from cache after a deploy) pointing at hashed chunk
// files that have since been evicted — throws ChunkLoadError / "Failed to fetch
// dynamically imported module" and blanks the route until the user manually
// reloads. That is the "needs reloading multiple times to load" symptom.
//
// This guard does ONE automatic reload when a chunk error is detected, which
// re-fetches index.html + the current chunk hashes and almost always recovers.
// It is time-guarded via sessionStorage so it can NEVER loop: if a chunk error
// recurs within 10s of an auto-reload, we stop reloading and let the error
// surface to the app's ErrorBoundary instead.
//
// Side-effect module: imported for its registration only (see app/_layout.tsx).

const RELOAD_TS_KEY = "mingla:last-chunk-reload";
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

function isChunkError(message: unknown): boolean {
  return typeof message === "string" && CHUNK_ERROR_RE.test(message);
}

function reloadOnce(): void {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_TS_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) {
      // Already auto-reloaded very recently — do not loop; let the
      // ErrorBoundary show its recoverable fallback instead.
      return;
    }
    window.sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
    window.location.reload();
  } catch {
    // sessionStorage blocked (private mode) — skip the guard rather than risk a loop.
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("error", (event: ErrorEvent) => {
    if (isChunkError(event?.message) || isChunkError((event?.error as Error | undefined)?.message)) {
      reloadOnce();
    }
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event?.reason as unknown;
    const message =
      reason instanceof Error ? reason.message : typeof reason === "string" ? reason : undefined;
    if (isChunkError(message)) reloadOnce();
  });
}

export {};
