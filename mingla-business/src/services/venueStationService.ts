/**
 * #4490 spec 08 O3 — kitchen and bar stations (edge function venue-order-staff,
 * actions station_board / station_accept / item_ready / ticket_ready / recall /
 * picked_up) and floor PDFs (edge function venue-floor-pdf). Services throw a
 * StationError carrying the server's code; screens turn codes into words.
 */
import { supabase } from "./supabase";
import { clearTillStaffSession, getTillStaffSession, requestStepUp } from "./tillStaffSession";
import { pinRetryMessage } from "../components/venue/till/pinModel";
import {
  parseStationBoard,
  parseStationTicket,
  type StationBoard,
  type StationChoice,
  type StationName,
  type StationTicket,
} from "../components/venue/station/stationModel";

export class StationError extends Error {
  readonly code: string;
  /** #4490 08-O5 fix 3: a refused step-up PIN says how many tries are left / until when. */
  readonly triesLeft: number | null;
  readonly lockedUntil: string | null;
  constructor(code: string, triesLeft: number | null = null, lockedUntil: string | null = null) {
    super(code);
    this.name = "StationError";
    this.code = code;
    this.triesLeft = triesLeft;
    this.lockedUntil = lockedUntil;
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** The server's code from a functions error (`{ error }` or `{ code }`), else network / failed. */
export async function stationErrorFrom(error: { message?: string; context?: unknown }): Promise<StationError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).clone().json());
      const code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
      if (code.length > 0) {
        return new StationError(code, typeof body.triesLeft === "number" ? body.triesLeft : null,
          typeof body.lockedUntil === "string" ? body.lockedUntil : null);
      }
    } catch {
      // An unreadable body falls through to the network mapping below.
    }
  }
  const raw = error.message ?? "";
  return new StationError(/failed to fetch|network|load failed/i.test(raw) ? "network" : "station_failed");
}

async function staff(body: Json): Promise<Json> {
  const { data, error } = await supabase.functions.invoke("venue-order-staff", { body });
  if (error) throw await stationErrorFrom(error as { message?: string; context?: unknown });
  return obj(data);
}

export async function fetchStationBoard(venueId: string, station: StationChoice): Promise<StationBoard> {
  const data = await staff({ action: "station_board", venueId, station });
  return parseStationBoard(data.board);
}

export interface StationActionResult {
  ticket: StationTicket | null;
  already: boolean;
  alreadyBy: string | null;
  orderReady: boolean;
  delivered: boolean;
}

function actionResult(data: Json): StationActionResult {
  const by = data.alreadyAcceptedBy ?? data.alreadyReadyBy ?? data.alreadyPickedUpBy;
  return {
    ticket: parseStationTicket(data.ticket),
    already: data.already === true,
    alreadyBy: typeof by === "string" ? by : null,
    orderReady: data.orderReady === true,
    delivered: data.delivered === true,
  };
}

export type StationTicketAction = "station_accept" | "ticket_ready" | "recall" | "picked_up";

export async function runStationAction(
  action: StationTicketAction,
  orderId: string,
  station: StationName,
): Promise<StationActionResult> {
  return actionResult(await staff({ action, orderId, station }));
}

export async function markStationItemReady(orderItemId: string): Promise<StationActionResult> {
  return actionResult(await staff({ action: "item_ready", orderItemId }));
}

export type FloorPdfRequest =
  | { kind: "kitchen_ticket"; venueId: string; orderId: string; station: StationName }
  | { kind: "test_ticket"; venueId: string; station: StationChoice }
  | { kind: "receipt"; venueId: string; paymentId: string }
  // #4490 O5 part B: the day close (money rights; a PIN session on a Till device).
  | { kind: "day_close"; venueId: string; date: string };

export interface FloorPdfLink {
  signedUrl: string;
  expiresAt: string;
  filename: string;
}

async function floorPdfOnce(requestBody: Json): Promise<Json> {
  const { data, error } = await supabase.functions.invoke("venue-floor-pdf", { body: requestBody });
  if (error) throw await stationErrorFrom(error as { message?: string; context?: unknown });
  return obj(data);
}

const SESSION_LOST = ["pin_session_required", "pin_session_invalid"];

/**
 * #4490 08-O5 fix 3: the day-close PDF is an export of the day, so on a Till
 * device it asks for the same fresh PIN as the CSV (the open Day close screen
 * shows the PIN pad, TillStepUpHost) and is sent again with it. A wrong PIN
 * asks again with the reason; Cancel ends it with pin_step_up_cancelled.
 */
async function floorPdfWithStepUp(venueId: string, send: Json): Promise<Json> {
  try {
    return await floorPdfOnce(send);
  } catch (err) {
    if (!(err instanceof StationError)) throw err;
    if (SESSION_LOST.includes(err.code)) {
      clearTillStaffSession(venueId, "server");
      throw err;
    }
    if (err.code !== "pin_step_up_required") throw err;
    let message: string | null = null;
    for (;;) {
      const answer = await requestStepUp(venueId, "export", message);
      if (answer === null) throw new StationError("pin_step_up_cancelled");
      try {
        return await floorPdfOnce({ ...send, stepUp: { pin: answer.pin, ...(answer.memberId ? { memberId: answer.memberId } : {}) } });
      } catch (retryErr) {
        if (!(retryErr instanceof StationError)) throw retryErr;
        if (SESSION_LOST.includes(retryErr.code)) {
          clearTillStaffSession(venueId, "server");
          throw retryErr;
        }
        const retry = pinRetryMessage({ code: retryErr.code, triesLeft: retryErr.triesLeft, lockedUntil: retryErr.lockedUntil });
        if (retry === null) throw retryErr;
        message = retry;
      }
    }
  }
}

export async function requestFloorPdf(request: FloorPdfRequest): Promise<FloorPdfLink> {
  // #4490 O5: a receipt is a Till action; on a Till device it carries the PIN
  // session (memory only). Kitchen and test tickets run as the device.
  const session = request.kind === "receipt" || request.kind === "day_close" ? getTillStaffSession(request.venueId) : null;
  const requestBody: Json = session !== null ? { ...request, staffSession: session.token } : { ...request };
  const body = request.kind === "day_close" && session !== null
    ? await floorPdfWithStepUp(request.venueId, requestBody)
    : await floorPdfOnce(requestBody);
  if (typeof body.signedUrl !== "string" || body.signedUrl.length === 0) throw new StationError("floor_pdf_failed");
  return {
    signedUrl: body.signedUrl,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : "",
    filename: typeof body.filename === "string" ? body.filename : "ticket.pdf",
  };
}
