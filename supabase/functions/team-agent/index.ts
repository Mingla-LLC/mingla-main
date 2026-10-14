// Issue #3802 — the connector a teammate's own agent talks to.
//
// One address, one kind of request (a POST carrying one JSON-RPC message),
// one answer. A teammate creates a personal key on the My agent page of
// Mingla Admin and gives it to their agent; from then on the agent can read
// the Hosts and Creators pipelines and Beta leads, and add, update, move and
// log on them, as that teammate, with their role and nothing more. Nothing
// here sends a message or deletes. The same address with `/setup` at its end
// exchanges a one-time setup code for that teammate's key.
//
// This file is only the wiring. Every rule about the wire format is in
// `_shared/teamAgentMcp.ts`, and every rule about who may do what is in the
// database: the handler is given ONE function that reaches the database, and
// that function calls ONE gateway with a digest of the key. The gateway
// decides who is acting. Nothing here names a person.
//
// Sign-in is checked here, by key, on every request, so the platform's own
// session check is off for this function (see supabase/config.toml).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTeamAgentHandler } from "../_shared/teamAgentMcp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const server = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const handler = createTeamAgentHandler({
  // The only call this function makes.
  gateway: async (keyHash, tool, args, client) => {
    const { data, error } = await server.rpc("team_agent_call", {
      p_key_hash: keyHash,
      p_tool: tool,
      p_args: args,
      p_client: client,
    });
    if (error) throw new Error("gateway");
    return data;
  },
  // One line per request: an id, the method, the tool, the outcome, the time.
  log: (line) => console.log(JSON.stringify(line)),
});

serve(handler);
