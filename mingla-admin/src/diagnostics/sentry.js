/**
 * Sentry crash-reporting shim — mingla-admin (client-only Vite SPA).
 *
 * Admin is a pure client bundle (`vite build`, no SSR / static-export /
 * prerender pass), so — unlike the business web shim (#890) — there is NO
 * `window`-at-module-load hazard: a normal static `import * as Sentry from
 * "@sentry/react"` + synchronous `Sentry.init()` is correct (issue #1322,
 * INVESTIGATION F-6). No lazy dynamic import, no `typeof window` guard.
 *
 * Dependency-injectable (the `sdk` parameter) so `node --test` can exercise the
 * delegation without Vite. NOTE: this module deliberately does NOT read
 * `import.meta.env` — the client entry `src/main.jsx` computes the DSN +
 * environment from Vite's inlined env and passes them in. Reading
 * `import.meta.env` here would break the Node test runner.
 *
 * Sentry project: events land in the shared `mingla-business` Sentry project
 * (org `mingla-llc`); admin errors are distinguished by an `admin-*`
 * `environment` tag (`admin-production` in prod, `admin-<mode>` otherwise),
 * computed at the entry and forwarded through here (issue #1322 OQ-1, Option B).
 */
import * as Sentry from "@sentry/react";

let started = false;

/**
 * Issue #4294: a request to a mingla_connector_ server function (one of them
 * carries a company tool's key in its body) leaves no breadcrumb at all.
 */
export function dropConnectorBreadcrumb(breadcrumb) {
  const url = breadcrumb?.data?.url;
  if (typeof url === "string" && /\/rpc\/mingla_connector_/.test(url)) return null;
  return breadcrumb;
}

/**
 * Initialize crash reporting once. Safe no-op when the DSN is absent
 * (dev / preview) — returns false without calling `sdk.init`.
 * @returns {boolean} true if Sentry was initialized on this call.
 */
export function initSentry({ dsn, environment } = {}, sdk = Sentry) {
  if (started) return false;
  const clean = (dsn ?? "").trim();
  if (!clean) return false; // no DSN => no-op (dev / preview)
  sdk.init({
    dsn: clean,
    environment: environment || "admin-production",
    tracesSampleRate: 0,
    sendClientReports: true,
    beforeBreadcrumb: dropConnectorBreadcrumb,
  });
  started = true;
  return true;
}

/**
 * Forward an error to Sentry. Returns "" before any successful init (no-op),
 * otherwise the Sentry event id.
 * @returns {string}
 */
export function captureException(error, context, sdk = Sentry) {
  if (!started) return "";
  return sdk.captureException(error, context);
}

/**
 * #4423: send a message-level event (the request ceiling trip). Same no-op
 * rule as captureException.
 * @returns {string}
 */
export function captureMessage(message, context, sdk = Sentry) {
  if (!started) return "";
  return sdk.captureMessage(message, context);
}
