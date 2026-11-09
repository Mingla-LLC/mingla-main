// #4339 calendar sync — the growth-tools Resend send, shared by growth-tools-book
// (booking confirmation and "New Mingla call") and growth-tools-calendar-sync
// ("Call cancelled" / "Call moved"). Same sender (#1154 noreply identity), same
// sandbox guard, same failure handling as before it was shared.
//
// Reads NO environment for the key: each caller passes its own RESEND_API_KEY.
// Never throws: a mail failure is logged (status and a short detail, never the
// key) and answered false.

import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "./email/senders.ts";

export interface GrowthToolsEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo: string;
}

export async function sendGrowthToolsEmail(
  input: GrowthToolsEmail,
  options: { apiKey: string; logTag: string; fetchImpl?: typeof fetch },
): Promise<boolean> {
  if (!options.apiKey) {
    console.error(`[${options.logTag}] RESEND_API_KEY missing — skipping email`);
    return false;
  }
  // #1154 — the growth-tools funnel gets its own no-reply identity instead of the
  // shared `system` sender (a payments@ identity in prod). reply_to still routes
  // replies (to the lead / support@).
  const sender = EMAIL_SENDERS.noreply;
  try {
    assertNotResendSandbox(sender);
  } catch (e) {
    console.error(`[${options.logTag}] sandbox sender rejected`, String(e));
    return false;
  }
  const doFetch = options.fetchImpl ?? fetch;
  try {
    // no-attachment: growth-tools mail is plain transactional HTML.
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(sender),
        to: input.to,
        reply_to: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[${options.logTag}] resend failed`, res.status, detail.slice(0, 160));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[${options.logTag}] resend threw`, err instanceof Error ? err.message : String(err));
    return false;
  }
}
