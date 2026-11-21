/**
 * #4541 — the public RSVP page's form read.
 *
 * Its own leaf module on purpose: only the public event page imports it, so
 * the form parser stays in that page's chunk and out of the eager `__common`
 * chunk that `services/rsvpEvents.ts` (shared with the Host screens) lives in.
 * The read contains no responses and no host-only counts.
 *
 * R1.14 (N1): the read goes through the server, `brand-form-submit`
 * `{op:"page_form", eventId}`, which reads the form as the server role. The
 * database function behind it is granted to the server role only, so a guest
 * calling it directly is always refused (I-4541-NO-CLIENT-SERVICE-ROLE-RPC).
 */
import {
  parseRsvpBrandFormRead,
  type RsvpBrandFormRead,
} from "@mingla/offering-rendering/rsvpBrandForm";

export const fetchPublicRsvpBrandForm = async (
  eventId: string,
): Promise<RsvpBrandFormRead | null> => {
  // Loaded on use: the client is created at module scope in ./supabase, and
  // the public page's render suites mount this page without a backend.
  const { supabase } = await import("./supabase");
  // [TRANSITIONAL] #4541 wave 1 server — `page_form` returns exactly the
  // `public_brand_form_for_event` payload as its body (R1.14). Exit: the W1
  // edge op is on the branch and its Deno test (T-43) is green.
  const { data, error } = await supabase.functions.invoke("brand-form-submit", {
    body: { op: "page_form", eventId },
  });
  if (error !== null && error !== undefined) {
    throw new Error("brand_form_load_failed", { cause: error });
  }
  return parseRsvpBrandFormRead(data);
};
