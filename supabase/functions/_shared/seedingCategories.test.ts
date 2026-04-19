/**
 * Invariant + regression tests for seedingCategories.ts.
 *
 * Run:  deno test supabase/functions/_shared/seedingCategories.test.ts --allow-read --no-check
 *
 * Guards the four invariants enforced by validateSeedingCategories:
 *   INV-1: every type is in Google Table A
 *   INV-2: each type-restriction array ≤ 50 items
 *   INV-3: no type in both includedTypes and excludedPrimaryTypes of the same config
 *   INV-4: no duplicates within any array
 *
 * Plus explicit regression tests for the bugs fixed in the 2026-04-18 cleanup:
 *   - tobacco_shop (fake Google type)
 *   - drink self-contradiction (karaoke + live_music_venue in both lists)
 */

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  SEEDING_CATEGORIES,
  SEEDING_CATEGORY_MAP,
  ALL_SEEDING_CATEGORY_IDS,
  resolveCategoriesToConfigs,
  resolveSeedingCategory,
} from './seedingCategories.ts';
import {
  GOOGLE_TYPE_RESTRICTION_MAX,
  isValidGoogleType,
} from './googlePlaceTypes.ts';

// ── INV-1: Table A membership ────────────────────────────────────────────────

Deno.test('INV-1: every includedTypes entry is a valid Google Table A type', () => {
  for (const c of SEEDING_CATEGORIES) {
    for (const t of c.includedTypes) {
      assertStrictEquals(
        isValidGoogleType(t),
        true,
        `[${c.id}] includedTypes contains invalid Google type: "${t}"`,
      );
    }
  }
});

Deno.test('INV-1: every excludedPrimaryTypes entry is a valid Google Table A type', () => {
  for (const c of SEEDING_CATEGORIES) {
    for (const t of c.excludedPrimaryTypes) {
      assertStrictEquals(
        isValidGoogleType(t),
        true,
        `[${c.id}] excludedPrimaryTypes contains invalid Google type: "${t}"`,
      );
    }
  }
});

// ── INV-2: 50-item cap ───────────────────────────────────────────────────────

Deno.test('INV-2: includedTypes.length <= 50', () => {
  for (const c of SEEDING_CATEGORIES) {
    const n = c.includedTypes.length;
    if (n > GOOGLE_TYPE_RESTRICTION_MAX) {
      throw new Error(`[${c.id}] includedTypes has ${n} items (max ${GOOGLE_TYPE_RESTRICTION_MAX})`);
    }
  }
});

Deno.test('INV-2: excludedPrimaryTypes.length <= 50', () => {
  for (const c of SEEDING_CATEGORIES) {
    const n = c.excludedPrimaryTypes.length;
    if (n > GOOGLE_TYPE_RESTRICTION_MAX) {
      throw new Error(`[${c.id}] excludedPrimaryTypes has ${n} items (max ${GOOGLE_TYPE_RESTRICTION_MAX})`);
    }
  }
});

// ── INV-3: includedTypes ∩ excludedPrimaryTypes = ∅ ─────────────────────────

Deno.test('INV-3: includedTypes and excludedPrimaryTypes are disjoint per config', () => {
  for (const c of SEEDING_CATEGORIES) {
    const included = new Set(c.includedTypes);
    for (const t of c.excludedPrimaryTypes) {
      if (included.has(t)) {
        throw new Error(`[${c.id}] "${t}" appears in BOTH includedTypes and excludedPrimaryTypes`);
      }
    }
  }
});

// ── INV-4: no duplicates within any array ───────────────────────────────────

Deno.test('INV-4: no duplicate entries in includedTypes', () => {
  for (const c of SEEDING_CATEGORIES) {
    const seen = new Set<string>();
    for (const t of c.includedTypes) {
      if (seen.has(t)) throw new Error(`[${c.id}] includedTypes has duplicate: "${t}"`);
      seen.add(t);
    }
  }
});

Deno.test('INV-4: no duplicate entries in excludedPrimaryTypes', () => {
  for (const c of SEEDING_CATEGORIES) {
    const seen = new Set<string>();
    for (const t of c.excludedPrimaryTypes) {
      if (seen.has(t)) throw new Error(`[${c.id}] excludedPrimaryTypes has duplicate: "${t}"`);
      seen.add(t);
    }
  }
});

// ── Regression tests for the 2026-04-18 cleanup ─────────────────────────────

Deno.test('regression: tobacco_shop never reappears anywhere', () => {
  for (const c of SEEDING_CATEGORIES) {
    assertStrictEquals(
      c.includedTypes.includes('tobacco_shop'),
      false,
      `[${c.id}] has tobacco_shop in includedTypes`,
    );
    assertStrictEquals(
      c.excludedPrimaryTypes.includes('tobacco_shop'),
      false,
      `[${c.id}] has tobacco_shop in excludedPrimaryTypes`,
    );
  }
});

Deno.test('regression: drink config includes karaoke + live_music_venue and does NOT exclude them', () => {
  const drink = SEEDING_CATEGORY_MAP['drink'];
  assertStrictEquals(drink !== undefined, true, 'drink config must exist');
  assertStrictEquals(drink.includedTypes.includes('karaoke'), true, 'drink must include karaoke');
  assertStrictEquals(drink.includedTypes.includes('live_music_venue'), true, 'drink must include live_music_venue');
  assertStrictEquals(drink.excludedPrimaryTypes.includes('karaoke'), false, 'drink must NOT exclude karaoke');
  assertStrictEquals(drink.excludedPrimaryTypes.includes('live_music_venue'), false, 'drink must NOT exclude live_music_venue');
});

// ── Structural tests ────────────────────────────────────────────────────────

Deno.test('structural: all 14 configs present (ORCH-0460 split)', () => {
  assertEquals(SEEDING_CATEGORIES.length, 14);
  assertEquals(ALL_SEEDING_CATEGORY_IDS.length, 14);
});

Deno.test('resolver: resolveCategoriesToConfigs works for new app slugs', () => {
  const nature = resolveCategoriesToConfigs(['nature']);
  assertEquals(nature.length, 2);
  const brunch = resolveCategoriesToConfigs(['brunch_lunch_casual']);
  assertEquals(brunch.length, 3);
});

Deno.test('resolver: resolveSeedingCategory works for both old IDs and new slugs', () => {
  assertStrictEquals(resolveSeedingCategory('nature_views')?.id, 'nature_views');
  assertStrictEquals(resolveSeedingCategory('nature')?.appCategorySlug, 'nature');
});
