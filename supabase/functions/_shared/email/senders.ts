// ORCH-0785 — Sender identity constants for Mingla transactional email.
// I-PROPOSED-AE RESEND_NO_SANDBOX_SENDER: no code path may send Resend
// email from *@resend.dev. `assertNotResendSandbox` runs before every POST.

export interface SenderIdentity {
  name: string;
  address: string;
}

function resolveSender(
  envKey: string,
  defaultName: string,
  defaultAddress: string,
): SenderIdentity {
  const raw = Deno.env.get(envKey);
  if (raw === undefined || raw.trim().length === 0) {
    return { name: defaultName, address: defaultAddress };
  }
  const match = raw.trim().match(/^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/);
  if (match === null) throw new Error(`email_sender_invalid:${envKey}`);
  return { name: (match[1] ?? defaultName).trim(), address: match[2] };
}

export const EMAIL_SENDERS = {
  tickets: resolveSender("RESEND_TICKET_FROM", "Mingla", "tickets@usemingla.com"),
  admin: resolveSender("RESEND_ADMIN_FROM", "Mingla", "hello@usemingla.com"),
  system: resolveSender("RESEND_SYSTEM_FROM", "Mingla", "notifications@usemingla.com"),
} as const;

export function assertNotResendSandbox(sender: SenderIdentity): void {
  if (sender.address.toLowerCase().endsWith("@resend.dev")) {
    throw new Error("email_sender_resend_sandbox_forbidden");
  }
}

export function formatSenderHeader(sender: SenderIdentity): string {
  return `${sender.name} <${sender.address}>`;
}
