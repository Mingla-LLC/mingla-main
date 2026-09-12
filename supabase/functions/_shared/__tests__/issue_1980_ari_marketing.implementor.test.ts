// #1980 — marketing audiences, templates, campaign reports, draft mutate,
// growth report read.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1980_ari_marketing.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  DOMAIN_READ_ONLY,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { PROMPT_VERSION, buildSystemPrompt } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMPAIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUDIENCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_REF = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

Deno.test("#1980 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_marketing_audiences, {
    requiredRole: "marketing_manager",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_marketing_templates, {
    requiredRole: "marketing_manager",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_campaign_report, {
    requiredRole: "marketing_manager",
    resource: "campaign",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.update_campaign_draft, {
    requiredRole: "marketing_manager",
    resource: "campaign",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.delete_campaign_draft, {
    requiredRole: "marketing_manager",
    resource: "campaign",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_growth_tool_report, {
    requiredRole: "marketing_manager",
    resource: "brand",
  });
  assert(DOMAIN_READ_ONLY.has("get_campaign_report"));
  assert(DOMAIN_READ_ONLY.has("get_growth_tool_report"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_campaign_report"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_growth_tool_report"));
  assert(MONEY_CONFIRM_TOOLS.has("delete_campaign_draft"));
  assert(isReadOnlyAgentToolCall("manage_marketing_audiences", { action: "list" }));
  assert(!isReadOnlyAgentToolCall("manage_marketing_audiences", {
    action: "ensure_brand_buyers",
  }));
  assert(isReadOnlyAgentToolCall("manage_marketing_templates", { action: "list" }));
  assert(isReadOnlyAgentToolCall("get_growth_tool_report", { brand_id: BRAND }));
  assert(!isReadOnlyAgentToolCall("update_campaign_draft", { campaign_id: CAMPAIGN }));
  assert(!isReadOnlyAgentToolCall("delete_campaign_draft", { campaign_id: CAMPAIGN }));
  for (const name of [
    "manage_marketing_audiences",
    "manage_marketing_templates",
    "get_campaign_report",
    "update_campaign_draft",
    "delete_campaign_draft",
    "get_growth_tool_report",
  ]) {
    assert(DOMAIN_TOOLS.some((t) => t.name === name), name);
  }
});

// [TEST-MOD-APPROVED #1980] prompt bumped with draft mutate + growth report tools.
Deno.test("#1980 implementor: PROMPT_VERSION v17 advertises new tools", () => {
  // [TEST-MOD-APPROVED #1981] prompt v17→v18 for refund/cancel discovery (append-only auth).
  assertEquals(PROMPT_VERSION, "v18");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assertStringIncludes(prompt, "update_campaign_draft");
  assertStringIncludes(prompt, "delete_campaign_draft");
  assertStringIncludes(prompt, "get_growth_tool_report");
  assert(
    !/run_growth_tool[\s\S]{0,200}get_brand_analytics/.test(prompt),
    "prompt must not steer growth reports to get_brand_analytics",
  );
});

Deno.test("#1980 implementor: run_growth_tool description points at get_growth_tool_report", () => {
  const desc = String(domainTool("run_growth_tool").description);
  assertStringIncludes(desc, "get_growth_tool_report");
  assert(!desc.includes("get_brand_analytics"));
});

type CampaignRow = {
  id: string;
  status: string;
  channel: string;
  channel_payload: Record<string, unknown>;
  name?: string;
  audience_id?: string;
};

function campaignClient(opts: {
  row: CampaignRow | null;
  updateResult?: Record<string, unknown> | null;
  deleteIds?: string[];
  invoke?: (name: string, body: Record<string, unknown>) => unknown;
}) {
  const writes: Array<{ op: string; payload?: unknown; filters: Record<string, unknown> }> =
    [];
  const invokeCalls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "select";
    let updatePayload: unknown = null;
    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(key: string, value: unknown) {
        filters[key] = value;
        return chain;
      },
      update(payload: unknown) {
        op = "update";
        updatePayload = payload;
        writes.push({ op, payload, filters: { ...filters } });
        return chain;
      },
      delete() {
        op = "delete";
        writes.push({ op, filters: { ...filters } });
        return chain;
      },
      maybeSingle() {
        if (table !== "marketing_campaigns") {
          return Promise.resolve({ data: null, error: null });
        }
        if (op === "update") {
          const statusOk = filters.status === "draft";
          const idOk = filters.id === CAMPAIGN;
          if (!statusOk || !idOk || opts.row?.status !== "draft") {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({
            data: opts.updateResult ?? {
              id: CAMPAIGN,
              name: (updatePayload as { name?: string })?.name ?? opts.row?.name,
              status: "draft",
              channel: (updatePayload as { channel?: string })?.channel ??
                opts.row?.channel,
              audience_id:
                (updatePayload as { audience_id?: string })?.audience_id ??
                  opts.row?.audience_id,
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: opts.row && filters.id === CAMPAIGN ? opts.row : null,
          error: null,
        });
      },
      then(
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        if (op === "delete" && table === "marketing_campaigns") {
          const ok = filters.id === CAMPAIGN && filters.status === "draft" &&
            opts.row?.status === "draft";
          const data = ok
            ? (opts.deleteIds ?? [{ id: CAMPAIGN }])
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    writes,
    invokeCalls,
    client: {
      from: (table: string) => builder(table),
      functions: {
        invoke(name: string, init: { body: Record<string, unknown> }) {
          invokeCalls.push({ name, body: init.body });
          return Promise.resolve({
            data: opts.invoke ? opts.invoke(name, init.body) : { ok: true },
            error: null,
          });
        },
      },
    },
  };
}

Deno.test("#1980 implementor: update_campaign_draft rebuilds email payload", async () => {
  const { client, writes } = campaignClient({
    row: {
      id: CAMPAIGN,
      status: "draft",
      channel: "email",
      channel_payload: {
        kind: "email",
        subject: "Old",
        body_html: "<p>Old</p>",
        body_text: "Old",
        embedded_events: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      },
      name: "Old name",
      audience_id: AUDIENCE,
    },
  });
  const result = await domainTool("update_campaign_draft").executor(
    {
      campaign_id: CAMPAIGN,
      title: "Autumn blast",
      subject: "Doors at 9",
      body: "<p>See you there.</p>",
      channel: "email",
    },
    client,
    USER,
  );
  assertEquals((result as { name?: string }).name, "Autumn blast");
  const update = writes.find((w) => w.op === "update");
  assert(update);
  const payload = (update!.payload as { channel_payload: Record<string, unknown> })
    .channel_payload;
  assertEquals(payload.kind, "email");
  assertEquals(payload.subject, "Doors at 9");
  assertEquals(payload.body_html, "<p>See you there.</p>");
  assertEquals(payload.body_text, "See you there.");
  assertEquals(payload.embedded_events, [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ]);
  assert(!Object.prototype.hasOwnProperty.call(payload, "body"));
});

Deno.test(
  "#1980 implementor: subject-only email edit preserves embedded_events",
  async () => {
    const { client, writes } = campaignClient({
      row: {
        id: CAMPAIGN,
        status: "draft",
        channel: "email",
        channel_payload: {
          kind: "email",
          subject: "Old",
          body_html: "<p>Keep me</p>",
          body_text: "Keep me",
          embedded_events: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        },
      },
    });
    await domainTool("update_campaign_draft").executor(
      { campaign_id: CAMPAIGN, subject: "New subject only" },
      client,
      USER,
    );
    const update = writes.find((w) => w.op === "update");
    assert(update);
    const payload = (update!.payload as { channel_payload: Record<string, unknown> })
      .channel_payload;
    assertEquals(payload.subject, "New subject only");
    assertEquals(payload.body_html, "<p>Keep me</p>");
    assertEquals(payload.embedded_events, [
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  },
);

Deno.test(
  "#1980 implementor: SMS body edit preserves media_urls and short_url_token",
  async () => {
    const { client, writes } = campaignClient({
      row: {
        id: CAMPAIGN,
        status: "draft",
        channel: "sms",
        channel_payload: {
          kind: "sms",
          body: "old sms",
          media_urls: ["https://cdn.example/mms.jpg"],
          short_url_token: "tok_preserve",
        },
      },
    });
    await domainTool("update_campaign_draft").executor(
      { campaign_id: CAMPAIGN, body: "new sms body" },
      client,
      USER,
    );
    const update = writes.find((w) => w.op === "update");
    assert(update);
    const payload = (update!.payload as { channel_payload: Record<string, unknown> })
      .channel_payload;
    assertEquals(payload.kind, "sms");
    assertEquals(payload.body, "new sms body");
    assertEquals(payload.media_urls, ["https://cdn.example/mms.jpg"]);
    assertEquals(payload.short_url_token, "tok_preserve");
  },
);

Deno.test("#1980 implementor: update_campaign_draft refuses non-draft", async () => {
  const { client, writes } = campaignClient({
    row: {
      id: CAMPAIGN,
      status: "scheduled",
      channel: "email",
      channel_payload: {
        kind: "email",
        subject: "x",
        body_html: "<p>x</p>",
        body_text: "x",
        embedded_events: [],
      },
    },
  });
  const error = await assertRejects(
    () =>
      domainTool("update_campaign_draft").executor(
        { campaign_id: CAMPAIGN, title: "Nope" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  assertEquals(writes.filter((w) => w.op === "update").length, 0);
});

Deno.test("#1980 implementor: update_campaign_draft refuses empty email body", async () => {
  const { client, writes } = campaignClient({
    row: {
      id: CAMPAIGN,
      status: "draft",
      channel: "email",
      channel_payload: {
        kind: "email",
        subject: "x",
        body_html: "<p>ok</p>",
        body_text: "ok",
        embedded_events: [],
      },
    },
  });
  const error = await assertRejects(
    () =>
      domainTool("update_campaign_draft").executor(
        { campaign_id: CAMPAIGN, body: "   ", subject: "Hi" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  assertStringIncludes(error.message, "body_html");
  assertEquals(writes.filter((w) => w.op === "update").length, 0);
});

Deno.test("#1980 implementor: delete_campaign_draft requires DELETE and draft-only", async () => {
  const schema = domainTool("delete_campaign_draft").parameters as {
    required: string[];
    properties: { confirm_phrase: { enum: string[] } };
  };
  assert(schema.required.includes("confirm_phrase"));
  assertEquals(schema.properties.confirm_phrase.enum, ["DELETE"]);

  const missing = await assertRejects(
    () =>
      domainTool("delete_campaign_draft").executor(
        { campaign_id: CAMPAIGN },
        campaignClient({
          row: {
            id: CAMPAIGN,
            status: "draft",
            channel: "sms",
            channel_payload: { kind: "sms", body: "hi" },
          },
        }).client,
        USER,
      ),
    ToolError,
  );
  assertEquals(missing.code, "INVALID_ARGS");

  const { client: okClient, writes } = campaignClient({
    row: {
      id: CAMPAIGN,
      status: "draft",
      channel: "sms",
      channel_payload: { kind: "sms", body: "hi" },
    },
  });
  const deleted = await domainTool("delete_campaign_draft").executor(
    { campaign_id: CAMPAIGN, confirm_phrase: "DELETE" },
    okClient,
    USER,
  );
  assertEquals(deleted, { deleted: true, campaign_id: CAMPAIGN });
  assert(writes.some((w) => w.op === "delete"));

  const nonDraft = await assertRejects(
    () =>
      domainTool("delete_campaign_draft").executor(
        { campaign_id: CAMPAIGN, confirm_phrase: "DELETE" },
        campaignClient({
          row: {
            id: CAMPAIGN,
            status: "scheduled",
            channel: "sms",
            channel_payload: { kind: "sms", body: "hi" },
          },
        }).client,
        USER,
      ),
    ToolError,
  );
  assertEquals(nonDraft.code, "INVALID_ARGS");
});

Deno.test("#1980 implementor: get_growth_tool_report app-lane exclusive selector", async () => {
  const { client, invokeCalls } = campaignClient({
    row: null,
    invoke: () => ({
      status: "report_ready",
      run_id: RUN,
      created_at: "2026-09-10T00:00:00Z",
      report: { grade: "A" },
    }),
  });
  await domainTool("get_growth_tool_report").executor(
    { brand_id: BRAND, run_id: RUN },
    client,
    USER,
  );
  assertEquals(invokeCalls[0].name, "growth-tools-report");
  assertEquals(invokeCalls[0].body, {
    lane: "app",
    brand_id: BRAND,
    run_id: RUN,
  });

  const { client: byRef, invokeCalls: refCalls } = campaignClient({
    row: null,
    invoke: () => ({ status: "created", reason: null }),
  });
  await domainTool("get_growth_tool_report").executor(
    { brand_id: BRAND, client_ref: CLIENT_REF },
    byRef,
    USER,
  );
  assertEquals(refCalls[0].body.client_ref, CLIENT_REF);
  assertEquals(refCalls[0].body.run_id, undefined);

  for (
    const bad of [
      { brand_id: BRAND },
      { brand_id: BRAND, run_id: RUN, client_ref: CLIENT_REF },
    ]
  ) {
    const { client: badClient, invokeCalls: badCalls } = campaignClient({
      row: null,
      invoke: () => ({ ok: true }),
    });
    const error = await assertRejects(
      () => domainTool("get_growth_tool_report").executor(bad, badClient, USER),
      ToolError,
    );
    assertEquals(error.code, "INVALID_ARGS");
    assertEquals(badCalls.length, 0);
  }
});
// [TEST-MOD-APPROVED #1980] append-only override commit marker
