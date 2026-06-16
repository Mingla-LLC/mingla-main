// ORCH-1146 [experience-parser field completeness]
// Helper + normalizer unit tests (mingla-implementor side).
//
// Covers:
//   T4  (helper) — >4 mappable tags: capped at 4, deduped, canonical order
//   T8  (no-fabrication) — Ve5/Ve6 normalizers leave is_free / suggested_time_of_day
//        null when absent from the raw payload
//   helper edge — Play-vocab + free-text + already-canonical id passthrough
//   de-GBP — normalizers do NOT inject "GBP" when no defaultCurrency is passed

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANONICAL_EXPERIENCE_INTENTS,
  mapToCanonicalExperienceIntents,
} from "../canonicalExperienceIntents.ts";
import { normalizeMenuParsePayload } from "../geminiMenuParser.ts";
import { normalizeActivitiesParsePayload } from "../geminiActivitiesParser.ts";

// ── helper: the canonical id list is exactly the 4 the DB CHECK enforces ─────
Deno.test("ORCH-1146 helper: canonical list is exactly the 4 CHECK ids in order", () => {
  assertEquals(
    [...CANONICAL_EXPERIENCE_INTENTS],
    ["adventurous", "first-date", "romantic", "group-fun"],
  );
});

// ── T4: >4 mappable tags → capped at 4, deduped, canonical order ─────────────
Deno.test("ORCH-1146 T4: >4 mappable tags capped/deduped/ordered", () => {
  const out = mapToCanonicalExperienceIntents(
    [
      "group_activity", // group-fun
      "friends_chill", // group-fun (dup)
      "date_night_active", // romantic
      "solo_exploration", // adventurous
      "first_date", // first-date
      "family_friendly", // group-fun (dup)
    ],
    "play",
  );
  // All 4 ids present, deduped, in canonical order, capped at 4.
  assertEquals(out, ["adventurous", "first-date", "romantic", "group-fun"]);
});

// ── helper: Play LOCKED mappings (Q1) ────────────────────────────────────────
Deno.test("ORCH-1146 helper: family_friendly→group-fun, solo_exploration→adventurous", () => {
  assertEquals(mapToCanonicalExperienceIntents(["family_friendly"], "play"), [
    "group-fun",
  ]);
  assertEquals(mapToCanonicalExperienceIntents(["solo_exploration"], "play"), [
    "adventurous",
  ]);
});

// ── helper: free-text keyword mapping (Ve5), first-match by rule order ────────
Deno.test("ORCH-1146 helper: free-text keywords map by rule order (romantic wins over group)", () => {
  // 'tasting_menu' matches romantic; 'bottomless brunch' matches group-fun.
  assertEquals(
    mapToCanonicalExperienceIntents(["tasting menu", "bottomless brunch"], "restaurant"),
    ["romantic", "group-fun"],
  );
  // 'explore the city' → adventurous.
  assertEquals(
    mapToCanonicalExperienceIntents(["explore the city"], "restaurant"),
    ["adventurous"],
  );
});

// ── helper: unmappable → [] (caller writes NULL) ─────────────────────────────
Deno.test("ORCH-1146 helper: unmappable tags → empty array", () => {
  assertEquals(mapToCanonicalExperienceIntents(["gluten_free", "vegan"], "restaurant"), []);
  assertEquals(mapToCanonicalExperienceIntents(null, null), []);
  assertEquals(mapToCanonicalExperienceIntents("not-an-array", null), []);
});

// ── helper: an already-canonical id passes through ───────────────────────────
Deno.test("ORCH-1146 helper: already-canonical ids pass through (Ari direct)", () => {
  assertEquals(
    mapToCanonicalExperienceIntents(["group-fun", "romantic"], null),
    ["romantic", "group-fun"], // re-ordered to canonical order
  );
});

// ── T8: Ve5 normalizer leaves is_free / time-of-day null when absent ─────────
Deno.test("ORCH-1146 T8: Ve5 normalizer — no is_free/time → null (no fabrication)", () => {
  const out = normalizeMenuParsePayload({
    experiences: [{ title: "Brunch", narrative: "Eggs and toast." }],
  }, "USD");
  assertEquals(out.length, 1);
  assertEquals(out[0].is_free, null);
  assertEquals(out[0].suggested_time_of_day, null);
});

// ── T8: Ve5 normalizer keeps explicit is_free / time-of-day ─────────────────
Deno.test("ORCH-1146 T8b: Ve5 normalizer keeps explicit is_free=true + serving window", () => {
  const out = normalizeMenuParsePayload({
    experiences: [{
      title: "Free entry happy hour",
      narrative: "No cover charge.",
      is_free: true,
      suggested_time_of_day: "happy hour 4-6pm",
    }],
  }, "USD");
  assertEquals(out[0].is_free, true);
  assertEquals(out[0].suggested_time_of_day, "happy hour 4-6pm");
});

// ── T8: Ve6 normalizer leaves is_free null when absent ──────────────────────
Deno.test("ORCH-1146 T8c: Ve6 normalizer — no is_free → null (no fabrication)", () => {
  const out = normalizeActivitiesParsePayload({
    experiences: [{
      title: "Lane for 4",
      narrative: "Bowling lane.",
      intent_tags: ["group_activity"],
    }],
  }, "USD");
  assertEquals(out[0].is_free, null);
});

Deno.test("ORCH-1146 T8d: Ve6 normalizer keeps explicit is_free=true", () => {
  const out = normalizeActivitiesParsePayload({
    experiences: [{
      title: "Free play hour",
      narrative: "Free arcade hour.",
      intent_tags: ["group_activity"],
      is_free: true,
    }],
  }, "USD");
  assertEquals(out[0].is_free, true);
});

// ── de-GBP: no default arg → empty currency (NOT 'GBP') ──────────────────────
Deno.test("ORCH-1146 de-GBP: normalizers never inject 'GBP' when defaultCurrency unset", () => {
  const menu = normalizeMenuParsePayload({
    experiences: [{ title: "X", narrative: "Y" }],
  });
  assertEquals(menu[0].currency, ""); // empty, not 'GBP'
  const play = normalizeActivitiesParsePayload({
    experiences: [{ title: "X", narrative: "Y", intent_tags: ["group_activity"] }],
  });
  assertEquals(play[0].currency, "");
});
