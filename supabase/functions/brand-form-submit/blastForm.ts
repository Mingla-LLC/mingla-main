// #4541 R4.5: the Blast form read, through this edge.
//
//   {op:"blast_form", formId, campaignId}
//     → 200 {form, brand, campaignId, botTicket?}: the definition, the brand header,
//           the 30-day campaign window checked (brand_form_blast_form, service role)
//     → 400 bad_request · 403 form_not_on_event · 404 form_not_found · 410 form_closed
//       · 429 rate_limited · 503 forms_paused · 500 server_error
//
// The bot ticket (R8.5) is bound to this form and Blast; only an Unknown reply
// needs it. A missing derivation root just leaves it out (the Unknown submit
// then fails closed with bot_check_failed). Never responses or contacts.

import { type BotTicketKey, issueBotTicket } from "./botTicket.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BlastFormRequest {
  op: "blast_form";
  formId: string;
  campaignId: string;
}

export interface BlastFormDeps {
  /** public.brand_form_blast_form(formId, campaignId), as the service role. */
  blastForm(
    formId: string,
    campaignId: string,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  botTicketKey?: BotTicketKey;
  log: (line: string) => void;
}

export function isBlastFormOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).op === "blast_form";
}

export function parseBlastFormRequest(raw: unknown): BlastFormRequest | null {
  if (!isBlastFormOp(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !["op", "formId", "campaignId"].includes(k))) {
    return null;
  }
  if (typeof r.formId !== "string" || !UUID_RE.test(r.formId)) return null;
  if (typeof r.campaignId !== "string" || !UUID_RE.test(r.campaignId)) return null;
  return {
    op: "blast_form",
    formId: r.formId.toLowerCase(),
    campaignId: r.campaignId.toLowerCase(),
  };
}

const KNOWN: Record<string, number> = {
  forms_paused: 503,
  form_not_found: 404,
  form_closed: 410,
  form_not_on_event: 403,
};

export async function handleBlastForm(
  req: BlastFormRequest,
  deps: BlastFormDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await deps.blastForm(req.formId, req.campaignId);
  if (error) {
    const first = (error.message ?? "").trim().split(/[\s:]/)[0] ?? "";
    if (first in KNOWN) {
      deps.log(`[brand-form-submit] blast_form refused=${first}`);
      return { status: KNOWN[first], body: { ok: false, error: first } };
    }
    deps.log("[brand-form-submit] blast_form server_error");
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  const body: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const ticket = await issueBotTicket(req.formId, req.campaignId, deps.botTicketKey);
  if (ticket !== null) body.botTicket = ticket;
  return { status: 200, body };
}
