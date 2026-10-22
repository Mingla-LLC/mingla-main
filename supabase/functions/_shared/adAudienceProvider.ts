/**
 * Issue #3697 — provider audience wire requests and buyer-list privacy guard.
 *
 * This module is deliberately pure. The admin audience worker resolves the
 * provider connection, loads one server-owned ad_audiences row, and only then
 * asks this module for a request. Browser input can never supply provider ids,
 * rules, identifiers, account ids, or paths.
 */

import type { AudienceDefinition } from "./adAudienceDefinitions.ts";
import type { PaidSocialPlatform } from "./adAudienceStages.ts";

export type AudienceProviderRequest = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
};

export type AudienceProviderContext = {
  platform: PaidSocialPlatform;
  accountId: string;
  name: string;
  definition: AudienceDefinition;
};

export type HashedBuyerIdentifier = {
  email_sha256?: string | null;
  phone_sha256?: string | null;
  tracking_opt_out?: boolean | null;
};

export type BuyerIdentifierBatch = {
  emailSha256: string[];
  phoneSha256: string[];
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

function required(value: string, code: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(code);
  return clean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("audience_rule_invalid");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("audience_rule_invalid");
  return value.map(object);
}

function metaFilter(rule: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [];
  if (typeof rule.event === "string" && rule.event.trim()) {
    filters.push({ field: "event", operator: "eq", value: rule.event.trim() });
  }
  const url = rule.url;
  if (url && typeof url === "object" && !Array.isArray(url)) {
    const urlRule = url as Record<string, unknown>;
    if (
      urlRule.operator !== "i_contains" || typeof urlRule.value !== "string"
    ) {
      throw new Error("meta_audience_url_rule_invalid");
    }
    filters.push({
      field: "url",
      operator: "i_contains",
      value: urlRule.value,
    });
  }
  const contentIds = rule.content_ids;
  if (Array.isArray(contentIds) && contentIds.length > 0) {
    const values = contentIds.map((value) => String(value).trim()).filter(
      Boolean,
    );
    if (values.length !== contentIds.length) {
      throw new Error("meta_audience_content_ids_invalid");
    }
    filters.push({
      field: "content_ids",
      operator: "i_contains",
      value: values,
    });
  }
  if (filters.length === 0) throw new Error("meta_audience_filter_empty");
  return { operator: "and", filters };
}

function metaRuleSet(
  rules: Record<string, unknown>[],
  pixelId: string,
  retentionSeconds: number,
): Record<string, unknown> {
  if (rules.length === 0) throw new Error("meta_audience_rules_empty");
  return {
    operator: "or",
    rules: rules.map((rule) => ({
      event_sources: [{ id: pixelId, type: "pixel" }],
      retention_seconds: retentionSeconds,
      filter: metaFilter(rule),
    })),
  };
}

/** Exact Meta website custom-audience envelope. */
export function buildMetaAudienceRequest(
  input: AudienceProviderContext,
): AudienceProviderRequest {
  const accountId = required(input.accountId, "meta_ad_account_missing")
    .replace(/^act_/, "");
  const source = object(input.definition.rule);
  if (source.source_type !== "WEBSITE") {
    throw new Error("meta_audience_source_unsupported");
  }
  const pixelId = required(String(source.pixel_id ?? ""), "meta_pixel_missing");
  const retentionSeconds = input.definition.windowDays * 86_400;
  const inclusions = array(source.inclusions);
  const exclusions = Array.isArray(source.exclusions)
    ? array(source.exclusions)
    : [];
  const rule: Record<string, unknown> = {
    inclusions: metaRuleSet(inclusions, pixelId, retentionSeconds),
    ...(exclusions.length > 0
      ? { exclusions: metaRuleSet(exclusions, pixelId, retentionSeconds) }
      : {}),
  };
  return {
    method: "POST",
    path: `act_${accountId}/customaudiences`,
    body: {
      name: required(input.name, "audience_name_missing"),
      subtype: "WEBSITE",
      retention_days: input.definition.windowDays,
      rule: JSON.stringify(rule),
      description: "Mingla automatic paid-social audience · issue #3697",
    },
  };
}

/**
 * Exact documented Snap Website Events envelope.
 *
 * Snap documents only an event equality predicate. Event- and URL-scoped Mingla
 * audiences therefore fail closed until #3697 records an approved supported
 * predicate; silently creating a platform-wide PAGE_VIEW/PURCHASE pool would
 * violate the build contract.
 */
export function buildSnapAudienceRequest(
  input: AudienceProviderContext,
): AudienceProviderRequest {
  const accountId = required(input.accountId, "snap_ad_account_missing");
  const source = object(input.definition.rule);
  const spec = object(source.pixel_spec_object);
  const or = object(spec.or);
  const eventRules = array(or.event);
  const documentedOnly = eventRules.every((row) =>
    Object.keys(row).length === 1 && typeof row.eq === "string" && row.eq.trim()
  );
  if (
    !documentedOnly || source.mingla_event_id !== undefined ||
    source.exclude !== undefined ||
    source.event_ends_at !== undefined
  ) {
    throw new Error("snap_event_scope_contract_pending");
  }
  return {
    method: "POST",
    path: `adaccounts/${accountId}/segments`,
    body: {
      segments: [{
        name: required(input.name, "audience_name_missing"),
        retention_in_days: input.definition.windowDays,
        prefill: true,
        ad_account_id: accountId,
        source_type: "PIXEL",
        pixel_id: required(String(source.pixel_id ?? ""), "snap_pixel_missing"),
        pixel_spec_object: {
          or: { event: eventRules.map((row) => ({ eq: String(row.eq) })) },
        },
      }],
    },
  };
}

function tiktokRule(
  raw: Record<string, unknown>,
  pixelId: string,
  retentionDays: number,
): Record<string, unknown> {
  const event = required(
    String(raw.event ?? ""),
    "tiktok_audience_event_missing",
  );
  const filters: Record<string, unknown>[] = [
    { field: "EVENT", operator: "EQ", value: event },
  ];
  if (raw.content_id !== undefined && raw.content_id !== null) {
    filters.push({
      field: "CONTENT_ID",
      operator: "EQ",
      value: required(
        String(raw.content_id),
        "tiktok_audience_content_id_missing",
      ),
    });
  }
  return {
    event_source_ids: [pixelId],
    retention_days: retentionDays,
    filter_set: { operator: "AND", filters },
  };
}

/** Exact TikTok v1.3 rule-audience envelope. */
export function buildTikTokAudienceRequest(
  input: AudienceProviderContext,
): AudienceProviderRequest {
  const advertiserId = required(input.accountId, "tiktok_advertiser_missing");
  const source = object(input.definition.rule);
  if (source.audience_sub_type !== "WEBSITE") {
    throw new Error("tiktok_audience_source_unsupported");
  }
  const pixelId = required(
    String(source.pixel_id ?? ""),
    "tiktok_pixel_missing",
  );
  const inclusions = array(source.inclusions);
  const exclusions = Array.isArray(source.exclusions)
    ? array(source.exclusions)
    : [];
  return {
    method: "POST",
    path: "dmp/custom_audience/rule/create/",
    body: {
      advertiser_id: advertiserId,
      custom_audience_name: required(input.name, "audience_name_missing"),
      audience_type: "WEBSITE",
      rule_spec: {
        inclusion_rule_set: {
          operator: "OR",
          rules: inclusions.map((rule) =>
            tiktokRule(rule, pixelId, input.definition.windowDays)
          ),
        },
        ...(exclusions.length > 0
          ? {
            exclusion_rule_set: {
              operator: "OR",
              rules: exclusions.map((rule) =>
                tiktokRule(rule, pixelId, input.definition.windowDays)
              ),
            },
          }
          : {}),
      },
    },
  };
}

export function buildAudienceProviderRequest(
  input: AudienceProviderContext,
): AudienceProviderRequest {
  if (input.platform === "meta") return buildMetaAudienceRequest(input);
  if (input.platform === "snapchat") return buildSnapAudienceRequest(input);
  return buildTikTokAudienceRequest(input);
}

/**
 * Customer-file boundary: flag-off refuses before reading any identifier;
 * opted-out rows are removed; malformed or raw values are dropped; the result
 * contains SHA-256 hex only.
 */
export function buildHashedBuyerBatch(
  enabled: boolean,
  rows: readonly HashedBuyerIdentifier[],
): BuyerIdentifierBatch {
  if (!enabled) throw new Error("buyer_list_sync_disabled");
  const emailSha256 = new Set<string>();
  const phoneSha256 = new Set<string>();
  for (const row of rows) {
    if (row.tracking_opt_out === true) continue;
    const email = String(row.email_sha256 ?? "").trim().toLowerCase();
    const phone = String(row.phone_sha256 ?? "").trim().toLowerCase();
    if (SHA256_HEX.test(email)) emailSha256.add(email);
    if (SHA256_HEX.test(phone)) phoneSha256.add(phone);
  }
  return {
    emailSha256: [...emailSha256],
    phoneSha256: [...phoneSha256],
  };
}

export function assertHashedBuyerWire(value: unknown): void {
  const json = JSON.stringify(value);
  const obviousRaw = /@|\+?[0-9][0-9 ()-]{6,}/.test(json);
  if (obviousRaw) throw new Error("buyer_list_contains_unhashed_identifier");
  const strings: string[] = [];
  const walk = (candidate: unknown): void => {
    if (typeof candidate === "string") strings.push(candidate);
    else if (Array.isArray(candidate)) candidate.forEach(walk);
    else if (candidate && typeof candidate === "object") {
      Object.values(candidate as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  for (const candidate of strings) {
    if (
      candidate.startsWith("sha256:") && !SHA256_HEX.test(candidate.slice(7))
    ) {
      throw new Error("buyer_list_hash_invalid");
    }
  }
}
