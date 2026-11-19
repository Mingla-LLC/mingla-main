/**
 * rsvpGuestParse — issue #4508: reads the submit response's `guests[]`. Its own
 * module so the web service loads it on demand and the Explorer app imports it
 * by path, without dragging the rest of the guest model into a shared chunk.
 */
import type { RsvpSubmittedGuest } from "./rsvpGuestTypes.ts";

/** Parse the submit response's `guests[]` defensively. */
export const parseSubmittedGuests = (value: unknown): RsvpSubmittedGuest[] => {
  if (!Array.isArray(value)) return [];
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return value
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v))
    .map((v) => ({
      guestId: str(v.guestId),
      phoneLast4: str(v.phoneLast4),
      onMingla: v.onMingla === true,
      displayName: str(v.displayName),
      claimed: v.claimed === true,
      inviteUrl: str(v.inviteUrl),
      inviteCode: str(v.inviteCode),
      // Older servers send no willText; their guests were all texted.
      willText: v.willText !== false,
    }));
};
