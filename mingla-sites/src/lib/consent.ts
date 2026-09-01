export const CONSENT_KEY = "mingla_site_analytics_consent_v1";

export function hasGrantedAnalyticsConsent(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((cookiePair) => {
    const separator = cookiePair.indexOf("=");
    if (separator < 0) return false;
    const name = cookiePair.slice(0, separator).trim();
    const value = cookiePair.slice(separator + 1).trim();
    return name === CONSENT_KEY && value === "granted";
  });
}
