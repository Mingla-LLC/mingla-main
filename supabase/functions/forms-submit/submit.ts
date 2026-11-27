// #4452 forms-submit: the logic (spec Part 4 §3, A1.3; §8 track). index.ts wires the runtime.
//
// Order of operations (each step names its failure response):
//   1 kill switch (503 paused) · 2 body JSON ≤ 32 KB (400) · 3 bots: honeypot or
//   a too-fast fill → 200 fake success, nothing saved · 4 rate limit by salted
//   IP hash (5 / 10 min / form, 30 / 24 h) → 429 · 5 idempotency (SQL) ·
//   6 the live form (410 form_closed; unknown keys → 409 form_changed) ·
//   7 validation with the shared contract (400 with the client's own messages) ·
//   8 consent (only a real `true`) and ads choice · 9 24 h dedupe and 10 the
//   optional card (forms_submit_core, SQL) · 12 the labelled Lead (§4) ·
//   13 the automation run (SQL) and an instant confirmation · 14 response.
//
// Logs carry the outcome, the form key and the submission id only: never an
// email, a phone or an answer.
//
// Invariant I-4452-CONSENT-ONLY-TRUE (declared in its test): marketing_consent is true only for a JSON boolean true (submit tests T-3.10).

import {
  type AnswerResult,
  answersBytes,
  emailTypoFix,
  errorMessage,
  type FormDefinition,
  PLACEMENTS,
  validateAnswers,
} from "../_shared/formsContract.ts";
import {
  boundedPageUrl,
  type HostAdContext,
  parseHostAdContext,
  recordLabelledLead,
} from "../_shared/hostFunnelConversion.ts";
import type { FireAdConversionDeps } from "../_shared/adConversionFire.ts";

/** Same salt as the growth-tools limiter (growth-tools-run IP_SALT), domain-separated. */
export const IP_SALT = "mingla-tools";
export const MAX_BODY_BYTES = 32 * 1024;
/** A person cannot read and fill a form faster than this (kept in code, not published). */
export const MIN_FILL_MS = 2500;
export const PER_FORM_10MIN = 5;
export const PER_IP_24H = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ORIGIN_RE =
  /^https:\/\/mingla-marketing-[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/;
const ALLOWED_ORIGINS = new Set([
  "https://usemingla.com",
  "https://www.usemingla.com",
]);
const CLICK_SOURCES = ["meta", "google", "tiktok", "snap", "reddit"] as const;
const TRACK_EVENTS = new Set([
  "popup_shown",
  "form_viewed",
  "form_started",
  "form_step",
  "form_error",
  "popup_closed",
  "success_viewed",
  "next_step",
]);

export interface LiveForm {
  id: string;
  key: string;
  audience: "host" | "creator" | "local";
  status: "draft" | "live" | "archived";
  template: string | null;
  version: number | null;
  definition: FormDefinition | null;
}

export interface SubmitDb {
  loadForm(formId: string): Promise<LiveForm | null>;
  countAttempts(
    ipHash: string,
    formId: string,
  ): Promise<{ form10m: number; ip24h: number }>;
  recordAttempt(
    ipHash: string,
    formId: string | null,
    outcome: string,
  ): Promise<void>;
  submitCore(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  setLeadEvent(submissionId: string, eventId: string): Promise<void>;
  trackEvent(payload: Record<string, unknown>): Promise<void>;
  /** #4640: return a random short-lived bearer; only its SHA-256 is stored. */
  mintHandoff?(
    submissionId: string,
    schedulerKey: string,
    payload: Record<string, unknown>,
  ): Promise<string | null>;
  /** The SupabaseClient recordLabelledLead writes through (ad_match_contexts, ad_conversions). */
  // deno-lint-ignore no-explicit-any
  adClient: any;
}

export interface SubmitDeps {
  db: SubmitDb;
  env: (name: string) => string | undefined;
  fire?: FireAdConversionDeps;
  /** Fire the instant confirmation for one run (POST forms-automation-sender {run_id}). */
  kickSender?: (runId: string) => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: () => number;
  log?: (line: string) => void;
}

async function mintBookingHandoff(
  deps: SubmitDeps,
  form: LiveForm,
  submissionId: string,
  values: Record<string, unknown>,
  result: AnswerResult,
): Promise<
  { required: boolean; token: string | null; schedulerKey: string | null }
> {
  const after = form.definition?.after_submit;
  if (after?.action !== "book_call") {
    return { required: false, token: null, schedulerKey: null };
  }
  if (!deps.db.mintHandoff) {
    return { required: true, token: null, schedulerKey: after.scheduler_key };
  }
  try {
    const token = await deps.db.mintHandoff(
      submissionId,
      after.scheduler_key,
      bookingHandoffPayload(form, values, result),
    );
    return { required: true, token, schedulerKey: after.scheduler_key };
  } catch {
    deps.log?.(
      `[forms-submit] handoff_failed form=${form.key} sub=${submissionId}`,
    );
    return { required: true, token: null, schedulerKey: after.scheduler_key };
  }
}

/**
 * #4452 rework 1 (P2-11): funnel tracking per salted IP hash, per instance (the
 * same in-memory sliding window as self-serve-unsubscribe). A page sends a
 * handful of events per visit; 60 a minute is far above a real visitor.
 * forms_track_event also caps each visit at 200 rows a day.
 */
export const TRACK_PER_IP_MINUTE = 60;
const TRACK_WINDOW_MS = 60_000;
const trackBuckets = new Map<string, number[]>();

export function trackLimited(ipHash: string, nowMs: number): boolean {
  const hits = (trackBuckets.get(ipHash) ?? []).filter((t) =>
    t > nowMs - TRACK_WINDOW_MS
  );
  if (hits.length >= TRACK_PER_IP_MINUTE) {
    trackBuckets.set(ipHash, hits);
    return true;
  }
  hits.push(nowMs);
  trackBuckets.set(ipHash, hits);
  if (trackBuckets.size > 10_000) {
    for (const [k, v] of trackBuckets) {
      if (!v.some((t) => t > nowMs - TRACK_WINDOW_MS)) trackBuckets.delete(k);
    }
  }
  return false;
}

/** Test seam: forget every bucket. */
export function resetTrackLimiter(): void {
  trackBuckets.clear();
}

export function corsFor(origin: string | null): Record<string, string> | null {
  if (!origin || !(ALLOWED_ORIGINS.has(origin) || ORIGIN_RE.test(origin))) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`forms:${ip}${IP_SALT}`),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** The visitor's local date for R-17 (YYYY-MM-DD), or UTC. */
export function localToday(nowMs: number, tz: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date(nowMs));
    return /^\d{4}-\d{2}-\d{2}$/.test(parts)
      ? parts
      : new Date(nowMs).toISOString().slice(0, 10);
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

export function validZone(tz: unknown): string | null {
  if (
    typeof tz !== "string" || tz.length > 64 ||
    !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)
  ) return null;
  try {
    const supported =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
        .supportedValuesOf?.("timeZone");
    if (supported && !supported.includes(tz) && tz !== "UTC") return null;
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function bounded(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function utmOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const limits: Record<string, number> = {
    source: 100,
    medium: 100,
    campaign: 150,
    content: 150,
    term: 150,
    id: 100,
  };
  for (const [k, max] of Object.entries(limits)) {
    const v = bounded(r[k], max);
    if (v) out[k] = v;
  }
  return out;
}

function clickSourceOf(
  ad: Record<string, unknown> | null,
  utm: Record<string, string>,
): string | null {
  const c = ad?.click_source;
  if (
    typeof c === "string" && (CLICK_SOURCES as readonly string[]).includes(c)
  ) return c;
  const s = (utm.source ?? "").toLowerCase();
  if (
    s.includes("facebook") || s.includes("instagram") || s === "meta" ||
    s === "fb" || s === "ig"
  ) return "meta";
  if (s.includes("google")) return "google";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("snap")) return "snap";
  if (s.includes("reddit")) return "reddit";
  return null;
}

function json(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function randomUuid(): string {
  return crypto.randomUUID();
}

const ICP_FROM_WORDS: Record<string, string> = {
  events: "events",
  trips: "trips",
  "experiences or classes": "experiences",
  "a restaurant, café or diner": "restaurants",
  "a restaurant, cafe or diner": "restaurants",
  "a hotel or resort": "hotels",
  "a gallery, museum or art space": "art",
  "a play space, bowling or arcade": "play",
  "something else": "other",
};

function socialParts(
  value: unknown,
): { social_platform?: string; social_handle?: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return typeof v.platform === "string" && typeof v.url === "string"
      ? { social_platform: v.platform, social_handle: v.url }
      : {};
  }
  if (typeof value !== "string") return {};
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
    const platform = host === "instagram.com"
      ? "instagram"
      : host === "tiktok.com"
      ? "tiktok"
      : host === "facebook.com" || host === "fb.com"
      ? "facebook"
      : host === "x.com" || host === "twitter.com"
      ? "x"
      : host === "youtube.com"
      ? "youtube"
      : host === "linkedin.com"
      ? "linkedin"
      : null;
    return platform ? { social_platform: platform, social_handle: value } : {};
  } catch {
    return {};
  }
}

/** A small, audience-aware booking payload made only from validated values. */
export function bookingHandoffPayload(
  form: LiveForm,
  values: Record<string, unknown>,
  result: {
    name: string | null;
    email: string | null;
    phone_e164: string | null;
  },
): Record<string, unknown> {
  const fields = form.definition?.fields ?? [];
  const byType = (type: string) => fields.find((f) => f.type === type);
  const byWords = (re: RegExp) =>
    fields.find((f) => re.test(`${f.key} ${f.label}`));
  const get = (field: { key: string } | undefined) =>
    field ? values[field.key] : undefined;
  const social = socialParts(get(byType("social")));
  const payload: Record<string, unknown> = {
    audience: form.audience,
    name: result.name,
    email: result.email,
    phone: result.phone_e164,
    ...social,
  };
  if (form.audience === "host") {
    const rawIcp = get(byWords(/(^|\s)(icp|what do you run|run\?)/i));
    const icp = typeof rawIcp === "string"
      ? ICP_FROM_WORDS[rawIcp.trim().toLowerCase()] ??
        rawIcp.trim().toLowerCase()
      : null;
    payload.icp = icp;
    payload.venue = get(
      byWords(/venue|place.*called|event.*called|brand.*name/i),
    );
    payload.website = get(byWords(/website|web address/i));
  } else {
    const city = get(
      fields.find((f) =>
        f.type === "dropdown" &&
        (f.source === "google_city" || /city/i.test(f.key))
      ),
    );
    payload.city = typeof city === "string"
      ? city
      : city && typeof city === "object"
      ? (city as Record<string, unknown>).city ??
        (city as Record<string, unknown>).label
      : null;
    if (form.audience === "creator") payload.makes = get(byWords(/make/i));
    else payload.first_place = get(byWords(/first.*place|place.*review/i));
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) =>
      v !== null && v !== undefined && v !== ""
    ),
  );
}

/** The SQL error code inside a PostgREST error message ('form_closed', 'validation', …). */
function sqlCode(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err ?? "");
  return m.split(/[\s:]/)[0] ?? "";
}

export async function handleFormsRequest(
  req: Request,
  deps: SubmitDeps,
): Promise<Response> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const cors = corsFor(req.headers.get("origin"));
  if (!cors) {
    return new Response(JSON.stringify({ error: "origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405, cors);
  // #4452 rework 1 (P0-4): nothing below may escape as a bare, CORS-less 500.
  // Malformed input is refused as 400 where it is read; this net only catches
  // a defect we did not foresee, and still answers in the spec's shape.
  try {
    return await handlePost(req, deps, cors, log);
  } catch (err) {
    log(
      `[forms-submit] server_error unhandled=${
        err instanceof Error ? err.name : "unknown"
      }`,
    );
    return json({ error: "server" }, 500, cors);
  }
}

async function handlePost(
  req: Request,
  deps: SubmitDeps,
  cors: Record<string, string>,
  log: (line: string) => void,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  // 2. Body.
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "validation" }, 400, cors);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "validation" }, 400, cors);
  }

  if (body.action !== "track" && body.action !== "submit") {
    return json({ error: "validation" }, 400, cors);
  }

  // 1. Kill switch (after CORS so the page can read the answer; nothing is written).
  // It stops funnel tracking too (#4452 rework 1, P2-11).
  if (deps.env("FORMS_KILL_SWITCH") === "1") {
    return json({ error: "paused" }, 503, cors);
  }
  if (body.action === "track") {
    const trackIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    if (trackLimited(await hashIp(trackIp), now())) {
      return json({ error: "rate_limited" }, 429, cors);
    }
    return await handleTrack(body, deps, cors);
  }

  const formId = typeof body.form_id === "string" && UUID_RE.test(body.form_id)
    ? body.form_id
    : null;
  const key = typeof body.idempotency_key === "string" &&
      UUID4_RE.test(body.idempotency_key)
    ? body.idempotency_key
    : null;
  const placement = typeof body.placement === "string" &&
      (PLACEMENTS as readonly string[]).includes(body.placement)
    ? body.placement
    : null;
  if (!formId || !key || !placement) {
    return json({ error: "validation" }, 400, cors);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const ipHash = await hashIp(ip);

  // 3. Bots see success; nothing is saved.
  const tOpen = body.t_open_ms;
  const honey = typeof body.hp === "string" ? body.hp : "";
  if (
    honey !== "" || typeof tOpen !== "number" || !Number.isFinite(tOpen) ||
    tOpen < MIN_FILL_MS
  ) {
    await deps.db.recordAttempt(ipHash, formId, "bot");
    log(`[forms-submit] bot form=${formId}`);
    return json(
      {
        ok: true,
        submission_id: randomUuid(),
        lead_event_id: null,
        deduped: false,
      },
      200,
      cors,
    );
  }

  // 4. Rate limit.
  const counts = await deps.db.countAttempts(ipHash, formId);
  if (counts.form10m >= PER_FORM_10MIN || counts.ip24h >= PER_IP_24H) {
    await deps.db.recordAttempt(ipHash, formId, "rate_limited");
    log(`[forms-submit] rate_limited form=${formId}`);
    return json({ error: "rate_limited" }, 429, cors);
  }

  // 6. The live form.
  const form = await deps.db.loadForm(formId);
  if (!form || form.status !== "live" || !form.definition) {
    await deps.db.recordAttempt(ipHash, formId, "rejected");
    return json({ error: "form_closed" }, 410, cors);
  }

  // 7. Validation with the shared contract (the page's own rules and messages).
  // Answers must be a plain JSON object: null, an array, a string or a number is
  // a malformed request (400), never a crash (#4452 rework 1, P0-4).
  if (
    !body.answers || typeof body.answers !== "object" ||
    Array.isArray(body.answers)
  ) {
    await deps.db.recordAttempt(ipHash, formId, "rejected");
    return json({ error: "validation" }, 400, cors);
  }
  const answers = body.answers as Record<string, unknown>;
  const zone = validZone(body.time_zone);
  const today = localToday(now(), zone);
  const result = validateAnswers(form.definition, answers, today);
  if (!result.ok) {
    await deps.db.recordAttempt(ipHash, formId, "rejected");
    if (result.errors.some((e) => e.code === "unknown_field")) {
      log(`[forms-submit] form_changed form=${form.key}`);
      return json({ error: "form_changed", version: form.version }, 409, cors);
    }
    const types = new Map(form.definition.fields.map((f) => [f.key, f.type]));
    return json(
      {
        error: "validation",
        fields: result.errors.map((e) => {
          const raw = Object.prototype.hasOwnProperty.call(answers, e.key)
            ? answers[e.key]
            : undefined;
          const fix = e.code === "typo" && typeof raw === "string"
            ? emailTypoFix(raw)
            : null;
          return {
            key: e.key,
            code: e.code,
            message: errorMessage(
              types.get(e.key) ?? null,
              e.code,
              fix ? fix.slice(fix.lastIndexOf("@") + 1) : undefined,
            ),
            ...(fix ? { suggestion: fix } : {}),
          };
        }),
      },
      400,
      cors,
    );
  }
  if (answersBytes(answers) > 16384 || !result.email) {
    return json({ error: "validation" }, 400, cors);
  }

  // 8. Consent and the ads choice.
  const consentField = form.definition.fields.find((f) => f.type === "consent");
  const adRaw =
    body.ad && typeof body.ad === "object" && !Array.isArray(body.ad)
      ? body.ad as Record<string, unknown>
      : null;
  const adsAllowed = !(adRaw?.tracking_opt_out === true) && adRaw !== null;
  const ad: HostAdContext | null = adRaw
    ? parseHostAdContext(adRaw, req)
    : null;
  const pageUrl = boundedPageUrl(body.page_url);
  const pagePath = pageUrl ? new URL(pageUrl).pathname.slice(0, 300) : "/";
  const utm = utmOf(body.utm);
  let referrerHost: string | null = null;
  try {
    referrerHost = typeof body.referrer === "string"
      ? new URL(body.referrer).hostname.slice(0, 253)
      : null;
  } catch {
    referrerHost = null;
  }

  // 9–10, 13. The SQL core (dedupe, optional card, run).
  let core: Record<string, unknown>;
  try {
    core = await deps.db.submitCore({
      idempotency_key: key,
      form_id: formId,
      email: result.email,
      answers,
      today,
      consent: result.consent === true,
      consent_text: result.consent && consentField
        ? consentField.label.slice(0, 300)
        : null,
      time_zone: zone,
      time_zone_source: zone ? "browser" : "fallback_utc",
      page_path: pagePath,
      placement,
      spot_key: bounded(body.spot_key, 48),
      block_id: typeof body.block_id === "string" && UUID_RE.test(body.block_id)
        ? body.block_id
        : null,
      utm,
      click_source: adsAllowed ? clickSourceOf(adRaw, utm) : null,
      referrer_host: referrerHost,
      ads_allowed: adsAllowed,
    });
  } catch (err) {
    const code = sqlCode(err);
    if (code === "form_closed") {
      return json({ error: "form_closed" }, 410, cors);
    }
    if (code === "validation") return json({ error: "validation" }, 400, cors);
    log(`[forms-submit] server_error form=${form.key}`);
    return json({ error: "server" }, 500, cors);
  }

  const submissionId = String(core.submission_id);
  if (core.replay === true) {
    const handoff = await mintBookingHandoff(
      deps,
      form,
      submissionId,
      result.values,
      result,
    );
    if (handoff.required && !handoff.token) {
      return json({ error: "server" }, 500, cors);
    }
    log(`[forms-submit] replay form=${form.key} sub=${submissionId}`);
    return json(
      {
        ok: true,
        submission_id: submissionId,
        lead_event_id: core.lead_event_id ?? null,
        deduped: core.deduped === true,
        ...(handoff.token
          ? {
            handoff_token: handoff.token,
            scheduler_key: handoff.schedulerKey,
          }
          : {}),
      },
      200,
      cors,
    );
  }
  const deduped = core.deduped === true;
  await deps.db.recordAttempt(ipHash, formId, deduped ? "deduped" : "accepted");

  // 12. The labelled Lead (new submissions only, never the Book-a-call extra questions).
  let leadEventId: string | null = typeof core.lead_event_id === "string"
    ? core.lead_event_id
    : null;
  if (!deduped && core.lead_on === true && placement !== "book_call_details") {
    leadEventId = await recordLabelledLead(deps.db.adClient, {
      label: form.audience,
      subjectId: `form:${submissionId}`,
      ad,
      source: form.key,
      // #4452 B20: a test or internal person (inbound_lead_is_test) sends no Lead; the id stays null.
      contact: { email: result.email, name: result.name },
    }, deps.fire ?? {});
    if (leadEventId) await deps.db.setLeadEvent(submissionId, leadEventId);
  }

  // 13. The welcome in seconds, not minutes.
  if (typeof core.run_id === "string" && deps.kickSender) {
    const kick = deps.kickSender(core.run_id).catch(() =>
      log(`[forms-submit] sender_kick_failed sub=${submissionId}`)
    );
    if (deps.waitUntil) deps.waitUntil(kick);
    else await kick;
  }

  log(
    `[forms-submit] ${
      deduped ? "deduped" : "accepted"
    } form=${form.key} sub=${submissionId}`,
  );
  const handoff = await mintBookingHandoff(
    deps,
    form,
    submissionId,
    result.values,
    result,
  );
  if (handoff.required && !handoff.token) {
    return json({ error: "server" }, 500, cors);
  }
  return json(
    {
      ok: true,
      submission_id: submissionId,
      lead_event_id: leadEventId,
      deduped,
      goal: typeof core.goal === "string" ? core.goal : "none",
      ...(handoff.token
        ? {
          handoff_token: handoff.token,
          scheduler_key: handoff.schedulerKey,
        }
        : {}),
    },
    200,
    cors,
  );
}

/** §8: funnel events (the page sends them only with the analytics choice on). */
async function handleTrack(
  body: Record<string, unknown>,
  deps: SubmitDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const event = typeof body.event === "string" && TRACK_EVENTS.has(body.event)
    ? body.event
    : null;
  const formId = typeof body.form_id === "string" && UUID_RE.test(body.form_id)
    ? body.form_id
    : null;
  const visitId =
    typeof body.visit_id === "string" && UUID_RE.test(body.visit_id)
      ? body.visit_id
      : null;
  const placement = typeof body.placement === "string" &&
      (PLACEMENTS as readonly string[]).includes(body.placement)
    ? body.placement
    : null;
  if (!event || !formId || !visitId || !placement) {
    return json({ error: "validation" }, 400, cors);
  }
  // Properties: short scalars only; anything that looks like an email or a phone is dropped.
  const props: Record<string, string | number | boolean> = {};
  if (
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
  ) {
    for (
      const [k, v] of Object.entries(body.props as Record<string, unknown>)
        .slice(0, 12)
    ) {
      if (!/^[a-z_]{1,32}$/.test(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) props[k] = v;
      else if (typeof v === "boolean") props[k] = v;
      else if (
        typeof v === "string" && v.length <= 80 && !v.includes("@") &&
        !/\d{7,}/.test(v)
      ) props[k] = v;
    }
  }
  const pageUrl = boundedPageUrl(body.page_url);
  try {
    await deps.db.trackEvent({
      form_id: formId,
      event,
      visit_id: visitId,
      placement,
      page_path: pageUrl ? new URL(pageUrl).pathname.slice(0, 300) : "/",
      step: typeof body.step === "number" && Number.isInteger(body.step) &&
          body.step >= 0 && body.step < 100
        ? body.step
        : null,
      props,
      utm_campaign: bounded(body.utm_campaign, 150),
      click_source: typeof body.click_source === "string" &&
          (CLICK_SOURCES as readonly string[]).includes(body.click_source)
        ? body.click_source
        : null,
    });
  } catch {
    // Analytics never fails the page.
  }
  return json({ ok: true }, 200, cors);
}
