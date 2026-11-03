// Issue #4255 — a field's unsaved text, kept per item while panels open and
// close beside it (lib/panelDrafts.js holds it).
//
//   const [note, setNote, { kept, clear }] = usePanelDraft(`work:${id}:note`, "");
//
// `value` is the kept text, or `fallback` (the saved value) when nothing is
// kept. `setValue` keeps the text; setting the saved value back, or empty
// text, forgets it. `clear()` forgets it after a save.
import { useCallback, useSyncExternalStore } from "react";
import { clearPanelDraft, getPanelDraft, panelDraftsVersion, setPanelDraft, subscribePanelDrafts } from "../lib/panelDrafts";

/** The saved value again (an empty list counts as the empty saved list). */
function sameAsSaved(value, fallback) {
  if (value === fallback) return true;
  return Array.isArray(value) && Array.isArray(fallback) && JSON.stringify(value) === JSON.stringify(fallback);
}

export function usePanelDraft(key, fallback = "") {
  useSyncExternalStore(subscribePanelDrafts, panelDraftsVersion, panelDraftsVersion);
  const kept = key ? getPanelDraft(key) : undefined;
  const setValue = useCallback(
    (next) => {
      if (!key) return;
      const value = typeof next === "function" ? next(getPanelDraft(key) ?? fallback) : next;
      if (sameAsSaved(value, fallback)) clearPanelDraft(key);
      else setPanelDraft(key, value);
    },
    [key, fallback]
  );
  const clear = useCallback(() => {
    if (key) clearPanelDraft(key);
  }, [key]);
  return [kept === undefined ? fallback : kept, setValue, { kept: kept !== undefined, clear }];
}
