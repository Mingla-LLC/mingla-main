/**
 * ORCH-0954 happy-path regression for embedded onboarding cutover.
 *
 * Fails-on-revert verified at 316da320: temporarily reverting the controller
 * constant to losses_collector="application", fees_collector="application",
 * dashboard="express" failed this file with Actual "application" / Expected
 * "stripe".
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { STRIPE_MANAGED_RISK_CONTROLLER } from "../../_shared/stripeBlueprintClient.ts";

Deno.test("ORCH-0954 — managed-risk controller constant is pinned", () => {
  assertEquals(
    STRIPE_MANAGED_RISK_CONTROLLER.defaults.responsibilities.losses_collector,
    "stripe",
  );
  assertEquals(
    STRIPE_MANAGED_RISK_CONTROLLER.defaults.responsibilities.fees_collector,
    "account",
  );
  assertEquals(STRIPE_MANAGED_RISK_CONTROLLER.dashboard, "none");
});

Deno.test("ORCH-0954 — brand-stripe-onboard mints embedded Account Session and returns hosted Mingla URL", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );

  assertStringIncludes(source, "await createRecipientAccount({");
  assertStringIncludes(source, "await createAccountSession({");
  assertStringIncludes(source, "account_onboarding");
  assertStringIncludes(source, "external_account_collection: true");
  assertStringIncludes(source, 'fields: "eventually_due"');
  assertStringIncludes(source, 'future_requirements: "include"');
  assertStringIncludes(source, 'controller_dashboard_type: "none"');
  assertStringIncludes(
    source,
    'onboarding_surface: "mingla_hosted_embedded_components"',
  );
  assertStringIncludes(source, "BUSINESS_WEB_ORIGIN");
  assertStringIncludes(source, "/connect-onboarding");
  assertStringIncludes(source, "client_secret: accountSession.client_secret");
  assertStringIncludes(source, "onboarding_url: onboardingUrl");

  assert(
    !source.includes("createRecipientAccountLink"),
    "hosted Account Link helper must not be used by brand-stripe-onboard",
  );
  assert(
    !source.includes('controller_dashboard_type: "express"'),
    "new SCA rows must not be written as Express dashboard accounts",
  );
  assert(
    !source.includes("client_secret: null"),
    "embedded onboarding response must include the real client_secret",
  );
});
