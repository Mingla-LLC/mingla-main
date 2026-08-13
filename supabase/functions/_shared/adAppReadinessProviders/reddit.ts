import { evidence } from "../adAppReadiness.ts";
import type { OperatingSystem, TargetRow } from "../adAppReadiness.ts";
import {
  redditConnectPreflight,
  redditRequest,
  resolveRedditClient,
} from "../reddit.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";

export interface RedditAppBinding {
  appId: string;
  platform: "ios" | "android" | null;
}
export function parseRedditApps(
  payload: unknown,
  canonicalTarget?: Pick<TargetRow, "os" | "store_identifier">,
): RedditAppBinding[] {
  const root = payload as Record<string, unknown> | null;
  const rows = Array.isArray(root?.data)
    ? root?.data as Record<string, unknown>[]
    : [];
  return rows.flatMap((row) => {
    const id = row.app_id ?? row.id ?? row.store_id;
    if (typeof id !== "string") return [];
    const raw = String(row.platform ?? row.app_store ?? "").toLowerCase();
    const providerPlatform: OperatingSystem | null = raw.includes("ios") ||
        raw.includes("apple")
      ? "ios"
      : raw.includes("android") || raw.includes("google")
      ? "android"
      : null;
    return [{
      appId: id,
      platform: providerPlatform ??
        (canonicalTarget?.store_identifier === id ? canonicalTarget.os : null),
    }];
  });
}
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("reddit", ctx);
  if (!ctx.connection) return base;
  const connection = ctx.connection;
  const snapshot = await runAllowedProviderOperation(
    "reddit",
    "preflight",
    "GET",
    "read_only_preflight",
    () => redditConnectPreflight(asAdConnectionRow(connection), "consumer"),
  );
  const payerMatches = snapshot.account.id === connection.external_account_id;
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "Reddit API returned the exact corporate ad account.",
      ctx.checkedAt,
      "provider_api",
      snapshot.account.id,
    )
    : evidence(
      "blocked",
      "Reddit returned a different ad account.",
      ctx.checkedAt,
      "provider_api",
    );
  base.dimensions.funding = snapshot.fundingInstrumentId
    ? evidence(
      "proven",
      "Reddit reports a servable funding instrument.",
      ctx.checkedAt,
      "provider_api",
      snapshot.fundingInstrumentId,
    )
    : evidence(
      "action_required",
      "Reddit does not report a servable funding instrument.",
      ctx.checkedAt,
      "provider_api",
    );
  const client = await resolveRedditClient(
    asAdConnectionRow(connection),
    "consumer",
  );
  const apps = await runAllowedProviderOperation(
    "reddit",
    "apps",
    "GET",
    "ad_accounts/{id}/apps",
    async () =>
      parseRedditApps(
        await redditRequest(
          client,
          "GET",
          `/ad_accounts/${snapshot.account.id}/apps`,
        ),
        ctx.target,
      ),
  );
  const exact = apps.find((row) =>
    row.appId === ctx.target.store_identifier && row.platform === ctx.target.os
  );
  base.dimensions.binding = exact
    ? evidence(
      "proven",
      "Reddit returned the exact store identity after provider-authoritative app-install use.",
      ctx.checkedAt,
      "provider_api",
      exact.appId,
    )
    : evidence(
      "action_required",
      "Reddit has no pre-created app object. The exact store identity remains unproven until a separately approved paused app-install canary is accepted.",
      ctx.checkedAt,
      "provider_api",
      ctx.target.store_identifier,
    );
  base.reason_code = !payerMatches
    ? "payer_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : !snapshot.fundingInstrumentId
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
