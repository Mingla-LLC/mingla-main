import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { resolveOneLinkDestination } from "../oneLinkResolver.ts";

Deno.test("issue #1431 resolves a Stay OneLink through the single venue entity", () => {
  assertEquals(
    resolveOneLinkDestination({
      deep_link_value: "venue",
      deep_link_sub1: "truthful-brand",
      deep_link_sub2: "ocean-stay",
    }),
    {
      kind: "entity",
      entity: "venue",
      brandSlug: "truthful-brand",
      entitySlug: "ocean-stay",
    },
  );
});

Deno.test("issue #1431 refuses a half-formed Stay OneLink", () => {
  assertEquals(
    resolveOneLinkDestination({
      deep_link_value: "venue",
      deep_link_sub1: "truthful-brand",
    }),
    null,
  );
});
