import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeCreativeTagUpdate,
  resolveCreativeTagBrand,
} from "../adCreativeTags.ts";

Deno.test("#3697 Creative Library tags normalize, deduplicate and clear", () => {
  assertEquals(
    normalizeCreativeTagUpdate({
      stage_tags: ["retarget", "retarget", "abandoners"],
      concept_tag: "  Late buyers  ",
      hook_tag: "Last chance",
      event_id: "11111111-1111-4111-8111-111111111111",
      licence_reference: "Host release",
      date_locked_until: "2026-12-01T12:00:00-05:00",
    }),
    {
      ok: true,
      patch: {
        stage_tags: ["retarget", "abandoners"],
        concept_tag: "Late buyers",
        hook_tag: "Last chance",
        event_id: "11111111-1111-4111-8111-111111111111",
        licence_reference: "Host release",
        date_locked_until: "2026-12-01T17:00:00.000Z",
      },
    },
  );
  assertEquals(
    normalizeCreativeTagUpdate({
      stage_tags: [],
      concept_tag: "",
      hook_tag: null,
      event_id: "",
      licence_reference: "",
      date_locked_until: null,
    }),
    {
      ok: true,
      patch: {
        stage_tags: [],
        concept_tag: null,
        hook_tag: null,
        event_id: null,
        licence_reference: null,
        date_locked_until: null,
      },
    },
  );
});

Deno.test("#3697 Creative Library tags reject invented stages and malformed authority", () => {
  for (
    const [input, detail] of [
      [
        {
          stage_tags: ["buyers"],
          concept_tag: null,
          hook_tag: null,
          licence_reference: null,
          event_id: null,
          date_locked_until: null,
        },
        "stage_tags_invalid",
      ],
      [
        {
          stage_tags: [],
          concept_tag: null,
          hook_tag: null,
          licence_reference: null,
          event_id: "not-a-uuid",
          date_locked_until: null,
        },
        "event_id_invalid",
      ],
      [
        {
          stage_tags: [],
          concept_tag: null,
          hook_tag: null,
          licence_reference: null,
          event_id: null,
          date_locked_until: "not-a-date",
        },
        "date_locked_until_invalid",
      ],
      [{
        stage_tags: [],
        concept_tag: "x".repeat(121),
        hook_tag: null,
        licence_reference: null,
        event_id: null,
        date_locked_until: null,
      }, "creative_tag_text_invalid"],
    ] as const
  ) {
    const result = normalizeCreativeTagUpdate(input);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.detail, detail);
  }
});

Deno.test("#3697 tag action stays admin-only and uses the strict normalizer", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const start = source.indexOf('if (action === "creative_update_tags")');
  const end = source.indexOf('if (action === "creative_reuse")', start);
  const block = source.slice(start, end);
  assertStringIncludes(block, "isActiveAdmin");
  assertStringIncludes(block, "normalizeCreativeTagUpdate(body)");
  assertStringIncludes(block, '.is("purged_at", null)');
});

Deno.test("#3697 event tags link new creatives to the server-owned event brand", () => {
  const brandId = "22222222-2222-4222-8222-222222222222";
  assertEquals(resolveCreativeTagBrand(null, brandId), {
    ok: true,
    brandId,
  });
  assertEquals(resolveCreativeTagBrand(brandId, brandId), {
    ok: true,
    brandId,
  });
  assertEquals(
    resolveCreativeTagBrand(
      "33333333-3333-4333-8333-333333333333",
      brandId,
    ),
    { ok: false, detail: "creative_brand_conflict" },
  );
  assertEquals(resolveCreativeTagBrand(null, null), {
    ok: false,
    detail: "event_brand_unavailable",
  });
});

Deno.test("#3697 tag action derives brand authority from the event and guards races", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const start = source.indexOf('if (action === "creative_update_tags")');
  const end = source.indexOf('if (action === "creative_reuse")', start);
  const block = source.slice(start, end);
  assertStringIncludes(block, 'db.from("events").select("brand_id")');
  assertStringIncludes(block, "resolveCreativeTagBrand(");
  assertStringIncludes(block, "{ brand_id: resolvedBrandId }");
  assertStringIncludes(
    block,
    "`brand_id.is.null,brand_id.eq.${resolvedBrandId}`",
  );
});
