// ORCH-1056 — TESTER adversarial regression for the lead-facing welcome email.
//
// Attacks a DIFFERENT angle than welcome_email.test.ts (which asserts the happy
// content). Here we guard the two ways this email can go wrong in production:
//   1. Recipient confusion — the welcome must reach the LEAD, never the Mingla
//      inbox (seth@usemingla.com is the NOTIFY recipient, not this one).
//   2. Channel parity — both html AND text must carry the link + Ari + mobile
//      message, so a plain-text client isn't left with a dead email.
//   3. No injection / no fabricated data — a hostile brand_name/contact_name
//      must NOT appear in the rendered welcome (it is static marketing copy).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/beta-access-lead-submit/__tests__/welcome_email_adversarial.tester.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildWelcomeEmail, validateLead } from "../index.ts";

const FROM = "Mingla Beta <beta@usemingla.com>";

function hostileLead() {
  const v = validateLead({
    brandType: "club_nightlife",
    brandName: "<script>alert(1)</script> Bar",
    contactName: "<img src=x onerror=alert(2)>",
    city: "Berlin",
    email: "attacker@evil.test",
    consent: true,
    source: "organiser_marketing_hero",
  });
  if (!v.ok) throw new Error("fixture lead failed validation");
  return v.lead;
}

Deno.test("[adversarial] welcome never goes to the Mingla inbox", () => {
  const email = buildWelcomeEmail(hostileLead(), FROM);
  assertEquals(email.to, ["attacker@evil.test"]);
  assert(
    !email.to.some((addr) => addr.includes("seth@usemingla.com")),
    "welcome must NOT be sent to the internal notify inbox",
  );
});

Deno.test("[adversarial] link + Ari + mobile message present in BOTH channels", () => {
  const email = buildWelcomeEmail(hostileLead(), FROM);
  for (const [name, body] of [["html", email.html], ["text", email.text]]) {
    assert(
      body.includes("business.usemingla.com"),
      `${name} channel missing web-app link`,
    );
    assert(body.includes("Ari"), `${name} channel missing Ari`);
    assert(
      body.toLowerCase().includes("mobile app is in the works"),
      `${name} channel missing mobile-in-the-works`,
    );
  }
});

Deno.test("[adversarial] hostile lead fields never render into the welcome", () => {
  const email = buildWelcomeEmail(hostileLead(), FROM);
  assert(
    !email.html.includes("<script>alert(1)"),
    "raw script payload leaked into welcome html",
  );
  assert(
    !email.html.includes("onerror=alert(2)"),
    "raw event-handler payload leaked into welcome html",
  );
  assert(
    !email.text.includes("alert(1)") && !email.text.includes("alert(2)"),
    "lead payload leaked into welcome text",
  );
});
