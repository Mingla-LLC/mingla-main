export type CanonicalShareFallback = {
  title: string;
  url: string;
  description?: string;
};

/**
 * Keep the known public destination usable if enhanced-card preparation has a
 * transient failure. Permanent not-public/authorization failures never call
 * this helper, so they remain fail-closed in the share sheet.
 */
export function canonicalShareFallback(input: CanonicalShareFallback): CanonicalShareFallback | null {
  try {
    const parsed = new URL(input.url.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const title = input.title.trim();
    if (!title) return null;
    const description = input.description?.trim();
    return { title, url: parsed.toString(), ...(description ? { description } : {}) };
  } catch {
    return null;
  }
}
