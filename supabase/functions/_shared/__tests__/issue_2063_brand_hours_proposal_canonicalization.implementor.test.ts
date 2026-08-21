import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalizeAgentProposalArgs } from "../agentTools.ts";

const BRAND_ID = "2063ffff-0000-4000-8000-000000000001";
const VENUE_ID = "2063ffff-0000-4000-8000-000000000002";

Deno.test("#2063 implementor: hours are canonical before immutable proposal persistence", async () => {
  const proposed = {
    brand_id: BRAND_ID,
    venue_id: VENUE_ID,
    hours: [
      { weekday: 6, is_closed: true },
      {
        weekday: 5,
        open_time: "22:00",
        close_time: "02:00",
        is_closed: false,
      },
      ...Array.from({ length: 5 }, (_, weekday) => ({
        weekday,
        open_time: "09:00",
        close_time: "17:00",
        is_closed: false,
      })).reverse(),
    ],
  };

  const canonical = canonicalizeAgentProposalArgs(
    "manage_brand_hours",
    proposed,
  );
  const hours = canonical.hours as Array<Record<string, unknown>>;
  assertEquals(hours.map((row) => row.weekday), [0, 1, 2, 3, 4, 5, 6]);
  assertEquals(hours[5], {
    weekday: 5,
    open_time: "22:00",
    close_time: "02:00",
    is_closed: false,
  });
  assertEquals(hours[6], {
    weekday: 6,
    open_time: null,
    close_time: null,
    is_closed: true,
  });
  assertEquals(
    canonicalizeAgentProposalArgs("manage_brand_hours", canonical),
    canonical,
    "canonicalization must be idempotent across proposal and confirmation",
  );

  const chatSource = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const proposalCanonicalization = chatSource.indexOf(
    "gemini.toolCall.args = canonicalizeAgentProposalArgs(",
  );
  const pendingPersistence = chatSource.indexOf(
    '.from("agent_pending_actions")',
    proposalCanonicalization,
  );
  assert(
    proposalCanonicalization >= 0 &&
      pendingPersistence > proposalCanonicalization,
    "canonical hours must be produced before pending proposal persistence",
  );

  const confirmSource = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  const confirmationCanonicalization = confirmSource.indexOf(
    "canonicalArgs = canonicalizeAgentProposalArgs(",
  );
  const confirmedPersistence = confirmSource.indexOf(
    "tool_args: finalArgs",
    confirmationCanonicalization,
  );
  assert(
    confirmationCanonicalization >= 0 &&
      confirmedPersistence > confirmationCanonicalization,
    "edited hours must be canonical before their confirmed payload is persisted",
  );
});
