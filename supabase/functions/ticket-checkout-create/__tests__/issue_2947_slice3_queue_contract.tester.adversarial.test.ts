/**
 * #2879 / #2947 slice 3 — adversarial / compatibility rule.
 *
 * 1. Absent queueContract ⇒ create must never emit queued / waitlist_offered
 *    (quiet path / legacy clients).
 * 2. A shipped native 1.1.6 binary must never send queueContract (SPEC Q3).
 * 3. No response helper may put expires_at on the wire.
 *
 * Distinct from the implementor suite: attacks the compatibility rule from
 * the OTHER end (what must NOT happen), not the happy join path.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertNoExpiresAtOnWire,
  buildQueuedEnvelope,
  parseQueueContract,
} from "../../_shared/ticketQueueV1.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;

const CREATE_SRC = await Deno.readTextFile(
  `${ROOT}supabase/functions/ticket-checkout-create/index.ts`,
);
const NATIVE_FLOW = await Deno.readTextFile(
  `${ROOT}app-mobile/src/payments/nativeCheckoutFlow.ts`,
);
const BIZ_SERVICE = await Deno.readTextFile(
  `${ROOT}mingla-business/src/services/ticketCheckoutService.ts`,
);
const BUYER = await Deno.readTextFile(
  `${ROOT}mingla-business/app/checkout/[eventId]/buyer.tsx`,
);
const PAYMENT = await Deno.readTextFile(
  `${ROOT}mingla-business/app/checkout/[eventId]/payment.tsx`,
);

Deno.test(
  "#2947 slice3 adversarial: absent contract never opts in (parse + gate)",
  () => {
    assertEquals(parseQueueContract({}), { ok: true, optedIn: false });
    // Create must short-circuit kinds behind queueEngaged / queueOptIn.
    assertStringIncludes(CREATE_SRC, "queueOptIn");
    assertStringIncludes(CREATE_SRC, "queueEngaged");
    // Join only runs under the engaged + opted-in gate (wide window).
    const joinIdx = CREATE_SRC.indexOf("issue_2947_queue_join");
    assert(joinIdx > 0);
    const beforeJoin = CREATE_SRC.slice(Math.max(0, joinIdx - 2500), joinIdx);
    assertStringIncludes(beforeJoin, "queueEngaged");
    assertStringIncludes(beforeJoin, "queueDeviceTokenHash");
  },
);

Deno.test(
  "#2947 slice3 adversarial: native never sends queueContract (1.1.6 safety)",
  () => {
    assert(
      !NATIVE_FLOW.includes("queueContract"),
      "nativeCheckoutFlow must not opt into queue_v1 until a store release ships handlers",
    );
    assert(
      !NATIVE_FLOW.includes("queue_v1"),
      "nativeCheckoutFlow must not mention queue_v1",
    );
    // Buyer web opts in only under Platform.OS === "web" / surface web.
    assertStringIncludes(BUYER, "queueContractOptInFields");
    assertStringIncludes(BUYER, 'Platform.OS === "web"');
    assertStringIncludes(PAYMENT, "queueContractOptInFields");
    // Service only forwards when explicitly provided — never invents opt-in.
    assertStringIncludes(BIZ_SERVICE, 'queueContract === "queue_v1"');
  },
);

const HELPER_SRC = await Deno.readTextFile(
  `${ROOT}supabase/functions/_shared/ticketQueueV1.ts`,
);

Deno.test(
  "#2947 slice3 adversarial: no expires_at on queued envelope",
  () => {
    const env = buildQueuedEnvelope({
      checkoutSessionId: "cs",
      queueEntryId: "qe",
      position: 1,
      aheadOfYou: 0,
      remainingAtJoin: 1,
      gettingOne: true,
      estimatedWaitSeconds: 0,
      buyerStatusToken: "bst",
    });
    assert(assertNoExpiresAtOnWire(env as unknown as Record<string, unknown>));
    assertStringIncludes(HELPER_SRC, "never put raw expires_at");
    const start = HELPER_SRC.indexOf("export function buildQueuedEnvelope");
    const end = HELPER_SRC.indexOf(
      "export function buildWaitlistOfferedEnvelope",
    );
    const builder = HELPER_SRC.slice(start, end);
    assert(
      !builder.includes("expires_at") && !builder.includes("expiresAt"),
      "buildQueuedEnvelope must not put expires_at on the wire",
    );
  },
);
