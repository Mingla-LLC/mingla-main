/**
 * hostFunnelConversion.ts — #4238 W3-3 (D7; I-4238-HOST-FUNNEL-ONCE).
 *
 * The one server path that stores a host's (or a host lead's) browser match
 * keys in public.ad_match_contexts and fires the host-funnel conversion through
 * fireAdConversion. Used by host-attribution-attach (sign-up), growth-tools-book
 * (book-a-call lead) and growth-tools-gate (tools email-gate lead).
 *
 * Rules:
 *   - The subject is always decided by the server (the JWT user, or the lead row
 *     the function itself just wrote). Nothing in the body names a subject.
 *   - IP and user agent come from the request headers, never from the body.
 *   - With the visitor's ads choice off (`tracking_opt_out: true`) no cookie or
 *     click id is stored; the conversion records the opt-out and sends nothing.
 *   - Every value is bounded; a malformed field is dropped, never an error.
 *   - Never throws: a failed write or fire is logged loudly and the caller's
 *     own flow (sign-in, booking, email unlock) carries on.
 */

// @ts-ignore — Deno ESM import (pin matches adConversionFire.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  fireAdConversion,
  type FireAdConversionDeps,
  type FireAdConversionResult,
  type HostEventInput,
} from "./adConversionFire.ts";
import {
  CALL_KIND_FOR_LABEL,
  HOST_FUNNEL_EVENT_ID_PREFIX,
  LEAD_KIND_FOR_LABEL,
  type LeadLabel,
} from "./adEventCatalog.ts";

/** The senders' own timeout; a caller never waits longer for the fire. */
export const HOST_FUNNEL_FIRE_BOUND_MS = 8_000;

export interface HostAdContext {
  clickId: string | null;
  fbp: string | null;
  fbc: string | null;
  ttp: string | null;
  scid: string | null;
  trackingOptOut: boolean;
  pageUrl: string | null;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
}

const bounded = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** A first-party click id (attribution-capture mints a UUID). */
const CLICK_ID_RE = /^[A-Za-z0-9_-]{8,200}$/;

/** Only an https page on a Mingla host (or a Vercel preview) is kept. */
export function boundedPageUrl(value: unknown): string | null {
  const raw = bounded(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const ok = host === "usemingla.com" || host.endsWith(".usemingla.com") ||
      host.endsWith(".vercel.app");
    return ok ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/**
 * The browser's ad context from a request body field (`ad` for the lead
 * functions, the whole body for host-attribution-attach). Null when absent.
 */
export function parseHostAdContext(
  raw: unknown,
  req: Request,
): HostAdContext | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const optOut = body.tracking_opt_out === true;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clickId = bounded(body.click_id, 200);
  return {
    // Ads off: keep only the opt-out itself.
    clickId: optOut ? null : (clickId && CLICK_ID_RE.test(clickId) ? clickId : null),
    fbp: optOut ? null : bounded(body.fbp, 500),
    fbc: optOut ? null : bounded(body.fbc, 500),
    ttp: optOut ? null : bounded(body.ttp, 500),
    scid: optOut ? null : bounded(body.scid, 500),
    trackingOptOut: optOut,
    pageUrl: boundedPageUrl(body.page_url),
    clientIpAddress: optOut ? null : (forwarded ? forwarded.slice(0, 100) : null),
    clientUserAgent: optOut
      ? null
      : bounded(req.headers.get("user-agent"), 1000),
  };
}

export type MatchSurface = "web" | "ios" | "android";

export interface UpsertMatchContextInput {
  subjectType: "host_user" | "lead";
  subjectId: string;
  surface: MatchSurface;
  ad: HostAdContext | null;
  installAttribution?: Record<string, string> | null;
}

/**
 * Store the subject's match keys. The first row for a subject wins; a later
 * call only fills what the first one lacked (a click id, cookies), and a web
 * row is never turned into a native one. `created` is true only for the call
 * that inserted the row. Never throws.
 */
export async function upsertAdMatchContext(
  supabase: SupabaseClient,
  input: UpsertMatchContextInput,
): Promise<{ ok: boolean; created: boolean }> {
  const ad = input.ad;
  const row = {
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    click_id: ad?.clickId ?? null,
    fbp: ad?.fbp ?? null,
    fbc: ad?.fbc ?? null,
    ttp: ad?.ttp ?? null,
    scid: ad?.scid ?? null,
    client_ip: ad?.clientIpAddress ?? null,
    client_user_agent: ad?.clientUserAgent ?? null,
    ad_tracking_opt_out: ad?.trackingOptOut === true,
    event_source_url: ad?.pageUrl ?? null,
    surface: input.surface,
    install_attribution: input.installAttribution ?? null,
  };
  try {
    const { data: existing, error: readError } = await supabase
      .from("ad_match_contexts")
      .select(
        "id,click_id,fbp,fbc,ttp,scid,surface,ad_tracking_opt_out,install_attribution",
      )
      .eq("subject_type", input.subjectType)
      .eq("subject_id", input.subjectId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) {
      const { error } = await supabase.from("ad_match_contexts").insert(row);
      if (!error) return { ok: true, created: true };
      // A concurrent first call inserted it (unique subject): not created here.
      if ((error as { code?: string }).code === "23505") {
        return { ok: true, created: false };
      }
      throw new Error(error.message);
    }
    const prior = existing as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    // An opt-out always wins and clears what was stored.
    if (row.ad_tracking_opt_out && prior.ad_tracking_opt_out !== true) {
      Object.assign(patch, {
        ad_tracking_opt_out: true,
        click_id: null,
        fbp: null,
        fbc: null,
        ttp: null,
        scid: null,
        client_ip: null,
        client_user_agent: null,
      });
    } else if (!row.ad_tracking_opt_out && prior.ad_tracking_opt_out !== true) {
      for (const key of ["click_id", "fbp", "fbc", "ttp", "scid"] as const) {
        if (!prior[key] && row[key]) patch[key] = row[key];
      }
      if (Object.keys(patch).length > 0 && input.surface === "web") {
        patch.client_ip = row.client_ip;
        patch.client_user_agent = row.client_user_agent;
        if (row.event_source_url) patch.event_source_url = row.event_source_url;
        if (prior.surface !== "web") patch.surface = "web";
      }
    }
    if (!prior.install_attribution && row.install_attribution) {
      patch.install_attribution = row.install_attribution;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from("ad_match_contexts")
        .update(patch)
        .eq("id", prior.id as string);
      if (error) throw new Error(error.message);
    }
    return { ok: true, created: false };
  } catch (err) {
    console.error(
      "[hostFunnelConversion] MATCH CONTEXT WRITE FAILED",
      input.subjectType,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, created: false };
  }
}

/** Fire one host-funnel conversion. Never throws. */
export async function fireHostFunnelConversion(
  supabase: SupabaseClient,
  hostEvent: HostEventInput,
  deps: FireAdConversionDeps = {},
): Promise<FireAdConversionResult | null> {
  try {
    return await fireAdConversion(supabase, {
      hostEvent,
      surface: "web",
      lane: "consumer",
      eventTimeMs: Date.now(),
    }, deps);
  } catch (err) {
    console.error(
      "[hostFunnelConversion] fire failed (non-fatal)",
      hostEvent.kind,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

type WaitUntil = (task: Promise<unknown>) => void;

/**
 * Run the fire after the response when the runtime allows it; otherwise wait
 * for it, bounded by one sender timeout.
 */
export async function scheduleHostFunnelTask(
  task: Promise<unknown>,
  waitUntil: WaitUntil | null = edgeWaitUntil(),
  boundMs = HOST_FUNNEL_FIRE_BOUND_MS,
): Promise<void> {
  if (waitUntil !== null) {
    waitUntil(task);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, boundMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

function edgeWaitUntil(): WaitUntil | null {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: WaitUntil };
  }).EdgeRuntime;
  return typeof runtime?.waitUntil === "function"
    ? runtime.waitUntil.bind(runtime)
    : null;
}

/**
 * #4238 W3-3: record a host lead's context and fire `host_lead` with
 * event_id `lead:<subjectId>`. Only called when the browser sent an `ad`
 * object (the marketing site's sender side ships separately). Returns the
 * event id the browser fires its Lead twin with. Never throws.
 *
 * #4452: a wrapper over recordLabelledLead with label 'host', so its callers
 * and their ids are byte-identical.
 */
export async function recordHostLead(
  supabase: SupabaseClient,
  input: { subjectId: string; ad: HostAdContext; source?: string | null },
  deps: FireAdConversionDeps = {},
): Promise<string | null> {
  return await recordLabelledLead(supabase, {
    label: "host",
    subjectId: input.subjectId,
    ad: input.ad,
    source: input.source ?? null,
  }, deps);
}

/** Ads unknown (no `ad` object sent): treated as off. Nothing but the opt-out is kept. */
export const OPTED_OUT_CONTEXT: HostAdContext = {
  clickId: null,
  fbp: null,
  fbc: null,
  ttp: null,
  scid: null,
  trackingOptOut: true,
  pageUrl: null,
  clientIpAddress: null,
  clientUserAgent: null,
};

/** #4452 §4.5: the lead event id of a label: `lead:` (host), `creator_lead:`, `local_lead:`. */
export function labelledLeadEventId(label: LeadLabel, subjectId: string): string {
  return `${HOST_FUNNEL_EVENT_ID_PREFIX[LEAD_KIND_FOR_LABEL[label]]}${subjectId}`;
}

/** #4452 §4.5: the call-booked event id: `host_call:`, `creator_call:`, `local_call:` + booking id. */
export function callBookedEventId(label: LeadLabel, bookingId: string): string {
  return `${HOST_FUNNEL_EVENT_ID_PREFIX[CALL_KIND_FOR_LABEL[label]]}${bookingId}`;
}

/**
 * #4452 §4.5 (I-4452-LEAD-LABEL-REQUIRED): record a lead's context and fire
 * its labelled Lead (`<label>_lead`). The subject is the lead row the caller
 * wrote: a booking id, `tool:<id>` or `form:<submission id>`. Returns the
 * event id the browser twin uses. Never throws.
 */
export async function recordLabelledLead(
  supabase: SupabaseClient,
  input: { label: LeadLabel; subjectId: string; ad: HostAdContext | null; source?: string | null },
  deps: FireAdConversionDeps = {},
): Promise<string | null> {
  const kind = LEAD_KIND_FOR_LABEL[input.label];
  if (!kind || !input.subjectId) return null;
  const eventId = labelledLeadEventId(input.label, input.subjectId);
  const stored = await upsertAdMatchContext(supabase, {
    subjectType: "lead",
    subjectId: input.subjectId,
    surface: "web",
    ad: input.ad ?? OPTED_OUT_CONTEXT,
  });
  if (!stored.ok) return null;
  await scheduleHostFunnelTask(
    fireHostFunnelConversion(supabase, {
      kind,
      eventId,
      subjectType: "lead",
      subjectId: input.subjectId,
      leadSource: input.source ?? null,
    }, deps),
  );
  return eventId;
}

/**
 * #4452 §4.5: fire the `<label>_call_booked` end goal for a booking. Its event
 * id is `<prefix><booking id>`; its subject is the booking, and
 * adConversionFire reads the lead's own match context (the form submission's
 * when the booking came from a form), so the call is credited to the same ad
 * click. A direct booking's context was stored by its Lead just before. Never throws.
 */
export async function recordCallBooked(
  supabase: SupabaseClient,
  input: { label: LeadLabel; bookingId: string; source?: string | null },
  deps: FireAdConversionDeps = {},
): Promise<string | null> {
  const kind = CALL_KIND_FOR_LABEL[input.label];
  if (!kind || !input.bookingId) return null;
  const eventId = callBookedEventId(input.label, input.bookingId);
  await scheduleHostFunnelTask(
    fireHostFunnelConversion(supabase, {
      kind,
      eventId,
      subjectType: "lead",
      subjectId: input.bookingId,
      leadSource: input.source ?? null,
    }, deps),
  );
  return eventId;
}
