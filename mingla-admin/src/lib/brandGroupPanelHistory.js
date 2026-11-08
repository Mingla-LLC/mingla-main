// Issue #4270 (Wave 7 rework, D-2) — exact Close and Back for the Brand group
// side panel. Pure module: it takes the window it works on, so tests can hand
// it a fake history.
//
// The panel opens with a new history entry and each link followed inside it
// adds one more, so Close walks back exactly what the panel added and the
// address returns to the entry the panel opened from. Counting popstate events
// was wrong (Chrome fires popstate for the page's own `location.hash` pushes
// too), so instead every entry the panel adds is tagged in `history.state`
// with this panel's token and its distance from the entry it opened from. The
// tag travels with the entry: after the browser's Back or Forward the current
// entry still says exactly how far it is from the start. Entries without this
// panel's tag (a pasted link, a reload, another page's entry) are not ours,
// and closing from one of them adds a new entry without the panel instead.
//
// The tag is written with replaceState on the CURRENT address only: it never
// changes what the address says.
import { sideCloseStep } from "./panelStack.js";

export const PANEL_HISTORY_KEY = "minglaBrandGroupPanel";

/** This panel's distance from where it opened, read from a history state; null when not ours. */
export function panelDepth(state, token) {
  if (!token || !state || typeof state !== "object") return null;
  const tag = state[PANEL_HISTORY_KEY];
  if (!tag || typeof tag !== "object" || tag.token !== token) return null;
  return Number.isInteger(tag.depth) && tag.depth >= 0 ? tag.depth : null;
}

function tagCurrent(win, token, depth) {
  const history = win.history;
  const state = history.state && typeof history.state === "object" ? history.state : {};
  history.replaceState({ ...state, [PANEL_HISTORY_KEY]: { token, depth } }, "", win.location.href);
}

let counter = 0;
function newToken() {
  counter += 1;
  return `bgp-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One controller per Brand groups page:
 *   begin()       the panel is about to open from a closed state: tag the
 *                 entry it opens from (distance 0)
 *   push(fn)      run fn (which may add an entry); a new entry is tagged one
 *                 further than the entry it was added from
 *   follow(fn, { panelOpen })
 *                 a link to open in the panel: pushed when the panel is
 *                 open; when it is closed (a toast's link after Close), the
 *                 panel opens afresh with begin() first, so its Close walks back
 *   replace(fn)   run fn (which may rewrite the current entry, wiping its
 *                 state); the current entry keeps its distance
 *   closeStep()   { kind: "go", delta } back to the start, or { kind: "push" }
 *   reset()       the panel closed: forget the token
 */
export function createPanelHistory(win) {
  let token = null;
  const depth = () => panelDepth(win.history.state, token);
  return {
    get token() {
      return token;
    },
    depth,
    begin() {
      token = newToken();
      tagCurrent(win, token, 0);
    },
    push(fn) {
      const from = depth();
      const before = win.location.href;
      fn();
      if (from !== null && win.location.href !== before) tagCurrent(win, token, from + 1);
    },
    follow(fn, { panelOpen } = {}) {
      if (!panelOpen) this.begin();
      this.push(fn);
    },
    replace(fn) {
      const at = depth();
      fn();
      if (at !== null) tagCurrent(win, token, at);
    },
    closeStep() {
      return sideCloseStep(depth() ?? 0);
    },
    reset() {
      token = null;
    },
  };
}
