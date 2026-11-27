// MINGLA-INVARIANT: I-ARI-NO-CARD-WITHOUT-PROSE | issue #4637 | No assistant proposal or rendition is committed without owner prose.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposalOwnerLead } from "../ariPresentation/registry.ts";

Deno.test("proposal registry always creates a non-empty confirmation lead", () => {
  const lead = proposalOwnerLead("create_discount", {
    name: "Regular launch",
    value_bps: 10000,
    targets: [{ target_kind: "ticket_type", target_id: crypto.randomUUID() }],
  });
  assert(lead.trim().length > 0);
  assertStringIncludes(lead, "Confirm");
});

Deno.test("database guard and both proposal writers reject empty card prose", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20281207014637_issue_4637_ari_amendment_guard.sql",
      import.meta.url,
    ),
  );
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const confirm = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assertStringIncludes(migration, "assistant cards require prose");
  assertStringIncludes(chat, "text: proposalLead");
  assertStringIncludes(confirm, "text: proposalOwnerLead(");
  assertStringIncludes(
    confirm,
    "const editedScopeIssue = await originatingAriScopeIssue(",
  );
  assertStringIncludes(
    confirm,
    "const continuationScopeIssue = await originatingAriScopeIssue(",
  );
  assertStringIncludes(confirm, "const ownerText = ariScopeTextForTurn(");
  assertStringIncludes(
    confirm,
    "origin_client_turn_id: pending.origin_client_turn_id",
  );
  const probe = confirm.indexOf("await probePendingForConfirm(");
  const unknownTool = confirm.indexOf("const tool = findTool(");
  const authorize = confirm.indexOf("await authorizeAgentTool(");
  assert(probe >= 0 && probe < unknownTool && probe < authorize);
  assertStringIncludes(
    confirm,
    'rpc("replace_agent_pending_action_for_edit"',
  );
  assertStringIncludes(
    migration,
    "v_answer := public.agent_pending_action_claim_for_confirm(",
  );
});
