// #4273 — the SMS opt-out (marketing-unsubscribe). Kept out of index.ts so it
// can be exercised with a fake service client.
//
// Tester retest 3: Supabase serves an edge function's GET response as
// text/plain, so a confirm page rendered here shows raw HTML and nobody can
// opt out. The page lives in mingla-marketing at
// usemingla.com/unsubscribe/sms/<token> (the link a text carries goes there
// through marketing-track-click). This function only:
//   - GET:  redirects to that page (an older or hand-typed /unsubscribe/<token>
//           link). It never opts out on GET: link scanners fetch links.
//   - POST: does the opt-out and answers JSON for the page's one button.
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

/** Where the human page for an SMS opt-out token lives. */
export const SMS_OPT_OUT_PAGE = "https://usemingla.com/unsubscribe/sms";

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = err.message ?? "";
  return m.includes("duplicate key") || m.includes("unique constraint");
}

type OptOutResult =
  | { ok: true; state: "opted_out" }
  | { ok: false; error: "link_invalid" | "server" };

function json(body: OptOutResult, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// #4273 — the SMS opt-out. Seth's Q1: opting out covers the SENDING HOST's
// brands, for marketing only. So it writes a marketing_unsubscribes row scoped
// to the host account that owns the sending brand (the same table and the same
// account meaning the email opt-out and every quote reader use), never a
// global channel_suppressions row: tickets, RSVP and verification texts are
// unaffected.
export async function handleSmsOptOut(
  req: Request,
  payload: { campaign_id: string; brand_id: string; message_id: string },
  // deno-lint-ignore no-explicit-any
  admin: any,
  token: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${SMS_OPT_OUT_PAGE}/${encodeURIComponent(token)}`,
        "Cache-Control": "no-store",
      },
    });
  }
  const { data: message, error: messageErr } = await admin
    .from("marketing_messages")
    .select("id, recipient_phone")
    .eq("id", payload.message_id)
    .eq("campaign_id", payload.campaign_id)
    .eq("channel", "sms")
    .maybeSingle();
  const phone = (message as { recipient_phone?: string | null } | null)
    ?.recipient_phone;
  if (messageErr || typeof phone !== "string" || phone.trim() === "") {
    if (messageErr) {
      console.error("[marketing-unsubscribe] sms message lookup failed");
    }
    return json(
      { ok: false, error: messageErr ? "server" : "link_invalid" },
      messageErr ? 500 : 400,
    );
  }
  const { data: brand } = await admin
    .from("brands")
    .select("account_id")
    .eq("id", payload.brand_id)
    .maybeSingle();
  const accountId = (brand as { account_id?: string | null } | null)
    ?.account_id ?? null;
  const contactPhone = phone.trim();
  const scopeKey = accountId !== null
    ? { scope: "account", account_id: accountId }
    : { scope: "brand", brand_id: payload.brand_id };
  let existing = admin
    .from("marketing_unsubscribes")
    .select("id")
    .eq("contact_phone", contactPhone)
    .eq("channel", "sms")
    .eq("scope", scopeKey.scope);
  existing = accountId !== null
    ? existing.eq("account_id", accountId)
    : existing.eq("brand_id", payload.brand_id);
  const { data: already, error: readErr } = await existing.limit(1);
  if (readErr) {
    console.error("[marketing-unsubscribe] sms opt-out read failed");
    return json({ ok: false, error: "server" }, 500);
  }
  if ((already ?? []).length === 0) {
    const { error: insertErr } = await admin
      .from("marketing_unsubscribes")
      .insert({
        contact_phone: contactPhone,
        channel: "sms",
        reason: "sms_opt_out_link",
        ...scopeKey,
      });
    if (insertErr && !isUniqueViolation(insertErr)) {
      console.error("[marketing-unsubscribe] sms opt-out insert failed");
      return json({ ok: false, error: "server" }, 500);
    }
  }
  await admin
    .from("marketing_messages")
    .update({ status: "unsubscribed" })
    .eq("id", payload.message_id)
    .eq("campaign_id", payload.campaign_id);
  return json({ ok: true, state: "opted_out" }, 200);
}
