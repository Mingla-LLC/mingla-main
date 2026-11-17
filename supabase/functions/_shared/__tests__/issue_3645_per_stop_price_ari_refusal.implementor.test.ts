// issue #3645 bundle 2A — Ari words the experience_price_invalid refusal.
// biz_publish_experience, biz_create_experience and biz_update_live_experience
// raise it for a paid experience (whole price or per stop) that resolves to 0.
// Before this, Ari had no sentence for it and surfaced a raw RPC failure.
// callRpc's mapping of any ARI_REFUSAL_COPY code to DOMAIN_REFUSED is pinned
// by issue_3645_organiser_terms_refusal.implementor.test.ts.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  ARI_REFUSAL_CODES,
  ARI_REFUSAL_COPY,
  ariDomainRefusalMessage,
  detectAriRefusalCode,
} from "../ariRefusalCopy.ts";

const EXPECTED =
  "This experience isn't marked free, so it needs a price above zero. Set a price, or mark it free in the Host app, then ask me again. Nothing was saved.";

Deno.test("#3645 2A experience_price_invalid is a known Ari refusal with an owner sentence", () => {
  assert(ARI_REFUSAL_CODES.includes("experience_price_invalid"));
  const entry = ARI_REFUSAL_COPY.experience_price_invalid;
  assertEquals(entry.message, EXPECTED);
  assertEquals(entry.fixRoute, null);
  assertEquals(entry.who, "anyone");
});

Deno.test("#3645 2A the raw database errors map to the sentence, whichever writer raised them", () => {
  for (
    const raw of [
      "experience_price_invalid",
      "ERROR: experience_price_invalid",
      "biz_publish_experience: experience_price_invalid",
      "biz_update_live_experience: experience_price_invalid",
      "business_apply_experience_action: experience_price_invalid (P0001)",
    ]
  ) {
    assertEquals(detectAriRefusalCode(raw), "experience_price_invalid", raw);
    assertEquals(ariDomainRefusalMessage(raw), EXPECTED, raw);
  }
});

Deno.test("#3645 2A a near-miss token is not this refusal", () => {
  assertEquals(detectAriRefusalCode("not_experience_price_invalid_x"), null);
  assertEquals(detectAriRefusalCode("experience_price_invalidated"), null);
});

Deno.test("#3645 2A the sentence names no code and promises nothing Ari cannot do", () => {
  assert(!/[a-z]+_[a-z_]+/.test(EXPECTED), "no code words");
  assert(!/tell me to make it free/i.test(EXPECTED), "Ari has no tool that marks an experience free");
  assert(EXPECTED.endsWith("Nothing was saved."));
});
