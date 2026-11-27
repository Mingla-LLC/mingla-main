// #4640 — first-party demo reminders and scheduled confirmation Work cards.
// Cron only. The service-role bearer is checked again in code before a job is
// claimed. Reminder/work idempotency lives in the database, not this isolate.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { escapeHtml } from "../_shared/email/escape.ts";
import { renderShell, SHELL_TOKENS } from "../_shared/email/shell.ts";
import {
  type GrowthToolsEmail,
  sendGrowthToolsEmail,
} from "../_shared/growthToolsResend.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { resolveRuntimeString } from "../_shared/runtimeConfig.ts";

export interface ReminderJob {
  id: string;
  kind: "24h" | "2h" | "15m";
  booking_id: string;
  name: string;
  email: string;
  call_at: string;
  booker_time_zone: string | null;
  meet_url: string | null;
  venue: string | null;
  audience: "host" | "creator" | "local";
}

const WORDS = {
  "24h": {
    subject: "Your Mingla call is tomorrow",
    lead: "Your Mingla call is about a day away.",
  },
  "2h": {
    subject: "Your Mingla call starts in 2 hours",
    lead: "Your Mingla call starts in about two hours.",
  },
  "15m": {
    subject: "Your Mingla call starts in 15 minutes",
    lead: "Your Mingla call starts in about 15 minutes.",
  },
} as const;

function when(iso: string, zone: string | null): string {
  const timeZone = zone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

export function reminderEmail(job: ReminderJob): GrowthToolsEmail {
  const words = WORDS[job.kind];
  const support = Deno.env.get("SUPPORT_EMAIL") ?? "support@usemingla.com";
  const callWhen = when(job.call_at, job.booker_time_zone);
  const meet =
    typeof job.meet_url === "string" && /^https:\/\/\S+$/.test(job.meet_url)
      ? job.meet_url
      : null;
  const button = meet
    ? `<p style="margin:24px 0 0;"><a href="${
      escapeHtml(meet)
    }" style="display:inline-block;border-radius:10px;background:${SHELL_TOKENS.BRAND_ORANGE_BUTTON};padding:12px 18px;color:#111110;text-decoration:none;font-weight:700;">Join the video call</a></p>`
    : "";
  const body =
    `<h1 style="margin:0 0 12px;color:${SHELL_TOKENS.BRAND_INK};font-size:24px;">${
      escapeHtml(words.subject)
    }</h1>
    <p style="margin:0 0 12px;font-size:15px;">Hi ${
      escapeHtml(job.name.split(/\s+/)[0] || job.name)
    }, ${escapeHtml(words.lead)}</p>
    <p style="margin:0;font-size:15px;"><strong>${
      escapeHtml(callWhen)
    }</strong></p>${button}
    <p style="margin:20px 0 0;color:${SHELL_TOKENS.BRAND_MUTED};font-size:13px;">The calendar invite has the same video link. Reply if your plans changed.</p>`;
  return {
    to: [job.email],
    subject: words.subject,
    html: renderShell({
      preheader: `${words.lead} ${callWhen}`,
      bodyHtml: body,
      supportEmail: support,
      logoUrl: minglaLogoUrl(),
      footerAddress: resolveRuntimeString(
        "mingla_footer_address",
        "MINGLA_FOOTER_ADDRESS",
      ) ?? "Mingla, hello@usemingla.com",
    }),
    text: `${words.lead}\n\n${callWhen}${
      meet ? `\n\nJoin: ${meet}` : ""
    }\n\nReply if your plans changed.`,
    replyTo: support,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key || req.headers.get("authorization") !== `Bearer ${key}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const resend = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!url || !resend) return json({ error: "unconfigured" }, 503);
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const counts = {
    reminders_sent: 0,
    reminders_failed: 0,
    cards_created: 0,
    cards_failed: 0,
  };

  const work = await db.rpc("booking_work_claim", { p_limit: 30 });
  if (work.error) return json({ error: "claim_failed" }, 500);
  for (const id of Array.isArray(work.data) ? work.data : []) {
    const done = await db.rpc("booking_work_finish", { p_id: id });
    if (done.error || !done.data) counts.cards_failed += 1;
    else counts.cards_created += 1;
  }

  const claimed = await db.rpc("booking_reminder_claim", { p_limit: 30 });
  if (claimed.error) return json({ error: "claim_failed", ...counts }, 500);
  for (
    const job
      of (Array.isArray(claimed.data) ? claimed.data : []) as ReminderJob[]
  ) {
    let sent = false;
    let error: string | null = null;
    try {
      sent = await sendGrowthToolsEmail(reminderEmail(job), {
        apiKey: resend,
        logTag: "growth-tools-booking-reminders",
      });
      if (!sent) error = "send_failed";
    } catch (err) {
      error = err instanceof Error ? err.name : "send_threw";
    }
    const finish = await db.rpc("booking_reminder_finish", {
      p_id: job.id,
      p_sent: sent,
      p_error: error,
    });
    if (finish.error || !sent) counts.reminders_failed += 1;
    else counts.reminders_sent += 1;
  }
  console.log("[growth-tools-booking-reminders] done", JSON.stringify(counts));
  return json({ ok: true, ...counts });
}

if (import.meta.main) serve(handler);
