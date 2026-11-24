/**
 * issue #3281 S6 — the RSVP page's add-on picker and its read, loaded on use by
 * PublicEventPage (only while EXPO_PUBLIC_FF_EXTRAS_ENABLED is on). One chunk:
 * the picker shares no module with the ticket cart (Host web boot payload).
 *
 * The public RSVP page reads its event from the public events view, which has
 * no add-ons; the RSVP reader carries them as `rsvpAddOns`, and only while
 * add_on_rollout.rsvp_enabled is on. Absent means the RSVP offers none: no
 * picker, no list, and the RSVP is sent exactly as before.
 */

import { RsvpAddOnsPicker } from "@mingla/offering-rendering/RsvpAddOnsPicker";
export { rsvpAddOnLines } from "@mingla/offering-rendering/rsvpAddOnPicks";

import { supabase } from "../../services/supabase";

export default RsvpAddOnsPicker;

/** The RSVP's add-on list as the reader returns it; null when it offers none. */
export async function fetchPublicRsvpAddOns(
  brandSlug: string,
  eventSlug: string,
): Promise<unknown> {
  const { data, error } = await supabase.rpc("pg_public_rsvp_by_slug", {
    p_brand_slug: brandSlug,
    p_event_slug: eventSlug,
  });
  if (error !== null) {
    // The RSVP still works without add-ons; say why none are offered.
    console.warn("[RsvpAddOnsOnUse] RSVP add-ons did not load", error.message);
    throw error;
  }
  const payload = data as { rsvpAddOns?: unknown } | null;
  return payload !== null && typeof payload === "object" && Array.isArray(payload.rsvpAddOns)
    ? payload.rsvpAddOns
    : null;
}

