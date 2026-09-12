// #1983 — Ari prefs / notification prefs / support create / business-side deletion.
//
// Fails on revert of:
//   - update_notification_prefs writes push|in_app × business.* with onConflict
//   - rejects email/sms/order enums without writing
//   - request_account_deletion invokes delete-user with { side: "business" } only
//   - wrong legal_name never invokes; confirm_phrase DELETE required
//   - create_support_ticket RPC args; update_ari_prefs patch keys
//   - PROMPT_VERSION v19 account/notification ads
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1983_ari_account_support.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const USER = "77777777-7777-4777-8777-777777777777";
const BRAND = "11111111-1111-4111-8111-111111111111";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

type UpsertRec = {
  table: string;
  rows: unknown;
  onConflict?: string;
};

type InvokeRec = {
  name: string;
  body: Record<string, unknown>;
};

type RpcRec = {
  name: string;
  args: Record<string, unknown>;
};

// deno-lint-ignore no-explicit-any
function accountClient(opts: {
  display_name?: string | null;
  email?: string | null;
} = {}): {
  client: any;
  upserts: UpsertRec[];
  invokes: InvokeRec[];
  rpcs: RpcRec[];
} {
  const upserts: UpsertRec[] = [];
  const invokes: InvokeRec[] = [];
  const rpcs: RpcRec[] = [];
  const displayName = opts.display_name === undefined
    ? "Ada Lovelace"
    : opts.display_name;
  const email = opts.email === undefined ? "ada@example.com" : opts.email;

  // deno-lint-ignore no-explicit-any
  const tableChain = (table: string): any => {
    const self: Record<string, unknown> = {};
    let pendingUpsert: { rows: unknown; onConflict?: string } | null = null;
    for (
      const method of [
        "select",
        "eq",
        "in",
        "is",
        "not",
        "order",
        "limit",
        "or",
        "single",
      ]
    ) {
      self[method] = () => self;
    }
    self.upsert = (rows: unknown, opts2?: { onConflict?: string }) => {
      pendingUpsert = { rows, onConflict: opts2?.onConflict };
      upserts.push({ table, rows, onConflict: opts2?.onConflict });
      return self;
    };
    self.maybeSingle = () => {
      if (table === "creator_accounts") {
        return Promise.resolve({
          data: { display_name: displayName },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    self.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      if (pendingUpsert) {
        const rows = pendingUpsert.rows;
        return Promise.resolve({
          data: Array.isArray(rows) ? rows : [rows],
          error: null,
        }).then(resolve, reject);
      }
      if (table === "agent_user_profile") {
        return Promise.resolve({
          data: {
            preferred_timezone: "America/Chicago",
            preferred_currency: "USD",
            communication_style: "concise",
          },
          error: null,
        }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    };
    return self;
  };

  return {
    upserts,
    invokes,
    rpcs,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: email ? { email } : null },
            error: null,
          }),
      },
      functions: {
        // deno-lint-ignore no-explicit-any
        invoke: (name: string, init: any) => {
          invokes.push({ name, body: init?.body ?? {} });
          return Promise.resolve({
            data: { success: true, authRetained: true },
            error: null,
          });
        },
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return Promise.resolve({
          data: "99999999-9999-4999-8999-999999999999",
          error: null,
        });
      },
      from: (table: string) => tableChain(table),
    },
  };
}

Deno.test("#1983 implementor: settings/support/deletion auth pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.update_ari_prefs, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.update_notification_prefs, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.create_support_ticket, {
    requiredRole: "self",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.request_account_deletion, {
    requiredRole: "self",
    resource: "none",
  });
  assert(MONEY_CONFIRM_TOOLS.has("request_account_deletion"));
});

Deno.test("#1983 implementor: update_notification_prefs canonical upsert", async () => {
  const tool = domainTool("update_notification_prefs");
  const { client, upserts } = accountClient();
  const data = await tool.executor(
    {
      type: "business.order_paid",
      channel: "push",
      opt_in: false,
    },
    client,
    USER,
  );
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].table, "business_notification_type_preferences");
  assertEquals(upserts[0].onConflict, "user_id,channel,type");
  assertEquals(upserts[0].rows, [{
    user_id: USER,
    channel: "push",
    type: "business.order_paid",
    opt_in: false,
    updated_at: (upserts[0].rows as Array<Record<string, unknown>>)[0]
      .updated_at,
  }]);
  assert(Array.isArray(data));
});

Deno.test("#1983 implementor: update_notification_prefs bulk types", async () => {
  const tool = domainTool("update_notification_prefs");
  const { client, upserts } = accountClient();
  await tool.executor(
    {
      types: ["business.order_paid", "business.payout_paid"],
      channel: "in_app",
      opt_in: true,
    },
    client,
    USER,
  );
  assertEquals(upserts.length, 1);
  const rows = upserts[0].rows as Array<Record<string, unknown>>;
  assertEquals(rows.length, 2);
  assertEquals(rows[0].channel, "in_app");
  assertEquals(rows[1].type, "business.payout_paid");
});

Deno.test("#1983 implementor: update_notification_prefs rejects email/sms/order", async () => {
  const tool = domainTool("update_notification_prefs");
  const { client, upserts } = accountClient();
  await assertRejects(
    () =>
      tool.executor(
        { type: "order", channel: "email", opt_in: false },
        client,
        USER,
      ),
    ToolError,
  );
  await assertRejects(
    () =>
      tool.executor(
        { type: "business.order_paid", channel: "sms", opt_in: false },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(upserts.length, 0);
});

Deno.test("#1983 implementor: request_account_deletion sends side business", async () => {
  const tool = domainTool("request_account_deletion");
  const { client, invokes } = accountClient({ display_name: "Ada Lovelace" });
  await tool.executor(
    { legal_name: "Ada Lovelace", confirm_phrase: "DELETE" },
    client,
    USER,
  );
  assertEquals(invokes.length, 1);
  assertEquals(invokes[0].name, "delete-user");
  assertEquals(invokes[0].body, { side: "business" });
});

Deno.test("#1983 implementor: wrong legal_name never invokes delete-user", async () => {
  const tool = domainTool("request_account_deletion");
  const { client, invokes } = accountClient({ display_name: "Ada Lovelace" });
  await assertRejects(
    () =>
      tool.executor(
        { legal_name: "Wrong Name", confirm_phrase: "DELETE" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(invokes.length, 0);
});

Deno.test("#1983 implementor: email fallback when display_name empty", async () => {
  const tool = domainTool("request_account_deletion");
  const { client, invokes } = accountClient({
    display_name: "",
    email: "ada@example.com",
  });
  await tool.executor(
    { legal_name: "ada@example.com", confirm_phrase: "DELETE" },
    client,
    USER,
  );
  assertEquals(invokes[0].body, { side: "business" });
});

Deno.test("#1983 implementor: missing confirm_phrase DELETE fails", async () => {
  const tool = domainTool("request_account_deletion");
  const { client, invokes } = accountClient();
  await assertRejects(
    () => tool.executor({ legal_name: "Ada Lovelace" }, client, USER),
    ToolError,
  );
  await assertRejects(
    () =>
      tool.executor(
        { legal_name: "Ada Lovelace", confirm_phrase: "YES" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(invokes.length, 0);
});

Deno.test("#1983 implementor: create_support_ticket RPC args", async () => {
  const tool = domainTool("create_support_ticket");
  const { client, rpcs } = accountClient();
  await tool.executor(
    { subject: "Ari E2E test", brand_id: BRAND },
    client,
    USER,
  );
  assertEquals(rpcs.length, 1);
  assertEquals(rpcs[0].name, "create_support_ticket");
  assertEquals(rpcs[0].args, {
    p_subject: "Ari E2E test",
    p_brand_id: BRAND,
  });
});

Deno.test("#1983 implementor: update_ari_prefs patch keys", async () => {
  const tool = domainTool("update_ari_prefs");
  const { client, upserts } = accountClient();
  await tool.executor(
    {
      preferred_timezone: "America/Chicago",
      communication_style: "concise",
    },
    client,
    USER,
  );
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].table, "agent_user_profile");
  const row = upserts[0].rows as Record<string, unknown>;
  assertEquals(row.user_id, USER);
  assertEquals(row.preferred_timezone, "America/Chicago");
  assertEquals(row.communication_style, "concise");
  assert(!("email_enabled" in row));
});

Deno.test("#1983 implementor: PROMPT_VERSION v19 advertises prefs + business deletion", () => {
  assertEquals(PROMPT_VERSION, "v19");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(prompt.includes("push or in_app") || prompt.includes("push|in_app"));
  assert(prompt.includes("business.*"));
  assert(prompt.includes("Host (business)"));
  assert(prompt.includes("legal name + the word DELETE"));
});
