// Issue #4508 — the RSVP form's two guest operations on public-submit-rsvp.
//
//   {op:"guest_lookup", eventId, phone}  amendment 4: the live match under the
//     number field. Signed in only (T1: a caller without a verified session
//     gets rsvp_guest_sign_in_required before the number is read).
//     Rate-limited per user (30/min, and 200 per rolling day).
//   {op:"guest_bring", guestId, phone, phoneCountryIso?}  2.5: a claimed
//     guest brings one more person when the host allows it. Signed in only.

import { mintClaimLink } from "../_shared/claimLink.ts";
import { guestSignInRequiredResponse, mapGuestRpcError } from "./guestPayload.ts";

type RpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};

export interface GuestOpsDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  userId: string | null;
  ip: string;
  pepper(): string | null;
  drain(rsvpId: string): Promise<void>;
}

export interface GuestOpResponse {
  status: number;
  body: Record<string, unknown>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
const COUNTRY_ISO_RE = /^[A-Z]{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function objectResult(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  return isObject(value) ? value : {};
}

async function rateLimit(
  deps: GuestOpsDeps,
  scope: string,
  limit: number,
  counter: { name: string; args: Record<string, unknown> } = {
    name: "pg_venue_order_rate_limit_hit",
    args: { p_scope_key: scope, p_limit: limit },
  },
): Promise<GuestOpResponse | null> {
  const { data, error } = await deps.rpc(counter.name, counter.args);
  if (error) return { status: 503, body: { error: "unavailable" } };
  return objectResult(data).allowed === false
    ? { status: 429, body: { error: "rate_limited" } }
    : null;
}

export function isGuestOp(body: unknown): boolean {
  return isObject(body) && typeof body.op === "string";
}

export async function handleGuestOp(
  body: Record<string, unknown>,
  deps: GuestOpsDeps,
): Promise<GuestOpResponse> {
  if (body.op === "guest_lookup") {
    // T1: adding a plus-one needs a signed-in account; one constant answer,
    // before the payload or the number is looked at.
    if (deps.userId === null) return guestSignInRequiredResponse();
    if (!only(body, ["op", "eventId", "phone"])) {
      return { status: 400, body: { error: "rsvp_payload_invalid" } };
    }
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!UUID_RE.test(eventId)) {
      return { status: 400, body: { error: "event_id_required" } };
    }
    if (!PHONE_RE.test(phone)) {
      return { status: 400, body: { error: "rsvp_guest_phone_invalid" } };
    }
    const limited = await rateLimit(
      deps,
      `rsvp_guest_lookup:user:${deps.userId}`,
      30,
    );
    if (limited) return limited;
    // A signed-in account also has a ceiling per rolling day.
    const day = await rateLimit(deps, "", 200, {
      name: "rsvp_guest_lookup_day_hit",
      args: { p_user_id: deps.userId, p_limit: 200 },
    });
    if (day) return day;
    const { data, error } = await deps.rpc("rsvp_guest_lookup", {
      p_viewer: deps.userId,
      p_event_id: eventId,
      p_phone: phone,
    });
    if (error) return { status: 503, body: { error: "unavailable" } };
    return { status: 200, body: objectResult(data) };
  }

  if (body.op === "guest_bring") {
    // T1: the same one answer as the submit and the lookup.
    if (deps.userId === null) return guestSignInRequiredResponse();
    if (!only(body, ["op", "guestId", "phone", "phoneCountryIso"])) {
      return { status: 400, body: { error: "rsvp_payload_invalid" } };
    }
    const guestId = typeof body.guestId === "string" ? body.guestId.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const iso = body.phoneCountryIso;
    if (!UUID_RE.test(guestId)) {
      return { status: 400, body: { error: "rsvp_payload_invalid" } };
    }
    if (!PHONE_RE.test(phone)) {
      return { status: 400, body: { error: "rsvp_guest_phone_invalid" } };
    }
    if (
      iso !== undefined && iso !== null &&
      (typeof iso !== "string" || !COUNTRY_ISO_RE.test(iso))
    ) {
      return {
        status: 400,
        body: { error: "rsvp_guest_phone_country_invalid" },
      };
    }
    const limited = await rateLimit(
      deps,
      `rsvp_guest_bring:user:${deps.userId}`,
      10,
    );
    if (limited) return limited;
    const { data, error } = await deps.rpc("rsvp_guest_bring", {
      p_user_id: deps.userId,
      p_guest_id: guestId,
      p_phone: phone,
      p_phone_country_iso: typeof iso === "string" ? iso : null,
      p_qr_token_pepper: deps.pepper(),
    });
    if (error) {
      const mapped = mapGuestRpcError(error.code, error.message);
      return mapped
        ? { status: mapped.status, body: { error: mapped.error } }
        : { status: 500, body: { error: "rsvp_write_failed" } };
    }
    const result = objectResult(data);
    const outcome = typeof result.outcome === "string" ? result.outcome : "";
    if (outcome !== "added") {
      return {
        status: outcome === "not_found" ? 404 : 409,
        body: { error: outcome || "rsvp_write_failed" },
      };
    }
    const newGuest = String(result.guestId);
    const link = await mintClaimLink(
      { rpc: (name, args) => deps.rpc(name, args) },
      "rsvp_guest",
      newGuest,
    );
    if (typeof result.rsvpId === "string") await deps.drain(result.rsvpId);
    return {
      status: 200,
      body: {
        outcome: "added",
        guestId: newGuest,
        inviteUrl: link?.url ?? null,
      },
    };
  }

  return { status: 400, body: { error: "rsvp_payload_invalid" } };
}
