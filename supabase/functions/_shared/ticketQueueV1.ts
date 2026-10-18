// #2879 / #2947 slice 3 — opt-in waiting-room contract helpers.
//
// Callers that send queueContract:"queue_v1" may receive kind:"queued" or
// kind:"waitlist_offered". Absent the contract, ticket-checkout-create must
// never emit those kinds (quiet path / legacy clients).

export const QUEUE_CONTRACT_V1 = "queue_v1" as const;

/** 256-bit device token as lowercase hex (64 chars) — matches issue_2947_queue_join. */
export const QUEUE_DEVICE_TOKEN_HEX = /^[0-9a-f]{64}$/;

export type QueueContractParse =
  | { ok: true; optedIn: false }
  | { ok: true; optedIn: true; rawDeviceToken: string }
  | {
    ok: false;
    error:
      | "queue_contract_invalid"
      | "queue_device_token_required"
      | "queue_device_token_invalid";
  };

/**
 * Parse the opt-in contract. Returns the RAW 256-bit hex token; the edge
 * handler must store only sha256hex(token) (same shape as buyer_status_token).
 */
export function parseQueueContract(
  body: Record<string, unknown>,
): QueueContractParse {
  const raw = body.queueContract;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, optedIn: false };
  }
  if (raw !== QUEUE_CONTRACT_V1) {
    return { ok: false, error: "queue_contract_invalid" };
  }
  const token = typeof body.queueDeviceToken === "string"
    ? body.queueDeviceToken.trim().toLowerCase()
    : "";
  if (!token) return { ok: false, error: "queue_device_token_required" };
  if (!QUEUE_DEVICE_TOKEN_HEX.test(token)) {
    return { ok: false, error: "queue_device_token_invalid" };
  }
  return { ok: true, optedIn: true, rawDeviceToken: token };
}

/** Estimate wait from position and admission rate (placeholder Gate 0 rates OK). */
export function estimatedWaitSeconds(
  aheadOfYou: number,
  admissionRatePerSec: number,
): number {
  const rate = Math.max(1, admissionRatePerSec | 0);
  return Math.max(0, Math.ceil((aheadOfYou + 1) / rate));
}

export function computeGettingOne(
  aheadOfYou: number,
  cartQuantity: number,
  remainingAtJoin: number,
): boolean {
  return aheadOfYou + Math.max(1, cartQuantity) <= Math.max(0, remainingAtJoin);
}

export function buildQueuedEnvelope(args: {
  checkoutSessionId: string;
  queueEntryId: string;
  position: number;
  aheadOfYou: number;
  remainingAtJoin: number;
  gettingOne: boolean;
  estimatedWaitSeconds: number;
  buyerStatusToken: string;
}) {
  return {
    kind: "queued" as const,
    checkoutSessionId: args.checkoutSessionId,
    queueEntryId: args.queueEntryId,
    position: args.position,
    aheadOfYou: args.aheadOfYou,
    remainingAtJoin: args.remainingAtJoin,
    gettingOne: args.gettingOne,
    holdSecondsRemaining: null,
    estimatedWaitSeconds: args.estimatedWaitSeconds,
    buyerStatusToken: args.buyerStatusToken,
  };
}

export function buildWaitlistOfferedEnvelope(args: {
  ticketTypeId: string;
  waitlistEntryId: string;
  positionInWaitlist: number;
}) {
  return {
    kind: "waitlist_offered" as const,
    ticketTypeId: args.ticketTypeId,
    waitlistEntryId: args.waitlistEntryId,
    positionInWaitlist: args.positionInWaitlist,
  };
}

/** Spec: never put raw expires_at on the wire. */
export function assertNoExpiresAtOnWire(
  payload: Record<string, unknown>,
): boolean {
  return !Object.prototype.hasOwnProperty.call(payload, "expires_at") &&
    !Object.prototype.hasOwnProperty.call(payload, "expiresAt");
}
