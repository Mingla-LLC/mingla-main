/**
 * #4453 Website workspace — where an address under /brand/<id>/website lands
 * in the one workspace: which left-panel mode is showing, whether the Publish
 * panel is open, and which "more" screen (Stats, History, Address, Settings,
 * Requests, a content list) covers the page. Pure, so every old address has a
 * tested answer and none becomes a dead end.
 */
import type { CollectionSection, WebsiteRoute, WebsiteSection } from "./websiteNav";

export const WORKSPACE_MODES = ["ari", "edit", "design"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];
export const WORKSPACE_MODE_LABELS: Readonly<Record<WorkspaceMode, string>> = { ari: "Ari", edit: "Edit", design: "Design" };

export const WORKSPACE_DETAILS = [
  "stats", "history", "addresses", "settings", "requests", "pages", "destinations", "stories", "reviews", "past",
] as const;
export type WorkspaceDetail = (typeof WORKSPACE_DETAILS)[number];

export const WORKSPACE_DETAIL_LABELS: Readonly<Record<WorkspaceDetail, string>> = {
  stats: "Stats",
  history: "History and restore",
  addresses: "Address and domain",
  settings: "Settings",
  requests: "Requests to the team",
  pages: "Pages and menu",
  destinations: "Destinations",
  stories: "Stories",
  reviews: "Reviews",
  past: "Past trips",
};

export type WorkspaceTarget = {
  mode: WorkspaceMode;
  publish: boolean;
  detail: WorkspaceDetail | null;
  /** A destination, story or review open in its editor (covers the page). */
  editor: { section: CollectionSection; entryId: string | "new" } | null;
  /** A team request to show first (from the "ready for review" notification). */
  requestId: string | null;
};

export type WorkspaceSearch = { mode?: string | null; panel?: string | null; request?: string | null };

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Old section address -> the "more" screen that now holds it (null: it is a mode or the Publish panel). */
const SECTION_DETAIL: Readonly<Partial<Record<WebsiteSection, WorkspaceDetail>>> = {
  addresses: "addresses",
  settings: "settings",
  destinations: "destinations",
  stories: "stories",
  reviews: "reviews",
  past: "past",
};

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === "string" && (WORKSPACE_MODES as readonly string[]).includes(value);
}

export function isWorkspaceDetail(value: unknown): value is WorkspaceDetail {
  return typeof value === "string" && (WORKSPACE_DETAILS as readonly string[]).includes(value);
}

/**
 * The workspace for a parsed Website route. `overviewDrill` is the phone's
 * old "/website/overview" address, which showed the numbers.
 */
export function workspaceTarget(
  route: Exclude<WebsiteRoute, { kind: "redirect" | "preview" | "setup" }>,
  search: WorkspaceSearch = {},
  overviewDrill = false,
): WorkspaceTarget {
  const requestId = typeof search.request === "string" && REQUEST_ID.test(search.request) ? search.request : null;
  const base: WorkspaceTarget = { mode: isWorkspaceMode(search.mode) ? search.mode : "ari", publish: false, detail: null, editor: null, requestId };
  if (route.kind === "editor") {
    return { ...base, mode: isWorkspaceMode(search.mode) ? search.mode : "edit", detail: route.section, editor: { section: route.section, entryId: route.entryId } };
  }
  if (requestId) return { ...base, detail: "requests" };
  if (isWorkspaceDetail(search.panel)) return { ...base, detail: search.panel };
  switch (route.section) {
    case "overview":
      return overviewDrill ? { ...base, detail: "stats" } : base;
    case "pages":
      return { ...base, mode: "edit" };
    case "design":
      return { ...base, mode: "design" };
    case "publish":
      return { ...base, mode: isWorkspaceMode(search.mode) ? search.mode : "edit", publish: true };
    case "plan":
      return base;
    default: {
      const detail = SECTION_DETAIL[route.section] ?? null;
      return detail ? { ...base, mode: isWorkspaceMode(search.mode) ? search.mode : "edit", detail } : base;
    }
  }
}

/** One key per address, so the workspace re-reads its target only when the address really changes. */
export function workspaceTargetKey(target: WorkspaceTarget): string {
  return [target.mode, target.publish ? "p" : "", target.detail ?? "", target.editor ? `${target.editor.section}/${target.editor.entryId}` : "", target.requestId ?? ""].join("|");
}

/** The old section an existing section component still expects in context. */
export function detailSection(detail: WorkspaceDetail | null, mode: WorkspaceMode): WebsiteSection {
  switch (detail) {
    case "stats": return "overview";
    case "history": return "publish";
    case "addresses": return "addresses";
    case "settings": return "settings";
    case "pages": return "pages";
    case "destinations": return "destinations";
    case "stories": return "stories";
    case "reviews": return "reviews";
    case "past": return "past";
    default: return mode === "design" ? "design" : mode === "edit" ? "pages" : "overview";
  }
}

/** Where `ctx.go(section)` from an existing section lands inside the workspace. */
export function sectionJump(section: WebsiteSection): { mode?: WorkspaceMode; publish?: boolean; detail?: WorkspaceDetail | null } {
  switch (section) {
    case "overview": return { detail: null };
    case "pages": return { mode: "edit", detail: null };
    case "design": return { mode: "design", detail: null };
    case "publish": return { publish: true, detail: null };
    case "plan": return {};
    default: return { detail: SECTION_DETAIL[section] ?? null };
  }
}
