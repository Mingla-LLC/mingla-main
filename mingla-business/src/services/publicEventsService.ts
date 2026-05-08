import { supabase } from "./supabase";
import type { TicketStub } from "../store/draftEventStore";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type { Brand, BrandLinks } from "../store/currentBrandStore";

type JsonRecord = Record<string, unknown>;

interface BusinessPublicEventViewRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  brand_description: string | null;
  brand_profile_photo_url: string | null;
  brand_display_attendee_count: boolean;
  title: string;
  description: string | null;
  slug: string;
  location_text: string | null;
  online_url: string | null;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  visibility: string;
  show_on_discover: boolean;
  status: string;
  published_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  public_theme: JsonRecord | null;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  quantity_total: number | null;
  is_unlimited: boolean;
  is_free: boolean;
  sale_start_at: string | null;
  sale_end_at: string | null;
  min_purchase_qty: number;
  max_purchase_qty: number | null;
  is_hidden: boolean;
  is_disabled: boolean;
  requires_approval: boolean;
  allow_transfers: boolean;
  password_protected: boolean;
  available_online: boolean;
  available_in_person: boolean;
  waitlist_enabled: boolean;
  display_order: number;
}

export type PublicBrandRecord = Brand;
export type PublicEventRecord = LiveEvent;
export type PublicTicketTypeRecord = TicketStub;

export interface PublicEventDetail {
  event: PublicEventRecord;
  brand: PublicBrandRecord;
  tickets: PublicTicketTypeRecord[];
}

export interface PublicBrandDetail {
  brand: PublicBrandRecord;
  events: PublicEventRecord[];
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asLinks = (value: unknown): BrandLinks | undefined => {
  const record = asRecord(value);
  const links: BrandLinks = {};
  for (const key of [
    "website",
    "instagram",
    "tiktok",
    "x",
    "facebook",
    "youtube",
    "linkedin",
    "threads",
  ] as const) {
    if (typeof record[key] === "string" && record[key].length > 0) {
      links[key] = record[key];
    }
  }
  return Object.keys(links).length > 0 ? links : undefined;
};

const viewRowToBrand = (row: BusinessPublicEventViewRow): PublicBrandRecord => {
  const theme = asRecord(row.public_theme);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    kind: "popup",
    address: null,
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: 0,
      followers: 0,
      rev: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio: row.brand_description ?? undefined,
    tagline: undefined,
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
  };
};

const viewStatusToLiveStatus = (status: string): LiveEventStatus => {
  if (
    status === "scheduled" ||
    status === "cancelled" ||
    status === "ended" ||
    status === "live"
  ) {
    return status;
  }
  return "scheduled";
};

const ticketRowToTicketStub = (row: TicketTypeRow): PublicTicketTypeRecord => ({
  id: row.id,
  name: row.name,
  priceGbp: row.is_free ? null : row.price_cents / 100,
  capacity: row.quantity_total,
  isFree: row.is_free,
  isUnlimited: row.is_unlimited,
  visibility: row.is_hidden ? "hidden" : row.is_disabled ? "disabled" : "public",
  displayOrder: row.display_order,
  approvalRequired: row.requires_approval,
  passwordProtected: row.password_protected,
  password: null,
  passwordConfigured: row.password_protected,
  waitlistEnabled: row.waitlist_enabled,
  minPurchaseQty: row.min_purchase_qty,
  maxPurchaseQty: row.max_purchase_qty,
  allowTransfers: row.allow_transfers,
  description: row.description,
  saleStartAt: row.sale_start_at,
  saleEndAt: row.sale_end_at,
  availableAt:
    row.available_online && row.available_in_person
      ? "both"
      : row.available_online
        ? "online"
        : "door",
});

const viewRowToEvent = (
  row: BusinessPublicEventViewRow,
  tickets: PublicTicketTypeRecord[],
): PublicEventRecord => {
  const theme = asRecord(row.public_theme);
  const coverHue = asNumber(theme.coverHue, 25);
  return {
    id: row.id,
    serverEventId: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    eventSlug: row.slug,
    status: viewStatusToLiveStatus(row.status),
    publishedAt: row.published_at ?? row.updated_at,
    cancelledAt: null,
    endedAt: row.status === "ended" ? row.updated_at : null,
    name: row.title,
    description: row.description ?? "",
    format: row.is_online ? "online" : "in_person",
    category: null,
    whenMode: row.is_multi_date ? "multi_date" : row.is_recurring ? "recurring" : "single",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: row.timezone,
    recurrenceRule:
      row.recurrence_rules === null ? null : (row.recurrence_rules as never),
    multiDates: null,
    venueName: row.location_text,
    address: row.location_text,
    onlineUrl: row.online_url,
    hideAddressUntilTicket: true,
    coverHue,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    tickets,
    visibility: row.visibility === "private" ? "private" : row.visibility === "hidden" ? "unlisted" : "public",
    requireApproval: tickets.some((ticket) => ticket.approvalRequired),
    allowTransfers: tickets.every((ticket) => ticket.allowTransfers),
    hideRemainingCount: false,
    passwordProtected: tickets.some((ticket) => ticket.passwordProtected),
    privateGuestList: true,
    inPersonPaymentsEnabled: tickets.some(
      (ticket) => ticket.availableAt === "both" || ticket.availableAt === "door",
    ),
    orders: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fetchTickets = async (
  eventId: string,
): Promise<PublicTicketTypeRecord[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(
      "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
    )
    .eq("event_id", eventId)
    .eq("available_online", true)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  return ((data ?? []) as TicketTypeRow[]).map(ticketRowToTicketStub);
};

const detailFromRow = async (
  row: BusinessPublicEventViewRow,
): Promise<PublicEventDetail> => {
  const tickets = await fetchTickets(row.id);
  return {
    event: viewRowToEvent(row, tickets),
    brand: viewRowToBrand(row),
    tickets,
  };
};

export const getPublicEventBySlug = async (
  brandSlug: string,
  eventSlug: string,
): Promise<PublicEventDetail | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : detailFromRow(data as BusinessPublicEventViewRow);
};

export const getPublicEventById = async (
  eventId: string,
): Promise<PublicEventDetail | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : detailFromRow(data as BusinessPublicEventViewRow);
};

export const getPublicBrandBySlug = async (
  brandSlug: string,
): Promise<PublicBrandDetail | null> => {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error !== null) throw error;
  const rows = (data ?? []) as BusinessPublicEventViewRow[];
  if (rows.length === 0) return null;

  const eventTickets = await Promise.all(rows.map((row) => fetchTickets(row.id)));
  return {
    brand: viewRowToBrand(rows[0]),
    events: rows.map((row, idx) => viewRowToEvent(row, eventTickets[idx] ?? [])),
  };
};
