import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  handleAppReadinessRequest,
  parseReadinessRequest,
  type ReadinessDb,
} from "../handler.ts";

const SAFE_CHANGE = {
  action: "set_safe_binding",
  app_key: "business",
  os: "android",
  provider: "tiktok",
  provider_contract_kind: "mobile_asset",
  provider_app_id: "7659053200868786183",
  provider_measurement_id: "7659053200868769799",
  expected_current_version: 1,
  idempotency_key: "12345678-1234-4123-8123-123456789abc",
  reason: "Record provider-authoritative app identifiers.",
} as const;

Deno.test("#2015 safe-binding request is exact, versioned, and rejects secret-shaped extra input", () => {
  assertEquals(parseReadinessRequest(SAFE_CHANGE)?.action, "set_safe_binding");
  assertEquals(
    parseReadinessRequest({ ...SAFE_CHANGE, access_token: "secret" }),
    null,
  );
  assertEquals(
    parseReadinessRequest({
      ...SAFE_CHANGE,
      provider_contract_kind: "campaign_store_binding",
    })?.action,
    "set_safe_binding",
  );
  assertEquals(
    parseReadinessRequest({
      ...SAFE_CHANGE,
      idempotency_key: "not-a-uuid",
    }),
    null,
  );
});

Deno.test("#2015 safe-binding write requires admin auth and an allowlisted origin", async () => {
  let received: Record<string, unknown> | null = null;
  const db: ReadinessDb = {
    loadRegistry: () =>
      Promise.resolve({
        targets: [],
        bindings: [],
        connections: [],
        identities: [],
      }),
    loadLatest: () => Promise.resolve([]),
    persist: () => Promise.resolve({}),
    setSafeBinding: (input) => {
      received = input;
      return Promise.resolve({ binding_version: 2 });
    },
  };
  const invoke = (origin?: string) =>
    handleAppReadinessRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(SAFE_CHANGE),
      }),
      {
        authorize: () =>
          Promise.resolve({ status: "authorized", actor: "admin-id" }),
        createDb: () => db,
        now: () => "2026-08-13T12:00:00.000Z",
      },
    );

  assertEquals((await invoke()).status, 403);
  assertEquals((await invoke("https://evil.example")).status, 403);
  const accepted = await invoke("https://admin.usemingla.com");
  assertEquals(accepted.status, 200);
  assertEquals(received, {
    app_key: "business",
    os: "android",
    provider: "tiktok",
    provider_contract_kind: "mobile_asset",
    provider_app_id: "7659053200868786183",
    provider_measurement_id: "7659053200868769799",
    actor: "admin-id",
    reason: "Record provider-authoritative app identifiers.",
    expected_current_version: 1,
    idempotency_key: "12345678-1234-4123-8123-123456789abc",
  });
});

Deno.test("#2015 canary evidence action is installed fail-closed until explicit founder approval", async () => {
  let dbCreated = 0;
  const response = await handleAppReadinessRequest(
    new Request("https://edge.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer admin",
        Origin: "https://admin.usemingla.com",
      },
      body: JSON.stringify({
        action: "record_canary_evidence",
        app_key: "explorer",
        os: "ios",
      }),
    }),
    {
      authorize: () =>
        Promise.resolve({ status: "authorized", actor: "admin-id" }),
      createDb: () => {
        dbCreated += 1;
        return {} as ReadinessDb;
      },
      now: () => "2026-08-13T12:00:00.000Z",
    },
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "founder_approval_required" });
  assertEquals(dbCreated, 1);
});
