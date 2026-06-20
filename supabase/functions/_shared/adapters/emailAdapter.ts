// META-ORCH-1161 Sub-A — email adapter.
//
// Thin wrapper over the existing Resend transactional render (_shared/email
// renderTransactionalEmail, generic_notification variant) → Resend HTTP. The
// dispatcher never touches Resend HTTP directly. The marketing render path stays
// in marketing-send (Sub-B); this adapter is the TRANSACTIONAL leg only.

import {
  formatSenderHeader,
  renderTransactionalEmail,
} from "../email/index.ts";
import type { AdapterResult } from "./smsAdapter.ts";

export interface EmailSendInput {
  to: string;
  title: string;
  body: string; // plain paragraphs separated by \n\n
  cta?: { label: string; url: string };
}

export const emailAdapter = {
  async send(input: EmailSendInput): Promise<AdapterResult> {
    const to = input.to?.trim() ?? "";
    if (!to) {
      return { ok: false, status: "skipped", providerMessageId: null, error: "no_recipient" };
    }
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      return { ok: false, status: "failed", providerMessageId: null, error: "RESEND_API_KEY missing" };
    }

    let rendered;
    try {
      rendered = renderTransactionalEmail({
        variant: "generic_notification",
        recipient: { name: null, email: to },
        body: {
          variant: "generic_notification",
          title: input.title,
          paragraphs: input.body.split("\n\n"),
          cta: input.cta ?? null,
        },
      });
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      // no-attachment: META-ORCH-1161 transactional notification emails (reservation
      // changed/cancelled, reminders, refunds, order-cancelled) carry no PDF/file —
      // the ticket-PDF/.ics path stays in ticket-confirmation-dispatch (ORCH-0785-A).
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
        return {
          ok: false,
          status: "failed",
          providerMessageId: null,
          error: `Resend ${res.status}: ${await res.text()}`,
        };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return {
        ok: true,
        status: "sent",
        providerMessageId: data.id ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
