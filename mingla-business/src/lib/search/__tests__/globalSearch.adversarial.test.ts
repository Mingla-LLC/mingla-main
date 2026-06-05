/**
 * META-ORCH-1073 Sub-A — adversarial: role-gating, min-length, zero-result,
 * throw-safety, and the I-SEARCH-CLIENT-ONLY no-fetch static-import assertion.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  buildSearchIndex,
  filterIndexByRank,
  searchIndex,
  searchIndexSafe,
  nearestSuggestions,
  MIN_QUERY_LENGTH,
} from "../globalSearch";
import type { SearchIndexEntry } from "../types";

const BRAND_ID = "brand_xyz";

const registryOnlyIndex = (rank: number): SearchIndexEntry[] =>
  filterIndexByRank(
    buildSearchIndex({
      events: [],
      drafts: [],
      trips: [],
      experiences: [],
      brandId: BRAND_ID,
    }),
    rank,
  );

describe("adversarial — T-10 role gating (scanner rank 10)", () => {
  const SCANNER_RANK = 10;
  const index = registryOnlyIndex(SCANNER_RANK);

  test("scanner does NOT see Team (minRank 50)", () => {
    expect(searchIndex("team", index).some((r) => r.id === "brand-team")).toBe(
      false,
    );
  });

  test("scanner does NOT see Audit log (50), Pricing defaults (50), Delete account (60)", () => {
    expect(index.some((e) => e.id === "brand-audit-log")).toBe(false);
    expect(index.some((e) => e.id === "pricing-defaults")).toBe(false);
    expect(index.some((e) => e.id === "account-delete")).toBe(false);
  });

  test("delete-account query returns nothing for a scanner", () => {
    expect(searchIndex("delete account", index)).toEqual([]);
  });

  test("scanner DOES see Home / Notifications (minRank 10)", () => {
    expect(index.some((e) => e.id === "home")).toBe(true);
    expect(index.some((e) => e.id === "account-notifications")).toBe(true);
  });

  test("brand_owner (rank 60) sees the gated entries the scanner could not", () => {
    const ownerIndex = registryOnlyIndex(60);
    expect(ownerIndex.some((e) => e.id === "brand-team")).toBe(true);
    expect(ownerIndex.some((e) => e.id === "account-delete")).toBe(true);
  });
});

describe("adversarial — T-07 min length / T-08 zero result", () => {
  const index = registryOnlyIndex(60);

  test("1-char query returns [] (empty-state, not zero-result)", () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(searchIndex("a", index)).toEqual([]);
  });

  test("no-match query returns [] and nearest suggestions are ≤ 3", () => {
    expect(searchIndex("zzzqxq", index)).toEqual([]);
    const sugg = nearestSuggestions("paymet", index); // typo for "payment"
    expect(sugg.length).toBeLessThanOrEqual(3);
  });
});

describe("adversarial — T-15 throw safety", () => {
  test("searchIndexSafe returns {ok:false} when an entry is malformed", () => {
    // A malformed entry with a null searchText forces scoreMatch to throw.
    const broken = [
      { searchText: null } as unknown as SearchIndexEntry,
    ];
    const outcome = searchIndexSafe("anything", broken);
    expect(outcome.ok).toBe(false);
  });

  test("searchIndexSafe returns {ok:true} on a valid index", () => {
    const index = registryOnlyIndex(60);
    const outcome = searchIndexSafe("payments", index);
    expect(outcome.ok).toBe(true);
  });
});

describe("adversarial — T-11 / I-SEARCH-CLIENT-ONLY (no fetch in search path)", () => {
  const SEARCH_DIR = join(__dirname, "..");

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        yield* walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        yield full;
      }
    }
  }

  test("no module under src/lib/search imports a fetch dependency", () => {
    const banned = [
      "services/supabase",
      "../supabase",
      "@supabase/supabase-js",
    ];
    const offenders: string[] = [];
    for (const file of walk(SEARCH_DIR)) {
      const src = readFileSync(file, "utf8");
      for (const bad of banned) {
        if (src.includes(`from "${bad}"`) || src.includes(`require("${bad}")`)) {
          offenders.push(`${file} → ${bad}`);
        }
      }
      // also ban a literal fetch( call in the search path
      if (/\bfetch\s*\(/.test(src)) {
        offenders.push(`${file} → fetch(`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
