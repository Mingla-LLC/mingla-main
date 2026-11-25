/**
 * #4490 — the venue services' refusal type and mappers. A leaf (no Supabase
 * client): the Guest venue pages map their refusals with it without loading
 * the Host offers service.
 */
import { obj } from "./venueJsonRead";

/** A server refusal with its token kept for mapping (never shown raw). */
export class VenueOfferError extends Error {
  readonly code: string;
  /** Text after "code:" (e.g. the first not-ready reason). */
  readonly detail: string | null;
  /** Every not-ready reason (from the error DETAIL), when the server sent them. */
  readonly reasons: string[];
  constructor(code: string, detail: string | null = null, reasons: string[] = []) {
    super(code);
    this.name = "VenueOfferError";
    this.code = code;
    this.detail = detail;
    this.reasons = reasons;
  }
}

export function toVenueOfferError(error: unknown): VenueOfferError {
  if (error instanceof VenueOfferError) return error;
  const obj = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const raw = typeof obj.message === "string" ? obj.message : String(error ?? "");
  const idx = raw.indexOf(":");
  const code = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const detail = idx >= 0 ? raw.slice(idx + 1).trim() : null;
  const details = typeof obj.details === "string" ? obj.details : "";
  const reasons =
    code === "offer_not_ready" && details.length > 0
      ? details.split(",").map((r) => r.trim()).filter((r) => r.length > 0)
      : detail !== null && code === "offer_not_ready"
        ? [detail]
        : [];
  // A network failure has no token: keep it distinct from a refusal.
  if (/failed to fetch|network/i.test(raw)) return new VenueOfferError("network", null);
  return new VenueOfferError(code.length > 0 ? code : "unknown", detail, reasons);
}

/** An edge function refusal: the body's `code` when readable, else the network/unknown mapping. */
export async function edgeError(error: { message?: string; context?: unknown }): Promise<VenueOfferError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).json());
      if (typeof body.code === "string" && body.code.length > 0) {
        return new VenueOfferError(body.code, typeof body.remaining === "number" ? String(body.remaining) : null);
      }
    } catch {
      // An unreadable body falls through to the network/unknown mapping below.
    }
  }
  return toVenueOfferError({ message: error.message ?? "check_in_failed" });
}
