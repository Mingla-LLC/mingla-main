// #2592 — a stale reservation version is a user-actionable conflict, not a
// server fault.
//
// `issue_1975_reservation_transition` is the only optimistic-concurrency site
// Ari calls straight through `callRpc`, with no owning Edge function in front
// of it to translate the conflict. Every Edge-owned sibling
// (`manage-stay-inventory`, `stay-reservations`,
// `manage-brand-discovery-currency`) maps its stable conflict literal to HTTP
// 409; this one fell through to 500, which is the single status the Ari
// envelope contract classifies `retryability: "after_backoff"` /
// `safe_to_retry: true`. Telling a caller that a deterministic, permanently
// reproducible mistake is a retryable server fault is how the same stale
// `expected_version` gets re-sent unchanged.
//
// Following the #2009 precedent, the status is taken by EXECUTING the shipped
// `toolErrorHttpStatus` and by reading the code off a REAL ToolError raised by
// the shipped executor — never a string typed by hand here. A check that can
// only read source text carries no information (#2113).
//
// Run:
//   deno test --no-check --allow-env --allow-net --allow-read \
//     supabase/functions/agent-confirm-action/__tests__/issue_2592_version_conflict_status.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toolErrorHttpStatus } from "../index.ts";
import { DOMAIN_TOOLS } from "../../_shared/agentDomainTools.ts";
import { ToolError } from "../../_shared/agentToolHelpers.ts";

const RESERVATION = "33333333-3333-4333-8333-333333333333";
const OPERATION = "55555555-5555-4555-8555-555555555555";

/** The exact conflict `issue_1975_reservation_transition` raises. */
function conflictingClient() {
  return {
    rpc: (_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({
        data: null,
        error: {
          code: "40001",
          message: "reservation_version_conflict_expected_2_actual_7",
        },
      }),
  };
}

Deno.test("#2592 the shipped executor's version-conflict code maps to 409, not 500", async () => {
  // deno-lint-ignore no-explicit-any
  const tool = DOMAIN_TOOLS.find((t: any) =>
    t.name === "transition_venue_reservation"
  );
  assert(tool, "transition_venue_reservation must be registered");

  const error = await assertRejects(
    () =>
      tool.executor(
        {
          reservation_id: RESERVATION,
          to_status: "seated",
          expected_version: 2,
        },
        conflictingClient() as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );

  // The code is read off the real error the shipped executor raised.
  const status = toolErrorHttpStatus(error.code);
  assertEquals(
    status,
    409,
    `a stale expected_version must be a 409 conflict, got ${status} for ${error.code}`,
  );
  assert(
    status !== 500,
    "a deterministic caller mistake must never be reported as a server fault",
  );
});

Deno.test("#2592 500 stays reserved for genuinely unclassified tool failures", () => {
  // The guard cuts both ways: widening the branch until everything is a 409
  // would be as dishonest as the 500 it replaces.
  assertEquals(toolErrorHttpStatus("RPC_FAILED"), 500);
  assertEquals(toolErrorHttpStatus("EDGE_FAILED"), 500);
  assertEquals(toolErrorHttpStatus("VERSION_CONFLICT"), 409);
});
