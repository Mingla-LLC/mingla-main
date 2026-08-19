const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

const migration = await read(
  "../../../migrations/20270422001972_issue_1972_ari_event_lifecycle.sql",
);
const confirm = await read("../../agent-confirm-action/index.ts");
const chat = await read("../../agent-chat/index.ts");
const domains = await read("../agentDomainTools.ts");
const prompt = await read("../agentSystemPrompt.ts");
const tools = await read("../agentTools.ts");
const coverAttestation = await read(
  "../../event-cover-attest-selection/index.ts",
);

function includesAll(source: string, needles: string[]): void {
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`missing contract: ${needle}`);
    }
  }
}

Deno.test("#1972 pending actions are server-attested and authenticated callers cannot forge execution", () => {
  includesAll(migration, [
    "server_proposed_at timestamptz",
    "execution_attested_at timestamptz",
    "REVOKE INSERT,UPDATE,DELETE ON public.agent_pending_actions FROM authenticated",
    "v_pending.server_proposed_at IS NULL",
    "v_pending.execution_attested_at IS NULL",
  ]);
  includesAll(chat, [
    '.from("agent_pending_actions")',
    "server_proposed_at: new Date().toISOString()",
  ]);
  includesAll(confirm, [
    "buildServiceClient()",
    "execution_attested_at: new Date().toISOString()",
    '.eq("user_id", userId)',
  ]);
});

Deno.test("#1972 confirmation preserves edited canonical args and terminally records expiry", () => {
  includesAll(confirm, [
    "args: finalArgs",
    '.contains("tool_calls", { pending_action_id: pending.id })',
    'outcome: "expired"',
    "expired_regenerate",
  ]);
});

Deno.test("#1972 event writes dispatch through one exact-once operation receipt", () => {
  includesAll(migration, [
    "CREATE OR REPLACE FUNCTION public.ari_execute_event_operation",
    "public.agent_operation_receipt_begin",
    "public.agent_operation_receipt_complete",
    "CREATE OR REPLACE FUNCTION public.business_duplicate_event_as_draft",
    "CREATE TRIGGER issue_1972_prepare_event_cancel_refunds",
    "CREATE OR REPLACE FUNCTION public.business_register_event_cover_selection",
  ]);
  includesAll(domains, [
    'callRpc(client, "ari_execute_event_operation"',
    "const discardEventDraft = writeTool(",
  ]);
  const eventLifecycleRegion = domains.slice(
    domains.indexOf("const publishEvent"),
    domains.indexOf("const upsertTicketTier"),
  );
  if (/\.from\("events"\)\s*\.update/.test(eventLifecycleRegion)) {
    throw new Error("event domain tool bypasses the canonical dispatcher");
  }
});

Deno.test("#1972 tool registry and prompt expose discard while camera scan remains guided", () => {
  includesAll(domains, ['"discard_event_draft"']);
  includesAll(prompt, [
    "- discard_event_draft —",
    "Ticket scanning cannot run in chat because it needs the device camera",
  ]);
});

Deno.test("#1972 create topology and upcoming list use the canonical typed contract", () => {
  includesAll(tools, [
    "when_mode:",
    "multi_dates:",
    "recurrence_rule:",
    "preset:",
    "termination:",
    "p_upcoming_only:",
  ]);
  includesAll(migration, [
    "event_multi_dates_invalid",
    "event_recurrence_invalid",
    "v_event.theme#>'{business_draft,when}'",
  ]);
});

Deno.test("#1972 cover selection is provider/storage-attested and clear is separate", () => {
  includesAll(migration, [
    "trusted_cover_attestation_required",
    "assert_event_cover_selection_source",
    "business_clear_event_cover_media",
  ]);
  includesAll(coverAttestation, [
    "api.pexels.com/v1/photos/",
    "api.giphy.com/v1/gifs/",
    '"business_register_event_cover_selection"',
  ]);
});
