/**
 * #4548 — a guest's read of the Guest pack for an event they hold.
 *
 * One server call, `pg_my_event_guest_pack`: it answers only for a holder
 * (an app purchaser, a found web purchase, a live shared holder, an approved
 * RSVP) and returns null otherwise, exactly like "no pack". Services throw:
 * the caller decides to hide the card and log, never to show an error.
 */
import { supabase } from "./supabase";
import { parseGuestPack, type GuestPackData } from "../utils/guestPackDisplay";

export async function fetchMyEventGuestPack(eventId: string): Promise<GuestPackData | null> {
  const { data, error } = await supabase.rpc("pg_my_event_guest_pack", {
    p_event_id: eventId,
  });
  if (error) throw new Error(`pg_my_event_guest_pack: ${error.message}`);
  return parseGuestPack(data);
}
