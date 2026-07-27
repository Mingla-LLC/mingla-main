/**
 * ISSUE-903 [window.open one-owner hardening] — the SINGLE owner of "open an
 * external destination in a new tab" for mingla-admin.
 *
 * WHY THIS FILE EXISTS. mingla-admin is a standalone Vite JS app with NO import
 * path to mingla-marketing/lib/open-external.ts or mingla-business's helper, so
 * per the ORCH-1381/1382 owner-per-package precedent it carries its OWN copy.
 * Two admin call sites (AdPreview.jsx, CareersPage.jsx) previously re-rolled
 * window.open(url, "_blank", "noopener,noreferrer") inline. Per the HTML spec
 * `noopener` — and `noreferrer`, which implies it — force window.open to return
 * null EVEN ON SUCCESS; the moment a dev adds an `if (!win) location = url`
 * popup-block fallback onto either call, the page double-navigates on every tap
 * (the ORCH-1381 bug). Routing both through this bare-open owner deletes the
 * feature string entirely and forecloses that reship.
 *
 * SECURITY. Dropping `noopener` loses nothing: `win.opener = null` severs the
 * reference synchronously, before any script in the popup can run.
 *
 * SSR/undefined-window safe by construction (mirrors the mingla-business owner)
 * so the plain node:test can exercise it with a fake Window.
 *
 * @param {string} dest Absolute or app-relative destination URL.
 * @param {Window} [w] Injectable window — defaults to the real one; the injection
 *   point is what makes this behaviourally testable with no DOM test infra.
 * @returns {void}
 */
export function openExternal(dest, w = typeof window === "undefined" ? undefined : window) {
  if (w === undefined) return;
  const win = w.open(dest, "_blank");
  if (win) {
    win.opener = null;
  } else {
    w.location.assign(dest);
  }
}
