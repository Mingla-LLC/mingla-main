// ORCH-1056 — happy-path regression for the lead-facing welcome email.
//
// Exercises buildWelcomeEmail (the pure builder the handler ships). This is the
// CLOSE Step 0.5 implementor regression: it PASSES on the fixed code and MUST
// FAIL on revert (e.g. if buildWelcomeEmail is removed, or the business.usemingla.com
// link / Ari spotlight / mobile-in-the-works line is dropped).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/beta-access-lead-submit/__tests__/welcome_email.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildWelcomeEmail, validateLead } from "../index.ts";

const FROM = "Mingla Beta <beta@usemingla.com>";

function lead() {
  const v = validateLead({
    brandType: "restaurant",
    brandName: "The Corner Table",
    contactName: "Ada",
    city: "Lagos",
    email: "owner@thecornertable.com",
    consent: true,
    source: "organiser_marketing_nav",
  });
  if (!v.ok) throw new Error("fixture lead failed validation");
  return v.lead;
}

Deno.test("welcome email is addressed to the lead", () => {
  const email = buildWelcomeEmail(lead(), FROM);
  assertEquals(email.to, ["owner@thecornertable.com"]);
  assertEquals(email.from, FROM);
});

Deno.test("welcome subject confirms the beta list", () => {
  const email = buildWelcomeEmail(lead(), FROM);
  assert(
    email.subject.toLowerCase().includes("on the list"),
    `subject missing confirmation: ${email.subject}`,
  );
});

Deno.test("welcome body links to the web app (business.usemingla.com)", () => {
  const email = buildWelcomeEmail(lead(), FROM);
  assert(
    email.html.includes("https://business.usemingla.com"),
    "html missing business.usemingla.com link",
  );
  assert(
    email.text.includes("https://business.usemingla.com"),
    "text missing business.usemingla.com link",
  );
});

Deno.test("welcome body spotlights Ari + flags mobile as in-the-works", () => {
  const email = buildWelcomeEmail(lead(), FROM);
  assert(email.html.includes("Ari"), "html missing Ari spotlight");
  assert(email.text.includes("Ari"), "text missing Ari spotlight");
  assert(
    email.html.toLowerCase().includes("mobile app is in the works"),
    "html missing mobile-app-in-the-works line",
  );
  assert(
    email.text.toLowerCase().includes("mobile app is in the works"),
    "text missing mobile-app-in-the-works line",
  );
});
