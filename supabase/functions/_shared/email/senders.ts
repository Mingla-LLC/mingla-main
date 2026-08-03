// ORCH-0785 — Sender identity constants for Mingla transactional email.
// I-PROPOSED-AE RESEND_NO_SANDBOX_SENDER: no code path may send Resend
// email from *@resend.dev. `assertNotResendSandbox` runs before every POST.
import { resolveEmailSenderValue } from "../secretBundle.ts";

export interface SenderIdentity {
  name: string;
  address: string;
}

function resolveSender(
  envKey: string,
  bundleField: "admin_from" | "system_from" | "ticket_from" | null,
  defaultName: string,
  defaultAddress: string,
): SenderIdentity {
  const raw = bundleField
    ? resolveEmailSenderValue(bundleField, envKey)
    : Deno.env.get(envKey);
  if (raw === undefined || raw.trim().length === 0) {
    return { name: defaultName, address: defaultAddress };
  }
  const match = raw.trim().match(/^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/);
  if (match === null) throw new Error(`email_sender_invalid:${envKey}`);
  return { name: (match[1] ?? defaultName).trim(), address: match[2] };
}

export const EMAIL_SENDERS = {
  tickets: resolveSender(
    "RESEND_TICKET_FROM",
    "ticket_from",
    "Mingla",
    "tickets@usemingla.com",
  ),
  admin: resolveSender("RESEND_ADMIN_FROM", "admin_from", "Mingla", "hello@usemingla.com"),
  system: resolveSender(
    "RESEND_SYSTEM_FROM",
    "system_from",
    "Mingla",
    "notifications@usemingla.com",
  ),
  // #1154 — a dedicated no-reply identity for the growth-tools funnel (report
  // summaries + booking confirmations) so those emails stop inheriting the shared
  // `system` sender (a payments@ identity in prod). Replies still route via the
  // per-message reply_to (support@usemingla.com). Env-overridable; domain-level
  // Resend verification on usemingla.com covers this local-part.
  noreply: resolveSender("RESEND_NOREPLY_FROM", null, "Mingla", "noreply@usemingla.com"),
} as const;

export function assertNotResendSandbox(sender: SenderIdentity): void {
  if (sender.address.toLowerCase().endsWith("@resend.dev")) {
    throw new Error("email_sender_resend_sandbox_forbidden");
  }
}

export function formatSenderHeader(sender: SenderIdentity): string {
  return `${sender.name} <${sender.address}>`;
}
