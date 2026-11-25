// #4571: a deploy replaces Admin's hashed code chunks, so a tab opened before
// the deploy 404s on the next lazy import. Reload once (never in a loop) and
// say plainly what happened if the reload does not cure it.
export const CHUNK_RELOAD_KEY = "mingla-admin:chunk-reload-at";
export const CHUNK_RELOAD_WINDOW_MS = 30000;
export const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];
export const UPDATED_MESSAGE = "Mingla Admin was updated. Reload to get the latest version.";

export function isChunkLoadError(error) {
  const text = String(error?.message ?? error ?? "").toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => text.includes(p.toLowerCase()));
}

// Reading window.sessionStorage itself throws (SecurityError) when site data is
// blocked; never let that crash Admin's boot. null makes the handler skip.
function safeSessionStorage(win) {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Listen for vite:preloadError and reload once per window.
 * `log` is told about every reload (Sentry message) and every skip (console).
 */
export function installStaleChunkReload({
  win = window,
  storage = safeSessionStorage(win),
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const handler = (event) => {
    let last = 0;
    try {
      last = Number(storage.getItem(CHUNK_RELOAD_KEY)) || 0;
    } catch {
      log("skipped-no-storage", event?.payload);
      return; // guard unreadable: a bad deploy could loop, so let the error throw
    }
    const t = now();
    if (last && t - last < CHUNK_RELOAD_WINDOW_MS) {
      log("skipped", event?.payload);
      return; // let the error reach React.lazy and the ErrorBoundary
    }
    try {
      storage.setItem(CHUNK_RELOAD_KEY, String(t));
    } catch {
      log("skipped-no-storage", event?.payload);
      return;
    }
    event.preventDefault?.();
    log("reloading", event?.payload);
    win.location.reload();
  };
  win.addEventListener("vite:preloadError", handler);
  return () => win.removeEventListener("vite:preloadError", handler);
}
