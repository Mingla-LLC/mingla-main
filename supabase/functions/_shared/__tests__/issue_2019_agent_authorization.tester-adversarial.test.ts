const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

const secureWrapperReauth =
  /await\s+authorizeAgentTool\(\s*\{\s*\.\.\.declaration,\s*name:\s*definition\.name,\s*parameters:\s*definition\.parameters,?\s*\},\s*args,\s*client,\s*userId,?\s*\)/s;
const directEventBinding =
  /rowBrand\(\s*client,\s*"events",\s*args\.event_id,\s*"brand_id, event_type",\s*true,?\s*\)/s;
const guestBinding =
  /rowBrand\(\s*client,\s*"event_rsvp_guests",\s*guestId,\s*"rsvp_id",?\s*\)/s;
const rsvpBinding =
  /rowBrand\(\s*client,\s*"event_rsvps",\s*guest\.rsvp_id,\s*"event_id",?\s*\)/s;
const eventBinding =
  /rowBrand\(\s*client,\s*"events",\s*rsvp\.event_id,\s*"brand_id, event_type",\s*true,?\s*\)/s;
const partnerBinding =
  /rowBrand\(\s*client,\s*"partner_brand_links",\s*args\.partner_id,?\s*\)/s;

Deno.test("#2019 tester: proposal and confirmation authorization ordering is fail-closed", async () => {
  const chat = await read("agent-chat/index.ts");
  const confirm = await read("agent-confirm-action/index.ts");
  const proposalAuth = chat.indexOf(
    "await authorizeAgentTool(tool, gemini.toolCall.args",
  );
  const pendingInsert = chat.indexOf(
    '.from("agent_pending_actions")',
    proposalAuth,
  );
  assert(
    proposalAuth > 0 && pendingInsert > proposalAuth,
    "proposal persisted before authorization",
  );
  const finalArgs = confirm.indexOf("const finalArgs");
  const confirmAuth = confirm.indexOf(
    "await authorizeAgentTool(tool, finalArgs",
  );
  const executing = confirm.indexOf('status: "executing"', confirmAuth);
  assert(
    finalArgs > 0 && confirmAuth > finalArgs && executing > confirmAuth,
    "final args not authorized before executing",
  );
});

Deno.test("#2019 tester: no duplicate owner/rank helper or service-role authorization", async () => {
  const files = await Promise.all([
    read("_shared/agentToolHelpers.ts"),
    read("_shared/agentTools.ts"),
    read("_shared/agentDomainTools.ts"),
    read("_shared/agentToolAuthorization.ts"),
  ]);
  const source = files.join("\n");
  assert(!source.includes("assertBrandOwned"), "owner-only helper remains");
  assert(
    !source.includes("assertEventOwned"),
    "owner-only event helper remains",
  );
  assert(
    !source.includes('biz_brand_effective_rank"'),
    "non-caller-bound rank RPC remains",
  );
  assert(
    !source.includes("service_role"),
    "service role appears in authorization surface",
  );
  assert(
    !/\b(owner|account_owner)\s*:\s*\d+/.test(source),
    "stale/local role map remains",
  );
});

Deno.test("#2019 tester: every registry writer is wrapped and reauthorized", async () => {
  const tools = await read("_shared/agentTools.ts");
  const auth = await read("_shared/agentToolAuthorization.ts");
  assert(
    tools.includes("secureAgentTools(["),
    "runtime registry bypasses wrapper",
  );
  assert(
    secureWrapperReauth.test(auth),
    "executor wrapper lacks exact ordered reauth arguments",
  );
  assert(
    auth.includes("biz_brand_effective_rank_for_caller"),
    "caller-bound authority missing",
  );
  assert(
    auth.includes('rpc("biz_role_rank"'),
    "canonical required-rank authority missing",
  );
});

Deno.test("#2019 tester: shared argument validation precedes resource and rank authority", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  const entry = auth.indexOf("export async function authorizeAgentTool");
  const metadata = auth.indexOf(
    "const expected = AGENT_TOOL_AUTHORIZATION",
    entry,
  );
  const validate = auth.indexOf(
    "validateBeforeAuthorization(tool, args)",
    metadata,
  );
  const resolve = auth.indexOf(
    "await resolveBrand(tool.name, expected, args",
    validate,
  );
  assert(
    entry >= 0 && metadata > entry && validate > metadata && resolve > validate,
    "proposal/confirmation args can reach resource authority before schema validation",
  );
});

Deno.test("#2019 tester: zero membership is generic-unavailable before below-rank feedback", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  const zero = auth.indexOf("if (actualRank <= 0) unavailable()");
  const below = auth.indexOf("if (actualRank < requiredRank)", zero);
  assert(
    zero > 0 && below > zero,
    "unrelated tenants can reach role-specific denial detail",
  );
});

Deno.test("#2019 tester: event resources reject deleted rows and type confusion", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  assert(
    directEventBinding.test(auth),
    "direct event binding does not exclude deleted rows or load canonical type",
  );
  assert(
    auth.includes("assertExpectedEventType(toolName, row)"),
    "type-specific offering tools do not enforce canonical event_type",
  );
  for (
    const tool of [
      "publish_experience",
      "publish_trip",
      "publish_rsvp",
      "cancel_trip_booking",
    ]
  ) {
    assert(auth.includes(`${tool}:`), `${tool} missing event-type declaration`);
  }
});

Deno.test("#2019 tester: RSVP guest binding uses the physical two-hop foreign keys", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  const guest = auth.search(guestBinding);
  const rsvp = auth.search(rsvpBinding);
  const event = auth.search(eventBinding);
  assert(
    guest > 0 && rsvp > guest && event > rsvp,
    "guest resource binding does not follow event_rsvp_guests.rsvp_id -> event_rsvps.event_id -> events.id",
  );
  assert(
    !auth.includes(
      'rowBrand(client, "event_rsvp_guests", guestId, "event_id")',
    ),
    "guest binding queries the nonexistent event_rsvp_guests.event_id column",
  );
});

Deno.test("#2019 tester: partner identifiers bind through the deployed link table", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  assert(
    partnerBinding.test(auth),
    "partner_id is not bound through partner_brand_links.id",
  );
  assert(
    !auth.includes('rowBrand(client, "brand_partners", args.partner_id)'),
    "authorization still queries the nonexistent brand_partners table",
  );
});

Deno.test("#2019 tester: formatting-tolerant authorization anchors reject wrong or missing arguments", async () => {
  const auth = await read("_shared/agentToolAuthorization.ts");
  const mutations: Array<[RegExp, string, string]> = [
    [
      secureWrapperReauth,
      "args,\n          client,\n          userId,",
      "client,\n          args,\n          userId,",
    ],
    [directEventBinding, "args.event_id,", "args.brand_id,"],
    [guestBinding, '"rsvp_id",', '"event_id",'],
    [rsvpBinding, "guest.rsvp_id,", "guest.id,"],
    [eventBinding, "rsvp.event_id,", "rsvp.id,"],
    [partnerBinding, "args.partner_id,", "args.brand_id,"],
  ];
  for (const [anchor, exactArgument, wrongArgument] of mutations) {
    assert(
      anchor.test(auth),
      `clean authorization anchor did not match: ${anchor}`,
    );
    const mutated = auth.replace(exactArgument, wrongArgument);
    assert(mutated !== auth, `mutation target was absent: ${exactArgument}`);
    assert(
      !anchor.test(mutated),
      `authorization anchor accepted wrong/missing argument: ${wrongArgument}`,
    );
  }
});
