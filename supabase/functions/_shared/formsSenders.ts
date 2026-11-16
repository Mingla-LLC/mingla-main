// formsSenders.ts — #4452 §5.6, A1.10 (Seth's 16 Nov answers, Q-5): who form
// emails come from and where team alerts go.
//
// Team alerts go to exactly info@ and seth@ (A1-SC-28), with Reply-To the
// person. Until a team mailbox exists (TEAM_MAILBOXES_EXIST), every form email
// is sent From noreply@ under the team's display name, with Reply-To info@.
// support@ and unsubscribe@ are not used; only the https one-click URL is.
// Domain-level Resend verification on usemingla.com covers every local part.
//
// Invariant I-4452-TEAM-ALERT-TO (declared in its test): team alerts go to exactly info@ and seth@ (sender tests A1-T-10).

export const TEAM_ALERT_TO = ["info@usemingla.com", "seth@usemingla.com"] as const;

/** One flag to flip when the creators@ / locals@ / hosts@ inboxes exist. */
export const TEAM_MAILBOXES_EXIST = false;

export const FALLBACK_FROM = "noreply@usemingla.com";
export const FALLBACK_REPLY_TO = "info@usemingla.com";

export type FormFrom = "creators" | "locals" | "hosts" | "seth";
export type FormTeamTo = "creators_inbox" | "locals_inbox" | "hosts_inbox" | "owner" | "seth";

const IDENTITIES: Record<FormFrom, { name: string; address: string }> = {
  creators: { name: "Mingla Creators", address: "creators@usemingla.com" },
  locals: { name: "Mingla Locals", address: "locals@usemingla.com" },
  hosts: { name: "Mingla", address: "hosts@usemingla.com" },
  seth: { name: "Seth at Mingla", address: "seth@usemingla.com" },
};

/** The From and Reply-To of a person-facing form email. */
export function formSender(from: FormFrom): { from: string; replyTo: string } {
  const id = IDENTITIES[from] ?? IDENTITIES.hosts;
  if (TEAM_MAILBOXES_EXIST) return { from: `${id.name} <${id.address}>`, replyTo: id.address };
  return { from: `${id.name} <${FALLBACK_FROM}>`, replyTo: FALLBACK_REPLY_TO };
}

/** Team alert recipients. Every inbox maps to the two Q-5 addresses until team inboxes exist. */
export function teamAlertTo(_to: FormTeamTo): string[] {
  return [...TEAM_ALERT_TO];
}

/** A team alert's From (the team sender, else noreply@). Its Reply-To is always the person. */
export function teamAlertFrom(): string {
  return TEAM_MAILBOXES_EXIST ? "Mingla Forms <forms@usemingla.com>" : `Mingla Forms <${FALLBACK_FROM}>`;
}
