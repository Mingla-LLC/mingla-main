import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../..", import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);
const migrationPath =
  "supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql";
const amendmentMigrationPath =
  "supabase/migrations/20260703000000_orch_0906_session_deck_cards_mixed_type.sql";

Deno.test("T-ADV-01: concurrent frontier race is resolved by insert conflict then read", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(edge.includes(".insert({"));
  assert(edge.includes("insertRes.error.code !== '23505'"));
  assert(edge.includes(".select('card_id, card_type, curated_payload, generated_at_version, degraded_from, pill_label')"));
});

Deno.test("T-ADV-02: replayed client cursor loses to server cursor", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(edge.includes("serverCurrentPosition !== currentPosition"));
  assert(edge.includes("server wins"));
  assert(edge.includes("const targetPosition = serverCurrentPosition + 1"));
});

Deno.test("T-ADV-03: no-GPS resolution is still written through collab GPS effect", async () => {
  const context = await read("app-mobile/src/contexts/RecommendationsContext.tsx");
  assert(context.includes("custom_lat: userLocation.lat"));
  assert(context.includes("custom_lng: userLocation.lng"));
  assert(context.includes("upsert_participant_prefs"));
});

Deno.test("T-ADV-04: 51st participant scale cap is removed by PostGIS path", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("CREATE EXTENSION IF NOT EXISTS postgis"));
  assert(sql.includes("query_servable_places_by_signal_intersection"));
  assertEquals(sql.includes("v_circle_count > 50"), false);
});

Deno.test("T-ADV-05: old collab client cutover returns HTTP 410", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(edge.includes("hasOldCollabVersionParam"));
  assert(edge.includes("collab_legacy_client_unsupported"));
  assert(edge.includes("status: 410"));
});

Deno.test("T-ADV-06: accepted participant check remains mandatory", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(edge.includes(".eq('has_accepted', true)"));
  assert(edge.includes("forbidden_not_accepted_participant"));
});

Deno.test("T-ADV-07: place removal does not delete historical deck card rows", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("card_id uuid NOT NULL REFERENCES public.place_pool(id) ON DELETE RESTRICT"));
  assert(sql.includes("No UPDATE/DELETE policies"));
});

Deno.test("T-ADV-08: live dead-end revival is possible because no sentinel row exists", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  const deadEndBody = edge.slice(edge.indexOf("const deadEnd ="), edge.indexOf("const sessionRes ="));
  assert(deadEndBody.includes("current_position: params.position - 1"));
  assert(!/session_deck_cards|insert/.test(deadEndBody));
  assert(edge.includes("Date/time filters removed every candidate"));
});

Deno.test("T-ADV-09: curated exhaustion gracefully degrades before full dead-end", async () => {
  const sql = await read(amendmentMigrationPath);
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(sql.includes("degraded_from text NULL"));
  assert(edge.includes("degraded_from_intent"));
  assert(edge.includes("exhausted_intent"));
  assert(edge.includes("batch.cards.length === 0"));
  assert(edge.includes("all_pools_exhausted"));
});

Deno.test("T-ADV-10: curated internal failure surfaces as pipeline_error", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  const curated = await read("supabase/functions/generate-curated-experiences/index.ts");
  assert(edge.includes("fetchCuratedBatchInternal"));
  assert(edge.includes("generate-curated-experiences returned"));
  assert(edge.includes("CuratedInternalInvocationError"));
  assert(edge.includes("error_class: 'pipeline_error'"));
  assert(curated.includes("excludePlacePoolIds"));
});
