const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

const tools = await read("../agentTools.ts");
const domains = await read("../agentDomainTools.ts");
const confirm = await read("../../agent-confirm-action/index.ts");

function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`unable to locate ${start}..${end}`);
  return source.slice(from, to);
}

Deno.test("#1972 every strict tool schema can satisfy its own required fields", () => {
  const setCover = region(
    domains,
    "const setEventCover",
    "const setEventGuestPrivacy",
  );
  const properties = region(setCover, "{\n    event_id:", "  },\n  [");
  if (!properties.includes("brand_id:")) {
    throw new Error(
      "set_event_cover requires brand_id while additionalProperties=false, but brand_id is absent from properties",
    );
  }
});

Deno.test("#1972 create_event exposes every promised date topology", () => {
  const createEvent = region(tools, "const createEvent", "const listBrands");
  for (const field of ["when_mode", "multi_dates", "recurrence_rule"]) {
    if (!createEvent.includes(`${field}:`)) {
      throw new Error(
        `create_event cannot express required ${field} lifecycle input`,
      );
    }
  }
});

Deno.test("#1972 ambiguous executing recovery is limited to receipt-backed tools", () => {
  if (!confirm.includes("RECEIPT_BACKED_EVENT_TOOL_NAMES")) {
    throw new Error(
      "agent-confirm-action retries executing state for every write tool, including tools without operation receipts",
    );
  }
  if (
    !confirm.includes("RECEIPT_BACKED_EVENT_TOOL_NAMES.has(pending.tool_name)")
  ) {
    throw new Error(
      "executing recovery has no explicit receipt-backed tool gate",
    );
  }
});

Deno.test("#1972 cancel and expiry return terminal state only after winning the CAS", () => {
  const cancel = region(
    confirm,
    'if (body.action === "cancel")',
    "// CONFIRM path.",
  );
  const expiry = region(
    confirm,
    'if (\n    pending.status === "pending"',
    "const finalArgs",
  );
  for (
    const [name, source] of [["cancel", cancel], ["expiry", expiry]] as const
  ) {
    if (
      !source.includes('.select("id, status")') ||
      !source.includes(".maybeSingle()")
    ) {
      throw new Error(
        `${name} transition does not verify that pending -> terminal affected the row before reporting success`,
      );
    }
  }
});

Deno.test("#1972 expiry cannot strand the proposal without a terminal receipt", () => {
  const expiry = region(
    confirm,
    'if (\n    pending.status === "pending"',
    "const finalArgs",
  );
  const stateWrite = expiry.indexOf('.update({ status: "expired" })');
  const terminalWrite = expiry.indexOf('outcome: "expired"');
  if (
    stateWrite >= 0 && terminalWrite > stateWrite &&
    !expiry.includes("terminalize_agent_pending_action") &&
    !expiry.includes("expiry_receipt")
  ) {
    throw new Error(
      "expiry commits status before the terminal message; a message failure permanently strands the visible proposal",
    );
  }
});
