/**
 * Global search — pure sheet-body state machine + row-press behavior.
 *
 * META-ORCH-1073 Sub-A. Extracts the component's decision logic into pure,
 * unit-testable functions (the mingla-business jest harness is node-env with
 * no @testing-library/react-native — see implementation report Discoveries).
 * The GlobalSearchSheet component is a thin renderer over these.
 *
 * Covers SPEC §3.7 states + DESIGN §8 (all 9 states) trigger logic, and the
 * row-press contract (close + pushRecent + router.push(route)).
 */

import {
  MIN_QUERY_LENGTH,
  searchIndexSafe,
  jumpToSuggestions,
  nearestSuggestions,
} from "./globalSearch";
import type { SearchIndexEntry, SearchResult } from "./types";

/** Discriminated body-state the sheet renders. */
export type SheetBodyState =
  | { kind: "empty"; recents: string[]; suggestions: SearchResult[] }
  | { kind: "populated"; results: SearchResult[] }
  | { kind: "zero"; query: string; suggestions: SearchResult[] }
  | { kind: "error" };

export interface ComputeBodyArgs {
  query: string;
  index: readonly SearchIndexEntry[];
  recents: readonly string[];
}

/**
 * Pure: decide which of the 9 states' bodies to render for the current
 * query + index. Loading/offline/submitting/degraded are presentation
 * concerns layered by the component (loading skeleton when a cache is still
 * fetching; degraded = an index that happens to be empty) — this function
 * resolves the query-driven core (empty / populated / zero / error).
 */
export function computeBodyState(args: ComputeBodyArgs): SheetBodyState {
  const trimmedLen = args.query.trim().length;

  if (trimmedLen < MIN_QUERY_LENGTH) {
    return {
      kind: "empty",
      recents: [...args.recents],
      suggestions: jumpToSuggestions(args.index),
    };
  }

  const outcome = searchIndexSafe(args.query, args.index);
  if (!outcome.ok) {
    return { kind: "error" };
  }
  if (outcome.results.length === 0) {
    return {
      kind: "zero",
      query: args.query,
      suggestions: nearestSuggestions(args.query, args.index),
    };
  }
  return { kind: "populated", results: outcome.results };
}

/**
 * Recents helper — MRU-ordered, deduped (case-insensitive on the trimmed
 * value), capped at `cap` (default 6). Pure (SPEC §3.4.1 pushRecent
 * semantics). Ephemeral — never persisted (R-4).
 */
export function pushRecent(
  recents: readonly string[],
  query: string,
  cap = 6,
): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...recents];
  const lower = trimmed.toLowerCase();
  const deduped = recents.filter((r) => r.trim().toLowerCase() !== lower);
  return [trimmed, ...deduped].slice(0, cap);
}

export interface RowPressEffects {
  route: string;
  /** the recents array after recording this query. */
  nextRecents: string[];
  /** whether the sheet should close. */
  shouldClose: true;
}

/**
 * Pure: the effects of pressing a result row — close the sheet, record the
 * query in recents (so reopening shows it), and navigate to the row's route.
 * The component applies these (router.push, store.pushRecent, store.close).
 */
export function rowPressEffects(
  result: Pick<SearchResult, "route">,
  query: string,
  recents: readonly string[],
): RowPressEffects {
  return {
    route: result.route,
    nextRecents: pushRecent(recents, query),
    shouldClose: true,
  };
}
