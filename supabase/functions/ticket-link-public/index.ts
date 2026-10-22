// Issue #3827 — anonymous resolver and guest-list sign-up for bearer links.
// The raw token and client IP are never logged or persisted.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  dispatchTicketConfirmation,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import {
  hashTicketLinkIp,
  hashTicketLinkToken,
  requestClientIp,
  resolveOfferingInviteTokenPepper,
  TICKET_LINK_TOKEN,
} from "../_shared/ticketLinkToken.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9][0-9]{1,14}$/;
const MAX_BODY_BYTES = 8_192;
const MAX_EVENT_DATES = 60;

type RpcResult = { data: unknown; error: { message: string; hint?: string | null } | null };
type Person = { name: string; email: string; phone: string };

export interface TicketLinkPublicDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  pepper: typeof resolveOfferingInviteTokenPepper;
  qrPepper(): string;
  dispatch(orderId: string): Promise<void>;
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

function isPerson(value: unknown): value is Person {
  return isObject(value) && only(value, ["name", "email", "phone"]) &&
    typeof value.name === "string" && value.name.trim().length >= 1 && value.name.trim().length <= 120 &&
    typeof value.email === "string" && value.email.length <= 200 && EMAIL.test(value.email.trim()) &&
    typeof value.phone === "string" && E164.test(value.phone.trim());
}

export function parseTicketLinkPublicBody(value: unknown): Record<string, unknown> | null {
  if (!isObject(value) || typeof value.op !== "string" || typeof value.token !== "string") return null;
  if (value.op === "resolve" || value.op === "preview") {
    return only(value, ["op", "token"]) ? value : null;
  }
  if (value.op !== "signup" || !only(value, ["op", "token", "lead", "guests", "eventDateId", "eventDateIds", "clientRequestId", "website"])) return null;
  if (!isPerson(value.lead) || !Array.isArray(value.guests) || value.guests.length > 9 || !value.guests.every(isPerson)) return null;
  if (!(value.eventDateId === null || value.eventDateId === undefined || (typeof value.eventDateId === "string" && UUID.test(value.eventDateId)))) return null;
  // issue #3827 — several dates on an event that asks for one. Absent on every
  // event that does not ask, so that request stays byte-identical.
  if (value.eventDateIds !== undefined && !(
    Array.isArray(value.eventDateIds) && value.eventDateIds.length <= MAX_EVENT_DATES &&
    value.eventDateIds.every((id) => typeof id === "string" && UUID.test(id)) &&
    new Set(value.eventDateIds.map((id) => String(id).toLowerCase())).size === value.eventDateIds.length
  )) return null;
  if (typeof value.clientRequestId !== "string" || !UUID.test(value.clientRequestId)) return null;
  if (typeof value.website !== "string" || value.website.length > 500) return null;
  return value;
}

export function maskTicketLinkEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}

const statusByCode: Record<string, number> = {
  invalid_request: 400,
  link_not_found: 404,
  link_revoked: 409,
  link_expired: 409,
  link_full: 409,
  event_unavailable: 409,
  event_ended: 409,
  tier_unavailable: 409,
  ticket_capacity_exceeded: 409,
  not_a_guest_list_link: 409,
  occurrence_not_available: 409,
  event_date_choice_required: 422,
  rate_limited: 429,
};

function rpcFailure(error: { message: string; hint?: string | null }): Response {
  const code = error.message.trim();
  const status = statusByCode[code];
  if (status === undefined) {
    console.error("[ticket-link-public] unmapped rpc error", { length: code.length });
    return json({ ok: false, code: "internal" }, 500);
  }
  const body: Record<string, unknown> = { ok: false, code };
  if (code === "invalid_request" && error.hint) {
    try {
      const hint = JSON.parse(error.hint) as Record<string, unknown>;
      if (typeof hint.field === "string") body.field = hint.field;
      if (typeof hint.reason === "string") body.reason = hint.reason;
    } catch {
      // Keep the stable code without exposing database text.
    }
  }
  return json(body, status);
}

async function limited(
  deps: TicketLinkPublicDeps,
  scope: string,
  limit: number,
  failClosed: boolean,
): Promise<"allow" | "limited" | "unavailable"> {
  const { data, error } = await deps.rpc("pg_venue_order_rate_limit_hit", { p_scope_key: scope, p_limit: limit });
  if (error) return failClosed ? "unavailable" : "allow";
  return isObject(data) && data.allowed === false ? "limited" : "allow";
}

function previewOf(data: unknown): Record<string, unknown> {
  if (!isObject(data) || data.state !== "active") return { state: isObject(data) && typeof data.state === "string" ? data.state : "not_found" };
  const event = isObject(data.event) ? data.event : {};
  return {
    state: data.state,
    kind: data.kind,
    eventTitle: event.title,
    brandName: event.brandName,
    startAt: event.startAt,
    // issue #3827 — a video cover's URL is an .mp4; a preview image is its poster.
    ogImageUrl: event.coverMediaType === "video" ? (event.coverPosterUrl ?? null) : (event.coverUrl ?? null),
  };
}

/** The chosen date set, with a legacy single date folded in once. */
export function signupDateIds(body: Record<string, unknown>): string[] {
  const ids = (Array.isArray(body.eventDateIds) ? body.eventDateIds : []).map((id) => String(id).toLowerCase());
  const single = typeof body.eventDateId === "string" ? body.eventDateId.toLowerCase() : null;
  if (single !== null && !ids.includes(single)) ids.push(single);
  return ids;
}

function peopleFrom(body: Record<string, unknown>): Person[] {
  return [body.lead as Person, ...(body.guests as Person[])].map((person) => ({
    name: person.name.trim(),
    email: person.email.trim().toLowerCase(),
    phone: person.phone.trim(),
  }));
}

export function createTicketLinkPublicHandler(deps: TicketLinkPublicDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ ok: false, code: "request_too_large" }, 413);
    let body: Record<string, unknown> | null;
    try {
      body = parseTicketLinkPublicBody(JSON.parse(raw));
    } catch {
      return json({ ok: false, code: "invalid_json" }, 400);
    }
    if (!body) return json({ ok: false, code: "invalid_request" }, 400);

    let pepper;
    try {
      pepper = await deps.pepper();
    } catch {
      return json({ ok: false, code: "link_service_unavailable" }, 503);
    }
    const ipHash = await hashTicketLinkIp(requestClientIp(req), pepper.bytes);
    const gate = await limited(deps, `${body.op === "signup" ? "tl_signup" : "tl_resolve"}:${ipHash}`, body.op === "signup" ? 5 : 60, body.op === "signup");
    if (gate === "limited") return json({ ok: false, code: "rate_limited" }, 429);
    if (gate === "unavailable") return json({ ok: false, code: "link_service_unavailable" }, 503);

    // Malformed and unknown tokens intentionally have the same resolve answer.
    if (!TICKET_LINK_TOKEN.test(String(body.token))) {
      return body.op === "signup"
        ? json({ ok: false, code: "link_not_found" }, 404)
        : json({ state: "not_found" });
    }
    const tokenHash = await hashTicketLinkToken(String(body.token), pepper.bytes);

    if (body.op === "resolve" || body.op === "preview") {
      const { data, error } = await deps.rpc("pg_ticket_link_resolve", { p_token_hash: tokenHash });
      if (error) return json({ ok: false, code: "internal" }, 500);
      return json(body.op === "preview" ? previewOf(data) : (isObject(data) ? data : { state: "not_found" }));
    }

    const submitted = peopleFrom(body);
    if (String(body.website).trim().length > 0) {
      return json({
        ok: true,
        status: "issued",
        people: submitted.map((person) => ({ name: person.name, maskedEmail: maskTicketLinkEmail(person.email) })),
      });
    }

    let qrPepperValue: string;
    try {
      qrPepperValue = deps.qrPepper();
    } catch {
      return json({ ok: false, code: "link_service_unavailable" }, 503);
    }
    const members = submitted.map((person) => ({ name: person.name, email: person.email, phoneE164: person.phone }));
    const { data, error } = Array.isArray(body.eventDateIds)
      ? await deps.rpc("pg_ticket_link_signup_days", {
        p_token_hash: tokenHash,
        p_members: members,
        p_event_date_ids: signupDateIds(body),
        p_client_request_id: body.clientRequestId,
        p_ip_hash: ipHash,
        p_qr_token_pepper: qrPepperValue,
      })
      : await deps.rpc("pg_ticket_link_signup", {
        p_token_hash: tokenHash,
        p_members: members,
        p_event_date_id: body.eventDateId ?? null,
        p_client_request_id: body.clientRequestId,
        p_ip_hash: ipHash,
        p_qr_token_pepper: qrPepperValue,
      });
    if (error) return rpcFailure(error);
    const out = isObject(data) ? data : {};
    const ids = Array.isArray(out.emailQueuedOrderIds) ? out.emailQueuedOrderIds.filter((id): id is string => typeof id === "string") : [];
    for (const id of ids) {
      void deps.dispatch(id).catch((dispatchError) =>
        console.error("[ticket-link-public] confirmation dispatch failed", id, dispatchError instanceof Error ? dispatchError.message : String(dispatchError))
      );
    }
    return json({
      ok: true,
      status: out.status === "pending" ? "pending" : "issued",
      alreadyPending: out.alreadyPending === true || undefined,
      people: Array.isArray(out.people)
        ? out.people
        : submitted.map((person) => ({ name: person.name, maskedEmail: maskTicketLinkEmail(person.email) })),
    });
  };
}

function productionDeps(): TicketLinkPublicDeps {
  let client: ReturnType<typeof serviceClient> | null = null;
  const service = () => (client ??= serviceClient());
  return {
    rpc: async (name, args) => {
      const { data, error } = await service().rpc(name, args);
      return { data, error: error ? { message: error.message, hint: error.hint ?? null } : null };
    },
    pepper: resolveOfferingInviteTokenPepper,
    qrPepper: qrTokenPepper,
    dispatch: dispatchTicketConfirmation,
  };
}

export const handler = createTicketLinkPublicHandler(productionDeps());
if (import.meta.main) serve(handler);
