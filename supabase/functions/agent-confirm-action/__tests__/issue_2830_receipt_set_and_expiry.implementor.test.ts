// #2830 P0 — Ari confirm hygiene for Website setup.
//
// 1. I-ARI-RECEIPT-SET-COMPLETE: every Ari tool whose SQL begins the shared
//    #1972 operation receipt under a literal tool name is in the confirm
//    function's receipt-backed set. The list is GENERATED from the migrations,
//    not hand-kept, so a new receipt-backed writer cannot be forgotten.
//    update_brand_context was missing: an ambiguous `executing` retry of a
//    confirmed brand-details save answered WRONG_STATE instead of replaying.
// 2. An expired Ari approval answers 409 PROPOSAL_EXPIRED with owner copy,
//    never the 200 `expired_regenerate` the Host treated as success. Hub
//    proposals keep `expired_regenerate`.
//
// Run:
//   deno test --no-check --allow-env --allow-net --allow-read \
//     supabase/functions/agent-confirm-action/__tests__/issue_2830_receipt_set_and_expiry.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
// index.ts starts Deno.serve at import, so the shipped set is read from its
// source (the same block the #2063 strict-grep gate reads) and the expiry
// helpers come from their own module.
import {
  ariProposalExpiredResponse,
  expiredProposalAnswer,
} from "../proposalExpiry.ts";
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../../_shared/agentReliability.ts";
import { runWithAriRequest } from "../../_shared/agentReliabilityHttp.ts";

const migrationsDir = new URL("../../../migrations/", import.meta.url);
const confirmSource = Deno.readTextFileSync(
  new URL("../index.ts", import.meta.url),
);

function shippedReceiptSet(): Set<string> {
  const start = confirmSource.indexOf(
    "const RECEIPT_BACKED_TOOL_NAMES = new Set([",
  );
  assert(start >= 0, "receipt-backed set declaration not found");
  const block = confirmSource.slice(start, confirmSource.indexOf("]);", start));
  const names = new Set<string>();
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*"([a-z_]+)",/);
    if (match) names.add(match[1]);
  }
  assert(names.size > 10, "receipt-backed set parsed implausibly small");
  return names;
}
const ARI_RECEIPT_BACKED_TOOL_NAMES = shippedReceiptSet();

function literalReceiptToolNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern =
    /agent_operation_receipt_begin\(\s*[a-z_]+\s*,\s*'([a-z_]+)'/g;
  for (const entry of Deno.readDirSync(migrationsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = Deno.readTextFileSync(new URL(entry.name, migrationsDir));
    for (const match of sql.matchAll(pattern)) {
      const files = found.get(match[1]) ?? [];
      files.push(entry.name);
      found.set(match[1], files);
    }
  }
  return found;
}

Deno.test("#2830 every literal receipt-backed SQL writer is in the confirm recovery set", () => {
  const writers = literalReceiptToolNames();
  // Non-vacuous: the generator must see the brand-context writer.
  assert(
    writers.has("update_brand_context"),
    "generator found no literal receipt writer for update_brand_context",
  );
  for (const [tool, files] of writers) {
    assert(
      ARI_RECEIPT_BACKED_TOOL_NAMES.has(tool),
      `${tool} begins an operation receipt (${
        files.join(", ")
      }) but agent-confirm-action cannot replay it`,
    );
  }
});

Deno.test("#2830 update_brand_context ambiguous retries replay the receipt", () => {
  assert(ARI_RECEIPT_BACKED_TOOL_NAMES.has("update_brand_context"));
});

Deno.test("#2830 an expired Ari approval answers PROPOSAL_EXPIRED; Hub keeps re-snap", () => {
  assertEquals(expiredProposalAnswer("ari"), "ari_proposal_expired");
  assertEquals(expiredProposalAnswer(null), "ari_proposal_expired");
  assertEquals(expiredProposalAnswer("hub_experience"), "hub_regenerate");
  assertEquals(expiredProposalAnswer("hub_trip_day"), "hub_regenerate");

  // The expiry branch must route through the classifier before it can emit
  // the Hub-only expired_regenerate body.
  // #3355 P1 (D-14): expiry is now decided by the database clock
  // (pendingClaim.ts); the branch is anchored on that decision.
  const branchStart = confirmSource.indexOf("if (expiredByDbClock) {");
  const hubBody = confirmSource.indexOf(
    'kind: "expired_regenerate",',
    branchStart,
  );
  const classifier = confirmSource.indexOf(
    "expiredProposalAnswer(pending.source)",
    branchStart,
  );
  assert(branchStart > 0 && hubBody > branchStart);
  assert(
    classifier > branchStart && classifier < hubBody,
    "expired Ari proposals still fall through to the Hub expired_regenerate 200",
  );
  const between = confirmSource.slice(classifier, hubBody);
  assert(between.includes("return ariProposalExpiredResponse()"));
});

Deno.test("#2830 PROPOSAL_EXPIRED is a terminal 409 with owner copy", async () => {
  assertEquals(mapLegacyAriErrorCode("PROPOSAL_EXPIRED"), "PROPOSAL_EXPIRED");
  const definition = ARI_ERROR_REGISTRY.PROPOSAL_EXPIRED;
  assertEquals(definition.httpStatus, 409);
  assertEquals(definition.retryability, "never");
  assertEquals(definition.safeToRetry, false);

  const response = await runWithAriRequest(
    {},
    () => ariProposalExpiredResponse(),
  );
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.kind, "error");
  assertEquals(body.code, "PROPOSAL_EXPIRED");
  assertEquals(body.operation_state, "expired");
  assertEquals(body.safe_to_retry, false);
  assertEquals(
    body.user_message,
    "That approval timed out, so nothing was saved. Ask me again and I'll redo it.",
  );
  // Owner copy only: no engine nouns, tool names or codes.
  assert(!/re-snap|tool|_|[A-Z]{4,}/.test(body.user_message));
});
