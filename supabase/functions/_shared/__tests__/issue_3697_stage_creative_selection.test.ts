import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  stageCreativeIds,
  validateStageCreativeRows,
} from "../adStageCreativeSelection.ts";
import { parseLibraryFilters } from "../adCreativeLifecycle.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    brand_id: BRAND,
    status: "active",
    purged_at: null,
    aspect_ratio: 9 / 16,
    variants: {
      "1:1": { source_url: "https://media.example/square.jpg" },
      "4:5": { source_url: "https://media.example/portrait.jpg" },
    },
    has_audio: true,
    ...patch,
  };
}

Deno.test("#3697 stage creative ids are UUID-only and deduplicated", () => {
  assertEquals(
    stageCreativeIds({
      prospecting: [A, A, B],
      retarget: [A, B],
      abandoners: [B, A],
    }),
    {
      ok: true,
      byStage: {
        prospecting: [A, B],
        retarget: [A, B],
        abandoners: [B, A],
      },
      allIds: [A, B],
    },
  );
  assertEquals(
    stageCreativeIds({
      prospecting: ["not-a-uuid"],
      retarget: [],
      abandoners: [],
    }),
    { ok: false, detail: "stage_creative_ids_invalid:prospecting" },
  );
});

Deno.test("#3697 Creative Library accepts only a UUID brand authority filter", () => {
  const parsed = parseLibraryFilters({ brand_id: BRAND });
  assertEquals(parsed.ok, true);
  if (parsed.ok) assertEquals(parsed.filters.brandId, BRAND);
  assertEquals(parseLibraryFilters({ brand_id: "invented" }), {
    ok: false,
    detail: "brand_id_invalid",
  });
});

Deno.test("#3697 server accepts 2–4 covered, audible brand creatives per enabled stage", () => {
  assertEquals(
    validateStageCreativeRows({
      ids: { prospecting: [A, B], retarget: [A, B], abandoners: [B, A] },
      rows: [row(A), row(B)],
      enabledStages: { prospecting: true, retarget: true, abandoners: true },
      platforms: ["meta", "snapchat", "tiktok"],
      brandId: BRAND,
    }),
    { ok: true },
  );
});

Deno.test("#3697 server fails closed on counts, ownership, coverage and audio", () => {
  const base = {
    ids: { prospecting: [A, B], retarget: [], abandoners: [] },
    enabledStages: { prospecting: true, retarget: false, abandoners: false },
    platforms: ["meta", "snapchat"] as const,
    brandId: BRAND,
  };
  assertEquals(validateStageCreativeRows({ ...base, rows: [row(A)] }), {
    ok: false,
    detail: "stage_creative_not_reusable:prospecting",
  });
  assertEquals(
    validateStageCreativeRows({
      ...base,
      rows: [row(A), row(B, { brand_id: "other" })],
    }),
    { ok: false, detail: "stage_creative_not_reusable:prospecting" },
  );
  assertEquals(
    validateStageCreativeRows({
      ...base,
      rows: [row(A), row(B, { variants: {} })],
    }),
    { ok: false, detail: `stage_creative_meta_coverage:${B}` },
  );
  assertEquals(
    validateStageCreativeRows({
      ...base,
      rows: [row(A), row(B, { has_audio: false })],
    }),
    { ok: false, detail: `stage_creative_audio_required:${B}` },
  );
});
