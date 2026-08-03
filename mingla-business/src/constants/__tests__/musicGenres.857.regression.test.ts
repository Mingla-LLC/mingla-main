// issue #857 [more music genres] — implementor happy-path regression.
//
// Proves the taxonomy expansion (MUSIC_GENRES 14 -> 18: house, afro-house,
// amapiano, gospel — all Mingla-only, tmSlug: null) landed end-to-end and stays
// byte-parity-locked across the three canonical copies.
//
// FAILS-ON-REVERT (proven by TRUE line-deletion in the implementation report):
//   delete any of the 4 new { slug, label, tmSlug } entries from the taxonomy
//   copies → the presence/label/tmSlug checks, the length===18 check, the exact
//   canonical-order check, AND the byte-parity-across-three check all flip RED.

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MUSIC_GENRES, MUSIC_GENRE_SLUGS } from "../eventTaxonomy";

const NEW_GENRES = [
  { slug: "house", label: "House" },
  { slug: "afro-house", label: "Afro House" },
  { slug: "amapiano", label: "Amapiano" },
  { slug: "gospel", label: "Gospel" },
] as const;

// Canonical 18-slug order (house after electronic-edm; afro-house/amapiano/gospel
// after afrobeats; mixed-variety last). Mirrors eventTaxonomy.ts exactly.
const EXPECTED_ORDER = [
  "electronic-edm", "house", "hiphop-rap", "pop", "rock", "latin", "afrobeats",
  "afro-house", "amapiano", "gospel", "rnb-soul", "disco-funk", "reggae-dancehall",
  "indie", "country", "jazz", "classical", "mixed-variety",
] as const;

describe("issue #857 — MUSIC_GENRES expanded 14 -> 18", () => {
  test("contains the 4 new Mingla-only genres with exact labels + tmSlug null", () => {
    for (const { slug, label } of NEW_GENRES) {
      const entry = MUSIC_GENRES.find((g) => g.slug === slug);
      expect(entry).toBeDefined();
      expect(entry?.label).toBe(label);
      expect(entry?.tmSlug).toBeNull();
    }
  });

  test("length is 18 and mixed-variety is still last", () => {
    expect(MUSIC_GENRES.length).toBe(18);
    expect(MUSIC_GENRES[MUSIC_GENRES.length - 1]?.slug).toBe("mixed-variety");
  });

  test("exact canonical slug order", () => {
    expect([...MUSIC_GENRE_SLUGS]).toEqual([...EXPECTED_ORDER]);
  });

  test("MUSIC_GENRES block is byte-identical across all three taxonomy copies", () => {
    // __dirname = mingla-business/src/constants/__tests__ → repo root is 4 up.
    const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
    const COPIES = [
      "supabase/functions/_shared/eventTaxonomy.ts",
      "mingla-business/src/constants/eventTaxonomy.ts",
      "app-mobile/src/constants/eventTaxonomy.ts",
    ];
    const extractBlock = (src: string): string => {
      const m = src.match(/export const MUSIC_GENRES[\s\S]*?\] as const;/);
      if (!m) throw new Error("MUSIC_GENRES block not found");
      return m[0];
    };
    const blocks = COPIES.map((rel) =>
      extractBlock(readFileSync(join(REPO_ROOT, rel), "utf8")),
    );
    // All three copies byte-identical to the first (the ORCH-0824 parity contract).
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
    // The shared block actually carries the 4 new slugs (fails-on-revert anchor).
    for (const { slug } of NEW_GENRES) {
      expect(blocks[0]).toContain(`"${slug}"`);
    }
  });
});
