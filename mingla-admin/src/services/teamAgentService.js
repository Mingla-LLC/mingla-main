// Issue #3802 (Wave 4) — the ONLY caller of the team_agent_* server functions.
//
// No other file in the admin app may call a team_agent_ function (a test pins
// this), and this file calls no other kind. The keys table has no client
// access at all: every read and write goes through these functions, which
// check the person's role first and refuse when they are reached through an
// agent.
//
// A key exists in readable form once: in the answer of createKey(). This file
// hands it to its caller and keeps nothing; it never logs an answer.
//
// Every function here returns the server's data or throws an AgentError
// carrying { token, message } — never a raw database or network error.
// Invariant: I-PROPOSED-3802-AGENT-KEY-IS-STORED-AS-A-DIGEST-AND-SHOWN-ONCE.

import { supabase } from "../lib/supabase";
import { parseServerError } from "../lib/crmModel";

export class AgentError extends Error {
  constructor({ token, message }) {
    // The message is the server's own sentence or nothing; never the token
    // (lib/agentConnect.js turns a token into words).
    super(typeof message === "string" ? message : "");
    this.name = "AgentError";
    this.token = token;
  }
}

async function call(run) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AgentError({ token: "network", message: "" });
  }
  let result;
  try {
    result = await run();
  } catch (err) {
    console.error("[agent] request failed:", err?.name || "error");
    throw new AgentError(parseServerError(err));
  }
  if (result.error) {
    const parsed = parseServerError(result.error);
    if (parsed.token === "unknown" || parsed.token === "not_ready") {
      console.error("[agent] server refused:", result.error.code);
    }
    throw new AgentError(parsed);
  }
  return result.data;
}

/** Returns { keys: [...], idle_days }. Never a key or its digest. */
export function listMyKeys() {
  return call(() => supabase.rpc("team_agent_keys_mine"));
}

/**
 * Create (or replace) this person's key for "claude" or "codex".
 * Returns { key, key_id, agent, key_prefix, created_at, replaced }. `key` is
 * in this answer once and can never be fetched again.
 */
export function createKey(agent) {
  return call(() => supabase.rpc("team_agent_key_create", { p_agent: agent }));
}

/** Turn a key off at once. Returns { key_id, agent, owner_email, revoked_at, changed }. */
export function revokeKey(keyId) {
  return call(() => supabase.rpc("team_agent_key_revoke", { p_key_id: keyId }));
}

/** Owner only: { people: [...] }, one row per person per agent. Never a key. */
export function fetchKeysOverview() {
  return call(() => supabase.rpc("team_agent_keys_overview"));
}

/** What an agent is told: { config, guide, limits }. */
export function fetchAgentGuide() {
  return call(() => supabase.rpc("team_agent_guide"));
}

/** This person's own agent requests: { calls: [...], more }. */
export function fetchMyAgentActivity(limit = 20, before = null) {
  return call(() => supabase.rpc("team_agent_my_activity", { p_limit: limit, p_before: before }));
}
