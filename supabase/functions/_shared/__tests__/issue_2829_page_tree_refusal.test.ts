/*
 * #2829 W2 — Studio's owner-fixable refusals reach the Business app as a
 * 409 VALIDATION_FAILED with a reason, never as a 503 "try again".
 */
import { sitesOwnerFixableRefusal } from "../sitesContracts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#2829 PATH_COLLISION and PAGE_LIMIT_EXCEEDED pass through as 409 with a reason", async () => {
  for (const code of ["PATH_COLLISION", "PAGE_LIMIT_EXCEEDED"]) {
    const response = sitesOwnerFixableRefusal(code, "op-1");
    assert(response !== null, `${code} was not passed through`);
    assert(response.status === 409, `${code} answered ${response.status}`);
    const body = await response.json();
    assert(body.ok === false && body.error.code === "VALIDATION_FAILED", JSON.stringify(body));
    assert(body.error.reason_code === code && body.error.retryable === false, JSON.stringify(body));
    assert(typeof body.error.message === "string" && !/temporarily/i.test(body.error.message), body.error.message);
  }
});

Deno.test("#2829 nothing else is passed through (no free text, no other codes)", () => {
  for (const code of ["VALIDATION_FAILED", "SERVICE_TEMPORARILY_UNAVAILABLE", "toString", "__proto__", "", null, 42]) {
    assert(sitesOwnerFixableRefusal(code) === null, `passed through ${String(code)}`);
  }
});

Deno.test("#2829 brand-site-control checks it before mapping to unavailable", async () => {
  const source = await Deno.readTextFile(new URL("../../brand-site-control/index.ts", import.meta.url));
  const fixable = source.indexOf("sitesOwnerFixableRefusal(reportedCode, args.operationId)");
  const unavailable = source.indexOf(': "SERVICE_TEMPORARILY_UNAVAILABLE";', fixable);
  assert(fixable > 0 && unavailable > fixable, "owner-fixable check must come first");
});
