/**
 * #3682 — refuse reserved / obviously undeliverable email domains before
 * import or send. A blast of @example.com contacts hard-bounces 100% and
 * burns brand-level unsubscribes against campaigns.usemingla.com reputation.
 */

const RESERVED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "invalid",
  "localhost",
  "test",
  "local",
]);

export const UNDELIVERABLE_DOMAIN = "undeliverable_domain";

export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export function isUndeliverableEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (domain === null) return true;
  if (RESERVED_DOMAINS.has(domain)) return true;
  // Bare TLD leftovers like "com" after a bad parse.
  if (!domain.includes(".")) return true;
  return false;
}
