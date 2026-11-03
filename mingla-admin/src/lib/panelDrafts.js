// Issue #4255 — unsaved text in a side panel, kept per item.
//
// A note half typed on a work card must survive opening a linked host beside
// it, closing that host, opening another, and coming back to the card later
// in the same session. So what a person types in a panel is kept here, by a
// key that names the item and the field ("work:<id>:note"), until it is
// saved, discarded on purpose, or the person signs out (Constitution rule 6:
// logout clears everything). Memory only: never server data, never stored in
// the browser.
//
// Pure module (no React). hooks/usePanelDraft.js reads it in components.
import { onSignOut } from "./signOutCleanup.js";

const drafts = new Map();
const listeners = new Set();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[panelDrafts] a listener failed:", err?.message || err);
    }
  }
}

export function getPanelDraft(key) {
  return drafts.has(key) ? drafts.get(key) : undefined;
}

/**
 * Keep `value` for `key` (empty text too: clearing a saved field is a change
 * worth keeping). null or undefined forgets the key.
 */
export function setPanelDraft(key, value) {
  if (typeof key !== "string" || !key) return;
  if (value === null || value === undefined) {
    if (!drafts.has(key)) return;
    drafts.delete(key);
  } else {
    if (drafts.get(key) === value) return;
    drafts.set(key, value);
  }
  notify();
}

export function clearPanelDraft(key) {
  if (!drafts.has(key)) return;
  drafts.delete(key);
  notify();
}

/** Every kept key starting with `prefix` ("work:<id>:"), or every key. */
export function panelDraftKeys(prefix = "") {
  return [...drafts.keys()].filter((key) => key.startsWith(prefix));
}

export function hasPanelDrafts(prefix = "") {
  return panelDraftKeys(prefix).length > 0;
}

/** Forget everything (sign-out). */
export function clearPanelDrafts() {
  if (drafts.size === 0) return;
  drafts.clear();
  notify();
}

export function subscribePanelDrafts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes every time a draft is kept or forgotten (for useSyncExternalStore). */
export function panelDraftsVersion() {
  return version;
}

onSignOut(clearPanelDrafts);
