/**
 * Global search — shared, platform-agnostic type contract.
 *
 * META-ORCH-1073 Sub-A — "Global search sheet (Phase 1)".
 * SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1073_Sub-A_GLOBAL_SEARCH_SHEET.md
 *   §3.1 (data model), §3.1.2 (SearchResultType), §3.1.3 (SearchGroup),
 *   §3.1.4 (rendered result), §3.6 (icons + role-gating).
 *
 * I-SEARCH-CLIENT-ONLY: this module (and everything under src/lib/search/)
 * imports NO data-fetching dependency — no `services/supabase`, no service
 * that fetches. It operates purely on in-memory caches + the static
 * registry. Enforced by globalSearch.clientOnly.test.ts.
 */

import type { IconName } from "../../components/ui/Icon";

/**
 * SPEC §3.1.2 — LOCKED literal union. Later phases add
 * `"buyer" | "order" | "campaign" | …`; the exhaustive switch sites
 * (iconForType) MUST fail typecheck when a new member is added so the
 * handling is forced.
 */
export type SearchResultType =
  | "event"
  | "trip"
  | "experience"
  | "screen"
  | "setting"
  | "action";

/**
 * SPEC §3.1.3 — LOCKED, fixed render order:
 *   1. offerings → "Offerings"
 *   2. goto      → "Go to"
 *   3. settings  → "Settings & actions"
 */
export type SearchGroup = "offerings" | "goto" | "settings";

/** The field that produced a match (for ordering + optional debug). */
export type MatchedField = "title" | "keywords" | "location" | "body" | null;

/**
 * SPEC §3.1.1 — Normalized internal index entry. NOT the rendered result.
 * `searchText.*` is concatenated + normalized at index build and NEVER
 * rendered.
 */
export interface SearchIndexEntry {
  type: SearchResultType;
  /** entity id OR registry key. */
  id: string;
  /** primary display (offering title, or screen label). */
  title: string;
  /** secondary display (status • date, location, or registry description). */
  subtitle: string | null;
  /**
   * Resolved expo-router deep-link path.
   * - Offerings: produced by `routeForEventRow` (R-2 MANDATORY).
   * - Registry: a static string to a real standalone screen.
   */
  route: string;
  group: SearchGroup;
  /** minimum BRAND_ROLE_RANK required to SEE this entry (SPEC §3.6). */
  minRank: number;
  /** leading icon for the rendered row. */
  iconName: IconName;
  /**
   * For offerings: a recency key (ISO timestamp) used to break score ties
   * (newest first). Registry entries carry `null` (tie-broken by declaration
   * order, preserved by a stable sort).
   */
  recencyKey: string | null;
  /** searchable text — normalized once at index build. NEVER rendered. */
  searchText: {
    /** weight ×1.0 — highest. */
    title: string;
    /** weight ×0.9 — tags / synonyms (word-boundary). */
    keywords: string[];
    /** weight ×0.5 — description / long text (substring). */
    body: string | null;
    /** weight ×0.7 — location_text / address (medium). */
    location: string | null;
  };
}

/**
 * SPEC §3.1.4 — LOCKED rendered result. What the row component receives.
 */
export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  /** resolved deep-link (offerings via routeForEventRow; registry static). */
  route: string;
  group: SearchGroup;
  /** 0..1 — for ordering + optional debug. */
  score: number;
  matchedField: MatchedField;
  iconName: IconName;
}

/**
 * SPEC §3.5 — a static feature/settings registry item.
 * `route` is a static string to a real standalone screen (R-3). For
 * brand-scoped entries the `:brandId` placeholder is substituted at
 * index-build time; entries needing a brand id when none is present are
 * dropped (can't deep-link).
 */
export interface SearchRegistryItem {
  key: string;
  type: Extract<SearchResultType, "screen" | "setting" | "action">;
  title: string;
  /** one Mingla-voice line; LOCKED = present + accurate. */
  subtitle: string;
  /**
   * Route template. `:brandId` is substituted with the current brand id at
   * index build. A template containing `:brandId` is dropped when no brand
   * is loaded.
   */
  route: string;
  group: Extract<SearchGroup, "goto" | "settings">;
  minRank: number;
  synonyms: string[];
  iconName: IconName;
}
