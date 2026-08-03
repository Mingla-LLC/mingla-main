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
//
// ---------------------------------------------------------------------------
// Issue #1485 [web-missing-chunk-404]: the 200-HTML signature.
//
// ORCH-0964's matcher above only ever sees a chunk that FAILED to load. Until
// #1485, business web's Vercel catch-all rewrite (`/(.*)` -> `/`) answered a
// missing `/_expo/static/**` asset with `200 OK` and the SPA shell `index.html`.
// Nothing "failed": the browser received a successful response and executed an
// HTML document as JavaScript, which throws a SyntaxError — `Unexpected token
// '<'` — or, once Metro's registry is asked for the module that never
// registered, `Requiring unknown module "<id>"`. Neither string is in
// CHUNK_ERROR_RE, so the guard was blind to the exact symptom it exists for.
// #1485 part (a) makes the server return a real 404; this is the client half,
// and it also covers any residual edge-cached HTML body.
//
// WHY JSON_PARSE_RE IS MANDATORY, NOT DEFENSIVE. V8 renders
// `JSON.parse("<!DOCTYPE html>…")` as:
//     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
// so the HTML-as-JS signature also matches every API that hands back an HTML
// error page. Without this exclusion ANY such response would hard-reload the
// user's page — a far worse bug than the one being fixed. The exclusion costs
// nothing on the browsers in evidence (Safari 26.4 / Chrome Mobile iOS 150 —
// both JSC, which emits `JSON Parse error: …` and never `Unexpected token '<'`
// for JSON).
//
// The 10s sessionStorage cooldown below is unchanged and still the only
// no-loop guarantee — it bounds the widened matcher exactly as it bounds the
// original one.
//
// ---------------------------------------------------------------------------
// Issue #1485 P2-1: this module is ONE OF TWO recovery owners — they share ONE
// decision record.
//
// `scripts/inject-mobile-blur-css.mjs` injects an inline <head> script into
// `dist/index.html` at build time. It exists because it runs BEFORE any bundle
// and is the only thing that can see a *resource* `error` — a `<script src>`
// that 404s, including the ENTRY bundle this module ships inside. A resource
// error carries no `event.message` (only `event.target.src`), so the listeners
// below can never see that class even when they are registered.
//
// Both owners therefore consult THIS file's `RELOAD_TS_KEY` +
// `RELOAD_COOLDOWN_MS`. The head script writes the same key with the same
// `String(Date.now())` shape and applies the same strict `< COOLDOWN` test, so
// whichever owner reaches a failure first stamps the record and reloads, and
// the other reads the stamp in the same tick and stands down. One failure can
// only ever produce one reload. Do not fork the key, the value shape, or the
// window: `__tests__/issue1485_p2_1_one_chunk_recovery_owner.test.ts` pins the
// head script's literals equal to the two constants below and fails CI on drift.
//
// The head script also owns a one-way migration of its retired presence-only
// key (`mingla-mobile-web-chunk-recovery`) into `RELOAD_TS_KEY`. It runs at
// <head> time on every load, i.e. always before this module, so nothing here
// needs to know the legacy key exists.
// ---------------------------------------------------------------------------

const RELOAD_TS_KEY = "mingla:last-chunk-reload";
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

// #1485 — HTML served with a 2xx where JavaScript was expected.
const HTML_FOR_JS_RE = /Unexpected token '<'|Requiring unknown module/i;
// #1485 — false-positive exclusion: the same V8 text for a JSON.parse of HTML.
const JSON_PARSE_RE = /is not valid JSON|JSON Parse error|JSON\.parse/i;

function isChunkError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  if (CHUNK_ERROR_RE.test(message)) return true;
  return HTML_FOR_JS_RE.test(message) && !JSON_PARSE_RE.test(message);
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
