// #1971 — Ari trip registry parity and revision-required mutation contracts.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOLS, findTool } from "../agentTools.ts";

const domainSource = await Deno.readTextFile(
  "supabase/functions/_shared/agentDomainTools.ts",
);
const hookSource = await Deno.readTextFile(
  "mingla-business/src/hooks/useTrips.ts",
);
const confirmSource = await Deno.readTextFile(
  "supabase/functions/agent-confirm-action/index.ts",
);

const names = [
  "create_trip",
  "update_trip",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "get_trip_order_money",
  "publish_trip",
  "delete_trip",
];

Deno.test("#1971 all nine trip ledger operations are registered", () => {
  const registered = new Set(AGENT_TOOLS.map((tool) => tool.name));
  for (const name of names) assert(registered.has(name), `${name} missing`);
});

Deno.test("#1971 every existing-trip mutation requires a server revision", () => {
  for (
    const name of names.filter((name) =>
      !["create_trip", "get_trip_order_money"].includes(name)
    )
  ) {
    const tool = findTool(name)!;
    const required = (tool.parameters.required ?? []) as string[];
    assert(
      required.includes("expected_updated_at"),
      `${name} lacks revision CAS`,
    );
  }
});

Deno.test("#1971 order money requires finance_manager and no tool accepts operation_id from the model", () => {
  assertEquals(
    findTool("get_trip_order_money")?.requiredRole,
    "finance_manager",
  );
  for (const name of names) {
    const properties = (findTool(name)?.parameters.properties ?? {}) as Record<
      string,
      unknown
    >;
    assert(
      !("operation_id" in properties),
      `${name} exposes internal operation_id`,
    );
  }
});

Deno.test("#1971 mutations consume the immutable pending-action operation id", () => {
  assert(domainSource.includes('callRpc(client, "ari_execute_trip_operation"'));
  assert(domainSource.includes("requireAgentOperationId(context)"));
  for (
    const name of names.filter((name) =>
      !["get_trip_order_money"].includes(name)
    )
  ) {
    assert(
      confirmSource.includes(`"${name}"`),
      `${name} is not receipt-backed`,
    );
  }
});

Deno.test("#1971 Business retries pin both operation id and CAS revision", () => {
  assert(hookSource.includes("ensureTripOperationId(input)"));
  assert(hookSource.includes("ensureTripMutationRevision(input)"));
  assert(
    hookSource.includes(
      "input.expectedUpdatedAt = await getTripRevision(input.eventId)",
    ),
  );
});
