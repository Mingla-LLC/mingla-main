/**
 * Issue #1735 (umbrella #1734) — React Query key factory for the growth-tools
 * client scaffold (platform SPEC P-33; subject/watch leaves per #1735 G-4).
 *
 * Keyless module on the `brandKeys.ts` pattern: pure constants — no React, no
 * RN imports, no AuthContext import (safe from the require-cycle gate). Keys
 * are BRAND-FIRST so brand-prefix invalidation composes via react-query prefix
 * matching (the `venueIntelligenceKeys` precedent).
 *
 * State ownership (P-35, I-PROPOSED-1734-TOOL-RESULTS-NEVER-PERSISTED-CLIENT-SIDE):
 * everything keyed here lives in the React Query cache ONLY. No file under
 * `src/store/` may import this module — enforced by the strict-grep gate
 * `.github/scripts/strict-grep/issue-1734-tool-results-not-persisted.mjs`.
 */

/** The four engine tool values (`experiences` is the pricing engine's). */
export type GrowthToolName = "venues" | "events" | "trips" | "experiences";

export const growthToolsKeys = {
  all: ["growth-tools"] as const,
  brand: (brandId: string): readonly ["growth-tools", string] =>
    ["growth-tools", brandId] as const,
  /**
   * P-33 / #1008 — a run result for one input state. Callers pass their
   * canonical collision-free input key; a short hash is analytics-only.
   */
  run: (
    brandId: string,
    tool: GrowthToolName,
    inputKey: string,
  ): readonly ["growth-tools", string, "run", GrowthToolName, string] =>
    ["growth-tools", brandId, "run", tool, inputKey] as const,
  /**
   * P-42 — the latest-by-subject leaf (first standing surface lands it).
   * `subjectRef` is the full `venue:<id>` / `competitor:<id>` string; READS
   * may transmit it (P-43) — only WRITES must never compose it (P-41).
   */
  subject: (
    brandId: string,
    tool: GrowthToolName,
    subjectRef: string,
  ): readonly ["growth-tools", string, "subject", GrowthToolName, string] =>
    ["growth-tools", brandId, "subject", tool, subjectRef] as const,
  /**
   * The subject leaf + the `include_previous` flag — the ONE key every
   * latest-read observer (module instrument, Overview tile, to-do nudges,
   * competitor expansion) uses, so React Query dedupes instead of
   * double-fetching. Prefix-invalidating `subject(...)` hits both variants.
   */
  subjectRead: (
    brandId: string,
    tool: GrowthToolName,
    subjectRef: string,
    includePrevious: boolean,
  ): readonly [
    "growth-tools",
    string,
    "subject",
    GrowthToolName,
    string,
    "with-previous" | "latest",
  ] =>
    [
      ...growthToolsKeys.subject(brandId, tool, subjectRef),
      includePrevious ? "with-previous" : "latest",
    ] as const,
  /** #1735 G-4 — the competitor watch list of one venue. */
  watch: (
    brandId: string,
    venueListingId: string,
  ): readonly ["growth-tools", string, "watch", string] =>
    ["growth-tools", brandId, "watch", venueListingId] as const,
  brief: (
    brandId: string,
    watchId: string,
  ): readonly ["growth-tools", string, "brief", string] =>
    ["growth-tools", brandId, "brief", watchId] as const,
  /** #1735 G-10 — the add-sheet place-pool typeahead (P-46 app-lane search). */
  search: (
    brandId: string,
    q: string,
    city: string,
  ): readonly ["growth-tools", string, "search", string, string] =>
    ["growth-tools", brandId, "search", q, city] as const,
};
