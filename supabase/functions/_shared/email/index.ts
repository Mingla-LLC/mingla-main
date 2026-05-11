// ORCH-0785 — Public surface of the shared transactional email module.
// I-PROPOSED-AD EMAIL_BRAND_SHELL_SINGLETON: every customer-facing email
// rendered server-side flows through `renderTransactionalEmail`.

import { renderShell } from "./shell.ts";
import { renderTicketBody } from "./ticketBody.ts";
import { renderGenericBody } from "./genericBody.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  type SenderIdentity,
} from "./senders.ts";
import { escapeHtml } from "./escape.ts";
import type {
  EmailVariant,
  GenericBodyInput,
  RenderInput,
  RenderResult,
  TicketBodyInput,
} from "./types.ts";

const DEFAULT_SUPPORT_EMAIL = "support@usemingla.com";

function resolveSender(variant: EmailVariant): SenderIdentity {
  switch (variant) {
    case "ticket_confirmation_paid":
    case "ticket_confirmation_free":
    case "ticket_confirmation_pending":
      return EMAIL_SENDERS.tickets;
    case "admin_compose":
      return EMAIL_SENDERS.admin;
    case "generic_notification":
      return EMAIL_SENDERS.system;
    default: {
      // Exhaustiveness sentinel; any new variant must be wired explicitly.
      const _exhaustive: never = variant;
      throw new Error(`email_variant_unrouted:${String(_exhaustive)}`);
    }
  }
}

function requireEnv(key: string, fallback?: string): string {
  const raw = Deno.env.get(key);
  if (raw && raw.trim().length > 0) return raw.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`email_env_missing:${key}`);
}

export function renderTransactionalEmail(input: RenderInput): RenderResult {
  const supportEmail = input.supportEmail ??
    Deno.env.get("SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
  // Logo URL is required in production. Tests may inject MINGLA_LOGO_URL.
  const logoUrl = requireEnv(
    "MINGLA_LOGO_URL",
    Deno.env.get("DENO_TESTING") === "1"
      ? "https://usemingla.com/email-assets/mingla-logo.png"
      : undefined,
  );
  const footerAddress = requireEnv(
    "MINGLA_FOOTER_ADDRESS",
    Deno.env.get("DENO_TESTING") === "1"
      ? "Mingla, hello@usemingla.com"
      : undefined,
  );

  let bodyHtml: string;
  let text: string;
  let subject: string;
  let preheader: string;

  switch (input.body.variant) {
    case "ticket_confirmation_paid":
    case "ticket_confirmation_free":
    case "ticket_confirmation_pending": {
      const rendered = renderTicketBody(input.body as TicketBodyInput);
      bodyHtml = rendered.html;
      text = rendered.text;
      subject = rendered.subject;
      preheader = rendered.preheader;
      break;
    }
    case "generic_notification":
    case "admin_compose": {
      const rendered = renderGenericBody(input.body as GenericBodyInput);
      bodyHtml = rendered.html;
      text = rendered.text;
      subject = rendered.subject;
      preheader = rendered.preheader;
      break;
    }
    default: {
      const _exhaustive: never = input.body;
      throw new Error(`email_body_variant_unrouted:${String(_exhaustive)}`);
    }
  }

  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail,
    logoUrl,
    footerAddress,
  });

  const from = input.sender ?? resolveSender(input.variant);
  assertNotResendSandbox(from);

  return { subject, html, text, from };
}

export {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  escapeHtml,
  formatSenderHeader,
};
export type {
  EmailVariant,
  GenericBodyInput,
  RenderInput,
  RenderResult,
  SenderIdentity,
  TicketBodyInput,
};
