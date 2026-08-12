import { evidence } from "../adAppReadiness.ts";
import {
  resolveSnapchatClient,
  snapchatApi,
  snapchatFetchAdAccount,
  snapchatFetchFundingSources,
} from "../snapchat.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";

interface SnapMobileApp {
  id: string;
  iosAppId: string | null;
  iosVerified: boolean;
  androidAppId: string | null;
  androidVerified: boolean;
  measurementPartners: string[];
}

export function parseMobileApps(payload: unknown): SnapMobileApp[] {
  if (!payload || typeof payload !== "object") return [];
  const collection = (payload as Record<string, unknown>).mobile_apps;
  if (!Array.isArray(collection)) return [];
  return collection.flatMap((wrapper) => {
    if (!wrapper || typeof wrapper !== "object") return [];
    const row = wrapper as Record<string, unknown>;
    if (String(row.sub_request_status ?? "").toUpperCase() !== "SUCCESS") {
      return [];
    }
    const raw = row.mobile_app;
    if (!raw || typeof raw !== "object") return [];
    const app = raw as Record<string, unknown>;
    if (typeof app.id !== "string") return [];
    return [{
      id: app.id,
      iosAppId: typeof app.ios_app_id === "string" ? app.ios_app_id : null,
      iosVerified: app.ios_app_id_verified === true,
      androidAppId: typeof app.android_app_url === "string"
        ? app.android_app_url
        : null,
      androidVerified: app.android_app_url_verified === true,
      measurementPartners: Array.isArray(app.mobile_measurement_partners)
        ? app.mobile_measurement_partners.filter((value) =>
          typeof value === "string"
        ).map((value) => value.toUpperCase())
        : [],
    }];
  });
}

export function findVerifiedMobileApp(
  apps: SnapMobileApp[],
  providerAppId: string | null,
  os: "ios" | "android",
  storeIdentifier: string,
): SnapMobileApp | undefined {
  return apps.find((app) =>
    app.id === providerAppId &&
    (os === "ios"
      ? app.iosAppId === storeIdentifier && app.iosVerified
      : app.androidAppId === storeIdentifier && app.androidVerified)
  );
}

export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("snapchat", ctx);
  if (!ctx.connection) return base;
  const client = await resolveSnapchatClient(asAdConnectionRow(ctx.connection));
  const account = await runAllowedProviderOperation(
    "snapchat",
    "account",
    "GET",
    "adaccounts/{id}",
    () => snapchatFetchAdAccount(client),
  );
  const payerMatches = account.id === ctx.connection.external_account_id;
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "Snap API returned the exact corporate ad account.",
      ctx.checkedAt,
      "provider_api",
      account.id,
    )
    : evidence(
      "blocked",
      "Snap returned a different ad account.",
      ctx.checkedAt,
      "provider_api",
    );
  const organizationId = account.organizationId ?? client.organizationId;
  const funding = organizationId
    ? await runAllowedProviderOperation(
      "snapchat",
      "funding",
      "GET",
      "organizations/{id}/fundingsources",
      () => snapchatFetchFundingSources(client, organizationId),
    )
    : [];
  const activeFunding = funding.find((row) => row.status === "ACTIVE");
  base.dimensions.funding = activeFunding
    ? evidence(
      "proven",
      "Snap reports an active funding source.",
      ctx.checkedAt,
      "provider_api",
      activeFunding.id,
    )
    : evidence(
      "action_required",
      "Snap does not report an active funding source.",
      ctx.checkedAt,
      "provider_api",
    );
  const mobileApps = await runAllowedProviderOperation(
    "snapchat",
    "mobile_apps",
    "GET",
    "adaccounts/{id}/mobile_apps",
    async () =>
      parseMobileApps(
        await snapchatApi(
          client,
          "GET",
          `adaccounts/${client.adAccountId}/mobile_apps`,
        ),
      ),
  );
  const exactApp = findVerifiedMobileApp(
    mobileApps,
    ctx.binding.provider_app_id,
    ctx.target.os,
    ctx.target.store_identifier,
  );
  base.dimensions.binding = base.dimensions.binding.status === "proven"
    ? base.dimensions.binding
    : exactApp
    ? evidence(
      "proven",
      `Snap API returned the exact ${ctx.target.display_name} ${ctx.target.os} app binding.`,
      ctx.checkedAt,
      "provider_api",
      exactApp.id,
    )
    : evidence(
      ctx.binding.provider_app_id ? "blocked" : "action_required",
      ctx.binding.provider_app_id
        ? "Snap did not return the exact registered app and store binding."
        : "No exact Snap App ID is registered for this target.",
      ctx.checkedAt,
      "provider_api",
      ctx.binding.provider_app_id ?? undefined,
    );
  if (
    exactApp?.measurementPartners.includes("APPSFLYER") &&
    base.dimensions.measurement.status !== "proven"
  ) {
    base.dimensions.measurement = evidence(
      "action_required",
      "Snap confirms AppsFlyer is linked, but the install-event mapping still needs AppsFlyer proof.",
      ctx.checkedAt,
      "provider_api",
      exactApp.id,
    );
  }
  base.reason_code = !payerMatches
    ? "payer_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : !activeFunding
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
