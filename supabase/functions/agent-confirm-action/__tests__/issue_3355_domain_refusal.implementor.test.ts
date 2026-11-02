// Issue #3355 P1 (D-9) — a deterministic publish/money refusal on a
// receipt-backed write is terminal and worded, never 202 "verifying".
//
// Drives the REAL create_experience executor against a client double whose
// receipt-backed dispatcher raises the shipped refusal code, takes the REAL
// failure through the confirm path's own re-typing, ambiguity decision and
// status map (executionOutcome.ts, used by the shipped handler), and checks a genuine
// transport failure on the same tool is still ambiguous (exactly-once
// recovery preserved).
//
// Run: deno test --no-check --allow-env --allow-net --allow-read \
//   supabase/functions/agent-confirm-action/__tests__/issue_3355_domain_refusal.implementor.test.ts

import {
  assert,
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isAmbiguousExecutionFailure,
  toolErrorHttpStatus,
} from "../executionOutcome.ts";
import { AGENT_TOOLS } from "../../_shared/agentTools.ts";
import { retypeAriRefusal, ToolError } from "../../_shared/agentToolHelpers.ts";
import { ARI_REFUSAL_COPY } from "../../_shared/ariRefusalCopy.ts";
import { mapLegacyAriErrorCode } from "../../_shared/agentReliability.ts";

// The shipped recovery set, read from the handler (importing it would start
// the server): create_experience must be receipt-backed for this to mean
// anything.
const confirmSource = Deno.readTextFileSync(
  new URL("../index.ts", import.meta.url),
);
const receiptBlock = confirmSource.slice(
  confirmSource.indexOf("const RECEIPT_BACKED_TOOL_NAMES = new Set(["),
  confirmSource.indexOf(
    "]);",
    confirmSource.indexOf("const RECEIPT_BACKED_TOOL_NAMES"),
  ),
);
const RECEIPT_BACKED = receiptBlock.includes('"create_experience",');

const OPERATION = "66666666-6666-4666-8666-666666666666";
const BRAND = "44444444-4444-4444-8444-444444444444";

function tool() {
  const found = AGENT_TOOLS.find((candidate) =>
    candidate.name === "create_experience"
  );
  if (!found) throw new Error("missing tool fixture: create_experience");
  return found;
}

const USER = "55555555-5555-4555-8555-555555555555";

/** The caller is the brand owner; only the receipt-backed dispatcher fails. */
function dispatcherRaising(message: string) {
  return {
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "biz_brand_effective_rank_for_caller"
          ? { data: 100, error: null }
          : fn === "biz_role_rank"
          ? { data: 10, error: null }
          : { data: null, error: { message } },
      ),
  } as never;
}

async function failureOf(message: string): Promise<unknown> {
  try {
    await tool().executor(
      { brand_id: BRAND, title: "Sunset walk", narrative: "Golden hour" },
      dispatcherRaising(message),
      USER,
      { operationId: OPERATION },
    );
  } catch (err) {
    return retypeAriRefusal(err);
  }
  throw new Error("executor did not fail");
}

Deno.test("#3355 D-9 a past-date refusal on a receipt-backed write is terminal, 409 and worded", async () => {
  const err = await failureOf("offering_date_past");
  assertInstanceOf(err, ToolError);
  assertEquals(err.code, "DOMAIN_REFUSED");
  assertEquals(err.message, ARI_REFUSAL_COPY.offering_date_past.message);
  assert(RECEIPT_BACKED, "create_experience must be receipt-backed");
  assertEquals(isAmbiguousExecutionFailure(RECEIPT_BACKED, err), false);
  assertEquals(toolErrorHttpStatus(err.code), 409);
  assertEquals(mapLegacyAriErrorCode(err.code), "DOMAIN_ACTION_REFUSED");
  // The thread row the Host renders: "That didn't go through. <sentence>".
  assert(/^[A-Z][A-Z0-9_]*:\s+\S/.test(`${err.code}: ${err.message}`));
});

Deno.test("#3355 D-9 a transport failure on the same write stays ambiguous (202 + receipt recovery)", async () => {
  const err = await failureOf("fetch failed: connection reset");
  assertInstanceOf(err, ToolError);
  assertEquals(err.code, "WRITE_FAILED");
  assertEquals(isAmbiguousExecutionFailure(RECEIPT_BACKED, err), true);
});
