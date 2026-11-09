// #4273 — the SMS opt-out link's page (marketing-unsubscribe). Kept out of
// index.ts so it can be exercised with a fake service client.
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import { escapeHtml } from "../_shared/email/escape.ts";

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err.code === "23505") return true;
  const m = err.message ?? "";
  return m.includes("duplicate key") || m.includes("unique constraint");
}

function htmlMessage(title: string, body: string, status: number): Response {
  return htmlPage(
    title,
    `<p style="margin:0;font-size:14px;line-height:1.55;color:#5B6172;">${
      escapeHtml(body)
    }</p>`,
    status,
  );
}

// #4273 — the SMS opt-out. Seth's Q1: opting out covers the SENDING HOST's
// brands, for marketing only. So it writes a marketing_unsubscribes row scoped
// to the host account that owns the sending brand (the same table and the same
// account meaning the email opt-out and every quote reader use), never a
// global channel_suppressions row: tickets, RSVP and verification texts are
// unaffected. A GET only shows a confirm page (link scanners and previews
// fetch links); the opt-out happens on the page's one-button POST.
export async function handleSmsOptOut(
  req: Request,
  payload: { campaign_id: string; brand_id: string; message_id: string },
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<Response> {
  if (req.method !== "POST") return htmlSmsConfirmPage();
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
    return htmlMessage(
      "This opt-out link is no longer valid",
      "Email support@usemingla.com with the number you want removed and " +
        "we'll stop texting it manually.",
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
    return htmlMessage(
      "Unsubscribe failed",
      "Something went wrong on our side. Email support@usemingla.com " +
        "and we'll stop texting you manually.",
      500,
    );
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
      return htmlMessage(
        "Unsubscribe failed",
        "Something went wrong on our side. Email support@usemingla.com " +
          "and we'll stop texting you manually.",
        500,
      );
    }
  }
  await admin
    .from("marketing_messages")
    .update({ status: "unsubscribed" })
    .eq("id", payload.message_id)
    .eq("campaign_id", payload.campaign_id);
  return htmlMessage(
    "You won't get marketing texts from this host anymore.",
    "This number is opted out of marketing texts from every brand this host " +
      "runs on Mingla. Ticket and RSVP texts still reach you. If this was a " +
      "mistake, email support@usemingla.com.",
    200,
  );
}

function htmlSmsConfirmPage(): Response {
  return htmlPage(
    "Stop marketing texts?",
    `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#5B6172;">
      You'll stop getting marketing texts from every brand this host runs on
      Mingla. Ticket and RSVP texts still reach you.
    </p>
    <form method="post">
      <button type="submit" style="appearance:none;border:0;border-radius:999px;background:#FF6B2C;color:#FFFFFF;font-size:15px;font-weight:600;padding:12px 22px;cursor:pointer;">
        Stop marketing texts
      </button>
    </form>`,
    200,
  );
}

export function htmlPage(
  title: string,
  innerHtml: string,
  status: number,
): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)} — Mingla</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F1115;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:16px;padding:28px;">
            <tr>
              <td>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;">${
    escapeHtml(title)
  }</h1>
                ${innerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
