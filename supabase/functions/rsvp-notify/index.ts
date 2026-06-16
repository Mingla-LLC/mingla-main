/**
 * ORCH-1150 — rsvp-notify
 *
 * Multi-channel transactional fan-out for the RSVP notification pipeline.
 * verify_jwt=true (config.toml) — service-role-invoked only; NOT a public route.
 *
 * Given a queue row (`{ notificationId }`) OR `{ eventId, rsvpId, templateKey }`,
 * it resolves the guest + event, then attempts EVERY channel for which the guest
 * has a usable address/token (A4-NEW-2 — NOT push-only for app users):
 *   - push  — if user_id is set (consumer app, via OneSignal external_id)
 *   - email — guest_email (link guest) OR the app user's verified auth email
 *   - sms   — guest_phone (link guest) OR a profile phone if present
 * Each channel is independent + NON-BLOCKING (Constitution #3): a failure in one
 * never aborts the others or throws. The queue row ends `sent` when ≥1 channel
 * succeeds, `failed_retryable` if all transiently failed, `failed_terminal` on a
 * permanent failure, `skipped` when no channel had an address.
 *
 * REUSES the three existing clients (do NOT add new providers):
 *   - sendPush            from _shared/push-utils.ts:95
 *   - Resend send         cloned from notify-dispatch/index.ts:84-138
 *   - Twilio send         cloned from ticket-confirmation-dispatch/index.ts:123-170
 *
 * ORCH-1150: do NOT merge back into the event/ticket notification path — RSVP
 * notify is TRANSACTIONAL (the guest's own RSVP action), outside marketing-consent.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "../_shared/email/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TemplateKey =
  | "rsvp_event_updated"
  | "rsvp_waitlist_promoted"
  | "rsvp_approved"
  | "rsvp_denied"
  | "rsvp_removed";

interface CopyBlock {
  pushTitle: string;
  pushBody: string;
  sms: string;
  emailSubject: string;
  emailBody: string;
}

function buildCopy(
  template: TemplateKey,
  ctx: { eventTitle: string; brandName: string; link: string },
): CopyBlock {
  const { eventTitle, brandName, link } = ctx;
  switch (template) {
    case "rsvp_event_updated":
      return {
        pushTitle: `Plans changed: ${eventTitle}`,
        pushBody: "The host updated this event — tap for details.",
        sms: `${brandName}: ${eventTitle} was updated. See the latest: ${link}`,
        emailSubject: `${eventTitle} — updated details`,
        emailBody: `The host updated ${eventTitle}. See the latest: ${link}`,
      };
    case "rsvp_waitlist_promoted":
      return {
        pushTitle: `You're in! ${eventTitle}`,
        pushBody: "A spot opened — you're going.",
        sms: `${brandName}: a spot opened at ${eventTitle} — you're in! ${link}`,
        emailSubject: `You're off the waitlist for ${eventTitle}`,
        emailBody: `Good news — a spot opened and you're now going to ${eventTitle}. ${link}`,
      };
    case "rsvp_approved":
      return {
        pushTitle: `You're approved: ${eventTitle}`,
        pushBody: "The host approved your RSVP — see you there.",
        sms: `${brandName}: you're approved for ${eventTitle}! ${link}`,
        emailSubject: `You're approved for ${eventTitle}`,
        emailBody: `The host approved your RSVP for ${eventTitle}. ${link}`,
      };
    case "rsvp_denied":
      return {
        pushTitle: `RSVP update: ${eventTitle}`,
        pushBody: "The host couldn't fit your RSVP this time.",
        sms: `${brandName}: the host couldn't fit your RSVP for ${eventTitle}.`,
        emailSubject: `About your RSVP to ${eventTitle}`,
        emailBody: `Unfortunately the host couldn't confirm your RSVP for ${eventTitle} this time.`,
      };
    case "rsvp_removed":
      return {
        pushTitle: `Update: ${eventTitle}`,
        pushBody: "The host has removed you from this event.",
        sms: `${brandName}: the host has removed you from ${eventTitle}.`,
        emailSubject: `About your RSVP to ${eventTitle}`,
        emailBody: `The host has removed you from ${eventTitle}. If you think this was a mistake, reach out to them.`,
      };
  }
}

// Resend send — cloned from notify-dispatch/index.ts:84-138. Do NOT write a new client.
async function sendResendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  const sender = EMAIL_SENDERS.system;
  try {
    assertNotResendSandbox(sender);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let rendered;
  try {
    rendered = renderTransactionalEmail({
      variant: "generic_notification",
      recipient: { name: null, email: to },
      body: {
        variant: "generic_notification",
        title: subject,
        paragraphs: body.split("\n\n"),
        cta: null,
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(rendered.from),
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Twilio send — cloned from ticket-confirmation-dispatch/index.ts:123-170.
async function sendTwilioSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { ok: false, error: "twilio_env_missing" };
  }
  const statusSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const statusCallback =
    statusSecret && supabaseUrl
      ? `${supabaseUrl}/functions/v1/twilio-message-status?secret=${encodeURIComponent(statusSecret)}`
      : undefined;
  const params = new URLSearchParams({
    To: to,
    MessagingServiceSid: messagingServiceSid,
    Body: body,
  });
  if (statusCallback) params.set("StatusCallback", statusCallback);
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!response.ok) {
      return { ok: false, error: `Twilio ${response.status}: ${await response.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[rsvp-notify] missing SUPABASE_URL / service key");
    return json(500, { error: "server_misconfigured" });
  }

  let reqBody: { notificationId?: string };
  try {
    reqBody = (await req.json()) as { notificationId?: string };
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const notificationId =
    typeof reqBody.notificationId === "string" ? reqBody.notificationId : "";
  if (notificationId.length === 0) {
    return json(400, { error: "notification_id_required" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1. Load the queue row.
  const { data: queueRow, error: queueErr } = await admin
    .from("rsvp_notifications")
    .select("id, event_id, rsvp_id, template_key, status")
    .eq("id", notificationId)
    .single();
  if (queueErr || !queueRow) {
    console.error("[rsvp-notify] queue row not found", notificationId);
    return json(404, { error: "queue_row_not_found" });
  }
  if (queueRow.status === "sent") {
    return json(200, { ok: true, reason: "already_sent" });
  }

  // 2. Resolve the guest + event.
  const { data: rsvpRow } = await admin
    .from("event_rsvps")
    .select("id, user_id, guest_name, guest_email, guest_phone")
    .eq("id", queueRow.rsvp_id)
    .maybeSingle();
  const { data: eventRow } = await admin
    .from("events")
    .select("id, title, brand_id, slug")
    .eq("id", queueRow.event_id)
    .single();

  if (!eventRow) {
    await admin
      .from("rsvp_notifications")
      .update({ status: "failed_terminal", last_error: "event_not_found", updated_at: new Date().toISOString() })
      .eq("id", notificationId);
    return json(200, { ok: false, reason: "event_not_found" });
  }

  let brandName = "Mingla";
  const { data: brandRow } = await admin
    .from("brands")
    .select("slug, name")
    .eq("id", eventRow.brand_id)
    .maybeSingle();
  if (brandRow?.name) brandName = brandRow.name;

  const link = brandRow?.slug
    ? `https://usemingla.com/e/${brandRow.slug}/${eventRow.slug}`
    : "https://usemingla.com";
  const copy = buildCopy(queueRow.template_key as TemplateKey, {
    eventTitle: eventRow.title ?? "your event",
    brandName,
    link,
  });

  // 3. Resolve every available channel address/token.
  const userId: string | null = rsvpRow?.user_id ?? null;
  let email: string | null = rsvpRow?.guest_email ?? null;
  let phone: string | null = rsvpRow?.guest_phone ?? null;

  // App-user guest: resolve verified auth email (never user_metadata) + profile phone.
  if (userId !== null) {
    try {
      const { data: au } = await admin.auth.admin.getUserById(userId);
      const authEmail = au?.user?.email ?? null;
      const identityEmail =
        (au?.user?.identities ?? [])
          .map((i) => (i.identity_data as { email?: string } | null)?.email)
          .find((e): e is string => typeof e === "string" && e.length > 0) ?? null;
      if (email === null) email = authEmail ?? identityEmail;
    } catch (err) {
      console.warn("[rsvp-notify] auth email resolve failed", String(err));
    }
    if (phone === null) {
      try {
        const { data: profile } = await admin
          .from("profiles")
          .select("phone")
          .eq("id", userId)
          .maybeSingle();
        if (profile && typeof (profile as { phone?: string }).phone === "string") {
          phone = (profile as { phone?: string }).phone ?? null;
        }
      } catch {
        // profile phone is optional.
      }
    }
  }

  // 4. Fan out — each channel independent + non-blocking.
  const outcome: { push: boolean; email: boolean; sms: boolean } = {
    push: false,
    email: false,
    sms: false,
  };
  let anyAttempted = false;

  if (userId !== null) {
    anyAttempted = true;
    try {
      outcome.push = await sendPush({
        targetUserId: userId,
        title: copy.pushTitle,
        body: copy.pushBody,
        app: "consumer",
        data: { deepLink: link, type: queueRow.template_key },
      });
      // In-app inbox row (mirror notify-dispatch); non-blocking.
      try {
        await admin.from("notifications").insert({
          user_id: userId,
          type: queueRow.template_key,
          title: copy.pushTitle,
          body: copy.pushBody,
          deep_link: link,
          data: { deepLink: link },
          brand_id: eventRow.brand_id,
          related_id: eventRow.id,
          related_type: "rsvp_event",
        });
      } catch (inboxErr) {
        console.warn("[rsvp-notify] inbox insert failed (non-fatal)", String(inboxErr));
      }
    } catch (err) {
      console.warn("[rsvp-notify] push failed (isolated)", String(err));
    }
  }

  if (email !== null && email.length > 0) {
    anyAttempted = true;
    const r = await sendResendEmail(email, copy.emailSubject, copy.emailBody);
    outcome.email = r.ok;
    if (!r.ok) console.warn("[rsvp-notify] email failed (isolated)", r.error);
  }

  if (phone !== null && phone.length > 0) {
    anyAttempted = true;
    const r = await sendTwilioSms(phone, copy.sms);
    outcome.sms = r.ok;
    if (!r.ok) console.warn("[rsvp-notify] sms failed (isolated)", r.error);
  }

  const anySucceeded = outcome.push || outcome.email || outcome.sms;
  const nextStatus = !anyAttempted
    ? "skipped"
    : anySucceeded
      ? "sent"
      : "failed_retryable";

  console.log(
    `[rsvp-notify] ${queueRow.template_key} rsvp=${queueRow.rsvp_id} ` +
      `push=${outcome.push} email=${outcome.email} sms=${outcome.sms} -> ${nextStatus}`,
  );

  const nowIso = new Date().toISOString();
  await admin
    .from("rsvp_notifications")
    .update({
      status: nextStatus,
      sent_at: anySucceeded ? nowIso : null,
      attempt_count: (typeof (queueRow as { attempt_count?: number }).attempt_count === "number"
        ? (queueRow as { attempt_count?: number }).attempt_count!
        : 0) + 1,
      updated_at: nowIso,
    })
    .eq("id", notificationId);

  // Mark the rsvp row's notified_at (idempotency aid).
  if (rsvpRow?.id) {
    await admin
      .from("event_rsvps")
      .update({ notified_at: nowIso })
      .eq("id", rsvpRow.id);
  }

  return json(200, { ok: anySucceeded, channels: outcome, status: nextStatus });
});
