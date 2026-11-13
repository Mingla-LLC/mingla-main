// Issue #4423 (W1.1): the ONE "page came back" signal for the whole Admin tab.
//
// Before #4423 about 14 hooks each listened to window `focus`, window `online`
// and document `visibilitychange` and refreshed at once, with no shared
// throttle: one focus on the Work tab sent 12 RPCs, and a stream of focus
// events took production down. Now this module owns those listeners. It emits
// to subscribers only when the page is visible, the browser is online, and at
// least PAGE_RETURN_MIN_GAP_MS has passed since the last emit or the last
// timer refresh (leading edge: extra events inside the gap are dropped, not
// queued).
//
// invariant I-ADMIN-SINGLE-PAGE-RETURN-LISTENER: only this file adds focus,
// visibilitychange or online listeners in mingla-admin/src. Enforced by
// src/__tests__/issue4423_single_listener.strict.test.js.
//
// Pure (no React). `win`, `doc`, `nav` and `now` are injectable for tests.

export const PAGE_RETURN_MIN_GAP_MS = 20_000;

/**
 * A page-return signal bound to one window and document. The app uses the
 * shared one below; tests build their own.
 */
export function createPageReturn({
  win = typeof window !== "undefined" ? window : null,
  doc = typeof document !== "undefined" ? document : null,
  nav = typeof navigator !== "undefined" ? navigator : null,
  now = () => Date.now(),
  minGapMs = PAGE_RETURN_MIN_GAP_MS,
} = {}) {
  const returnSubs = new Set();
  const visibilitySubs = new Set();
  const connectivitySubs = new Set();
  let installed = false;
  let lastAt = -Infinity;
  let emits = 0;

  const visible = () => !doc || doc.visibilityState === "visible";
  const online = () => !nav || nav.onLine !== false;

  function emitReturn(reason) {
    if (!visible() || !online()) return false;
    const t = now();
    if (t - lastAt < minGapMs) return false;
    lastAt = t;
    emits += 1;
    for (const fn of [...returnSubs]) {
      try { fn(reason); } catch (error) { reportSubscriberError(error); }
    }
    return true;
  }

  const onFocus = () => { emitReturn("focus"); };
  const onVisibility = () => {
    const isVisible = visible();
    for (const fn of [...visibilitySubs]) {
      try { fn(isVisible); } catch (error) { reportSubscriberError(error); }
    }
    if (isVisible) emitReturn("visible");
  };
  const onOnline = () => {
    for (const fn of [...connectivitySubs]) {
      try { fn(true); } catch (error) { reportSubscriberError(error); }
    }
    emitReturn("online");
  };
  const onOffline = () => {
    for (const fn of [...connectivitySubs]) {
      try { fn(false); } catch (error) { reportSubscriberError(error); }
    }
  };

  function install() {
    if (installed) return;
    installed = true;
    win?.addEventListener("focus", onFocus);
    win?.addEventListener("online", onOnline);
    win?.addEventListener("offline", onOffline);
    doc?.addEventListener("visibilitychange", onVisibility);
  }

  function uninstallIfIdle() {
    if (!installed || returnSubs.size || visibilitySubs.size || connectivitySubs.size) return;
    installed = false;
    win?.removeEventListener("focus", onFocus);
    win?.removeEventListener("online", onOnline);
    win?.removeEventListener("offline", onOffline);
    doc?.removeEventListener("visibilitychange", onVisibility);
  }

  function subscribe(set, fn) {
    if (typeof fn !== "function") return () => {};
    set.add(fn);
    install();
    return () => {
      set.delete(fn);
      uninstallIfIdle();
    };
  }

  return {
    /**
     * `fn(reason)` runs when the page came back (focus, visible again or back
     * online), at most once per gap. The only signal a refetch may use.
     */
    subscribePageReturn: (fn) => subscribe(returnSubs, fn),
    /**
     * `fn(isVisible)` on every visibility change, unthrottled. For pausing and
     * resuming timers and recomputing what is on screen ONLY: never fetch
     * from here (use subscribePageReturn).
     */
    subscribeVisibility: (fn) => subscribe(visibilitySubs, fn),
    /**
     * `fn(isOnline)` on every online / offline change, unthrottled. For
     * online indicators ONLY: never fetch from here.
     */
    subscribeConnectivity: (fn) => subscribe(connectivitySubs, fn),
    /** A poll just ran on its timer: the next return waits a full gap from now. */
    markRefreshed() { lastAt = Math.max(lastAt, now()); },
    /** For tests and the diagnostics line. */
    state: () => ({ installed, lastAt, emits, subscribers: returnSubs.size }),
  };
}

function reportSubscriberError(error) {
  // One failing subscriber must not stop the others; say so in the console.
  console.error("[pageReturn] a subscriber failed:", error?.message || error);
}

// The tab's one instance.
const shared = createPageReturn();
export const subscribePageReturn = shared.subscribePageReturn;
export const subscribeVisibility = shared.subscribeVisibility;
export const subscribeConnectivity = shared.subscribeConnectivity;
export const markRefreshed = shared.markRefreshed;
export const pageReturnState = shared.state;
