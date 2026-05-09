import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("brand-stripe-onboard uses Accounts v2 hosted onboarding path", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "createRecipientAccount");
  assertStringIncludes(source, "createRecipientAccountLink");
  assertStringIncludes(source, "buildStripeAccountLinkRedirectUrl");
  assertStringIncludes(source, '"/stripe-onboarding-return"');
  assertStringIncludes(source, "client_secret: null");
  assertStringIncludes(
    source,
    'onboarding_surface: "stripe_hosted_account_link"',
  );
  assertStringIncludes(source, "return jsonResponse({");
  assertEquals(source.includes("STRIPE_API_VERSION"), false);
  assertEquals(source.includes("stripe.accounts.create"), false);
  assertEquals(source.includes("accountSessions.create"), false);
  assertEquals(source.includes("apiVersion:"), false);
  assertEquals(source.includes("connect-onboarding?session"), false);
});

Deno.test("brand-stripe-onboard reuses an existing connected account before creating account link", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const reuseIndex = source.indexOf("if (existingSca?.stripe_account_id)");
  const createAccountIndex = source.indexOf("await createRecipientAccount({");
  const createLinkIndex = source.indexOf("await createRecipientAccountLink({");

  assertEquals(reuseIndex > -1, true);
  assertEquals(createAccountIndex > -1, true);
  assertEquals(createLinkIndex > -1, true);
  assertEquals(createLinkIndex > reuseIndex, true);
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
  assertStringIncludes(source, "buildStripeOnboardLinkOperation");
  assertStringIncludes(source, '"country_locked"');
  assertStringIncludes(source, '"stripe_account_country_locked_after_onboarding"');
  assertStringIncludes(source, "details_submitted");
  assertStringIncludes(source, "stripe_delete_rejected");
});
