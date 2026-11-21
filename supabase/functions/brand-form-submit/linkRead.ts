// #4514: the guest link page's read (`/form/{formId}#t=…`), through this edge
// function so that no brand forms SECURITY DEFINER function is executable by
// anon. brand_form_my_response is granted to authenticated and service_role
// only; the link page is anonymous, so it reads here with the service role.
//
//   {op:"link_read", formId, token, challengeId?}
//     → 200 {ok:true, read:<brand_form_my_response payload>}
//     → 403 {ok:false, error:"link_invalid"|"link_revoked"}
//     → 404 {ok:false, error:"form_not_found"}
//     → 400 bad_request · 500 server_error
//
// The SQL decides everything (the personal token is the only key; an existing
// answer, or a lapsed link, needs a one-time code grant). This module never
// passes a user id: the token path is the only path it can reach. The token
// arrives in the POST body only and is never logged.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The same personal-link token shape the code ops accept (./code.ts).
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** The refusals the SQL names, and the status each one is answered with. */
const REFUSALS: Record<string, number> = {
  link_invalid: 403,
  link_revoked: 403,
  form_not_found: 404,
};

export interface LinkReadRequest {
  op: "link_read";
  formId: string;
  token: string;
  challengeId: string | null;
}

export interface LinkReadDeps {
  myResponse(
    formId: string,
    token: string,
    challengeId: string | null,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  log: (line: string) => void;
}

export function isLinkReadOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).op === "link_read";
}

export function parseLinkReadRequest(raw: unknown): LinkReadRequest | null {
  if (!isLinkReadOp(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).some((k) =>
      !["op", "formId", "token", "challengeId"].includes(k)
    )
  ) return null;
  if (typeof r.formId !== "string" || !UUID_RE.test(r.formId)) return null;
  if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
  const ch = r.challengeId;
  if (ch !== undefined && ch !== null) {
    if (typeof ch !== "string" || !UUID_RE.test(ch)) return null;
  }
  return {
    op: "link_read",
    formId: r.formId.toLowerCase(),
    token: r.token,
    challengeId: typeof ch === "string" ? ch.toLowerCase() : null,
  };
}

/** The SQL refusal code at the start of a PostgREST message, or null. */
export function refusalOf(message: string): string | null {
  const code = message.trim().split(/[\s:]/)[0] ?? "";
  return Object.hasOwn(REFUSALS, code) ? code : null;
}

export async function handleLinkRead(
  req: LinkReadRequest,
  deps: LinkReadDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await deps.myResponse(
    req.formId,
    req.token,
    req.challengeId,
  );
  if (error) {
    const code = refusalOf(error.message);
    if (code !== null) {
      deps.log(
        `[brand-form-submit] link_read refused code=${code} form=${req.formId}`,
      );
      return { status: REFUSALS[code], body: { ok: false, error: code } };
    }
    deps.log(`[brand-form-submit] link_read server_error form=${req.formId}`);
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    deps.log(`[brand-form-submit] link_read shape form=${req.formId}`);
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  return { status: 200, body: { ok: true, read: data } };
}
