import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  handleAppReadinessRequest,
  parseReadinessRequest,
  type ReadinessDb,
  runSelectedCheck,
} from "../handler.ts";
import {
  handleReadinessEvent,
  parseEvent,
} from "../../admin-ad-app-readiness-event/handler.ts";

Deno.test("#1950 strict request contract rejects defaults arrays and extra keys", () => {
  assertEquals(
    parseReadinessRequest({ action: "load", app_key: "explorer", os: "ios" }),
    { action: "load", appKey: "explorer", os: "ios" },
  );
  assertEquals(
    parseReadinessRequest({ action: "load", app_key: "explorer" }),
    null,
  );
  assertEquals(
    parseReadinessRequest({
      action: "load",
      app_key: "explorer",
      os: "ios",
      provider: "meta",
    }),
    null,
  );
  assertEquals(parseReadinessRequest([]), null);
});

Deno.test("#1950 service database is created only after admin authorization", async () => {
  const calls: string[] = [];
  const response = await handleAppReadinessRequest(
    new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer x" },
      body: JSON.stringify({ action: "load", app_key: "explorer", os: "ios" }),
    }),
    {
      authorize: async () => {
        calls.push("authorize");
        return await Promise.resolve({ status: "forbidden" });
      },
      createDb: () => {
        calls.push("service");
        throw new Error("must not run");
      },
      now: () => "2026-08-12T12:00:00.000Z",
    },
  );
  assertEquals(response.status, 403);
  assertEquals(calls, ["authorize"]);
});

Deno.test("#1950 check persists exactly five canonical provider results once", async () => {
  let persistCalls = 0;
  let persisted: unknown[] = [];
  const db: ReadinessDb = {
    loadRegistry: () =>
      Promise.resolve({
        targets: [{
          app_key: "explorer",
          os: "ios",
          display_name: "Mingla Explorer",
          store_identifier: "6760440898",
          appsflyer_app_id: "id6760440898",
          onelink_url: "https://go.usemingla.com/w36m",
          active: true,
        }],
        bindings: ["meta", "tiktok", "snapchat", "google", "reddit"].map((
          provider,
        ) => ({
          app_key: "explorer",
          os: "ios",
          provider,
          payer_connection_id: "payer",
          public_identity_required: ["meta", "tiktok"].includes(provider),
          provider_app_id: null,
          provider_measurement_id: null,
          active: true,
        })),
        connections: [{
          id: "payer",
          platform: "meta",
          lane: "consumer",
          display_name: "Mingla",
          external_account_id: "1",
          connected: true,
          status: "connected",
          account_status: "ACTIVE",
          extra: {},
        }],
        identities: [],
      } as never),
    loadLatest: () => Promise.resolve([]),
    persist: async (_run, results) => {
      persistCalls += 1;
      persisted = results;
      return await Promise.resolve({ run_id: "run" });
    },
  };
  await runSelectedCheck(db, "actor", "explorer", "ios");
  assertEquals(persistCalls, 1);
  assertEquals(persisted.map((row) => (row as { provider: string }).provider), [
    "meta",
    "tiktok",
    "snapchat",
    "google",
    "reddit",
  ]);
});

Deno.test("#1950 responses are no-store nosniff and absent JWT is opaque 401", async () => {
  const response = await handleAppReadinessRequest(
    new Request("https://example.test", { method: "POST", body: "{}" }),
    {
      authorize: () => Promise.resolve({ status: "unauthorized" }),
      createDb: () => {
        throw new Error("no");
      },
      now: () => "",
    },
  );
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
});

Deno.test("#1950 analytics accepts only the safe allowlist and fails soft without leaking input", async () => {
  assertEquals(
    parseEvent({
      event_name: "check_completed",
      app_key: "business",
      os: "ios",
      provider: "meta",
      verdict: "ready",
      reason_code: "all_required_dimensions_proven",
      freshness_bucket: "current",
    })?.event_name,
    "check_completed",
  );
  assertEquals(
    parseEvent({
      event_name: "check_completed",
      app_key: "business",
      os: "ios",
      token: "secret",
    }),
    null,
  );
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...values: unknown[]) => warnings.push(values.join(" "));
  try {
    const response = await handleReadinessEvent(
      new Request("https://example.test", {
        method: "POST",
        headers: { Authorization: "Bearer safe" },
        body: JSON.stringify({
          event_name: "readiness_viewed",
          app_key: "explorer",
          os: "android",
        }),
      }),
      {
        authorize: () =>
          Promise.resolve({ status: "authorized", actor: "admin-id" }),
        insert: () => Promise.reject(new Error("database secret detail")),
      },
    );
    assertEquals(response.status, 204);
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0].includes("database secret detail"), false);
    assertEquals(warnings[0].includes("Bearer safe"), false);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("#1950 missing bindings persist five controlled non-ready results instead of aborting", async () => {
  let persisted: unknown[] = [];
  const db: ReadinessDb = {
    loadRegistry: () =>
      Promise.resolve({
        targets: [{
          app_key: "explorer",
          os: "ios",
          display_name: "Mingla Explorer",
          store_identifier: "6760440898",
          appsflyer_app_id: "id6760440898",
          onelink_url: "https://go.usemingla.com/w36m",
          active: true,
        }],
        bindings: [],
        connections: [],
        identities: [],
      }),
    loadLatest: () => Promise.resolve([]),
    persist: (_run, results) => {
      persisted = results;
      return Promise.resolve({ run_id: "run" });
    },
  };
  await runSelectedCheck(db, "actor", "explorer", "ios");
  assertEquals(persisted.length, 5);
  assertEquals(
    persisted.every((row) =>
      (row as Record<string, unknown>).reason_code === "binding_missing"
    ),
    true,
  );
});

Deno.test("#1950 AppsFlyer failure is consumed as blocked measurement in all five results", async () => {
  let persisted: Array<Record<string, unknown>> = [];
  const providers = ["meta", "tiktok", "snapchat", "google", "reddit"] as const;
  const db: ReadinessDb = {
    loadRegistry: () =>
      Promise.resolve({
        targets: [{
          app_key: "business",
          os: "android",
          display_name: "Mingla Business",
          store_identifier: "com.sethogieva.minglabusiness",
          appsflyer_app_id: "com.sethogieva.minglabusiness",
          onelink_url: "https://biz.usemingla.com/ZSCW",
          active: true,
        }],
        bindings: providers.map((provider) => ({
          app_key: "business",
          os: "android",
          provider,
          payer_connection_id: provider,
          public_identity_required: provider === "meta" ||
            provider === "tiktok",
          provider_app_id: null,
          provider_measurement_id: null,
          active: true,
        })),
        connections: providers.map((provider) => ({
          id: provider,
          platform: provider,
          lane: "consumer",
          display_name: provider,
          external_account_id: "account",
          connected: true,
          status: "connected",
          account_status: "ACTIVE",
          extra: {},
        })),
        identities: [],
      } as never),
    loadLatest: () => Promise.resolve([]),
    persist: (_run, results) => {
      persisted = results as Array<Record<string, unknown>>;
      return Promise.resolve({ run_id: "run" });
    },
  };
  const proven = {
    status: "proven",
    summary: "Current provider read.",
    source_class: "provider_api",
    source_checked_at: "2026-08-12T12:00:00.000Z",
  } as const;
  const adapters = Object.fromEntries(
    providers.map((provider) => [provider, () =>
      Promise.resolve({
        provider,
        reason_code: "all_required_dimensions_proven",
        dimensions: {
          payer: proven,
          identity: provider === "meta" || provider === "tiktok"
            ? proven
            : { ...proven, status: "not_applicable" },
          binding: proven,
          measurement: proven,
          funding: proven,
        },
      })]
    ),
  ) as never;
  await runSelectedCheck(db, "actor", "business", "android", {
    verifyAppsflyer: () => Promise.reject(new Error("unavailable")),
    adapters,
  });
  assertEquals(persisted.length, 5);
  assertEquals(
    persisted.every((row) =>
      (row.measurement as Record<string, unknown>).status === "blocked"
    ),
    true,
  );
  assertEquals(
    persisted.every((row) =>
      (row.measurement as Record<string, unknown>).source_class ===
        "appsflyer_api"
    ),
    true,
  );
});
