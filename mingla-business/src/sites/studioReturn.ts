/** Fixed Studio return route: a UUID can select a brand, never an arbitrary path. */
export function brandWebsiteReturnPath(value: unknown): string | null {
  return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ? `/brand/${value}/website`
    : null;
}
