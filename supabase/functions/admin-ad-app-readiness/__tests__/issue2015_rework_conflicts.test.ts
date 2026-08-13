import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleAppReadinessRequest, type ReadinessDb } from "../handler.ts";

const CHANGE = {
  action: "set_safe_binding",
  app_key: "business",
  os: "android",
  provider: "tiktok",
  provider_contract_kind: "mobile_asset",
  provider_app_id: "7659053200868786183",
  provider_measurement_id: "7659053200868769799",
  expected_current_version: 1,
  idempotency_key: "32345678-1234-4123-8123-123456789abc",
  reason: "Record provider-authoritative identifiers.",
} as const;

function dbRejecting(message: string): ReadinessDb {
  return {
    loadRegistry: () =>
      Promise.resolve({
        targets: [],
        bindings: [],
        connections: [],
        identities: [],
      }),
    loadLatest: () => Promise.resolve([]),
    persist: () => Promise.resolve({}),
    setSafeBinding: () => Promise.reject(new Error(message)),
  };
}

Deno.test("#2015 rework maps stable binding and idempotency conflicts to HTTP 409", async () => {
  for (
    const conflict of [
      "binding_version_conflict",
      "idempotency_key_conflict",
    ]
  ) {
    const response = await handleAppReadinessRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin",
          Origin: "https://admin.usemingla.com",
        },
        body: JSON.stringify(CHANGE),
      }),
      {
        authorize: () =>
          Promise.resolve({ status: "authorized", actor: "admin-id" }),
        createDb: () => dbRejecting(conflict),
        now: () => "2026-08-13T16:00:00.000Z",
      },
    );
    assertEquals(response.status, 409);
    assertEquals(await response.json(), { error: conflict });
  }
});

Deno.test("#2015 rework keeps unrelated database errors opaque", async () => {
  const response = await handleAppReadinessRequest(
    new Request("https://edge.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer admin",
        Origin: "https://admin.usemingla.com",
      },
      body: JSON.stringify(CHANGE),
    }),
    {
      authorize: () =>
        Promise.resolve({ status: "authorized", actor: "admin-id" }),
      createDb: () => dbRejecting("sensitive_database_detail"),
      now: () => "2026-08-13T16:00:00.000Z",
    },
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "readiness_unavailable" });
});
