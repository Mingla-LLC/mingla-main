// #1980 — adversarial tester angle for marketing draft mutate + growth report.
// Distinct from the implementor suite: confirm-phrase, selector exclusivity,
// false growth-report hint, and PII column discipline.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1980_ari_marketing.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";
import { READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMPAIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_REF = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

Deno.test("#1980 tester: delete_campaign_draft stays behind confirm, never inline", () => {
  assert(MONEY_CONFIRM_TOOLS.has("delete_campaign_draft"));
  assert(!READ_ONLY_TOOL_NAMES.has("delete_campaign_draft"));
  const params = domainTool("delete_campaign_draft").parameters as {
    required: string[];
    properties: { confirm_phrase?: { enum?: string[] } };
  };
  assert(params.required.includes("confirm_phrase"));
  assertEquals(params.properties.confirm_phrase?.enum, ["DELETE"]);
});

Deno.test("#1980 tester: wrong delete confirm_phrase never reaches the table", async () => {
  let touched = false;
  const client = {
    from() {
      touched = true;
      throw new Error("delete must not run");
    },
  };
  const error = await assertRejects(
    () =>
      domainTool("delete_campaign_draft").executor(
        { campaign_id: CAMPAIGN, confirm_phrase: "SEND" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  assertEquals(touched, false);
});

Deno.test("#1980 tester: run_growth_tool must not advertise get_brand_analytics for reports", () => {
  const desc = String(domainTool("run_growth_tool").description);
  assert(!desc.includes("get_brand_analytics"));
  assert(desc.includes("get_growth_tool_report"));
});

Deno.test("#1980 tester: get_growth_tool_report refuses both/neither selectors", async () => {
  const invokeCalls: unknown[] = [];
  const client = {
    functions: {
      invoke(name: string, init: { body: unknown }) {
        invokeCalls.push({ name, body: init.body });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
  for (
    const args of [
      { brand_id: BRAND },
      { brand_id: BRAND, run_id: RUN, client_ref: CLIENT_REF },
    ]
  ) {
    const error = await assertRejects(
      () => domainTool("get_growth_tool_report").executor(args, client, USER),
      ToolError,
    );
    assertEquals(error.code, "INVALID_ARGS");
  }
  assertEquals(invokeCalls.length, 0);
});

Deno.test("#1980 tester: get_growth_tool_report never selects PII columns itself", () => {
  const src = Deno.readTextFileSync(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = src.indexOf('const getGrowthToolReport = writeTool(');
  const end = src.indexOf("// ----------------------------------------------------------------------------\n// J. Payouts", start);
  assert(start > 0 && end > start, "getGrowthToolReport block missing");
  const block = src.slice(start, end);
  for (const leak of ["email", "phone", "token", "recipient"]) {
    assert(
      !new RegExp(`\\b${leak}\\b`, "i").test(block),
      `get_growth_tool_report must not mention ${leak}`,
    );
  }
  assert(block.includes('invokeFn(client, "growth-tools-report"'));
  assert(block.includes('lane: "app"'));
});

Deno.test("#1980 tester: update_campaign_draft refuses rcs channel", async () => {
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              id: CAMPAIGN,
              status: "draft",
              channel: "email",
              channel_payload: {
                kind: "email",
                subject: "x",
                body_html: "<p>x</p>",
                body_text: "x",
                embedded_events: [],
              },
            },
            error: null,
          });
        },
        update() {
          throw new Error("must not update");
        },
      };
    },
  };
  const error = await assertRejects(
    () =>
      domainTool("update_campaign_draft").executor(
        { campaign_id: CAMPAIGN, channel: "rcs", body: "hi" },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
});
