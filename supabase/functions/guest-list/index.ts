// issue #3827 — guest-list comps.
//
// One authenticated handler, five operations:
//   issue   host adds guests (and named plus-ones); each gets a real free
//           ticket, emailed through the standard free-ticket confirmation
//   cancel  void a guest-list ticket (no money moves; the guest is emailed)
//   resend  queue a fresh ticket email for any paid order of the event
//   search  door staff find a ticket holder by name
//   admit   admit a ticket found by name, through the same scan ladder as a QR
//
// Every database call goes through the service client with the VERIFIED actor
// id; the SECURITY DEFINER functions own permission, capacity and state.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  dispatchTicketConfirmation,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { writeAudit } from "../_shared/audit.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9][0-9]{1,14}$/;
const MAX_BODY_BYTES = 65_536;
const MAX_GUESTS = 50;
const MAX_PLUS_ONES = 9;
const SEARCH_PER_MINUTE = 60;
const ADMIT_PER_MINUTE = 120;

export type PlusOneInput = {
  name: string | null;
  email: string | null;
  phoneE164: string | null;
  nameOnly?: boolean;
};
export type GuestInput = {
  index: number;
  name: string;
  email: string | null;
  phoneE164: string | null;
  nameOnly?: boolean;
  plusOnes?: PlusOneInput[];
};
type IssueBody = {
  operation: "issue";
  eventId: string;
  ticketTypeId: string;
  eventDateId: string | null;
  guests: GuestInput[];
  note: string | null;
  clientRequestId: string;
};
type CancelBody = {
  operation: "cancel";
  orderId: string;
  reason: string | null;
  clientRequestId: string;
};
type ResendBody = {
  operation: "resend";
  orderId: string;
  clientRequestId: string;
};
type SearchBody = { operation: "search"; eventId: string; query: string };
type AdmitBody = { operation: "admit"; eventId: string; ticketId: string };
export type GuestListBody =
  | IssueBody
  | CancelBody
  | ResendBody
  | SearchBody
  | AdmitBody;

type RpcResult = {
  data: unknown;
  error: { message: string; hint?: string | null } | null;
};

export type GuestListDeps = {
  actorId: (req: Request) => Promise<string | null>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  pepper: () => string;
  dispatch: (orderId: string) => Promise<void>;
  audit: (entry: {
    user_id: string;
    event_id: string | null;
    action: string;
    target_type: string;
    target_id: string;
    after: Record<string, unknown>;
  }) => Promise<void>;
};

// The RPC code -> HTTP status table (spec §3). Anything else is `internal`.
export const STATUS_BY_CODE: Record<string, number> = {
  invalid_request: 400,
  invalid_guests: 400,
  contact_required: 400,
  name_only_with_contact: 400,
  reason_invalid_length: 400,
  query_too_short: 400,
  query_too_long: 400,
  unauthorized: 401,
  forbidden: 403,
  scanner_not_authorized: 403,
  event_not_open: 409,
  event_already_ended: 409,
  event_type_unsupported: 409,
  ticket_type_not_found: 409,
  occurrence_not_available: 409,
  ticket_capacity_exceeded: 409,
  not_a_guest_list_ticket: 409,
  comp_already_checked_in: 409,
  not_resendable: 409,
  no_email: 409,
  event_date_choice_required: 422,
  rate_limited: 429,
};

const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const onlyKeys = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const optionalText = (value: unknown, max: number): boolean =>
  value === null || value === undefined ||
  (typeof value === "string" && value.length <= max);

function isPlusOne(value: unknown): value is PlusOneInput {
  if (
    !isObject(value) ||
    !onlyKeys(value, ["name", "email", "phoneE164", "nameOnly"])
  ) return false;
  if (!optionalText(value.name, 120)) return false;
  if (!optionalText(value.email, 200)) return false;
  if (!optionalText(value.phoneE164, 16)) return false;
  if (value.nameOnly !== undefined && typeof value.nameOnly !== "boolean") {
    return false;
  }
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const phone = typeof value.phoneE164 === "string"
    ? value.phoneE164.trim()
    : "";
  if (email !== "" && !EMAIL.test(email)) return false;
  if (phone !== "" && !E164.test(phone)) return false;
  if (value.nameOnly === true) {
    if (email !== "" || phone !== "") return false;
    if (typeof value.name !== "string" || value.name.trim().length === 0) {
      return false;
    }
  } else if (email === "" && phone === "") return false;
  return true;
}

function isGuest(value: unknown): value is GuestInput {
  if (
    !isObject(value) ||
    !onlyKeys(value, [
      "index",
      "name",
      "email",
      "phoneE164",
      "nameOnly",
      "plusOnes",
    ])
  ) {
    return false;
  }
  if (
    typeof value.index !== "number" || !Number.isInteger(value.index) ||
    value.index < 0 || value.index > 49
  ) {
    return false;
  }
  if (
    typeof value.name !== "string" || value.name.trim().length < 1 ||
    value.name.trim().length > 120
  ) return false;
  if (!optionalText(value.email, 200) || !optionalText(value.phoneE164, 16)) {
    return false;
  }
  if (value.nameOnly !== undefined && typeof value.nameOnly !== "boolean") {
    return false;
  }
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const phone = typeof value.phoneE164 === "string"
    ? value.phoneE164.trim()
    : "";
  if (email !== "" && !EMAIL.test(email)) return false;
  if (phone !== "" && !E164.test(phone)) return false;
  if (value.nameOnly === true) {
    if (email !== "" || phone !== "") return false;
  } else if (email === "" && phone === "") return false;
  if (value.plusOnes !== undefined) {
    if (
      !Array.isArray(value.plusOnes) || value.plusOnes.length > MAX_PLUS_ONES
    ) return false;
    if (!value.plusOnes.every(isPlusOne)) return false;
  }
  return true;
}

export function parseBody(value: unknown): GuestListBody | null {
  if (!isObject(value)) return null;
  switch (value.operation) {
    case "issue": {
      if (
        !onlyKeys(value, [
          "operation",
          "eventId",
          "ticketTypeId",
          "eventDateId",
          "guests",
          "note",
          "clientRequestId",
        ])
      ) {
        return null;
      }
      if (
        !isUuid(value.eventId) || !isUuid(value.ticketTypeId) ||
        !isUuid(value.clientRequestId)
      ) return null;
      if (
        !(value.eventDateId === null || value.eventDateId === undefined ||
          isUuid(value.eventDateId))
      ) return null;
      if (!optionalText(value.note, 200)) return null;
      const guests = value.guests;
      if (
        !Array.isArray(guests) || guests.length < 1 ||
        guests.length > MAX_GUESTS
      ) return null;
      if (!guests.every(isGuest)) return null;
      if (new Set(guests.map((guest) => guest.index)).size !== guests.length) {
        return null;
      }
      return {
        operation: "issue",
        eventId: value.eventId,
        ticketTypeId: value.ticketTypeId,
        eventDateId: (value.eventDateId as string | null | undefined) ?? null,
        guests,
        note: (value.note as string | null | undefined) ?? null,
        clientRequestId: value.clientRequestId,
      };
    }
    case "cancel":
      if (
        !onlyKeys(value, ["operation", "orderId", "reason", "clientRequestId"])
      ) return null;
      if (
        !isUuid(value.orderId) || !isUuid(value.clientRequestId) ||
        !optionalText(value.reason, 200)
      ) return null;
      return {
        operation: "cancel",
        orderId: value.orderId,
        reason: (value.reason as string | null | undefined) ?? null,
        clientRequestId: value.clientRequestId,
      };
    case "resend":
      if (!onlyKeys(value, ["operation", "orderId", "clientRequestId"])) {
        return null;
      }
      if (!isUuid(value.orderId) || !isUuid(value.clientRequestId)) return null;
      return {
        operation: "resend",
        orderId: value.orderId,
        clientRequestId: value.clientRequestId,
      };
    case "search":
      if (!onlyKeys(value, ["operation", "eventId", "query"])) return null;
      if (
        !isUuid(value.eventId) || typeof value.query !== "string" ||
        value.query.length > 200
      ) return null;
      return {
        operation: "search",
        eventId: value.eventId,
        query: value.query,
      };
    case "admit":
      if (!onlyKeys(value, ["operation", "eventId", "ticketId"])) return null;
      if (!isUuid(value.eventId) || !isUuid(value.ticketId)) return null;
      return {
        operation: "admit",
        eventId: value.eventId,
        ticketId: value.ticketId,
      };
    default:
      return null;
  }
}

// RPC errors carry the code as the exception message. Unknown messages are
// `internal`; the raw text never reaches the client.
export function mapRpcError(
  error: { message: string; hint?: string | null },
): Response {
  const code = error.message.trim();
  const status = STATUS_BY_CODE[code];
  if (status === undefined) {
    // Never the raw text: a database message can carry an email or a name.
    console.error("[guest-list] unmapped rpc error", { length: code.length });
    return json({ ok: false, code: "internal" }, 500);
  }
  const body: Record<string, unknown> = { ok: false, code };
  if (code === "ticket_capacity_exceeded" && typeof error.hint === "string") {
    try {
      const hint = JSON.parse(error.hint) as {
        remaining?: unknown;
        ticketName?: unknown;
      };
      if (typeof hint.remaining === "number") body.remaining = hint.remaining;
      if (typeof hint.ticketName === "string") {
        body.ticketName = hint.ticketName;
      }
    } catch {
      console.error("[guest-list] capacity hint was not JSON");
    }
  }
  return json(body, status);
}

async function rateLimited(
  deps: GuestListDeps,
  scope: string,
  limit: number,
): Promise<boolean> {
  // Fails OPEN: blocking a door at peak is worse than an extra search.
  const { data, error } = await deps.rpc("pg_venue_order_rate_limit_hit", {
    p_scope_key: scope,
    p_limit: limit,
  });
  if (error) {
    console.error(
      "[guest-list] rate limiter unavailable (failing open)",
      scope.split(":")[0],
    );
    return false;
  }
  return isObject(data) && data.allowed === false;
}

// Defence in depth: the door gets exactly these fields, whatever the SQL adds.
export function projectDoorOrders(orders: unknown): Record<string, unknown>[] {
  if (!Array.isArray(orders)) return [];
  return orders.filter(isObject).map((o) => ({
    orderId: o.orderId,
    displayName: o.displayName,
    maskedEmail: o.maskedEmail ?? null,
    isGuestList: o.isGuestList === true,
    cameWithName: typeof o.cameWithName === "string" ? o.cameWithName : null,
    viaLinkLabel: typeof o.viaLinkLabel === "string" ? o.viaLinkLabel : null,
    tickets: Array.isArray(o.tickets)
      ? o.tickets.filter(isObject).map((t) => ({
        ticketId: t.ticketId,
        ticketName: t.ticketName,
        status: t.status,
        usedAt: t.usedAt ?? null,
        eventDateIds: Array.isArray(t.eventDateIds) ? t.eventDateIds : [],
      }))
      : [],
  }));
}

type IssueResult = {
  index: number;
  plusOneIndex: number | null;
  status: "added" | "replayed" | "failed";
  orderId: string | null;
  ticketCount: number | null;
  emailQueued: boolean;
  smsQueued: boolean;
  code: string | null;
};

export function createHandler(
  deps: GuestListDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ ok: false, code: "method_not_allowed" }, 405);
    }

    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, code: "request_too_large" }, 413);
    }
    let untrusted: unknown;
    try {
      untrusted = JSON.parse(text);
    } catch {
      return json({ ok: false, code: "invalid_json" }, 400);
    }
    const body = parseBody(untrusted);
    if (body === null) return json({ ok: false, code: "invalid_request" }, 400);

    const actorId = await deps.actorId(req);
    if (!actorId) return json({ ok: false, code: "unauthorized" }, 401);

    let pepper = "";
    if (body.operation === "issue" || body.operation === "admit") {
      try {
        pepper = deps.pepper();
      } catch {
        return json({ ok: false, code: "qr_token_pepper_missing" }, 500);
      }
    }

    switch (body.operation) {
      case "issue": {
        const { data, error } = await deps.rpc("biz_comp_issue", {
          p_actor_id: actorId,
          p_event_id: body.eventId,
          p_ticket_type_id: body.ticketTypeId,
          p_event_date_id: body.eventDateId,
          p_guests: body.guests.map((guest) => ({
            index: guest.index,
            name: guest.name,
            email: guest.email,
            phoneE164: guest.phoneE164,
            nameOnly: guest.nameOnly ?? false,
            plusOnes: guest.plusOnes ?? [],
          })),
          p_note: body.note,
          p_client_request_id: body.clientRequestId,
          p_qr_token_pepper: pepper,
        });
        if (error) return mapRpcError(error);
        const out = data as {
          eventDateId: string | null;
          results: IssueResult[];
          addedCount: number;
          failedCount: number;
          remaining: number | null;
        };
        for (const result of out.results) {
          if (
            result.status === "added" && result.orderId &&
            (result.emailQueued || result.smsQueued)
          ) {
            // Fire-and-forget, as ticket-checkout-create does: un-awaited work
            // completes on this runtime, and notification-retry-sweeper picks up
            // any pending row a dispatch never reached.
            const orderId = result.orderId;
            void deps.dispatch(orderId).catch((dispatchError) => {
              console.error(
                "[guest-list] confirmation dispatch failed (sweeper will retry)",
                orderId,
                dispatchError instanceof Error
                  ? dispatchError.message
                  : String(dispatchError),
              );
            });
          }
        }
        if (out.addedCount > 0) {
          await deps.audit({
            user_id: actorId,
            event_id: body.eventId,
            action: "comp_issued",
            target_type: "event",
            target_id: body.eventId,
            after: { count: out.addedCount },
          }).catch((auditError) => {
            console.error(
              "[guest-list] audit write failed (non-fatal)",
              auditError instanceof Error ? auditError.message : auditError,
            );
          });
        }
        return json({
          ok: true,
          eventDateId: out.eventDateId,
          results: out.results,
          addedCount: out.addedCount,
          failedCount: out.failedCount,
          remaining: out.remaining,
        });
      }

      case "cancel": {
        const { data, error } = await deps.rpc("biz_comp_cancel", {
          p_actor_id: actorId,
          p_order_id: body.orderId,
          p_reason: body.reason,
          p_client_request_id: body.clientRequestId,
        });
        if (error) return mapRpcError(error);
        const out = data as {
          orderId: string;
          status: string;
          idempotentReplay: boolean;
          emailQueued: boolean;
        };
        if (out.emailQueued) await deps.dispatch(body.orderId);
        if (!out.idempotentReplay) {
          await deps.audit({
            user_id: actorId,
            event_id: null,
            action: "comp_cancelled",
            target_type: "order",
            target_id: body.orderId,
            after: { status: "cancelled" },
          }).catch((auditError) => {
            console.error(
              "[guest-list] audit write failed (non-fatal)",
              auditError instanceof Error ? auditError.message : auditError,
            );
          });
        }
        return json({
          ok: true,
          orderId: out.orderId,
          status: out.status,
          idempotentReplay: out.idempotentReplay,
        });
      }

      case "resend": {
        const { error } = await deps.rpc("biz_comp_resend_prepare", {
          p_actor_id: actorId,
          p_order_id: body.orderId,
          p_client_request_id: body.clientRequestId,
        });
        if (error) return mapRpcError(error);
        // Service key, so the old order-screen 403 (discovery D-1) cannot recur.
        await deps.dispatch(body.orderId);
        return json({ ok: true, queued: true });
      }

      case "search": {
        if (
          await rateLimited(
            deps,
            `guest_list_search:${actorId}`,
            SEARCH_PER_MINUTE,
          )
        ) {
          return json({ ok: false, code: "rate_limited" }, 429);
        }
        const { data, error } = await deps.rpc("biz_door_guest_search", {
          p_actor_id: actorId,
          p_event_id: body.eventId,
          p_query: body.query,
          p_limit: 20,
        });
        if (error) return mapRpcError(error);
        const out = data as { orders: unknown[]; truncated: boolean };
        const orderIds = Array.isArray(out.orders)
          ? out.orders.filter(isObject).map((order) => order.orderId).filter(
            isUuid,
          )
          : [];
        const labelResult = await deps.rpc("biz_ticket_link_order_labels", {
          p_actor_id: actorId,
          p_event_id: body.eventId,
          p_order_ids: orderIds,
        });
        if (labelResult.error) {
          // Searching/admitting at the door remains available if optional
          // attribution cannot be loaded. Never log the database message.
          console.error("[guest-list] ticket-link attribution unavailable");
        }
        const labels = isObject(labelResult.data) ? labelResult.data : {};
        const attributedOrders = Array.isArray(out.orders)
          ? out.orders.map((order) => {
            if (!isObject(order) || !isUuid(order.orderId)) return order;
            const label = labels[order.orderId];
            return {
              ...order,
              viaLinkLabel: typeof label === "string" ? label : null,
            };
          })
          : [];
        return json({
          ok: true,
          orders: projectDoorOrders(attributedOrders),
          truncated: out.truncated === true,
        });
      }

      case "admit": {
        if (
          await rateLimited(
            deps,
            `guest_list_admit:${actorId}`,
            ADMIT_PER_MINUTE,
          )
        ) {
          return json({ ok: false, code: "rate_limited" }, 429);
        }
        const { data, error } = await deps.rpc("biz_ticket_admit_by_id", {
          p_actor_id: actorId,
          p_event_id: body.eventId,
          p_ticket_id: body.ticketId,
          p_qr_token_pepper: pepper,
        });
        if (error) return mapRpcError(error);
        const out = data as Record<string, unknown>;
        return json({
          ok: true,
          result: out.result,
          ticketId: out.ticketId ?? null,
          orderId: out.orderId ?? null,
          buyerName: out.buyerName ?? null,
          ticketName: out.ticketName ?? null,
          nextStartAt: out.nextStartAt ?? null,
          lastEndAt: out.lastEndAt ?? null,
          eventDateId: out.eventDateId ?? null,
        });
      }
    }
  };
}

function defaultDeps(): GuestListDeps {
  let client: ReturnType<typeof serviceClient> | null = null;
  const service = () => (client ??= serviceClient());
  return {
    actorId: userIdFromAuthHeader,
    rpc: async (fn, args) => {
      const { data, error } = await service().rpc(fn, args);
      return {
        data,
        error: error
          ? { message: error.message, hint: error.hint ?? null }
          : null,
      };
    },
    pepper: qrTokenPepper,
    dispatch: dispatchTicketConfirmation,
    audit: async (entry) => {
      await writeAudit(service(), { ...entry, brand_id: null, before: null });
    },
  };
}

export const handler = createHandler(defaultDeps());

if (import.meta.main) serve(handler);
