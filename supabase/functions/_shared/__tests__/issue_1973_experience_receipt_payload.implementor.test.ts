import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

const USER_ID = "19730000-0000-4000-8000-000000000701";
const BRAND_ID = "19730000-0000-4000-8000-000000000702";
const EVENT_ID = "19730000-0000-4000-8000-000000000703";
const OPERATION_ID = "19730000-0000-4000-8000-000000000704";

function clientThatCaptures(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): never {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "gt", "limit"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({
        data: table === "events"
          ? { id: EVENT_ID, brand_id: BRAND_ID, event_type: "experience" }
          : null,
        error: null,
      });
      builder.then = (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
      ) => resolve({ data: [], error: null });
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "biz_brand_effective_rank_for_caller") {
        return { data: 40, error: null };
      }
      if (name === "biz_role_rank") return { data: 40, error: null };
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    },
  };
  return client as never;
}

Deno.test("#1973 confirmed experience tools bind the exact public payload to the receipt RPC", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "update_experience",
      {
        event_id: EVENT_ID,
        expected_revision: "2026-08-20T21:00:00.000Z",
        title: "Public shape title",
        description: "Public shape description",
      },
    ],
    [
      "manage_experience_stops",
      {
        event_id: EVENT_ID,
        expected_revision: "2026-08-20T21:00:00.000Z",
        stops: [
          {
            stop_order: 0,
            place_name: "First stop",
            coordinate_precision: "exact",
          },
        ],
        experience_intents: ["adventurous"],
      },
    ],
    [
      "publish_experience",
      {
        event_id: EVENT_ID,
        expected_revision: "2026-08-20T21:00:00.000Z",
        patch: {},
      },
    ],
  ];

  for (const [toolName, publicArgs] of cases) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const tool = findTool(toolName);
    if (!tool) throw new Error(`${toolName} missing`);
    await tool.executor(
      publicArgs,
      clientThatCaptures(calls),
      USER_ID,
      { operationId: OPERATION_ID },
    );
    const execution = calls.find((call) =>
      call.name === "ari_execute_experience_operation"
    );
    if (!execution) throw new Error(`${toolName} did not execute`);
    assertEquals(execution.args.p_tool_name, toolName);
    assertStrictEquals(execution.args.p_args, publicArgs);
  }
});
