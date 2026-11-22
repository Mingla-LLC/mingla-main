// #4541 R1.14: the RSVP page's form read, through this edge.
//
// public_brand_form_for_event is granted to the service role only (#4514), so
// the signed-out RSVP page and the Explorer app cannot call it themselves (the
// live bug N1: "Questions couldn't load"). This op runs it as the service role,
// with no grant change, limited per caller address (bucket "read", 60 per 10
// minutes), and returns exactly the SQL payload. When the page has a live form
// the payload also carries `botTicket` (R8.5), which only Unknown Blast replies
// need; a missing key just leaves it out.
//
//   {op:"page_form", eventId}
//     → 200 <the SQL payload>: {active:false[, switchedOff:true]}
//           | {active:true, mode, formId, name, questionCount, versionId, definition,
//              requiredForm, doorFullAnswers, brand, botTicket?}
//     → 400 bad_request · 429 rate_limited · 500 server_error

import { type BotTicketKey, issueBotTicket } from "./botTicket.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PageFormRequest {
  op: "page_form";
  eventId: string;
}

export interface PageFormDeps {
  /** public.public_brand_form_for_event(eventId), as the service role. */
  pageForm(
    eventId: string,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  botTicketKey?: BotTicketKey;
  log: (line: string) => void;
}

export function isPageFormOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).op === "page_form";
}

export function parsePageFormRequest(raw: unknown): PageFormRequest | null {
  if (!isPageFormOp(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !["op", "eventId"].includes(k))) return null;
  if (typeof r.eventId !== "string" || !UUID_RE.test(r.eventId)) return null;
  return { op: "page_form", eventId: r.eventId.toLowerCase() };
}

export async function handlePageForm(
  req: PageFormRequest,
  deps: PageFormDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await deps.pageForm(req.eventId);
  if (error) {
    deps.log("[brand-form-submit] page_form server_error");
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  const form: Record<string, unknown> =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>) }
      : { active: false };
  if (form.active === true && typeof form.formId === "string") {
    const ticket = await issueBotTicket(form.formId, null, deps.botTicketKey);
    if (ticket !== null) form.botTicket = ticket;
  }
  return { status: 200, body: form };
}
