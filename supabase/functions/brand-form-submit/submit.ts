// #4514 brand-form-submit: the logic (BUILD CONTRACT v2 §3.7, §3.8; C2, C8).
// index.ts wires the runtime.
//
// Order of operations (each step names its failure response):
//   1 origin (403; native apps send no Origin) · 2 method (405) · 3 body ≤ 32 KB (413)
//   · 4 JSON shape (400 bad_request) · 5 the database off switch (503 forms_paused)
//   · 6 rate limit per salted IP hash, 20 / 10 min and 100 / 24 h over all forms
//   (429, nothing written) · 7 who: a personal link token, else a signed-in user
//   (401 sign_in_required) · 8 brand_form_submit_core (SQL) · 9 response.
//
// Logs carry the outcome and the form id only: never a token, an answer or a contact.

import {
  BRAND_FORM_ERROR_STATUS,
  BRAND_FORM_MAX_BODY_BYTES,
  BRAND_FORM_PER_IP_10MIN,
  BRAND_FORM_PER_IP_24H,
  type BrandFormSubmitError,
  type BrandFormSubmitErrorCode,
  type BrandFormSubmitSuccess,
  coreErrorCode,
  corePayload,
  parseSubmitRequest,
} from "../_shared/brandFormsContract.ts";

/** Domain-separated from the forms-submit limiter; the raw IP is never stored. */
export const IP_SALT = "mingla-brand-forms";

const PRODUCTION_ORIGIN = "https://host.usemingla.com";
const PREVIEW_ORIGIN = /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/;

export interface CoreError {
  message: string;
  details?: string | null;
}

export interface BrandFormSubmitDb {
  switchedOff(): Promise<boolean>;
  countAttempts(ipHash: string): Promise<{ ip10m: number; ip24h: number }>;
  recordAttempt(
    ipHash: string,
    formId: string | null,
    outcome: "accepted" | "rejected" | "rate_limited" | "paused",
  ): Promise<void>;
  /** The signed-in user behind a bearer token, or null (anon key, expired, absent). */
  userFromBearer(jwt: string): Promise<string | null>;
  submitCore(
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> | null; error: CoreError | null }>;
}

export interface BrandFormSubmitDeps {
  db: BrandFormSubmitDb;
  log?: (line: string) => void;
}

export function corsFor(origin: string | null): Record<string, string> | null {
  const base = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin === null) return base; // native apps
  if (
    origin === PRODUCTION_ORIGIN || PREVIEW_ORIGIN.test(origin) ||
    LOCAL_ORIGIN.test(origin)
  ) {
    return { ...base, "Access-Control-Allow-Origin": origin };
  }
  return null;
}

export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`brand-forms:${ip}${IP_SALT}`),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function json(
  body: BrandFormSubmitSuccess | BrandFormSubmitError,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(
  code: BrandFormSubmitErrorCode,
  cors: Record<string, string>,
  extra: Partial<BrandFormSubmitError> = {},
): Response {
  return json(
    { ok: false, error: code, ...extra },
    BRAND_FORM_ERROR_STATUS[code],
    cors,
  );
}

function parseDetail(details: string | null | undefined): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

function bearerOf(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
}

export async function handleBrandFormSubmit(
  req: Request,
  deps: BrandFormSubmitDeps,
): Promise<Response> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const cors = corsFor(req.headers.get("origin"));
  if (!cors) {
    return new Response(JSON.stringify({ ok: false, error: "origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") return fail("method", cors);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BRAND_FORM_MAX_BODY_BYTES) {
    return fail("too_large", cors);
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return fail("bad_request", cors);
  }
  if (new TextEncoder().encode(text).length > BRAND_FORM_MAX_BODY_BYTES) {
    return fail("too_large", cors);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("bad_request", cors);
  }
  const body = parseSubmitRequest(raw);
  if (!body) return fail("bad_request", cors);

  try {
    const ipHash = await hashIp(clientIp(req));
    // C8: the emergency off switch lives in the database.
    if (await deps.db.switchedOff()) {
      await deps.db.recordAttempt(ipHash, body.formId, "paused");
      log(`[brand-form-submit] paused form=${body.formId}`);
      return fail("forms_paused", cors);
    }
    const counts = await deps.db.countAttempts(ipHash);
    if (
      counts.ip10m >= BRAND_FORM_PER_IP_10MIN ||
      counts.ip24h >= BRAND_FORM_PER_IP_24H
    ) {
      await deps.db.recordAttempt(ipHash, body.formId, "rate_limited");
      log(`[brand-form-submit] rate_limited form=${body.formId}`);
      return fail("rate_limited", cors);
    }

    let userId: string | null = null;
    if (!body.token) {
      const jwt = bearerOf(req);
      userId = jwt ? await deps.db.userFromBearer(jwt) : null;
    }
    const payload = corePayload(body, userId);
    if (!payload) {
      await deps.db.recordAttempt(ipHash, body.formId, "rejected");
      return fail("sign_in_required", cors);
    }

    const { data, error } = await deps.db.submitCore(payload);
    if (error) {
      const code = coreErrorCode(error.message);
      await deps.db.recordAttempt(ipHash, body.formId, "rejected");
      log(`[brand-form-submit] refused code=${code} form=${body.formId}`);
      const detail = parseDetail(error.details);
      const extra: Partial<BrandFormSubmitError> = {};
      if (code === "form_answers_invalid" && Array.isArray(detail)) {
        extra.errors = detail as BrandFormSubmitError["errors"];
      }
      if (code === "form_changed" && detail && typeof detail === "object") {
        const v = (detail as Record<string, unknown>).versionId;
        if (typeof v === "string") extra.versionId = v;
      }
      if (code === "response_stale" && detail && typeof detail === "object") {
        const n = (detail as Record<string, unknown>).editCount;
        if (typeof n === "number") extra.editCount = n;
      }
      return fail(code, cors, extra);
    }
    if (!data || typeof data.responseId !== "string") {
      log(`[brand-form-submit] core_shape form=${body.formId}`);
      return fail("server_error", cors);
    }
    await deps.db.recordAttempt(ipHash, body.formId, "accepted");
    log(
      `[brand-form-submit] accepted form=${body.formId} created=${
        String(data.created)
      }`,
    );
    return json(
      {
        ok: true,
        responseId: data.responseId,
        editCount: Number(data.editCount ?? 0),
        versionId: String(data.versionId ?? ""),
        created: data.created === true,
      },
      200,
      cors,
    );
  } catch (e) {
    log(
      `[brand-form-submit] server_error form=${body.formId} ${
        e instanceof Error ? e.name : "unknown"
      }`,
    );
    return fail("server_error", cors);
  }
}
