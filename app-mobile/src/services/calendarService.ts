import { supabase } from "./supabase";
// issue #2160 — the "how many calendar entries does this order produce"
// rule lives in its own RN-free module so it can actually be CALLED by a
// test. This file imports ./supabase at module scope and cannot be.
import { calendarDayWindowsForOrder } from "./calendarOrderDays";
import { userActivityService } from "./userActivityService";
import { recordCardSchedule } from "./cardEngagementService";

// ORCH-0829-A: business-event purchases go through `ticket-checkout-create`
// which writes rows to `orders` + `tickets` tables. The consumer calendar
// surface unions both `calendar_entries` (legacy "scheduled saved cards")
// AND business-event orders so users see their purchased tickets alongside
// their saved-card schedules. New invariant:
// I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS.
const BUSINESS_BUYER_DOMAIN = "https://business.mingla.app";

// ORCH-1188 FIX 2: the buyer-web public page is served under a type-specific path
// prefix — `/t/` for trips, `/exp/` for experiences, `/e/` for standard +
// RSVP events. The `/e/` resolver REJECTS trip/experience slugs, so a hardcoded
// `/e/` "View on web" link 404'd for trips/experiences. Map by events.event_type.
export function buyerPagePrefixForEventType(
  eventType: string | null | undefined,
): "e" | "t" | "exp" {
  switch (eventType) {
    case "trip":
      return "t";
    case "experience":
      return "exp";
    default:
      // standard ticketed events + "rsvp" both resolve under /e/.
      return "e";
  }
}

export interface CalendarEntryRecord {
  id: string;
  user_id: string;
  card_id: string | null; // TEXT - can be UUID, Google Places ID, or any string identifier
  board_card_id: string | null;
  source: "solo" | "collaboration";
  card_data: any;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  scheduled_at: string;
  duration_minutes?: number | null;
  purchase_option_id?: string | null;
  price_paid?: number | null;
  qr_code?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  device_calendar_event_id?: string | null;
}

// ORCH-0829-A: discriminated-union shape for the consumer calendar
// timeline. The Calendar tab renders by `kind`. `calendar` = legacy
// saved-card schedule; `business_event` = ticket purchase from a Mingla
// business event (via `ticket-checkout-create`).
export type ConsumerCalendarEntry =
  | {
      kind: "calendar";
      id: string;
      scheduledAt: string;
      title: string;
      imageUrl: string | null;
      calendar: CalendarEntryRecord;
    }
  | {
      kind: "business_event";
      id: string;
      scheduledAt: string;
      title: string;
      imageUrl: string | null;
      businessEvent: BusinessEventCalendarRow;
    };

export interface ConsumerTicketRow {
  id: string;
  ticketTypeId: string;
  qrCode: string;
  status: "valid" | "used" | "void" | "transferred" | "refunded";
  attendeeName: string | null;
  attendeeEmail: string | null;
}

// ORCH-0842: venue info surfaced inside the consumer ticket sheet.
// Sourced from events.location_text + events.location_geo +
// events.is_online + events.online_url. No new DB columns.
export interface BusinessEventVenue {
  locationText: string | null;
  locationGeoLat: number | null;
  locationGeoLng: number | null;
  isOnline: boolean;
  onlineUrl: string | null;
}

export interface BusinessEventCalendarRow {
  orderId: string;
  eventId: string;
  eventTitle: string;
  brandName: string;
  brandSlug: string;
  coverMediaUrl: string | null;
  masterDateUtc: string | null;
  // ORCH-0853: ISO-8601 UTC end timestamp of the master event date.
  // Sourced from `event_dates.end_at` where `is_master = true`. Active/Archive
  // partition uses this; pre-0853 used `masterDateUtc` (start_at) only and
  // archived in-progress events the moment they STARTED.
  masterDateEndUtc: string | null;
  timezone: string;
  paymentStatus:
    | "pending"
    | "paid"
    | "failed"
    | "refunded"
    | "partial_refund"
    | "cancelled";
  ticketCount: number;
  ticketCountValid: number;
  tickets: ConsumerTicketRow[];
  publicBuyerUrl: string | null;
  // ORCH-0842: nullable until first dispatch upload (or lazy backfill) lands;
  // mobile uses presence as a hint, but ticket-pdf-fetch handles missing
  // path transparently via lazy backfill.
  ticketPdfPath: string | null;
  // ORCH-0842: venue block rendered inside TicketPdfSheet.
  venue: BusinessEventVenue;
}

// ORCH-1163 [rsvp-shared-body]: one flat "Going" RSVP row for the consumer
// Calendar tab. Each row is either the signed-in user's OWN primary RSVP
// (role="primary") or a plus-one row they were brought as (role="guest"); the
// per-entity QR + role discriminator come straight from `fetch_user_going_rsvps`.
// Models the BusinessEventCalendarRow shape (venue block + cover + dates) so the
// row + pass sheet reuse the same rendering conventions. RSVP is ticketless — no
// order/payment fields.
export interface ConsumerRsvpRow {
  rsvpId: string;
  guestId: string | null;
  role: "primary" | "guest";
  qrCode: string | null;
  status: string;
  approvalStatus: string;
  // The primary's plus-one display names (empty for now — the RPC is flat).
  plusGuestNames: string[];
  // The viewer's own resolved display name (primary's profile name, or the
  // guest's name on a plus-one row) — shown on the pass.
  displayName: string | null;
  coverMediaUrl: string | null;
  // The RSVP event id — needed to change/cancel via submitDeckRsvp.
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  brandName: string;
  masterDateUtc: string | null;
  masterDateEndUtc: string | null;
  timezone: string;
  venue: {
    locationText: string | null;
    isOnline: boolean;
    onlineUrl: string | null;
  };
  invitedBy: string | null;
}

// ORCH-0842: PostgREST returns `point` columns as either string "(x,y)" or
// an object { x, y } depending on version. Defensive parser handles both
// and falls back to nulls on any unexpected shape.
function parseLocationGeo(
  raw: unknown,
): { lat: number | null; lng: number | null } {
  if (raw == null) return { lat: null, lng: null };
  if (typeof raw === "string") {
    const match = raw.match(/^\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?$/);
    if (!match) return { lat: null, lng: null };
    const lng = parseFloat(match[1]);
    const lat = parseFloat(match[2]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return { lat: null, lng: null };
    }
    return { lat, lng };
  }
  if (typeof raw === "object") {
    const obj = raw as { x?: unknown; y?: unknown };
    const lng = typeof obj.x === "number" ? obj.x : null;
    const lat = typeof obj.y === "number" ? obj.y : null;
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

export class CalendarService {
  static async fetchUserCalendarEntries(userId: string): Promise<CalendarEntryRecord[]> {
    const { data, error } = await supabase
      .from("calendar_entries")
      .select("*")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: false });

    if (error) {
      console.error("Error fetching calendar entries:", error);
      throw error;
    }

    return (data as CalendarEntryRecord[]) || [];
  }

  static async addEntryFromSavedCard(
    userId: string,
    card: any,
    scheduledAtIso: string
  ): Promise<CalendarEntryRecord> {
    // Sanitize card_data: only allow known, serializable, display-relevant fields.
    // This prevents non-serializable values (Date objects, functions, React internals)
    // from being dumped into the JSONB column and causing INSERT failures.
    //
    // #1669 [expanded-card-one-producer] — THIS ALLOWLIST IS A FIELD-SURVIVAL
    // DECISION, and it is the ONE place in the app where a field the canonical
    // mapper carries can still be lost. CalendarTab reads this row straight
    // back into `savedCardToExpandedCardData`, so anything dropped here is
    // permanently absent on the Calendar surface no matter what the mapper does.
    // When you add a field to the mapper, decide about it HERE too.
    //
    // Deliberately EXCLUDED, with reasons — do not add these without thinking:
    //   selectedDateTime — the row's own `scheduled_at` column IS the planning
    //     datetime; CalendarTab passes it into the mapper as an option. A copy
    //     inside card_data could disagree with the column (two owners, one truth).
    //   distance / travelTime are allowed but VIEWER-RELATIVE — they are stored
    //     as a snapshot and the modal recomputes them at open time.
    //   matchFactors / socialStats — all-zero neutral defaults the mapper
    //     re-supplies for free; storing them is bytes for nothing.
    //   travelMode — the viewer's own current preference, not a fact about the
    //     venue; the mounting screen supplies it per open.
    const allowedCardFields = [
      "id", "placeId", "title", "category", "categoryIcon", "description",
      "fullDescription", "image", "images", "rating", "reviewCount",
      "priceRange", "distance", "travelTime", "address",
      "priceRangeStatus", "sourceMinMinor", "sourceMaxMinor",
      "sourceCurrencyCode", "sourceMinorUnitExponent", "displayMinMinor",
      "displayMaxMinor", "displayCurrencyCode", "displayMinorUnitExponent",
      "priceIsApproximate", "fxSnapshotId", "fxProvider",
      "fxProviderUpdatedAt", "fxFreshness",
      "openingHours", "phone", "website", "highlights", "tags",
      "matchScore", "location",
      // #1669: the venue's OWN UTC offset. Without it CalendarTab computes
      // Open now / Closed against the VIEWER's clock — wrong for every
      // cross-timezone venue, and it would have stayed wrong on this one
      // surface even after #1683 widens the serving RPCs, because the row is
      // the source and the row did not carry it. 0 of 19 live rows have it.
      "utcOffsetMinutes",
      // #1669: the price tier the modal renders as a chip; carried by the
      // mapper on every other surface, dropped only by this hop.
      "priceTier",
      "cardType", "tagline", "stops", "totalPriceMin", "totalPriceMax",
      "estimatedDurationMinutes", "experienceType", "pairingKey",
      "shoppingList", "strollData", "picnicData", "nightOutData",
      "tip", "sessionName",
    ];
    const sanitizedCardData: Record<string, unknown> = {};
    for (const key of allowedCardFields) {
      if (key in card && card[key] !== undefined) {
        sanitizedCardData[key] = card[key];
      }
    }

    const payload = {
      user_id: userId,
      card_id: card.id ?? null,
      board_card_id: card.source === "collaboration" && card.sessionId ? card.sessionId : null,
      source: (card.source as "solo" | "collaboration") || "solo",
      card_data: sanitizedCardData,
      status: "pending" as const,
      scheduled_at: scheduledAtIso,
    };

    if (__DEV__) {
      console.log("[CalendarService] INSERT payload:", {
        user_id: payload.user_id,
        card_id: payload.card_id,
        board_card_id: payload.board_card_id,
        source: payload.source,
        card_data_keys: Object.keys(sanitizedCardData),
        scheduled_at: payload.scheduled_at,
      });
    }

    const { data, error } = await supabase
      .from("calendar_entries")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      // 23505 = unique_violation — the entry already exists (race condition or double-tap).
      // Treat as success: fetch and return the existing entry.
      if (error.code === '23505') {
        console.warn("[CalendarService] Duplicate entry detected — returning existing:", {
          user_id: payload.user_id,
          card_id: payload.card_id,
        });
        const { data: existing } = await supabase
          .from("calendar_entries")
          .select("*")
          .eq("user_id", payload.user_id)
          .eq("card_id", payload.card_id)
          .eq("status", "pending")
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (existing) return existing as CalendarEntryRecord;
        // If we can't find the existing entry (shouldn't happen), fall through to throw
      }

      console.error("[CalendarService] INSERT failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }

    await userActivityService.recordActivity(userId, {
      activity_type: "scheduled_card",
      title: card.title || "Saved experience",
      tag: "Scheduled",
      reference_id: card.id ?? null,
      reference_type: "experience",
      metadata: { scheduled_at: scheduledAtIso },
    });

    // ORCH-0408 Phase 4: Record schedule — counter + user interaction log (fire-and-forget)
    recordCardSchedule(card.id, {
      category: card.category,
      priceTier:
        ((card as any).cardType === 'curated' || !!(card as any).stops)
          ? card.priceTier
          : undefined,
      isCurated: !!(card as any).stops || (card as any).cardType === 'curated',
    });

    const placeId = card.placeId || card.id;
    if (placeId) {
      Promise.resolve().then(() =>
        supabase.rpc('increment_place_engagement', {
          p_google_place_id: placeId,
          p_field: 'total_schedules',
          p_amount: 1,
        })
      ).catch((err) => console.warn('[calendarService] place engagement RPC failed:', err));
    }

    return data as CalendarEntryRecord;
  }

  static async updateEntry(
    entryId: string,
    userId: string,
    updates: {
      scheduled_at?: string;
      status?: "pending" | "confirmed" | "completed" | "cancelled";
      duration_minutes?: number;
      notes?: string;
      device_calendar_event_id?: string | null;
    }
  ): Promise<CalendarEntryRecord> {
    const { data, error } = await supabase
      .from("calendar_entries")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .eq("user_id", userId) // Ensure user can only update their own entries
      .select("*")
      .single();

    if (error) {
      console.error("Error updating calendar entry:", error);
      throw error;
    }

    return data as CalendarEntryRecord;
  }

  static async deleteEntry(entryId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from("calendar_entries")
      .delete()
      .eq("id", entryId)
      .eq("user_id", userId); // Ensure user can only delete their own entries

    if (error) {
      console.error("Error deleting calendar entry:", error);
      throw error;
    }

    return true;
  }

  /**
   * ORCH-0829-A: fetch business-event orders for the signed-in consumer.
   *
   * Joins orders → events (cover + timezone) → brands (name + slug) →
   * event_dates (master date) → tickets (qr + status). Only paid+pending
   * are surfaced; failed / refunded / cancelled hidden in v1 (separate
   * sibling ORCH if refund UI is needed).
   *
   * RLS enforces buyer_user_id = auth.uid() via
   * `biz_can_read_order_for_caller`; ticket SELECT policy similarly
   * filters by order.buyer_user_id match.
   */
  static async fetchUserBusinessEventOrders(
    userId: string,
  ): Promise<BusinessEventCalendarRow[]> {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
          id, event_id, payment_status, created_at, ticket_pdf_path, event_date_id,
          events!inner (
            id, title, slug, event_type, cover_media_url, timezone,
            location_text, location_geo, is_online, online_url,
            brand:brands!inner ( id, slug, name ),
            event_dates!left ( id, start_at, end_at, is_master )
          ),
          tickets:tickets (
            id, ticket_type_id, qr_code, status, attendee_name, attendee_email,
            ticket_event_dates ( event_date_id )
          )
        `,
      )
      .eq("buyer_user_id", userId)
      .in("payment_status", ["paid", "pending"])
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(
        "[CalendarService] fetchUserBusinessEventOrders error:",
        ordersError,
      );
      throw ordersError;
    }

    type OrderRow = {
      id: string;
      event_id: string;
      payment_status: BusinessEventCalendarRow["paymentStatus"];
      created_at: string;
      ticket_pdf_path: string | null;
      // ORCH-1188 FIX 3: the buyer's BOOKED occurrence (copied onto the order by
      // biz_ticket_checkout_finalize from the session's selected event_date_id).
      // NULL for single-date events / legacy orders → fall back to the master date.
      event_date_id: string | null;
      events: {
        id: string;
        title: string;
        slug: string;
        // ORCH-1188 FIX 2: drives the public-page URL prefix (/e /t /exp).
        event_type: string | null;
        cover_media_url: string | null;
        timezone: string | null;
        location_text: string | null;
        location_geo: unknown;
        is_online: boolean | null;
        online_url: string | null;
        brand: { id: string; slug: string; name: string } | null;
        event_dates: Array<{
          id: string;
          start_at: string | null;
          end_at: string | null;
          is_master: boolean;
        }> | null;
      } | null;
      tickets: Array<{
        id: string;
        ticket_type_id: string;
        qr_code: string;
        status: ConsumerTicketRow["status"];
        attendee_name: string | null;
        attendee_email: string | null;
        // issue #2160 — the days THIS pass admits. Empty for every pre-#2160
        // pass and every single-date event ("not day-scoped").
        ticket_event_dates?: Array<{ event_date_id: string }> | null;
      }> | null;
    };

    // ══ issue #2160 — ONE CALENDAR ENTRY PER DAY THE GUEST IS ATTENDING ════
    // `flatMap`, not `map`: a two-day guest gets TWO entries. This is the same
    // bug class as #2162 — a surface rendering ONE date for an order that
    // covers several — and it bites HARDER here than a wrong email would,
    // because `orders.event_date_id` is now the LATEST-ENDING day (the payout
    // anchor, D-2). Left alone, a both-days guest would have seen ONLY day 2
    // in their calendar and could have missed day 1 entirely.
    //
    // I checked the rest of this service for the same assumption, as asked:
    // `masterDateUtc` / `masterDateEndUtc` are the only per-order date fields,
    // and the upcoming/archive partition and `computeEntryEffectiveEnd` both
    // read them per ROW — so emitting one row per day partitions each day
    // independently and correctly, with no change to either. The RSVP and trip
    // fetchers below carry no day set at all (RSVPs are single-date by product
    // decision, #2131), so they are genuinely unaffected rather than skipped.
    return ((orders ?? []) as unknown as OrderRow[]).flatMap(
      (order): BusinessEventCalendarRow[] => {
        const event = order.events;
        const brand = event?.brand ?? null;
        // ORCH-1188 FIX 3c: prefer the buyer's BOOKED occurrence (orders.event_date_id)
        // so the calendar shows the date they actually purchased + partitions
        // upcoming/archive correctly. Fall back to the is_master occurrence only
        // when no booked occurrence is recorded (single-date events / legacy orders).
        const bookedOccurrence = order.event_date_id
          ? (event?.event_dates ?? []).find(
              (ed) => ed?.id === order.event_date_id,
            )
          : undefined;
        const masterDate =
          bookedOccurrence ??
          (event?.event_dates ?? []).find((ed) => ed?.is_master === true);
        const tickets: ConsumerTicketRow[] = (order.tickets ?? []).map(
          (t) => ({
            id: t.id,
            ticketTypeId: t.ticket_type_id,
            qrCode: t.qr_code,
            status: t.status,
            attendeeName: t.attendee_name ?? null,
            attendeeEmail: t.attendee_email ?? null,
          }),
        );
        const geo = parseLocationGeo(event?.location_geo);
        const venue: BusinessEventVenue = {
          locationText: event?.location_text ?? null,
          locationGeoLat: geo.lat,
          locationGeoLng: geo.lng,
          isOnline: Boolean(event?.is_online),
          onlineUrl: event?.online_url ?? null,
        };
        // ONE entry per day the guest is attending. The rule itself lives in
        // `calendarOrderDays.ts` so it is directly testable; this call site is
        // deliberately thin.
        const daysToEmit = calendarDayWindowsForOrder({
          occurrences: event?.event_dates ?? null,
          tickets: order.tickets ?? null,
          // The ORCH-1188 answer, unchanged and still live: the order's own
          // booked occurrence, else the master. #2160 only decides whether one
          // window is enough.
          fallback: {
            start_at: masterDate?.start_at ?? null,
            end_at: masterDate?.end_at ?? null,
          },
        });

        return daysToEmit.map((day) => ({
          orderId: order.id,
          eventId: event?.id ?? order.event_id,
          eventTitle: event?.title ?? "Event",
          brandName: brand?.name ?? "",
          brandSlug: brand?.slug ?? "",
          coverMediaUrl: event?.cover_media_url ?? null,
          masterDateUtc: day.start_at,
          // ORCH-0853: end-of-event timestamp used by consumer Calendar
          // partition. Still the END, never the start — the
          // i-consumer-calendar-uses-end-not-start gate is unaffected: #2160
          // only changes WHICH occurrence's end this is, never that it is one.
          masterDateEndUtc: day.end_at,
          timezone: event?.timezone ?? "UTC",
          paymentStatus: order.payment_status,
          ticketCount: tickets.length,
          ticketCountValid: tickets.filter((t) => t.status === "valid").length,
          tickets,
          publicBuyerUrl:
            brand && event
              ? `${BUSINESS_BUYER_DOMAIN}/${buyerPagePrefixForEventType(
                  event.event_type,
                )}/${brand.slug}/${event.slug}`
              : null,
          ticketPdfPath: order.ticket_pdf_path ?? null,
          venue,
        }));
      },
    );
  }

  /**
   * ORCH-1163 [rsvp-shared-body]: fetch the signed-in consumer's "Going" RSVPs
   * (the primary's own + each plus-one row they were brought as), flattened by
   * the `fetch_user_going_rsvps` RPC. Each row carries its per-entity QR + role
   * discriminator so the consumer Calendar can render an RSVP pass alongside
   * tickets + reservations. RLS / SECURITY DEFINER in the RPC scope the read to
   * the caller (own primary rows + the guest rows minted for them).
   */
  static async fetchUserGoingRsvps(
    userId: string,
  ): Promise<ConsumerRsvpRow[]> {
    const { data, error } = await supabase.rpc("fetch_user_going_rsvps", {
      p_user_id: userId,
    });

    if (error) {
      console.error("[CalendarService] fetchUserGoingRsvps error:", error);
      throw error;
    }

    type RsvpRpcRow = {
      rsvp_id: string;
      guest_id: string | null;
      role: string;
      qr_code: string | null;
      rsvp_status: string;
      approval_status: string;
      plus_count: number | null;
      display_name: string | null;
      invited_by: string | null;
      event_id: string;
      event_title: string | null;
      event_slug: string | null;
      cover_media_url: string | null;
      timezone: string | null;
      location_text: string | null;
      is_online: boolean | null;
      online_url: string | null;
      brand_id: string;
      brand_slug: string | null;
      brand_name: string | null;
      master_start_at: string | null;
      master_end_at: string | null;
      created_at: string | null;
    };

    return ((data ?? []) as unknown as RsvpRpcRow[]).map(
      (row): ConsumerRsvpRow => ({
        rsvpId: row.rsvp_id,
        guestId: row.guest_id ?? null,
        role: row.role === "guest" ? "guest" : "primary",
        qrCode: row.qr_code ?? null,
        status: row.rsvp_status,
        approvalStatus: row.approval_status,
        // The RPC does not return the per-guest names; leave empty for now.
        plusGuestNames: [],
        displayName: row.display_name ?? null,
        coverMediaUrl: row.cover_media_url ?? null,
        eventId: row.event_id,
        eventTitle: row.event_title ?? "Event",
        eventSlug: row.event_slug ?? "",
        brandName: row.brand_name ?? "",
        masterDateUtc: row.master_start_at ?? null,
        masterDateEndUtc: row.master_end_at ?? null,
        timezone: row.timezone ?? "UTC",
        venue: {
          locationText: row.location_text ?? null,
          isOnline: Boolean(row.is_online),
          onlineUrl: row.online_url ?? null,
        },
        invitedBy: row.invited_by ?? null,
      }),
    );
  }

  /**
   * ORCH-0829-A: unified consumer calendar fetch. Runs both sources in
   * parallel and merges into a single sorted timeline.
   * Throws on either source failing (first-error wins — operator can
   * soften to "show whichever succeeded" if needed).
   */
  static async fetchConsumerCalendar(
    userId: string,
  ): Promise<ConsumerCalendarEntry[]> {
    const [legacyEntries, businessOrders] = await Promise.all([
      CalendarService.fetchUserCalendarEntries(userId),
      CalendarService.fetchUserBusinessEventOrders(userId),
    ]);

    const calendarVariants: ConsumerCalendarEntry[] = legacyEntries.map(
      (e): ConsumerCalendarEntry => ({
        kind: "calendar",
        id: `calendar:${e.id}`,
        scheduledAt: e.scheduled_at,
        title: e.card_data?.title ?? "Saved experience",
        imageUrl: e.card_data?.image ?? null,
        calendar: e,
      }),
    );

    const businessVariants: ConsumerCalendarEntry[] = businessOrders.map(
      (b): ConsumerCalendarEntry => ({
        kind: "business_event",
        id: `business:${b.orderId}`,
        scheduledAt: b.masterDateUtc ?? new Date(0).toISOString(),
        title: b.eventTitle,
        imageUrl: b.coverMediaUrl,
        businessEvent: b,
      }),
    );

    return [...calendarVariants, ...businessVariants].sort(
      (a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt),
    );
  }
}
