// #3872 R3 — the only pre-hire DTO builders. Keep the explicit allow-lists.
export const PUBLIC_GIG_KEYS = [
  "id",
  "title_public",
  "brief_public",
  "format_key",
  "deliverables",
  "city_name",
  "category",
  "shoot_window",
  "post_by",
  "usage_days",
  "budget_band",
  "sales_share_bps",
  "slots_left",
] as const;
export const PREHIRE_CREATOR_KEYS = [
  "id",
  "display_name",
  "avatar",
  "city_name",
  "niches",
  "languages",
  "follower_bands",
  "showcase",
  "rating",
  "completed",
  "reliability",
  "packages",
] as const;

type Row = Record<string, unknown>;
const pick = (row: Row, keys: readonly string[]): Row =>
  Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));

export function toPublicGig(row: Row): Row {
  const dto = pick(row, PUBLIC_GIG_KEYS);
  dto.deliverables = Array.isArray(row.deliverables)
    ? row.deliverables.map((item) => {
      const value = item && typeof item === "object" ? item as Row : {};
      return pick(value, ["platform", "kind", "count"]);
    })
    : [];
  return dto;
}

export function toPrehireCreator(row: Row): Row {
  const dto = pick(row, PREHIRE_CREATOR_KEYS);
  dto.follower_bands = Array.isArray(row.follower_bands)
    ? row.follower_bands.map((item) => {
      const value = item && typeof item === "object" ? item as Row : {};
      return pick(value, ["platform", "band", "verified"]);
    })
    : [];
  dto.showcase = Array.isArray(row.showcase)
    ? row.showcase.map((item) => {
      const value = item && typeof item === "object" ? item as Row : {};
      return pick(value, ["media_id", "thumb"]);
    })
    : [];
  return dto;
}

export function lintAnonymousCopy(
  copy: string,
  privateNames: string[] = [],
): string[] {
  const hits = new Set<string>();
  if (/(?:https?:\/\/|www\.)/i.test(copy)) hits.add("url");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(copy)) hits.add("email");
  if (/(?:^|[^0-9])\+?[0-9][0-9 ()-]{7,}[0-9]/.test(copy)) hits.add("phone");
  if (/(?:^|\s)@[a-z0-9_.-]+/i.test(copy)) hits.add("handle");
  for (
    const name of privateNames.map((value) => value.trim()).filter((value) =>
      value.length >= 2
    )
  ) {
    if (copy.toLocaleLowerCase().includes(name.toLocaleLowerCase())) {
      hits.add("private_name");
    }
  }
  return [...hits].sort();
}

export function containsPrivateContact(value: unknown): boolean {
  const text = JSON.stringify(value);
  return lintAnonymousCopy(text).length > 0;
}
