/**
 * desktopSidebarState — #4420 B6. The desktop (>= 1024) sidebar's collapse
 * state, shared by the sidebar (BottomNav.web) and DesktopCanvas (which pads
 * the page by the sidebar's width).
 *
 *   expanded  → the grouped 248 sidebar
 *   collapsed → the 80 icon rail (the host's choice, remembered), and ALWAYS
 *               on wizard and full-screen task routes (`isRailRoute`).
 *
 * Persistence is a per-viewer convenience: localStorage, every access wrapped
 * in try/catch (private windows and blocked storage throw), defaulting to
 * expanded. Nothing else is stored. Group collapse (Promote / Audience) is
 * remembered the same way.
 */

import { create } from "zustand";

import { DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../constants/desktopLayout";
import type { IconName } from "./Icon";

/** One sidebar entry (#4389: shared by DesktopSidebar and the lazy DesktopSidebarRail). */
export interface SidebarItem {
  key: string;
  label: string;
  icon: IconName;
  path: string;
}

export interface SidebarGroup {
  key: string;
  /** null = the untitled top group. */
  title: string | null;
  items: SidebarItem[];
}

const STORAGE_KEY = "mingla.host.sidebar.v1";

interface Persisted {
  collapsed: boolean;
  closedGroups: string[];
}

const readPersisted = (): Persisted => {
  try {
    const storage = (globalThis as { localStorage?: { getItem: (k: string) => string | null } }).localStorage;
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: false, closedGroups: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      collapsed: parsed.collapsed === true,
      closedGroups: Array.isArray(parsed.closedGroups) ? parsed.closedGroups.filter((g) => typeof g === "string") : [],
    };
  } catch {
    // Storage blocked or corrupt: the default (expanded, all groups open) is correct.
    return { collapsed: false, closedGroups: [] };
  }
};

const writePersisted = (value: Persisted): void => {
  try {
    const storage = (globalThis as { localStorage?: { setItem: (k: string, v: string) => void } }).localStorage;
    storage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked (private window): the choice lasts for this session only.
  }
};

interface SidebarState extends Persisted {
  toggleCollapsed: () => void;
  toggleGroup: (group: string) => void;
}

export const useDesktopSidebarStore = create<SidebarState>((set, get) => ({
  ...readPersisted(),
  toggleCollapsed: () => {
    const next = { collapsed: !get().collapsed, closedGroups: get().closedGroups };
    writePersisted(next);
    set({ collapsed: next.collapsed });
  },
  toggleGroup: (group) => {
    const closed = get().closedGroups;
    const closedGroups = closed.includes(group) ? closed.filter((g) => g !== group) : [...closed, group];
    writePersisted({ collapsed: get().collapsed, closedGroups });
    set({ closedGroups });
  },
}));

/** Wizard and full-screen task routes always get the 80 rail. */
export const isRailRoute = (pathname: string): boolean => {
  const lower = pathname.toLowerCase();
  return (
    lower.includes("/campaigns/compose") ||
    /\/(create|new|edit)(\/|$)/.test(lower) ||
    /\/marketing\/ads\/[^/]+/.test(lower)
  );
};

/** The width DesktopCanvas reserves on the left for the sidebar. */
export const desktopSidebarWidth = (collapsed: boolean, pathname: string): number =>
  collapsed || isRailRoute(pathname) ? DESKTOP_RAIL_WIDTH : DESKTOP_SIDEBAR_WIDTH;
