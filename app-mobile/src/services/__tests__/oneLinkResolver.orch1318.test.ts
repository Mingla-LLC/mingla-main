// @ts-nocheck
// ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — resolveOneLinkDestination
// table-driven regression (SPEC §B.7). oneLinkResolver.ts is a PURE module (zero
// RN deps), so the whole payload→destination contract runs headless under Deno.
//
// Run:
//   deno test --no-check app-mobile/src/services/__tests__/oneLinkResolver.orch1318.test.ts
//
// FAILS-ON-REVERT: this is the fails-on-revert guard for the ONE resolver
// (I-ONELINK-SINGLE-RESOLVER). If entity payloads are re-routed through the
// deepLinkService shortcut (which returns null for /e,/t,/exp) or the resolver's
// discriminator mapping is changed, the entity-route assertions below fail.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveOneLinkDestination } from "../oneLinkResolver.ts";

type Case = {
  name: string;
  data: Record<string, unknown>;
  expected: unknown;
};

// ── Every deep_link_value case + af_sub1 piggyback (SPEC §B.1) ────────────────
const FOUND_CASES: Case[] = [
  {
    name: "brand → entity brand",
    data: { deep_link_value: "brand", deep_link_sub1: "sunset-collective" },
    expected: { kind: "entity", entity: "brand", brandSlug: "sunset-collective" },
  },
  {
    name: "brand + af_sub1 → entity brand w/ referralCode",
    data: { deep_link_value: "brand", deep_link_sub1: "sunset-collective", af_sub1: "SETH-8Q2" },
    expected: {
      kind: "entity",
      entity: "brand",
      brandSlug: "sunset-collective",
      referralCode: "SETH-8Q2",
    },
  },
  {
    name: "event → entity event w/ entitySlug",
    data: { deep_link_value: "event", deep_link_sub1: "sunset-collective", deep_link_sub2: "rooftop-nye" },
    expected: {
      kind: "entity",
      entity: "event",
      brandSlug: "sunset-collective",
      entitySlug: "rooftop-nye",
    },
  },
  {
    name: "trip → entity trip w/ entitySlug",
    data: { deep_link_value: "trip", deep_link_sub1: "sunset-collective", deep_link_sub2: "bali-2026" },
    expected: {
      kind: "entity",
      entity: "trip",
      brandSlug: "sunset-collective",
      entitySlug: "bali-2026",
    },
  },
  {
    name: "experience + af_sub1 → entity experience w/ referralCode",
    data: {
      deep_link_value: "experience",
      deep_link_sub1: "sunset-collective",
      deep_link_sub2: "pottery-class",
      af_sub1: "SETH-8Q2",
    },
    expected: {
      kind: "entity",
      entity: "experience",
      brandSlug: "sunset-collective",
      entitySlug: "pottery-class",
      referralCode: "SETH-8Q2",
    },
  },
  {
    name: "referral → referral",
    data: { deep_link_value: "referral", deep_link_sub1: "SETH-8Q2" },
    expected: { kind: "referral", referralCode: "SETH-8Q2" },
  },
  {
    name: "internal (mingla:// path) → internal",
    data: { deep_link_value: "internal", deep_link_sub1: "mingla://discover?paired=true" },
    expected: { kind: "internal", url: "mingla://discover?paired=true" },
  },
  {
    name: "missing deep_link_value w/ sub1 → internal (falls to deepLinkService)",
    data: { deep_link_sub1: "mingla://home" },
    expected: { kind: "internal", url: "mingla://home" },
  },
  {
    name: "case/whitespace normalized (EVENT + padding)",
    data: { deep_link_value: "  EVENT ", deep_link_sub1: " brand ", deep_link_sub2: " ev " },
    expected: { kind: "entity", entity: "event", brandSlug: "brand", entitySlug: "ev" },
  },
];

// ── Null cases: half-formed / unknown / empty (SPEC §B.2, §B.5.1) ─────────────
const NULL_CASES: Case[] = [
  {
    name: "event with NO sub2 → null (never /e/brand/undefined)",
    data: { deep_link_value: "event", deep_link_sub1: "brand" },
    expected: null,
  },
  { name: "trip with NO sub1 → null", data: { deep_link_value: "trip", deep_link_sub2: "x" }, expected: null },
  { name: "brand with NO sub1 → null", data: { deep_link_value: "brand" }, expected: null },
  { name: "referral with NO sub1 → null", data: { deep_link_value: "referral" }, expected: null },
  { name: "internal with NO sub1 → null", data: { deep_link_value: "internal" }, expected: null },
  { name: "unknown discriminator → null", data: { deep_link_value: "coupon", deep_link_sub1: "x" }, expected: null },
  { name: "empty payload → null", data: {}, expected: null },
];

for (const c of [...FOUND_CASES, ...NULL_CASES]) {
  Deno.test(`ORCH-1318 resolveOneLinkDestination: ${c.name}`, () => {
    assertEquals(resolveOneLinkDestination(c.data as Record<string, any>), c.expected as any);
  });
}

// ── Guard: entity payloads DO NOT collapse to a mingla:// internal shortcut ───
// This is the direct fails-on-revert for the two-nav reconciliation: an event
// payload MUST resolve to an expo-router entity destination, not an internal one.
Deno.test("ORCH-1318 entity payloads never resolve to kind:'internal'", () => {
  for (const value of ["brand", "event", "trip", "experience"]) {
    const dest = resolveOneLinkDestination({
      deep_link_value: value,
      deep_link_sub1: "b",
      deep_link_sub2: "e",
    });
    assertEquals(dest?.kind, "entity");
  }
});
