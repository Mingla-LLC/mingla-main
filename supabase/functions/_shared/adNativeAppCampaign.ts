/**
 * Issue #3697 — pure, fail-closed authority for provider-native app campaigns.
 *
 * The database freezes a resolved destination and a provider targeting verdict
 * into an immutable plan version. Provider execution consumes only those
 * snapshots; request fields are descriptors used to prove that the caller is
 * still addressing the same app/OS cell.
 */

import type { Platform } from "./adChannelCore.ts";

export type NativeAppDestinationFamily = "explorer_app" | "host_app";
export type NativeAppKey = "explorer" | "business";
export type NativeAppOs = "ios" | "android";

export interface FrozenNativeAppDestination {
  family: NativeAppDestinationFamily;
  key: NativeAppOs;
  appKey: NativeAppKey;
  os: NativeAppOs;
  title: string;
  storeIdentifier: string;
  appsFlyerAppId: string;
  storeUrl: string;
  oneLinkUrl: string;
}

export class NativeAppPlanError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "NativeAppPlanError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isNativeAppDestinationFamily(
  value: unknown,
): value is NativeAppDestinationFamily {
  return value === "explorer_app" || value === "host_app";
}

function validStoreIdentity(os: NativeAppOs, value: string): boolean {
  return os === "ios"
    ? /^\d+$/.test(value)
    : /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value);
}

function validStoreUrl(os: NativeAppOs, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return os === "ios"
      ? url.hostname === "apps.apple.com"
      : url.hostname === "play.google.com";
  } catch {
    return false;
  }
}

function validOneLinkUrl(appKey: NativeAppKey, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.search || url.hash) return false;
    return appKey === "explorer"
      ? url.hostname === "go.usemingla.com"
      : url.hostname === "biz.usemingla.com";
  } catch {
    return false;
  }
}

/** Parse and prove one immutable app/OS/provider destination snapshot. */
export function parseFrozenNativeAppDestination(input: {
  snapshot: unknown;
  expectedFamily: unknown;
  expectedKey: unknown;
  platform: Platform;
}): FrozenNativeAppDestination {
  const snapshot = record(input.snapshot);
  if (!snapshot) {
    throw new NativeAppPlanError("native_destination_snapshot_missing");
  }
  if (!isNativeAppDestinationFamily(input.expectedFamily)) {
    throw new NativeAppPlanError("native_destination_family_invalid");
  }
  const key = input.expectedKey;
  if (key !== "ios" && key !== "android") {
    throw new NativeAppPlanError("native_destination_key_invalid");
  }
  if (
    snapshot.destination_family !== input.expectedFamily ||
    snapshot.destination_key !== key || snapshot.os !== key
  ) {
    throw new NativeAppPlanError("native_destination_snapshot_mismatch");
  }
  const expectedAppKey: NativeAppKey = input.expectedFamily === "explorer_app"
    ? "explorer"
    : "business";
  if (snapshot.app_key !== expectedAppKey) {
    throw new NativeAppPlanError("native_destination_app_mismatch");
  }
  if (
    snapshot.ok !== true || snapshot.ready !== true ||
    snapshot.objective !== "app_install" ||
    snapshot.measurement_event !== "install"
  ) {
    throw new NativeAppPlanError("native_destination_not_ready");
  }
  const providerRows = Array.isArray(snapshot.provider_readiness)
    ? snapshot.provider_readiness.map(record).filter(Boolean) as Record<
      string,
      unknown
    >[]
    : [];
  const provider = providerRows.find((row) => row.platform === input.platform);
  if (!provider || provider.ready !== true) {
    throw new NativeAppPlanError("native_provider_not_ready");
  }
  const storeIdentifier = nonEmpty(snapshot.store_identifier);
  const appsFlyerAppId = nonEmpty(snapshot.appsflyer_app_id);
  const storeUrl = nonEmpty(snapshot.canonical_url);
  const oneLinkUrl = nonEmpty(snapshot.onelink_url);
  const title = nonEmpty(snapshot.title);
  if (
    !title || !validStoreIdentity(key, storeIdentifier) || !appsFlyerAppId ||
    !validStoreUrl(key, storeUrl) ||
    !validOneLinkUrl(expectedAppKey, oneLinkUrl)
  ) {
    throw new NativeAppPlanError("native_destination_identity_invalid");
  }
  return {
    family: input.expectedFamily,
    key,
    appKey: expectedAppKey,
    os: key,
    title,
    storeIdentifier,
    appsFlyerAppId,
    storeUrl,
    oneLinkUrl,
  };
}

/** The request may describe the target, but it cannot override frozen truth. */
export function assertNativeAppRequestDestination(
  descriptor: unknown,
  destination: FrozenNativeAppDestination,
): void {
  const row = record(descriptor);
  if (
    !row || row.page_type !== destination.family ||
    row.entity_slug !== destination.key ||
    (row.brand_slug !== undefined && row.brand_slug !== "mingla")
  ) {
    throw new NativeAppPlanError("native_destination_request_mismatch");
  }
}

export interface NativeAppCopy {
  primary: string;
  headline: string;
  description: string;
  googleHeadlines: string[];
  googleDescriptions: string[];
}

function stringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.map(nonEmpty).filter(Boolean).slice(0, max)
    : [];
}

/** Derive provider copy solely from the canonical plan. */
export function nativeAppCopyFromCanonicalPlan(
  canonicalPlan: unknown,
): NativeAppCopy {
  const plan = record(canonicalPlan);
  const copy = record(plan?.copy);
  const primary = nonEmpty(copy?.primary);
  const headline = nonEmpty(copy?.headline);
  const description = nonEmpty(copy?.description);
  const googleHeadlines = stringArray(copy?.googleHeadlines, 5);
  const googleDescriptions = stringArray(copy?.googleDescriptions, 5);
  if (!primary || !headline) {
    throw new NativeAppPlanError("native_copy_incomplete");
  }
  const finalGoogleHeadlines = googleHeadlines.length >= 2
    ? googleHeadlines
    : [headline, "Get the Mingla app"];
  const finalGoogleDescriptions = googleDescriptions.length >= 1
    ? googleDescriptions
    : [description || primary];
  return {
    primary,
    headline,
    description,
    googleHeadlines: finalGoogleHeadlines,
    googleDescriptions: finalGoogleDescriptions,
  };
}

export function nativeAppCreativeIdFromCanonicalPlan(
  canonicalPlan: unknown,
): string {
  const plan = record(canonicalPlan);
  const id = nonEmpty(plan?.creative_library_id);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new NativeAppPlanError("native_creative_library_required");
  }
  return id;
}

/** Provider output must use the immutable compiler result, never raw request targeting. */
export function nativeCompiledTargeting(
  value: unknown,
): Record<string, unknown> {
  const compiled = record(value);
  if (!compiled || Object.keys(compiled).length === 0) {
    throw new NativeAppPlanError("native_targeting_snapshot_missing");
  }
  return compiled;
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

/** Prove all caller-controlled immutable fields still match the frozen plan. */
export function assertNativeAppImmutableRequest(input: {
  canonicalPlan: unknown;
  requestBody: unknown;
  startsAt: string | null;
  endsAt: string | null;
  hostDeliveryBudgetCents: number;
}): void {
  const plan = record(input.canonicalPlan);
  const body = record(input.requestBody);
  if (!plan || !body) throw new NativeAppPlanError("native_plan_invalid");
  if (nonEmpty(plan.name) !== nonEmpty(body.name)) {
    throw new NativeAppPlanError("plan_name_mismatch");
  }
  const schedule = record(plan.schedule) ?? {};
  if (
    (schedule.starts_at ?? null) !== input.startsAt ||
    (schedule.ends_at ?? null) !== input.endsAt
  ) {
    throw new NativeAppPlanError("plan_schedule_mismatch");
  }
  if (canonicalJson(plan.copy) !== canonicalJson(body.copy_intent)) {
    throw new NativeAppPlanError("plan_copy_mismatch");
  }
  const creative = record(body.creative_intent) ?? {};
  if (
    (plan.creative_library_id ?? null) !==
      (creative.creative_library_id ?? null) ||
    (plan.creative_url ?? null) !== (creative.image_url ?? null)
  ) {
    throw new NativeAppPlanError("plan_creative_mismatch");
  }
  const compliance = record(body.compliance) ?? {};
  if (
    (plan.special_ad_category ?? "NONE") !==
      (compliance.specialAdCategory ?? "NONE")
  ) {
    throw new NativeAppPlanError("plan_compliance_mismatch");
  }
  const delivery = record(plan.delivery_budgets);
  const platform = nonEmpty(body.platform);
  const platformDelivery = record(delivery?.[platform]);
  const requestBudget = record(body.budget);
  if (
    !platformDelivery ||
    platformDelivery.host_amount_cents !== input.hostDeliveryBudgetCents ||
    requestBudget?.amount_cents !== input.hostDeliveryBudgetCents ||
    requestBudget?.type !== "daily"
  ) {
    throw new NativeAppPlanError("plan_budget_mismatch");
  }
}
