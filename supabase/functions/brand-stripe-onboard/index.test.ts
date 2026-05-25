import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("brand-stripe-onboard uses Accounts v2 plus embedded onboarding session path", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "createRecipientAccount");
  assertStringIncludes(source, "createAccountSession");
  assertStringIncludes(source, "BUSINESS_WEB_ORIGIN");
  assertStringIncludes(source, "/connect-onboarding");
  assertStringIncludes(source, "client_secret: accountSession.client_secret");
  assertStringIncludes(
    source,
    'onboarding_surface: "mingla_hosted_embedded_components"',
  );
  assertStringIncludes(source, "return jsonResponse({");
  assertEquals(source.includes("createRecipientAccountLink"), false);
  assertEquals(source.includes("buildStripeAccountLinkRedirectUrl"), false);
  assertEquals(source.includes('"/stripe-onboarding-return"'), false);
  assertEquals(source.includes("client_secret: null"), false);
  assertEquals(source.includes("stripe.accounts.create"), false);
  assertEquals(source.includes("accountSessions.create"), false);
  assertEquals(source.includes("apiVersion:"), false);
  assertEquals(source.includes("connect-onboarding"), true);
});

Deno.test("brand-stripe-onboard reuses an existing connected account before creating account session", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const reuseIndex = source.indexOf("if (existingSca?.stripe_account_id)");
  const createAccountIndex = source.indexOf("await createRecipientAccount({");
  const createSessionIndex = source.indexOf("await createAccountSession({");

  assertEquals(reuseIndex > -1, true);
  assertEquals(createAccountIndex > -1, true);
  assertEquals(createSessionIndex > -1, true);
  assertEquals(createSessionIndex > reuseIndex, true);
  assertStringIncludes(
    source,
    "stripeAccountId = existingSca.stripe_account_id",
  );
  assertStringIncludes(source, "accountId: stripeAccountId");
});

Deno.test("brand-stripe-onboard handles country replacement before account link creation", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "decideStripeCountryReplacement");
  assertStringIncludes(source, "hasLocalMoneyMovement");
  assertStringIncludes(source, "deleteReplaceableStripeAccount");
  assertStringIncludes(source, "stripe_connect.country_change_locked");
  assertStringIncludes(
    source,
    "stripe_connect.country_change_replaced_before_completion",
  );
  assertStringIncludes(source, "buildStripeOnboardCreateOperation");
  assertStringIncludes(source, "buildStripeAccountSessionOperation");
  assertStringIncludes(source, '"country_locked"');
  assertStringIncludes(
    source,
    '"stripe_account_country_locked_after_onboarding"',
  );
  assertStringIncludes(source, "details_submitted");
  assertStringIncludes(source, "stripe_delete_rejected");
});
