#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const migrationRel = "supabase/migrations/20260704000000_hotfix_conversation_rls_recursion.sql";
const sql = read(migrationRel);

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

function section(startNeedle, endNeedle) {
  const start = sql.indexOf(startNeedle);
  const end = endNeedle ? sql.indexOf(endNeedle, start + startNeedle.length) : sql.length;
  if (start === -1 || end === -1) return "";
  return sql.slice(start, end);
}

check(
  "T-01 migration creates RLS-safe SECURITY DEFINER helpers",
  /CREATE OR REPLACE FUNCTION public\.is_direct_conversation/.test(sql) &&
    /CREATE OR REPLACE FUNCTION public\.is_conversation_brand_team_member/.test(sql) &&
    /CREATE OR REPLACE FUNCTION public\.can_insert_message_into_conversation/.test(sql) &&
    (sql.match(/SECURITY DEFINER/g) || []).length >= 3 &&
    (sql.match(/SET search_path TO public, pg_temp/g) || []).length >= 3,
  "The hotfix must route cross-table policy predicates through SECURITY DEFINER helpers with fixed search_path.",
);

check(
  "T-02 conversations SELECT policies no longer query conversation_participants directly",
  /DROP POLICY IF EXISTS "Users can view conversations they participate in"/.test(sql) &&
    /public\.is_conversation_participant\(conversations\.id, auth\.uid\(\)\)/.test(sql) &&
    /DROP POLICY IF EXISTS "Users can view their conversations"/.test(sql),
  "Conversations SELECT policies must use the existing definer helper instead of inline SELECT from conversation_participants.",
);

const participantRead = section(
  "CREATE POLICY conversation_participants_brand_team_member_read",
  "DROP POLICY IF EXISTS conversation_participants_brand_team_member_delete",
);

check(
  "T-03 participant brand read policy does not reference conversations",
  /public\.is_conversation_brand_team_member\(conversation_participants\.conversation_id, auth\.uid\(\)\)/.test(participantRead) &&
    !/FROM\s+public\.conversations|JOIN\s+public\.conversations|FROM\s+conversations|JOIN\s+conversations/i.test(participantRead),
  "conversation_participants_brand_team_member_read must not query conversations directly.",
);

const directSelfAdd = section(
  "CREATE POLICY conversation_participants_direct_self_add",
  "-- messages: remove direct conversations reads",
);

check(
  "T-04 participant self-add policy uses direct-conversation helper",
  /public\.is_direct_conversation\(conversation_participants\.conversation_id\)/.test(directSelfAdd) &&
    !/FROM\s+public\.conversations|JOIN\s+public\.conversations|FROM\s+conversations|JOIN\s+conversations/i.test(directSelfAdd),
  "conversation_participants_direct_self_add must not query conversations directly.",
);

const messagesRead = section(
  "CREATE POLICY messages_brand_team_member_read",
  "DROP POLICY IF EXISTS messages_brand_team_member_insert",
);

check(
  "T-05 messages brand read policy does not reference conversations",
  /public\.is_conversation_brand_team_member\(messages\.conversation_id, auth\.uid\(\)\)/.test(messagesRead) &&
    !/FROM\s+public\.conversations|JOIN\s+public\.conversations|FROM\s+conversations|JOIN\s+conversations/i.test(messagesRead),
  "messages_brand_team_member_read must not query conversations directly.",
);

const broadcastPolicy = section(
  "CREATE POLICY messages_broadcast_only_enforcement",
  "",
);

check(
  "T-06 broadcast-only enforcement uses helper and remains restrictive",
  /AS RESTRICTIVE/.test(broadcastPolicy) &&
    /public\.can_insert_message_into_conversation\(messages\.conversation_id, auth\.uid\(\)\)/.test(broadcastPolicy) &&
    !/FROM\s+public\.conversations|JOIN\s+public\.conversations|FROM\s+conversations|JOIN\s+conversations/i.test(broadcastPolicy),
  "messages_broadcast_only_enforcement must stay restrictive and avoid direct conversations reads.",
);

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
