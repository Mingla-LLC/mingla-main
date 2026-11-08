// Issue #3802 — the connector a teammate's own agent talks to.
//
// One address, one kind of request (a POST carrying one JSON-RPC message),
// one answer. A teammate creates a personal key on the My agent page of
// Mingla Admin and gives it to their agent; from then on the agent can read
// the Hosts and Creators pipelines and Beta leads, and add, update, move and
// log on them, and plan, claim, do and close work cards on the Work board
// (issue #3980), as that teammate, with their role and nothing more. Nothing
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
//
// Issue #4294: the same address also serves sign-in for the Claude apps
// (`/.well-known/oauth-protected-resource`, `/oauth/authorize`,
// `/oauth/token`) and company tools. Both reach the database only through
// the mingla_connector_ functions named below. No company key is a function
// secret: keys live in Supabase Vault and are read for one allowed call.
// Company sign-in (`/oauth/upstream-start` from Mingla Admin and
// `/oauth/upstream-callback` from the tool's sign-in server) keeps the
// company's sign-in in Vault the same way.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTeamAgentHandler } from "../_shared/teamAgentMcp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const server = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CONTENT_TOOLS = new Set([
  "list_content",
  "add_content",
  "update_content",
  "assign_content",
  "comment_content",
  "move_content",
]);

const PRODUCT_TRUTH_TOOLS = new Set([
  "find_capabilities",
  "mcp:tools/list",
]);

// Issue #3980 — the Work board, agent log and calendar tools.
const WORK_TOOLS = new Set([
  "read_log",
  "claim",
  "release",
  "plan_work",
  "add_work",
  "start_work",
  "update_work",
  "close_work",
  "push_back",
  "list_work",
  "my_work",
  "list_calendar",
  "runway_report",
  "set_expected_event",
]);

// Issue #4294: the only database functions sign-in and company tools call.
const CONNECTOR_FUNCTIONS = new Set([
  "mingla_connector_oauth_exchange",
  "mingla_connector_oauth_refresh",
  "mingla_connector_upstreams_for",
  "mingla_connector_call_begin",
  "mingla_connector_call_finish",
  "mingla_connector_upstream_key",
  // Company sign-in (the callback and token renewal).
  "mingla_connector_signin_claim",
  "mingla_connector_signin_complete",
  "mingla_connector_signin_credential",
  "mingla_connector_signin_refresh_begin",
  "mingla_connector_signin_refresh_store",
  "mingla_connector_signin_refresh_fail",
]);

// Issue #4294: the only functions called with an owner's own Mingla Admin
// session (Connect in Company tools). The database checks the owner.
const OWNER_SIGNIN_FUNCTIONS = new Set([
  "mingla_connector_signin_status",
  "mingla_connector_signin_begin",
]);

const handler = createTeamAgentHandler({
  // The only call this function makes.
  gateway: async (keyHash, tool, args, client, chat) => {
    const gateway = PRODUCT_TRUTH_TOOLS.has(tool)
      ? "team_agent_product_truth_call"
      : CONTENT_TOOLS.has(tool)
      ? "team_agent_content_call"
      : WORK_TOOLS.has(tool)
      ? "ops_agent_call"
      : "team_agent_call";
    let call = server.rpc(gateway, {
      p_key_hash: keyHash,
      p_tool: tool,
      p_args: args,
      p_client: client,
    });
    // Issue #3980: which chat on this key the request comes from (a key the
    // connector derived; it grants nothing). The database reads it as the
    // x-mingla-chat request header.
    if (chat) call = call.setHeader("x-mingla-chat", chat);
    const { data, error } = await call;
    if (error) throw new Error("gateway");
    return data;
  },
  connector: {
    rpc: async (fn, args) => {
      if (!CONNECTOR_FUNCTIONS.has(fn)) throw new Error("connector");
      const { data, error } = await server.rpc(fn, args);
      // Only the SQLSTATE travels on (PT409 is a renewal clash); never the arguments.
      if (error) throw Object.assign(new Error("connector"), { code: error.code ?? "" });
      return data;
    },
    userRpc: async (jwt, fn, args) => {
      if (!OWNER_SIGNIN_FUNCTIONS.has(fn) || !SUPABASE_ANON_KEY) throw new Error("connector");
      const asOwner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data, error } = await asOwner.rpc(fn, args);
      if (error) {
        throw Object.assign(new Error(typeof error.message === "string" ? error.message : "connector"), {
          code: error.code ?? "",
        });
      }
      return data;
    },
    // The address Claude is given for this connector, exactly.
    resourceUrl: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/team-agent`,
    fetch: (input, init) => fetch(input, init),
  },
  // One line per request: an id, the method, the tool, the outcome, the time.
  log: (line) => console.log(JSON.stringify(line)),
});

serve(handler);
