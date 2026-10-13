// Issue #3802 — the owner sends (or re-sends) a team invitation.
//
// A team invitation is tied to the invited person with a one-time link that
// expires. The secret half of the link is made here, stored only as a hash,
// and exists in exactly one other place: the email sent to the invited
// address. It is never logged and never returned to the caller.
//
// Who may invite is decided by the database (owner only). This function holds
// no gate of its own: it calls the database as the signed-in caller.
//
// The database also refuses an address that cannot take team access because
// its account signs in another way (code `address_in_use`). Like every other
// refusal it reaches the caller as `{ ok: false, code }` and no email is sent.
//
// Every handled outcome answers 200 with an `ok` field. Malformed requests
// answer 400; a missing or rejected sign-in answers 401.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "../_shared/email/index.ts";
import {
  buildInviteLink,
  generateInviteToken,
  INVITE_ROLE_LABELS,
  resolveAdminOrigin,
  sha256Hex,
} from "../_shared/adminTeamInvite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The database answers with a message that starts with a short code. */
function errorCode(message: unknown): string {
  const match = String(message ?? "").trim().match(/^[a-z_]+/);
  return match ? match[0] : "error";
}

async function sendInviteEmail(input: {
  to: string;
  actorEmail: string;
  roleLabel: string;
  url: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[admin-team-invite] email provider is not configured");
    return false;
  }
  try {
    const sender = EMAIL_SENDERS.admin;
    assertNotResendSandbox(sender);
    const rendered = renderTransactionalEmail({
      variant: "admin_compose",
      recipient: { name: null, email: input.to },
      body: {
        variant: "admin_compose",
        title: "You're invited to Mingla Admin",
        paragraphs: [
          `${input.actorEmail} invited you to Mingla Admin as ${input.roleLabel}.`,
          "Open the link below to choose your password. The link works once and expires in 7 days.",
          "If you weren't expecting this, you can ignore this email.",
        ],
        cta: { label: "Accept invite", url: input.url },
      },
      sender,
    });
    // no-attachment: an invitation is subject + body only.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(rendered.from),
        to: [input.to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    if (!res.ok) {
      // Provider name and HTTP status only. Never the request or the reply.
      console.error("[admin-team-invite] resend answered", res.status);
      await res.body?.cancel();
      return false;
    }
    await res.body?.cancel();
    return true;
  } catch (_err) {
    console.error("[admin-team-invite] resend could not be reached");
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, code: "bad_request" }, 400);
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) {
      return jsonResponse({ ok: false, code: "not_authenticated" }, 401);
    }

    let email: unknown;
    let role: unknown;
    try {
      const parsed = await req.json();
      email = parsed?.email;
      role = parsed?.role;
    } catch (_err) {
      return jsonResponse({ ok: false, code: "bad_request" }, 400);
    }
    if (typeof email !== "string" || typeof role !== "string") {
      return jsonResponse({ ok: false, code: "bad_request" }, 400);
    }

    // The caller's own client: the database sees the caller, not this function.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth
      .getUser(authHeader.replace(/^Bearer\s+/i, ""));
    const actorEmail = userData?.user?.email;
    if (userError || !actorEmail) {
      return jsonResponse({ ok: false, code: "not_authenticated" }, 401);
    }

    const secret = generateInviteToken();
    const stored = await sha256Hex(secret);

    const { data: issued, error: issueError } = await userClient.rpc(
      "admin_team_issue_invite",
      { p_email: email, p_role: role, p_token_hash: stored },
    );
    if (issueError || !issued) {
      const code = errorCode(issueError?.message);
      console.error("[admin-team-invite] refused:", code);
      return jsonResponse({ ok: false, code });
    }

    const emailSent = await sendInviteEmail({
      to: issued.email,
      actorEmail,
      roleLabel: INVITE_ROLE_LABELS[issued.role] ?? issued.role,
      url: buildInviteLink(
        resolveAdminOrigin(req.headers.get("origin")),
        secret,
      ),
    });

    return jsonResponse({
      ok: true,
      email: issued.email,
      role: issued.role,
      status: issued.status,
      changed: issued.changed,
      expires_at: issued.expires_at,
      email_sent: emailSent,
    });
  } catch (_err) {
    console.error("[admin-team-invite] unexpected failure");
    return jsonResponse({ ok: false, code: "error" });
  }
});
