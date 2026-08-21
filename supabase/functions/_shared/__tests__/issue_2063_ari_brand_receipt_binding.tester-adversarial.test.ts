import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

const USER_ID = "2063eeee-0000-4000-8000-000000000001";
const BRAND_ID = "2063eeee-0000-4000-8000-000000000002";
const VENUE_ID = "2063eeee-0000-4000-8000-000000000003";
const OPERATION_ID = "2063eeee-0000-4000-8000-000000000004";

Deno.test("#2063 tester: hours confirmation preserves the exact pending receipt payload", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const tool = findTool("manage_brand_hours");
  assert(tool);

  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "biz_brand_effective_rank_for_caller") {
        return { data: 60, error: null };
      }
      if (name === "biz_role_rank") return { data: 50, error: null };
      return { data: { ok: true }, error: null };
    },
    from: (table: string) => {
      const row = table === "brands"
        ? { id: BRAND_ID, account_id: USER_ID, deleted_at: null }
        : table === "venue_listings"
        ? { id: VENUE_ID, brand_id: BRAND_ID }
        : [];
      const query: Record<string, unknown> = {};
      for (
        const method of ["select", "eq", "is", "not", "order", "limit", "lt"]
      ) {
        query[method] = () => query;
      }
      query.maybeSingle = () => Promise.resolve({ data: row, error: null });
      query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: row, error: null }).then(resolve);
      return query;
    },
  };

  // The provider schema requires one row per weekday, but deliberately does
  // not require ordering or null-valued time keys on closed days. Both forms
  // are valid proposal bytes and are persisted by #1972 before confirmation.
  const args = {
    brand_id: BRAND_ID,
    venue_id: VENUE_ID,
    hours: Array.from({ length: 7 }, (_, index) => {
      const weekday = 6 - index;
      return weekday === 6 ? { weekday, is_closed: true } : {
        weekday,
        open_time: "09:00",
        close_time: "17:00",
        is_closed: false,
      };
    }),
  };

  await tool.executor(
    args,
    client as never,
    USER_ID,
    { operationId: OPERATION_ID },
  );

  const operation = calls.find((call) =>
    call.name === "ari_execute_brand_operation"
  );
  assert(operation);
  assertEquals(
    operation.params.p_args,
    args,
    "normalizing after proposal persistence makes #1972 reject the confirmation as operation_binding_mismatch",
  );
});
