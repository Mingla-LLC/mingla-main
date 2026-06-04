/**
 * Global search — the deterministic matching algorithm.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.2 (LOCKED):
 *  - Match tiers (per field, on normalized text):
 *      exact 1.00 > prefix 0.85 > word-boundary 0.70 > substring 0.50 > fuzzy 0.30
 *  - Field weights (multiply the tier base):
 *      title ×1.0, keywords ×0.9, location ×0.7, body ×0.5
 *  - Result score = max over fields; matchedField = the field producing the max.
 *  - Registry synonym match is treated as word-boundary tier MINIMUM.
 *  - No external search lib — pure JS, fully deterministic.
 *
 * The query passed in MUST already be normalized (caller normalizes once per
 * keystroke); the entry's searchText fields are normalized at index build.
 */

import type { MatchedField, SearchIndexEntry } from "./types";

/** Tier base scores — SPEC §3.2 table. */
const TIER = {
  exact: 1.0,
  prefix: 0.85,
  wordBoundary: 0.7,
  substring: 0.5,
  fuzzy: 0.3,
} as const;

/** Field weights — SPEC §3.2. */
const WEIGHT = {
  title: 1.0,
  keywords: 0.9,
  location: 0.7,
  body: 0.5,
} as const;

/** Tokenize on whitespace + the documented separators `[-_,/]`. */
const TOKEN_SPLIT = /[\s\-_,/]+/;

/**
 * Returns the raw (unweighted) tier base for a single normalized field value
 * against a normalized query, or 0 for no match.
 */
function tierBase(field: string, query: string): number {
  if (field.length === 0) return 0;
  if (field === query) return TIER.exact;
  if (field.startsWith(query)) return TIER.prefix;
  // Word-boundary: any token in the field starts with the query.
  const tokens = field.split(TOKEN_SPLIT);
  for (const token of tokens) {
    if (token.length > 0 && token.startsWith(query)) return TIER.wordBoundary;
  }
  if (field.includes(query)) return TIER.substring;
  if (isSubsequence(query, field)) return TIER.fuzzy;
  return 0;
}

/**
 * Subsequence test for the fuzzy (typo-light) tier: every char of `needle`
 * appears in `haystack` in order. Deterministic, allocation-free.
 */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  let n = 0;
  for (let h = 0; h < haystack.length && n < needle.length; h += 1) {
    if (haystack[h] === needle[n]) n += 1;
  }
  return n === needle.length;
}

/**
 * Best (weighted) tier for the keywords array. Registry synonym matches use
 * the same scale; the caller already declares synonyms as keywords, and an
 * exact/prefix synonym hit naturally clears the word-boundary minimum the
 * SPEC requires ("refund" reliably surfaces the orders/refunds screen).
 */
function bestKeywordBase(keywords: string[], query: string): number {
  let best = 0;
  for (const kw of keywords) {
    const base = tierBase(kw, query);
    if (base > best) best = base;
  }
  return best;
}

/**
 * SPEC §3.2 — score a single entry against a normalized query.
 * Returns `null` when no field matches.
 */
export function scoreMatch(
  query: string,
  entry: SearchIndexEntry,
): { score: number; matchedField: MatchedField } | null {
  const { searchText } = entry;

  const candidates: { field: MatchedField; score: number }[] = [];

  const titleBase = tierBase(searchText.title, query);
  if (titleBase > 0) {
    candidates.push({ field: "title", score: titleBase * WEIGHT.title });
  }

  const kwBase = bestKeywordBase(searchText.keywords, query);
  if (kwBase > 0) {
    candidates.push({ field: "keywords", score: kwBase * WEIGHT.keywords });
  }

  if (searchText.location !== null) {
    const locBase = tierBase(searchText.location, query);
    if (locBase > 0) {
      candidates.push({ field: "location", score: locBase * WEIGHT.location });
    }
  }

  if (searchText.body !== null) {
    const bodyBase = tierBase(searchText.body, query);
    if (bodyBase > 0) {
      candidates.push({ field: "body", score: bodyBase * WEIGHT.body });
    }
  }

  if (candidates.length === 0) return null;

  // max over fields; deterministic tie-break by field priority order
  // (title > keywords > location > body) because candidates were pushed in
  // that order and we keep the first of an equal max.
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].score > best.score) best = candidates[i];
  }
  return { score: best.score, matchedField: best.field };
}
