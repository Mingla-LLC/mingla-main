// Issue #4548 — the guest pack pointer line for confirmation emails.
//
// I-4548-GUEST-PACK-APP-ONLY: a guest pack is read only in the Mingla app.
// Emails may say that a pack exists; they never carry its note, labels, links
// or link count. This module asks the database one yes/no question through
// the service-only `event_guest_pack_exists` function and nothing else: no
// edge function reads the pack itself.

/** The one line an email adds above its button when the event has a pack. */
export const GUEST_PACK_POINTER_LINE =
  "Your host left a guest pack for you. Open it in Mingla.";

/** The narrow client surface this module needs: one RPC call. */
export interface GuestPackRpcClient {
  rpc(
    fn: "event_guest_pack_exists",
    args: { p_event_id: string },
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/**
 * Whether the event has a guest pack. A failed check is logged and treated as
 * "no pack": the pointer line is a hint, and a confirmation email must never
 * be held back by it.
 */
export async function guestPackExists(
  client: GuestPackRpcClient,
  eventId: string | null | undefined,
  logPrefix: string,
): Promise<boolean> {
  if (typeof eventId !== "string" || eventId.length === 0) return false;
  try {
    const { data, error } = await client.rpc("event_guest_pack_exists", {
      p_event_id: eventId,
    });
    if (error) {
      console.warn(
        `${logPrefix} guest_pack_exists_failed event=${eventId}: ${
          error.message ?? "unknown"
        }`,
      );
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn(
      `${logPrefix} guest_pack_exists_threw event=${eventId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
