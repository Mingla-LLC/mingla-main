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
  // [TEST-MOD-APPROVED #3429] Two changes, and only two.
  //
  // (1) ANCHOR TO THE REFLOWED SHAPE. This searched for the one-line literal
  //     `await authorizeAgentTool(tool, gemini.toolCall.args`. `deno fmt`
  //     wrapped that call across six lines, so indexOf returned -1 — and the
  //     assertion died on its FIRST conjunct while printing the ORDERING
  //     message. A reformat and a security inversion were indistinguishable in
  //     the output, which trains a reader to assume the literal. The
  //     strict-grep guard was moved to a reflow-tolerant pattern in REWORK-1;
  //     this now matches it.
  //
  // (2) SPLIT THE ASSERTION, so each failure mode says what happened.
  //
  // The ordering check is an INTERLEAVE rather than "first persist at or after
  // the authorize". The old forward-only indexOf could not fail: with a persist
  // moved above its authorize, the search simply found the next one below and
  // passed. Pairing each authorize with the persist that follows it catches
  // that, which is the mutation this test exists to survive.
  //
  // KNOWN AND DELIBERATELY OUT OF SCOPE: `terminalizeProposalForTaskReplacement`
  // updates `agent_pending_actions` at line ~1694, BEFORE the authorize at
  // ~1718. It cancels a PREVIOUSLY AUTHORIZED proposal for task replacement,
  // scoped `.eq("user_id", userId)`, and does not persist the new one, so the
  // invariant holds. The old forward-only search could never have seen it.
  // Recorded on #3429 rather than silently absorbed here.
  const authPattern = /await\s+authorizeAgentTool\(\s*tool\s*,/gs;
  const authIndices = [...chat.matchAll(authPattern)].map((m) => m.index ?? -1);
  assert(
    authIndices.length > 0,
    "agent-chat authorize site NOT FOUND — the call's shape changed (deno fmt?). " +
      "This says nothing about ordering; re-anchor the pattern before reading it as one.",
  );
  const persistIndices = [...chat.matchAll(/return await commitPendingTurn\(\{/gs)]
    .map((m) => m.index ?? -1);
  assert(
    persistIndices.length === authIndices.length,
    `agent-chat has ${authIndices.length} authorize site(s) but ` +
      `${persistIndices.length} proposal-persist site(s) — every persisted proposal ` +
      "needs its own authorization immediately before it.",
  );
  for (let i = 0; i < authIndices.length; i++) {
    assert(
      authIndices[i] < persistIndices[i] &&
        (i + 1 === authIndices.length || persistIndices[i] < authIndices[i + 1]),
      "PROPOSAL PERSISTED BEFORE AUTHORIZATION: persist site " + (i + 1) +
        " is not preceded by its own authorizeAgentTool call. Runtime proof of the " +
        "correct order (#3429, real stack): biz_role_rank + " +
        "biz_brand_effective_rank_for_caller, then POST /rest/v1/agent_pending_actions.",
    );
  }
  const finalArgs = confirm.indexOf("const finalArgs");
  const confirmAuthMatch = /await\s+authorizeAgentTool\(\s*tool\s*,\s*finalArgs/s
    .exec(confirm);
  assert(
    finalArgs > 0,
    "agent-confirm-action: `const finalArgs` NOT FOUND — shape changed, not an ordering claim.",
  );
  assert(
    confirmAuthMatch !== null,
    "agent-confirm-action authorize site NOT FOUND — shape changed, not an ordering claim.",
  );
  const confirmAuth = (confirmAuthMatch as RegExpExecArray).index;
  const executing = confirm.indexOf('status: "executing"', confirmAuth);
  assert(
    confirmAuth > finalArgs && executing > confirmAuth,
    "FINAL ARGS NOT AUTHORIZED BEFORE EXECUTING: the confirm path marks the action " +
      "executing without authorizing the arguments it is about to run.",
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
