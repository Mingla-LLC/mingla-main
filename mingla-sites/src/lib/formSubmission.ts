import { NextResponse } from "next/server";
import {
  checkContactInput,
  checkNewsletterEmail,
  checkSubmissionTiming,
  disclosureVersion,
  ENQUIRY_FUNCTION,
  enquiryRequestBody,
  formOutcome,
  newsletterDisclosureText,
  subscribeRequestBody,
  SUBSCRIBE_FUNCTION,
  type FormErrorCode,
  type FormKind,
} from "../contracts/generated/forms.ts";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { hrefForPath, isPagePath } from "../contracts/generated/routes.ts";
import { runtimeConfig } from "./config";
import { enquiryAvailability } from "./enquiryAvailability";
import { emitPublicObservation } from "./observability";
import { pageForPath } from "./pageRouting";
import type { ResolvedSite } from "./publication";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";
import { formAnchor, formErrorMessage, formStampValid, formSuccessMessage } from "./siteForms";
import { hasGrantedAnalyticsConsent } from "./consent";
import { recordSiteEvent, type SiteEventRecorder } from "./siteEvents";

/*
 * #2829 W5 (amendment A4) — the ONE send path for a site's contact form and
 * newsletter box. It answers a plain HTML form post (no JavaScript: a 303
 * back to the same page with the outcome in the address) and the page's own
 * enhanced submit (JSON).
 *
 * WHAT IT TRUSTS. The site, its brand and the form come from the publication
 * Core resolved for THIS host and the block at the posted page/position —
 * never from the request. The words recorded as newsletter consent are built
 * from that block's own rendered text, so they are exactly what the visitor
 * saw. The redirect goes back to a page of this site, never to a posted URL.
 *
 * WHERE IT SENDS. Mingla's public enquiry / subscribe functions (#4111),
 * server to server, with the visitor's address forwarded for Mingla's own
 * rate limits. The site stores nothing.
 *
 * NO SILENT FAILURES. Mingla answers 202 even when it drops a send (too fast,
 * honeypot, rate limit), so the site refuses those cases itself, with a
 * visible reason, before forwarding: the honeypot, the 3-second minimum, and
 * the same per-address limits (best effort, per server instance).
 */
export const MAX_FORM_BODY_BYTES = 16 * 1024;
export const FORWARD_TIMEOUT_MS = 8_000;
/** Mirrors #4111: 5 enquiries per visitor address per hour; 3 per brand+email per day. */
export const RATE_LIMITS = {
  perAddress: { max: 5, windowMs: 60 * 60_000 },
  perEmail: { max: 3, windowMs: 24 * 60 * 60_000 },
} as const;

const hits = new Map<string, number[]>();

export function clearFormRateLimits(): void {
  hits.clear();
}

function overLimit(key: string, limit: { max: number; windowMs: number }, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < limit.windowMs);
  hits.set(key, recent);
  return recent.length >= limit.max;
}

function record(key: string, now: number): void {
  hits.set(key, [...(hits.get(key) ?? []), now]);
}

export type FormSubmissionDeps = {
  now?: () => number;
  /** Sends one request to a Mingla public function (tests replace it). */
  forward?: (fn: string, body: Record<string, unknown>, clientAddress: string | null) => Promise<{ status: number; body: unknown }>;
  availability?: typeof enquiryAvailability;
  /** #2829 W10 — records a consented visitor event (tests replace it). */
  recordEvent?: SiteEventRecorder;
};

async function forwardToMingla(fn: string, body: Record<string, unknown>, clientAddress: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const response = await fetch(`${runtimeConfig().formsFunctionsBaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clientAddress ? { "x-forwarded-for": clientAddress } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

/** The visitor's address as the edge saw it (first hop), or null. */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null;
}

async function readFields(request: Request): Promise<{ fields: Record<string, string>; json: boolean } | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FORM_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_FORM_BODY_BYTES) return null;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number") fields[key] = String(value);
      }
      return { fields, json: true };
    } catch {
      return null;
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return { fields: Object.fromEntries(new URLSearchParams(raw)), json: false };
  }
  return null;
}

type Located = { artifact: ArtifactV2; site: ResolvedSite; path: string; blockIndex: number; block: Record<string, unknown> };

function locateForm(artifact: SiteArtifact, site: ResolvedSite, kind: FormKind, fields: Record<string, string>): Located | null {
  if (!isV2Artifact(artifact) || artifact.site_id !== site.site_id) return null;
  const path = fields.page ?? "";
  const blockIndex = Number(fields.block);
  if (!isPagePath(path) || !Number.isInteger(blockIndex) || blockIndex < 0) return null;
  const page = pageForPath(artifact, path);
  const block = page?.blocks[blockIndex] as Record<string, unknown> | undefined;
  const wanted = kind === "contact" ? "contact_form" : "newsletter_signup";
  if (!page || !block || block.type !== wanted) return null;
  return { artifact, site, path, blockIndex, block };
}

function observeFailure(siteId: string | null, kind: FormKind, code: FormErrorCode, status: number | null): void {
  emitPublicObservation({
    event: "mingla_sites_state",
    metric: `public.forms.${kind}.${code}`,
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: siteId,
    publication_id: null,
    direction: "public_runtime",
    route: `/api/forms/${kind}`,
    state_transition: "form_submitted->refused",
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: null,
    status_code: status,
    version: "sites-v1",
  });
}

const STATUS_FOR: Record<FormErrorCode, number> = {
  missing: 400, email: 400, phone: 400, short: 400, toolong: 400, fast: 400, expired: 400, trap: 400,
  rate: 429, unavailable: 409, server: 502,
};

export async function handleFormSubmission(
  kind: FormKind,
  request: Request,
  load: () => Promise<{ artifact: SiteArtifact; resolution: ResolvedSite }>,
  deps: FormSubmissionDeps = {},
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const parsed = await readFields(request).catch(() => null);
  const wantsJson = parsed?.json === true || (request.headers.get("accept") ?? "").includes("application/json");
  let located: Located | null = null;
  let brandName = "us";

  const answer = (outcome: { ok: true } | { ok: false; error: FormErrorCode }): Response => {
    if (!outcome.ok) observeFailure(located?.site.site_id ?? null, kind, outcome.error, null);
    const message = outcome.ok
      ? formSuccessMessage(kind, brandName, located?.block.success_text)
      : formErrorMessage(outcome.error, {
        name: brandName,
        fallbackEmail: typeof located?.block.fallback_email === "string" ? located.block.fallback_email : null,
      });
    if (wantsJson) {
      return NextResponse.json(
        outcome.ok ? { ok: true, kind, message } : { ok: false, kind, error: outcome.error, message },
        { status: outcome.ok ? 200 : STATUS_FOR[outcome.error] },
      );
    }
    // No JavaScript: back to the same page of THIS site with the outcome.
    const target = located ? hrefForPath(located.path) : "/";
    const query = new URLSearchParams(
      outcome.ok ? { sent: kind } : { formError: outcome.error, formKind: kind },
    );
    if (located) query.set("form", String(located.blockIndex));
    const anchor = located ? `#${formAnchor(located.blockIndex)}` : "";
    return new NextResponse(null, { status: 303, headers: { Location: `${target}?${query.toString()}${anchor}` } });
  };

  if (!parsed) return answer({ ok: false, error: "server" });
  let publication: { artifact: SiteArtifact; resolution: ResolvedSite };
  try {
    publication = await load();
  } catch {
    return answer({ ok: false, error: "server" });
  }
  located = locateForm(publication.artifact, publication.resolution, kind, parsed.fields);
  if (!located) return answer({ ok: false, error: "server" });
  brandName = located.artifact.brand.display_name;

  const renderedAt = Number(parsed.fields.t0);
  const timing = checkSubmissionTiming({ honeypot: parsed.fields.website ?? "", renderedAt, now: now() });
  if (timing) return answer({ ok: false, error: timing });
  if (!(await formStampValid(located.site.site_id, renderedAt, parsed.fields.ts))) {
    return answer({ ok: false, error: "expired" });
  }

  const address = clientAddress(request.headers);
  const addressKey = `${kind}|${located.site.site_id}|${address ?? "unknown"}`;
  if (overLimit(addressKey, RATE_LIMITS.perAddress, now())) return answer({ ok: false, error: "rate" });

  let fn: string;
  let body: Record<string, unknown>;
  let emailKey: string | null = null;
  if (kind === "contact") {
    const checked = checkContactInput(
      { name: parsed.fields.name, email: parsed.fields.email, phone: parsed.fields.phone, message: parsed.fields.message },
      { phoneShown: located.block.show_phone === true },
    );
    if (!checked.ok) return answer(checked);
    const status = await (deps.availability ?? enquiryAvailability)(located.site);
    if (status === "unavailable") return answer({ ok: false, error: "unavailable" });
    emailKey = `contact|${located.site.site_id}|${checked.value.email}`;
    if (overLimit(emailKey, RATE_LIMITS.perEmail, now())) return answer({ ok: false, error: "rate" });
    fn = ENQUIRY_FUNCTION;
    body = enquiryRequestBody({ brandId: located.artifact.brand_id, siteId: located.site.site_id, renderedAt, contact: checked.value });
  } else {
    const checked = checkNewsletterEmail(parsed.fields.email);
    if (!checked.ok) return answer(checked);
    const text = newsletterDisclosureText(located.block);
    fn = SUBSCRIBE_FUNCTION;
    body = subscribeRequestBody({
      brandId: located.artifact.brand_id,
      siteId: located.site.site_id,
      renderedAt,
      email: checked.email,
      disclosureText: text,
      disclosureVersion: await disclosureVersion("newsletter", text),
    });
  }

  record(addressKey, now());
  if (emailKey) record(emailKey, now());
  let reply: { status: number; body: unknown };
  try {
    reply = await (deps.forward ?? forwardToMingla)(fn, body, address);
  } catch {
    return answer({ ok: false, error: "server" });
  }
  const outcome = formOutcome(kind, reply.status, reply.body);
  // #2829 W10 — a sent form counts in the owner's analytics ONLY when the
  // visitor allowed analytics (the same consent cookie the events route
  // reads). Recorded here so a form sent without JavaScript counts too; the
  // event carries no form content. A failed record never touches the answer.
  if (outcome.ok && hasGrantedAnalyticsConsent(request.headers.get("cookie"))) {
    await (deps.recordEvent ?? recordSiteEvent)(located.site, {
      event_name: kind === "contact" ? "form_submit_contact" : "form_submit_newsletter",
      brand_id: located.artifact.brand_id,
      publication_id: located.artifact.publication_id,
      page_path: hrefForPath(located.path),
      consent_policy_version: "sites-v1",
      event_id: crypto.randomUUID(),
    }).catch(() => undefined);
  }
  return answer(outcome);
}
