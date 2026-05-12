/**
 * scanTicketService — invokes the `scan-ticket` edge function and surfaces
 * the real failure code to the caller.
 *
 * ORCH-0795: introduces ScanTicketError so the scanner UI can distinguish
 * `scanner_not_authorized` (HTTP 403) from generic scan failures and render
 * a meaningful overlay instead of the supabase-js generic
 * "Edge Function returned a non-2xx status code" message.
 *
 * Body parsing uses duck-typing (`typeof .text === 'function'`) instead of
 * `instanceof Response` because React Native polyfills break the
 * `instanceof` check across JS realms. See app-mobile/src/utils/
 * edgeFunctionError.ts for the same pattern.
 */

import { supabase } from "./supabase";

export interface ServerScanResult {
  result:
    | "success"
    | "duplicate"
    | "wrong_event"
    | "not_found"
    | "void"
    // ORCH-0793 — buyer-burn-prevention discriminators. Both leave
    // tickets.status='valid' so the buyer can retry inside the window.
    | "not_yet_open"
    | "event_ended";
  scanId: string | null;
  ticketId: string | null;
  orderId: string | null;
  buyerName: string | null;
  ticketName: string | null;
  // ORCH-0793 — ISO8601. Present when result='not_yet_open'.
  nextStartAt: string | null;
  // ORCH-0793 — ISO8601. Present when result='event_ended'.
  lastEndAt: string | null;
}

export type ScanTicketErrorCode =
  | "scanner_not_authorized"
  | "auth_required"
  | "scan_payload_required"
  | "qr_token_pepper_missing"
  | "scan_failed"
  | "unknown";

export class ScanTicketError extends Error {
  readonly code: ScanTicketErrorCode;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(opts: {
    code: ScanTicketErrorCode;
    status: number | null;
    detail: string | null;
    message: string;
  }) {
    super(opts.message);
    this.name = "ScanTicketError";
    this.code = opts.code;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

interface ParsedEdgeBody {
  status: number | null;
  bodyErr: string | null;
  bodyDetail: string | null;
}

const parseEdgeError = async (error: unknown): Promise<ParsedEdgeBody> => {
  const result: ParsedEdgeBody = {
    status: null,
    bodyErr: null,
    bodyDetail: null,
  };
  if (!error || typeof error !== "object") return result;
  const ctx = (error as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return result;

  const statusCandidate = (ctx as { status?: unknown }).status;
  if (typeof statusCandidate === "number") {
    result.status = statusCandidate;
  }

  if (typeof (ctx as { text?: unknown }).text === "function") {
    try {
      const raw = await (ctx as Response).text();
      try {
        const body = JSON.parse(raw) as {
          error?: unknown;
          detail?: unknown;
        };
        if (typeof body?.error === "string") result.bodyErr = body.error;
        if (typeof body?.detail === "string") result.bodyDetail = body.detail;
      } catch {
        // non-JSON body — leave both fields null
      }
    } catch {
      // body stream unreadable — leave fields null
    }
  }
  return result;
};

const classify = (parsed: ParsedEdgeBody): ScanTicketErrorCode => {
  if (parsed.bodyDetail === "scanner_not_authorized") {
    return "scanner_not_authorized";
  }
  if (parsed.bodyErr === "auth_required" || parsed.status === 401) {
    return "auth_required";
  }
  if (parsed.bodyErr === "scan_payload_required") {
    return "scan_payload_required";
  }
  if (parsed.bodyErr === "qr_token_pepper_missing") {
    return "qr_token_pepper_missing";
  }
  if (parsed.bodyErr === "scan_failed") {
    return "scan_failed";
  }
  return "unknown";
};

export const scanTicket = async (
  eventId: string,
  qrPayload: string,
): Promise<ServerScanResult> => {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { eventId, qrPayload },
  });
  if (error) {
    const parsed = await parseEdgeError(error);
    const code = classify(parsed);
    const sdkMessage =
      error instanceof Error && typeof error.message === "string"
        ? error.message
        : "Scan failed";
    throw new ScanTicketError({
      code,
      status: parsed.status,
      detail: parsed.bodyDetail,
      message: sdkMessage,
    });
  }
  return data as ServerScanResult;
};
