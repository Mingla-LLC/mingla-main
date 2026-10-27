/**
 * #2829 W10 — is this link to another site (an outbound click)? Only http(s)
 * links to a different origin; mail, phone and in-site links are not.
 */
export function outboundTarget(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === origin ? null : url.origin;
  } catch {
    return null;
  }
}
