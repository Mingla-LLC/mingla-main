import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../..", import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);

const migrationPath =
  "supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql";
const amendmentMigrationPath =
  "supabase/migrations/20260703000000_orch_0906_session_deck_cards_mixed_type.sql";

Deno.test("T-IMP-01: positional deck table enforces one card per session position", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("CREATE TABLE IF NOT EXISTS public.session_deck_cards"));
  assert(sql.includes("PRIMARY KEY (session_id, position)"));
  assert(sql.includes("ON DELETE RESTRICT"));
  assert(sql.includes("CREATE POLICY sdc_select"));
});

Deno.test("T-IMP-02: atomic accept RPC writes joiner at live frontier", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("CREATE OR REPLACE FUNCTION public.accept_session_with_prefs"));
  assert(sql.includes("MAX(current_position)"));
  assert(sql.includes("user_id <> v_user_id"));
  assert(sql.includes("current_position = GREATEST"));
});

Deno.test("T-IMP-03: aggregation uses intersection semantics and pending GPS list", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("'pending_gps_user_ids'"));
  assert(sql.includes("'intersection_empty'"));
  assert(sql.includes("WHERE NOT ST_DWithin"));
  assert(!sql.includes("v_circle_count > 50"));
});

Deno.test("T-IMP-04: live dead-end responses do not insert session_deck_cards", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  const deadEndBody = edge.slice(edge.indexOf("const deadEnd ="), edge.indexOf("const sessionRes ="));
  assert(deadEndBody.includes("dead_end: true"));
  assert(!deadEndBody.includes(".from('session_deck_cards')"));
  assert(edge.includes("reason: 'no_unswiped_candidates'"));
});

Deno.test("T-IMP-05: accept flow is one RPC call from collaborationInviteService", async () => {
  const service = await read("app-mobile/src/services/collaborationInviteService.ts");
  const sql = await read(migrationPath);
  assert(service.includes("accept_session_with_prefs"));
  assert(!service.includes("upsert_participant_prefs"));
  assert(sql.includes("orch_0909.accept_with_prefs"));
  assert(sql.includes("fires recompute_deck_version_after_prefs_change exactly once"));
});

Deno.test("T-IMP-06: no-GPS path admits participant and surfaces banner", async () => {
  const sql = await read(migrationPath);
  const banner = await read("app-mobile/src/components/collab/NoGpsBanner.tsx");
  assert(sql.includes("'has_gps', (p_lat IS NOT NULL AND p_lng IS NOT NULL)"));
  assert(banner.includes("We're having trouble getting your location"));
  assert(banner.includes("custom_lat != null"));
});

Deno.test("T-IMP-07: single-shot reset sets accepted participants to position 0", async () => {
  const sql = await read(migrationPath);
  assert(sql.includes("ORCH-0909 single-shot reset"));
  assert(sql.includes("SET current_position = 0"));
  assert(sql.includes("WHERE has_accepted = true"));
});

Deno.test("T-IMP-08: retired client version pinning symbols are absent from active context", async () => {
  const context = await read("app-mobile/src/contexts/RecommendationsContext.tsx");
  assert(!context.includes("pinned" + "DeckVersion"));
  assert(context.includes("currentPosition"));
  assert(context.includes("current_position"));
});

Deno.test("T-IMP-09: discover-cards rejects old collab payloads and uses positional body", async () => {
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(edge.includes("current_position"));
  assert(edge.includes("status: 410"));
  assertEquals(edge.includes("expected" + "_deck_version"), false);
});

Deno.test("T-IMP-10: mixed deck rows support single and curated payloads", async () => {
  const sql = await read(amendmentMigrationPath);
  const edge = await read("supabase/functions/discover-cards/index.ts");
  assert(sql.includes("ALTER COLUMN card_id DROP NOT NULL"));
  assert(sql.includes("card_type IN ('single', 'curated')"));
  assert(sql.includes("sdc_exactly_one_payload"));
  assert(sql.includes("curated_payload jsonb"));
  assert(edge.includes("card_type: 'curated'"));
  assert(edge.includes("curated_payload: pickedCard"));
});

Deno.test("T-IMP-11: deterministic round-robin helper alternates odd singles and even curated", async () => {
  const helper = await import("../../_shared/mixedTypeInterleave.ts");
  const categories = ["brunch", "fine_dining", "icebreakers", "movies", "nature", "play"];
  const intents = ["group-fun", "romantic"];
  const sequence = Array.from({ length: 20 }, (_, i) =>
    helper.decideTypeAndPill({ position: i + 1, categories, intents }),
  );
  assertEquals(sequence.map((d: any) => d?.type), [
    "single", "curated", "single", "curated", "single", "curated", "single", "curated", "single", "curated",
    "single", "curated", "single", "curated", "single", "curated", "single", "curated", "single", "curated",
  ]);
  assertEquals(sequence.filter((d: any) => d?.type === "single").map((d: any) => d.pill), [
    "brunch", "fine_dining", "icebreakers", "movies", "nature", "play", "brunch", "fine_dining", "icebreakers", "movies",
  ]);
  assertEquals(sequence.filter((d: any) => d?.type === "curated").map((d: any) => d.pill), [
    "group-fun", "romantic", "group-fun", "romantic", "group-fun", "romantic", "group-fun", "romantic", "group-fun", "romantic",
  ]);
});
