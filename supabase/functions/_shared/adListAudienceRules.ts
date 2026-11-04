/**
 * Issue #4238 wave 2 — the single owner of customer-list and lookalike rules.
 *
 * Pure. Platform minimums, batch sizes and identifier sets live here so they
 * can be adjusted without a migration. The audience binding check used at
 * freeze and at create also lives here, so both edges share one rule.
 */

export type ListPlatform = "meta" | "snapchat" | "tiktok" | "reddit" | "google";
export type LookalikePlatform = Exclude<ListPlatform, "google">;
export type ListAudienceKind = "list" | "lookalike";

/**
 * Mingla-side precheck before a provider audience is created.
 * - Meta: lists match at about 100 (lookalike seed rule below).
 *   https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences
 * - Snap: targetable at about 1,000 matched users (creator docs).
 *   https://developers.snap.com/marketing-api/Creator-Ads/AudienceTargeting
 * - TikTok: a customer file needs at least 1,000 entries, and updates fail
 *   below 1,000.
 *   https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/CustomAudienceUpdateBody.md
 * - Reddit: vendors report 1,000 matched users (unverified, O-3).
 *   https://docs.amperity.com/operator/destination_reddit_ads.html
 * - Google: recommends 5,000+, shows 0 below 100.
 *   https://developers.google.com/google-ads/api/docs/remarketing/audience-segments/customer-match/get-started
 */
export const LIST_MIN: Readonly<Record<ListPlatform, number>> = Object.freeze({
  meta: 100,
  snapchat: 1000,
  tiktok: 1000,
  reddit: 1000,
  google: 1000,
});

/**
 * Seed members needed in the lookalike's country.
 * - Meta: at least 100 per country (allow_international_seeds stays off).
 *   https://developers.facebook.com/docs/marketing-api/audiences/guides/lookalike-audiences
 * - Snap: 1,000 (creator docs).
 *   https://developers.snap.com/api/marketing-api/Ads-API/audience-creation/lookalikes
 * - TikTok: seed file needs 1,000 entries.
 *   https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/DmpcustomAudiencelookalikecreateLookalikeSpec.md
 * - Reddit: 1,000 (vendor-reported, unverified).
 */
export const LOOKALIKE_SEED_MIN_PER_COUNTRY: Readonly<
  Record<LookalikePlatform, number>
> = Object.freeze({ meta: 100, snapchat: 1000, tiktok: 1000, reddit: 1000 });

export const LOOKALIKE_PLATFORMS: readonly LookalikePlatform[] = Object.freeze([
  "meta",
  "snapchat",
  "tiktok",
  "reddit",
]);
export const LIST_PLATFORMS: readonly ListPlatform[] = Object.freeze([
  ...LOOKALIKE_PLATFORMS,
  "google",
]);

/**
 * Rows per request.
 * - Meta users edge: 10,000 per request (custom-audiences guide).
 * - Snap segment users: 100,000 per request (customer-lists guide).
 *   https://developers.snap.com/api/marketing-api/Ads-API/audience-creation/customer-lists
 * - Reddit users PATCH: 2,500 per call (vendor docs).
 * - Google Data Manager: 10,000 recommended.
 *   https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/upload-data
 * - TikTok: per uploaded file.
 */
export const BATCH: Readonly<Record<ListPlatform, number>> = Object.freeze({
  meta: 10000,
  snapchat: 100000,
  reddit: 2500,
  google: 10000,
  tiktok: 50000,
});

/** Hash columns each platform accepts (Reddit has no phone identifier). */
export const IDENTIFIERS: Readonly<Record<ListPlatform, readonly string[]>> =
  Object.freeze({
    meta: ["email_sha256", "phone_sha256"],
    snapchat: ["email_sha256", "phone_sha256"],
    tiktok: ["email_sha256", "phone_sha256"],
    reddit: ["email_sha256"],
    google: ["email_google_or_sha256", "phone_e164_sha256"],
  });

/** Provider name length limits (Snap 375, TikTok 128, others 100 by policy). */
const PROVIDER_NAME_MAX: Readonly<Record<ListPlatform, number>> = Object.freeze({
  meta: 100,
  snapchat: 375,
  tiktok: 128,
  reddit: 100,
  google: 100,
});

/** The brand marker every provider audience carries. */
export function audienceProviderName(input: {
  ownerKind: "mingla" | "host";
  brandName?: string | null;
  brandId?: string | null;
  displayName: string;
  country?: string | null;
  platform?: ListPlatform;
}): string {
  // deno-lint-ignore no-control-regex
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim();
  const name = clean(input.displayName) || "Audience";
  const country = input.country ? clean(input.country) : "";
  // A lookalike's display name already ends "(NG)"; never repeat it.
  const suffix = country && !name.includes(`(${country})`) ? ` · ${country}` : "";
  const label = input.ownerKind === "host"
    ? `Mingla · ${clean(input.brandName ?? "") || "Brand"} [${
      String(input.brandId ?? "").slice(0, 8)
    }] · ${name}${suffix}`
    : `Mingla · ${name}${suffix}`;
  const max = Math.min(100, PROVIDER_NAME_MAX[input.platform ?? "meta"]);
  return label.slice(0, max);
}

/**
 * How many more people the Mingla-side minimum needs, or null when it is met.
 * A lookalike counts the seed's members in its country.
 */
export function neededCount(
  platform: ListPlatform,
  kind: ListAudienceKind,
  memberCount: number,
  countryCount: number | null = null,
): number | null {
  if (kind === "lookalike") {
    if (platform === "google") return null;
    const min = LOOKALIKE_SEED_MIN_PER_COUNTRY[platform];
    const have = Math.max(0, Math.floor(countryCount ?? 0));
    return have >= min ? null : min - have;
  }
  const have = Math.max(0, Math.floor(memberCount));
  return have >= LIST_MIN[platform] ? null : LIST_MIN[platform] - have;
}

export type HostAudiencePlatformState = {
  platform: string;
  state: string;
  needed_count: number | null;
};

/**
 * #4238 host_setup: one state per picked app for a Host audience. A state the
 * worker already wrote wins. Before the worker's first pass the state must
 * still be true: Google Customer Match needs an eligible account (the worker
 * marks it ineligible until then), Reddit lists are not built yet (O-3), and
 * Google has no lookalikes, so a lookalike never gets a Google line.
 */
export function hostAudiencePlatformStates(input: {
  kind: ListAudienceKind;
  platforms: readonly string[];
  known: readonly HostAudiencePlatformState[];
  memberCount: number;
  countryCount: number | null;
}): HostAudiencePlatformState[] {
  return input.platforms
    .filter((platform) => input.kind === "list" || platform !== "google")
    .map((platform) => {
      const found = input.known.find((item) => item.platform === platform);
      if (found) return found;
      if (platform === "google") {
        return { platform, state: "ineligible", needed_count: null };
      }
      if (platform === "reddit") {
        return { platform, state: "unsupported", needed_count: null };
      }
      if (!(LIST_PLATFORMS as readonly string[]).includes(platform)) {
        return { platform, state: "unsupported", needed_count: null };
      }
      const needed = neededCount(
        platform as ListPlatform,
        input.kind,
        input.memberCount,
        input.countryCount,
      );
      return {
        platform,
        state: needed === null ? "pending" : "below_minimum",
        needed_count: needed,
      };
    });
}

export type AudienceSelection = {
  include_keys: string[];
  /** #4238: leave out people who already bought (the brand's past guests). */
  exclude_keys?: string[];
};

const KEY_RE =
  /^(mingla:[a-z_]+:[a-z0-9_:-]+|brand:[0-9a-f-]{36}:[a-z_]+(:[A-Z]{2})?)$/;

/**
 * create_version validation (#4238 I-4238-AUDIENCE-SERVER-BOUND). Hosts may
 * select only their own brand's visible keys; Admin (mingla) plans any key.
 * The returned selection is written into canonical_plan before hashing.
 */
export function validateAudienceSelection(input: {
  raw: unknown;
  ownerKind: string;
  planBrandId: string | null;
}):
  | { ok: true; selection: AudienceSelection }
  | { ok: false; detail: string } {
  if (input.raw === undefined || input.raw === null) {
    return { ok: true, selection: { include_keys: [] } };
  }
  if (typeof input.raw !== "object" || Array.isArray(input.raw)) {
    return { ok: false, detail: "audience_selection_invalid" };
  }
  const rawExclude = (input.raw as Record<string, unknown>).exclude_keys;
  let excludeKeys: string[] | null = null;
  if (rawExclude !== undefined) {
    if (
      !Array.isArray(rawExclude) || rawExclude.length > 1 ||
      rawExclude.some((key) => typeof key !== "string" || !KEY_RE.test(key))
    ) {
      return { ok: false, detail: "audience_selection_invalid" };
    }
    // #4238: a Host may leave out only its own past guests.
    if (
      input.ownerKind === "host" &&
      rawExclude.some((key) =>
        key !== `brand:${String(input.planBrandId ?? "").toLowerCase()}:guests`
      )
    ) {
      return { ok: false, detail: "audience_not_owned" };
    }
    excludeKeys = rawExclude.length > 0 ? [...rawExclude as string[]] : null;
  }
  const withExclude = (selection: AudienceSelection): AudienceSelection =>
    excludeKeys ? { ...selection, exclude_keys: excludeKeys } : selection;
  const keys = (input.raw as Record<string, unknown>).include_keys;
  if (keys === undefined) {
    return { ok: true, selection: withExclude({ include_keys: [] }) };
  }
  if (
    !Array.isArray(keys) || keys.length > 3 ||
    keys.some((key) => typeof key !== "string" || !KEY_RE.test(key)) ||
    new Set(keys).size !== keys.length
  ) {
    return { ok: false, detail: "audience_selection_invalid" };
  }
  if (input.ownerKind === "host") {
    const prefix = `brand:${String(input.planBrandId ?? "").toLowerCase()}:`;
    for (const key of keys as string[]) {
      if (!input.planBrandId || !key.startsWith(prefix) || key.endsWith(":seed")) {
        return { ok: false, detail: "audience_not_owned" };
      }
    }
  }
  if (excludeKeys && (keys as string[]).some((key) => excludeKeys!.includes(key))) {
    return { ok: false, detail: "audience_include_exclude_overlap" };
  }
  return {
    ok: true,
    selection: withExclude({ include_keys: [...keys as string[]] }),
  };
}

export type ListAudienceDefinitionRow = {
  id: string;
  audience_key: string;
  owner_kind: "mingla" | "host";
  brand_id: string | null;
  kind: ListAudienceKind;
  display_name: string;
  lookalike_country: string | null;
  status: string;
};

/** A lookalike may only run in its own single target country. */
export function audienceCountryMismatch(
  rows: ListAudienceDefinitionRow[],
  countries: string[],
): boolean {
  const lookalikes = rows.filter((row) => row.kind === "lookalike");
  if (lookalikes.length === 0) return false;
  const upper = [...new Set(countries.map((cc) => cc.toUpperCase()))];
  return lookalikes.some((row) =>
    upper.length !== 1 || row.lookalike_country !== upper[0]
  );
}

/** Where each platform's compiled targeting keeps its audience ids. */
export function compiledAudienceIds(
  platform: string,
  compiled: Record<string, unknown>,
): string[] {
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((item) =>
        item && typeof item === "object"
          ? String((item as Record<string, unknown>).id ?? "")
          : String(item)
      )
      : [];
  if (platform === "meta") {
    return [
      ...list(compiled.custom_audiences),
      ...list(compiled.excluded_custom_audiences),
    ];
  }
  if (platform === "tiktok") {
    return [
      ...list(compiled.audience_ids),
      ...list(compiled.excluded_audience_ids),
    ];
  }
  if (platform === "snapchat") {
    return [
      ...list(compiled.segment_include_ids),
      ...list(compiled.segment_exclude_ids),
    ];
  }
  if (platform === "google") return list(compiled.user_list_ids);
  if (platform === "reddit") return list(compiled.custom_audience_ids);
  return [];
}

export type PlatformBindingRow = {
  provider_audience_id: string | null;
  platform: string;
  state: string;
  audience_key: string;
  owner_kind: string;
  brand_id: string | null;
};

/**
 * Create-time defence in depth (SC-9): every audience id in the frozen
 * snapshot must be a ready list-audience id on this platform whose key the
 * plan version selected, and for Host plans one the plan's brand owns. The
 * frozen ids must equal exactly the selected-and-ready ids.
 */
export function audienceBindingMismatch(input: {
  platform: string;
  compiled: Record<string, unknown>;
  includeKeys: string[];
  ownerKind: string;
  planBrandId: string | null;
  rows: PlatformBindingRow[];
}): boolean {
  const ids = compiledAudienceIds(input.platform, input.compiled);
  const selected = new Set(input.includeKeys);
  const owned = input.rows.filter((row) =>
    row.platform === input.platform && !!row.provider_audience_id &&
    row.state === "ready" && selected.has(row.audience_key) &&
    (input.ownerKind !== "host" ||
      (row.owner_kind === "host" && row.brand_id === input.planBrandId))
  );
  const allowed = new Set(owned.map((row) => String(row.provider_audience_id)));
  if (ids.some((id) => !allowed.has(id))) return true;
  const frozen = new Set(ids);
  return [...allowed].some((id) => !frozen.has(id));
}
