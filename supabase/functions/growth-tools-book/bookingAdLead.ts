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
  recordHostLead,
} from "../_shared/hostFunnelConversion.ts";
import type { FireAdConversionDeps } from "../_shared/adConversionFire.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface BookingAdLeadDeps {
  db?: Db;
  fire?: FireAdConversionDeps;
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
      .select("id")
      .eq("booking_key", bookingKey)
      .eq("audience", "host")
      .maybeSingle();
    if (error || !data?.id) return null;
    return await recordHostLead(db, { subjectId: String(data.id), ad }, deps.fire);
  } catch (err) {
    console.error(
      "[growth-tools-book] host lead conversion failed (non-fatal)",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
