// #4514 brand-form-submit: the logic (BUILD CONTRACT v2 §3.7, §3.8; C2, C8).
// index.ts wires the runtime.
//
// Order of operations (each step names its failure response):
//   1 origin (403; native apps send no Origin) · 2 method (405) · 3 body ≤ 32 KB (413)
//   · 4 JSON shape (400 bad_request) · 5 the database off switch (503 forms_paused)
//   · 6 rate limit per salted IP hash, 20 / 10 min and 100 / 24 h over all forms
//   (429, nothing written) · 7 who: a personal link token, else a signed-in user
//   (401 sign_in_required) · 8 answers the database cannot store (NUL, a lone
//   surrogate, nested values: 422 form_answers_invalid) · 9 brand_form_submit_core
//   (SQL; a data exception it raises is 422 form_answers_invalid, never 500)
//   · 10 response.
//
// The client address is read exactly as forms-submit reads it (the first
// x-forwarded-for hop). Its salt is not a constant in the repo: it is derived from
// the platform's service-role key with the shared #3201 derivation
// (_shared/derivedSecret.ts), so no new secret or env var exists.
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
  unstorableAnswerErrors,
} from "../_shared/brandFormsContract.ts";
import {
  deriveScopedSecret,
  type ScopedSecretRootEnv,
} from "../_shared/derivedSecret.ts";
import {
  type CodeDeps,
  handleCodeRequest,
  isCodeOp,
  parseCodeRequest,
} from "./code.ts";
import {
  handlePurchaseLink,
  isPurchaseLinkOp,
  parsePurchaseLinkRequest,
  type PurchaseLinkDeps,
} from "./purchaseLink.ts";
import {
  type CheckoutFormDeps,
  handleCheckoutForm,
  isCheckoutFormOp,
  parseCheckoutFormRequest,
} from "./checkoutForm.ts";
import {
  handleLinkRead,
  isLinkReadOp,
  type LinkReadDeps,
  parseLinkReadRequest,
} from "./linkRead.ts";

/** The derivation label for this limiter's salt (one label per purpose, #3201). */
export const IP_SALT_LABEL = "brand-form-submit-ip-salt";

/** The address-hash salt: derived from the platform service-role key, never stored. */
export function defaultIpSalt(env?: ScopedSecretRootEnv): Promise<string> {
  return deriveScopedSecret(IP_SALT_LABEL, env);
}

const PRODUCTION_ORIGIN = "https://host.usemingla.com";
const PREVIEW_ORIGIN = /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/;

export interface CoreError {
  message: string;
  details?: string | null;
  /** The SQLSTATE PostgREST reports (for example 22008). */
  code?: string | null;
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
  /** The address-hash salt; defaults to the service-role-derived one. */
  ipSalt?: () => Promise<string>;
  /** Wave 3: the link page's one-time code actions (./code.ts). */
  code?: CodeDeps;
  /** Wave 5: the after-purchase link for the buyer's own order (./purchaseLink.ts). */
  purchase?: Pick<PurchaseLinkDeps, "purchaseLink">;
  /** Wave 5 review fix 1: the checkout's form read (./checkoutForm.ts). */
  checkout?: Pick<CheckoutFormDeps, "checkoutForm" | "hashTicketLink">;
  /** The link page's read, so brand_form_my_response is never anon-executable (./linkRead.ts). */
  linkRead?: Pick<LinkReadDeps, "myResponse">;
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

export async function hashIp(ip: string, salt: string): Promise<string> {
  if (!salt) throw new Error("ip_salt_unavailable");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`brand-forms:${ip}${salt}`),
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

/** The same read as forms-submit: the first x-forwarded-for hop, else "unknown". */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
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
  // Wave 5: {op:"purchase_link"} is the buyer success screen asking for the
  // after-purchase form link of its own order (./purchaseLink.ts).
  if (isPurchaseLinkOp(raw)) {
    const linkReq = parsePurchaseLinkRequest(raw);
    if (!linkReq || !deps.purchase) return fail("bad_request", cors);
    try {
      if (await deps.db.switchedOff()) return fail("forms_paused", cors);
      const result = await handlePurchaseLink(linkReq, {
        log,
        ...deps.purchase,
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      log(
        `[brand-form-submit] purchase_link server_error ${
          e instanceof Error ? e.name : "unknown"
        }`,
      );
      return fail("server_error", cors);
    }
  }
  // Wave 5 review fix 1: {op:"checkout_form"} is the buyer checkout reading the
  // page's form with the credential it presents to checkout (./checkoutForm.ts).
  if (isCheckoutFormOp(raw)) {
    const formReq = parseCheckoutFormRequest(raw);
    if (!formReq || !deps.checkout) return fail("bad_request", cors);
    try {
      const jwt = bearerOf(req);
      const userId = jwt ? await deps.db.userFromBearer(jwt) : null;
      const result = await handleCheckoutForm(formReq, userId, {
        log,
        ...deps.checkout,
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      log(
        `[brand-form-submit] checkout_form server_error ${
          e instanceof Error ? e.name : "unknown"
        }`,
      );
      return fail("server_error", cors);
    }
  }
  // {op:"link_read"} is the link page reading its form with the personal token
  // (./linkRead.ts): the read is service-role only, never anon PostgREST.
  if (isLinkReadOp(raw)) {
    const readReq = parseLinkReadRequest(raw);
    if (!readReq || !deps.linkRead) return fail("bad_request", cors);
    try {
      const result = await handleLinkRead(readReq, { log, ...deps.linkRead });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      log(
        `[brand-form-submit] link_read server_error ${
          e instanceof Error ? e.name : "unknown"
        }`,
      );
      return fail("server_error", cors);
    }
  }
  // Wave 3: {op:"code_begin"|"code_verify"} are the link page's one-time code
  // actions (./code.ts); every other body is an answer submit.
  if (isCodeOp(raw)) {
    const codeReq = parseCodeRequest(raw);
    if (!codeReq || !deps.code) return fail("bad_request", cors);
    try {
      if (await deps.db.switchedOff()) return fail("forms_paused", cors);
      const salt = await (deps.ipSalt ?? (() => defaultIpSalt()))();
      const ipHash = await hashIp(clientIp(req), salt);
      const result = await handleCodeRequest(codeReq, ipHash, {
        log,
        ...deps.code,
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      log(
        `[brand-form-submit] code server_error ${
          e instanceof Error ? e.name : "unknown"
        }`,
      );
      return fail("server_error", cors);
    }
  }
  const body = parseSubmitRequest(raw);
  if (!body) return fail("bad_request", cors);

  try {
    const salt = await (deps.ipSalt ?? (() => defaultIpSalt()))();
    const ipHash = await hashIp(clientIp(req), salt);
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
    const unstorable = unstorableAnswerErrors(body.answers);
    if (unstorable.length > 0) {
      await deps.db.recordAttempt(ipHash, body.formId, "rejected");
      log(
        `[brand-form-submit] refused code=form_answers_invalid form=${body.formId}`,
      );
      return fail("form_answers_invalid", cors, { errors: unstorable });
    }

    const { data, error } = await deps.db.submitCore(payload);
    if (error) {
      const code = coreErrorCode(error.message, error.code);
      await deps.db.recordAttempt(ipHash, body.formId, "rejected");
      log(`[brand-form-submit] refused code=${code} form=${body.formId}`);
      const detail = parseDetail(error.details);
      const extra: Partial<BrandFormSubmitError> = {};
      if (code === "form_answers_invalid") {
        extra.errors = Array.isArray(detail)
          ? detail as BrandFormSubmitError["errors"]
          : [{ questionId: null, code: "type" }];
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
