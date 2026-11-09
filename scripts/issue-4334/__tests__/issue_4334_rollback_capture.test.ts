// #4334 R3-4 — the generated rollback covers everything the migration re-emits.
//
// scripts/issue-4334/capture-rollback.sql (run before apply) prints the rollback.
// It was rehearsed end to end on a local replay; this suite keeps it complete:
//   K-1 every function the migration creates is in the capture's name list
//   K-2 it handles the three traps the tester found: the renamed identity-key
//       argument (DROP before re-create), the view (DROP VIEW + CREATE, not
//       CREATE OR REPLACE) and ACL / owner restatement
//   K-3 the migration header points at the capture and the steps
// Fails on revert: a function added to the migration but not captured → K-1.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const MIGRATION = "../../../supabase/migrations/20280521004334_issue_4334_google_places.sql";

Deno.test("K-1 every function the migration creates is captured", async () => {
  const migration = await read(MIGRATION);
  const capture = await read("../capture-rollback.sql");
  const created = new Set([...migration.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1]));
  const listBlock = capture.slice(capture.indexOf("WITH names(n) AS ("), capture.indexOf("fns AS ("));
  const captured = new Set([...listBlock.matchAll(/\('(\w+)'\)/g)].map((m) => m[1]));
  const missing = [...created].filter((n) => !captured.has(n)).sort();
  assertEquals(missing, [], "functions created by the migration but missing from the rollback capture");
  assert(created.size >= 42, `expected the full set, got ${created.size}`);
});

Deno.test("K-2 identity key dropped first, view dropped and re-created, owners and ACLs restated", async () => {
  const capture = await read("../capture-rollback.sql");
  const b = capture.indexOf("'DROP FUNCTION IF EXISTS public.chat_plan_place_identity_key(text, uuid, text, text, text, text);'");
  const bodies = capture.indexOf("'-- c. captured function bodies, ACLs and comments'");
  assert(b > 0 && b < bodies, "the identity key is dropped before the captured bodies are re-created");
  assert(capture.includes("'DROP VIEW public.business_public_events_view;'"), "the view is dropped");
  assert(capture.includes("'CREATE VIEW public.business_public_events_view'"), "and re-created (not CREATE OR REPLACE)");
  assert(capture.includes("'ALTER FUNCTION ' || f.sig || ' OWNER TO '"), "function owners restated");
  assert(capture.includes("'ALTER VIEW public.business_public_events_view OWNER TO '"), "view owner restated");
  assert(capture.includes("'REVOKE ALL ON FUNCTION ' || f.sig || ' FROM PUBLIC, anon, authenticated, service_role;'"), "function ACLs restated");
  assert(capture.includes("'RENAME COLUMN provider_place_id TO mapbox_id;'") || capture.includes("RENAME COLUMN provider_place_id TO mapbox_id;"), "chat-plan columns renamed back");
});

Deno.test("K-3 the migration header names the capture and the order", async () => {
  const migration = await read(MIGRATION);
  const header = migration.slice(0, migration.indexOf("BEGIN;"));
  assert(header.includes("scripts/issue-4334/capture-rollback.sql"), "header names the capture script");
  assert(header.includes("chat_plan_place_identity_key(text, uuid, text, text, text, text) first"), "header names the identity-key trap");
  assert(header.includes("DROP VIEW +"), "header names the view trap");
});
