// Issue #3802 — an invited person opens their one-time invite link.
//
// Called from the admin app's "Accept your invite" screen, by someone who is
// not signed in yet, when they press Continue (never on page load). It checks
// the link, ties it to the account for the invited address, and answers with
// a single-use sign-in for that address so they can choose a password.
//
// Order matters: the sign-in is prepared BEFORE the link is used up, so a
// provider failure never costs the person their link, and it is handed back
// only AFTER the link was used successfully.
//
// Every handled outcome answers 200 with a `state` field:
//   ok | used | expired | invalid | account_conflict | try_again
// "account_conflict" also carries the invited address, so the screen can say
// which address needs a different invite. No other refusal carries it.
// Nothing about the link or the sign-in is ever logged.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  accountVerdict,
  isInviteToken,
  sha256Hex,
} from "../_shared/adminTeamInvite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

/** Only these states leave the function for a link that is not usable. */
function closedState(state: unknown): "used" | "expired" | "invalid" {
  return state === "used" || state === "expired" ? state : "invalid";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ state: "invalid" }, 400);
  }

  try {
    let presented: unknown;
    try {
      presented = (await req.json())?.token;
    } catch (_err) {
      return jsonResponse({ state: "invalid" }, 400);
    }
    if (!isInviteToken(presented)) {
      return jsonResponse({ state: "invalid" });
    }
    const stored = await sha256Hex(presented);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. What state is this invitation in? Changes nothing.
    const peek = async () =>
      await admin.rpc("admin_team_invite_peek", { p_token_hash: stored });
    let { data: seen, error: seenError } = await peek();
    if (seenError || !seen) {
      console.error("[admin-team-accept-invite] lookup failed");
      return jsonResponse({ state: "try_again" });
    }
    if (seen.state !== "pending") {
      return jsonResponse({ state: closedState(seen.state) });
    }

    // 2. The account for the invited address.
    let userId: string | null = seen.user_id ?? null;
    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email: seen.email,
        email_confirm: true,
      });
      if (!created.error && created.data.user) {
        userId = created.data.user.id;
      } else {
        // The address may have been registered in the meantime: look once more.
        ({ data: seen, error: seenError } = await peek());
        if (seenError || !seen) {
          console.error("[admin-team-accept-invite] lookup failed");
          return jsonResponse({ state: "try_again" });
        }
        if (seen.state !== "pending") {
          return jsonResponse({ state: closedState(seen.state) });
        }
        userId = seen.user_id ?? null;
        if (!userId) {
          console.error("[admin-team-accept-invite] account step failed");
          return jsonResponse({ state: "try_again" });
        }
      }
    }

    const existing = await admin.auth.admin.getUserById(userId);
    if (existing.error || !existing.data.user) {
      console.error("[admin-team-accept-invite] account step failed");
      return jsonResponse({ state: "try_again" });
    }
    // One rule, defined in the database and already applied when the
    // invitation was sent: an account that can sign in any way other than
    // email cannot be given team access. It is asked again here, because the
    // account may have changed since, and the account the sign-in service
    // returned is judged by the same rule.
    const { data: verdict, error: verdictError } = await admin.rpc(
      "admin_team_invite_address_verdict",
      { p_email: seen.email },
    );
    if (verdictError || (verdict !== "ok" && verdict !== "conflict")) {
      console.error("[admin-team-accept-invite] account step failed");
      return jsonResponse({ state: "try_again" });
    }
    if (
      verdict === "conflict" ||
      accountVerdict(existing.data.user, seen.email) === "conflict"
    ) {
      // Nothing is used up: the person can come back to the same email.
      // The address is named so they can ask for an invite to another one;
      // they hold the pending link for it (the "ok" answer names it too).
      return jsonResponse({ state: "account_conflict", email: seen.email });
    }

    // 3. Prepare the single-use sign-in for that address.
    const signIn = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: seen.email,
    });
    const exchange = signIn.data?.properties?.hashed_token;
    const exchangeType = signIn.data?.properties?.verification_type;
    if (signIn.error || !exchange || !exchangeType) {
      console.error("[admin-team-accept-invite] sign-in step failed");
      return jsonResponse({ state: "try_again" });
    }
    if (signIn.data.user?.id !== userId) {
      // The sign-in must be for the very account the invitation is tied to.
      return jsonResponse({ state: "account_conflict", email: seen.email });
    }

    // 4. Use the invitation up, for this account. Works once.
    const { data: opened, error: openError } = await admin.rpc(
      "admin_team_redeem_invite",
      { p_token_hash: stored, p_user_id: userId },
    );
    if (openError || !opened) {
      console.error("[admin-team-accept-invite] open step failed");
      return jsonResponse({ state: "try_again" });
    }
    if (opened.state !== "redeemed") {
      return jsonResponse({ state: closedState(opened.state) });
    }

    return jsonResponse({
      state: "ok",
      email: opened.email,
      role: opened.role,
      token_hash: exchange,
      type: exchangeType,
    });
  } catch (_err) {
    console.error("[admin-team-accept-invite] unexpected failure");
    return jsonResponse({ state: "try_again" });
  }
});
