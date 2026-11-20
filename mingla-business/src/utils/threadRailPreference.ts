/**
 * #4420 SC-17 — the thread's details rail (People / Guests · Plan · Media) on
 * wide desktop can be collapsed. Pure rules plus the per-viewer preference.
 *
 * Persistence mirrors the desktop sidebar (desktopSidebarState.ts): web
 * localStorage, read synchronously (no async hydration, so no _hasHydrated
 * gate is needed), every access in try/catch, default expanded. Not server
 * state. Loaded only by the Messages chunk.
 */
export type ThreadRailTab = "people" | "plan" | "media";

export const THREAD_RAIL_STORAGE_KEY = "mingla.host.threadRail.v1";

type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

function storage(): StorageLike | undefined {
  return (globalThis as { localStorage?: StorageLike }).localStorage;
}

/** The remembered choice; any read failure or unknown value is expanded (false). */
export function readThreadRailCollapsed(source: StorageLike | undefined = storage()): boolean {
  try {
    const raw = source?.getItem(THREAD_RAIL_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { collapsed?: unknown };
    return parsed.collapsed === true;
  } catch {
    // Blocked or corrupt storage: expanded is the safe default.
    return false;
  }
}

/** Remembers the choice; a write failure only means it is not remembered. */
export function writeThreadRailCollapsed(collapsed: boolean, target: StorageLike | undefined = storage()): void {
  try {
    target?.setItem(THREAD_RAIL_STORAGE_KEY, JSON.stringify({ collapsed }));
  } catch {
    // Storage blocked (private window): the rail still works this session.
  }
}

/**
 * What the rail shows after a request. Any request for a tab (a header
 * button, "Open Plan" on the plan activity card, a ?gallery=1 or ?plan=1 deep
 * link) opens the rail on that tab, even when it was collapsed. No request
 * keeps the current state.
 */
export function resolveThreadRail(
  current: { collapsed: boolean; tab: ThreadRailTab },
  request: ThreadRailTab | null,
): { collapsed: boolean; tab: ThreadRailTab } {
  if (request === null) return current;
  return { collapsed: false, tab: request };
}
