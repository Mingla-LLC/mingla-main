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
const mixedInterleave = read("supabase/functions/_shared/mixedTypeInterleave.ts");
const context = read("app-mobile/src/contexts/RecommendationsContext.tsx");
const invite = read("app-mobile/src/services/collaborationInviteService.ts");
const banner = read("app-mobile/src/components/collab/NoGpsBanner.tsx");

check("T-IMP-01 positional table primary key", /PRIMARY KEY \(session_id, position\)/.test(migration), "session_deck_cards must key one card per session position.");
check("T-IMP-02 joiner starts at frontier", /MAX\(current_position\)/.test(migration) && /user_id <> v_user_id/.test(migration), "accept RPC must set current_position from existing frontier.");
check("T-IMP-03 intersection semantics", /query_servable_places_by_signal_intersection/.test(migration) && /WHERE NOT ST_DWithin/.test(migration), "Migration must install PostGIS intersection query.");
const deadEndBody = edge.slice(edge.indexOf("const deadEnd ="), edge.indexOf("const sessionRes ="));
check("T-IMP-04 live dead-end no persisted row", /dead_end: true/.test(deadEndBody) && !/session_deck_cards/.test(deadEndBody), "Dead-end response must not write a positional row.");
check("T-IMP-05 atomic accept RPC", /accept_session_with_prefs/.test(invite) && !/upsert_participant_prefs/.test(invite) && /orch_0909\.accept_with_prefs/.test(migration), "Invite accept must call the atomic RPC and suppress the legacy participant-touch recompute.");
check("T-IMP-06 no-GPS banner", /We're having trouble getting your location/.test(banner), "Banner copy must ship.");
check("T-IMP-07 single-shot reset", /SET current_position = 0/.test(migration) && /WHERE has_accepted = true/.test(migration), "Migration must reset in-flight cursors.");
check("T-IMP-08 retired pinning symbol absent", !context.includes("pinned" + "DeckVersion"), "RecommendationsContext must not contain old version-pinning state.");
check("T-IMP-09 old request param absent in edge", !edge.includes("expected" + "_deck_version"), "discover-cards must not contain the retired request param.");
check("T-IMP-10 mixed deck rows support single and curated payloads", /ALTER COLUMN card_id DROP NOT NULL/.test(amendmentMigration) && /card_type IN \('single', 'curated'\)/.test(amendmentMigration) && /sdc_exactly_one_payload/.test(amendmentMigration) && /curated_payload/.test(edge), "ORCH-0906 must store single rows by card_id and curated rows by curated_payload.");
check("T-IMP-11 deterministic single-intent round-robin helper", /position % 2 === 0/.test(mixedInterleave) && /intents\[intentIndex % intents\.length\]/.test(mixedInterleave) && /categories\[singleIndex % categories\.length\]/.test(mixedInterleave), "Mixed-type interleave helper must implement odd singles, even curated, independent per-pill rotation.");

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
