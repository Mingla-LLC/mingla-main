// @ts-nocheck — Deno-runtime suite (deno.land import); the app-mobile tsc
// sweep has no Deno types (house convention — see oneLinkResolver.orch1318.test.ts).
//
// ORCH-1342 [web-see-whos-going-funnel] — resolver landing-discriminator
// regression (SPEC §4.5 / §7 T-1). NEW FILE: the ORCH-1318 suite stays green
// UNMODIFIED (tests-append-only); every landing assertion lives here.
//
// Run:
//   deno test --no-check app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts
//
// FAILS-ON-REVERT: deleting the resolver's deep_link_sub3 parse makes the
// happy-path rows FAIL (landing key absent); loosening the exact-match makes
// the garbage/uppercase rows FAIL (landing key present when it must not be).
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveOneLinkDestination } from "../oneLinkResolver.ts";

type Case = {
  name: string;
  data: Record<string, unknown>;
  expected: unknown;
};

const CASES: Case[] = [
  // ── Happy path: exact lowercase token → landing on every non-brand entity ──
  {
    name: "event + sub3 'guest-list' → landing present",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: "guest-list",
    },
    expected: {
      kind: "entity",
      entity: "event",
      brandSlug: "b",
      entitySlug: "s",
      landing: "guest-list",
    },
  },
  {
    name: "trip + sub3 'guest-list' → landing present",
    data: {
      deep_link_value: "trip",
      deep_link_sub1: "b",
      deep_link_sub2: "t",
      deep_link_sub3: "guest-list",
    },
    expected: {
      kind: "entity",
      entity: "trip",
      brandSlug: "b",
      entitySlug: "t",
      landing: "guest-list",
    },
  },
  {
    name: "experience + sub3 'guest-list' → landing present",
    data: {
      deep_link_value: "experience",
      deep_link_sub1: "b",
      deep_link_sub2: "x",
      deep_link_sub3: "guest-list",
    },
    expected: {
      kind: "entity",
      entity: "experience",
      brandSlug: "b",
      entitySlug: "x",
      landing: "guest-list",
    },
  },
  {
    name: "landing + af_sub1 referral piggyback coexist",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: "guest-list",
      af_sub1: "REF9",
    },
    expected: {
      kind: "entity",
      entity: "event",
      brandSlug: "b",
      entitySlug: "s",
      referralCode: "REF9",
      landing: "guest-list",
    },
  },
  {
    name: "sub3 ' guest-list ' (whitespace) trims to the exact token → landing",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: " guest-list ",
    },
    expected: {
      kind: "entity",
      entity: "event",
      brandSlug: "b",
      entitySlug: "s",
      landing: "guest-list",
    },
  },

  // ── Graceful degrade: absent/garbage/case variants → field OMITTED, entity
  //    destination BYTE-IDENTICAL to pre-1342 (T-A1) ──
  {
    name: "absent sub3 → legacy destination, no landing key",
    data: { deep_link_value: "event", deep_link_sub1: "b", deep_link_sub2: "s" },
    expected: { kind: "entity", entity: "event", brandSlug: "b", entitySlug: "s" },
  },
  {
    name: "garbage sub3 'banana' → no landing key, entity still resolves",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: "banana",
    },
    expected: { kind: "entity", entity: "event", brandSlug: "b", entitySlug: "s" },
  },
  {
    name: "uppercase 'GUEST-LIST' is NOT the exact lowercase token → omitted",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: "GUEST-LIST",
    },
    expected: { kind: "entity", entity: "event", brandSlug: "b", entitySlug: "s" },
  },
  {
    name: "future token 'chat' → omitted (forward-compatible degrade)",
    data: {
      deep_link_value: "trip",
      deep_link_sub1: "b",
      deep_link_sub2: "t",
      deep_link_sub3: "chat",
    },
    expected: { kind: "entity", entity: "trip", brandSlug: "b", entitySlug: "t" },
  },
  {
    name: "non-string sub3 (number) → omitted, never throws",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub2: "s",
      deep_link_sub3: 42,
    },
    expected: { kind: "entity", entity: "event", brandSlug: "b", entitySlug: "s" },
  },

  // ── Brand ignores sub3 (a guest list is event-scoped — §4.5) ──
  {
    name: "brand + sub3 'guest-list' → brand destination, NO landing key",
    data: {
      deep_link_value: "brand",
      deep_link_sub1: "b",
      deep_link_sub3: "guest-list",
    },
    expected: { kind: "entity", entity: "brand", brandSlug: "b" },
  },

  // ── Half-formed stays null: a landing never rescues a broken link ──
  {
    name: "missing sub2 + sub3 'guest-list' → still null (never half-formed)",
    data: {
      deep_link_value: "event",
      deep_link_sub1: "b",
      deep_link_sub3: "guest-list",
    },
    expected: null,
  },
  {
    name: "referral kind unaffected by sub3",
    data: {
      deep_link_value: "referral",
      deep_link_sub1: "CODE1",
      deep_link_sub3: "guest-list",
    },
    expected: { kind: "referral", referralCode: "CODE1" },
  },
];

for (const c of CASES) {
  Deno.test(`ORCH-1342 T-1: ${c.name}`, () => {
    assertEquals(resolveOneLinkDestination(c.data), c.expected);
  });
}

// Byte-identity guard (SPEC §4.5): the WHOLE key set of a legacy payload's
// destination must be exactly the pre-1342 keys (no stray landing/undefined).
Deno.test("ORCH-1342 T-1: legacy payload destination carries EXACTLY the pre-1342 keys", () => {
  const dest = resolveOneLinkDestination({
    deep_link_value: "event",
    deep_link_sub1: "b",
    deep_link_sub2: "s",
  }) as Record<string, unknown>;
  assertEquals(
    Object.keys(dest).sort(),
    ["brandSlug", "entity", "entitySlug", "kind"],
  );
});
