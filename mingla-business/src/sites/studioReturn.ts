export const STUDIO_RETURN_RESULTS = [
  "exchange_expired",
  "session_expired",
  "preview_expired",
  "preview_publish",
] as const;

export type StudioReturnResult = (typeof STUDIO_RETURN_RESULTS)[number];

/** Fixed Studio return route: allowlisted context can never select an arbitrary path. */
export function brandWebsiteReturnPath(
  value: unknown,
  result?: unknown,
): string | null {
  if (!(typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ))) return null;
  const suffix =
    typeof result === "string" &&
    STUDIO_RETURN_RESULTS.includes(result as StudioReturnResult)
      ? `?studioResult=${encodeURIComponent(result)}`
      : "";
  return `/brand/${value}/website${suffix}`;
}
