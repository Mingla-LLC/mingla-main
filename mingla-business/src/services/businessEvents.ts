import { supabase } from "./supabase";
import type {
  DraftEvent,
  DraftEventFormat,
  DraftEventVisibility,
  EventCoverMediaType,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "../store/draftEventStore";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type { Brand, BrandLinks } from "../store/currentBrandStore";
import { draftToServerUpdate, publishedVisibilityForDraft } from "../utils/serverDraftEventMapper";

type JsonRecord = Record<string, unknown>;

interface BusinessManagementEventRow {
  id: string;
  brand_id: string;
  created_by: string;
  brand_slug: string;
  brand_name: string;
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
  cover_media_type: EventCoverMediaType | null;
  currency?: string | null;
  visibility: string;
  show_on_discover: boolean;
  status: string;
  published_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  management_theme: JsonRecord | null;
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

interface PublishRpcResponse {
  event: {
    id: string;
    brand_id: string;
    created_by: string;
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
    cover_media_type: EventCoverMediaType | null;
    currency?: string | null;
    visibility: string;
    status: string;
    published_at: string | null;
    timezone: string;
    created_at: string;
    updated_at: string;
    theme: JsonRecord | null;
  };
  brand: {
    id: string;
    slug: string;
    name: string;
  };
  tickets: TicketTypeRow[];
  client_revision: number | null;
}

export interface BusinessEventDetail {
  event: LiveEvent;
  brand: Brand;
  tickets: TicketStub[];
}

export interface PublishedBusinessEvent {
  event: LiveEvent;
  brand: Pick<Brand, "id" | "slug" | "displayName">;
  tickets: TicketStub[];
  clientRevision: number | null;
}

const BUSINESS_EVENT_SELECT = "*";
const TICKET_SELECT =
  "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,available_online,available_in_person,waitlist_enabled,display_order";

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asWhenMode = (
  value: unknown,
  row: Pick<BusinessManagementEventRow, "is_recurring" | "is_multi_date">,
): WhenMode => {
  if (value === "recurring" || value === "multi_date" || value === "single") {
    return value;
  }
  if (row.is_multi_date) return "multi_date";
  if (row.is_recurring) return "recurring";
  return "single";
};

const asFormat = (value: unknown, isOnline: boolean): DraftEventFormat => {
  if (value === "in_person" || value === "online" || value === "hybrid") {
    return value;
  }
  return isOnline ? "online" : "in_person";
};

const asVisibility = (value: string): DraftEventVisibility => {
  if (value === "private") return "private";
  if (value === "hidden") return "unlisted";
  return "public";
};

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

const viewStatusToLiveStatus = (status: string): LiveEventStatus => {
  if (
    status === "scheduled" ||
    status === "live" ||
    status === "cancelled" ||
    status === "ended"
  ) {
    return status;
  }
  return "scheduled";
};

export const ticketRowToTicketStub = (row: TicketTypeRow): TicketStub => ({
  id: row.id,
  name: row.name,
  priceGbp: row.is_free ? null : row.price_cents / 100,
  currency: row.currency,
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

const brandFromRow = (row: BusinessManagementEventRow): Brand => {
  const theme = asRecord(row.management_theme);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    kind: "popup",
    address: null,
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
    currentLiveEvent: null,
    bio: undefined,
    tagline: undefined,
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
  };
};

const eventFromRow = (
  row: BusinessManagementEventRow,
  tickets: TicketStub[],
): LiveEvent => {
  const theme = asRecord(row.management_theme);
  const businessEvent = asRecord(theme.business_event);
  const when = asRecord(businessEvent.when);
  const location = asRecord(businessEvent.location);
  const settings = asRecord(businessEvent.settings);

  return {
    id: row.id,
    serverEventId: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    eventSlug: row.slug,
    status: viewStatusToLiveStatus(row.status),
    publishedAt: row.published_at ?? row.updated_at,
    cancelledAt: row.status === "cancelled" ? row.updated_at : null,
    endedAt: row.status === "ended" ? row.updated_at : null,
    name: row.title,
    description: row.description ?? "",
    format: asFormat(businessEvent.format, row.is_online),
    category: asStringOrNull(businessEvent.category),
    whenMode: asWhenMode(businessEvent.whenMode, row),
    date: asStringOrNull(when.date),
    doorsOpen: asStringOrNull(when.doorsOpen),
    endsAt: asStringOrNull(when.endsAt),
    timezone: asStringOrNull(when.timezone) ?? row.timezone,
    recurrenceRule:
      businessEvent.recurrenceRule === null ||
      businessEvent.recurrenceRule === undefined
        ? null
        : (businessEvent.recurrenceRule as RecurrenceRule),
    multiDates: Array.isArray(businessEvent.multiDates)
      ? (businessEvent.multiDates as MultiDateEntry[])
      : null,
    venueName: asStringOrNull(location.venueName) ?? row.location_text,
    address: asStringOrNull(location.address) ?? row.location_text,
    onlineUrl: row.online_url,
    hideAddressUntilTicket: asBoolean(
      businessEvent.hideAddressUntilTicket,
      true,
    ),
    coverHue: asNumber(businessEvent.coverHue ?? theme.coverHue, 25),
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    currency:
      asStringOrNull(row.currency) ??
      tickets.find((ticket) => ticket.currency !== undefined)?.currency,
    tickets,
    visibility: asVisibility(row.visibility),
    requireApproval: asBoolean(settings.requireApproval, tickets.some((t) => t.approvalRequired)),
    allowTransfers: asBoolean(settings.allowTransfers, tickets.every((t) => t.allowTransfers)),
    hideRemainingCount: asBoolean(settings.hideRemainingCount, false),
    passwordProtected: asBoolean(settings.passwordProtected, tickets.some((t) => t.passwordProtected)),
    privateGuestList: asBoolean(settings.privateGuestList, false),
    inPersonPaymentsEnabled: asBoolean(
      settings.inPersonPaymentsEnabled,
      tickets.some((ticket) => ticket.availableAt === "both" || ticket.availableAt === "door"),
    ),
    orders: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fetchTicketsForEvent = async (eventId: string): Promise<TicketStub[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(TICKET_SELECT)
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  return ((data ?? []) as TicketTypeRow[]).map(ticketRowToTicketStub);
};

const detailFromRow = async (
  row: BusinessManagementEventRow,
): Promise<BusinessEventDetail> => {
  const tickets = await fetchTicketsForEvent(row.id);
  return {
    event: eventFromRow(row, tickets),
    brand: brandFromRow(row),
    tickets,
  };
};

export const fetchBusinessEventsForBrand = async (
  brandId: string,
): Promise<LiveEvent[]> => {
  const { data, error } = await supabase
    .from("business_management_events_view")
    .select(BUSINESS_EVENT_SELECT)
    .eq("brand_id", brandId)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error !== null) throw error;
  const rows = (data ?? []) as BusinessManagementEventRow[];
  const ticketLists = await Promise.all(rows.map((row) => fetchTicketsForEvent(row.id)));
  return rows.map((row, idx) => eventFromRow(row, ticketLists[idx] ?? []));
};

export const fetchBusinessEventById = async (
  eventId: string,
): Promise<BusinessEventDetail | null> => {
  const { data, error } = await supabase
    .from("business_management_events_view")
    .select(BUSINESS_EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : detailFromRow(data as BusinessManagementEventRow);
};

const eventFromPublishResponse = (
  response: PublishRpcResponse,
): PublishedBusinessEvent => {
  const businessEvent = asRecord(asRecord(response.event.theme).business_event);
  if (response.event.currency === null || response.event.currency === undefined) {
    throw new Error("Published event is missing currency.");
  }
  const row: BusinessManagementEventRow = {
    id: response.event.id,
    brand_id: response.event.brand_id,
    created_by: response.event.created_by,
    brand_slug: response.brand.slug,
    brand_name: response.brand.name,
    brand_profile_photo_url: null,
    brand_display_attendee_count: false,
    title: response.event.title,
    description: response.event.description,
    slug: response.event.slug,
    location_text: response.event.location_text,
    online_url: response.event.online_url,
    is_online: response.event.is_online,
    is_recurring: response.event.is_recurring,
    is_multi_date: response.event.is_multi_date,
    recurrence_rules: response.event.recurrence_rules,
    cover_media_url: response.event.cover_media_url,
    cover_media_type: response.event.cover_media_type,
    currency: response.event.currency,
    visibility: response.event.visibility,
    show_on_discover: false,
    status: response.event.status,
    published_at: response.event.published_at,
    timezone: response.event.timezone,
    created_at: response.event.created_at,
    updated_at: response.event.updated_at,
    management_theme: {
      ...asRecord(response.event.theme),
      business_event: businessEvent,
    },
  };
  const tickets = (response.tickets ?? []).map(ticketRowToTicketStub);
  return {
    event: eventFromRow(row, tickets),
    brand: {
      id: response.brand.id,
      slug: response.brand.slug,
      displayName: response.brand.name,
    },
    tickets,
    clientRevision: response.client_revision,
  };
};

export const publishBusinessEventDraft = async (
  draft: DraftEvent,
  clientRevision: number | null = draft.clientRevision ?? null,
): Promise<PublishedBusinessEvent> => {
  const payload = draftToServerUpdate(draft, {});
  const { data, error } = await supabase.rpc("business_publish_event_draft", {
    p_event_id: draft.id,
    p_draft_payload: {
      ...payload,
      visibility: publishedVisibilityForDraft(draft.visibility),
    },
    p_client_revision: clientRevision,
  });

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("Publish did not return a durable event.");
  }
  if (response.event.slug.startsWith("draft-")) {
    throw new Error("Publish returned a draft placeholder slug.");
  }
  return eventFromPublishResponse(response);
};

export const cancelBusinessEvent = async (
  eventId: string,
): Promise<PublishedBusinessEvent> => {
  const { data, error } = await supabase.rpc("business_cancel_event", {
    p_event_id: eventId,
  });

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("Cancel did not return a durable event.");
  }
  return eventFromPublishResponse(response);
};

export const endBusinessEventTicketSales = async (
  eventId: string,
): Promise<PublishedBusinessEvent> => {
  const { data, error } = await supabase.rpc(
    "business_end_event_ticket_sales",
    {
      p_event_id: eventId,
    },
  );

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("End ticket sales did not return a durable event.");
  }
  return eventFromPublishResponse(response);
};
