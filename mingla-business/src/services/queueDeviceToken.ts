/**
 * #2879 / #2947 slice 3 — anonymous queue identity for buyer web.
 *
 * Mints a 256-bit hex token once per (device, ticket type) and stores it in
 * localStorage. The raw token never leaves the device except on the wire to
 * ticket-checkout-create / ticket-checkout-status; the server stores only
 * sha256hex(token).
 *
 * WEB ONLY. Native must not opt into queueContract:"queue_v1" until a store
 * release ships handlers for kind:"queued" / kind:"waitlist_offered" (SPEC Q3).
 */

const STORAGE_PREFIX = "mingla.queueDeviceToken.v1:";

const HEX_64 = /^[0-9a-f]{64}$/;

export function mintQueueDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function storageKey(ticketTypeId: string): string {
  return `${STORAGE_PREFIX}${ticketTypeId}`;
}

/**
 * Returns a stable device token for this ticket type on this browser, or null
 * when localStorage is unavailable (SSR / native / private mode failures).
 */
export function getOrCreateQueueDeviceToken(
  ticketTypeId: string,
  storage?: Storage | null,
): string | null {
  if (!ticketTypeId || typeof ticketTypeId !== "string") return null;
  const store = storage ??
    (typeof globalThis !== "undefined"
      ? (globalThis as unknown as { localStorage?: Storage }).localStorage
      : undefined);
  if (!store) return null;
  try {
    const existing = store.getItem(storageKey(ticketTypeId));
    if (typeof existing === "string" && HEX_64.test(existing.toLowerCase())) {
      return existing.toLowerCase();
    }
    const minted = mintQueueDeviceToken();
    store.setItem(storageKey(ticketTypeId), minted);
    return minted;
  } catch {
    return null;
  }
}

export const QUEUE_CONTRACT_V1 = "queue_v1" as const;

/**
 * Build the opt-in fields for ticket-checkout-create when THIS surface may
 * receive queued / waitlist outcomes. Returns {} when the token cannot be
 * minted so the request stays byte-identical to the quiet path.
 */
export function queueContractOptInFields(
  ticketTypeId: string | null | undefined,
  opts?: { enabled?: boolean; storage?: Storage | null },
): { queueContract: typeof QUEUE_CONTRACT_V1; queueDeviceToken: string } | Record<
  string,
  never
> {
  if (opts?.enabled === false) return {};
  if (!ticketTypeId) return {};
  const token = getOrCreateQueueDeviceToken(ticketTypeId, opts?.storage);
  if (!token) return {};
  return { queueContract: QUEUE_CONTRACT_V1, queueDeviceToken: token };
}
