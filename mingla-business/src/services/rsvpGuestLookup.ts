/**
 * rsvpGuestLookup — issue #4508: the live match under the RSVP guest number
 * field. Loaded on demand by the public event page (only a host that lets guests
 * bring guests ever calls it), so it stays out of the boot payload.
 */
import { supabase } from "./supabase";
import { readRsvpErrorCode, type RsvpInvokeError } from "./rsvpErrorCodes";

/**
 * issue #4508 1.2a / 1.8 — the live match under the RSVP guest number field
 * (public-submit-rsvp op `guest_lookup`). A signed-out visitor learns only
 * whether the number is on Mingla. Throws Error(code) on failure.
 */
export const lookupPublicRsvpGuest = async (
  eventId: string,
  phone: string,
): Promise<import("@mingla/offering-rendering").RsvpGuestLookupResult> => {
  const { data, error } = await supabase.functions.invoke(
    "public-submit-rsvp",
    { body: { op: "guest_lookup", eventId, phone } },
  );
  if (error !== null) {
    throw new Error(await readRsvpErrorCode(error as RsvpInvokeError));
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const user = row.user as Record<string, unknown> | null | undefined;
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  return {
    valid: row.valid === true,
    isYou: row.isYou === true,
    onMingla: row.onMingla === true,
    alreadyOnList: row.alreadyOnList === true,
    released: row.released === true,
    user:
      user !== null && user !== undefined && typeof user.id === "string"
        ? {
            id: user.id,
            displayName: text(user.displayName),
            username: text(user.username),
            avatarUrl: text(user.avatarUrl),
          }
        : null,
  };
};
