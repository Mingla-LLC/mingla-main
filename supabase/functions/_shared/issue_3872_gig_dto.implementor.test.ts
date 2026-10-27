import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  containsPrivateContact,
  lintAnonymousCopy,
  PREHIRE_CREATOR_KEYS,
  PUBLIC_GIG_KEYS,
  toPrehireCreator,
  toPublicGig,
} from "./gigDto.ts";

Deno.test("#3872 public gig DTO is exact and strips brand/contact/private fields", () => {
  const dto = toPublicGig({
    ...Object.fromEntries(PUBLIC_GIG_KEYS.map((key) => [key, key])),
    brand_id: "secret",
    brief_private: "secret",
    contact_email: "host@example.com",
    deliverables: [{
      platform: "instagram",
      kind: "reel",
      count: 1,
      internal: "no",
    }],
  });
  assertEquals(Object.keys(dto), [...PUBLIC_GIG_KEYS]);
  assertEquals(dto.deliverables, [{
    platform: "instagram",
    kind: "reel",
    count: 1,
  }]);
  assertEquals("brand_id" in dto, false);
});

Deno.test("#3872 prehire creator DTO is exact and strips handles/contact/DOB", () => {
  const dto = toPrehireCreator({
    ...Object.fromEntries(PREHIRE_CREATOR_KEYS.map((key) => [key, key])),
    date_of_birth: "2000-01-01",
    email: "creator@example.com",
    handle: "@private",
    follower_bands: [{
      platform: "instagram",
      band: "10k_50k",
      verified: true,
      handle: "@private",
    }],
    showcase: [{
      media_id: "m1",
      thumb: "signed-thumb-id",
      playback_url: "https://private",
    }],
  });
  assertEquals(Object.keys(dto), [...PREHIRE_CREATOR_KEYS]);
  assertEquals(dto.follower_bands, [{
    platform: "instagram",
    band: "10k_50k",
    verified: true,
  }]);
  assertEquals(dto.showcase, [{ media_id: "m1", thumb: "signed-thumb-id" }]);
  assertEquals("date_of_birth" in dto, false);
});

Deno.test("#3872 anonymous-copy linter rejects every off-platform identity route", () => {
  assertEquals(
    lintAnonymousCopy(
      "Book Acme at https://acme.test @acme +1 (212) 555-1212 hi@acme.test",
      ["Acme"],
    ),
    ["email", "handle", "phone", "private_name", "url"],
  );
  assertEquals(
    lintAnonymousCopy("Rooftop supper with three courses", ["Acme"]),
    [],
  );
  assertEquals(
    containsPrivateContact({ text: "email me creator@example.com" }),
    true,
  );
});

Deno.test("#3872 public gig DTO carries the gig's pay, never a budget level", () => {
  const dto = toPublicGig({
    id: "g1",
    pay_up_to_minor: 30000,
    currency: "USD",
  });
  assertEquals(dto.pay_up_to_minor, 30000);
  assertEquals(dto.currency, "USD");
  assertEquals(Object.keys(dto).some((key) => key.startsWith("budget")), false);
});
