// #4238 W3-3 (D7) — a Host book-a-call booking is a host lead on the ad
// platforms (Meta / TikTok / Reddit Lead, Snap SIGN_UP; Google "Host lead").
//
// Only when the page sent an `ad` object (the marketing /schedule page's ad
// context: first-party click id, cookies, its ads choice and page URL) and the
// call is a Host call. Creator and Local calls are not host leads. The lead row
// is the one recordBookingLead just wrote (looked up by its booking_key); its id
// gives event_id `lead:<id>`, which the page uses for its browser Lead twin.
// A replayed booking resolves to the same row and the same event id, so the
// UNIQUE ad_conversions.event_id sends nothing twice.
//
// Never throws and never fails the booking.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type HostAdContext,
  type LeadContact,
  recordHostLead,
} from "../_shared/hostFunnelConversion.ts";
import type { FireAdConversionDeps } from "../_shared/adConversionFire.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface BookingAdLeadDeps {
  db?: Db;
  fire?: FireAdConversionDeps;
}

/**
 * #4452 B20: the contact public.inbound_lead_is_test reads for a booking, the
 * same pair the Leads list uses (the venue when given, else the name).
 */
export function bookingContact(row: { email?: unknown; name?: unknown; venue?: unknown }): LeadContact {
  const venue = typeof row.venue === "string" ? row.venue.trim() : "";
  const name = typeof row.name === "string" ? row.name : null;
  return { email: typeof row.email === "string" ? row.email : null, name: venue !== "" ? venue : name };
}

export async function recordBookingAdLead(
  bookingKey: string,
  ad: HostAdContext,
  config: { supabaseUrl: string | undefined; serviceKey: string | undefined },
  deps: BookingAdLeadDeps = {},
): Promise<string | null> {
  try {
    let db: Db = deps.db ?? null;
    if (!db) {
      if (!config.supabaseUrl || !config.serviceKey) return null;
      db = createClient(config.supabaseUrl, config.serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    const { data, error } = await db
      .from("book_call_leads")
      .select("id,email,name,venue")
      .eq("booking_key", bookingKey)
      .eq("audience", "host")
      .maybeSingle();
    if (error || !data?.id) return null;
    return await recordHostLead(db, { subjectId: String(data.id), ad, contact: bookingContact(data) }, deps.fire);
  } catch (err) {
    console.error(
      "[growth-tools-book] host lead conversion failed (non-fatal)",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// #4452 §4.6: every booking carries its label, and a booked call is its own
// result (call_booked), credited to the lead's ad click.
//
//   A. Booked from a form (a valid form_submission_id: it exists, the same
//      email, created within 7 days): no Lead (the form fired it); fire
//      `<label>_call:<booking id>` and stop that submission's follow-ups.
//   B. Direct /schedule booking: fire the labelled Lead (`lead:<id>` for hosts,
//      byte-identical to today; `creator_lead:<id>`, `local_lead:<id>`), then
//      the call, and stop any active run of a submission with the same email
//      in the last 30 days.
// Never throws and never fails the booking.
// ---------------------------------------------------------------------------
import {
  OPTED_OUT_CONTEXT,
  recordCallBooked,
  recordLabelledLead,
} from "../_shared/hostFunnelConversion.ts";

export interface FormLink {
  id: string;
  label: "host" | "creator" | "local";
}

function serviceDb(config: { supabaseUrl: string | undefined; serviceKey: string | undefined }, given?: Db): Db | null {
  if (given) return given;
  if (!config.supabaseUrl || !config.serviceKey) return null;
  return createClient(config.supabaseUrl, config.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** A form_submission_id counts only when it exists, has the same email and is at most 7 days old. */
export async function resolveFormLink(
  submissionId: string | null,
  email: string,
  config: { supabaseUrl: string | undefined; serviceKey: string | undefined },
  deps: BookingAdLeadDeps = {},
  nowMs = Date.now(),
): Promise<FormLink | null> {
  if (!submissionId) return null;
  try {
    const db = serviceDb(config, deps.db);
    if (!db) return null;
    const { data, error } = await db.from("form_submissions")
      .select("id,email,lead_label,created_at,is_test").eq("id", submissionId).maybeSingle();
    if (error || !data) return null;
    const sameEmail = String(data.email ?? "").toLowerCase() === email.trim().toLowerCase();
    const fresh = Date.parse(String(data.created_at)) >= nowMs - 7 * 24 * 3_600_000;
    if (!sameEmail || !fresh || data.is_test === true) return null;
    return { id: String(data.id), label: data.lead_label as FormLink["label"] };
  } catch {
    return null;
  }
}

export async function recordBookingConversions(
  bookingKey: string,
  audience: "host" | "creator" | "local",
  ad: HostAdContext | null,
  formLink: FormLink | null,
  config: { supabaseUrl: string | undefined; serviceKey: string | undefined },
  deps: BookingAdLeadDeps = {},
): Promise<{ leadEventId: string | null; goalEventId: string | null }> {
  try {
    const db = serviceDb(config, deps.db);
    if (!db) return { leadEventId: null, goalEventId: null };
    const { data, error } = await db.from("book_call_leads").select("id,email,name,venue").eq("booking_key", bookingKey).maybeSingle();
    if (error || !data?.id) return { leadEventId: null, goalEventId: null };
    const bookingId = String(data.id);
    let leadEventId: string | null = null;
    const label = formLink ? formLink.label : audience;
    // #4452 B20: a test or internal booker's Lead and call are never sent (both ids null).
    const contact = bookingContact(data);
    if (!formLink) {
      leadEventId = await recordLabelledLead(db, { label, subjectId: bookingId, ad: ad ?? OPTED_OUT_CONTEXT, source: "book_a_call", contact }, deps.fire);
    }
    const goalEventId = await recordCallBooked(db, { label, bookingId, source: "book_a_call", contact }, deps.fire);
    await db.from("book_call_leads").update({ lead_event_id: leadEventId, goal_event_id: goalEventId }).eq("id", bookingId);
    // Stop rule "booked": the person's follow-ups end now.
    await db.rpc("forms_booking_stops_runs", { p_email: String(data.email ?? ""), p_submission_id: formLink?.id ?? null });
    return { leadEventId, goalEventId };
  } catch (err) {
    console.error("[growth-tools-book] booking conversions failed (non-fatal)", err instanceof Error ? err.name : "error");
    return { leadEventId: null, goalEventId: null };
  }
}
