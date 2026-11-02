/**
 * Issue #4238 wave 2 — customer-list and lookalike provider wire, and the
 * delta sync engine that the admin-ad-audiences worker runs.
 *
 * Builders are pure and accept SHA-256 hex hashes only (assertHashOnly). The
 * sync engine takes an injected database client and per-platform transports,
 * so tests run it against fakes and no test ever reaches a provider.
 *
 * Logging rule (I-4238-AUDIENCE-HASH-ONLY): nothing here prints a hash, a
 * per-person count or a provider body. The only log line is
 * {audience_key, platform, adds, removes, error_code}.
 *
 * Terms rule (I-4238-TERMS-NEVER-AUTO): no function here accepts provider
 * terms. Terms are detected and recorded; Admin accepts them in the
 * provider's own UI.
 */

import {
  audienceProviderName,
  BATCH,
  LIST_MIN,
  type ListPlatform,
  LOOKALIKE_PLATFORMS,
  LOOKALIKE_SEED_MIN_PER_COUNTRY,
  neededCount,
} from "./adListAudienceRules.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Replaces #3697's assertHashedBuyerWire, whose JSON-wide regex
 * (/@|\+?[0-9][0-9 ()-]{6,}/) tripped on most real hex hashes (runs of seven
 * or more digits). This check is per value: each must be lower-case 64-hex.
 */
export function assertHashOnly(values: readonly string[]): void {
  for (const value of values) {
    if (typeof value !== "string" || !SHA256_HEX.test(value)) {
      throw new Error("list_audience_unhashed_value");
    }
  }
}

export type HashBatch = { email: string[]; phone: string[] };

export type WireRequest = {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
};

// ── Meta (Graph v25.0; same shape as the v26.0 docs) ─────────────────────────
// https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences

export function buildMetaListCreate(accountId: string, name: string): WireRequest {
  return {
    method: "POST",
    path: `act_${accountId.replace(/^act_/, "")}/customaudiences`,
    body: {
      name,
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      description: "Mingla customer list · #4238",
    },
  };
}

export function buildMetaUsers(input: {
  audienceId: string;
  action: "add" | "remove";
  schema: "EMAIL" | "PHONE";
  hashes: string[];
  session: {
    session_id: number;
    batch_seq: number;
    last_batch_flag: boolean;
    estimated_num_total: number;
  };
}): WireRequest {
  assertHashOnly(input.hashes);
  return {
    method: input.action === "add" ? "POST" : "DELETE",
    path: `${input.audienceId}/users`,
    body: {
      payload: { schema: [input.schema], data: input.hashes.map((h) => [h]) },
      session: input.session,
    },
  };
}

export function buildMetaLookalike(input: {
  accountId: string;
  name: string;
  originAudienceId: string;
  country: string;
}): WireRequest {
  return {
    method: "POST",
    path: `act_${input.accountId.replace(/^act_/, "")}/customaudiences`,
    body: {
      name: input.name,
      subtype: "LOOKALIKE",
      origin_audience_id: input.originAudienceId,
      lookalike_spec: JSON.stringify({ type: "similarity", country: input.country }),
    },
  };
}

/** Meta terms read: GET act_{id}?fields=tos_accepted (read-only). */
export function buildMetaTermsRead(accountId: string): WireRequest {
  return {
    method: "GET",
    path: `act_${accountId.replace(/^act_/, "")}`,
    body: { fields: "tos_accepted" },
  };
}

export function parseMetaTerms(payload: Record<string, unknown>):
  | "accepted"
  | "not_accepted" {
  const tos = record(payload.tos_accepted);
  return Number(tos?.custom_audience_tos) === 1 ? "accepted" : "not_accepted";
}

/**
 * #4238 O-4: Meta's delivery_status is the readiness authority. Code 200 /
 * "active" / "ready" means the audience can deliver; 300 means it is too
 * small; anything else is still being built. Seth's read-only check on 2 Nov
 * 2026 showed all 14 website audiences ACTIVE on Meta while Mingla read them
 * as "creating" because the old reader preferred operation_status.
 */
export function metaDeliveryState(
  payload: Record<string, unknown>,
): "ready" | "too_small" | "creating" | null {
  const delivery = record(payload.delivery_status);
  if (!delivery) return null;
  const code = String(delivery.code ?? "").trim().toLowerCase();
  const description = String(delivery.description ?? "").trim().toLowerCase();
  if (["200", "active", "ready"].includes(code) || description === "active") {
    return "ready";
  }
  if (code === "300" || code === "too_small") return "too_small";
  return "creating";
}

// ── Snap Marketing API v1 ────────────────────────────────────────────────────
// https://developers.snap.com/api/marketing-api/Ads-API/audience-creation/customer-lists

export function buildSnapListCreate(accountId: string, name: string): WireRequest {
  return {
    method: "POST",
    path: `adaccounts/${accountId}/segments`,
    body: {
      segments: [{
        name,
        source_type: "FIRST_PARTY",
        retention_in_days: 9999,
        ad_account_id: accountId,
      }],
    },
  };
}

export function buildSnapUsers(input: {
  segmentId: string;
  action: "add" | "remove";
  schema: "EMAIL_SHA256" | "PHONE_SHA256";
  hashes: string[];
}): WireRequest {
  assertHashOnly(input.hashes);
  return {
    method: input.action === "add" ? "POST" : "DELETE",
    path: `segments/${input.segmentId}/users`,
    body: {
      users: [{ schema: [input.schema], data: input.hashes.map((h) => [h]) }],
    },
  };
}

export function buildSnapLookalike(input: {
  accountId: string;
  name: string;
  seedSegmentId: string;
  country: string;
}): WireRequest {
  return {
    method: "POST",
    path: `adaccounts/${input.accountId}/segments`,
    body: {
      segments: [{
        name: input.name,
        source_type: "LOOKALIKE",
        retention_in_days: 180,
        ad_account_id: input.accountId,
        creation_spec: {
          seed_segment_id: input.seedSegmentId,
          type: "BALANCE",
          countries: [input.country],
        },
      }],
    },
  };
}

// ── TikTok API for Business v1.3 ─────────────────────────────────────────────
// https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AudienceApi.md

export function buildTikTokAudienceFile(
  calculateType: "EMAIL_SHA256" | "PHONE_SHA256",
  hashes: string[],
): { csv: string; calculateType: string } {
  assertHashOnly(hashes);
  return { csv: [calculateType, ...hashes].join("\n") + "\n", calculateType };
}

export function buildTikTokListCreate(input: {
  advertiserId: string;
  name: string;
  calculateType: "EMAIL_SHA256" | "PHONE_SHA256";
  filePaths: string[];
}): WireRequest {
  return {
    method: "POST",
    path: "dmp/custom_audience/create/",
    body: {
      advertiser_id: input.advertiserId,
      custom_audience_name: input.name.slice(0, 128),
      calculate_type: input.calculateType,
      file_paths: input.filePaths,
      retention_in_days: 365,
    },
  };
}

export function buildTikTokListUpdate(input: {
  advertiserId: string;
  audienceId: string;
  action: "APPEND" | "REMOVE";
  filePaths: string[];
}): WireRequest {
  return {
    method: "POST",
    path: "dmp/custom_audience/update/",
    body: {
      advertiser_id: input.advertiserId,
      custom_audience_id: input.audienceId,
      action: input.action,
      file_paths: input.filePaths,
    },
  };
}

export function buildTikTokLookalike(input: {
  advertiserId: string;
  name: string;
  sourceAudienceId: string;
  locationId: string;
}): WireRequest {
  return {
    method: "POST",
    path: "dmp/custom_audience/lookalike/create/",
    body: {
      advertiser_id: input.advertiserId,
      custom_audience_name: input.name.slice(0, 128),
      lookalike_spec: {
        source_audience_id: input.sourceAudienceId,
        location_ids: [input.locationId],
        audience_size: "BALANCED",
        include_source: false,
      },
    },
  };
}

export function buildTikTokDelete(advertiserId: string, audienceId: string): WireRequest {
  return {
    method: "POST",
    path: "dmp/custom_audience/delete/",
    body: { advertiser_id: advertiserId, custom_audience_ids: [audienceId] },
  };
}

// ── Reddit Ads API v3 ────────────────────────────────────────────────────────
// Users: PATCH /api/v3/custom_audiences/{id}/users (vendor-documented).
// O-3: Reddit's own v3 reference (ads-api.reddit.com/docs/v3) could not be
// fetched from the build environment on 2 Nov 2026, so the CREATE and
// LOOKALIKE paths are NOT written. The worker keeps Reddit "unsupported"
// behind ad_reddit_list_audiences_enabled (off) until one real-API check
// records the exact paths here.

export function buildRedditUsers(input: {
  audienceId: string;
  action: "ADD" | "REMOVE";
  hashes: string[];
}): WireRequest {
  assertHashOnly(input.hashes);
  return {
    method: "PATCH",
    path: `custom_audiences/${input.audienceId}/users`,
    body: {
      action_type: input.action,
      column_order: ["EMAIL_SHA256"],
      user_data: input.hashes.map((h) => [h]),
    },
  };
}

// ── Google Customer Match through the Data Manager API ──────────────────────
// https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/upload-data
// https://developers.google.com/data-manager/api/devguides/terms

/** EEA, UK and CH: no recorded ad consent, so never uploaded to Google. */
const GOOGLE_CONSENT_EXCLUDED = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

export type GoogleMemberHashes = {
  email: string | null;
  phoneE164: string | null;
  country: string | null;
};

export function buildGoogleIngest(input: {
  action: "ingest" | "remove";
  termsConfirmed: boolean;
  customerId: string;
  userListId: string;
  members: GoogleMemberHashes[];
}): WireRequest {
  if (input.termsConfirmed !== true) {
    throw new Error("google_customer_match_terms_unconfirmed");
  }
  const members = input.members.filter((member) =>
    !member.country || !GOOGLE_CONSENT_EXCLUDED.has(member.country)
  );
  const hashes = members.flatMap((member) =>
    [member.email, member.phoneE164].filter((value): value is string =>
      value !== null
    )
  );
  assertHashOnly(hashes);
  return {
    method: "POST",
    path: `audienceMembers:${input.action}`,
    body: {
      destinations: [{
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: input.customerId },
        productDestinationId: input.userListId,
      }],
      audienceMembers: members.map((member) => ({
        userData: {
          userIdentifiers: [
            ...(member.email ? [{ emailAddress: member.email }] : []),
            ...(member.phoneE164 ? [{ phoneNumber: member.phoneE164 }] : []),
          ],
        },
        consent: {
          adUserData: "CONSENT_GRANTED",
          adPersonalization: "CONSENT_GRANTED",
        },
      })),
      encoding: "HEX",
      termsOfService: { customerMatchTermsOfServiceStatus: "ACCEPTED" },
    },
  };
}

// ── Response parsing ─────────────────────────────────────────────────────────

export type ProviderListFact = {
  providerAudienceId: string;
  approxSize: number | null;
  state: "ready" | "too_small" | "syncing";
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function parseListFact(
  platform: ListPlatform,
  payload: Record<string, unknown>,
  knownId = "",
): ProviderListFact {
  if (platform === "meta") {
    const id = String(payload.id ?? knownId).trim();
    if (!id) throw new Error("meta_audience_id_missing");
    const state = metaDeliveryState(payload);
    return {
      providerAudienceId: id,
      approxSize: count(payload.approximate_count_lower_bound),
      state: state === "ready" ? "ready" : state === "too_small" ? "too_small" : "syncing",
    };
  }
  if (platform === "snapchat") {
    const rows = Array.isArray(payload.segments) ? payload.segments : [];
    const first = record(rows[0]);
    const segment = record(first?.segment) ?? first ?? {};
    const id = String(segment.id ?? knownId).trim();
    if (!id) throw new Error("snap_audience_id_missing");
    const status = String(segment.targetable_status ?? "").toUpperCase();
    return {
      providerAudienceId: id,
      approxSize: count(segment.approximate_number_users),
      state: status === "READY" ? "ready" : status === "TOO_FEW_USERS" ? "too_small" : "syncing",
    };
  }
  if (platform === "tiktok") {
    const data = record(payload.data) ?? {};
    const list = Array.isArray(data.list) ? data.list : [];
    const row = record(list[0]) ?? data;
    const id = String(row.custom_audience_id ?? row.audience_id ?? knownId).trim();
    if (!id) throw new Error("tiktok_audience_id_missing");
    const size = count(row.audience_size ?? row.cover_num);
    return {
      providerAudienceId: id,
      approxSize: size,
      state: row.is_valid === false || (size !== null && size < 1000)
        ? "too_small"
        : row.is_valid === true ? "ready" : "syncing",
    };
  }
  const id = String(payload.id ?? payload.resourceName ?? knownId).trim();
  if (!id) throw new Error(`${platform}_audience_id_missing`);
  return { providerAudienceId: id, approxSize: count(payload.size), state: "syncing" };
}

const RATE_CODES = new Set(["17", "32", "613", "80003", "40100", "429"]);

/** Only a short code survives; provider message bodies are dropped. */
export function listAudienceErrorCode(error: unknown): string {
  const e = error as { code?: unknown; subcode?: unknown; message?: unknown; status?: unknown };
  const code = e?.code ?? e?.status;
  const subcode = e?.subcode;
  const message = typeof e?.message === "string" ? e.message : "";
  if (/CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE/.test(message)) {
    return "google_customer_not_allowlisted";
  }
  if (/^[a-z0-9_:]{1,120}$/.test(message)) return message;
  const parts = [code, subcode].filter((part) =>
    part !== undefined && part !== null && String(part).trim()
  ).map((part) => String(part).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40));
  return (parts.length ? `provider_${parts.join("_")}` : "provider_error").slice(0, 120);
}

export function listAudienceErrorState(
  platform: ListPlatform,
  error: unknown,
): "terms_required" | "ineligible" | "rate_limited" | "error" {
  const e = error as { code?: unknown; subcode?: unknown; message?: unknown; status?: unknown };
  const code = String(e?.code ?? e?.status ?? "");
  const message = typeof e?.message === "string" ? e.message : "";
  if (platform === "meta" && code === "200" && String(e?.subcode ?? "") === "1870090") {
    return "terms_required";
  }
  if (/CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE/.test(message)) return "ineligible";
  if (platform === "google" && /TERMS|terms_of_service|google_customer_match_terms_unconfirmed/i.test(message)) {
    return "terms_required";
  }
  if (RATE_CODES.has(code)) return "rate_limited";
  return "error";
}

// ── The delta sync engine ────────────────────────────────────────────────────

export type ListTransport = {
  connectionId: string;
  createList(name: string): Promise<ProviderListFact>;
  createLookalike(name: string, seedProviderId: string, country: string): Promise<ProviderListFact>;
  /** Members are hash rows; the transport picks the identifiers it supports. */
  send(providerId: string, action: "add" | "remove", members: MemberHashRow[]): Promise<void>;
  read(providerId: string): Promise<ProviderListFact>;
  remove(providerId: string): Promise<void>;
  /** A brand-new list: create and upload in one provider step (TikTok). */
  createWithMembers?(name: string, members: MemberHashRow[]): Promise<ProviderListFact>;
};

export type MemberHashRow = {
  member_key: string;
  email_sha256: string | null;
  email_google_sha256: string | null;
  phone_sha256: string | null;
  phone_e164_sha256: string | null;
  country: string | null;
};

export type SyncCursor = { after: string };

export type SyncResult = {
  more: boolean;
  cursor: SyncCursor | null;
  audiencesRefreshed: number;
  adds: number;
  removes: number;
  errors: number;
};

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Db = any;

const DAY_MS = 86_400_000;
const MEMBER_PAGE = 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function rows(query: Promise<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function memberPage(
  db: Db,
  audienceId: string,
  mode: "all" | "added" | "removed",
  since: string | null,
  until: string,
): Promise<MemberHashRow[]> {
  const out: MemberHashRow[] = [];
  for (let from = 0;; from += MEMBER_PAGE) {
    let query = db.from("ad_list_audience_members")
      .select("member_key,email_sha256,email_google_sha256,phone_sha256,phone_e164_sha256,country")
      .eq("audience_id", audienceId);
    if (mode === "removed") {
      query = query.not("removed_at", "is", null).lte("removed_at", until);
      if (since) query = query.gt("removed_at", since);
    } else {
      query = query.is("removed_at", null).lte("added_at", until);
      if (mode === "added" && since) query = query.gt("added_at", since);
    }
    const page = await rows(
      query.order("member_key").range(from, from + MEMBER_PAGE - 1),
    ) as unknown as MemberHashRow[];
    out.push(...page);
    if (page.length < MEMBER_PAGE) return out;
  }
}

export async function syncListAudiences(input: {
  db: Db;
  kind: "daily" | "removals";
  transports: Partial<Record<ListPlatform, ListTransport>>;
  redditEnabled: boolean;
  budgetMs?: number;
  cursor?: SyncCursor | null;
  now?: () => number;
  log?: (line: Row) => void;
}): Promise<SyncResult> {
  const db = input.db;
  const now = input.now ?? (() => Date.now());
  const startedMs = now();
  const runStart = iso(startedMs);
  const budgetMs = input.budgetMs ?? 40_000;
  // deno-lint-ignore no-console
  const log = input.log ?? ((line: Row) => console.log("[list-audience-sync]", JSON.stringify(line)));
  const result: SyncResult = {
    more: false,
    cursor: null,
    audiencesRefreshed: 0,
    adds: 0,
    removes: 0,
    errors: 0,
  };

  const definitions = await rows(
    db.from("ad_list_audiences").select("*").order("kind").order("audience_key"),
  );
  const brandIds = [
    ...new Set(definitions.map((row) => row.brand_id).filter((id) => typeof id === "string")),
  ];
  const brands = brandIds.length > 0
    ? await rows(db.from("brands").select("id,name,deleted_at").in("id", brandIds))
    : [];
  const brandById = new Map(brands.map((row) => [String(row.id), row]));
  const sixtyDaysAgo = startedMs - 60 * DAY_MS;
  const recent = (value: unknown) =>
    typeof value === "string" && Date.parse(value) >= sixtyDaysAgo;
  const inUse = (def: Row) =>
    def.owner_kind === "mingla" || recent(def.requested_at) || recent(def.last_used_at);
  const brandGone = (def: Row) =>
    def.owner_kind === "host" &&
    (!brandById.has(String(def.brand_id)) ||
      brandById.get(String(def.brand_id))?.deleted_at != null);
  const retiring = (def: Row) => def.status === "retired" || brandGone(def) || !inUse(def);

  // 1. Refresh membership (lists before lookalikes: a lookalike reads its seed).
  for (const def of definitions) {
    if (def.status !== "active" || retiring(def)) continue;
    const refreshedAt = typeof def.members_refreshed_at === "string"
      ? Date.parse(def.members_refreshed_at)
      : NaN;
    const stale = !Number.isFinite(refreshedAt) ||
      (input.kind === "daily" && startedMs - refreshedAt > 20 * 3_600_000);
    if (!stale) continue;
    const { data, error } = await db.rpc("ad_list_audience_refresh", { p_audience_id: def.id });
    if (error) {
      if (String(error.code ?? "") !== "PT409") result.errors += 1;
      continue;
    }
    const counts = (data ?? {}) as Row;
    def.member_count = counts.member_count ?? def.member_count;
    result.audiencesRefreshed += 1;
  }
  // Re-read counts written by the refreshes.
  const fresh = await rows(db.from("ad_list_audiences").select("*").order("kind").order("audience_key"));
  const defById = new Map(fresh.map((row) => [String(row.id), row]));

  const platformRows = await rows(db.from("ad_list_audience_platforms").select("*"));
  const stateOf = new Map(platformRows.map((row) => [`${row.audience_id}:${row.platform}`, row]));
  const terms = await rows(db.from("ad_platform_audience_terms").select("*"));
  const termsByConnection = new Map(terms.map((row) => [String(row.connection_id), row]));

  const upsertState = async (def: Row, platform: ListPlatform, patch: Row) => {
    const transport = input.transports[platform]!;
    const key = `${def.id}:${platform}`;
    const merged = {
      ...(stateOf.get(key) ?? {}),
      audience_id: def.id,
      platform,
      connection_id: transport.connectionId,
      ...patch,
      updated_at: iso(now()),
    };
    const { error } = await db.from("ad_list_audience_platforms").upsert(merged, {
      onConflict: "audience_id,platform",
    });
    if (error) throw error;
    stateOf.set(key, merged);
  };

  const work: Array<{ def: Row; platform: ListPlatform; key: string }> = [];
  for (const def of [...defById.values()].sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind)) ||
    String(a.audience_key).localeCompare(String(b.audience_key))
  )) {
    const platforms: ListPlatform[] = def.kind === "lookalike"
      ? [...LOOKALIKE_PLATFORMS]
      : ["meta", "snapchat", "tiktok", "reddit", "google"];
    for (const platform of platforms) {
      if (!input.transports[platform]) continue;
      work.push({ def, platform, key: `${def.kind}:${def.audience_key}:${platform}` });
    }
  }
  const stopped = new Set<ListPlatform>();
  const resumeAfter = input.cursor?.after ?? null;

  for (const item of work) {
    if (resumeAfter && item.key <= resumeAfter) continue;
    if (now() - startedMs > budgetMs) {
      result.more = true;
      return finish();
    }
    const { def, platform } = item;
    if (stopped.has(platform)) continue;
    const transport = input.transports[platform]!;
    const key = `${def.id}:${platform}`;
    const current = stateOf.get(key) ?? {};
    const providerId = typeof current.provider_audience_id === "string"
      ? current.provider_audience_id
      : null;
    let adds = 0;
    let removes = 0;
    let errorCode: string | null = null;
    try {
      // 3. Retire: deleted provider audience, row kept as a tombstone.
      if (retiring(def)) {
        if (stateOf.has(key) && (current.state !== "retired" || providerId)) {
          if (providerId) await transport.remove(providerId);
          await upsertState(def, platform, {
            state: "retired",
            provider_audience_id: null,
            needed_count: null,
          });
        }
        result.cursor = { after: item.key };
        continue;
      }
      if (platform === "reddit" && !input.redditEnabled) {
        await upsertState(def, platform, { state: "unsupported", error_code: "reddit_audiences_off" });
        result.cursor = { after: item.key };
        continue;
      }
      const termRow = termsByConnection.get(transport.connectionId);
      if (platform === "google") {
        const eligibility = String(termRow?.eligibility ?? "unknown");
        if (!["eligible", "exclusion_only"].includes(eligibility)) {
          await upsertState(def, platform, { state: "ineligible", error_code: "google_customer_match_ineligible" });
          result.cursor = { after: item.key };
          continue;
        }
        if (!termRow?.admin_confirmed_at) {
          await upsertState(def, platform, { state: "terms_required", error_code: "google_terms_unconfirmed" });
          result.cursor = { after: item.key };
          continue;
        }
      }
      if (termRow?.state === "not_accepted") {
        await upsertState(def, platform, { state: "terms_required", error_code: "terms_not_accepted" });
        result.cursor = { after: item.key };
        continue;
      }

      const memberCount = Number(def.member_count ?? 0);
      if (def.kind === "lookalike") {
        const seed = defById.get(String(def.seed_audience_id));
        const seedState = seed ? stateOf.get(`${seed.id}:${platform}`) : null;
        const country = String(def.lookalike_country ?? "");
        const countryCount = Number(record(seed?.member_count_by_country)?.[country] ?? 0);
        const needed = neededCount(platform, "lookalike", memberCount, countryCount);
        if (!providerId) {
          if (needed !== null) {
            await upsertState(def, platform, { state: "below_minimum", needed_count: needed });
          } else if (
            !seedState || seedState.state !== "ready" ||
            typeof seedState.provider_audience_id !== "string"
          ) {
            await upsertState(def, platform, { state: "pending", needed_count: null });
          } else {
            const created = await transport.createLookalike(
              audienceProviderName({
                ownerKind: def.owner_kind as "mingla" | "host",
                brandName: String(brandById.get(String(def.brand_id))?.name ?? ""),
                brandId: def.brand_id as string | null,
                displayName: String(def.display_name),
                country,
                platform,
              }),
              seedState.provider_audience_id,
              country,
            );
            await upsertState(def, platform, {
              provider_audience_id: created.providerAudienceId,
              state: created.state,
              approx_size: created.approxSize,
              needed_count: null,
              last_synced_at: iso(now()),
              error_code: null,
            });
          }
        } else {
          const fact = await transport.read(providerId);
          await upsertState(def, platform, {
            state: fact.state,
            approx_size: fact.approxSize,
            last_synced_at: iso(now()),
            error_code: null,
          });
        }
        result.cursor = { after: item.key };
        continue;
      }

      // Lists.
      const needed = neededCount(platform, "list", memberCount);
      if (!providerId) {
        if (needed !== null) {
          await upsertState(def, platform, { state: "below_minimum", needed_count: needed });
          result.cursor = { after: item.key };
          continue;
        }
        if (input.kind === "removals") {
          result.cursor = { after: item.key };
          continue; // new uploads wait for the daily run
        }
        const all = await memberPage(db, String(def.id), "all", null, runStart);
        const name = audienceProviderName({
          ownerKind: def.owner_kind as "mingla" | "host",
          brandName: String(brandById.get(String(def.brand_id))?.name ?? ""),
          brandId: def.brand_id as string | null,
          displayName: String(def.display_name),
          platform,
        });
        let created: ProviderListFact;
        if (transport.createWithMembers) {
          created = await transport.createWithMembers(name, all);
        } else {
          created = await transport.createList(name);
          for (let i = 0; i < all.length; i += BATCH[platform]) {
            await transport.send(created.providerAudienceId, "add", all.slice(i, i + BATCH[platform]));
          }
        }
        adds += all.length;
        await upsertState(def, platform, {
          provider_audience_id: created.providerAudienceId,
          state: created.state === "ready" ? "ready" : "syncing",
          approx_size: created.approxSize,
          needed_count: null,
          synced_through: runStart,
          last_full_sync_at: iso(now()),
          last_synced_at: iso(now()),
          error_code: null,
        });
      } else {
        const since = typeof current.synced_through === "string" ? current.synced_through : null;
        const removed = await memberPage(db, String(def.id), "removed", since, runStart);
        if (
          platform === "tiktok" && removed.length > 0 &&
          memberCount < LIST_MIN.tiktok
        ) {
          // TikTok refuses a REMOVE that leaves fewer than 1,000; delete the
          // whole audience instead, so no removed person stays targetable.
          await transport.remove(providerId);
          removes += removed.length;
          await upsertState(def, platform, {
            provider_audience_id: null,
            state: "too_small",
            approx_size: null,
            needed_count: neededCount(platform, "list", memberCount),
            synced_through: runStart,
            last_synced_at: iso(now()),
            error_code: null,
          });
          result.cursor = { after: item.key };
          continue;
        }
        for (let i = 0; i < removed.length; i += BATCH[platform]) {
          await transport.send(providerId, "remove", removed.slice(i, i + BATCH[platform]));
        }
        removes += removed.length;
        // Adds go out only on the daily run (TikTok's once-a-day upload
        // cadence; one daily run, resumed by cursor, touches each item once).
        // Removals go out on every pass because a removal is a privacy promise.
        const sendAdds = input.kind === "daily";
        if (sendAdds) {
          const added = await memberPage(db, String(def.id), "added", since, runStart);
          for (let i = 0; i < added.length; i += BATCH[platform]) {
            await transport.send(providerId, "add", added.slice(i, i + BATCH[platform]));
          }
          adds += added.length;
        }
        const fact = await transport.read(providerId);
        await upsertState(def, platform, {
          state: fact.state,
          approx_size: fact.approxSize,
          needed_count: null,
          // A removals-only pass leaves synced_through alone so the next daily
          // run still owes every add since then (removes are idempotent).
          synced_through: sendAdds ? runStart : current.synced_through ?? null,
          last_synced_at: iso(now()),
          error_code: null,
        });
      }
    } catch (error) {
      errorCode = listAudienceErrorCode(error);
      const state = listAudienceErrorState(platform, error);
      result.errors += 1;
      if (state === "rate_limited") {
        stopped.add(platform);
      } else {
        await upsertState(def, platform, {
          state: state === "terms_required" ? "terms_required" : state === "ineligible" ? "ineligible" : "error",
          error_code: errorCode,
        });
        if (state === "terms_required") {
          await db.from("ad_platform_audience_terms").upsert({
            connection_id: transport.connectionId,
            platform,
            state: "not_accepted",
            checked_at: iso(now()),
            detail_code: errorCode,
            updated_at: iso(now()),
          }, { onConflict: "connection_id" });
          stopped.add(platform);
        }
      }
    }
    result.adds += adds;
    result.removes += removes;
    log({ audience_key: def.audience_key, platform, adds, removes, error_code: errorCode });
    result.cursor = { after: item.key };
  }
  result.cursor = null;
  return finish();

  async function finish(): Promise<SyncResult> {
    if (!result.more) {
      // 4. Purge tombstones synced by every platform and older than 30 days.
      const cutoff = iso(startedMs - 30 * DAY_MS);
      for (const def of defById.values()) {
        const synced = [...stateOf.values()].filter((row) =>
          row.audience_id === def.id && typeof row.provider_audience_id === "string"
        );
        if (synced.some((row) => typeof row.synced_through !== "string")) continue;
        const floor = [cutoff, ...synced.map((row) => String(row.synced_through))].sort()[0];
        const { error } = await db.from("ad_list_audience_members").delete()
          .eq("audience_id", def.id).not("removed_at", "is", null).lt("removed_at", floor);
        if (error) result.errors += 1;
      }
      await db.from("ad_list_audience_sync_runs").delete().lt("started_at", iso(startedMs - 90 * DAY_MS));
    }
    // 5. One counts-only run row.
    await db.from("ad_list_audience_sync_runs").insert({
      started_at: runStart,
      finished_at: iso(now()),
      kind: input.kind,
      audiences_refreshed: result.audiencesRefreshed,
      adds: result.adds,
      removes: result.removes,
      errors: result.errors,
      more: result.more,
      cursor: result.more ? result.cursor : null,
    });
    return result;
  }
}

export { LIST_MIN, LOOKALIKE_SEED_MIN_PER_COUNTRY };
