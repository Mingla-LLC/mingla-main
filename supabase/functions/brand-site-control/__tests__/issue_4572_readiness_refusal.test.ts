// #4572 item 15 — a database refusal is named: the publishing pause is a
// retryable 503 with reason_code PUBLISHING_PAUSED and the owner's sentence;
// a malformed request is VALIDATION_FAILED; INVALID_STATE only for an unnamed
// refusal. FAILS-ON-REVERT: index.ts mapped everything but forbidden and
// idempotency to INVALID_STATE.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PUBLISHING_PAUSED_MESSAGE, sitesAuthorizeRefusal } from "../../_shared/sitesContracts.ts";

async function body(response: Response) {
  return { status: response.status, json: await response.json() as { error: Record<string, unknown> } };
}

Deno.test("#4572 sites_readiness_blocked -> 503 PUBLISHING_PAUSED, retryable, the owner's sentence", async () => {
  const { status, json } = await body(sitesAuthorizeRefusal("sites_readiness_blocked", "op-1"));
  assertEquals(status, 503);
  assertEquals(json.error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");
  assertEquals(json.error.reason_code, "PUBLISHING_PAUSED");
  assertEquals(json.error.retryable, true);
  assertEquals(json.error.message, PUBLISHING_PAUSED_MESSAGE);
});

Deno.test("#4572 the other refusals keep their own codes", async () => {
  assertEquals((await body(sitesAuthorizeRefusal("sites_validation_failed"))).json.error.code, "VALIDATION_FAILED");
  assertEquals((await body(sitesAuthorizeRefusal("sites_forbidden"))).status, 403);
  assertEquals((await body(sitesAuthorizeRefusal("sites_idempotency_conflict"))).json.error.code, "IDEMPOTENCY_CONFLICT");
  assertEquals((await body(sitesAuthorizeRefusal("something else"))).json.error.code, "INVALID_STATE");
});

Deno.test("#4572 the authorize branch uses the named mapping", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(source.includes("return sitesAuthorizeRefusal(error.message, operationId);"));
});
