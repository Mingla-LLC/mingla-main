// ORCH-1116 [Hub multi-select draft delete] — shared selection-mode hook.
//
// One owner of selection mechanics across all three Hub tabs (events, trips,
// experiences). Generic over the id type (string). Long-press is the SOLE entry
// (Q7): `enterWith` both enters select mode AND selects the long-pressed row.
// Each tab mounts ONE instance — selection never crosses tabs.

import { useCallback, useState } from "react";

export interface DraftMultiSelect {
  selectionMode: boolean;
  selectedIds: Set<string>;
  count: number;
  /** Long-press entry: enters mode AND selects the long-pressed row. */
  enterWith: (id: string) => void;
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
  clear: () => void;
  /** Exit mode + clear selection (Cancel button / after delete). */
  exit: () => void;
}

export function useDraftMultiSelect(): DraftMultiSelect {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const enterWith = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );
  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const exit = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  return {
    selectionMode,
    selectedIds,
    count: selectedIds.size,
    enterWith,
    toggle,
    isSelected,
    clear,
    exit,
  };
}
