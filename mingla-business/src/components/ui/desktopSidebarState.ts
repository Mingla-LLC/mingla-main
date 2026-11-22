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

/**
 * Wizard and full-screen task routes always get the 80 rail.
 *
 * #4453 — the Website workspace (`/brand/<id>/website` and everything under
 * it: old section addresses, editors, the setup wizard, the full Ari chat,
 * with or without a query) is a full-screen task: its own 392 panel sits
 * beside the live draft, so the app sidebar is always the rail there.
 */
export const isRailRoute = (pathname: string): boolean => {
  const lower = pathname.toLowerCase();
  return (
    lower.includes("/campaigns/compose") ||
    /\/(create|new|edit)(\/|$)/.test(lower) ||
    /\/marketing\/ads\/[^/]+/.test(lower) ||
    /^\/brand\/[^/]+\/website([/?]|$)/.test(lower)
  );
};

/** The width DesktopCanvas reserves on the left for the sidebar. */
export const desktopSidebarWidth = (collapsed: boolean, pathname: string): number =>
  collapsed || isRailRoute(pathname) ? DESKTOP_RAIL_WIDTH : DESKTOP_SIDEBAR_WIDTH;

/**
 * #4420 — the side menu never scrolls. Sizes come from the MEASURED panel
 * height (onLayout), never from today's item count, so a 14th item still fits.
 * Pure so the fit is unit-tested at every panel height.
 */
export const RAIL_DIVIDER_HEIGHT = 9;
export const RAIL_TILE_MAX = 48;
export const RAIL_TILE_MIN = 20;
/** Expanded sidebar: brand row (34 logo + 16 below), vertical padding 2x16, footer hairline + 12 top padding. */
export const EXPANDED_BRAND_ROW_HEIGHT = 50;
export const EXPANDED_FIXED_CHROME = 2 * 16 + 1 + 12;
export const EXPANDED_ROW_MAX = 64;

/** Rail vertical padding: 20, or 12 when the panel is under 700. */
export const railVerticalPadding = (panelHeight: number): number => (panelHeight < 700 ? 12 : 20);

export interface RailLayout {
  /** The share of height each slot gets (slots are flex, uncapped). */
  slot: number;
  /** The square tile drawn centred in its slot. */
  tile: number;
  icon: number;
}

/** bodyHeight = the area under the logo that holds every slot and divider. */
export const railLayout = (bodyHeight: number, slotCount: number, dividerCount: number): RailLayout => {
  const slot = slotCount > 0 ? Math.max(0, (bodyHeight - dividerCount * RAIL_DIVIDER_HEIGHT) / slotCount) : 0;
  const tile = Math.max(RAIL_TILE_MIN, Math.min(RAIL_TILE_MAX, Math.floor(slot - 6)));
  return { slot, tile, icon: tile >= 40 ? 20 : tile >= 30 ? 18 : 16 };
};

export interface ExpandedLayout {
  row: number;
  /** A group title takes 0.7 of a row. */
  title: number;
  /** A group gap takes 0.4 of a row (the first-to-last gaps plus the one above Account). */
  gap: number;
  labelSize: number;
  icon: number;
}

/** The height the groups and Account share, from the measured panel and brand row. */
export const expandedAvailable = (panelHeight: number, brandRowHeight: number): number =>
  Math.max(0, panelHeight - EXPANDED_FIXED_CHROME - brandRowHeight);

/**
 * rows = visible page rows + Account; titles = titled groups; gaps = groups
 * (one between each pair plus one above Account). Rows are capped at 64; any
 * remainder is spread between the groups by the layout (space-between).
 */
export const expandedLayout = (available: number, rows: number, titles: number, gaps: number): ExpandedLayout => {
  const units = rows + 0.7 * titles + 0.4 * gaps;
  const row = units > 0 ? Math.floor(Math.min(EXPANDED_ROW_MAX, available / units)) : EXPANDED_ROW_MAX;
  return {
    row,
    title: Math.floor(0.7 * row),
    gap: Math.floor(0.4 * row),
    labelSize: row < 34 ? 13 : 15,
    icon: row < 32 ? 16 : 18,
  };
};
