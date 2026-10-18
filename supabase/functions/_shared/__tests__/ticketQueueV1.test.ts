/**
 * #2879 / #2947 slice 3 — unit tests for waiting-room contract helpers.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertNoExpiresAtOnWire,
  buildQueuedEnvelope,
  buildWaitlistOfferedEnvelope,
  computeGettingOne,
  estimatedWaitSeconds,
  parseQueueContract,
  QUEUE_CONTRACT_V1,
} from "../ticketQueueV1.ts";

const TOKEN =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

Deno.test("parseQueueContract: absent ⇒ quiet path", () => {
  assertEquals(parseQueueContract({}), { ok: true, optedIn: false });
  assertEquals(parseQueueContract({ queueContract: "" }), {
    ok: true,
    optedIn: false,
  });
});

Deno.test("parseQueueContract: invalid contract / missing token", () => {
  assertEquals(parseQueueContract({ queueContract: "queue_v0" }), {
    ok: false,
    error: "queue_contract_invalid",
  });
  assertEquals(
    parseQueueContract({ queueContract: QUEUE_CONTRACT_V1 }),
    { ok: false, error: "queue_device_token_required" },
  );
  assertEquals(
    parseQueueContract({
      queueContract: QUEUE_CONTRACT_V1,
      queueDeviceToken: "short",
    }),
    { ok: false, error: "queue_device_token_invalid" },
  );
});

Deno.test("parseQueueContract: valid opt-in returns raw token", () => {
  const parsed = parseQueueContract({
    queueContract: QUEUE_CONTRACT_V1,
    queueDeviceToken: TOKEN.toUpperCase(),
  });
  assert(parsed.ok && parsed.optedIn);
  assertEquals(parsed.rawDeviceToken, TOKEN);
});

Deno.test("gettingOne / wait / envelopes / no expires_at", () => {
  assertEquals(computeGettingOne(0, 2, 5), true);
  assertEquals(computeGettingOne(4, 2, 5), false);
  assertEquals(estimatedWaitSeconds(19, 20), 1);
  const queued = buildQueuedEnvelope({
    checkoutSessionId: "cs",
    queueEntryId: "qe",
    position: 2,
    aheadOfYou: 1,
    remainingAtJoin: 10,
    gettingOne: true,
    estimatedWaitSeconds: 1,
    buyerStatusToken: "bst",
  });
  assertEquals(queued.kind, "queued");
  assertEquals(queued.holdSecondsRemaining, null);
  assert(assertNoExpiresAtOnWire(queued as unknown as Record<string, unknown>));
  const wl = buildWaitlistOfferedEnvelope({
    ticketTypeId: "t",
    waitlistEntryId: "w",
    positionInWaitlist: 3,
  });
  assertEquals(wl.kind, "waitlist_offered");
  assert(assertNoExpiresAtOnWire(wl as unknown as Record<string, unknown>));
});
