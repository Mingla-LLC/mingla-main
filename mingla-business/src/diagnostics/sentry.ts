/**
 * Sentry platform shim — WEB side (and default fallback).
 *
 * Real @sentry/browser behind a LAZY, browser-guarded dynamic import so the
 * ORCH-0886 invariant holds: web NEVER touches `window` at module-load, so the
 * Expo Router static-SSR export pass (Node, no `window`) never crashes (#890,
 * proven: `npx expo export -p web` exits 0 with the SDK wired in).
 *
 * Metro picks `./sentry.native.ts` on iOS + Android (real @sentry/react-native);
 * web bundles fall through to this file. The two modules keep a byte-for-byte
 * identical PUBLIC surface:
 *   - init(options)
 *   - captureException(error, context?)  -> event-id string
 *   - addBreadcrumb(breadcrumb)
 *
 * Why the dynamic import (root-cause fix from ORCH-0886, 2026-05-19):
 * `@sentry/browser`'s deep integrations touch `window` at module-load. A
 * top-level/static import evaluates that in Node during the export's static
 * render and crashes with `window is not defined` before any React renders. A
 * dynamic `import()` INSIDE `init()`, reached only after a `typeof window`
 * guard, is never evaluated in Node — the browser fetches + evaluates that
 * code-split chunk only at runtime.
 *
 * NEVER add a top-level `import ... from "@sentry/browser"` (or `require`) here
 * or anywhere in the web graph — it re-breaks the export. Enforced by
 * `.github/scripts/strict-grep/issue-890-web-sentry-lazy-only.mjs`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type BrowserSentry = typeof import("@sentry/browser");
let sdk: BrowserSentry | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function init(options?: unknown): void {
  if (!isBrowser()) return; // Node static-export: never load the web SDK
  if (!options || typeof options !== "object") return;
  const opts = options as Record<string, unknown>;
  if (!opts.dsn) return; // no DSN => no-op (dev / preview)
  void import("@sentry/browser")
    .then((mod) => {
      sdk = mod;
      mod.init(opts as any);
    })
    .catch(() => {
      /* never surface a diagnostics-loader failure to the user */
    });
}

export function captureException(error: unknown, context?: unknown): string {
  if (!isBrowser() || !sdk) return "";
  return sdk.captureException(error as any, context as any);
}

export function addBreadcrumb(breadcrumb: unknown): void {
  if (!isBrowser() || !sdk) return;
  sdk.addBreadcrumb(breadcrumb as any);
}
