import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { runAllowedProviderOperation } from "../adAppReadinessProviders/common.ts";

Deno.test("#2015 tester guard rejects cross-provider route drift before any callback can run", async () => {
  const attempts = [
    ["meta", "mobile_app", "GET", "ad_account/apps"],
    ["tiktok", "app_info", "GET", "app/create/"],
    ["snapchat", "mobile_apps", "GET", "adaccounts/{id}/mobile_apps"],
    ["google", "app_bindings", "POST", "customers/{id}/googleAds:searchStream"],
    ["reddit", "apps", "GET", "ad_accounts/{id}/campaigns"],
  ] as const;
  let callbacks = 0;

  for (const [provider, operation, method, path] of attempts) {
    await assertRejects(
      () =>
        runAllowedProviderOperation(
          provider,
          operation,
          method,
          path,
          () => {
            callbacks += 1;
            return Promise.resolve({});
          },
        ),
      Error,
      "provider_operation_forbidden",
    );
  }

  assertEquals(callbacks, 0);
});
