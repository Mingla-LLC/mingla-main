// Issue #3827 — authenticated host control plane for private ticket links.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { writeAudit } from "../_shared/audit.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import {
  dispatchTicketConfirmation,
  qrTokenPepper,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  deriveTicketLinkToken,
  resolveOfferingInviteTokenPepper,
  ticketLinkNonce,
  ticketLinkNonceFromHex,
} from "../_shared/ticketLinkToken.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;

type RpcError = { message: string; hint?: string | null };
type RpcResult = { data: unknown; error: RpcError | null };
type LinkRow = Record<string, unknown> & { id: string; tokenNonce?: string };

export interface TicketLinksDeps {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  pepper: typeof resolveOfferingInviteTokenPepper;
  qrPepper(): string;
  dispatch(orderId: string): Promise<void>;
  audit(entry: { user_id: string; event_id: string | null; action: string; target_id: string; after: object }): Promise<void>;
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const nullableUuid = (value: unknown) => value === null || value === undefined || uuid(value);
const nullableInteger = (value: unknown) => value === null || value === undefined || (Number.isInteger(value) && Number(value) >= 1);
const nullableDate = (value: unknown) => value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

export function validTicketLinksBody(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || typeof value.op !== "string") return false;
  switch (value.op) {
    case "create":
      return only(value, ["op", "eventId", "ticketTypeId", "eventDateId", "label", "maxUses", "partyMax", "approvalMode", "expiresAt"]) &&
        uuid(value.eventId) && uuid(value.ticketTypeId) && nullableUuid(value.eventDateId) &&
        typeof value.label === "string" && value.label.trim().length >= 1 && value.label.trim().length <= 60 &&
        nullableInteger(value.maxUses) && Number.isInteger(value.partyMax) && Number(value.partyMax) >= 1 && Number(value.partyMax) <= 10 &&
        (value.approvalMode === "auto" || value.approvalMode === "host") && nullableDate(value.expiresAt);
    case "list":
      return only(value, ["op", "eventId"]) && uuid(value.eventId);
    case "update":
      return only(value, ["op", "linkId", "patch"]) && uuid(value.linkId) && isObject(value.patch) &&
        only(value.patch, ["label", "maxUses", "partyMax", "approvalMode", "expiresAt"]);
    case "revoke":
    case "reset":
      return only(value, ["op", "linkId"]) && uuid(value.linkId);
    case "requests":
      return only(value, ["op", "eventId", "linkId"]) && uuid(value.eventId) && nullableUuid(value.linkId);
    case "decide":
      return only(value, ["op", "signupId", "decision", "clientRequestId"]) && uuid(value.signupId) &&
        (value.decision === "approve" || value.decision === "decline") && uuid(value.clientRequestId);
    default:
      return false;
  }
}

const statusByCode: Record<string, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  link_not_found: 404,
  signup_not_found: 404,
  event_unavailable: 409,
  event_ended: 409,
  event_type_unsupported: 409,
  ticket_type_not_found: 409,
  tier_not_sellable_online: 409,
  paid_tier_must_be_hidden: 409,
  occurrence_not_available: 409,
  expiry_in_past: 409,
  too_many_links: 409,
  max_below_used: 409,
  link_revoked: 409,
  link_expired: 409,
  link_full: 409,
  ticket_capacity_exceeded: 409,
  tier_unavailable: 409,
};

function rpcFailure(error: RpcError): Response {
  const code = error.message.trim();
  const status = statusByCode[code];
  if (status === undefined) {
    console.error("[ticket-links] unmapped rpc error", { length: code.length });
    return json({ ok: false, code: "internal" }, 500);
  }
  const body: Record<string, unknown> = { ok: false, code };
  if ((code === "max_below_used" || code === "link_full" || code === "ticket_capacity_exceeded") && error.hint) {
    try {
      const hint = JSON.parse(error.hint) as Record<string, unknown>;
      for (const key of ["used", "remaining", "needed"]) if (typeof hint[key] === "number") body[key] = hint[key];
    } catch {
      // The public response remains the stable code when a hint is malformed.
    }
  }
  return json(body, status);
}

async function presentLink(row: LinkRow, deps: TicketLinksDeps): Promise<Record<string, unknown>> {
  const nonceHex = row.tokenNonce;
  const { tokenNonce: _secretNonce, ...safe } = row;
  if (typeof nonceHex !== "string") return safe;
  const derived = await deriveTicketLinkToken(await deps.pepper(), row.id, ticketLinkNonceFromHex(nonceHex));
  return { ...safe, url: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/g/${derived.opaqueToken}` };
}

export function createTicketLinksHandler(deps: TicketLinksDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ ok: false, code: "request_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, code: "invalid_json" }, 400);
    }
    if (!validTicketLinksBody(body)) return json({ ok: false, code: "invalid_request" }, 400);
    const actor = await deps.actorId(req);
    if (!actor) return json({ ok: false, code: "unauthorized" }, 401);

    try {
      const op = body.op as string;
      let result: RpcResult;
      let auditAction = "";
      let targetId = "";
      let eventId: string | null = typeof body.eventId === "string" ? body.eventId : null;

      if (op === "create") {
        const linkId = crypto.randomUUID();
        const nonce = ticketLinkNonce();
        const derived = await deriveTicketLinkToken(await deps.pepper(), linkId, nonce);
        result = await deps.rpc("biz_ticket_link_create", {
          p_actor_id: actor,
          p_event_id: body.eventId,
          p_ticket_type_id: body.ticketTypeId,
          p_event_date_id: body.eventDateId ?? null,
          p_label: body.label,
          p_max_uses: body.maxUses ?? null,
          p_party_max: body.partyMax,
          p_approval_mode: body.approvalMode,
          p_expires_at: body.expiresAt ?? null,
          p_link_id: linkId,
          p_nonce: `\\x${derived.nonceHex}`,
          p_token_hash: derived.tokenHash,
        });
        if (result.error) return rpcFailure(result.error);
        auditAction = "ticket_link_created";
        targetId = linkId;
        const link = { ...(result.data as Record<string, unknown>), url: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/g/${derived.opaqueToken}` };
        void deps.audit({ user_id: actor, event_id: eventId, action: auditAction, target_id: targetId, after: { op } })
          .catch((error) => console.error("[ticket-links] audit failed", error instanceof Error ? error.message : String(error)));
        return json({ ok: true, link });
      }

      if (op === "list") {
        result = await deps.rpc("biz_ticket_link_list", { p_actor_id: actor, p_event_id: body.eventId });
        if (result.error) return rpcFailure(result.error);
        const rows = Array.isArray(result.data) ? result.data.filter(isObject) as LinkRow[] : [];
        return json({ ok: true, links: await Promise.all(rows.map((row) => presentLink(row, deps))) });
      }

      if (op === "update") {
        result = await deps.rpc("biz_ticket_link_update", { p_actor_id: actor, p_link_id: body.linkId, p_patch: body.patch });
        auditAction = "ticket_link_updated";
        targetId = String(body.linkId);
      } else if (op === "revoke") {
        result = await deps.rpc("biz_ticket_link_revoke", { p_actor_id: actor, p_link_id: body.linkId });
        auditAction = "ticket_link_revoked";
        targetId = String(body.linkId);
      } else if (op === "reset") {
        const nonce = ticketLinkNonce();
        const derived = await deriveTicketLinkToken(await deps.pepper(), String(body.linkId), nonce);
        result = await deps.rpc("biz_ticket_link_reset", {
          p_actor_id: actor,
          p_link_id: body.linkId,
          p_nonce: `\\x${derived.nonceHex}`,
          p_token_hash: derived.tokenHash,
        });
        if (result.error) return rpcFailure(result.error);
        auditAction = "ticket_link_reset";
        targetId = String(body.linkId);
        void deps.audit({ user_id: actor, event_id: null, action: auditAction, target_id: targetId, after: { op } })
          .catch((error) => console.error("[ticket-links] audit failed", error instanceof Error ? error.message : String(error)));
        return json({ ok: true, link: { id: body.linkId, url: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/g/${derived.opaqueToken}` } });
      } else if (op === "requests") {
        result = await deps.rpc("biz_ticket_link_requests", {
          p_actor_id: actor,
          p_event_id: body.eventId,
          p_link_id: body.linkId ?? null,
        });
        if (result.error) return rpcFailure(result.error);
        return json({ ok: true, requests: Array.isArray(result.data) ? result.data : [] });
      } else {
        const decision = String(body.decision);
        result = await deps.rpc("biz_ticket_link_decide", {
          p_actor_id: actor,
          p_signup_id: body.signupId,
          p_decision: decision,
          p_client_request_id: body.clientRequestId,
          p_qr_token_pepper: decision === "approve" ? deps.qrPepper() : "not-used-for-decline",
        });
        if (result.error) return rpcFailure(result.error);
        const out = isObject(result.data) ? result.data : {};
        const ids = Array.isArray(out.emailQueuedOrderIds) ? out.emailQueuedOrderIds.filter((id): id is string => typeof id === "string") : [];
        for (const id of ids) void deps.dispatch(id).catch((error) => console.error("[ticket-links] dispatch failed", id, error instanceof Error ? error.message : String(error)));
        auditAction = decision === "approve" ? "ticket_link_request_approved" : "ticket_link_request_declined";
        targetId = String(body.signupId);
        void deps.audit({ user_id: actor, event_id: null, action: auditAction, target_id: targetId, after: { op, issuedCount: out.issuedCount ?? 0 } })
          .catch((error) => console.error("[ticket-links] audit failed", error instanceof Error ? error.message : String(error)));
        return json({ ok: true, ...out });
      }

      if (result.error) return rpcFailure(result.error);
      void deps.audit({ user_id: actor, event_id: eventId, action: auditAction, target_id: targetId, after: { op } })
        .catch((error) => console.error("[ticket-links] audit failed", error instanceof Error ? error.message : String(error)));
      return json({ ok: true, ...(isObject(result.data) ? { link: result.data } : {}) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "internal";
      if (code.includes("pepper")) return json({ ok: false, code: "link_service_unavailable" }, 503);
      console.error("[ticket-links] handler failed", { code });
      return json({ ok: false, code: "internal" }, 500);
    }
  };
}

function productionDeps(): TicketLinksDeps {
  let client: ReturnType<typeof serviceClient> | null = null;
  const service = () => (client ??= serviceClient());
  return {
    actorId: userIdFromAuthHeader,
    rpc: async (name, args) => {
      const { data, error } = await service().rpc(name, args);
      return { data, error: error ? { message: error.message, hint: error.hint ?? null } : null };
    },
    pepper: resolveOfferingInviteTokenPepper,
    qrPepper: qrTokenPepper,
    dispatch: dispatchTicketConfirmation,
    audit: (entry) => writeAudit(service(), { ...entry, brand_id: null, target_type: "ticket_link" }),
  };
}

export const handler = createTicketLinksHandler(productionDeps());
if (import.meta.main) serve(handler);
