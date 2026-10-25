import { mintClaimLink } from "./claimLink.ts";
import {
  collapseDaysToRange,
  type ChosenOccurrence,
  resolveChosenOccurrence,
  ticketDaysForOrder,
} from "./chosenOccurrence.ts";
import { formatMessageTime } from "./messageTime.ts";

export interface BuyerConfirmationTicket {
  ticketId: string;
  ticketTypeId: string | null;
  ticketName: string;
  status: string;
}

export interface BuyerConfirmationReceipt {
  lines: Array<{ qty: number; name: string; amountCents: number }>;
  discountLines: Array<{ label: string; amountCents: number }>;
  feesAndTaxCents: number;
  paidCents: number;
  currency: string;
  dateLine: string | null;
  orderRef: string;
}

export interface BuyerConfirmationPayload {
  buyerContact: { email: string; phoneLast4: string | null };
  receipt: BuyerConfirmationReceipt;
  claim: { shortUrl: string | null; code: string | null };
  attachedToAccount: boolean;
  boughtForSomeoneElse: boolean;
  tickets: BuyerConfirmationTicket[];
  taxAmountCents: number;
  bookedStartAt: string | null;
}

interface QueryResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

export interface BuyerConfirmationClient {
  // Supabase's recursively generic query builder cannot be expressed here
  // without causing TS2589 in the Edge callers. Results are narrowed below.
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface BuyerConfirmationOrderRow {
  buyer_email: string | null;
  buyer_phone_e164: string | null;
  buyer_user_id: string | null;
  purchased_by_user_id: string | null;
  total_cents: number | string | null;
  tax_amount_cents: number | string | null;
  buyer_fees_cents: number | string | null;
  tax_cents: number | string | null;
  buyer_total_cents: number | string | null;
  event_date_id: string | null;
  booked_start_at: string | null;
}

interface TicketRow {
  id: string;
  ticket_type_id: string | null;
  status: string;
  ticket_types:
    | { name?: string | null }
    | Array<{ name?: string | null }>
    | null;
}

interface LineRow {
  quantity: number | string | null;
  unit_price_cents: number | string | null;
  list_unit_price_cents: number | string | null;
  total_cents: number | string | null;
  discount_cents: number | string | null;
  ticket_types:
    | { name?: string | null }
    | Array<{ name?: string | null }>
    | null;
}

interface DiscountRow {
  name_snapshot: string | null;
  amount_minor: number | string | null;
}

function safeCents(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
}

function joinedName(
  joined: { name?: string | null } | Array<{ name?: string | null }> | null,
  fallback: string,
): string {
  const candidate = Array.isArray(joined) ? joined[0]?.name : joined?.name;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : fallback;
}

export function buyerPhoneLast4(phoneE164: unknown): string | null {
  if (typeof phoneE164 !== "string") return null;
  const digits = phoneE164.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function compactOrderRef(orderId: string): string {
  return orderId.replaceAll("-", "").slice(0, 8).toUpperCase();
}

export function receiptDateLine(
  occurrence: ChosenOccurrence | readonly ChosenOccurrence[] | null,
): string | null {
  if (Array.isArray(occurrence)) {
    const dates = occurrence
      .map((day) =>
        typeof day.start_at === "string"
          ? (formatMessageTime(day.start_at, day.timezone ?? null)?.date ??
            null)
          : null,
      )
      .filter((date): date is string => date !== null);
    if (dates.length === 0) return null;
    return [...new Set(dates)].join(" + ");
  }
  const singleOccurrence = occurrence as ChosenOccurrence | null;
  if (typeof singleOccurrence?.start_at !== "string") return null;
  const formatted = formatMessageTime(
    singleOccurrence.start_at,
    singleOccurrence.timezone ?? null,
  );
  return formatted === null ? null : `${formatted.date}, ${formatted.time}`;
}

function receiptLines(
  rows: readonly LineRow[],
): BuyerConfirmationReceipt["lines"] {
  const grouped = new Map<string, { qty: number; amountCents: number }>();
  for (const row of rows) {
    const name = joinedName(row.ticket_types, "Ticket");
    const qty = Math.max(Math.round(Number(row.quantity ?? 0)), 0);
    if (qty === 0) continue;
    const chargedPlusDiscount =
      safeCents(row.total_cents) + safeCents(row.discount_cents);
    const listUnit = safeCents(row.list_unit_price_cents);
    const unit = safeCents(row.unit_price_cents);
    const amountCents =
      chargedPlusDiscount > 0
        ? chargedPlusDiscount
        : (listUnit > 0 ? listUnit : unit) * qty;
    const current = grouped.get(name) ?? { qty: 0, amountCents: 0 };
    current.qty += qty;
    current.amountCents += amountCents;
    grouped.set(name, current);
  }
  return [...grouped.entries()].map(([name, value]) => ({ name, ...value }));
}

function discountLines(
  rows: readonly DiscountRow[],
): BuyerConfirmationReceipt["discountLines"] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const label =
      typeof row.name_snapshot === "string" &&
      row.name_snapshot.trim().length > 0
        ? row.name_snapshot.trim()
        : "Discount";
    grouped.set(label, (grouped.get(label) ?? 0) + safeCents(row.amount_minor));
  }
  return [...grouped.entries()].map(([label, amountCents]) => ({
    label,
    amountCents,
  }));
}

async function masterOccurrence(
  client: BuyerConfirmationClient,
  eventId: string,
): Promise<ChosenOccurrence | null> {
  const { data, error } = (await client
    .from("event_dates")
    .select("id, start_at, end_at, timezone")
    .eq("event_id", eventId)
    .eq("is_master", true)
    .maybeSingle()) as QueryResult<ChosenOccurrence>;
  if (error !== null) return null;
  return data ?? null;
}

export async function buildBuyerConfirmationPayload(
  client: BuyerConfirmationClient,
  input: {
    orderId: string;
    eventId: string;
    currency: string;
    logPrefix: string;
    order?: BuyerConfirmationOrderRow;
  },
): Promise<BuyerConfirmationPayload | null> {
  const { orderId, eventId, currency, logPrefix } = input;
  const orderLookup =
    input.order === undefined
      ? client
          .from("orders")
          .select(
            "buyer_email, buyer_phone_e164, buyer_user_id, purchased_by_user_id, total_cents, tax_amount_cents, buyer_fees_cents, tax_cents, buyer_total_cents, event_date_id, booked_start_at",
          )
          .eq("id", orderId)
          .maybeSingle()
      : Promise.resolve({ data: input.order, error: null });
  const [orderResult, ticketResult, lineResult, discountResult] =
    (await Promise.all([
      orderLookup,
      client
        .from("tickets")
        .select("id, ticket_type_id, status, ticket_types(name)")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      client
        .from("order_line_items")
        .select(
          "quantity, unit_price_cents, list_unit_price_cents, total_cents, discount_cents, ticket_types(name)",
        )
        .eq("order_id", orderId)
        .order("id", { ascending: true }),
      client
        .from("order_discount_lines")
        .select("name_snapshot, amount_minor")
        .eq("order_kind", "ticket")
        .eq("order_id", orderId)
        .order("applied_seq", { ascending: true }),
    ])) as [
      QueryResult<BuyerConfirmationOrderRow>,
      QueryResult<TicketRow[]>,
      QueryResult<LineRow[]>,
      QueryResult<DiscountRow[]>,
    ];

  if (orderResult.error !== null || orderResult.data === null) {
    console.error(`${logPrefix} order receipt lookup failed`, {
      orderId,
      message: orderResult.error?.message ?? "order_missing",
    });
    return null;
  }
  for (const [label, result] of [
    ["tickets", ticketResult],
    ["line items", lineResult],
    ["discount lines", discountResult],
  ] as const) {
    if (result.error !== null) {
      console.error(`${logPrefix} ${label} lookup failed`, {
        orderId,
        message: result.error.message ?? "query_failed",
      });
      return null;
    }
  }

  const order = orderResult.data;
  const chosenDays = await ticketDaysForOrder(client, orderId, logPrefix);
  const chosen =
    collapseDaysToRange(chosenDays ?? []) ??
    (await resolveChosenOccurrence(
      client,
      orderId,
      eventId,
      order.event_date_id,
      logPrefix,
      order.booked_start_at,
    ));
  const occurrence = chosen ?? (await masterOccurrence(client, eventId));
  const claim = await mintClaimLink(client, "order", orderId);

  return {
    buyerContact: {
      email: typeof order.buyer_email === "string" ? order.buyer_email : "",
      phoneLast4: buyerPhoneLast4(order.buyer_phone_e164),
    },
    receipt: {
      lines: receiptLines(lineResult.data ?? []),
      discountLines: discountLines(discountResult.data ?? []),
      feesAndTaxCents:
        safeCents(order.buyer_fees_cents) + safeCents(order.tax_cents),
      paidCents:
        order.buyer_total_cents === null
          ? safeCents(order.total_cents) + safeCents(order.tax_amount_cents)
          : safeCents(order.buyer_total_cents),
      currency: currency.trim(),
      dateLine:
        chosenDays !== null && chosenDays.length >= 2
          ? receiptDateLine(chosenDays)
          : receiptDateLine(occurrence),
      orderRef: compactOrderRef(orderId),
    },
    claim: {
      shortUrl: claim?.url ?? null,
      code: claim?.code ?? null,
    },
    attachedToAccount: order.buyer_user_id !== null,
    boughtForSomeoneElse: order.purchased_by_user_id !== null,
    tickets: (ticketResult.data ?? [])
      .map((row) => ({
        ticketId: String(row.id ?? ""),
        ticketTypeId:
          typeof row.ticket_type_id === "string" ? row.ticket_type_id : null,
        ticketName: joinedName(row.ticket_types, "Ticket"),
        status: typeof row.status === "string" ? row.status : "valid",
      }))
      .filter((row) => row.ticketId.length > 0),
    taxAmountCents: safeCents(order.tax_amount_cents),
    bookedStartAt:
      typeof order.booked_start_at === "string" &&
      order.booked_start_at.length > 0
        ? order.booked_start_at
        : null,
  };
}
