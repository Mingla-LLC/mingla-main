/**
 * accountManagementOpen — #3645 handoff item 5.
 *
 * Card-rail "Add bank" opens Mingla-hosted `/connect-account-management`.
 * On Host web that must be a same-tab navigation with an HTTPS return URL —
 * `WebBrowser.openAuthSessionAsync` after an await is popup-blocked, and Done
 * used to ignore HTTPS `return_to` values.
 */

export const ACCOUNT_MANAGEMENT_NATIVE_RETURN =
  "mingla-business://onboarding-complete" as const;

/** HTTPS return to the brand Payments page (page origin only). */
export function buildAccountManagementWebReturnUrl(
  origin: string,
  brandId: string,
): string | null {
  if (typeof brandId !== "string" || brandId.length === 0) return null;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return null;
  }
  if (parsedOrigin.protocol !== "https:") return null;
  const url = new URL(
    `/brand/${encodeURIComponent(brandId)}/payments`,
    parsedOrigin.origin,
  );
  if (url.origin !== parsedOrigin.origin) return null;
  return url.toString();
}

/** Target URL must be same-origin hosted account-management with a session. */
export function isSafeAccountManagementTargetUrl(
  targetUrl: string,
  expectedOrigin: string,
): boolean {
  try {
    const parsed = new URL(targetUrl);
    const origin = new URL(expectedOrigin);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === origin.origin &&
      parsed.pathname === "/connect-account-management" &&
      (parsed.searchParams.get("session")?.trim().length ?? 0) > 0
    );
  } catch {
    return false;
  }
}

/**
 * Whether Done on the hosted account-management page may navigate to returnTo.
 * Native deep links always; HTTPS only when same origin as the page.
 */
export function isAllowedAccountManagementReturnTo(
  returnTo: string,
  pageOrigin: string,
): boolean {
  if (returnTo.startsWith("mingla-business://")) return true;
  if (!returnTo.startsWith("https://")) return false;
  try {
    const target = new URL(returnTo);
    const page = new URL(pageOrigin);
    return target.origin === page.origin;
  } catch {
    return false;
  }
}
