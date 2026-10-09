/**
 * #3682 Wave 2.5 — signed-out web Follow sheet POST.
 * Always returns 202 { status: "sent" } after a ≥600ms floor (no account leak).
 * Existing profile email → n1 confirm (24h). Unknown email → n4 invite (72h).
 * verify_jwt: false — public; rate-limited by durable IP bucket + per-email silent.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  hashWebFollowToken,
  INVITE_TTL_SECONDS,
  CONFIRM_TTL_SECONDS,
  signWebFollowEmailToken,
  webFollowConfirmPublicUrl,
  webFollowInviteOneLinkUrl,
} from "../_shared/webFollowEmailTokens.ts";
import {
  renderFollowConfirmEmail,
  renderFollowInviteEmail,
} from "../_shared/email/followByEmailBodies.ts";
import { sendInviteEmail } from "../_shared/brandInviteEmail.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FLOOR_MS = 600;
const EMAIL_RESEND_SILENT_MS = 30_000;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  if (first && first.length > 0) return first;
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

function followFromHeader(brandName: string): string {
  const safe = brandName.replace(/[<>\r\n]/g, "").trim() || "Mingla";
  return safe + " via Mingla <follow@usemingla.com>";
}

async function sleepFloor(started: number): Promise<void> {
  const elapsed = Date.now() - started;
  if (elapsed < FLOOR_MS) {
    await new Promise((r) => setTimeout(r, FLOOR_MS - elapsed));
  }
}

function jsonSent(headers: HeadersInit): Response {
  return new Response(JSON.stringify({ status: "sent" }), {
    status: 202,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const started = Date.now();
  const headers = { ...ticketCorsHeaders };
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  if (req.method !== "POST") {
    await sleepFloor(started);
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const ip = clientIp(req);
  let body: { brandId?: unknown; email?: unknown };
  try {
    body = await req.json();
  } catch {
    await sleepFloor(started);
    return jsonSent(headers);
  }

  const brandId = typeof body.brandId === "string" ? body.brandId.trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
  if (brandId.length === 0 || email === null) {
    await sleepFloor(started);
    // Invalid email is the one client-visible error (M2) — do not 202 here.
    return new Response(
      JSON.stringify({
        error: "invalid_email",
        message: "Enter a full email address, like name@example.com.",
      }),
      { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabase = serviceClient();

    // Durable IP throttle (shared across isolates). Loud 429 only.
    const { data: limited, error: rateErr } = await supabase.rpc(
      "biz_web_follow_rate_hit",
      { p_bucket_key: `ip:${ip}`, p_window_seconds: 600, p_max_hits: 5 },
    );
    if (rateErr) {
      console.error("[public-follow-request] rate rpc failed", rateErr.message);
    } else if (limited === true) {
      await sleepFloor(started);
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          message:
            "Too many tries from this device. Wait a few minutes and try again.",
        }),
        { status: 429, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const { data: brandRow } = await supabase
      .from("brands")
      .select("id, name, slug")
      .eq("id", brandId)
      .maybeSingle();
    if (!brandRow?.id) {
      await sleepFloor(started);
      return jsonSent(headers);
    }
    const brandName = (brandRow.name as string | null)?.trim() || "this brand";

    // Exact normalized equality — never ilike (wildcards in local-part).
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    // M1 — per-email silent throttle: recent pending → 202 without resend.
    const { data: existingPending } = await supabase
      .from("brand_follow_email_pending")
      .select("id, created_at, consumed_at")
      .eq("email_normalized", email)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (
      existingPending &&
      existingPending.consumed_at == null &&
      typeof existingPending.created_at === "string" &&
      Date.now() - new Date(existingPending.created_at).getTime() <
        EMAIL_RESEND_SILENT_MS
    ) {
      await sleepFloor(started);
      return jsonSent(headers);
    }

    const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = followFromHeader(brandName);

    if (profile?.id) {
      const token = await signWebFollowEmailToken({
        kind: "confirm",
        brand_id: brandId,
        subject: profile.id as string,
      });
      const tokenHash = await hashWebFollowToken(token);
      const expiresAt = new Date(
        Date.now() + CONFIRM_TTL_SECONDS * 1000,
      ).toISOString();
      const { error: upsertErr } = await supabase
        .from("brand_follow_email_pending")
        .upsert(
          {
            brand_id: brandId,
            email_normalized: email,
            kind: "confirm",
            token_hash: tokenHash,
            user_id: profile.id,
            expires_at: expiresAt,
            consumed_at: null,
            created_at: new Date().toISOString(),
          },
          { onConflict: "email_normalized,brand_id" },
        );
      if (upsertErr) {
        console.error(
          "[public-follow-request] confirm pending upsert failed",
          upsertErr.message,
        );
        await sleepFloor(started);
        return jsonSent(headers);
      }
      const rendered = renderFollowConfirmEmail({
        brandName,
        confirmUrl: webFollowConfirmPublicUrl(token),
      });
      if (apiKey.length > 0) {
        const sent = await sendInviteEmail(apiKey, {
          from,
          to: [email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (!sent.ok) {
          console.error(
            "[public-follow-request] confirm send failed",
            sent.error ?? "unknown",
          );
        }
      } else {
        console.warn("[public-follow-request] RESEND_API_KEY missing; confirm not sent");
      }
    } else {
      // Opaque subject — email lives only in the pending ledger (not in OneLink JWT).
      const opaqueSubject = crypto.randomUUID();
      const token = await signWebFollowEmailToken({
        kind: "invite",
        brand_id: brandId,
        subject: opaqueSubject,
      });
      const tokenHash = await hashWebFollowToken(token);
      const expiresAt = new Date(
        Date.now() + INVITE_TTL_SECONDS * 1000,
      ).toISOString();
      const { error: upsertErr } = await supabase
        .from("brand_follow_email_pending")
        .upsert(
          {
            brand_id: brandId,
            email_normalized: email,
            kind: "invite",
            token_hash: tokenHash,
            user_id: null,
            expires_at: expiresAt,
            consumed_at: null,
            created_at: new Date().toISOString(),
          },
          { onConflict: "email_normalized,brand_id" },
        );
      if (upsertErr) {
        console.error(
          "[public-follow-request] invite pending upsert failed",
          upsertErr.message,
        );
        await sleepFloor(started);
        return jsonSent(headers);
      }
      const rendered = renderFollowInviteEmail({
        brandName,
        oneLinkUrl: webFollowInviteOneLinkUrl(token),
      });
      if (apiKey.length > 0) {
        const sent = await sendInviteEmail(apiKey, {
          from,
          to: [email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (!sent.ok) {
          console.error(
            "[public-follow-request] invite send failed",
            sent.error ?? "unknown",
          );
        }
      } else {
        console.warn("[public-follow-request] RESEND_API_KEY missing; invite not sent");
      }
    }
  } catch (err) {
    console.error(
      "[public-follow-request] failed (returning sent)",
      err instanceof Error ? err.message : String(err),
    );
  }

  await sleepFloor(started);
  return jsonSent(headers);
});
