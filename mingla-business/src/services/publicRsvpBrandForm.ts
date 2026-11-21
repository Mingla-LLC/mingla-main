/**
 * #4541 — the public RSVP page's form read.
 *
 * Its own leaf module on purpose: only the public event page imports it, so
 * the form parser stays in that page's chunk and out of the eager `__common`
 * chunk that `services/rsvpEvents.ts` (shared with the Host screens) lives in.
 * The read contains no responses and no host-only counts.
 */
import {
  parseRsvpBrandFormPage,
  type RsvpBrandFormPage,
} from "@mingla/offering-rendering/rsvpBrandForm";

export const fetchPublicRsvpBrandForm = async (
  eventId: string,
): Promise<RsvpBrandFormPage | null> => {
  // Loaded on use: the client is created at module scope in ./supabase, and
  // the public page's render suites mount this page without a backend.
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc("public_brand_form_for_event", {
    p_event_id: eventId,
  });
  if (error !== null) throw new Error(error.message || "brand_form_load_failed");
  return parseRsvpBrandFormPage(data);
};
