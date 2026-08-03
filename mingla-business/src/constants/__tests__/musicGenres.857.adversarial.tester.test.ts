// issue #857 [more music genres] — TESTER ADVERSARIAL regression.
//
// DIFFERENT ANGLE from the implementor happy-path
// (musicGenres.857.regression.test.ts, which asserts PRESENCE + LABELS +
// tmSlug=null + byte-parity across the 3 TS copies + length===18). This suite
// attacks the ENFORCEMENT-SURFACE angle the happy-path never touches:
//
//   1. CROSS-SURFACE DRIFT (the real bug class here): the SET of music-genre
//      slugs must be EXACTLY EQUAL across ALL FOUR enforcement surfaces —
//        (A) MUSIC_GENRE_SLUGS from the TS taxonomy (imported),
//        (B) the events_music_genres_canonical CHECK constraint array in the
//            new migration .sql,
//        (C) the v_music_genres canonical array inside BOTH RPCs in the same
//            migration (business_publish_event_draft + business_publish_rsvp_draft),
//        (D) the music-genre keys in packages/offering-rendering/taxonomyLabels.ts.
//      A genre added to TS but forgotten in the SQL (or vice-versa) → RED.
//      This is a SET-equality assertion, not a count.
//
//   2. TM-SUPPRESSION SEMANTICS (mapMinglaMusicGenresToTmSlugs): the 4 new
//      genres are Mingla-only (tmSlug null) → they must land in `minglaOnly`
//      and NEVER leak a TM slug into `tmMappable`; a MIXED input still forwards
//      the genuinely TM-mapped genres. A bogus slug is dropped from BOTH buckets.
//
//   3. BOUNDARY / NEGATIVE canonicalness: a non-canonical genre ('techno') is
//      absent from the TS set AND from every migration array — proving the
//      expansion did NOT widen the `music_genres_not_canonical` gate to
//      arbitrary values.
//
// FAILS-ON-REVERT (drift assertion): delete any one genre from ONE surface only
//   — e.g. remove 'gospel' from mingla-business/src/constants/eventTaxonomy.ts —
//   and the imported MUSIC_GENRE_SLUGS set (17) no longer equals the SQL/label
//   sets (18): the set-equality assertions in describe-block #1 flip RED. Proven
//   by true line-deletion + restore (hashes in the QA report).

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MUSIC_GENRE_SLUGS,
  MUSIC_GENRES,
  mapMinglaMusicGenresToTmSlugs,
} from "../eventTaxonomy";

// __dirname = mingla-business/src/constants/__tests__ → repo root is 4 up.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION_REL =
  "supabase/migrations/20270112000000_issue_857_add_music_genres.sql";
const LABELS_REL = "packages/offering-rendering/taxonomyLabels.ts";

// The absolute canonical 18-slug set (issue #857: 14 -> 18). Pinned here so a
// drift applied UNIFORMLY to every surface (e.g. a slug renamed everywhere) is
// still caught against this independent anchor.
const EXPECTED_18 = [
  "electronic-edm", "house", "hiphop-rap", "pop", "rock", "latin", "afrobeats",
  "afro-house", "amapiano", "gospel", "rnb-soul", "disco-funk", "reggae-dancehall",
  "indie", "country", "jazz", "classical", "mixed-variety",
] as const;

const NEW_GENRES = ["house", "afro-house", "amapiano", "gospel"] as const;

// ---- helpers ----------------------------------------------------------------
const sorted = (s: Iterable<string>): string[] => [...new Set(s)].sort();

/** Pull every 'quoted-slug' token out of a captured ARRAY[...] group. */
const slugsFromArray = (group: string): string[] =>
  (group.match(/'([^']+)'/g) ?? []).map((t) => t.slice(1, -1));

const readRepo = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

// ─────────────────── 1. cross-surface drift (set equality) ───────────────────

describe("issue #857 — music-genre slug SET is identical across all 4 enforcement surfaces", () => {
  const sql = readRepo(MIGRATION_REL);
  const labelsSrc = readRepo(LABELS_REL);

  // (A) TS taxonomy (imported).
  const tsSet = new Set(MUSIC_GENRE_SLUGS);

  // (B) events_music_genres_canonical CHECK constraint array.
  const checkMatch = sql.match(
    /events_music_genres_canonical\s+CHECK\s*\(\s*music_genres\s*<@\s*ARRAY\s*\[([\s\S]*?)\]::text\[\]/,
  );

  // (C) the v_music_genres array inside EACH named RPC (function-scoped so the
  // test proves BOTH RPCs specifically carry the 18-slug set).
  const eventIdx = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.business_publish_event_draft",
  );
  const rsvpIdx = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.business_publish_rsvp_draft",
  );
  const rpcArrayFrom = (body: string): string[] => {
    const m = body.match(
      /v_music_genres\s*<@\s*ARRAY\s*\[([\s\S]*?)\]::text\[\]/,
    );
    if (!m) throw new Error("v_music_genres canonical array not found in RPC body");
    return slugsFromArray(m[1]);
  };

  // (D) music-genre keys in taxonomyLabels.ts (isolate the MUSIC_GENRES block).
  const musicBlockMatch = labelsSrc.match(/\/\/ MUSIC_GENRES[\s\S]*?\n\};/);

  test("the imported TS set is exactly the canonical 18 (absolute anchor)", () => {
    expect(sorted(tsSet)).toEqual(sorted(EXPECTED_18));
    expect(tsSet.size).toBe(18);
  });

  test("(B) migration CHECK constraint array === TS set", () => {
    expect(checkMatch).not.toBeNull();
    const checkSet = new Set(slugsFromArray(checkMatch![1]));
    expect(sorted(checkSet)).toEqual(sorted(tsSet));
  });

  test("(C) BOTH RPC v_music_genres arrays exist and each === TS set", () => {
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(rsvpIdx).toBeGreaterThanOrEqual(0);
    expect(eventIdx).toBeLessThan(rsvpIdx);

    const eventRpcSet = new Set(rpcArrayFrom(sql.slice(eventIdx, rsvpIdx)));
    const rsvpRpcSet = new Set(rpcArrayFrom(sql.slice(rsvpIdx)));

    expect(sorted(eventRpcSet)).toEqual(sorted(tsSet)); // business_publish_event_draft
    expect(sorted(rsvpRpcSet)).toEqual(sorted(tsSet)); // business_publish_rsvp_draft

    // Exactly TWO RPC arrays in the whole migration — no third silent surface.
    const allRpcArrays = sql.match(/v_music_genres\s*<@\s*ARRAY/g) ?? [];
    expect(allRpcArrays.length).toBe(2);
  });

  test("(D) taxonomyLabels.ts music-genre keys === TS set", () => {
    expect(musicBlockMatch).not.toBeNull();
    const labelKeys = (musicBlockMatch![0].match(/"([^"]+)"\s*:/g) ?? []).map(
      (k) => k.replace(/"([^"]+)"\s*:/, "$1"),
    );
    expect(sorted(labelKeys)).toEqual(sorted(tsSet));
    expect(labelKeys.length).toBe(18);
  });

  test("ALL FOUR surfaces collapse to one identical 18-member set", () => {
    const checkSet = new Set(slugsFromArray(checkMatch![1]));
    const eventRpcSet = new Set(rpcArrayFrom(sql.slice(eventIdx, rsvpIdx)));
    const rsvpRpcSet = new Set(rpcArrayFrom(sql.slice(rsvpIdx)));
    const labelKeys = (musicBlockMatch![0].match(/"([^"]+)"\s*:/g) ?? []).map(
      (k) => k.replace(/"([^"]+)"\s*:/, "$1"),
    );
    const anchor = sorted(EXPECTED_18);
    for (const s of [tsSet, checkSet, eventRpcSet, rsvpRpcSet, new Set(labelKeys)]) {
      expect(sorted(s)).toEqual(anchor);
    }
  });
});

// ─────────────────── 2. TM-suppression semantics ───────────────────

describe("issue #857 — mapMinglaMusicGenresToTmSlugs suppresses the new Mingla-only genres", () => {
  test("each new genre is tmSlug:null in MUSIC_GENRES (the mapper's source of truth)", () => {
    for (const slug of NEW_GENRES) {
      const entry = MUSIC_GENRES.find((g) => g.slug === slug);
      expect(entry).toBeDefined();
      expect(entry?.tmSlug).toBeNull();
    }
  });

  test("each new genre alone → minglaOnly=[slug], tmMappable=[] (TM fully suppressed)", () => {
    for (const slug of NEW_GENRES) {
      const { tmMappable, minglaOnly } = mapMinglaMusicGenresToTmSlugs([slug]);
      expect(minglaOnly).toEqual([slug]);
      expect(tmMappable).toEqual([]);
    }
  });

  test("MIXED input: new Mingla-only genre suppressed, TM-mapped genres still forwarded", () => {
    // 'house' (null) → minglaOnly; 'pop' (tm 'pop') + 'afrobeats' (tm 'afro')
    // → tmMappable carries the TM slugs, NOT the Mingla slugs.
    const { tmMappable, minglaOnly } = mapMinglaMusicGenresToTmSlugs([
      "house",
      "pop",
      "afrobeats",
    ]);
    expect(minglaOnly).toEqual(["house"]);
    expect(tmMappable).toEqual(["pop", "afro"]);
    // The new Mingla-only genre must NEVER leak into the TM forward.
    expect(tmMappable).not.toContain("house");
    expect(minglaOnly).not.toContain("pop");
    expect(minglaOnly).not.toContain("afro");
  });

  test("MIXED input with TWO new genres → both suppressed, one TM genre forwarded", () => {
    const { tmMappable, minglaOnly } = mapMinglaMusicGenresToTmSlugs([
      "amapiano",
      "gospel",
      "rock",
    ]);
    expect(minglaOnly).toEqual(["amapiano", "gospel"]);
    expect(tmMappable).toEqual(["rock"]);
  });

  test("NEGATIVE: a bogus slug ('techno') is ignored — in NEITHER bucket", () => {
    const bogus = mapMinglaMusicGenresToTmSlugs(["techno"]);
    expect(bogus.tmMappable).toEqual([]);
    expect(bogus.minglaOnly).toEqual([]);

    // and it never poisons a valid mixed input.
    const mixed = mapMinglaMusicGenresToTmSlugs(["house", "techno", "pop"]);
    expect(mixed.minglaOnly).toEqual(["house"]);
    expect(mixed.tmMappable).toEqual(["pop"]);
  });
});

// ─────────────────── 3. boundary / negative canonicalness ───────────────────

describe("issue #857 — the expansion did NOT widen the canonical gate", () => {
  const sql = readRepo(MIGRATION_REL);
  const NON_CANONICAL = "techno";

  test("'techno' is absent from the TS taxonomy set", () => {
    expect(new Set(MUSIC_GENRE_SLUGS).has(NON_CANONICAL)).toBe(false);
  });

  test("'techno' is absent from the CHECK constraint AND both RPC arrays (would be rejected)", () => {
    const checkMatch = sql.match(
      /events_music_genres_canonical\s+CHECK\s*\(\s*music_genres\s*<@\s*ARRAY\s*\[([\s\S]*?)\]::text\[\]/,
    );
    expect(checkMatch).not.toBeNull();
    expect(slugsFromArray(checkMatch![1])).not.toContain(NON_CANONICAL);

    const rpcArrays = sql.match(
      /v_music_genres\s*<@\s*ARRAY\s*\[([\s\S]*?)\]::text\[\]/g,
    ) ?? [];
    expect(rpcArrays.length).toBe(2);
    for (const arr of rpcArrays) {
      expect(slugsFromArray(arr)).not.toContain(NON_CANONICAL);
    }
    // Prove the rejection MECHANISM is actually present in the migration.
    expect(sql).toContain("music_genres_not_canonical");
  });
});
