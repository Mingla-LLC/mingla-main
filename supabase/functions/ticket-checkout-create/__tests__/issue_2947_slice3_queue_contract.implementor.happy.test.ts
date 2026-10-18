/**
 * #2879 / #2947 slice 3 — implementor happy path (source + helper runtime).
 *
 * Pins the create wiring that makes an armed opted-in caller receive
 * kind:"queued" with holdSecondsRemaining null and no expires_at.
 * FAILS ON REVERT of the opt-in join early-return.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertNoExpiresAtOnWire,
  buildQueuedEnvelope,
  buildWaitlistOfferedEnvelope,
  parseQueueContract,
} from "../../_shared/ticketQueueV1.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const CREATE_SRC = await Deno.readTextFile(
  `${ROOT}supabase/functions/ticket-checkout-create/index.ts`,
);
const STATUS_SRC = await Deno.readTextFile(
  `${ROOT}supabase/functions/ticket-checkout-status/index.ts`,
);

Deno.test("#2947 slice3 implementor: create imports queue helpers + join path", () => {
  assertStringIncludes(CREATE_SRC, 'from "../_shared/ticketQueueV1.ts"');
  assertStringIncludes(CREATE_SRC, "parseQueueContract");
  assertStringIncludes(CREATE_SRC, "buildQueuedEnvelope");
  assertStringIncludes(CREATE_SRC, "buildWaitlistOfferedEnvelope");
  assertStringIncludes(CREATE_SRC, "issue_2947_queue_engaged");
  assertStringIncludes(CREATE_SRC, "issue_2947_queue_join");
  assertStringIncludes(CREATE_SRC, 'p_expires_at: queueEngaged');
  assertStringIncludes(CREATE_SRC, '"infinity"');
  assertStringIncludes(CREATE_SRC, "ticket_capacity_exceeded");
  assertStringIncludes(CREATE_SRC, "waitlist_entries");
});

Deno.test("#2947 slice3 implementor: status additive queue fields + hashed token", () => {
  assertStringIncludes(STATUS_SRC, "issue_2947_queue_state");
  assertStringIncludes(STATUS_SRC, "queueDeviceToken");
  assertStringIncludes(STATUS_SRC, "queuePosition");
  assertStringIncludes(STATUS_SRC, "holdSecondsRemaining");
  assertStringIncludes(STATUS_SRC, "sha256Hex(queueDeviceToken)");
  assertStringIncludes(STATUS_SRC, '.eq("checkout_session_id", checkoutSessionId)');
  // Response body must not carry expires_at / expiresAt keys.
  const returnBlock = STATUS_SRC.slice(
    STATUS_SRC.indexOf("return jsonResponse({\n      checkoutSessionId,\n      status: sessionStatus,\n      order: null,"),
  );
  const firstReturn = returnBlock.slice(0, 280);
  assert(!firstReturn.includes("expires_at"));
  assert(!firstReturn.includes("expiresAt"));
});

Deno.test("#2947 slice3 implementor: queued envelope contract", () => {
  const env = buildQueuedEnvelope({
    checkoutSessionId: "cs",
    queueEntryId: "qe",
    position: 4,
    aheadOfYou: 3,
    remainingAtJoin: 50,
    gettingOne: true,
    estimatedWaitSeconds: 2,
    buyerStatusToken: "bst",
  });
  assertEquals(env.kind, "queued");
  assertEquals(env.holdSecondsRemaining, null);
  assert(assertNoExpiresAtOnWire(env as unknown as Record<string, unknown>));
  const wl = buildWaitlistOfferedEnvelope({
    ticketTypeId: "t",
    waitlistEntryId: "w",
    positionInWaitlist: 9,
  });
  assertEquals(wl.kind, "waitlist_offered");
  const token =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assertEquals(
    parseQueueContract({ queueContract: "queue_v1", queueDeviceToken: token })
      .ok,
    true,
  );
});
