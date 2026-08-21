import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifiedProposalArgs } from "../agentTicketPricing.ts";

Deno.test("#1974 initial confirmation receives the same verified safe proposal context", () => {
  const result = verifiedProposalArgs(
    { event_id: "19740000-0000-4000-8000-000000000001", is_free: false },
    {
      lifecycle: "live",
      effective_currency: "EUR",
      payout_ready: true,
      current_capacity: 50,
      proposed_capacity: 75,
      stripe_account_id: "acct_must_not_render",
      provider_secret: "must_not_render",
    },
  );
  assertEquals(result.__proposal_context, {
    lifecycle: "live",
    effective_currency: "EUR",
    payout_ready: true,
    current_capacity: 50,
    proposed_capacity: 75,
  });
  const serialized = JSON.stringify(result);
  assertFalse(serialized.includes("acct_must_not_render"));
  assertFalse(serialized.includes("must_not_render"));
});
