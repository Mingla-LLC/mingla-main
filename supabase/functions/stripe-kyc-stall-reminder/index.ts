/**
 * stripe-kyc-stall-reminder — Email brands stuck in Connect onboarding (issue #47 J-B2.4).
 *
 * Invoke from Supabase scheduled triggers, GitHub Actions, or manual curl.
 * Auth: Authorization: Bearer <CRON_SECRET> matching env CRON_SECRET.
 *
 * Env: CRON_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL (e.g. onboarding@yourdomain),
 *      optional MINGLA_BUSINESS_APP_URL (https fallback link; app opens via scheme).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requirementsHasDue(req: unknown): boolean {
  if (req === null || typeof req !== "object") return false;
  const r = req as Record<string, unknown>;
  const cd = r.currently_due;
  const pd = r.past_due;
  const n =
    (Array.isArray(cd) ? cd.length : 0) + (Array.isArray(pd) ? pd.length : 0);
  return n > 0;
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
  from: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (key === undefined || key === "") {
    return { ok: false, error: "RESEND_API_KEY missing" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (cronSecret === undefined || cronSecret === "" || auth !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: accounts, error: accErr } = await admin
    .from("stripe_connect_accounts")
    .select("brand_id, requirements, updated_at, charges_enabled, kyc_stall_reminder_sent_at")
    .eq("charges_enabled", false)
    .is("kyc_stall_reminder_sent_at", null)
    .lt("updated_at", cutoff);

  if (accErr !== null) {
    console.error("[stripe-kyc-stall-reminder] query:", accErr.message);
    return json({ error: "Query failed" }, 500);
  }

  const from =
    Deno.env.get("RESEND_FROM_EMAIL") ?? "Mingla Business <onboarding@resend.dev>";

  let sent = 0;
  const errors: string[] = [];

  for (const row of accounts ?? []) {
    if (!requirementsHasDue(row.requirements)) continue;

    const brandId = row.brand_id as string;
    const { data: brand, error: bErr } = await admin
      .from("brands")
      .select("name, contact_email")
      .eq("id", brandId)
      .is("deleted_at", null)
      .maybeSingle();

    if (bErr !== null || brand === null) continue;
    const email = brand.contact_email?.trim();
    if (email === undefined || email === "") continue;

    const name = String(brand.name ?? "your brand");
    const schemeLink = `minglabusiness://brand/${brandId}/payments/onboard`;
    const httpsBase = Deno.env.get("MINGLA_BUSINESS_APP_URL")?.replace(/\/$/, "") ?? "";
    const httpsLink = httpsBase !== "" ? `${httpsBase}/brand/${brandId}/payments/onboard` : null;

    const bodyText = [
      `Hi ${name} team,`,
      ``,
      `Stripe still needs information to finish verifying your payouts account.`,
      `Open Mingla Business and tap Payments → Finish onboarding, or use this link on your phone:`,
      schemeLink,
      httpsLink !== null ? `\nWeb: ${httpsLink}` : ``,
      ``,
      `If you already submitted documents, verification can take a short while — this is a friendly nudge in case something is still outstanding.`,
      ``,
      `— Mingla Business`,
    ].join("\n");

    const result = await sendViaResend(
      email,
      `Action needed: finish Stripe setup for ${name}`,
      bodyText,
      from,
    );

    if (!result.ok) {
      errors.push(`${brandId}: ${result.error ?? "send failed"}`);
      continue;
    }

    const { error: upErr } = await admin
      .from("stripe_connect_accounts")
      .update({ kyc_stall_reminder_sent_at: new Date().toISOString() })
      .eq("brand_id", brandId);

    if (upErr !== null) {
      errors.push(`${brandId}: db update ${upErr.message}`);
      continue;
    }

    sent += 1;
  }

  return json({ ok: true, candidates: accounts?.length ?? 0, sent, errors });
});
