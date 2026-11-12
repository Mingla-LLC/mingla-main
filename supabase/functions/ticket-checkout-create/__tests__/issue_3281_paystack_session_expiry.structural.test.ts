/**
 * issue #3281 (bundle 6c) — the Paystack redirect answer carries the session's
 * own expiry, and the status edge tells a failed admission check apart from a
 * refused sale.
 *
 * Both native apps hold the Paystack page so a buyer who closed it can reopen
 * it. They time that hold themselves, but a retry can reuse an older session
 * row whose `expires_at` is earlier than the client's clock suggests, so the
 * create answer now names the session's real expiry (best effort: omitted when
 * the read fails, and clients keep their own shorter bound).
 *
 * The preflight used to answer the same 409 for "this sale is not admitted"
 * and "the check itself failed", so a client could not tell whether to drop a
 * still-payable page. A failed check is now 503 `checkout_check_failed`.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ticketCheckoutPreflight } from "../../_shared/checkoutSaleTruth.ts";

const create = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const status = await Deno.readTextFile(
  new URL("../../ticket-checkout-status/index.ts", import.meta.url),
);

Deno.test("#3281 6c the Paystack redirect answer carries the session's expiry", () => {
  const answer = create.indexOf('kind: "requires_paystack_redirect"');
  assert(answer > 0, "missing the Paystack redirect answer");
  const commit = create.lastIndexOf('if (psCommit !== "ready")', answer);
  assert(commit > 0 && commit < answer, "the expiry is read after the commit");
  const between = create.slice(commit, answer);
  assertStringIncludes(between, '.from("ticket_checkout_sessions")');
  assertStringIncludes(between, '.select("expires_at")');
  assertStringIncludes(between, '.eq("id", checkoutSessionId)');
  // Only a real time is sent: a failed read or a queued hold's `infinity`
  // (Date.parse → NaN) sends neither field.
  assertStringIncludes(between, "Number.isFinite(psExpiresMs)");
  assertStringIncludes(
    between,
    "expiresAt: new Date(psExpiresMs).toISOString()",
  );
  // Seconds left are measured on the server clock and never negative.
  assertStringIncludes(
    between,
    "Math.floor((psExpiresMs - Date.now()) / 1000)",
  );
  assertStringIncludes(between, "Math.max(");
  const body = create.slice(answer, create.indexOf("});", answer));
  assertStringIncludes(body, "...psExpiry,");
});

Deno.test("#3281 6c a failed admission check is 503, never the refused-sale 409", async () => {
  const failed = await ticketCheckoutPreflight(
    { rpc: () => Promise.resolve({ data: null, error: new Error("down") }) },
    { checkoutSessionId: "s", buyerStatusTokenHash: "h" },
  );
  assertEquals(failed, "error");

  const preflight = status.slice(
    status.indexOf("if (body.preflight === true)"),
    status.indexOf('status: "present_allowed"'),
  );
  const errorArm = preflight.indexOf('if (outcome === "error")');
  const refusedArm = preflight.indexOf('if (outcome !== "present_allowed")');
  assert(errorArm > 0 && errorArm < refusedArm, "the error arm runs first");
  assertStringIncludes(
    preflight.slice(errorArm, refusedArm),
    'jsonResponse({ error: "checkout_check_failed" }, 503)',
  );
});
