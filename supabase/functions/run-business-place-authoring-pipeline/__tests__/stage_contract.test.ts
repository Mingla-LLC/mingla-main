import { assert, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("Sub-E pipeline exposes the post-Tier-2 actions from the spec", () => {
  for (const action of [
    "run_tier2_pipeline",
    "regenerate_sales_bio",
    "confirm_ai_outputs",
    "refresh_deck_readiness",
    "get_authoring_context",
    "sync_hero_media",
  ]) {
    assertStringIncludes(source, action);
  }
});

Deno.test("run_tier2_pipeline stores generated bio as pending output, not public summary", () => {
  assertStringIncludes(source, "pending_ai_outputs");
  assertStringIncludes(source, "generated_pending_confirmation");
  const tier2Block = source.slice(
    source.indexOf("async function handleTier2"),
    source.indexOf("async function handleConfirmAiOutputs"),
  );
  assert(!tier2Block.includes("generative_summary:"), "Tier 2 must not publish the generated bio before confirmation");
});

Deno.test("confirm_ai_outputs is the only action that publishes final bio and facets", () => {
  const confirmBlock = source.slice(
    source.indexOf("async function handleConfirmAiOutputs"),
    source.indexOf("async function handleSyncHeroMedia"),
  );
  assertStringIncludes(confirmBlock, "generative_summary: salesBio");
  assertStringIncludes(confirmBlock, "...facetPatch");
  assertStringIncludes(confirmBlock, "confirmed_ai_outputs");
});

Deno.test("refresh_deck_readiness does not route through confirmation or publish bio", () => {
  const refreshBlock = source.slice(
    source.indexOf("async function handleRefreshDeckReadiness"),
    source.indexOf("async function handleGetAuthoringContext"),
  );
  assert(!refreshBlock.includes("handleConfirmAiOutputs"), "refresh must not call confirm handler");
  assert(!refreshBlock.includes("generative_summary"), "refresh must not publish deck bio");
  assert(!refreshBlock.includes("confirmed_ai_outputs:"), "refresh must not confirm AI outputs");
  const dispatchBlock = source.slice(
    source.indexOf("if (body.action === \"refresh_deck_readiness\")"),
    source.indexOf("if (body.action === \"get_authoring_context\")"),
  );
  assertStringIncludes(dispatchBlock, "handleRefreshDeckReadiness");
  assert(!dispatchBlock.includes("handleConfirmAiOutputs"), "dispatch must not route refresh to confirm");
});

Deno.test("sync_hero_media persists visual source for bouncer B8 and video boost", () => {
  const syncBlock = source.slice(
    source.indexOf("async function handleSyncHeroMedia"),
  );
  assertStringIncludes(syncBlock, "business_hero_video_present: mediaType === \"video\"");
  assertStringIncludes(syncBlock, "stored_photo_urls");
});
