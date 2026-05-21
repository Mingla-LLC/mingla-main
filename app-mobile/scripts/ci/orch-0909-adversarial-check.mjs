#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const migration = read("supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql");
const amendmentMigration = read("supabase/migrations/20260703000000_orch_0906_session_deck_cards_mixed_type.sql");
const edge = read("supabase/functions/discover-cards/index.ts");
const curated = read("supabase/functions/generate-curated-experiences/index.ts");
const context = read("app-mobile/src/contexts/RecommendationsContext.tsx");

check("T-ADV-01 concurrent frontier conflict handled", /insertRes\.error\.code !== '23505'/.test(edge), "Duplicate insert at same position must read winner row.");
check("T-ADV-02 replay cursor uses server", /serverCurrentPosition !== currentPosition/.test(edge) && /server wins/.test(edge), "Client cursor mismatch must not silently advance.");
check("T-ADV-03 no-GPS later resolution path", /custom_lat: userLocation\.lat/.test(context) && /custom_lng: userLocation\.lng/.test(context), "Location resolution must still merge lat/lng into participant prefs.");
check("T-ADV-04 51 participant cap removed", /CREATE EXTENSION IF NOT EXISTS postgis/.test(migration) && !/v_circle_count > 50/.test(migration), "PostGIS path must replace old 50-circle cap.");
check("T-ADV-05 old client returns 410", /collab_legacy_client_unsupported/.test(edge) && /status: 410/.test(edge), "Old client cutover must be explicit.");
check("T-ADV-06 forbidden access checked", /forbidden_not_accepted_participant/.test(edge) && /\.eq\('has_accepted', true\)/.test(edge), "Only accepted participants may request positional cards.");
check("T-ADV-07 card row survives inactive place", /ON DELETE RESTRICT/.test(migration), "Historical deck card rows must restrict place deletion.");
const deadEndBody = edge.slice(edge.indexOf("const deadEnd ="), edge.indexOf("const sessionRes ="));
check("T-ADV-08 live dead-end no persisted row", /current_position: params\.position - 1/.test(deadEndBody) && !/session_deck_cards|insert/.test(deadEndBody), "Dead-end must leave cursor retryable and not insert a row.");
check("T-ADV-09 curated exhaustion gracefully degrades to singles", /degraded_from text NULL/.test(amendmentMigration) && /degraded_from_intent/.test(edge) && /exhausted_intent/.test(edge) && /all_pools_exhausted/.test(edge), "When curated returns zero cards, server must fill with singles where possible and mark degraded_from.");
check("T-ADV-10 curated internal 5xx is a clean pipeline error", /fetchCuratedBatchInternal/.test(edge) && /generate-curated-experiences returned/.test(edge) && /CuratedInternalInvocationError/.test(edge) && /excludePlacePoolIds/.test(curated), "Curated edge-function failure must surface as pipeline_error and the generator must accept cross-batch excludes.");

let ok = true;
for (const c of checks) {
  const mark = c.pass ? "PASS" : "FAIL";
  console.log(`${mark} ${c.name}`);
  if (!c.pass) {
    ok = false;
    console.log(`  ${c.detail}`);
  }
}
if (!ok) process.exit(1);
