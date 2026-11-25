// #4490 spec 08 O5 part B — the daily close, the drawer and Settings ›
// Selling in person, as venue-till actions. Imported by venue-till/index.ts,
// which has already verified the bearer and resolved who acts (on a Till
// device: the PIN member, with the device recorded; refused without a live
// PIN session). Everything is decided by the service-role RPCs of migration
// 20281203704490 (money rights, the Till released at the venue, the PIN
// session re-checked in the same transaction, the day's limits).
//
//   day_summary     { date? }                                → summary
//   day_close       { date, countedMinor, clientRequestId }  → summary (+ replayed)
//   day_reopen      { date, reason, stepUp? }                → summary
//   day_carry_over  { saleId, date }                         → { saleId, carriedPast }
//   cash_movements  { date? }                                → the drawer
//   cash_movement   { date?, kind, amountMinor, note?, clientRequestId } → the drawer
//   day_export      { date, stepUp? }                        → { rows } (one per payment)
//   settings_get    {}                                       → Settings › Selling in person
//   settings_set    { patch, expectedVersion }               → the settings
//
// Reopen and export need a fresh PIN (step-up, money rights) on a Till device
// and then run as whoever approved. Settings are never changed or read in a
// PIN session (spec 08 §3 O5 "Never in a PIN session").

import {
  requireStepUp,
  type TillActor,
} from "../_shared/venueTillStaffSession.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type RpcError = { message?: string; code?: string; details?: string | null };

export const DAY_CLOSE_ACTIONS = new Set([
  "day_summary",
  "day_close",
  "day_reopen",
  "day_carry_over",
  "cash_movements",
  "cash_movement",
  "day_export",
  "settings_get",
  "settings_set",
]);

/** Machine codes the client maps to copy (dayCloseCopy.ts). */
export const DAY_CLOSE_SAFE_CODES = [
  "day_already_closed",
  "day_checks_open",
  "day_not_closed",
  "day_reopen_too_late",
  "day_out_of_range",
  "day_reason_required",
  "day_close_invalid",
  "cash_movement_invalid",
  "till_request_reused",
  "till_check_closed",
  "till_sale_not_found",
  "till_not_enabled",
  "till_settings_invalid",
  "till_settings_changed",
  "not_authorized",
  "venue_not_found",
  "pin_session_required",
  "pin_session_invalid",
  // #4490 08-O5 fix 3: the database asks for a fresh PIN (reopen, export);
  // a close request from before a reopen is not a replay.
  "pin_step_up_required",
  "day_close_request_stale",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MINOR = 2147483647;
const MAX_COUNTED = 100000000000;

export type DayCloseContext = {
  client: Client;
  venueId: string;
  actor: TillActor;
  json: (status: number, body: unknown) => Response;
  ok: (data: unknown) => Response;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A real calendar date in YYYY-MM-DD, or null. */
export function dayCloseDate(value: unknown): string | null {
  const s = str(value);
  if (!DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s
    ? null
    : s;
}

export function dayCloseSafeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return (DAY_CLOSE_SAFE_CODES as readonly string[]).find((c) =>
    message === c
  ) ?? "till_failed";
}

function statusFor(code: string, error: RpcError): number {
  if (code === "till_failed") return 500;
  if (code === "pin_step_up_required") return 403;
  switch (error.code) {
    case "22023":
      return 400;
    case "42501":
      return 403;
    case "28000":
      return 401;
    case "P0002":
      return 404;
    case "PT409":
    case "23505":
      return 409;
    case "P0001":
      return 422;
    default:
      return 400;
  }
}

export function dayCloseFailure(
  error: RpcError,
  json: (status: number, body: unknown) => Response,
): Response {
  const code = dayCloseSafeCode(error);
  const body: Record<string, unknown> = { code };
  if (error.details) {
    try {
      const detail = JSON.parse(error.details);
      if (typeof detail?.remaining === "number") {
        body.remaining = detail.remaining;
      }
    } catch {
      // optional detail
    }
  }
  if (code === "till_failed") {
    console.error(
      "[venue-till] day close rpc failed",
      error.code,
      error.message,
    );
  }
  return json(statusFor(code, error), body);
}

const SETTINGS_KEYS = new Set([
  "tipsEnabled",
  "tipBpsOptions",
  "autoLockMinutes",
  "printPaper",
  "defaultStation",
  "targetMinutes",
  "screenStations",
  "receiptFooter",
]);

/** The settings patch the screen may send (day start is retired: never sent). */
export function settingsPatch(raw: unknown): Record<string, unknown> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const patch = raw as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((k) => !SETTINGS_KEYS.has(k))) return null;
  return patch;
}

export async function handleDayClose(
  action: string,
  body: Record<string, unknown>,
  ctx: DayCloseContext,
): Promise<Response> {
  const { client, venueId, actor, json, ok } = ctx;
  const device = actor.isDevice ? actor.deviceUserId : null;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    return error
      ? { error: error as RpcError, data: null }
      : { error: null, data };
  };
  const date = body.date == null ? null : dayCloseDate(body.date);
  if (body.date != null && date === null) {
    return json(400, { code: "day_close_invalid" });
  }

  // Reopen and export: a fresh PIN with money rights on a Till device; the
  // action then runs as whoever approved (the seller stays switched in).
  const stepUp = async (
    purpose: "reopen" | "export",
  ): Promise<string | Response> => {
    if (!actor.isDevice) return actor.actorUserId;
    const step = await requireStepUp(client, {
      venueId,
      actor,
      stepUp: body.stepUp,
      purpose,
      target: `${venueId}:${date ?? ""}`,
    });
    return step.ok ? step.approverUserId : json(step.status, step.body);
  };

  switch (action) {
    case "day_summary": {
      const r = await rpc("issue_4490_day_summary", {
        p_venue_id: venueId,
        p_date: date,
        p_actor: actor.actorUserId,
        p_device_user: device,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "day_close": {
      const counted = body.countedMinor;
      const requestId = str(body.clientRequestId);
      if (
        date === null || typeof counted !== "number" ||
        !Number.isInteger(counted) ||
        counted < 0 || counted > MAX_COUNTED || !UUID.test(requestId)
      ) {
        return json(400, { code: "day_close_invalid" });
      }
      const r = await rpc("issue_4490_day_close", {
        p_venue_id: venueId,
        p_date: date,
        p_counted_minor: counted,
        p_actor: actor.actorUserId,
        p_device_user: device,
        p_request_id: requestId,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "day_reopen": {
      const reason = str(body.reason).trim();
      if (date === null || reason.length < 1 || reason.length > 140) {
        return json(400, { code: "day_reason_required" });
      }
      const who = await stepUp("reopen");
      if (who instanceof Response) return who;
      const r = await rpc("issue_4490_day_reopen", {
        p_venue_id: venueId,
        p_date: date,
        p_reason: reason,
        p_actor: who,
        p_device_user: device,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "day_carry_over": {
      const saleId = str(body.saleId);
      if (!UUID.test(saleId) || date === null) {
        return json(400, { code: "day_close_invalid" });
      }
      const owns = await client.from("venue_till_sales").select("id, venue_id")
        .eq("id", saleId).maybeSingle();
      if (owns.error || !owns.data || owns.data.venue_id !== venueId) {
        return json(404, { code: "till_sale_not_found" });
      }
      const r = await rpc("issue_4490_till_carry_over", {
        p_sale_id: saleId,
        p_date: date,
        p_actor: actor.actorUserId,
        p_device_user: device,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "cash_movements": {
      const r = await rpc("issue_4490_cash_movements_list", {
        p_venue_id: venueId,
        p_date: date,
        p_actor: actor.actorUserId,
        p_device_user: device,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "cash_movement": {
      const kind = str(body.kind);
      const amount = body.amountMinor;
      const note = body.note == null ? null : str(body.note).trim();
      const requestId = str(body.clientRequestId);
      if (
        (kind !== "float" && kind !== "paid_out") ||
        typeof amount !== "number" ||
        !Number.isInteger(amount) || amount <= 0 || amount > MAX_MINOR ||
        (note !== null && note.length > 140) ||
        (kind === "paid_out" && !note) ||
        !UUID.test(requestId)
      ) {
        return json(400, { code: "cash_movement_invalid" });
      }
      const r = await rpc("issue_4490_cash_movement", {
        p_venue_id: venueId,
        p_date: date,
        p_kind: kind,
        p_amount_minor: amount,
        p_note: note || null,
        p_actor: actor.actorUserId,
        p_device_user: device,
        p_request_id: requestId,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "day_export": {
      if (date === null) return json(400, { code: "day_close_invalid" });
      const who = await stepUp("export");
      if (who instanceof Response) return who;
      const r = await rpc("issue_4490_day_export", {
        p_venue_id: venueId,
        p_date: date,
        p_actor: who,
        p_device_user: device,
      });
      return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
    }

    case "settings_get":
    case "settings_set": {
      // Never in a PIN session, whatever the rights (spec 08 §3 O5).
      if (actor.isDevice) return json(403, { code: "not_authorized" });
      if (action === "settings_get") {
        const r = await rpc("issue_4490_till_settings_read", {
          p_venue_id: venueId,
          p_actor: actor.actorUserId,
        });
        return r.error ? dayCloseFailure(r.error, json) : ok(r.data);
      }
      const patch = settingsPatch(body.patch);
      const expected = body.expectedVersion;
      if (
        patch === null || typeof expected !== "number" ||
        !Number.isInteger(expected) || expected < 0
      ) {
        return json(400, { code: "till_settings_invalid" });
      }
      const r = await rpc("issue_4490_till_settings_set", {
        p_venue_id: venueId,
        p_patch: patch,
        p_actor: actor.actorUserId,
        p_expected_version: expected,
      });
      if (r.error) return dayCloseFailure(r.error, json);
      const read = await rpc("issue_4490_till_settings_read", {
        p_venue_id: venueId,
        p_actor: actor.actorUserId,
      });
      return read.error ? dayCloseFailure(read.error, json) : ok(read.data);
    }

    default:
      return json(400, { code: "unknown_action" });
  }
}
