/** Native has no public-site browser handoff. */
export const getStoredSiteAttribution = (): null => null;

/** Native checkout has no public-site browser handoff. */
export async function siteAttributionPayload(
  read: (() => string | null) | null = getStoredSiteAttribution,
): Promise<{ site_attribution_token?: string }> {
  try {
    const token = read?.() ?? null;
    return token === null ? {} : { site_attribution_token: token };
  } catch {
    return {};
  }
}

export default siteAttributionPayload;
